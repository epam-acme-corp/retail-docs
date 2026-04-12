---
title: "API Landscape Overview"
---

# API Landscape Overview

Acme Retail exposes a suite of internal and external APIs that power the BookStore eCommerce platform, point-of-sale integrations, mobile applications, and partner ecosystems. This document provides a high-level map of every API surface, describes the authentication mechanisms in use, explains the versioning strategy, and defines the rate-limiting policies enforced by Azure API Management.

For detailed endpoint contracts, see the individual API reference pages linked from the landscape table. For the broader system context, refer to [Architecture Overview](../architecture/overview.md) and [System Landscape](../technical/system-landscape.md).

---

## API Landscape Map

The following table lists every API service maintained by Acme Retail engineering. The estate currently comprises approximately 45 endpoints distributed across seven services.

| Service | Base URL | Style | Exposure | Primary Consumers | Approx. Endpoints |
|---|---|---|---|---|---|
| **BookStore eCommerce** | `https://api.acmeretail.com/store/v1` | REST | Public | Web storefront, Mobile apps, Third-party affiliates | 18 |
| **Product Catalogue** | `https://api.acmeretail.com/catalog/v1` | REST | Internal | BookStore, POS, Recommendation Engine | 8 |
| **Inventory Management** | `https://api.acmeretail.com/inventory/v1` | REST | Internal | BookStore, Fulfillment, POS | 6 |
| **Order Fulfillment** | `https://api.acmeretail.com/fulfillment/v1` | REST | Internal | BookStore, Distribution WMS | 5 |
| **Loyalty Platform** | `https://api.acmeretail.com/loyalty/v1` | REST | Internal + Partner | BookStore, Mobile app, Campaign tools | 4 |
| **Recommendation Engine** | `https://api.acmeretail.com/recommendations/v1` | REST | Internal | BookStore, Email service, Mobile app | 2 |
| **Payment Module** | `https://api.acmeretail.com/payments/v1` | REST | Internal | BookStore checkout only | 2 |

### Service Ownership

Each service is owned by a dedicated squad within Acme Retail Engineering. Ownership includes on-call responsibility, schema governance, and consumer onboarding. Ownership details are maintained in the internal service registry and in each service's individual technical documentation (see `../technical/`).

### Environment URLs

| Environment | Base Domain | Purpose |
|---|---|---|
| Production | `api.acmeretail.com` | Live customer-facing traffic |
| Staging | `api-staging.acmeretail.com` | Pre-release validation, partner integration testing |
| Development | `api-dev.acmeretail.com` | Engineering development and automated tests |

All environments sit behind Azure API Management and share identical authentication and rate-limiting configurations, except that staging and development have relaxed rate limits for load-testing windows.

---

## Authentication

Acme Retail uses three distinct authentication models depending on the caller type. All token issuance and validation is managed through Microsoft Entra ID (formerly Azure AD).

### Internal Service-to-Service

Internal APIs authenticate using the **OAuth 2.0 client credentials** grant. Each service is registered as an application in Microsoft Entra ID and requests tokens with the `client_credentials` grant type against the target API's resource identifier.

- **Grant type**: `client_credentials`
- **Token endpoint**: `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`
- **Scope**: `api://{service-app-id}/.default`
- **Token lifetime**: 60 minutes (non-refreshable; services request a new token before expiry)
- **Transport**: TLS 1.2+ mandatory on all internal calls

Services cache tokens locally using the `Microsoft.Identity.Web` library and refresh them proactively at the 75 % lifetime mark to avoid clock-skew failures.

### Customer-Facing (BookStore Web & Mobile)

Customer-facing applications authenticate end users via the **OAuth 2.0 authorization code flow with PKCE** (Proof Key for Code Exchange). This is the recommended flow for public clients (SPAs, mobile apps) where a client secret cannot be stored securely.

- **Grant type**: `authorization_code` with PKCE
- **Authorization endpoint**: `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize`
- **Token endpoint**: `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`
- **Access token lifetime**: 1 hour
- **Refresh token lifetime**: 30 days (sliding window; revoked on password change or explicit sign-out)
- **Scopes**: `openid profile email api://bookstore/Orders.Read api://bookstore/Orders.Write api://bookstore/Profile.ReadWrite`

Guest checkout sessions use an anonymous session token issued by the BookStore BFF (Backend for Frontend). These tokens grant access only to cart and checkout endpoints and expire after 4 hours.

### Third-Party Partners

External partners (affiliate networks, marketplace integrators) authenticate with a combination of **API key and IP allowlisting**.

- **API key**: Issued per partner via the Acme Retail Partner Portal. Keys are rotated every 90 days.
- **IP allowlisting**: Partners must register the CIDR blocks from which they will call the API. Requests from non-allowlisted IPs receive `403 Forbidden`.
- **Header**: `X-Api-Key: {key}`
- **Rate limits**: Partner-specific (see Rate Limiting section below).

### Token Validation

All API gateway nodes validate incoming JWTs before forwarding requests to backend services. Validation checks include:

