---
title: "Acme Retail — System Landscape & Technical Inventory"
---

# Acme Retail — System Landscape & Technical Inventory

## 1. System Inventory

The Acme Retail technology estate comprises **eight principal systems** that collectively support the full customer journey — from product discovery through order fulfillment and post-purchase service. The table below provides a summary; detailed descriptions follow.

| # | System | Technology | Database | Status | Team Owner |
|---|--------|-----------|----------|--------|------------|
| 1 | eCommerce Platform (BookStore) | .NET Framework 4.8 → .NET 8, React 18 | SQL Server 2019 | Active modernization | BookStore Team |
| 2 | Point of Sale (POS) | .NET 6 / WPF | SQLite (local) + SQL Server (cloud sync) | Production — stable | Platform Team |
| 3 | Inventory Management | .NET 6 microservice | PostgreSQL 15, RabbitMQ | Production — stable | Platform Team |
| 4 | Product Catalogue | .NET 6 API | Elasticsearch 8 + Azure Blob Storage | Production — stable | Search & Discovery Team |
| 5 | Loyalty Platform | Node.js 20 / Express | MongoDB 7 | Production — stable | Loyalty Team |
| 6 | Recommendation Engine | Python 3.11 / FastAPI, TensorFlow Serving | Redis 7 (feature store) | Production — iterating | ML/AI Team |
| 7 | Order Fulfillment | .NET 6 microservice | PostgreSQL 15 | Production — stable | Platform Team |
| 8 | Payment Module | .NET Framework 4.8 | SQL Server 2019 | Production — modernization planned | Payments Team |

---

### 1.1 eCommerce Platform (BookStore)

**Description.** The flagship customer-facing storefront powering acmebookstore.com and serving as the backend-for-frontend for the mobile application. The platform handles product listing pages, search, cart management, checkout orchestration, customer account management, and order history.

**Key Capabilities:** Server-side rendered React 18 storefront with hydration; RESTful API layer; cart and session management; checkout orchestration across Payment Module and Order Fulfillment; integration with Product Catalogue (search) and Recommendation Engine (personalization).

**Architecture Note.** The platform is undergoing an **active strangler-fig modernization** from .NET Framework 4.8 (hosted on IIS / Windows Server) to .NET 8 (containerized on AKS). Approximately 40 % of API surface has been migrated to .NET 8 microservices as of Q1 2025; the remaining monolith handles legacy checkout, account, and admin workflows.

**Deployment Target:** Legacy — IIS on Azure VMs (Windows Server 2019); Modern — Azure Kubernetes Service (AKS) Linux node pools.

**Release Cadence:** Modern services — continuous delivery (multiple deploys/day); Legacy monolith — bi-weekly release train.

---

### 1.2 Point of Sale (POS)

**Description.** In-store transaction processing system deployed on dedicated terminals in all 120 retail locations. The POS handles barcode scanning, payment terminal integration, receipt generation, and real-time inventory deduction.

**Key Capabilities:** Offline-capable transaction processing with local SQLite persistence; cloud synchronization to central SQL Server on configurable intervals (default: 5-minute batch sync, real-time for inventory-critical events); integration with the Loyalty Platform for in-store point accrual and redemption; associate-facing dashboard for cross-location inventory lookup.

**Deployment Target:** Local install on store terminals (Windows 10 IoT Enterprise); cloud sync component runs as an Azure Function.

**Release Cadence:** Quarterly; coordinated with store operations to minimize disruption during trading hours.

---

### 1.3 Inventory Management

**Description.** Central inventory service that maintains the single source of truth for available-to-promise (ATP) stock across all channels and fulfillment nodes. Receives inventory events from the POS (sales, adjustments), Order Fulfillment (shipments, returns), and Acme Distribution WMS (replenishment, transfers).

**Key Capabilities:** Real-time ATP calculation; multi-location stock reservation (web, BOPIS, store); low-stock and out-of-stock event publishing via RabbitMQ; nightly reconciliation batch against Acme Distribution WMS; safety-stock threshold management.

**Deployment Target:** Azure Kubernetes Service (AKS) — Linux node pool; PostgreSQL 15 on Azure Database for PostgreSQL Flexible Server; RabbitMQ on AKS (dedicated stateful set).

**Release Cadence:** Bi-weekly sprints with continuous delivery pipeline.

