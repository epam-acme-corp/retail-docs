---
title: "Inventory Management Service"
---

# Inventory Management Service

## Service Overview

The Inventory Management Service is the authoritative system of record for all stock data across Acme Retail's warehouse and store network. Built as a .NET 6 microservice deployed on Azure Kubernetes Service (AKS), the service manages real-time inventory tracking, automated reorder workflows, multi-warehouse allocation, and integration with 120 retail store point-of-sale systems.

**Key characteristics:**

| Attribute | Detail |
|---|---|
| Runtime | .NET 6 (LTS) on AKS |
| Primary Datastore | PostgreSQL 15 |
| Messaging | RabbitMQ (CloudEvents envelope) |
| Owning Team | Platform Team |
| Deployment Cadence | Bi-weekly (Tuesday, 6:00 AM PT maintenance window) |
| Source Repository | `acme-retail/inventory-service` |

The service exposes a gRPC interface for internal consumers (Order Fulfillment, Analytics) and a REST API for administrative operations. All stock mutations are event-sourced via RabbitMQ, enabling downstream systems to react to inventory changes in near-real-time.

For high-level system context, refer to [System Architecture Overview](../architecture/overview.md) and the [System Landscape](system-landscape.md) diagram. Design decisions governing the event-driven approach are documented in **ADR-001** (Event-Driven Inventory Tracking) and **ADR-002** (PostgreSQL as Primary Datastore).

---

## Stock Level Tracking

### Per-Warehouse Tracking

Acme Retail operates two primary distribution centers:

- **Seattle DC** (SEA-01) — West Coast fulfillment hub, capacity 450,000 SKUs
- **Chicago DC** (CHI-01) — Midwest and East Coast fulfillment hub, capacity 320,000 SKUs

Each warehouse maintains independent stock records updated in real-time via warehouse management system (WMS) integrations and inbound receipt events. Warehouse stock feeds directly into the multi-warehouse allocation algorithm used during order fulfillment.

### Per-Store Tracking

