---
title: "Data Architecture, Analytics Pipeline & Governance"
---

# Data Architecture, Analytics Pipeline & Governance

This document provides a comprehensive reference for the Acme Retail data architecture — covering database topology, data flows, analytics infrastructure, quality controls, and privacy compliance. It is the authoritative source for any team interacting with data systems across the retail platform.

For the broader system context, see [System Landscape](../technical/system-landscape.md) and [Architecture Overview](../architecture/overview.md).

---

## 1. Data Architecture Overview

Acme Retail follows a **database-per-service** principle: every bounded-context microservice owns its dedicated database instance. No service is permitted to query another service's database directly. All cross-service data access occurs through published APIs, domain events on RabbitMQ, or materialized read projections.

This isolation delivers independent deployability, schema autonomy, and failure containment — at the cost of eventual consistency, which the platform manages through saga orchestration and compensating transactions.

### 1.1 Polyglot Persistence Strategy

Rather than standardizing on a single database engine, the platform selects the storage technology best suited to each service's access patterns:

| Technology | Services | Rationale |
|---|---|---|
| **SQL Server 2019** | BookStore, Payment | Legacy OLTP workloads with mature tooling. Strong transaction isolation required for financial operations. Existing DBA expertise and enterprise licensing. |
| **PostgreSQL 15** | Inventory, Fulfillment | Open-source licensing reduces cost. Native JSON/JSONB support for semi-structured logistics data. Extension ecosystem (PostGIS for warehouse geolocation, pg_cron for maintenance). |
| **MongoDB 7** | Loyalty | Flexible document schemas accommodate rapidly evolving loyalty programme structures — tiers, promotions, partner integrations — without migration overhead. |
| **Elasticsearch 8** | Product Catalogue | Full-text search, faceted navigation, fuzzy matching, and relevance tuning. Powers the primary product search and browse experience. |
| **Redis 7** | Session Cache, Recommendation Feature Store | Sub-millisecond latency for session state and pre-computed ML feature vectors. Used by the [Recommendation Engine](../technical/recommendation-engine.md). |
| **SQLite 3** | POS Terminals | Offline-first architecture for in-store point-of-sale. Each terminal maintains a local SQLite database that syncs to the cloud SQL Server instance when connectivity is available. |

### 1.2 Ownership Model

Every database has a single owning team responsible for its schema, operational health, backup verification, and capacity planning. The Data Platform team provides shared tooling (monitoring, backup infrastructure, provisioning automation) but does not own individual service databases.

---

## 2. Database Inventory

The table below is the canonical registry of all production database instances. It is maintained by the Data Platform team and reviewed quarterly.

| Database | Engine | Owning Team | Approx. Size | Backup Strategy | HA / Replication |
|---|---|---|---|---|---|
| **BookStore DB** | SQL Server 2019 | BookStore Team | ~250 GB | Full daily (02:00 PT) + differential hourly + transaction log every 15 min | Always On Availability Group — 2 synchronous replicas (primary in West US 2, secondary in East US) |
| **Payment DB** | SQL Server 2019 | Payments Team | ~80 GB | Full daily (02:00 PT) + differential hourly + transaction log every 15 min | Always On Availability Group — synchronous commit, automatic failover. See [PCI DSS Compliance](../security/pci-dss-compliance.md). |
| **Inventory DB** | PostgreSQL 15 | Platform Team | ~45 GB | Continuous WAL archiving to Azure Blob + daily base backup (03:00 PT) | Patroni HA cluster — 1 primary + 2 synchronous standby nodes |
| **Fulfillment DB** | PostgreSQL 15 | Platform Team | ~60 GB | Continuous WAL archiving to Azure Blob + daily base backup (03:30 PT) | Patroni HA cluster — 1 primary + 2 synchronous standby nodes |
| **Loyalty DB** | MongoDB 7 | Loyalty Team | ~35 GB | Continuous oplog tailing + daily `mongodump` to Azure Blob (04:00 PT) | Replica set — 3 members (1 primary, 2 secondaries) across 2 availability zones |
| **Product Index** | Elasticsearch 8 | Search & Discovery Team | ~25 GB | Daily snapshot to Azure Blob Storage (05:00 PT), retained 30 days | 3-node cluster — 1 dedicated master-eligible, 2 data nodes. Index replicas = 1. |
| **Cache / Feature Store** | Redis 7 | Platform / ML Team | ~12 GB | AOF persistence + RDB snapshot hourly, replicated to Azure Blob | Redis Sentinel — 1 primary + 2 replicas with automatic failover |
| **POS Local** | SQLite 3 | Platform Team | ~500 MB per terminal | Cloud sync to BookStore SQL Server via background service (every 5 min when online; queued when offline) | No local HA — terminal data is transient; source of truth is the cloud SQL Server after sync. |

