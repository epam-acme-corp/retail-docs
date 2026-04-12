---
title: "Event Schemas — RabbitMQ Event Catalog"
---

# Event Schemas — RabbitMQ Event Catalog

Acme Retail uses RabbitMQ as the central message broker for asynchronous communication between services. All events follow the [CloudEvents v1.0 specification](https://cloudevents.io/) and are published as JSON messages. This document is the authoritative catalog of every event type, its routing configuration, and its payload schema.

For the broader architecture context, see [Architecture Overview](../architecture/overview.md) and [ADR-002](../architecture/adr-002-api-versioning-strategy.md). Individual service documentation is linked from the event descriptions below.

---

## Event Catalog

The following table lists every event published and consumed across the Acme Retail platform.

| Event Type | Exchange | Routing Key | Publisher | Consumers | Retry Policy |
|---|---|---|---|---|---|
| `order.placed` | `orders.events` | `order.placed` | BookStore | Fulfillment, Inventory, Loyalty, Segment | 3 retries — exponential back-off: 1 s → 5 s → 25 s |
| `order.confirmed` | `orders.events` | `order.confirmed` | Fulfillment | BookStore, Segment | 3 retries — 1 s / 5 s / 25 s |
| `order.shipped` | `orders.events` | `order.shipped` | Fulfillment | BookStore, Segment | 3 retries — 1 s / 5 s / 25 s |
| `order.delivered` | `orders.events` | `order.delivered` | Fulfillment | BookStore, Loyalty, Segment | 3 retries — 1 s / 5 s / 25 s |
| `stock.updated` | `inventory.events` | `stock.updated.{warehouseId}` | Inventory | BookStore, POS, Product Catalogue | 3 retries — 1 s / 5 s / 25 s |
| `stock.low` | `inventory.events` | `stock.low.{warehouseId}` | Inventory | Procurement, Email Service | 3 retries — 1 s / 5 s / 25 s |
| `price.changed` | `catalog.events` | `price.changed.{productId}` | Product Catalogue | BookStore, POS | 3 retries — 1 s / 5 s / 25 s |
| `customer.registered` | `customers.events` | `customer.registered` | BookStore | Loyalty, Segment, SendGrid | 5 retries — 1 s / 5 s / 25 s / 125 s / 625 s |
| `points.earned` | `loyalty.events` | `points.earned.{memberId}` | Loyalty | BookStore, Segment | 3 retries — 1 s / 5 s / 25 s |

### Exchange Configuration

All exchanges are declared as **topic exchanges** with `durable: true`. Consumers bind queues using routing-key patterns — for example, `stock.updated.*` to receive stock updates from all warehouses, or `stock.updated.wh-east-01` to receive updates from a single warehouse.

---

## CloudEvents Envelope

Every message published to RabbitMQ conforms to the CloudEvents v1.0 structured content mode. The outer envelope carries metadata; business data is nested inside the `data` field.

```json
{
  "specversion": "1.0",
  "type": "com.acmeretail.order.placed",
  "source": "/services/bookstore",
  "id": "evt_550e8400-e29b-41d4-a716-446655440000",
  "time": "2025-03-15T09:35:00.000Z",
  "datacontenttype": "application/json",
  "data": {
    "...payload fields..."
  }
}
```

| Field | Type | Description |
|---|---|---|
| `specversion` | string | Always `"1.0"` |
| `type` | string | Fully-qualified event type, e.g., `com.acmeretail.order.placed` |
| `source` | string | URI path identifying the publishing service |
| `id` | string | Globally unique event identifier (UUID v4, prefixed with `evt_`) |
| `time` | string (ISO 8601) | Timestamp when the event was produced |
| `datacontenttype` | string | Always `"application/json"` |
| `data` | object | Business payload — schema varies by event type (see below) |

---

## Payload Schemas

### order.placed

Published by the BookStore service when a customer's payment is successfully captured and an order is created. This is the trigger for the entire fulfillment pipeline. See [BookStore eCommerce](../technical/bookstore-ecommerce.md) and [Payment Module](../technical/payment-module.md) for upstream context.

```json
{
  "specversion": "1.0",
  "type": "com.acmeretail.order.placed",
  "source": "/services/bookstore",
  "id": "evt_550e8400-e29b-41d4-a716-446655440000",
  "time": "2025-03-15T09:35:00.000Z",
  "datacontenttype": "application/json",
  "data": {
    "orderId": "ord_550e8400",
    "customerId": "cust_9b1deb4d",
    "loyaltyMemberId": "loy_3c44dc24",
    "items": [
      {
        "productId": "prod_8f14e45f",
        "variantId": "var_001",
        "sku": "BK-GG-PB-001",
        "title": "The Great Gatsby",
        "quantity": 3,
        "unitPrice": 12.99,
        "lineTotal": 38.97
      }
    ],
    "shippingAddress": {
      "fullName": "Jane Doe",
      "line1": "742 Evergreen Terrace",
      "line2": "Apt 3B",
      "city": "Springfield",
      "state": "IL",
      "postalCode": "62704",
      "country": "US"
    },
    "deliveryMethod": "standard",
    "subtotal": 38.97,
    "discount": -5.00,
    "loyaltyDiscount": -2.50,
    "shippingCost": 4.99,
    "taxAmount": 2.91,
    "total": 39.37,
    "currency": "USD",
    "paymentReference": "pi_3PqRsT2eZvKYl2qF",
    "loyaltyPointsRedeemed": 500,
    "promoCode": "SPRING2025",
    "placedAt": "2025-03-15T09:35:00.000Z"
  }
}
```

**Field Reference — `data` object**:

| Field | Type | Required | Description |
|---|---|---|---|
| `orderId` | string | Yes | Unique order identifier |
| `customerId` | string | Yes | Customer account identifier |
| `loyaltyMemberId` | string | No | Loyalty programme member ID, if enrolled |
| `items` | array | Yes | One or more line items |
| `items[].productId` | string | Yes | Product identifier |
| `items[].variantId` | string | Yes | Product variant (format, edition) |
| `items[].sku` | string | Yes | Stock-keeping unit for warehouse picking |
| `items[].title` | string | Yes | Human-readable product title |
| `items[].quantity` | integer | Yes | Quantity ordered (≥ 1) |
| `items[].unitPrice` | number | Yes | Price per unit in order currency |
| `items[].lineTotal` | number | Yes | quantity × unitPrice |
| `shippingAddress` | object | Yes | Delivery destination |
| `deliveryMethod` | string | Yes | `standard`, `express`, or `next_day` |
| `subtotal` | number | Yes | Sum of all line totals before discounts |
| `discount` | number | No | Promo-code discount (negative value) |
| `loyaltyDiscount` | number | No | Loyalty-points discount (negative value) |
| `shippingCost` | number | Yes | Shipping charge |
| `taxAmount` | number | Yes | Calculated tax |
| `total` | number | Yes | Final amount charged |
| `currency` | string | Yes | ISO 4217 currency code |
| `paymentReference` | string | Yes | Stripe PaymentIntent ID |
| `loyaltyPointsRedeemed` | integer | No | Points redeemed for this order |
| `promoCode` | string | No | Applied promotional code |
| `placedAt` | string (ISO 8601) | Yes | Timestamp of order placement |

### stock.updated

Published by the Inventory Management service whenever the available quantity of a product changes at a specific warehouse — whether due to a sale, restock, or inventory adjustment. See [Inventory Management](../technical/inventory-management.md).

```json
{
  "specversion": "1.0",
  "type": "com.acmeretail.stock.updated",
  "source": "/services/inventory",
  "id": "evt_6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "time": "2025-03-15T10:12:00.000Z",
  "datacontenttype": "application/json",
  "data": {
    "productId": "prod_8f14e45f",
    "variantId": "var_001",
    "sku": "BK-GG-PB-001",
    "warehouseId": "wh-east-01",
    "warehouseName": "East Coast Distribution Center",
    "previousQuantity": 150,
    "newQuantity": 147,
    "changeReason": "order_fulfilled",
    "referenceId": "ord_550e8400",
    "updatedAt": "2025-03-15T10:12:00.000Z"
  }
}
```

**Field Reference — `data` object**:

| Field | Type | Required | Description |
|---|---|---|---|
| `productId` | string | Yes | Product identifier |
| `variantId` | string | Yes | Variant identifier |
| `sku` | string | Yes | Stock-keeping unit |
| `warehouseId` | string | Yes | Warehouse location code |
| `warehouseName` | string | Yes | Human-readable warehouse name |
| `previousQuantity` | integer | Yes | Quantity before this change |
| `newQuantity` | integer | Yes | Quantity after this change |
| `changeReason` | string | Yes | One of: `order_fulfilled`, `restock`, `manual_adjustment`, `return_received`, `damaged` |
| `referenceId` | string | No | Related entity ID (e.g., order ID, PO number) |
| `updatedAt` | string (ISO 8601) | Yes | Timestamp of the stock change |

### price.changed

Published by the Product Catalogue service when a product's price is updated. Consumers (BookStore storefront, POS terminals) use this event to refresh cached pricing. See [Product Catalogue](../technical/product-catalogue.md).

```json
{
  "specversion": "1.0",
  "type": "com.acmeretail.price.changed",
  "source": "/services/catalog",
  "id": "evt_f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "time": "2025-03-15T08:00:00.000Z",
  "datacontenttype": "application/json",
  "data": {
    "productId": "prod_8f14e45f",
    "variantId": "var_001",
    "sku": "BK-GG-PB-001",
    "previousPrice": 14.99,
    "newPrice": 12.99,
    "currency": "USD",
    "reason": "promotional_markdown",
    "effectiveFrom": "2025-03-15T08:00:00.000Z",
    "effectiveUntil": "2025-04-15T07:59:59.000Z",
    "changedBy": "pricing-engine"
  }
}
```

**Field Reference — `data` object**:

| Field | Type | Required | Description |
|---|---|---|---|
| `productId` | string | Yes | Product identifier |
| `variantId` | string | Yes | Variant identifier |
| `sku` | string | Yes | Stock-keeping unit |
| `previousPrice` | number | Yes | Price before change |
| `newPrice` | number | Yes | Price after change |
| `currency` | string | Yes | ISO 4217 currency code |
| `reason` | string | Yes | One of: `promotional_markdown`, `cost_increase`, `competitive_adjustment`, `seasonal`, `clearance` |
| `effectiveFrom` | string (ISO 8601) | Yes | When the new price takes effect |
| `effectiveUntil` | string (ISO 8601) | No | When the price reverts (null if permanent) |
| `changedBy` | string | Yes | Identifier of the actor or system that made the change |

### points.earned

Published by the Loyalty Platform when loyalty points are credited to a member's account — typically after an order is delivered. See [Loyalty Platform](../technical/loyalty-platform.md).

```json
{
  "specversion": "1.0",
  "type": "com.acmeretail.points.earned",
  "source": "/services/loyalty",
  "id": "evt_1c4e5f6a-7b8c-9d0e-1f2a-3b4c5d6e7f8a",
  "time": "2025-03-20T15:00:00.000Z",
  "datacontenttype": "application/json",
  "data": {
    "memberId": "loy_3c44dc24",
    "customerId": "cust_9b1deb4d",
    "orderId": "ord_550e8400",
    "pointsEarned": 39,
    "pointsBalance": 4359,
    "tier": "gold",
    "earnRule": "standard_purchase",
    "multiplier": 1.0,
    "orderTotal": 39.37,
    "currency": "USD",
    "earnedAt": "2025-03-20T15:00:00.000Z"
  }
}
```

**Field Reference — `data` object**:

| Field | Type | Required | Description |
|---|---|---|---|
| `memberId` | string | Yes | Loyalty programme member identifier |
| `customerId` | string | Yes | Associated customer account ID |
| `orderId` | string | No | Order that triggered the earning (null for bonus awards) |
| `pointsEarned` | integer | Yes | Points credited in this transaction |
| `pointsBalance` | integer | Yes | Updated total points balance after credit |
| `tier` | string | Yes | Current loyalty tier: `bronze`, `silver`, `gold`, `platinum` |
| `earnRule` | string | Yes | Rule that triggered the earn: `standard_purchase`, `bonus_promotion`, `referral`, `tier_bonus` |
| `multiplier` | number | Yes | Points multiplier applied (1.0 = standard; higher during promotions) |
| `orderTotal` | number | No | Order total that points were calculated from |
| `currency` | string | No | Order currency |
| `earnedAt` | string (ISO 8601) | Yes | Timestamp of the points credit |

---

## Consumer Guidelines

### Idempotency

Every event carries a globally unique `id` field (the CloudEvents `id`). Consumers **must** deduplicate events using this identifier. The recommended approach is to store processed event IDs in a persistent set (Redis or a database table) and skip any event whose `id` has already been handled.

Duplicate delivery can occur due to:

- RabbitMQ redelivery after consumer acknowledgement timeout
- Publisher retry on network partition
- Manual replay from the dead-letter queue

### Ordering

RabbitMQ does **not** guarantee strict ordering across multiple consumers or across multiple publishers. Consumers must be designed to handle out-of-order delivery. Strategies include:

- **Timestamp comparison**: Compare the event's `time` field against the last-processed timestamp for the same entity. Discard events with an older timestamp.
- **Version field**: For events that include a version or sequence number (e.g., `stock.updated`), compare `previousQuantity` / `newQuantity` to detect staleness.
- **Eventual consistency**: Accept that transient inconsistency is tolerable and design UIs to reflect "last known" state with appropriate staleness indicators.

### Dead Letter Queue

When a consumer exhausts its configured retry limit, the message is routed to the exchange's dead-letter queue:

- **Naming convention**: `{exchange}.dlq` — for example, `orders.events.dlq`
- **Retention**: Dead-lettered messages are retained for 30 days
- **Investigation**: The operations team monitors DLQ depth in Grafana. Messages can be inspected and replayed using the RabbitMQ management UI or the `acme-dlq-tool` CLI

DLQ messages retain all original headers plus:

| Header | Description |
|---|---|
| `x-death` | RabbitMQ standard death metadata (count, reason, queue, time) |
| `x-original-routing-key` | The original routing key before dead-lettering |
| `x-last-error` | The exception message from the last failed processing attempt |

### Schema Evolution

Event schemas evolve following these rules:

- **Backward-compatible additions are permitted**: new optional fields may be added to the `data` payload at any time. Consumers must ignore unknown fields.
- **Breaking changes require a new event type**: removing a field, changing a field's type, or altering the semantics of an existing field constitutes a breaking change. The publisher must introduce a new event type (e.g., `com.acmeretail.order.placed.v2`) and run both the old and new event types in parallel during a migration window.
- **Deprecation**: deprecated event types are announced at least 90 days in advance via the `#platform-events` Slack channel and in the event catalog above.

All payload schemas are registered in the internal Schema Registry (Confluent-compatible, backed by PostgreSQL). Producers validate outgoing payloads against the registered schema before publishing. Consumers should use the schema registry client to deserialize payloads safely.

### Monitoring

Event throughput and consumer lag are monitored in the **Acme Retail Grafana instance** (`grafana.internal.acmeretail.com`):

| Dashboard | Key Metrics |
|---|---|
| **Event Throughput** | Messages published/sec per exchange, messages consumed/sec per queue |
| **Consumer Lag** | Queue depth (messages pending delivery), consumer prefetch utilization |
| **DLQ Depth** | Count of dead-lettered messages per exchange |
| **Processing Latency** | p50 / p95 / p99 end-to-end latency from publish to consumer acknowledgement |

**Alerting rules**:

| Alert | Condition | Severity | Notification |
|---|---|---|---|
| Consumer lag > 5 minutes | Queue depth exceeds 5 minutes of average throughput | Warning | PagerDuty + `#platform-alerts` Slack |
| Consumer lag > 15 minutes | Queue depth exceeds 15 minutes of average throughput | Critical | PagerDuty (page on-call) |
| DLQ depth > 0 | Any message enters the dead-letter queue | Warning | `#platform-alerts` Slack |
| DLQ depth > 100 | Dead-letter queue accumulates more than 100 messages | Critical | PagerDuty (page on-call) |

---

## Related Documentation

- [Architecture Overview](../architecture/overview.md) — high-level system architecture and integration patterns
- [System Landscape](../technical/system-landscape.md) — infrastructure topology and service map
- [BookStore eCommerce](../technical/bookstore-ecommerce.md) — publisher of `order.placed`, `customer.registered`
- [Payment Module](../technical/payment-module.md) — payment capture that triggers `order.placed`
- [Inventory Management](../technical/inventory-management.md) — publisher of `stock.updated`, `stock.low`
- [Order Fulfillment](../technical/order-fulfillment.md) — publisher of `order.confirmed`, `order.shipped`, `order.delivered`
- [Loyalty Platform](../technical/loyalty-platform.md) — publisher of `points.earned`; consumer of `order.placed`, `order.delivered`
- [Recommendation Engine](../technical/recommendation-engine.md) — consumes order and browsing events for model training
- [API Overview](./overview.md) — REST API authentication and rate limiting
- [BookStore API Contract](./bookstore-api.md) — REST endpoints that produce and consume these events
