---
title: "ADR-002 Event-Driven Inventory Architecture"
---

# ADR-002: Event-Driven Architecture for Inventory Data Propagation

- **Status:** Accepted
- **Date:** 2020-09-18
- **Deciders:** David Park (Principal Architect), Lena Kowalski (Engineering Manager — Platform), Amir Hassan (Senior Engineer — Inventory), Rachel Torres (Senior Engineer — Fulfillment)

## Context

Following the extraction of Inventory Management from the BookStore monolith (see [ADR-001](ADR-001-microservices-extraction.md)), inventory data needs to propagate in near-real-time to multiple consumers across the Acme Retail platform:

- **BookStore** — Displays stock availability on product detail pages and enforces stock checks during checkout.
- **POS (Point-of-Sale)** — Shows in-store stock levels for associates and enables reserve-for-pickup flows.
- **Order Fulfillment** — Requires stock level awareness for pick/pack planning and warehouse allocation decisions.
- **Recommendation Engine** — Filters out-of-stock products from recommendation results to avoid poor customer experience.

During the initial extraction phase, consumers retrieved inventory data by polling the Inventory Service's REST API. This approach introduced several problems:

1. **N+1 query pattern** — The BookStore product listing page displayed stock status for 48 products per page. Each page render triggered 48 individual HTTP calls to the Inventory Service `/stock/{sku}` endpoint. Under load, this amplified to thousands of requests per second during peak browsing periods.

2. **Stale data** — Consumers that cached stock levels to reduce API call volume frequently displayed outdated information. Customers encountered "in stock" products that were actually unavailable, leading to cart abandonment and support tickets. The staleness window averaged 30–90 seconds depending on the consumer's cache TTL.

3. **Tight coupling** — Every new consumer of inventory data required the Inventory Service team to provision API credentials, manage rate limits, and monitor additional traffic. Adding the Recommendation Engine as a consumer required a coordination effort across three teams.

4. **Failure cascading** — When the Inventory Service experienced elevated latency during a warehouse bulk-import operation, the BookStore product pages degraded because they depended on synchronous responses from Inventory for stock badges.

## Decision

We will adopt **RabbitMQ** as the event broker for inventory data propagation. The Inventory Management Service will publish domain events to RabbitMQ topic exchanges, and consumers will subscribe to the event streams they need.

### Event Definitions

| Event | Payload Summary | Published When |
|---|---|---|
| `StockUpdated` | `{ sku, warehouseId, previousQty, newQty, reason, timestamp }` | Any stock level change (receipt, sale, adjustment, transfer) |
| `LowStockAlert` | `{ sku, warehouseId, currentQty, reorderThreshold, timestamp }` | Stock falls below configured reorder threshold |
| `ReorderTriggered` | `{ sku, warehouseId, reorderQty, supplierId, purchaseOrderId, timestamp }` | Automatic reorder process initiated |

### Exchange and Routing Configuration

- **Exchange:** `inventory.events` (topic exchange)
- **Routing keys:** `inventory.stock.updated`, `inventory.stock.low`, `inventory.reorder.triggered`
- **Consumer queues:** Each consumer team owns its queue (e.g., `bookstore.inventory.stock-updates`, `fulfillment.inventory.low-stock`). Queue bindings use routing key patterns to select relevant events.
- **Dead-letter exchange:** `inventory.events.dlx` — Failed messages are routed here after three retry attempts with exponential backoff. The operations team monitors the dead-letter queue via Grafana alerts.

### Consumer Responsibilities

Each consumer must implement:

1. **Idempotent processing** — Events carry a unique `eventId` (UUID). Consumers must deduplicate using this identifier to handle at-least-once delivery semantics safely.
2. **Local projection** — Consumers maintain a local read-optimized projection of the inventory data they need (e.g., BookStore stores a `product_stock_cache` table in its SQL Server database). This projection is updated on event receipt and queried for display.
3. **Graceful degradation** — If the event stream is temporarily unavailable, consumers fall back to their last known projection and display a "stock information may be delayed" indicator where appropriate.

## Consequences

### Positive

- **Decoupled consumers** — New consumers can subscribe to inventory events without requiring changes to the Inventory Service. The Recommendation Engine was onboarded in under two days by creating a new queue and binding.
- **Near-real-time propagation** — Events are delivered within milliseconds of being published. The average end-to-end latency from stock change to consumer projection update is under 200ms, well within the 500ms SLA.
- **Eliminated N+1 queries** — BookStore no longer calls the Inventory API per-product. Instead, it reads from its local `product_stock_cache` table, reducing product page latency by 40%.
- **Audit trail** — All stock movement events are persisted in the Inventory Service's event store (event sourcing). This provides a complete, queryable history of every stock change for compliance, dispute resolution, and analytics.
- **Failure isolation** — A slow or unavailable consumer does not affect the Inventory Service or other consumers. RabbitMQ buffers messages in the consumer's queue until it recovers.

### Negative

- **At-least-once delivery** — RabbitMQ guarantees at-least-once delivery but not exactly-once. All consumers must implement idempotent message handling, which adds development and testing complexity. The team created a shared `IdempotentConsumer<T>` base class in the `Acme.Messaging` NuGet package to standardize this pattern.
- **Message ordering** — RabbitMQ does not guarantee strict ordering across multiple queue consumers. For most inventory events, this is acceptable (the latest `StockUpdated` event carries the absolute current quantity). For scenarios requiring ordering (e.g., sequential stock adjustments for reconciliation), the Inventory Service includes a monotonic sequence number per SKU that consumers can use to detect and resolve out-of-order delivery.
- **Operational overhead** — RabbitMQ is a stateful clustered service that requires monitoring, capacity planning, and maintenance (upgrades, certificate rotation, queue depth monitoring). The Platform team owns RabbitMQ operations, with PagerDuty alerting on cluster health, queue depth thresholds, and consumer lag.
- **Eventual consistency** — There is a brief window (typically < 500ms) where consumers may display stale stock data. For checkout stock validation, BookStore performs a synchronous stock reservation call to the Inventory Service as a final consistency check before confirming the order.

## Alternatives Considered

### Alternative 1: Apache Kafka

Kafka was evaluated as the event streaming platform. It offers stronger ordering guarantees (per-partition), log compaction for state reconstruction, and higher throughput for very high-volume event streams.

**Rejected because:** Kafka's operational complexity exceeded our team's capacity at the time of the decision. The Platform team (three engineers) did not have Kafka production experience, and the managed Azure offering (Event Hubs for Kafka) introduced limitations that would require workarounds. Our event volume (~50,000 events/hour at peak) is well within RabbitMQ's capacity. We will re-evaluate Kafka if event volumes grow by 10x or if we adopt event streaming patterns (e.g., stream processing with materialized views) that Kafka handles more naturally.

### Alternative 2: Azure Service Bus

Azure Service Bus was evaluated as a cloud-native alternative that would eliminate the need to operate message broker infrastructure.

**Rejected because:** The team prioritized avoiding vendor lock-in at the messaging layer. Inventory events are a core architectural primitive, and coupling them to a specific cloud provider's messaging service would constrain future infrastructure decisions. RabbitMQ runs on AKS using the official Helm chart and can be migrated to any Kubernetes environment. Additionally, Azure Service Bus pricing at our projected message volume was approximately 3x the cost of self-managed RabbitMQ on existing AKS infrastructure.