### 2.1 Backup Verification

All backups are verified on a weekly cycle. An automated pipeline restores each backup to an isolated environment, runs a checksum comparison against the source, and validates row counts for critical tables. Failures trigger a P2 PagerDuty incident assigned to the owning team.

### 2.2 Capacity Planning

Database size is tracked in Grafana. Alerts fire when any database reaches 75% of provisioned storage. The Data Platform team conducts quarterly capacity reviews to project growth and right-size instances. Historical growth rates are stored in Snowflake for trend analysis.

---

## 3. Data Flows

The following diagrams illustrate the primary data flows across the platform. For the full event-driven architecture, see [Architecture Overview](../architecture/overview.md).

### 3.1 Purchase Event Flow

This flow is triggered when a customer completes a purchase through any channel (web, mobile, or POS).

```
┌──────────┐
│ Customer │
└────┬─────┘
     │ places order
     ▼
┌──────────────┐    OrderPlaced event     ┌─────────────────┐
│  BookStore   │ ──────────────────────► │   RabbitMQ      │
│  Service     │                         │   (orders.placed │
└──────────────┘                         │    exchange)     │
                                         └───────┬─────────┘
                        ┌────────────────────────┼────────────────────────┐
                        │                        │                        │
                        ▼                        ▼                        ▼
               ┌────────────────┐    ┌───────────────────┐    ┌──────────────────┐
               │  Inventory     │    │  Payment          │    │  Fulfillment     │
               │  Service       │    │  Service          │    │  Service         │
               │  (PostgreSQL)  │    │  (SQL Server)     │    │  (PostgreSQL)    │
               └────────────────┘    └───────────────────┘    └──────────────────┘
                        │                        │                        │
                        ▼                        ▼                        ▼
               Stock decremented       Payment captured         Shipment created
                        │                        │
                        ▼                        ▼
               ┌────────────────┐    ┌───────────────────┐
               │  Loyalty       │    │  Segment          │
               │  Service       │    │  (analytics)      │
               │  (MongoDB)     │    │                   │
               └────────────────┘    └───────────────────┘
               Points accrued         Purchase event tracked
```

Each consumer processes the event independently. If a downstream service is unavailable, RabbitMQ retries with exponential backoff (max 3 retries, then dead-letter queue). The dead-letter queue is monitored and manually reprocessed by the owning team.

### 3.2 Product Data Flow

Product information originates in the Product Catalogue service and fans out to multiple consumers.

```
┌──────────────────────┐
│  Product Catalogue   │
│  (source of truth)   │
└──────────┬───────────┘
           │  ProductUpdated event (RabbitMQ)
           │
     ┌─────┼──────────────┬──────────────────┬───────────────────┐
     │     │              │                  │                   │
     ▼     ▼              ▼                  ▼                   ▼
┌────────┐ ┌───────────┐ ┌───────────────┐ ┌──────────────┐ ┌──────────────────┐
│Elastic │ │ Algolia   │ │ BookStore     │ │ POS Terminals│ │ Recommendation   │
│search  │ │ (backup   │ │ Redis Cache   │ │ (SQLite)     │ │ Engine           │
│Index   │ │  search)  │ │ (TTL: 30min)  │ │              │ │ (Redis features) │
└────────┘ └───────────┘ └───────────────┘ └──────────────┘ └──────────────────┘
 real-time   15-min sync    event-driven      daily batch       nightly batch
                                              (03:00 PT)        (02:00 PT)
```

- **Elasticsearch** receives updates in near real-time via a dedicated consumer.
- **Algolia** is synchronised every 15 minutes as a fallback search provider (used for autocomplete and mobile).
- **BookStore Redis Cache** is invalidated on each `ProductUpdated` event and lazily repopulated.
- **POS terminals** receive a full product catalogue snapshot daily at 03:00 PT, compressed and pushed via the POS sync service.
- **Recommendation Engine** ingests product metadata nightly into its Redis feature store. See [Recommendation Engine](../technical/recommendation-engine.md).

