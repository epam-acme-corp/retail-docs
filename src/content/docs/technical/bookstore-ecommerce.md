---
title: "BookStore eCommerce Platform — Technical Documentation"
---

# BookStore eCommerce Platform — Technical Documentation

This document is the authoritative technical reference for the BookStore eCommerce platform, Acme Retail's primary direct-to-consumer online storefront. It covers the system architecture, core modules, database design, authentication model, search infrastructure, caching strategy, and production performance characteristics.

---

## 1. Architecture Overview

The BookStore platform is an **ASP.NET MVC monolith** originally built on **.NET Framework 4.8**, hosted on **IIS 10 (Windows Server 2019)**. Over the past two years, the application has been undergoing incremental modernization toward **.NET 8**, with a planned migration to **Kestrel on Azure Kubernetes Service (AKS)** as the target hosting model.

### Runtime and Hosting

| Component | Current State | Target State |
|---|---|---|
| Runtime | .NET Framework 4.8 | .NET 8 LTS |
| Web Server | IIS 10 (Windows Server 2019) | Kestrel on AKS |
| Frontend | Razor Views + React 18 SPA | React 18 SPA (full) |
| Primary Database | SQL Server 2019 | SQL Server 2019 (retained) |
| Session / Cache | Redis 7 Cluster | Redis 7 Cluster (retained) |
| Feature Flags | LaunchDarkly | LaunchDarkly (retained) |

### Frontend Coexistence Model

The frontend follows a hybrid rendering model during the migration period. Legacy pages — including the home page, category listing, and account management screens — continue to use **server-rendered Razor views** with jQuery for interactivity. New and rebuilt pages use a **React 18 Single Page Application** embedded within the MVC layout shell:

- **Product Detail v2** — React 18 component with image zoom, variant selection, and real-time stock indicators.
- **Enhanced Checkout** — React 18 multi-step flow with client-side validation, address autocomplete (Google Places API), and Stripe Elements integration.

React pages are bootstrapped via a shared Razor `_SpaLayout.cshtml` that injects configuration (API base URL, feature flags, user context) into a `window.__APP_CONFIG__` object. React bundles are served from Azure Front Door CDN.

### Inter-Service Communication

The BookStore publishes domain events to **RabbitMQ 3.12** for downstream consumers (Fulfilment, Notifications, Analytics). It delegates product search to the **Product Catalogue** service via synchronous HTTP and consumes cache-invalidation events from the same service. **LaunchDarkly** feature flags govern traffic routing between legacy and modernized code paths, enabling gradual rollouts and instant rollback.

---

## 2. Key Modules

### 2.1 Product Browsing

| Attribute | Detail |
|---|---|
| **Responsibilities** | Category navigation, product listing pages, product detail rendering, image galleries, breadcrumb generation |
| **Key Endpoints** | `GET /products/{slug}`, `GET /categories/{id}`, `GET /api/v1/products/{id}` (React), `GET /api/v1/categories/tree` |
| **Status** | Legacy Razor views for category listing; **Product Detail v2** modernized to React 18 |

Product Browsing renders the storefront catalog. Category navigation uses a self-referencing hierarchy (see `Categories` table below) and is cached in Redis as a serialized tree with a 1-hour TTL. Product detail pages display pricing, availability, image galleries (served via Cloudinary transforms), and related product recommendations.

Full-text product search is **delegated to the Product Catalogue** service, which exposes an Elasticsearch-backed search API. The BookStore does not perform search indexing itself — it acts as a consumer of the Product Catalogue search endpoint.

### 2.2 Shopping Cart

| Attribute | Detail |
|---|---|
| **Responsibilities** | Add/remove/update cart items, quantity validation, price recalculation, cross-device cart persistence, guest cart management |
| **Key Endpoints** | `POST /api/v1/cart/items`, `PUT /api/v1/cart/items/{id}`, `DELETE /api/v1/cart/items/{id}`, `GET /api/v1/cart` |
| **Status** | Server-side implementation with Redis-backed session — **modernized** |