---

### 1.4 Product Catalogue

**Description.** Centralized product information management and search API. Stores product metadata (titles, descriptions, attributes, pricing, categories, images), exposes faceted search, and serves product detail data to all consumer-facing channels.

**Key Capabilities:** Full-text and faceted search powered by Elasticsearch 8; product data ingestion pipeline from merchandising team via bulk CSV and API; image management via Cloudinary (transformation, CDN delivery); category taxonomy management; pricing rule storage and propagation.

**Deployment Target:** .NET 6 API on AKS; Elasticsearch 8 cluster (3-node, Azure VMs); Azure Blob Storage for raw image assets prior to Cloudinary processing.

**Release Cadence:** Bi-weekly; search relevance tuning deployed independently via Elasticsearch index configuration changes.

---

### 1.5 Loyalty Platform

**Description.** Manages the BookStore Rewards loyalty program — member enrollment, point accrual, tier qualification, reward redemption, and promotional campaign targeting.

**Key Capabilities:** Member profile and tier management (Silver, Gold, Platinum); points engine with configurable accrual rules (per-dollar, bonus multipliers, category promotions); reward catalog and redemption API; event-driven point accrual from eCommerce checkout and POS transactions; Segment integration for behavioral segmentation and campaign targeting.

**Deployment Target:** Node.js 20 containers on AKS; MongoDB 7 on Azure Cosmos DB for MongoDB (vCore).

**Release Cadence:** Weekly deployments; promotional campaign configuration is data-driven and does not require code releases.

---

### 1.6 Recommendation Engine

**Description.** Machine-learning service that generates personalized product recommendations for use on the homepage, product detail pages, cart page, and transactional emails. Models are trained on purchase history, browsing behavior, and collaborative filtering signals.

**Key Capabilities:** Real-time inference API (< 50 ms p99 target); offline batch model training (daily); A/B testing framework for model variant comparison; feature store backed by Redis 7 for low-latency feature retrieval during inference; model registry for version management.

**Deployment Target:** FastAPI application on AKS (GPU-enabled node pool for TensorFlow Serving); Redis 7 on Azure Cache for Redis (Premium tier); training pipelines on Azure Machine Learning.

**Release Cadence:** Model retraining — daily automated pipeline; application code — bi-weekly; A/B experiment rollouts — continuous.

---

### 1.7 Order Fulfillment

**Description.** Orchestrates the post-checkout lifecycle — fulfillment node selection, pick-pack-ship coordination, carrier integration, shipment tracking, and return processing.

**Key Capabilities:** Fulfillment routing engine (warehouse vs. ship-from-store optimization); carrier API integrations (UPS, FedEx, USPS) for label generation and tracking; RabbitMQ-based event consumption from eCommerce checkout and event publishing to Inventory Management; return authorization and restocking workflow; SLA monitoring and escalation.

**Deployment Target:** AKS (Linux node pool); PostgreSQL 15 on Azure Database for PostgreSQL Flexible Server.

**Release Cadence:** Bi-weekly; carrier integration updates deployed independently as needed.

---

### 1.8 Payment Module

**Description.** Handles payment authorization, capture, refund, and settlement for all channels. Integrates with Stripe for card processing and manages enterprise/bulk buyer invoicing with net-30/net-60 terms.

**Key Capabilities:** Card authorization and capture via Stripe API; 3-D Secure support; refund and partial-refund processing; invoice generation for Enterprise accounts; PCI DSS compliance boundary; fraud rule evaluation (velocity checks, AVS/CVV validation).

**Architecture Note.** The Payment Module is the second .NET Framework 4.8 component in the estate (alongside the legacy BookStore monolith). Modernization to .NET 8 is **planned for H2 2025**, contingent on completion of PCI DSS re-certification for the new runtime and container environment.

**Deployment Target:** IIS on Azure VMs (Windows Server 2019) within a PCI-scoped virtual network.

**Release Cadence:** Monthly; change-advisory-board (CAB) approval required for all production deployments due to PCI scope.

---

## 2. System Dependency Map