### 3.3 Customer Data Flow

Customer profile data flows from the BookStore service to downstream systems.

```
┌──────────────────┐
│  BookStore       │
│  (Customer DB)   │
└────────┬─────────┘
         │  CustomerUpdated / CustomerRegistered events
         │
    ┌────┼───────────────┬──────────────────┐
    │    │               │                  │
    ▼    ▼               ▼                  ▼
┌──────────┐  ┌──────────────────┐  ┌─────────────┐
│ Loyalty  │  │ Recommendation   │  │  Segment    │
│ Service  │  │ Engine           │  │  (CDP)      │
│(MongoDB) │  │ (Redis features) │  └──────┬──────┘
└──────────┘  └──────────────────┘         │
                                           ▼
                                    ┌─────────────┐
                                    │  SendGrid   │
                                    │  (email)    │
                                    └─────────────┘
```

- **Segment** acts as the Customer Data Platform (CDP), unifying customer identity across web, mobile, and in-store channels. Segment Personas resolves anonymous visitors to known customer profiles.
- **SendGrid** receives audience segments from Segment for transactional and marketing email campaigns.

---

## 4. Analytics Pipeline

The analytics pipeline transforms raw operational data into business intelligence assets. It follows the modern data stack pattern: collect → warehouse → transform → serve.

### 4.1 Event Collection — Segment