The Shopping Cart is managed server-side. For **authenticated users**, the cart is persisted to the `CartItems` table in SQL Server, enabling cross-device persistence. When a user logs in, any guest cart items are merged into their persistent cart (last-write-wins on quantity conflicts).

For **guest users**, the cart is stored in Redis keyed by a session identifier. A first-party cookie (`_bsc_sid`, 30-day expiry, `SameSite=Lax`) tracks the session across requests. Cart state is also cached in Redis for authenticated users to avoid repeated database reads during a browsing session.

Price recalculation occurs on every cart read to ensure the displayed total reflects current catalog prices. If a price has changed since the item was added, a `PriceChanged` notification is surfaced in the cart UI.

### 2.3 Checkout Flow

| Attribute | Detail |
|---|---|
| **Responsibilities** | Multi-step checkout orchestration, shipping address selection, delivery method selection, payment processing, order review, order confirmation |
| **Key Endpoints** | `POST /api/v1/checkout/start`, `PUT /api/v1/checkout/shipping`, `PUT /api/v1/checkout/delivery`, `POST /api/v1/checkout/payment`, `POST /api/v1/checkout/confirm` |
| **Status** | **Modernized** — React 18 Enhanced Checkout |

Checkout follows a five-step linear flow:

1. **Shipping** — Select or enter a shipping address. Authenticated users can choose from their address book. Address validation via SmartyStreets API.
2. **Delivery** — Select delivery speed (Standard 5–7 days, Express 2–3 days, Next Day). Rates retrieved from the Fulfilment service.
3. **Payment** — Stripe Elements embedded form. Creates a Stripe `PaymentIntent` with `capture_method=manual` (authorized but not captured until fulfilment confirms shipment).
4. **Review** — Summary of all selections. Final price breakdown including tax (calculated via Avalara AvaTax).
5. **Confirmation** — Order is created, `OrderPlaced` event published to RabbitMQ, confirmation email triggered.

Checkout state is stored in Redis with a 2-hour TTL, keyed by session or customer ID. If the user abandons checkout, the state is available for recovery on return.

### 2.4 Order Management

| Attribute | Detail |
|---|---|
| **Responsibilities** | Order history display, order detail view, shipment tracking, order cancellation, return initiation |
| **Key Endpoints** | `GET /api/v1/orders`, `GET /api/v1/orders/{id}`, `POST /api/v1/orders/{id}/cancel`, `GET /api/v1/orders/{id}/tracking` |
| **Status** | Legacy Razor views — **planned for React migration in Phase 4** |

Order Management provides customers with visibility into their purchase history and order status. Orders transition through the following states: `Pending` → `PaymentAuthorized` → `Processing` → `Shipped` → `Delivered` (or `Cancelled` / `ReturnRequested`).

When an order is placed, the module publishes an `OrderPlaced` event to the `orders.placed` RabbitMQ exchange (fanout). Downstream consumers include:

- **Fulfilment Service** — picks, packs, and ships the order.
- **Notification Service** — sends confirmation and shipping update emails.
- **Analytics Pipeline** — records the order for reporting and recommendation engine training.

Cancellation is permitted only for orders in `Pending` or `PaymentAuthorized` states. Cancellation triggers a `PaymentIntent` cancellation on Stripe and publishes an `OrderCancelled` event.

### 2.5 User Accounts

| Attribute | Detail |
|---|---|
| **Responsibilities** | User registration, login/logout, profile management, address book, password reset, loyalty tier display |
| **Key Endpoints** | `POST /api/v1/accounts/register`, `POST /api/v1/accounts/login`, `GET /api/v1/accounts/profile`, `PUT /api/v1/accounts/addresses` |
| **Status** | Legacy ASP.NET Identity on SQL Server — **migrating to Microsoft Entra ID** |

User Accounts handles identity and profile management. The current implementation uses **ASP.NET Identity** with SQL Server as the backing store. Passwords are hashed with PBKDF2 (ASP.NET Identity v2 default).

