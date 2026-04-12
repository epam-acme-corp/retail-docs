---
title: "Order Fulfillment Service"
---

# Order Fulfillment Service

## Service Overview

The Order Fulfillment Service manages the complete lifecycle of customer orders from placement through delivery and returns. Built as a .NET 6 microservice deployed on Azure Kubernetes Service (AKS), it orchestrates coordination between the eCommerce platform, the [Inventory Management Service](inventory-management.md), Acme Distribution's warehouse management system (WMS), carrier networks, and the payment processing module.

**Key characteristics:**

| Attribute | Detail |
|---|---|
| Runtime | .NET 6 (LTS) on AKS |
| Primary Datastore | PostgreSQL 15 |
| Messaging | RabbitMQ (consumes `OrderPlaced` and related events) |
| WMS Integration | Acme Distribution REST API (HTTPS) |
| Owning Team | Platform Team |
| Source Repository | `acme-retail/fulfillment-service` |

The service is the primary consumer of the `OrderPlaced` event published by the eCommerce platform. It coordinates all downstream fulfillment activities and maintains the order state machine that drives customer-facing status updates.

For high-level system context, refer to [System Architecture Overview](../architecture/overview.md) and the [System Landscape](system-landscape.md) diagram. Design decisions are documented in **ADR-001** (Event-Driven Architecture) and **ADR-002** (PostgreSQL as Primary Datastore).

---

## Order Lifecycle

Every order progresses through a defined set of states. The following diagram illustrates the primary flow and the return branch:

```
Placed → Confirmed → Allocated → Picking → Packed → Shipped → In Transit → Delivered
                                                                                ↓
                                                         Return Requested → Returned

* Cancelled state: allowed before Picking; after Picking, must use the Return flow.
```

### State Definitions

| State | Trigger | Actions |
|---|---|---|
| **Placed** | `OrderPlaced` event received from eCommerce platform | Validate order contents, verify customer account, persist order record |
| **Confirmed** | Payment authorization confirmed by Payment Module | Lock pricing, send order confirmation email via SendGrid, publish `OrderConfirmed` event |
| **Allocated** | Inventory Management Service reserves stock | Assign warehouse(s) via allocation algorithm, generate fulfillment request(s), publish `OrderAllocated` event |
| **Picking** | WMS confirms pick operation started | Update order status, notify customer that order is being prepared |
| **Packed** | WMS confirms all items packed and labeled | Record package dimensions and weight, generate shipping label reference |
| **Shipped** | WMS confirms carrier pickup with tracking number | Store tracking number and carrier details, send shipping confirmation with tracking link via SendGrid |
| **In Transit** | Carrier tracking API reports package in transit | Update estimated delivery date, publish `OrderInTransit` event |
| **Delivered** | Carrier confirms delivery (signature or photo proof) | Mark order complete, trigger post-purchase follow-up (review request after 7 days), publish `OrderDelivered` event |
| **Return Requested** | Customer initiates return (web or in-store) | Validate return eligibility (30-day window), generate return authorization |
| **Returned** | Warehouse receives and inspects returned item(s) | Trigger refund via Payment Module, restock eligible items, publish `ReturnCompleted` event |
| **Cancelled** | Customer or system cancels before Picking stage | Release reserved inventory, reverse payment authorization, send cancellation confirmation via SendGrid |

**Cancellation Policy:** Orders may be cancelled at any point before entering the **Picking** state. Once an order has been allocated to a warehouse and picking has begun, the standard return process must be used. Automated cancellation is also triggered if payment authorization fails within 30 minutes of placement.

---

## Acme Distribution WMS Integration

### Connection Details

The Fulfillment Service integrates with Acme Distribution's warehouse management system via a secured REST API over HTTPS. Authentication uses mutual TLS (mTLS) with certificates rotated quarterly.

### Order Handoff

When an order reaches the **Allocated** state, the Fulfillment Service creates a fulfillment request in the WMS:

**Endpoint:** `POST /api/v1/fulfillment-requests`

The request payload includes order ID, allocated warehouse, line items (SKU, quantity), shipping method, and customer shipping address. The WMS responds synchronously with a fulfillment request ID and an initial status of `accepted` or `rejected`.

