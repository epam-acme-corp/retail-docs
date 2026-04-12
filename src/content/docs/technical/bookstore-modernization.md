---
title: "BookStore Modernization Roadmap — .NET Framework 4.8 to .NET 8"
---

# BookStore Modernization Roadmap

This document describes the phased migration plan for the BookStore eCommerce platform from **.NET Framework 4.8** to **.NET 8 LTS**. It covers the migration approach, phase definitions and current status, risk management, and the testing strategy that governs each phase transition.

For the current technical architecture of the BookStore platform, see [BookStore eCommerce Platform — Technical Documentation](bookstore-ecommerce.md).

---

## 1. Modernization Approach

### Strategy: Strangler Fig Pattern

The BookStore modernization follows the **Strangler Fig pattern**, incrementally replacing components of the .NET Framework 4.8 monolith with .NET 8 equivalents while the legacy system continues to serve production traffic. This approach was chosen over a big-bang rewrite for the following reasons:

- **Lower risk** — Production traffic is never fully dependent on unproven code. Each phase delivers a working system.
- **Incremental value** — Modernized components reach production sooner, delivering performance and maintainability improvements throughout the migration rather than only at the end.
- **Rollback capability** — Feature flags enable instant rollback to legacy code paths if a modernized component exhibits issues in production.

The strategic rationale is documented in [ADR-001: Strangler Fig Migration Pattern](../architecture/adr-001-strangler-fig.md).

### Tooling

- **.NET Upgrade Assistant** — Microsoft's automated migration tool is used for initial project file conversion, namespace updates, and API compatibility analysis. Manual intervention is required for areas involving `System.Web` dependencies, Entity Framework 6 → EF Core migration, and custom IIS module replacements.
- **LaunchDarkly Feature Flags** — Every modernized component is deployed behind a feature flag. Flags support percentage-based rollouts, user-segment targeting (e.g., internal users first), and kill-switch behavior. Flag naming convention: `modernization.{phase}.{component}` (e.g., `modernization.phase2.admin-orders`).
- **API Versioning** — New .NET 8 API endpoints are published under `/api/v2/` to coexist with legacy `/api/v1/` endpoints during transition periods.

---

## 2. Migration Phases

### Phase 1: Shared Libraries — ✅ Completed (Q1 2024)

**Objective:** Migrate all shared libraries and common infrastructure code to **.NET Standard 2.0**, enabling consumption by both .NET Framework 4.8 and .NET 8 projects.

**Scope:**

- `Acme.Retail.Common` — Utility classes, extension methods, constants.
- `Acme.Retail.Domain` — Domain models, value objects, enumerations.
- `Acme.Retail.Contracts` — Shared DTOs, event definitions, interface contracts.
- `Acme.Retail.Data.Abstractions` — Repository interfaces, unit-of-work contracts.

**Outcome:** All four libraries compile against .NET Standard 2.0 and are consumed by the legacy .NET Framework 4.8 application and the new .NET 8 Admin Panel without code duplication. NuGet packages are published to the internal Acme Artifacts feed.

**Key Decisions:**

- Entity Framework models were intentionally excluded from the shared libraries because EF6 (.NET Framework) and EF Core 8 (.NET 8) require distinct mapping configurations. Each runtime maintains its own data access layer.
- `System.Text.Json` was adopted as the standard serializer in shared contracts, replacing `Newtonsoft.Json` in new code. A compatibility shim is maintained in the legacy application.

---

### Phase 2: Admin Panel Rebuild — 🔄 In Progress (Q2 2024 → Target Q4 2024)

**Objective:** Rebuild the Admin Panel as a **.NET 8 Blazor Server** application, replacing the legacy Razor-based admin interface.

**Current Progress: 60% Complete**

| Module | Status | Notes |
|---|---|---|
| Product Management | ✅ Complete | Full CRUD, bulk import, image management |
| Category Management | ✅ Complete | Drag-and-drop hierarchy editor |
| Customer Search & Detail | ✅ Complete | Elasticsearch-powered search, profile view |
| Order Management | 🔄 In Progress | Order list and detail views complete; status overrides and refund workflow in development |
| Reporting Dashboards | 📋 Planned | Sales, inventory, and customer analytics dashboards |
| Promotional Pricing | 📋 Planned | Discount rules engine, coupon management |

**Architecture:**

