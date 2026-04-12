---
title: "Product Catalogue Service"
last-updated: "2025-03-15"
owner: "Acme Retail — Search & Discovery Team"
status: "Active"
---

# Product Catalogue Service

## Service Overview

The **Product Catalogue Service** is the authoritative source of truth for all product data within Acme Retail. Built as a .NET 6 Web API deployed to Azure Kubernetes Service (AKS), this microservice owns the complete product lifecycle — from initial ingestion through search indexing to consumer-facing APIs. Every product record, variant, attribute, image reference, and category assignment originates from or is validated by this service before downstream systems consume it.

The service exposes a RESTful API consumed by four primary internal clients: the BookStore eCommerce platform, the Point-of-Sale (POS) system used in physical retail locations, the Recommendation Engine that powers personalized product suggestions, and the Loyalty Program service that maps purchases to reward eligibility. External partner integrations also consume a read-only subset of the catalogue API through the Acme Tech API Gateway.

The Search & Discovery team, consisting of eight engineers, owns development and operations for the Product Catalogue Service. The team follows a weekly deployment cadence to production, with hotfix capability available through an expedited release pipeline. On-call rotation covers 24/7 support, escalating to the platform engineering team for infrastructure-level incidents. Architecture decisions governing this service are documented in [ADR-001](../architecture/adr-001-elasticsearch-search.md) and the broader [system landscape](../architecture/system-landscape.md).

## Product Data Model

The product data model follows a hierarchical structure designed to accommodate both Acme Retail's original bookstore inventory and the broader general merchandise catalogue introduced during the retail expansion.

At the root of the hierarchy sits the **Product** entity, which represents a distinct item in the catalogue. Each Product record contains `ProductId` (GUID, primary key), `SKU` (stock-keeping unit, unique across the catalogue), `Name`, `Description` (both a short summary of up to 160 characters and a long-form HTML description), `Brand`, `BasePrice` (decimal, tax-exclusive), and `Status` (Active, Discontinued, Draft, or Archived). The Product entity serves as the canonical reference for all downstream consumers.

Beneath each Product, one or more **Variants** represent purchasable configurations. Each Variant record includes `VariantId`, `Color`, `Size`, `Weight` (in grams), `Price` (which may differ from the base price for premium variants), `StockStatus` (InStock, LowStock, OutOfStock, PreOrder), and `Barcode` conforming to the EAN-13 standard. A book with hardcover and paperback editions, for example, would have two variants under a single Product.

**Attributes** are stored as flexible key-value pairs attached to either Products or Variants. This extensible model supports domain-specific metadata without schema changes. For books, common attributes include `PageCount`, `Author`, `ISBN` (ISBN-13 format), `Publisher`, `PublicationDate`, and `Language`. For general merchandise, attributes might include `Material`, `Warranty`, or `Dimensions`. Attribute keys are governed by a controlled vocabulary maintained by the catalogue operations team.

**Categories** are organized as a hierarchical tree supporting multi-category assignment. A product can belong to multiple categories simultaneously — for instance, a cookbook might appear under both "Books > Cooking" and "Home & Kitchen > Cookbooks." Category nodes store their position in the tree using a materialized path pattern, enabling efficient ancestor and descendant queries.

**Images** are referenced by URL, with binary assets stored in Azure Blob Storage and served through Cloudinary's CDN. Each image record captures the image type (primary, alternate, lifestyle, swatch), display sequence, alt text for accessibility, and both the Azure Blob Storage URI and the Cloudinary public ID.

## Elasticsearch 8 Index Design

Product search is powered by Elasticsearch 8, with the primary search index named `products-v3`. The versioned naming convention enables zero-downtime reindexing: a new index version (e.g., `products-v4`) is built in parallel, validated, and then swapped in via an alias update. The production alias `products-current` always points to the active index.

The index mapping is designed to balance search relevance with query performance. The `name` field is mapped as both `text` (for full-text search using the standard analyzer) and `keyword` (for exact-match filtering and aggregations). The `description` field uses the built-in `english` analyzer, which applies stemming and stop-word removal to improve recall for natural-language queries. The `categories` field uses a `nested` mapping to preserve the relationship between category level and category name, preventing false matches from cross-category terms. The `attributes` field is also `nested`, storing key-value pairs that can be filtered independently. The `price` field is a `scaled_float` with a scaling factor of 100, storing prices as integers internally for precision while presenting decimal values externally. Additional fields include `brand` (keyword), `availability` (keyword), `created_at` and `updated_at` (date), and `popularity_score` (float, sourced from Segment analytics).

Three custom analyzers are configured at the index level. The **standard analyzer** handles the `name` field with default tokenization. The **english analyzer** processes the `description` field with English-specific stemming. A **custom synonym analyzer** expands query terms using a managed synonyms dictionary — for example, mapping "laptop" to "notebook computer" or "HP" to "Hewlett-Packard."

Index settings are tuned for the catalogue's operational profile: 3 primary shards distribute the approximately 500,000 product documents across the cluster, with 1 replica shard per primary for fault tolerance. The refresh interval is set to 5 seconds under normal operation, providing near-real-time search visibility. During bulk reindexing operations, the refresh interval is temporarily increased to 30 seconds to optimize throughput.

## Azure Blob Storage and Cloudinary Integration

Product images are stored in the Azure Blob Storage container `acmeretail-product-images` within the Acme Retail production storage account. The blob naming convention follows the pattern `{productId}/{variantId}/{imageType}_{sequence}.{ext}`, where `imageType` is one of `primary`, `alternate`, `lifestyle`, or `swatch`, and `sequence` is a zero-padded two-digit integer (e.g., `01`, `02`).