Acme Retail operates **120 retail locations** across the continental United States. In-store stock is tracked through POS system synchronization (see [POS Integration](#pos-integration-for-in-store-stock) below). Store stock records are updated on every sale, return, and inter-store transfer. Store-level data supports Buy Online Pick Up In Store (BOPIS) availability checks and local inventory search on the eCommerce platform (see [Bookstore eCommerce Platform](bookstore-ecommerce.md)).

### Stock Record Data Model

The core domain model consists of two primary entities:

**StockItem**

| Field | Type | Description |
|---|---|---|
| `StockItemId` | `UUID` | Primary key |
| `SKU` | `VARCHAR(50)` | Product SKU (indexed, references Product Catalog) |
| `WarehouseId` / `StoreId` | `VARCHAR(20)` | Location identifier (warehouse or store code) |
| `QuantityOnHand` | `INT` | Physical units currently at location |
| `QuantityReserved` | `INT` | Units allocated to pending orders |
| `QuantityAvailable` | `INT` (computed) | `QuantityOnHand - QuantityReserved` |
| `LastUpdated` | `TIMESTAMPTZ` | Last modification timestamp (UTC) |

**StockMovement**

| Field | Type | Description |
|---|---|---|
| `MovementId` | `UUID` | Primary key |
| `StockItemId` | `UUID` | Foreign key to StockItem |
| `MovementType` | `ENUM` | One of: `receipt`, `sale`, `transfer`, `adjustment`, `return` |
| `Quantity` | `INT` | Signed quantity (positive for inbound, negative for outbound) |
| `Timestamp` | `TIMESTAMPTZ` | Time of movement (UTC) |
| `Source` | `VARCHAR(100)` | Originating system or reference (e.g., PO number, order ID, adjustment ticket) |

**Availability Calculation:** `QuantityAvailable = QuantityOnHand - QuantityReserved`. This computed value is recalculated on every stock mutation and is the value exposed to consumer-facing availability checks. Safety stock thresholds are configurable per-SKU via the Procurement Admin portal and are stored alongside the StockItem record.

---

## Reorder Automation

### Threshold-Based Triggers

When `QuantityAvailable` for any StockItem drops below its configured safety stock level, the service publishes a `ReorderTriggered` event. This threshold is evaluated on every stock mutation (sale, transfer, or adjustment) to ensure timely replenishment. Safety stock values are set per-SKU by the procurement team and can be overridden at the warehouse level for seasonal adjustments.

### Supplier Integration

- **EDI Integration** — The top 50 suppliers by volume are integrated via AS2/EDI 850 (Purchase Order) and EDI 856 (Advance Ship Notice). Purchase orders are generated automatically when a reorder is triggered and transmitted within 15 minutes.
- **Email Fallback** — Suppliers not on EDI receive purchase orders via structured email (PDF attachment with machine-readable metadata). The procurement team manages supplier onboarding through the Vendor Management portal.

### Reorder Algorithm

The system uses an **Economic Order Quantity (EOQ)** model refined with the following inputs:

1. **Demand velocity** — Rolling 90-day sales rate per SKU, weighted toward recent weeks
2. **Supplier lead time** — Tracked per-supplier based on historical receipt data (average and P95)
3. **Holding cost** — Calculated from warehouse storage rates and capital cost of inventory
4. **Supplier minimum order quantities** — Enforced as a floor on all computed reorder quantities
5. **Bulk pricing tiers** — If the EOQ falls within 15% of a price break threshold, the order quantity is rounded up to capture the discount

Lead time is tracked per-supplier and updated automatically as receipts are recorded. The algorithm recalculates the recommended reorder point weekly and on any supplier lead-time change exceeding 20%.

### Manual Overrides

Store managers may submit manual reorder requests through the Store Manager Dashboard for high-demand or locally trending products. The procurement team can override any automated reorder via the Procurement Admin portal, adjusting quantities, timing, or supplier selection. All overrides are logged with an audit trail.

---

## RabbitMQ Event Contract

All events use the [CloudEvents v1.0](https://cloudevents.io/) envelope specification and are published with **at-least-once delivery** guarantees. Consumers must be idempotent.

| Event Name | Exchange | Routing Key | Payload Summary |
|---|---|---|---|
| `StockUpdated` | `inventory.events` | `stock.updated.{warehouseId}` | `StockItemId`, `SKU`, `WarehouseId`, `QuantityOnHand`, `QuantityReserved`, `QuantityAvailable`, `MovementType`, `Timestamp` |
| `LowStockAlert` | `inventory.events` | `stock.low.{warehouseId}` | `StockItemId`, `SKU`, `WarehouseId`, `QuantityAvailable`, `SafetyStockLevel`, `Timestamp` |
| `ReorderTriggered` | `inventory.events` | `stock.reorder.{supplierId}` | `SKU`, `SupplierId`, `RecommendedQuantity`, `CurrentStock`, `SafetyStockLevel`, `LeadTimeDays`, `Timestamp` |
| `StockReceived` | `inventory.events` | `stock.received.{warehouseId}` | `StockItemId`, `SKU`, `WarehouseId`, `QuantityReceived`, `PurchaseOrderId`, `Timestamp` |

**Dead Letter Queue (DLQ):** Failed messages are retried up to **3 times** with exponential backoff (1s, 4s, 16s). After exhausting retries, messages are routed to the `inventory.events.dlq` dead-letter exchange. The operations team monitors DLQ depth via Grafana dashboards with alerting configured at a threshold of 50 messages.

---

## Multi-Warehouse Allocation Algorithm

When an order is placed, the allocation engine determines the optimal warehouse(s) to fulfill from. The algorithm evaluates candidates in the following priority order:

1. **Proximity-Based Selection** — The warehouse geographically closest to the customer's shipping address is preferred to minimize transit time and shipping cost. Distance is calculated using lat/long coordinates of the destination ZIP code centroid and each warehouse.

2. **Stock Availability Check** — The nearest warehouse must have all requested SKUs with sufficient `QuantityAvailable`. If any item is unavailable, the next-nearest warehouse is evaluated.

3. **Split-Shipment Threshold** — Orders are split across multiple warehouses **only when more than 3 items** cannot be fulfilled from a single location. For orders of 3 items or fewer, the system prefers fulfilling entirely from one warehouse even if it is not the closest, to avoid multiple shipments.

4. **Load Balancing** — When multiple warehouses can fulfill the order equally, current daily order volume is used as a tiebreaker. Current throughput targets:
   - **Seattle DC**: 5,000 orders/day capacity
   - **Chicago DC**: 3,500 orders/day capacity

   The warehouse operating at a lower percentage of its daily capacity is preferred to distribute workload evenly.

The allocation result is published as part of the `StockUpdated` event (with `MovementType: sale`) and consumed by the [Order Fulfillment Service](order-fulfillment.md).

---

## Inventory Reconciliation

### Daily Batch Reconciliation

A nightly batch job runs at **2:00 AM PT** to compare system stock records against physical count data imported from the warehouse management systems. Discrepancies exceeding a configurable threshold (default: 2% of QuantityOnHand or 10 units, whichever is greater) generate adjustment tickets for the warehouse operations team to investigate. Adjustments are applied as `StockMovement` records with `MovementType: adjustment`.

### Real-Time Sync

All stock mutations are propagated via RabbitMQ with a target end-to-end latency of **less than 5 seconds** from the source event (POS sale, WMS receipt) to the Inventory Management Service updating its PostgreSQL datastore. Latency is monitored via distributed tracing (OpenTelemetry) and Grafana dashboards.

### Cycle Counting

High-value and high-velocity SKUs are subject to **weekly cycle counts** conducted by warehouse staff using handheld scanners. Cycle count results are uploaded to the Inventory Management Service via the Warehouse Operations API. Discrepancies trigger the same adjustment workflow as the nightly batch. SKU classification into cycle-count tiers is reviewed quarterly by the procurement and warehouse operations teams.

---

## POS Integration for In-Store Stock

### Event Flow

In-store stock changes are captured via two POS event types:

- **`SaleCompleted`** — Emitted on every completed transaction. Decrements `QuantityOnHand` for each line item SKU at the store location.
- **`ReturnProcessed`** — Emitted on every accepted return. Increments `QuantityOnHand` for returned SKU at the store location.

### Data Path

The synchronization path follows a three-tier architecture:

1. **POS Terminal (SQLite)** — Each POS terminal maintains a local SQLite database with current store stock and pending transactions. This provides sub-millisecond read access for cashier-facing availability checks.
2. **Store Server (SQL Server)** — Each store runs a local SQL Server instance that aggregates data from all POS terminals in that location. The store server consolidates transactions and publishes events to the cloud layer.
3. **Cloud (RabbitMQ)** — The store server publishes `SaleCompleted` and `ReturnProcessed` events to RabbitMQ, where the Inventory Management Service consumes them and updates the authoritative stock record in PostgreSQL.

### Offline Handling

POS terminals are designed to operate continuously even during network outages:

- **Local Operation:** When connectivity to the store server is lost, the POS terminal continues processing transactions against its local SQLite database. Customers experience no disruption.
- **Sync on Reconnection:** When connectivity is restored, pending transactions are replayed to the store server in chronological order.
- **Conflict Resolution:** Quantity fields use a **last-write-wins** strategy based on UTC timestamps. Stock movement records are **additive** — all movements are appended regardless of order, ensuring a complete audit trail. If the reconciled `QuantityOnHand` diverges from the expected value after replay, an adjustment movement is created automatically.

Store connectivity status is monitored by the Network Operations Center (NOC) with alerts triggered after 15 minutes of sustained disconnection.

---

*Related documentation: [System Architecture Overview](../architecture/overview.md) · [System Landscape](system-landscape.md) · [Order Fulfillment Service](order-fulfillment.md) · [Bookstore eCommerce Platform](bookstore-ecommerce.md) · ADR-001 · ADR-002*