### Status Webhooks

Acme Distribution's WMS sends status updates to the Fulfillment Service via authenticated webhooks (HMAC-SHA256 signed payloads):

| WMS Status | Fulfillment Service Action |
|---|---|
| `allocated` | Confirm warehouse has physically located items; transition order to Allocated |
| `picking` | Transition order to Picking; update customer-facing status |
| `packed` | Transition order to Packed; record package details |
| `shipped` | Transition order to Shipped; store tracking number and carrier; trigger customer notification |

### Carrier Integration

Carrier selection and label generation are handled entirely by Acme Distribution's WMS. The supported carriers are:

- **UPS** — Ground and 2-Day services
- **FedEx** — Ground, Express, and Same-Day (metro areas)
- **USPS** — Priority Mail and First Class (lightweight items)

The Fulfillment Service receives carrier name, tracking number, estimated delivery date, and delivery confirmation from the WMS via webhooks. It does not interact with carrier APIs directly.

### Error Handling

If the WMS rejects a fulfillment request (e.g., stock discrepancy at the physical warehouse level), the Fulfillment Service attempts **reallocation** to an alternate warehouse using the [multi-warehouse allocation algorithm](inventory-management.md#multi-warehouse-allocation-algorithm). The reallocation follows this escalation path:

1. **Attempt 1** — Reallocate to next-nearest warehouse with available stock
2. **Attempt 2** — Reallocate allowing split shipment regardless of item count
3. **Attempt 3** — Escalate to the fulfillment operations team via PagerDuty alert

After 3 failed attempts, the order is placed in a manual review queue and the customer is notified of a potential delay via SendGrid email.

---

## Split-Shipment Handling

When no single warehouse can fulfill an entire order, the system splits the order across multiple distribution centers. Split shipments are governed by the allocation algorithm defined in the [Inventory Management Service](inventory-management.md#multi-warehouse-allocation-algorithm).

### Split-Shipment Behavior

- **Independent Fulfillment Requests** — Each warehouse receives its own fulfillment request via the WMS API, containing only the line items allocated to that location. Each request follows its own lifecycle through picking, packing, and shipping independently.
- **Independent Tracking** — Each shipment receives its own tracking number from the assigned carrier. Tracking numbers are associated with the parent order and the specific line items in each package.
- **Unified Customer View** — The customer sees a single order in their account with multiple shipments listed beneath it. The order status page on the eCommerce platform displays per-shipment tracking and an overall order status derived from the least-advanced shipment.
- **Consolidation Preference** — The allocation algorithm prefers single-warehouse fulfillment to reduce shipping costs and improve the customer experience. Split shipments are used only when more than 3 items cannot be fulfilled from one location, as defined by the split-shipment threshold in the allocation algorithm.

### Cost Implications

Split shipments increase shipping cost per order. The Fulfillment Service tracks split-shipment frequency as a key metric. The operations team reviews this weekly with a target of keeping split shipments below 8% of total orders. Persistent splits for specific SKU combinations are flagged for inventory redistribution review.

---

## Return Processing Workflow

Returns are supported via both the eCommerce platform and in-store at any of Acme Retail's 120 locations. The standard return window is **30 days** from the delivery date.

### Step-by-Step Process

**Step 1: Return Initiated**
The customer submits a return request through the order detail page on the website or mobile app, or presents the item at any retail location. The system validates the return is within the 30-day window and the item is in an eligible category (non-returnable categories include perishables, personalized items, and opened media).

**Step 2: Return Authorized**
The Fulfillment Service validates eligibility rules: order exists, item was delivered, return window is open, and the item category permits returns. A Return Merchandise Authorization (RMA) number is generated and associated with the order. If the return is initiated in-store, authorization is immediate upon manager approval for items over $100.

**Step 3: Return Label Generated**
- **Online returns:** A prepaid return shipping label (UPS or USPS) is generated and emailed to the customer via SendGrid. The label cost is absorbed by Acme Retail for standard returns.
- **In-store returns:** No label is needed. The store associate processes the return immediately using the POS return workflow and the item is handled locally.

**Step 4: Item Received**
The returned item arrives at the designated warehouse (typically the originating DC). Warehouse staff inspect the item for damage, verify the SKU and quantity against the RMA, and record the inspection result in the WMS.

**Step 5: Refund Triggered**
Upon successful inspection, the Fulfillment Service publishes a `ReturnCompleted` event. The [Payment Module](payment-module.md) consumes this event and processes the refund to the original payment method. Refund processing time is 3–5 business days for credit cards and 1 business day for store credit.

**Step 6: Stock Restocked**
If the returned item passes quality inspection, the Fulfillment Service publishes a `StockReceived` event consumed by the [Inventory Management Service](inventory-management.md). The item is added back to available inventory at the receiving warehouse. Items that fail inspection are routed to the liquidation or disposal workflow managed by the warehouse operations team.

---

## Fulfillment SLAs

| Service Level | Order Cutoff | Delivery Window | Carriers | Notes |
|---|---|---|---|---|
| **Standard** | 2:00 PM PT | 3–5 business days | USPS Priority, FedEx Ground | Default shipping method |
| **Express** | 4:00 PM PT | 1–2 business days | FedEx Express | Available for all US addresses |
| **Same-Day** | 12:00 PM PT | Same calendar day | Local courier partners | Metro areas only |
| **BOPIS** | N/A | 2 hours from confirmation | Store staff | Available at all 120 locations |

### Same-Day Delivery Markets

Same-day delivery is currently available in the following metropolitan areas, fulfilled through partnerships with local courier services:

- Seattle, WA
- Portland, OR
- San Francisco, CA
- New York City, NY
- Chicago, IL

Expansion to additional markets is evaluated quarterly based on order volume and courier partner availability.

### SLA Monitoring

Fulfillment SLA adherence is monitored continuously:

- **Automated Tracking** — Every order is tracked against its SLA deadline from the moment of placement. The Fulfillment Service calculates the SLA deadline based on the order cutoff time and delivery window for the selected shipping tier.
- **Escalation at 80% of Window** — When an order reaches **80% of its SLA window** without advancing to the Shipped state, an automated alert is sent to the fulfillment operations team via PagerDuty. For same-day orders, the escalation threshold is 60%.
- **Dashboard** — Real-time SLA performance is displayed on the Operations Grafana dashboard, broken down by shipping tier, warehouse, and carrier. Weekly SLA reports are distributed to the Platform Team and logistics leadership.

Current SLA adherence targets: Standard ≥ 98%, Express ≥ 97%, Same-Day ≥ 95%, BOPIS ≥ 99%.

---

## Carrier Integration and Customer Notifications

### Carrier Data Flow

All carrier interactions are managed by Acme Distribution's WMS. The Fulfillment Service receives the following data points from the WMS via status webhooks:

| Data Point | Description |
|---|---|
| Tracking Number | Carrier-assigned tracking identifier |
| Carrier Name | UPS, FedEx, or USPS |
| Estimated Delivery Date | Carrier-provided ETA, updated as the package moves through the network |
| Delivery Confirmation | Final delivery status including timestamp, signature (if required), and proof-of-delivery photo (where available) |

### Customer Notifications

Customer-facing email notifications are sent via **SendGrid** at each major order status transition:

| Trigger | Email Content |
|---|---|
| Order Confirmed | Order summary, estimated delivery window, order detail link |
| Order Shipped | Tracking number with carrier link, updated delivery estimate |
| Out for Delivery | Same-day notification with live tracking link |
| Delivered | Delivery confirmation, link to initiate return if needed |
| Return Authorized | RMA number, return label (attached or link), return instructions |
| Refund Processed | Refund amount, payment method, expected processing time |

Email templates are managed by the Marketing Operations team in SendGrid and versioned in the `acme-retail/email-templates` repository. Notification preferences (email, SMS) are respected based on the customer's communication settings stored in the Customer Profile Service.

For split-shipment orders, notifications are sent per-shipment so the customer receives a tracking email for each package, with clear labeling indicating which items are in each shipment.

---

*Related documentation: [System Architecture Overview](../architecture/overview.md) · [System Landscape](system-landscape.md) · [Inventory Management Service](inventory-management.md) · [Payment Module](payment-module.md) · ADR-001 · ADR-002*