- Blazor Server (.NET 8) with **MudBlazor** component library.
- Entity Framework Core 8 with SQL Server (same database as legacy application).
- Authentication via Microsoft Entra ID (admin users migrated first as the pilot cohort for the Entra ID rollout; see [ADR-003](../architecture/adr-003-entra-id-migration.md)).
- Hosted on AKS alongside the legacy IIS deployment. Azure Application Gateway routes `/admin-v2/*` to the Blazor app.

**Rollback:** The legacy Razor admin remains fully operational at `/admin/*`. The LaunchDarkly flag `modernization.phase2.admin-panel` controls whether admin users are redirected to the Blazor version. Rollback is achieved by disabling the flag.

---

### Phase 3: API Layer Extraction — 📋 Planned (Q1 2025)

**Objective:** Extract the core business logic into a standalone **.NET 8 Minimal API** layer, decoupling the API from the MVC monolith.

**Planned Scope:**

- Rewrite `ProductsController`, `CartController`, `CheckoutController`, `OrdersController`, and `AccountsController` as .NET 8 Minimal API endpoints.
- Introduce **API versioning** (`Asp.Versioning.Http`) with `/api/v2/` prefix. Legacy `/api/v1/` endpoints remain active during the transition.
- Migrate data access from Entity Framework 6 to **Entity Framework Core 8** with compiled queries for high-traffic paths.
- Replace `System.Web.SessionState` with Redis-backed distributed session (removes the sticky-session constraint documented in the [platform technical documentation](bookstore-ecommerce.md#7-performance-characteristics)).
- Implement **OpenAPI 3.1** specification generation with Swashbuckle replacement (`Microsoft.AspNetCore.OpenApi`).

**Dependencies:**

- Phase 1 (shared libraries) — ✅ Complete.
- Phase 2 (Admin Panel) — Partial dependency. The Admin Panel's EF Core 8 data access layer will be reused, but Phase 3 can begin before Phase 2 is fully complete.

---

### Phase 4: Frontend BFF — 📋 Planned (Q2 2025)

**Objective:** Introduce a **.NET 8 Backend-for-Frontend (BFF)** that serves the React 18 SPA, replacing the MVC layout shell and Razor SPA host.

**Planned Scope:**

- .NET 8 BFF using the **YARP reverse proxy** for API routing.
- Server-side rendering (SSR) support for critical pages (product detail, landing pages) to improve SEO and Core Web Vitals.
- BFF handles authentication token management, CSRF protection, and API aggregation for complex frontend views.
- Migrate remaining Razor views (home page, category listing, order history, account management) to React 18 components.
- Consolidate the frontend build pipeline (Vite) with integrated environment configuration injection, removing the `window.__APP_CONFIG__` pattern.

**Dependencies:**

- Phase 3 (API Layer) — Required. The BFF proxies requests to the extracted .NET 8 API layer.

---

### Phase 5: Full Cutover — 📋 Target Q3 2025

**Objective:** Decommission the .NET Framework 4.8 application and IIS infrastructure. All traffic served by .NET 8 on AKS.

**Planned Scope:**

- Remove all .NET Framework 4.8 project files and legacy Razor views from the repository.
- Decommission IIS servers (Windows Server 2019 VMs).
- Consolidate hosting on **AKS** with Kestrel as the web server.
- Complete the Microsoft Entra ID migration — disable ASP.NET Identity login paths.
- Archive legacy LaunchDarkly feature flags.
- Update all CI/CD pipelines to target .NET 8 exclusively.

**Dependencies:**

- All prior phases complete and stable in production.
- Minimum 30-day burn-in period after Phase 4 production rollout with zero critical issues.

---

## 3. Current Status Dashboard

| Phase | Description | Status | Timeline |
|---|---|---|---|
| Phase 1 | Shared Libraries → .NET Standard 2.0 | ✅ Complete | Q1 2024 |
| Phase 2 | Admin Panel → .NET 8 Blazor | 🔄 In Progress (60%) | Q2–Q4 2024 |
| Phase 3 | API Layer → .NET 8 Minimal API | 📋 Planned | Q1 2025 |
| Phase 4 | Frontend BFF → .NET 8 + React 18 | 📋 Planned | Q2 2025 |
| Phase 5 | Full Cutover & IIS Decommission | 📋 Planned | Q3 2025 |

**Overall Progress:** Phase 1 complete. Phase 2 on track. Phases 3–5 in planning; detailed technical designs to be finalized by end of Q4 2024.

---

## 4. Risk Register

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | **Data migration errors** during EF6 → EF Core transition | High | Medium | Parallel read validation: EF Core queries run alongside EF6 with result comparison in staging. Automated data integrity checks in CI pipeline. No direct schema migration — both ORMs target the same schema during transition. |
| R2 | **Session handling in dual-stack** — inconsistent session state between .NET Framework and .NET 8 code paths | Medium | High | Unified Redis session store accessible by both runtimes. Session serialization format standardized on `System.Text.Json`. Integration tests validate cross-runtime session continuity. |
| R3 | **Third-party library incompatibility** — NuGet packages without .NET 8 support | Medium | Medium | Dependency audit completed in Q4 2023. Three libraries identified as at-risk: `DotNetZip` (replaced with `System.IO.Compression`), `RestSharp` v106 (upgraded to v110), `HtmlAgilityPack` (compatible — no action). Remaining dependencies verified against .NET 8 compatibility. |
| R4 | **Performance regression** — .NET 8 code paths slower than .NET Framework equivalents | High | Low | Automated performance benchmarks (BenchmarkDotNet) run in CI for critical paths (product detail, cart operations, checkout). Shadow traffic comparison in staging with < 10% latency variance threshold. Performance gates block promotion to production. |
| R5 | **Extended dual-stack maintenance period** — phases slip, increasing the cost and complexity of maintaining two runtimes | Medium | Medium | Strict phase timelines with go/no-go checkpoints. Maximum allowable dual-stack period: 18 months from Phase 2 start. If Phase 5 is not achievable by Q4 2025, an escalation to the Architecture Review Board is triggered for re-planning. |

---

## 5. Testing Strategy

Each phase transition is governed by a structured testing strategy that must pass before production rollout.

### 5.1 Parallel Running

During Phases 2–4, both legacy and modernized code paths are active in production. Feature flags route traffic between them. For critical flows (checkout, order placement), **shadow traffic** is used to validate the modernized path:

- Production requests are duplicated to the .NET 8 endpoint (read-only; writes are discarded).
- Responses are compared for structural equivalence and data accuracy.
- Discrepancies are logged to a dedicated Azure Log Analytics workspace for analysis.

Shadow traffic is enabled via the LaunchDarkly flag `modernization.shadow-traffic.{component}`.

### 5.2 Contract Testing

**Pact contract tests** validate that the API contracts between the BookStore and its consumers (React SPA, Fulfilment Service, Notification Service, Analytics Pipeline) are preserved during the migration:

- Consumer-driven contracts are defined in the Pact Broker.
- Provider verification runs in CI for every pull request targeting a modernized API endpoint.
- Breaking contract changes block the PR merge.

### 5.3 Performance Benchmarks

Automated performance benchmarks run in the CI pipeline for every PR that modifies a critical code path:

- **BenchmarkDotNet** micro-benchmarks for hot paths (product lookup, cart calculation, price computation).
- **k6 load tests** in the staging environment for end-to-end flows (browse → search → add to cart → checkout).
- Performance regression threshold: **no more than 10% p95 latency increase** compared to the legacy baseline. Violations fail the build.

### 5.4 Rollback via Feature Flags

Every modernized component is deployed behind a LaunchDarkly feature flag with the following rollback protocol:

1. **Canary release** — Flag enabled for 5% of traffic (internal users and opt-in beta customers).
2. **Graduated rollout** — Increase to 25% → 50% → 100% over 2 weeks with monitoring at each stage.
3. **Rollback trigger** — Error rate increase > 0.5%, p95 latency increase > 20%, or any P1 incident. Rollback is executed by disabling the flag (takes effect within 30 seconds).
4. **Bake period** — 100% traffic for 14 days with no rollback triggers before the legacy code path is marked for removal.

### 5.5 Integration and Regression Testing

- **Integration tests** run against a fully provisioned environment (SQL Server, Redis, RabbitMQ, Elasticsearch) using Docker Compose in CI.
- **End-to-end regression suite** (Playwright) covers 47 critical user journeys across the storefront and admin panel.
- **Smoke tests** execute automatically post-deployment in each environment (dev → staging → production) with PagerDuty alerts on failure.

---

## Related Documentation

- [BookStore eCommerce Platform — Technical Documentation](bookstore-ecommerce.md)
- [Architecture Overview](../architecture/overview.md)
- [System Landscape](../architecture/system-landscape.md)
- [ADR-001: Strangler Fig Migration Pattern](../architecture/adr-001-strangler-fig.md)
- [ADR-003: Entra ID Migration Strategy](../architecture/adr-003-entra-id-migration.md)