Images uploaded to Blob Storage are automatically synchronized to Cloudinary via an Azure Function triggered by blob creation events. Cloudinary serves as the primary CDN for all customer-facing image delivery, providing on-the-fly transformations and global edge caching. The Cloudinary URL pattern follows the structure `https://res.cloudinary.com/acme-retail/image/upload/{transformation}/{public_id}.{format}`.

Four standard transformation presets are defined for consistent image rendering across all Acme Retail front-end applications:

| Preset | Dimensions | Use Case |
|---|---|---|
| `t_thumbnail` | 150 × 150 px | Search results, cart line items |
| `t_product_card` | 400 × 400 px | Category browsing, recommendation carousels |
| `t_product_detail` | 800 × 800 px | Product detail page, primary image |
| `t_zoom` | 1600 × 1600 px | Zoom overlay, high-resolution inspection |

All presets apply automatic format selection (`f_auto`) and quality optimization (`q_auto`) to minimize payload size without visible quality loss. If Cloudinary is unreachable, the front-end falls back to direct Azure Blob Storage URLs using a lower-resolution cached version.

## Algolia Search Fallback

To maintain search availability during Elasticsearch outages, the Product Catalogue Service implements a circuit breaker pattern that routes search traffic to Algolia as a secondary search backend. The circuit breaker trips after 5 consecutive Elasticsearch failures within a rolling 30-second window. Once tripped, all search queries are routed to Algolia for a cooldown period of 60 seconds, after which the circuit breaker transitions to a half-open state and probes Elasticsearch with a single test query before restoring normal routing.

The Algolia index is synchronized from Elasticsearch every 15 minutes via a scheduled Azure Function. Due to this synchronization interval, Algolia results may lag behind the primary index by up to 15 minutes during normal operation. Feature parity between the two backends is intentionally limited: Algolia supports basic keyword search and category/brand filtering, while advanced features such as personalized boosting, nested attribute filtering, and the synonym expansion pipeline are available only through Elasticsearch.

On the client side, the BookStore eCommerce front end uses InstantSearch.js configured to detect which backend is serving results. When the Algolia fallback is active, the UI suppresses advanced filter options that are not supported and displays a subtle notification indicating that search results may be limited.

## Catalog Import Pipeline

Product data enters the catalogue through two distinct pipelines optimized for different latency and volume requirements.

The **bulk import pipeline** runs nightly and is responsible for full catalogue synchronization from the legacy SQL Server product database. An SSIS package extracts product records, transforms them into the canonical JSON schema, and writes output files to an Azure Blob staging container. A .NET worker service then reads these files and performs a bulk index operation against Elasticsearch. The full catalogue of approximately 500,000 products completes indexing in roughly 45 minutes. This pipeline serves as the baseline, ensuring that any drift between the source system and the search index is corrected daily.

The **real-time pipeline** handles incremental updates via RabbitMQ events. The Product Catalogue Service publishes domain events — `ProductCreated`, `ProductUpdated`, `ProductDeleted`, and `PriceChanged` — to a dedicated RabbitMQ exchange. A consumer service subscribes to these events and applies individual document updates to the Elasticsearch index within seconds of the source change. This pipeline ensures that price adjustments, stock status changes, and new product launches are reflected in search results with minimal delay.

Both pipelines enforce validation at ingestion. Incoming data is validated against a JSON Schema definition that enforces required fields, data types, and value constraints. Additional data quality checks verify referential integrity (e.g., that category IDs exist in the category tree), flag anomalies (e.g., prices below cost thresholds), and reject duplicates. Validation failures are logged to a dead-letter queue for manual review.

Monitoring for the import pipeline is centralized in Grafana. Dashboards track bulk import duration, real-time event processing lag, document counts, and indexing error rates. An alert fires if the search index document count drops below 95% of the expected baseline or if the real-time consumer falls more than 5 minutes behind the RabbitMQ queue.

## Search Relevance Tuning

Search relevance is continuously tuned to align with customer intent and business objectives. The primary mechanism is field-level boosting applied at query time. The `name` field receives a boost factor of 3×, ensuring that exact product name matches rank highly. The `SKU` and `ISBN` fields receive a 10× boost, reflecting the expectation that a customer searching for a specific identifier wants an exact match. Products with `InStock` availability receive a 1.5× multiplicative boost to prioritize purchasable results.

A **synonyms dictionary**, managed as a version-controlled text file and deployed with each index update, expands query terms to improve recall. Synonyms cover brand abbreviations, common misspellings, and category-level equivalences. The dictionary is reviewed monthly by the Search & Discovery team in collaboration with the merchandising team.

**Faceted navigation** provides structured filtering across six dimensions: Category (hierarchical, reflecting the category tree), Brand, Price Range (predefined buckets), Availability, Rating (aggregated from the reviews service), and Author (for book products). Facet counts are computed using Elasticsearch aggregations and returned alongside search results.

**Autocomplete** is implemented using an edge n-gram tokenizer on the `name` and `brand` fields. As the user types, the autocomplete endpoint returns up to 8 suggestions with sub-100ms latency. Suggestions are weighted by the `popularity_score` field to surface trending products.

**Spell correction** uses the Elasticsearch phrase suggester, which analyzes the full query phrase and proposes corrections based on term frequency in the index. Corrections are presented as "Did you mean…?" suggestions in the UI rather than applied automatically, preserving user intent.

**Personalization** is achieved through the `popularity_score` field, which is updated daily from event data collected by Segment. The score reflects a weighted combination of page views, add-to-cart actions, and purchases over a rolling 30-day window. This score acts as a tiebreaker when multiple products share similar text relevance scores, ensuring that popular items surface higher in results.

For a detailed view of how the Product Catalogue Service fits within the broader Acme Retail platform, see the [Architecture Overview](../architecture/overview.md) and the [BookStore eCommerce Platform](bookstore-ecommerce.md) documentation.
