---
title: "ADR-003 .NET 8 Modernization Strategy"
---

# ADR-003: Incremental .NET 8 Modernization for BookStore and Payment Module

- **Status:** Accepted
- **Date:** 2024-01-22
- **Deciders:** Sarah Chen (VP Engineering), David Park (Principal Architect), Marcus Rivera (Engineering Manager — Commerce), Priya Mehta (Tech Lead — BookStore), James Okonkwo (Tech Lead — Payments)

## Context

The BookStore monolith and the tightly coupled Payment Module are the two remaining workloads in the Acme Retail platform running on .NET Framework 4.8. All other services (Inventory, Fulfillment, Product Catalogue) were built on or have already migrated to .NET 6 or .NET 7.

Microsoft has confirmed that .NET Framework 4.8 will receive only security patches going forward, with no further feature development. The runtime is not eligible for new performance optimizations, language features (C# 12+), or modern hosting models (Kestrel, minimal APIs, native AOT compilation).

Several factors make this migration urgent:

1. **Performance** — Internal benchmarks using our representative workloads show .NET 8 delivers a 40–60% throughput improvement over .NET Framework 4.8 on equivalent hardware. The BookStore checkout flow, which is CPU-bound during price calculation and tax computation, showed a 52% latency reduction in prototype testing.

2. **Container compatibility** — .NET Framework requires Windows containers, which have larger image sizes (~5 GB vs. ~200 MB for Linux-based .NET 8 images), slower startup times, and limited AKS node pool options. Migrating to .NET 8 enables Linux containers, aligning BookStore with the rest of the platform's deployment model.

3. **Dependency risk** — Several NuGet packages used by BookStore have dropped .NET Framework support in their latest versions, including key libraries for JSON serialization, HTTP client resilience, and OpenTelemetry instrumentation. The team is pinned to older package versions with known vulnerabilities.

4. **Developer experience** — Engineers working on BookStore cannot use C# 12 features (primary constructors, collection expressions), minimal APIs, or the simplified hosting model. Recruitment feedback indicates that .NET Framework experience is increasingly rare among candidates, extending hiring timelines.

5. **Operational alignment** — The Platform team maintains separate CI/CD pipelines, monitoring dashboards, and deployment procedures for IIS-hosted .NET Framework applications vs. AKS-hosted .NET 6+ services. Converging on a single hosting model reduces operational overhead significantly.

## Decision

We will incrementally modernize the BookStore monolith and Payment Module from .NET Framework 4.8 to .NET 8 using a combination of the **.NET Upgrade Assistant** tool and manual refactoring, executed in five phases over approximately 12 months.

### Phase 1: Shared Libraries (Q1 2024) ✅ Complete

Migrate all shared libraries (`Acme.Retail.Common`, `Acme.Retail.Data`, `Acme.Retail.Messaging`, `Acme.Retail.Security`) to target both .NET Standard 2.0 and .NET 8 via multi-targeting. This ensures compatibility with both the existing .NET Framework application and the migrated .NET 8 components during the transition period.

### Phase 2: Admin Panel (Q2–Q3 2024) ✅ Complete

Extract the back-office administration module from BookStore and rebuild it as a standalone .NET 8 application with a React 18 frontend. The Admin Panel has relatively few dependencies on the BookStore core and serves internal users only, making it a low-risk candidate for early migration. Deploy to AKS with Kestrel hosting.

### Phase 3: API Layer Extraction (Q1–Q2 2025) 🔄 In Progress

Extract the BookStore REST API layer into a .NET 8 application using minimal APIs. The API layer handles all client-facing HTTP endpoints (product browsing, cart, checkout, user accounts). During this phase, the API layer will be deployed alongside the existing BookStore IIS application, with Azure API Management routing traffic based on feature flags managed through LaunchDarkly.

**Traffic routing strategy:**

- Feature flag `bookstore-api-v2` controls the percentage of traffic routed to the new .NET 8 API layer
- Initial rollout: 5% of traffic (canary), monitored for error rates, latency percentiles, and business metrics (conversion rate, cart abandonment)
- Gradual ramp-up: 5% → 25% → 50% → 100% over 4–6 weeks per endpoint group
- Instant rollback capability: setting the feature flag to 0% routes all traffic back to the .NET Framework application

### Phase 4: Frontend BFF (Q3 2025) 📋 Planned

Introduce a Backend-for-Frontend (BFF) layer on .NET 8 that aggregates data from multiple backend services (Product Catalogue, Inventory, BookStore API, Recommendation Engine) to serve the React 18 SPA. This replaces the current pattern where the frontend makes multiple API calls and composes data client-side, reducing page load times and simplifying frontend logic.

### Phase 5: Full Cutover and Decommission (Q4 2025) 📋 Planned

Decommission the .NET Framework BookStore application and the IIS hosting infrastructure. All traffic is served by .NET 8 services on AKS. The Payment Module extraction (separate initiative) is expected to complete during this phase, removing the last .NET Framework dependency.

### Key Technical Decisions Within the Migration

- **ORM migration** — Entity Framework 6 (used in BookStore) will be migrated to Entity Framework Core 8. Complex stored procedures that cannot be practically migrated will be accessed via raw SQL through EF Core's `FromSqlRaw` until they can be refactored.
- **Authentication** — ASP.NET Identity on .NET Framework will be migrated to ASP.NET Core Identity. User password hashes are compatible across versions; no forced password resets are required.
- **Configuration** — `web.config` / `app.config` will be replaced with `appsettings.json` and environment variables, following the twelve-factor app methodology. Secrets are managed via Azure Key Vault.
- **Dependency injection** — The existing Autofac container will be replaced with the built-in .NET 8 dependency injection container. Autofac-specific features (named registrations, decorator support) will be refactored to use standard patterns.

## Consequences

### Positive

- **Performance gains** — The .NET 8 runtime delivers measurable throughput and latency improvements. The Admin Panel (Phase 2) showed a 47% reduction in P95 response time after migration, consistent with benchmark predictions.
- **Container-native deployment** — Linux containers on AKS enable consistent deployment, scaling, and observability across all services. BookStore engineers now use the same Helm charts, Flux GitOps workflows, and Grafana dashboards as the rest of the platform.
- **Modern language features** — Teams can use C# 12, minimal APIs, and the simplified hosting model, improving developer productivity and code readability.
- **Unified dependency management** — All services target the same .NET runtime, eliminating the split NuGet package strategy and enabling consistent security patching across the platform.
- **Recruiting advantage** — Job postings for .NET 8 positions attract significantly more qualified candidates than .NET Framework roles.

### Negative

- **Dual-stack operational overhead** — For approximately 6–12 months (Phases 3–5), the team must maintain both .NET Framework (IIS) and .NET 8 (AKS/Kestrel) deployments of BookStore components. This doubles the deployment pipeline complexity and requires feature flag coordination for traffic routing.
- **Library replacements** — Several .NET Framework-specific libraries (e.g., `System.Web` dependencies, WCF client proxies, certain Windows-specific NuGet packages) have no direct .NET 8 equivalent. These require replacement with modern alternatives, involving code changes and regression testing.
- **Testing matrix expansion** — During the transition period, critical user journeys must be validated against both the .NET Framework and .NET 8 code paths. The QA team estimated a 2x increase in end-to-end test execution time during Phases 3 and 4, which was mitigated by investing in parallelized test execution on GitHub Actions.
- **Team cognitive load** — Engineers working on BookStore must be proficient in both .NET Framework and .NET 8 patterns during the transition. The team invested in a structured training program (40 hours per engineer) and paired programming sessions to accelerate skill transfer.

## Alternatives Considered

### Alternative 1: Full Rewrite on .NET 8

Rewrite the BookStore monolith from scratch as a suite of .NET 8 microservices, discarding the existing codebase entirely.

**Rejected because:** The BookStore codebase contains approximately 15 years of business logic, edge-case handling, and integration workarounds that are difficult to specify, let alone reimplement from scratch. A full rewrite was estimated at 18–24 months with a dedicated team of 12 engineers, during which the existing application would need to be maintained in parallel with no feature development. The risk of regression defects and business logic loss was deemed unacceptable. The incremental approach allows the team to deliver value continuously while validating each migration phase before proceeding.

### Alternative 2: Containerize .NET Framework As-Is

Package the existing .NET Framework 4.8 application in Windows containers and deploy it to AKS, deferring the runtime migration indefinitely.

**Rejected because:** While this approach would move BookStore to AKS, it would not address any of the underlying technical debt: Windows container images remain large (~5 GB), startup times are slow (45–60 seconds vs. ~5 seconds for .NET 8 Linux containers), the .NET Framework performance ceiling remains, and the dependency on unmaintained library versions persists. This approach delays the inevitable migration while adding Windows node pool management complexity to the AKS cluster. It was viewed as adding cost without addressing root causes.