A migration to **Microsoft Entra ID** (formerly Azure AD) is underway to enable single sign-on (SSO) across Acme Retail properties. During the transition period, a dual-authentication stack is active: existing users authenticate via ASP.NET Identity, while new SSO-enabled accounts authenticate via Entra ID. A LaunchDarkly feature flag (`entra-id-login`) controls which authentication path is presented. See Section 4 for details.

### 2.6 Admin Panel

| Attribute | Detail |
|---|---|
| **Responsibilities** | Product CRUD, inventory adjustments, order management and status overrides, customer lookup, sales reporting, promotional pricing |
| **Key Endpoints** | `/admin/*` (Razor), `/admin-v2/*` (.NET 8 Blazor — in progress) |
| **Status** | **Actively being rebuilt** as a .NET 8 Blazor Server application (60% complete) |

The Admin Panel is the first module being fully rebuilt on .NET 8 as part of the modernization initiative. The new Blazor Server application uses **MudBlazor** for the component library and connects to the same SQL Server database via Entity Framework Core 8. The legacy Razor admin remains operational in parallel; feature flags route admin users to the Blazor version on a per-feature basis.

Completed Blazor modules: Product management, Category management, Customer search.
In progress: Order management, Reporting dashboards.

---

## 3. Database Schema

The BookStore uses **SQL Server 2019** as its primary relational store. The database is hosted on a two-node Always On Availability Group for high availability, with read replicas used for reporting queries.

### 3.1 Core Tables

#### Products

```sql
CREATE TABLE [dbo].[Products] (
    [ProductId]    INT            IDENTITY(1,1) NOT NULL PRIMARY KEY CLUSTERED,
    [SKU]          NVARCHAR(50)   NOT NULL,
    [Name]         NVARCHAR(256)  NOT NULL,
    [Description]  NVARCHAR(MAX)  NULL,
    [Price]        DECIMAL(18,2)  NOT NULL,
    [CategoryId]   INT            NOT NULL FOREIGN KEY REFERENCES [dbo].[Categories]([CategoryId]),
    [IsActive]     BIT            NOT NULL DEFAULT 1,
    [CreatedDate]  DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    [ModifiedDate] DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE NONCLUSTERED INDEX [IX_Products_SKU] ON [dbo].[Products]([SKU]);
```

#### Categories

```sql
CREATE TABLE [dbo].[Categories] (
    [CategoryId]       INT           IDENTITY(1,1) NOT NULL PRIMARY KEY CLUSTERED,
    [Name]             NVARCHAR(128) NOT NULL,
    [ParentCategoryId] INT           NULL FOREIGN KEY REFERENCES [dbo].[Categories]([CategoryId]),
    [SortOrder]        INT           NOT NULL DEFAULT 0,
    [IsActive]         BIT           NOT NULL DEFAULT 1
);
```

#### Orders

```sql
CREATE TABLE [dbo].[Orders] (
    [OrderId]            INT            IDENTITY(1,1) NOT NULL PRIMARY KEY CLUSTERED,
    [CustomerId]         INT            NOT NULL FOREIGN KEY REFERENCES [dbo].[Customers]([CustomerId]),
    [OrderDate]          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    [Status]             TINYINT        NOT NULL DEFAULT 0,  -- 0=Pending, 1=PaymentAuthorized, 2=Processing, 3=Shipped, 4=Delivered, 5=Cancelled, 6=ReturnRequested
    [ShippingAddressId]  INT            NOT NULL FOREIGN KEY REFERENCES [dbo].[Addresses]([AddressId]),
    [SubTotal]           DECIMAL(18,2)  NOT NULL,
    [Tax]                DECIMAL(18,2)  NOT NULL,
    [ShippingCost]       DECIMAL(18,2)  NOT NULL,
    [Total]              DECIMAL(18,2)  NOT NULL,
    [PaymentIntentId]    NVARCHAR(128)  NULL
);
CREATE NONCLUSTERED INDEX [IX_Orders_CustomerId] ON [dbo].[Orders]([CustomerId]);
CREATE NONCLUSTERED INDEX [IX_Orders_OrderDate] ON [dbo].[Orders]([OrderDate] DESC);
```