| Check | Detail |
|---|---|
| **Signature** | Verified against the JWKS endpoint: `https://login.microsoftonline.com/{tenantId}/discovery/v2.0/keys` |
| **Audience (`aud`)** | Must match the registered application URI of the target service |
| **Issuer (`iss`)** | Must be `https://login.microsoftonline.com/{tenantId}/v2.0` |
| **Scopes (`scp` / `roles`)** | Must include the scope required by the specific endpoint |
| **Expiration (`exp`)** | Token must not be expired; a 5-minute clock-skew tolerance is applied |

Tokens that fail any of these checks receive a `401 Unauthorized` response with a `WWW-Authenticate` header describing the failure reason.

---

## API Versioning Strategy

### Versioning Scheme

Acme Retail uses **URL path versioning**. The version segment appears immediately after the service name:

```
https://api.acmeretail.com/{service}/v{major}/...
```

Examples:

- `https://api.acmeretail.com/store/v1/products`
- `https://api.acmeretail.com/catalog/v2/products` *(planned)*

Only major versions are expressed in the URL. Minor and patch changes are deployed in-place within the current major version.

### Version Lifecycle

Every API version moves through three stages:

| Stage | Description | Support Level |
|---|---|---|
| **Active** | Current recommended version. Receives new features, bug fixes, and security patches. | Full |
| **Deprecated** | Superseded by a newer major version. Enters a **12-month sunset period** during which only critical security fixes are applied. Responses include a `Sunset` header and a `Deprecation` header per RFC 8594. | Security fixes only |
| **Retired** | No longer available. All requests return `410 Gone` with a JSON body directing callers to the successor version. | None |

### Current Version Status

| Service | Active Version | Notes |
|---|---|---|
| BookStore eCommerce | v1 | — |
| Product Catalogue | v1 | v2 in development; adds GraphQL support for complex queries |
| Inventory Management | v1 | — |
| Order Fulfillment | v1 | — |
| Loyalty Platform | v1 | — |
| Recommendation Engine | v1 | — |
| Payment Module | v1 | — |

### Change Policy

- **Breaking changes** (field removal, type change, behavioral change) require a **new major version**. The previous version enters the Deprecated stage immediately upon the new version reaching GA.
- **Non-breaking additions** (new optional fields, new endpoints, new query parameters) are released within the current major version and documented in the changelog.
- All API changes are reviewed by the Acme Retail API Governance Board before release. See [ADR-002](../architecture/adr-002-api-versioning-strategy.md) for the rationale behind this policy.

---

## Rate Limiting

Rate limiting is enforced at the Azure API Management gateway layer. Limits vary by caller type and are designed to protect backend services while providing a fair-use experience for all consumers.

### Rate Limit Tiers

| Caller Type | Requests / Minute | Burst (Requests / Second) | Scope | Exceeded Behavior |
|---|---|---|---|---|
| **Authenticated Customer** | 100 | 20 | Per user (subject claim) | `429 Too Many Requests` + `Retry-After` header |
| **Internal Service** | 1,000 | 100 | Per service (client ID) | `429 Too Many Requests` + circuit breaker opens after 5 consecutive 429s |
| **Third-Party Partner** | 60 | 10 | Per API key | `429 Too Many Requests` + automated notification to partner contact |
| **Anonymous** | 30 | 5 | Per source IP | `429 Too Many Requests` + CAPTCHA challenge on subsequent web requests |

### Rate Limit Headers

Every response from the API gateway includes the following headers so that clients can implement proactive throttling:

| Header | Description | Example |
|---|---|---|
| `X-RateLimit-Limit` | Maximum requests allowed in the current window | `100` |
| `X-RateLimit-Remaining` | Requests remaining in the current window | `73` |
| `X-RateLimit-Reset` | UTC epoch timestamp when the window resets | `1710523200` |

When a `429` response is returned, the body follows the standard error envelope:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "You have exceeded the allowed request rate. Please retry after the time indicated in the Retry-After header.",
    "retryAfterSeconds": 12
  }
}
```

### Client Best Practices

- **Respect `Retry-After`**: Always wait the number of seconds indicated before retrying.
- **Implement exponential back-off**: For batch integrations, use jittered exponential back-off starting from the `Retry-After` value.
- **Cache aggressively**: Product and catalogue data support `ETag` and `Cache-Control` headers. Use conditional requests (`If-None-Match`) to reduce unnecessary calls.
- **Use webhooks where available**: For inventory and order status updates, subscribe to events via RabbitMQ rather than polling. See [Event Schemas](./event-schemas.md) for details.

---

## Related Documentation

- [BookStore API Contract](./bookstore-api.md) — detailed endpoint reference for the public eCommerce API
- [Event Schemas](./event-schemas.md) — RabbitMQ event catalogue and payload definitions
- [Architecture Overview](../architecture/overview.md) — high-level system architecture
- [System Landscape](../technical/system-landscape.md) — infrastructure and service topology
