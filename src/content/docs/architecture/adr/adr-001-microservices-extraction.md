---
title: "ADR-001 Microservices Extraction Strategy"
---

# ADR-001: Microservices Extraction Strategy for BookStore Monolith

- **Status:** Accepted
- **Date:** 2020-03-12
- **Deciders:** Sarah Chen (VP Engineering), David Park (Principal Architect), Lena Kowalski (Engineering Manager — Platform), Marcus Rivera (Engineering Manager — Commerce)

## Context

The BookStore monolith, originally built in 2008 on ASP.NET MVC (.NET Framework 4.x), had grown to encompass all Acme Retail e-commerce capabilities within a single deployable unit: product browsing, shopping cart, checkout, order management, inventory tracking, fulfillment coordination, user accounts, loyalty, and back-office administration. By early 2020, the codebase comprised approximately 320 projects in a single Visual Studio solution, backed by a shared SQL Server database (`RetailDB`) with over 400 tables.

This architecture was creating measurable engineering and business impact:

- **Release velocity** had degraded to three-week cycles. Every change — regardless of scope — required a full regression test pass because module boundaries within the monolith were not enforced. A single-line inventory threshold change required deploying the entire application.
- **Merge conflicts** were a daily occurrence across the five development teams (Commerce, Inventory, Fulfillment, Loyalty, Platform). Teams frequently blocked each other during the integration phase of each release cycle.
- **Scaling limitations** meant the entire application had to be scaled vertically to handle peak traffic (Black Friday, seasonal campaigns), even when the bottleneck was isolated to product search or inventory queries.
- **Technology constraints** tied all teams to .NET Framework 4.x and SQL Server, preventing adoption of purpose-built data stores (e.g., Elasticsearch for search, event stores for inventory audit trails).
- **Onboarding cost** for new engineers averaged four to six weeks due to the complexity and size of the monolith.

The Loyalty Platform had already been extracted to Node.js in 2017 (Phase 2), proving that independent services could integrate successfully with BookStore via REST APIs. The Product Catalogue extraction to .NET Core with Elasticsearch (2018) further validated the approach.

## Decision

We will extract **Inventory Management**, **Product Catalogue** (completing the partial extraction started in Phase 2), and **Order Fulfillment** from the BookStore monolith into independently deployable microservices using the **strangler fig pattern**.

The extraction will follow these principles:

1. **Incremental extraction** — Each bounded context is extracted one at a time, starting with Inventory Management (highest rate of change, clearest domain boundary), followed by Fulfillment, then completing Product Catalogue.

2. **API Gateway routing** — Azure API Management will serve as the routing layer. Traffic is directed to the new microservice for extracted capabilities and to BookStore for everything else. This allows gradual cutover with rollback capability.

3. **Database-per-service** — Each extracted service will own its database (PostgreSQL). Data migration from the shared SQL Server `RetailDB` will be performed per-service, with a transition period where both stores are kept in sync via change data capture.

4. **Event-driven communication** — Extracted services will communicate with BookStore and each other primarily through asynchronous events via RabbitMQ, replacing the direct database queries and stored procedure calls used within the monolith.

5. **Shared nothing** — No shared libraries beyond common infrastructure concerns (logging, telemetry, health checks). Domain logic must not leak across service boundaries.

The target architecture retains BookStore as the owner of cart, checkout, user accounts, payment processing, and administration until these are extracted in subsequent phases.

## Consequences

### Positive

- **Independent deployment cadence** — Extracted services can be deployed multiple times per day without coordinating with other teams. The Inventory team achieved daily deployments within six weeks of extraction.
- **Team autonomy** — Each team owns its service end-to-end (code, database, deployment pipeline, on-call), reducing cross-team dependencies and enabling faster decision-making.
- **Technology flexibility** — Teams can choose the most appropriate technology for their domain. Inventory adopted event sourcing on PostgreSQL; Product Catalogue uses Elasticsearch for the read model. The Recommendation Engine team later built their service on Python/FastAPI with MongoDB.
- **Independent scaling** — Services scale independently based on their specific load profiles. Product Catalogue scales horizontally during search-heavy traffic; Inventory scales during stock-update bursts from warehouse integrations.

### Negative

- **Distributed system complexity** — The team must now manage network partitions, service discovery, circuit breakers, retries, and timeouts. This required investment in shared infrastructure libraries and patterns.
- **Eventual consistency** — Operations that were previously atomic within a single database transaction (e.g., placing an order and reserving stock) now span multiple services. The team adopted the Saga pattern for multi-service workflows, which is more complex to implement and reason about.
- **Observability requirements** — Debugging issues across service boundaries requires distributed tracing. The team adopted OpenTelemetry for instrumentation and Jaeger for trace visualization, adding operational overhead.
- **Data duplication** — Some data is now stored in multiple services (e.g., product summary data in Fulfillment for packing slips). Keeping these projections consistent requires careful event handling and idempotent consumers.

## Alternatives Considered

### Alternative 1: Modular Monolith

Restructure BookStore into well-defined modules with enforced boundaries (separate assemblies, internal access modifiers, module-level integration tests) while retaining a single deployable unit and shared database.

**Rejected because:** While a modular monolith would address some coupling issues, it would not resolve the shared database constraint. The Inventory and Fulfillment teams had fundamentally different data access patterns (event sourcing vs. CRUD) and scaling requirements. The shared SQL Server database was the primary bottleneck, and achieving true module isolation while sharing a database proved impractical in our codebase.

### Alternative 2: Big-Bang Rewrite

Rewrite the entire BookStore application as a suite of microservices from scratch, with a hard cutover on a target date.

**Rejected because:** A big-bang rewrite carried unacceptable risk. Industry data and our own prior experience (a failed POS rewrite in 2013) indicated that full rewrites of systems of this size (320 projects, 15+ years of business logic) typically exceed timelines by 2–3x and introduce regression defects. The strangler fig approach allows us to deliver value incrementally while maintaining the existing system as a safety net.