#### OrderItems

```sql
CREATE TABLE [dbo].[OrderItems] (
    [OrderItemId] INT           IDENTITY(1,1) NOT NULL PRIMARY KEY CLUSTERED,
    [OrderId]     INT           NOT NULL FOREIGN KEY REFERENCES [dbo].[Orders]([OrderId]),
    [ProductId]   INT           NOT NULL FOREIGN KEY REFERENCES [dbo].[Products]([ProductId]),
    [Quantity]    INT           NOT NULL,
    [UnitPrice]   DECIMAL(18,2) NOT NULL,
    [Discount]    DECIMAL(18,2) NOT NULL DEFAULT 0
);
CREATE NONCLUSTERED INDEX [IX_OrderItems_OrderId] ON [dbo].[OrderItems]([OrderId]);
```

#### Customers

```sql
CREATE TABLE [dbo].[Customers] (
    [CustomerId]    INT            IDENTITY(1,1) NOT NULL PRIMARY KEY CLUSTERED,
    [Email]         NVARCHAR(256)  NOT NULL,
    [PasswordHash]  NVARCHAR(512)  NULL,
    [FirstName]     NVARCHAR(128)  NOT NULL,
    [LastName]      NVARCHAR(128)  NOT NULL,
    [LoyaltyTierId] INT           NULL,
    [CreatedDate]   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE NONCLUSTERED INDEX [IX_Customers_Email] ON [dbo].[Customers]([Email]);
```

#### Addresses

```sql
CREATE TABLE [dbo].[Addresses] (
    [AddressId]  INT           IDENTITY(1,1) NOT NULL PRIMARY KEY CLUSTERED,
    [CustomerId] INT           NOT NULL FOREIGN KEY REFERENCES [dbo].[Customers]([CustomerId]),
    [Line1]      NVARCHAR(256) NOT NULL,
    [Line2]      NVARCHAR(256) NULL,
    [City]       NVARCHAR(128) NOT NULL,
    [State]      NVARCHAR(64)  NOT NULL,
    [ZipCode]    NVARCHAR(20)  NOT NULL,
    [Country]    NVARCHAR(64)  NOT NULL DEFAULT 'US',
    [IsDefault]  BIT           NOT NULL DEFAULT 0
);
CREATE NONCLUSTERED INDEX [IX_Addresses_CustomerId] ON [dbo].[Addresses]([CustomerId]);
```

#### CartItems

```sql
CREATE TABLE [dbo].[CartItems] (
    [CartItemId] INT           IDENTITY(1,1) NOT NULL PRIMARY KEY CLUSTERED,
    [SessionId]  NVARCHAR(128) NULL,
    [CustomerId] INT           NULL FOREIGN KEY REFERENCES [dbo].[Customers]([CustomerId]),
    [ProductId]  INT           NOT NULL FOREIGN KEY REFERENCES [dbo].[Products]([ProductId]),
    [Quantity]   INT           NOT NULL DEFAULT 1,
    [AddedDate]  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE NONCLUSTERED INDEX [IX_CartItems_SessionId] ON [dbo].[CartItems]([SessionId]) WHERE [SessionId] IS NOT NULL;
CREATE NONCLUSTERED INDEX [IX_CartItems_CustomerId] ON [dbo].[CartItems]([CustomerId]) WHERE [CustomerId] IS NOT NULL;
```

### 3.2 Index Strategy

All primary keys use **clustered indexes** (identity columns). Key non-clustered indexes target the most frequent query patterns:

- `IX_Customers_Email` (unique) — login lookup and duplicate detection.
- `IX_Products_SKU` (unique) — inventory and fulfilment system integration.
- `IX_Orders_OrderDate` (descending) — order history pagination.
- `IX_Orders_CustomerId` — customer order history lookups.
- `IX_CartItems_SessionId` / `IX_CartItems_CustomerId` — filtered indexes for cart retrieval (guest vs. authenticated).