All customer-facing events are collected through [Segment](https://segment.com):

| SDK | Environment | Deployment |
|---|---|---|
| **Analytics.js** | Web (React 18 storefront) | Bundled via npm, loaded asynchronously. Page-level tracking auto-enabled. |
| **.NET SDK** | Server-side (BookStore, Payment, Fulfillment) | Installed via NuGet. Used for server-side purchase confirmation, refund, and fulfilment events. |
| **Node.js SDK** | Server-side (Recommendation, Search) | Used for tracking recommendation impressions and search analytics. |

**Tracked Events:**

- `Page Viewed` — every storefront page load
- `Product Viewed` — product detail page
- `Product Added` — add-to-cart
- `Checkout Started` — checkout initiation
- `Order Completed` — purchase confirmation (server-side, authoritative)
- `Products Searched` — search queries and result counts
- `Loyalty Points Earned` / `Loyalty Points Redeemed` — loyalty programme interactions

**Identity Resolution:** Segment Personas performs cross-device identity stitching using email, customer ID, and anonymous ID. The resolved identity graph feeds into Snowflake for analytics and back into Segment for audience building.

### 4.2 Data Warehouse — Snowflake

Snowflake on Azure (West US 2 region) serves as the central analytical data store.

**Ingestion Paths:**

| Source | Connector | Destination Schema | Frequency |
|---|---|---|---|
| Segment events | Segment Warehouses | `RAW_EVENTS` | Near real-time (~5 min) |
| BookStore DB (SQL Server) | Fivetran | `RAW_BOOKSTORE` | Every 6 hours |
| Payment DB (SQL Server) | Fivetran | `RAW_PAYMENT` | Every 6 hours |
| Inventory DB (PostgreSQL) | Fivetran | `RAW_INVENTORY` | Every 6 hours |
| Loyalty DB (MongoDB) | Fivetran | `RAW_LOYALTY` | Every 6 hours |

**Compute Warehouses:**

- **`ETL_WH`** (X-Large) — used by dbt transformations and Fivetran loads. Auto-suspends after 5 minutes of inactivity.
- **`BI_WH`** (Medium) — used by Tableau, Looker, and ad-hoc analyst queries. Auto-suspends after 10 minutes.
- **`ML_WH`** (Large) — used by the ML team for model training queries. Scheduled availability (08:00–20:00 PT weekdays).

### 4.3 Transformation — dbt Cloud

All transformation logic lives in the `acme-retail-dbt` repository and runs on dbt Cloud.

**Model Layers:**

| Layer | Prefix | Examples | Purpose |
|---|---|---|---|
| **Staging** | `stg_` | `stg_orders`, `stg_products`, `stg_customers`, `stg_inventory_snapshots`, `stg_loyalty_events` | 1:1 with source tables. Renaming, type casting, basic filtering. |
| **Intermediate** | `int_` | `int_order_items_enriched`, `int_customer_activity`, `int_product_performance_daily` | Business logic joins and enrichments. Not exposed to BI tools. |
| **Marts** | `mart_` | `mart_sales_performance`, `mart_customer_ltv`, `mart_inventory_forecast`, `mart_recommendation_effectiveness`, `mart_search_quality` | Consumer-ready datasets. One mart per business domain. |

**Run Schedule (all times Pacific):**

| Run | Time | Models | Purpose |
|---|---|---|---|
| Morning full | 06:00 | All staging + intermediate + marts | Refresh overnight data for morning dashboards |
| Midday incremental | 12:00 | Staging (incremental) + marts | Catch midday data updates |
| Evening incremental | 18:00 | Staging (incremental) + marts | End-of-day reporting refresh |
| Nightly full | 00:00 | Full build + snapshot models | Complete rebuild, SCD Type 2 snapshots |

**Quality Gates:** Every dbt run executes schema tests (not null, unique, accepted values, relationships) and source freshness checks. A failing test blocks downstream models and alerts the Data Platform team via Slack and PagerDuty.

### 4.4 Dashboards and BI

| Tool | Primary Audience | Use Cases | Data Source |
|---|---|---|---|
| **Tableau Server** | Executive leadership, Merchandising | Revenue dashboards, category performance, regional sales, inventory aging | Snowflake marts via live connection |
| **Looker** | Product, Marketing, Growth | Funnel analysis, cohort retention, campaign attribution, search analytics | Snowflake marts via LookML models |

Both tools connect exclusively to Snowflake mart tables via the `BI_WH` compute warehouse. Direct database connections are prohibited.

---

## 5. Key Analytics Use Cases

| Use Case | Data Sources | Output | Primary Consumer |
|---|---|---|---|
| **Sales Performance** | `mart_sales_performance` (orders, products, regions) | Daily/weekly/monthly revenue, AOV, units sold, category mix | Executive team (Tableau) |
| **Inventory Forecasting** | `mart_inventory_forecast` (sales velocity, stock levels, lead times, seasonality) | 30/60/90-day demand forecast per SKU per warehouse | Merchandising team (Tableau), Inventory Service API |
| **Customer Lifetime Value** | `mart_customer_ltv` (order history, loyalty, engagement, acquisition channel) | Predicted 12-month LTV per customer segment | Marketing (Looker), Segment audiences |
| **Recommendation Effectiveness** | `mart_recommendation_effectiveness` (impressions, clicks, conversions by algorithm variant) | CTR, conversion rate, revenue lift per recommendation slot | Product team (Looker), ML team |
| **Search Quality** | `mart_search_quality` (queries, results, clicks, zero-result rate, refinement rate) | Search relevance score, zero-result queries, popular query trends | Search & Discovery team (Looker) |
| **Loyalty Programme Health** | `mart_customer_ltv` + Loyalty DB | Points earn/burn ratio, tier migration, redemption patterns, programme ROI | Loyalty team (Tableau) |

---

## 6. Data Quality Monitoring

### 6.1 Framework — Great Expectations

[Great Expectations](https://greatexpectations.io) is integrated into the dbt pipeline via the `dbt-expectations` package. Tests run as part of every dbt invocation.

**Test Categories:**

| Category | Examples | Failure Severity |
|---|---|---|
| **Schema Validation** | Column existence, data types, allowed enum values | P1 — blocks pipeline |
| **Freshness** | Source data must be < 4 hours old at run time | P2 — alerts on-call |
| **Volume** | Row counts within ±20% of trailing 7-day average | P2 — alerts on-call |
| **Uniqueness / Null** | Primary key uniqueness, NOT NULL on required fields | P1 — blocks pipeline |
| **Custom Business Rules** | Order total > 0, ship date ≥ order date, loyalty points ≥ 0 | P1 — blocks pipeline |

### 6.2 Alerting and Observability

- **PagerDuty**: P1 failures page the on-call Data Platform engineer. P2 failures create a PagerDuty alert (no page) during business hours.
- **Slack**: All test results post to `#data-quality-alerts`. Failures are threaded for discussion.
- **Grafana Dashboard**: The "Data Quality" dashboard displays test pass/fail rates over time, freshness lag per source, and volume anomaly trends. Updated after every dbt run.

### 6.3 Data Lineage

dbt generates a full lineage graph (DAG) on every run. This graph is published to dbt Cloud's documentation site, accessible to all engineering and analytics teams. It traces every mart column back to its source system, enabling impact analysis before schema changes.

---

## 7. PII Handling and Data Privacy

Acme Retail processes personal data across multiple jurisdictions (US, EU, UK, Canada) and is subject to GDPR, CCPA, and PCI DSS. This section outlines the technical and procedural controls.

For payment-specific compliance, see [PCI DSS Compliance](../security/pci-dss-compliance.md) and [Payment Module](../technical/payment-module.md).

### 7.1 Encryption

- **At Rest**: All databases use AES-256 encryption at rest. SQL Server uses Transparent Data Encryption (TDE). PostgreSQL uses LUKS-encrypted volumes. MongoDB uses encrypted storage engine. Snowflake uses platform-managed encryption.
- **In Transit**: All inter-service communication uses TLS 1.2+. Database connections require TLS.
- **Column-Level Encryption**: The Payment DB applies column-level encryption (Always Encrypted in SQL Server) to SSN fields stored for tax-reporting purposes. Credit card numbers are **never** stored — all card processing is delegated to the payment gateway (Stripe), and only tokenised references are persisted.

### 7.2 Dynamic Data Masking

All non-production environments (staging, QA, development) use dynamic data masking applied during the Fivetran replication to Snowflake non-prod:

| Field | Masking Rule |
|---|---|
| Email | `j***@***.com` |
| Phone | `***-***-1234` (last 4 digits preserved) |
| Full Name | `J*** D**` (first letter preserved) |
| Address | Fully redacted |
| SSN | Fully redacted |

Production Snowflake access is governed by role-based access control (RBAC). Only the `PII_ANALYST` role can query unmasked PII columns, and this role requires annual re-certification.

### 7.3 GDPR Compliance

| Right | Implementation |
|---|---|
| **Right to Access (Article 15)** | Automated JSON export via the Customer Portal. The system aggregates data from BookStore, Loyalty, Segment, and Snowflake into a single downloadable archive within 48 hours. |
| **Right to Erasure (Article 17)** | Automated anonymisation workflow triggered from the admin panel. Propagates to all systems: BookStore DB (anonymise PII fields), Loyalty DB (anonymise), Segment (user suppression + deletion), Snowflake (anonymise in staging/mart layers, retain aggregate metrics), SendGrid (suppress), Redis (evict). Completed within 30 days per regulation. |
| **Consent Management** | OneTrust CMP integrated into the storefront and email preference centre. Consent signals are passed to Segment as user traits and respected by all downstream destinations. |
| **Data Processing Records (Article 30)** | Maintained in OneTrust. Reviewed quarterly by the Privacy team. Covers all processing activities, legal bases, data categories, and retention periods. |

### 7.4 Data Retention Policy

| Data Category | Retention Period | After Expiry | Legal Basis |
|---|---|---|---|
| **Order Records** | 7 years | Moved to cold storage (Azure Archive Blob), then purged after 10 years | Tax and financial regulatory requirements |
| **Customer PII** | Until deletion request or 5 years after last activity | Anonymised — hashed identifiers retained for aggregate analytics | Legitimate interest / consent |
| **Payment Tokens** | 7 years | Purged (hard delete from Payment DB and all backups within 90 days) | PCI DSS and financial regulatory requirements |
| **Analytics Events** | 3 years (raw) | Raw events deleted; pre-computed aggregates retained indefinitely | Legitimate interest |
| **Application Logs** | 90 days hot (Azure Log Analytics) → 1 year cold (Azure Archive) | Deleted | Operational necessity |
| **Backup Archives** | Aligned with source data retention | Purged on same schedule as source data | Mirrors source |

Retention enforcement is automated via Azure Lifecycle Management policies for blob storage and scheduled database jobs for transactional systems. The Data Platform team audits retention compliance monthly.

---

## References

- [System Landscape](../technical/system-landscape.md) — high-level service topology
- [Architecture Overview](../architecture/overview.md) — microservices architecture and patterns
- [Payment Module](../technical/payment-module.md) — payment processing and tokenisation
- [PCI DSS Compliance](../security/pci-dss-compliance.md) — payment security controls
- [Recommendation Engine](../technical/recommendation-engine.md) — ML pipeline and feature store