The diagram below illustrates inter-system communication. Arrows indicate the direction of the primary data flow; labels specify the protocol and synchronicity.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Customer Channels                              │
│   ┌──────────┐    ┌──────────┐    ┌──────────────┐                      │
│   │  Web App  │    │Mobile App│    │  POS (Store) │                      │
│   └────┬─────┘    └────┬─────┘    └──────┬───────┘                      │
│        │               │                 │                              │
│        └───────┬───────┘                 │                              │
│                ▼                         │                              │
│   ┌────────────────────┐                 │                              │
│   │  eCommerce Platform│◄────REST/sync───┘  (inventory lookup,          │
│   │     (BookStore)    │                     loyalty check)             │
│   └──┬──┬──┬──┬──┬────┘                                                │
│      │  │  │  │  │                                                      │
│      │  │  │  │  └──── REST/sync ────►┌──────────────────┐              │
│      │  │  │  │                       │  Payment Module   │              │
│      │  │  │  │                       │  (.NET Fx 4.8)    │              │
│      │  │  │  │                       └───────┬──────────┘              │
│      │  │  │  │                               │ REST/sync               │
│      │  │  │  │                               ▼                         │
│      │  │  │  │                       ┌──────────────────┐              │
│      │  │  │  │                       │   Stripe (ext.)  │              │
│      │  │  │  │                       └──────────────────┘              │
│      │  │  │  │                                                         │
│      │  │  │  └──── REST/sync ────►┌──────────────────────┐             │
│      │  │  │                       │  Recommendation Eng.  │             │
│      │  │  │                       │  (Python / FastAPI)   │             │
│      │  │  │                       └───────┬──────────────┘             │
│      │  │  │                               │ reads                      │
│      │  │  │                               ▼                            │
│      │  │  │                       ┌──────────────────┐                 │
│      │  │  │                       │  Redis 7 (feat.) │                 │
│      │  │  │                       └──────────────────┘                 │
│      │  │  │                                                            │
│      │  │  └────── REST/sync ─────►┌──────────────────────┐             │
│      │  │                          │  Product Catalogue    │             │
│      │  │                          │  (Elasticsearch 8)    │             │
│      │  │                          └───────┬──────────────┘             │
│      │  │                                  │ fallback                   │
│      │  │                                  ▼                            │
│      │  │                          ┌──────────────────┐                 │
│      │  │                          │  Algolia (ext.)  │                 │
│      │  │                          └──────────────────┘                 │
│      │  │                                                               │
│      │  └───── REST/sync ─────────►┌──────────────────────┐             │
│      │                             │   Loyalty Platform    │             │
│      │                             │   (Node.js / Mongo)   │             │
│      │                             └──────────────────────┘             │
│      │                                                                  │
│      └───── RabbitMQ/async ───────►┌──────────────────────┐             │
│                                    │  Order Fulfillment    │             │
│                                    └──────┬───────────────┘             │
│                                           │                             │
│                       RabbitMQ/async      │  REST/sync                  │
│                  ┌────────────────────────┘  │                          │
│                  ▼                            ▼                          │
│   ┌──────────────────────┐     ┌──────────────────────────┐             │
│   │ Inventory Management │     │  Acme Distribution WMS   │             │
│   │   (PostgreSQL 15)    │◄────│       (external)         │             │
│   └──────────────────────┘     └──────────────────────────┘             │
│            ▲                                                            │
│            │ REST/sync (stock updates)                                  │
│   ┌────────┘                                                            │
│   │  POS                                                                │
│   └─────────                                                            │
└─────────────────────────────────────────────────────────────────────────┘
```

### Communication Summary

| Source → Target | Protocol | Sync/Async | Notes |
|----------------|----------|-----------|-------|
| eCommerce → Payment Module | REST (HTTPS) | Synchronous | Checkout critical path; < 2 s timeout. |
| eCommerce → Product Catalogue | REST (HTTPS) | Synchronous | Search and PDP data retrieval. |
| eCommerce → Recommendation Engine | REST (HTTPS) | Synchronous | Personalized recommendations; circuit breaker with graceful fallback to trending items. |
| eCommerce → Loyalty Platform | REST (HTTPS) | Synchronous | Points check, discount application at checkout. |
| eCommerce → Order Fulfillment | RabbitMQ | Asynchronous | Order-placed event triggers fulfillment workflow. |
| Order Fulfillment → Inventory Management | RabbitMQ | Asynchronous | Shipment-confirmed and return-received events update ATP. |
| Order Fulfillment → Acme Distribution WMS | REST (HTTPS) | Synchronous | Fulfillment request submission and tracking retrieval. |
| POS → Inventory Management | REST (HTTPS) | Synchronous | Real-time stock deduction on in-store sale; batch sync for adjustments. |
| POS → Loyalty Platform | REST (HTTPS) | Synchronous | In-store point accrual and redemption. |
| POS → eCommerce (cloud sync) | REST (HTTPS) | Asynchronous (batched) | Transaction upload and configuration pull on 5-minute intervals. |
| Payment Module → Stripe | REST (HTTPS) | Synchronous | Authorization, capture, refund operations. |
| Product Catalogue → Algolia | REST (HTTPS) | Synchronous (fallback) | Activated only when Elasticsearch cluster is degraded. |
| Recommendation Engine → Redis 7 | Redis protocol | Synchronous | Feature vector retrieval during inference. |
| Multiple → Segment | HTTP (tracking API) | Asynchronous (fire-and-forget) | Behavioral event ingestion. |
| Multiple → SendGrid | REST (HTTPS) | Asynchronous (queued) | Transactional email dispatch. |
| Product Catalogue → Cloudinary | REST (HTTPS) | Synchronous | Image transformation URLs generated at index time. |

---

## 3. Third-Party Integration Inventory

| # | Vendor | Purpose | Integration Method | Contract / Tier | Fallback Strategy |
|---|--------|---------|-------------------|----------------|-------------------|
| 1 | **Stripe** | Payment processing (card authorization, capture, refunds, 3-D Secure) | REST API (server-side SDK, .NET); Stripe.js (client-side tokenization) | Enterprise tier with negotiated MDR; PCI DSS Level 1 compliance | Retry with exponential backoff; if Stripe is unreachable after 3 retries, queue order for manual payment processing by Customer Service. |
| 2 | **Algolia** | Search fallback when Elasticsearch is degraded | REST API (Algolia .NET SDK) | Pro tier; index synced daily from Product Catalogue | Primary search is Elasticsearch. Algolia activates only when Elasticsearch health-check fails; feature-flag controlled. |
| 3 | **SendGrid** | Transactional email (order confirmations, shipping notifications, password resets, NPS surveys) | REST API (SendGrid C# SDK); webhook for delivery/bounce events | Pro tier; dedicated IP pool for deliverability | Email dispatch is asynchronous and queued. If SendGrid is unavailable, messages are retained in the internal RabbitMQ queue and retried. No customer-facing impact during short outages. |
| 4 | **Segment** | Customer data platform — event collection, identity resolution, audience building, downstream analytics | Analytics.js (client-side), Segment HTTP Tracking API (server-side) | Business tier; SSO-enabled | Segment events are fire-and-forget. Failure does not affect the customer transaction. Missed events are accepted as data loss; recovery is handled through daily reconciliation jobs where feasible. |
| 5 | **Cloudinary** | Image transformation, optimization, and CDN delivery for product images | URL-based transformations; Upload API for asset ingestion | Advanced tier; custom CDN CNAME (images.acmebookstore.com) | If Cloudinary CDN is unavailable, the Product Catalogue falls back to serving original-resolution images from Azure Blob Storage. Page performance degrades but functionality is preserved. |

---

## 4. Tech Debt Inventory

The following items represent the most impactful areas of technical debt tracked by the engineering organization. Each is prioritized in the divisional technology roadmap and reviewed quarterly.

### 4.1 Payment Module — .NET Framework 4.8

| Attribute | Detail |
|-----------|--------|
| **Issue** | The Payment Module runs on .NET Framework 4.8, which is in maintenance-only support from Microsoft. It cannot be containerized on Linux and must run on Windows Server VMs, increasing operational cost and limiting deployment agility. |
| **Impact** | Higher infrastructure cost (~30 % premium vs. AKS Linux); slower release cadence (monthly with CAB); inability to leverage shared AKS tooling (observability, service mesh, canary deployments). |
| **Remediation** | Port to .NET 8 with Linux container support; re-certify PCI DSS for the new runtime/container environment. |
| **Timeline** | H2 2025 (dependent on PCI assessment completion in Q2 2025). |

### 4.2 BookStore Monolith — Strangler Fig Migration

| Attribute | Detail |
|-----------|--------|
| **Issue** | The eCommerce platform originated as a .NET Framework 4.8 monolith. While ~40 % of the API surface has been extracted into .NET 8 microservices, the remaining monolith still handles checkout orchestration, customer account management, and back-office admin — tightly coupled modules that resist straightforward extraction. |
| **Impact** | Shared deployment artifact means all legacy modules must be tested and released together; database coupling (shared SQL Server instance with cross-schema joins) blocks independent scaling; developer onboarding time for the legacy codebase is 2–3× longer than for modern services. |
| **Remediation** | Continue strangler-fig decomposition: next targets are checkout orchestration (Q2 2025) and account management (Q3 2025). Database decoupling via change-data-capture (CDC) to be introduced in parallel. |
| **Timeline** | Full monolith retirement targeted for Q4 2025; contingent on Payment Module modernization completing first. |

### 4.3 POS Cloud Sync Reliability

| Attribute | Detail |
|-----------|--------|
| **Issue** | The POS cloud synchronization mechanism uses a polling-based batch sync on a 5-minute default interval. Under degraded network conditions (common in some older store locations), sync failures result in stale inventory data and delayed loyalty point posting. Retry logic is basic (fixed interval, no exponential backoff). |
| **Impact** | Inventory discrepancies between in-store and online channels can last 15–30 minutes during network instability; loyalty point delays generate customer complaints (~50/month). |
| **Remediation** | Migrate to event-driven sync using Azure Service Bus with local outbox pattern; implement exponential backoff with jitter; add sync health dashboard for store operations. |
| **Timeline** | Q3 2025 (Platform Team roadmap). |

### 4.4 Legacy SQL Server Full-Text Search

| Attribute | Detail |
|-----------|--------|
| **Issue** | The eCommerce monolith still contains legacy search endpoints that query SQL Server full-text indexes directly, bypassing the Product Catalogue's Elasticsearch-powered search. These endpoints are used by the admin back-office and by two legacy API consumers (mobile app v1 — deprecated but still in field, and the Enterprise Buyer portal). |
| **Impact** | SQL Server full-text search quality is significantly inferior to Elasticsearch (no typo tolerance, limited relevance tuning, no faceting); maintaining two search paths increases testing burden; SQL Server CPU spikes during full-text index rebuilds affect checkout performance on the shared instance. |
| **Remediation** | Migrate remaining consumers to Product Catalogue search API; sunset mobile app v1 (< 2 % MAU remaining); refactor Enterprise Buyer portal search to use the same Elasticsearch-backed endpoint. |
| **Timeline** | Q2 2025 (Search & Discovery Team). |

### 4.5 Session State Management

| Attribute | Detail |
|-----------|--------|
| **Issue** | The legacy BookStore monolith uses ASP.NET in-process session state for cart data and authentication tokens. This binds user sessions to a specific IIS server instance and requires sticky sessions at the load-balancer level, limiting horizontal scalability and complicating rolling deployments. |
| **Impact** | Sticky sessions prevent even load distribution; a server restart or deployment drops active sessions, causing cart loss and forced re-authentication for affected users (~0.3 % of sessions during each deployment); no session sharing between legacy monolith and modern .NET 8 services. |
| **Remediation** | Migrate session state to a distributed store (Redis 7 on Azure Cache for Redis) using the ASP.NET distributed cache provider; implement token-based authentication (JWT) for cross-service identity propagation. |
| **Timeline** | Q2 2025 (BookStore Team — in progress, 60 % complete). |

---

## 5. Team Structure

Acme Retail engineering is organized into **six cross-functional product teams**, each aligned to one or more systems. All teams report to the **VP of Engineering, Acme Retail**, who in turn reports to the Acme Retail divisional CTO.

### 5.1 Platform Team (12 engineers)

**Scope:** Inventory Management, Order Fulfillment, Point of Sale (POS), shared infrastructure (AKS clusters, CI/CD pipelines, observability stack).

**Composition:** 1 Engineering Manager, 2 Staff Engineers (platform architecture), 6 Backend Engineers (.NET), 2 DevOps/SRE Engineers, 1 QA Engineer.

**On-Call:** 24/7 rotation; primary + secondary; covers all production infrastructure and the three owned services.

**Collaboration:** Primary interface with Acme Distribution (WMS integration) and with the BookStore Team during strangler-fig migrations. Provides shared CI/CD templates and AKS namespace provisioning to all teams.

### 5.2 BookStore Team (15 engineers)

**Scope:** eCommerce Platform — both the legacy .NET Framework 4.8 monolith and the emerging .NET 8 microservices — including the React 18 storefront.

**Composition:** 1 Engineering Manager, 1 Tech Lead, 5 Backend Engineers (.NET), 4 Frontend Engineers (React/TypeScript), 2 Full-Stack Engineers, 1 QA Engineer, 1 SRE.

**On-Call:** 24/7 rotation; primary + secondary; covers the eCommerce Platform, storefront CDN, and BFF layer.

**Collaboration:** Closest working relationship with the Payments Team (checkout flow), Search & Discovery Team (search integration), and ML/AI Team (recommendation integration). Drives the strangler-fig migration with architectural guidance from the Platform Team.

### 5.3 Payments Team (6 engineers)

**Scope:** Payment Module — authorization, capture, refund, invoicing, PCI compliance.

**Composition:** 1 Engineering Manager, 3 Backend Engineers (.NET), 1 Security Engineer (PCI specialist), 1 QA Engineer.

**On-Call:** 24/7 rotation; single-tier due to team size; Security Engineer on escalation for PCI-related incidents.

**Collaboration:** Works closely with the BookStore Team on the checkout flow and with the Platform Team on infrastructure for the upcoming .NET 8 migration. Coordinates with Acme Corporation's central InfoSec team for annual PCI DSS assessments.

### 5.4 Search & Discovery Team (8 engineers)

**Scope:** Product Catalogue service, Elasticsearch cluster management, Algolia fallback, search relevance optimization, category taxonomy.

**Composition:** 1 Engineering Manager, 3 Backend Engineers (.NET), 2 Search/Relevance Engineers, 1 Data Engineer, 1 QA Engineer.

**On-Call:** 24/7 rotation; primary + secondary; covers Elasticsearch cluster health, Product Catalogue API, and Algolia sync.

**Collaboration:** Partners with the ML/AI Team on embedding-based search experiments. Provides search APIs consumed by the BookStore Team (web/mobile), the POS (in-store lookup), and the Enterprise Buyer portal.

### 5.5 Loyalty Team (5 engineers)

**Scope:** Loyalty Platform — member management, points engine, reward catalog, campaign targeting integration with Segment.

**Composition:** 1 Engineering Manager, 3 Backend Engineers (Node.js), 1 QA Engineer.

**On-Call:** Business-hours primary on-call; after-hours escalation to Platform Team SRE for infrastructure issues.

**Collaboration:** Interfaces with the BookStore Team and POS (Platform Team) for point accrual/redemption at checkout. Works with the ML/AI Team on churn-prediction signals and personalized reward offers.

### 5.6 ML/AI Team (4 full-time + 2 embedded data scientists)

**Scope:** Recommendation Engine, ML model lifecycle (training, evaluation, deployment), feature store, A/B experimentation platform.

**Composition:** 1 ML Engineering Lead, 2 ML Engineers (Python / TensorFlow), 1 MLOps Engineer; 2 Data Scientists embedded from Acme Corporation's central Data & Analytics team on a rotating 6-month assignment.

**On-Call:** Business-hours on-call for model-serving issues; after-hours infrastructure escalation to Platform Team SRE. Model quality degradation alerts are reviewed next business day.

**Collaboration:** Supplies recommendations to the BookStore Team; consumes behavioral event streams from Segment; collaborates with Search & Discovery on semantic search initiatives; partners with the Loyalty Team on personalization-driven engagement campaigns.

### Cross-Team Coordination

- **Weekly Engineering Sync** — all Engineering Managers + VP Engineering; covers cross-team dependencies, incident review, roadmap alignment.
- **Architecture Review Board (ARB)** — monthly; Staff Engineers from Platform and BookStore Teams + divisional CTO; reviews RFCs, cross-system changes, and tech-debt prioritization.
- **Incident Response** — unified incident management process; any team can declare a SEV-1/SEV-2; Platform Team SRE coordinates cross-team war rooms.

---

## Related Resources

- **Business Overview & Customer Journey** → [`../business/overview.md`](../business/overview.md)
- **Architecture Overview** → [`../architecture/overview.md`](../architecture/overview.md)