### 3.3 Table Volume (Production)

| Table | Approximate Row Count | Growth Rate |
|---|---|---|
| Products | ~500,000 | ~2,000/month |
| Categories | ~1,200 | Stable |
| Customers | ~3,000,000 | ~50,000/month |
| Orders | ~12,000,000 | ~200,000/month |
| OrderItems | ~36,000,000 | ~600,000/month |
| Addresses | ~4,500,000 | ~60,000/month |
| CartItems | ~800,000 active | High churn; purged weekly |

---

## 4. Authentication and Authorization

### Current Model

The application currently uses **ASP.NET Identity 2.0** backed by SQL Server. Authentication is cookie-based for browser sessions (`_bsc_auth`, `HttpOnly`, `Secure`, `SameSite=Strict`, 24-hour sliding expiration). Service-to-service calls (e.g., from the Fulfilment Service) use **JWT bearer tokens** issued by an internal token service with RS256 signing.

### Entra ID Migration

A migration to **Microsoft Entra ID** is in progress to enable SSO across all Acme Retail digital properties (BookStore, Loyalty Portal, Mobile App). The migration follows a dual-stack approach:

1. **Existing accounts** continue to authenticate via ASP.NET Identity.
2. **New accounts** and opt-in migrations authenticate via Microsoft Entra ID using OpenID Connect (OIDC).
3. A LaunchDarkly feature flag (`entra-id-login`) governs which login flow is presented. The flag supports percentage-based rollout.
4. Upon successful Entra ID login, the application checks for a matching `Customers.Email` record and links the Entra ID object ID to the existing customer profile.

The dual-stack period is projected to last through Phase 4 of the modernization roadmap (see `bookstore-modernization.md`).

### Role Model

| Role | Description | Access Level |
|---|---|---|
| `Customer` | Default role for all registered users | Storefront, own orders, profile |
| `StoreManager` | Regional store operations staff | Admin panel (read + limited write), order management |
| `Admin` | Central operations team | Full admin panel access, customer management |
| `SuperAdmin` | Engineering and platform team | All permissions, feature flag overrides, system configuration |

Role claims are included in both cookie and JWT authentication tickets. Authorization is enforced at the controller level using `[Authorize(Roles = "...")]` attributes and policy-based authorization for fine-grained rules.

---

## 5. Search Infrastructure

### Legacy (Being Decommissioned)

The original search implementation used **SQL Server Full-Text Search** on the `Products` table (`Name` and `Description` columns). This approach is being phased out but remains active as a degraded fallback if the Product Catalogue service is unavailable.

### Current Architecture

Product search is **delegated to the Product Catalogue service**, which maintains an **Elasticsearch 8.x** index of the full product catalog. The BookStore calls the Product Catalogue search API synchronously:

```
GET https://product-catalogue.internal.acme.com/api/v2/search?q={query}&facets=category,author,format,price_range&page={page}&size=24
```

### Search Features

- **Full-text search** — Elasticsearch `multi_match` across product name, description, author, and ISBN fields with boosted relevance on name and author.
- **Faceted navigation** — Dynamic facets for category, author, format (hardcover, paperback, ebook, audiobook), price range, and customer rating.
- **Autocomplete** — Elasticsearch `completion` suggester with edge n-gram tokenization. Results returned within 50ms target.
- **Spell correction** — Elasticsearch `phrase` suggester with `did_you_mean` responses for queries with low result counts.

### Resilience

The BookStore implements a **circuit breaker** (Polly library) on the Product Catalogue search client. If the Product Catalogue is unavailable or latency exceeds 2 seconds, the circuit opens and search falls back to an **Algolia** index that is kept in sync via a separate indexing pipeline. The Algolia fallback provides core search functionality (full-text + category facets) but does not support the full facet set.

---

## 6. Caching Strategy

### Redis 7 Cluster

The BookStore uses a **Redis 7 cluster** (3 primary + 3 replica nodes, hosted on Azure Cache for Redis Premium tier) for multiple caching concerns:

| Cache Concern | Key Pattern | TTL | Invalidation |
|---|---|---|---|
| Session State | `session:{sessionId}` | 30 minutes sliding | Explicit logout / expiry |
| Product Detail | `product:{productId}` | 15 minutes | `ProductUpdated` RabbitMQ event |
| Category Tree | `categories:tree` | 1 hour | `CategoryUpdated` RabbitMQ event |
| Shopping Cart | `cart:{sessionId}` or `cart:user:{customerId}` | 2 hours | Explicit modification / checkout |
| Product Pricing | `pricing:{productId}` | 10 minutes | `PriceChanged` RabbitMQ event |

### Cache Invalidation

Cache invalidation is event-driven. The Product Catalogue service publishes `ProductUpdated`, `PriceChanged`, and `CategoryUpdated` events to RabbitMQ. The BookStore consumes these events and invalidates the corresponding Redis keys. This ensures that cached data is refreshed within seconds of a catalog change, without relying on TTL expiry alone.

For high-traffic events (e.g., bulk price updates during a promotional campaign), invalidation is batched with a 500ms debounce window to avoid cache stampede.

### CDN and Image Delivery

- **Azure Front Door** serves static assets (JavaScript bundles, CSS, fonts) with 24-hour cache TTL and cache purge on deployment.
- **Cloudinary** hosts and transforms product images. Image URLs include transformation parameters (resize, format negotiation via `f_auto`, quality optimization via `q_auto`). Cloudinary edge caching provides sub-100ms image delivery globally.

---

## 7. Performance Characteristics

### Current Production Metrics

| Metric | Current Value | Target |
|---|---|---|
| Average page load (LCP) | 1.8 seconds | < 1.5 seconds |
| API response time (p95) | 250 ms | < 200 ms |
| API response time (p99) | 480 ms | < 400 ms |
| Peak concurrent users | 15,000 (Black Friday 2024) | 25,000 (Black Friday 2025) |
| Database connection pool | 200 max | Under review |
| Redis operations/sec (peak) | ~45,000 | Capacity for ~80,000 |
| Error rate (5xx) | 0.12% | < 0.1% |

### Scaling Constraints

The primary scaling bottleneck in the current architecture is **in-process session state** in the legacy .NET Framework code paths. Although Redis-backed session state has been implemented for modernized modules, several legacy Razor views still rely on `System.Web.SessionState`, which is tied to the IIS worker process. This prevents true horizontal scaling of the legacy tier — sticky sessions (ARR affinity) are required on the Azure Application Gateway.

The Redis session migration (tracked as part of Phase 3 in the modernization roadmap) will eliminate this constraint, enabling stateless horizontal scaling across all code paths.

### Monitoring and Observability

- **Application Performance Monitoring** — Azure Application Insights with custom telemetry for checkout funnel drop-off, search latency, and cache hit ratios.
- **Infrastructure Monitoring** — Azure Monitor for VM, AKS, Redis, and SQL Server metrics.
- **Alerting** — PagerDuty integration with tiered severity (P1: checkout failure rate > 1%, P2: API p95 > 500ms, P3: cache hit ratio < 80%).
- **Logging** — Structured logging via Serilog, shipped to Azure Log Analytics workspace. Correlation IDs propagated across HTTP calls for distributed tracing.

---

## Related Documentation

- [BookStore Modernization Roadmap](bookstore-modernization.md)
- [System Landscape](../architecture/system-landscape.md)
- [Architecture Overview](../architecture/overview.md)
- [API Standards](../api/standards.md)
- [ADR-001: Strangler Fig Migration Pattern](../architecture/adr-001-strangler-fig.md)
- [ADR-003: Entra ID Migration Strategy](../architecture/adr-003-entra-id-migration.md)
