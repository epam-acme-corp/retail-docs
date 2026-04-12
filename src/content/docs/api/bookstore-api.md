---
title: "BookStore eCommerce API Contract"
---

# BookStore eCommerce API Contract

The BookStore eCommerce API is the public-facing REST interface for the Acme Retail online bookstore. It serves the web storefront, the iOS and Android mobile applications, and approved third-party affiliate integrations. This document provides the complete endpoint reference, including request and response examples, error handling, and authentication requirements.

**Base URL**: `https://api.acmeretail.com/store/v1`

**Authentication**: Endpoints marked *Public* require no authentication. All other endpoints require a valid OAuth 2.0 Bearer token obtained via the authorization code + PKCE flow described in [API Overview](./overview.md). Guest sessions use a session token in the `X-Session-Id` header for cart operations.

**Content Type**: All request and response bodies use `application/json` unless otherwise noted.

---

## 1. Product API

Product endpoints are publicly accessible and do not require authentication. Responses are cached at the CDN layer with a 5-minute TTL.

### GET /store/v1/products

Returns a paginated list of products. Supports filtering by category, price range, and availability.

**Request**:

```http
GET /store/v1/products?page=1&pageSize=20&category=fiction&minPrice=5.00&maxPrice=30.00&inStock=true HTTP/1.1
Host: api.acmeretail.com
Accept: application/json
```

**Response** (`200 OK`):

```json
{
  "data": [
    {
      "productId": "prod_8f14e45f",
      "title": "The Great Gatsby",
      "author": "F. Scott Fitzgerald",
      "isbn": "978-0743273565",
      "price": 12.99,
      "currency": "USD",
      "category": "fiction",
      "coverImageUrl": "https://cdn.acmeretail.com/images/prod_8f14e45f/cover.jpg",
      "averageRating": 4.3,
      "reviewCount": 1247,
      "inStock": true,
      "createdAt": "2024-06-15T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 1234,
    "totalPages": 62
  }
}
```

**Error Responses**:

| Status | Code | Description |
|---|---|---|
| `400` | `INVALID_PARAMETER` | Invalid query parameter value (e.g., negative price, page < 1) |
| `429` | `RATE_LIMIT_EXCEEDED` | Rate limit exceeded — see `Retry-After` header |
| `500` | `INTERNAL_ERROR` | Unexpected server error |

### GET /store/v1/products/{productId}

Returns full product detail including variants, images, and review summary.

**Request**:

```http
GET /store/v1/products/prod_8f14e45f HTTP/1.1
Host: api.acmeretail.com
Accept: application/json
```

**Response** (`200 OK`):

```json
{
  "productId": "prod_8f14e45f",
  "title": "The Great Gatsby",
  "author": "F. Scott Fitzgerald",
  "isbn": "978-0743273565",
  "description": "A novel set in the Jazz Age that explores themes of wealth, class, and the American Dream.",
  "publisher": "Scribner",
  "publicationDate": "2004-09-30",
  "pages": 180,
  "language": "en",
  "price": 12.99,
  "currency": "USD",
  "category": "fiction",
  "tags": ["classic", "american-literature", "jazz-age"],
  "variants": [
    { "variantId": "var_001", "format": "paperback", "price": 12.99, "inStock": true },
    { "variantId": "var_002", "format": "hardcover", "price": 24.99, "inStock": true },
    { "variantId": "var_003", "format": "ebook", "price": 8.99, "inStock": true }
  ],
  "images": [
    { "url": "https://cdn.acmeretail.com/images/prod_8f14e45f/cover.jpg", "type": "cover", "width": 600, "height": 900 },
    { "url": "https://cdn.acmeretail.com/images/prod_8f14e45f/back.jpg", "type": "back", "width": 600, "height": 900 }
  ],
  "reviews": {
    "averageRating": 4.3,
    "totalReviews": 1247,
    "distribution": { "5": 612, "4": 345, "3": 178, "2": 72, "1": 40 }
  },
  "relatedProductIds": ["prod_a1b2c3d4", "prod_e5f6a7b8"],
  "createdAt": "2024-06-15T10:00:00Z",
  "updatedAt": "2025-02-20T14:30:00Z"
}
```

**Error Responses**:

| Status | Code | Description |
|---|---|---|
| `404` | `PRODUCT_NOT_FOUND` | No product exists with the given ID |
| `500` | `INTERNAL_ERROR` | Unexpected server error |

### GET /store/v1/products/search

Full-text search powered by Elasticsearch. Returns results with facets for filtering.

**Request**:

```http
GET /store/v1/products/search?q=science%20fiction&page=1&pageSize=20&sort=relevance HTTP/1.1
Host: api.acmeretail.com
Accept: application/json
```

**Response** (`200 OK`):

```json
{
  "data": [
    {
      "productId": "prod_c3d4e5f6",
      "title": "Dune",
      "author": "Frank Herbert",
      "price": 14.99,
      "currency": "USD",
      "coverImageUrl": "https://cdn.acmeretail.com/images/prod_c3d4e5f6/cover.jpg",
      "averageRating": 4.7,
      "inStock": true,
      "highlight": "The landmark <em>science fiction</em> epic..."
    }
  ],
  "facets": {
    "category": [
      { "value": "science-fiction", "count": 342 },
      { "value": "fantasy", "count": 128 }
    ],
    "priceRange": [
      { "value": "0-10", "count": 87 },
      { "value": "10-20", "count": 214 },
      { "value": "20-50", "count": 169 }
    ],
    "format": [
      { "value": "paperback", "count": 305 },
      { "value": "hardcover", "count": 198 },
      { "value": "ebook", "count": 342 }
    ]
  },
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 470,
    "totalPages": 24
  }
}
```

**Error Responses**:

| Status | Code | Description |
|---|---|---|
| `400` | `INVALID_QUERY` | Search query is empty or exceeds 200 characters |
| `429` | `RATE_LIMIT_EXCEEDED` | Rate limit exceeded |
| `500` | `INTERNAL_ERROR` | Unexpected server error |

### GET /store/v1/products/categories/{categoryId}

Returns all products in a given category with standard pagination.

**Request**:

```http
GET /store/v1/products/categories/fiction?page=1&pageSize=20&sort=popularity HTTP/1.1
Host: api.acmeretail.com
Accept: application/json
```

**Response** (`200 OK`):

```json
{
  "categoryId": "fiction",
  "categoryName": "Fiction",
  "data": [
    {
      "productId": "prod_8f14e45f",
      "title": "The Great Gatsby",
      "author": "F. Scott Fitzgerald",
      "price": 12.99,
      "currency": "USD",
      "coverImageUrl": "https://cdn.acmeretail.com/images/prod_8f14e45f/cover.jpg",
      "averageRating": 4.3,
      "inStock": true
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 856,
    "totalPages": 43
  }
}
```

**Error Responses**:

| Status | Code | Description |
|---|---|---|
| `404` | `CATEGORY_NOT_FOUND` | No category exists with the given ID |
| `500` | `INTERNAL_ERROR` | Unexpected server error |

---

## 2. Cart API

Cart endpoints accept either a Bearer token (authenticated user) or a guest session token (`X-Session-Id`). When a guest user logs in, the guest cart is automatically merged into the authenticated user's cart. Conflicts are resolved by keeping the higher quantity.

Stock is validated when items are added and again at checkout time. If an item goes out of stock between add and checkout, the customer is notified and the item is flagged.

### POST /store/v1/cart/items

Adds a product to the cart.

**Request**:

```http
POST /store/v1/cart/items HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Content-Type: application/json

{
  "productId": "prod_8f14e45f",
  "variantId": "var_001",
  "quantity": 2
}
```

**Response** (`201 Created`):

```json
{
  "cartId": "cart_d290f1ee",
  "items": [
    {
      "itemId": "item_7c9e6679",
      "productId": "prod_8f14e45f",
      "variantId": "var_001",
      "title": "The Great Gatsby",
      "format": "paperback",
      "unitPrice": 12.99,
      "quantity": 2,
      "lineTotal": 25.98
    }
  ],
  "subtotal": 25.98,
  "itemCount": 2,
  "updatedAt": "2025-03-15T09:22:00Z"
}
```

**Error Responses**:

| Status | Code | Description |
|---|---|---|
| `400` | `INVALID_QUANTITY` | Quantity must be between 1 and 99 |
| `404` | `PRODUCT_NOT_FOUND` | Product or variant does not exist |
| `409` | `OUT_OF_STOCK` | Requested quantity exceeds available stock |
| `401` | `UNAUTHORIZED` | Missing or invalid authentication token |
| `429` | `RATE_LIMIT_EXCEEDED` | Rate limit exceeded |
| `500` | `INTERNAL_ERROR` | Unexpected server error |

### GET /store/v1/cart

Retrieves the current cart contents.

**Request**:

```http
GET /store/v1/cart HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Accept: application/json
```

**Response** (`200 OK`):

```json
{
  "cartId": "cart_d290f1ee",
  "items": [
    {
      "itemId": "item_7c9e6679",
      "productId": "prod_8f14e45f",
      "variantId": "var_001",
      "title": "The Great Gatsby",
      "format": "paperback",
      "unitPrice": 12.99,
      "quantity": 2,
      "lineTotal": 25.98
    },
    {
      "itemId": "item_a3f5b812",
      "productId": "prod_c3d4e5f6",
      "variantId": "var_010",
      "title": "Dune",
      "format": "ebook",
      "unitPrice": 9.99,
      "quantity": 1,
      "lineTotal": 9.99
    }
  ],
  "subtotal": 35.97,
  "itemCount": 3,
  "stockWarnings": [],
  "updatedAt": "2025-03-15T09:25:00Z"
}
```

### PUT /store/v1/cart/items/{itemId}

Updates the quantity of a cart item.

**Request**:

```http
PUT /store/v1/cart/items/item_7c9e6679 HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Content-Type: application/json

{
  "quantity": 3
}
```

**Response** (`200 OK`):

```json
{
  "cartId": "cart_d290f1ee",
  "items": [
    {
      "itemId": "item_7c9e6679",
      "productId": "prod_8f14e45f",
      "variantId": "var_001",
      "title": "The Great Gatsby",
      "format": "paperback",
      "unitPrice": 12.99,
      "quantity": 3,
      "lineTotal": 38.97
    },
    {
      "itemId": "item_a3f5b812",
      "productId": "prod_c3d4e5f6",
      "variantId": "var_010",
      "title": "Dune",
      "format": "ebook",
      "unitPrice": 9.99,
      "quantity": 1,
      "lineTotal": 9.99
    }
  ],
  "subtotal": 48.96,
  "itemCount": 4,
  "stockWarnings": [],
  "updatedAt": "2025-03-15T09:28:00Z"
}
```

**Error Responses**:

| Status | Code | Description |
|---|---|---|
| `400` | `INVALID_QUANTITY` | Quantity must be between 1 and 99 |
| `404` | `ITEM_NOT_FOUND` | Cart item does not exist |
| `409` | `OUT_OF_STOCK` | Requested quantity exceeds available stock |
| `500` | `INTERNAL_ERROR` | Unexpected server error |

### DELETE /store/v1/cart/items/{itemId}

Removes an item from the cart.

**Request**:

```http
DELETE /store/v1/cart/items/item_a3f5b812 HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

**Response** (`200 OK`):

```json
{
  "cartId": "cart_d290f1ee",
  "items": [
    {
      "itemId": "item_7c9e6679",
      "productId": "prod_8f14e45f",
      "variantId": "var_001",
      "title": "The Great Gatsby",
      "format": "paperback",
      "unitPrice": 12.99,
      "quantity": 3,
      "lineTotal": 38.97
    }
  ],
  "subtotal": 38.97,
  "itemCount": 3,
  "stockWarnings": [],
  "updatedAt": "2025-03-15T09:30:00Z"
}
```

**Error Responses**:

| Status | Code | Description |
|---|---|---|
| `404` | `ITEM_NOT_FOUND` | Cart item does not exist |
| `500` | `INTERNAL_ERROR` | Unexpected server error |

---

## 3. Checkout API

All checkout endpoints require authentication. The checkout flow begins by initiating a checkout from the current cart, proceeds through payment submission, and concludes with order confirmation.

### POST /store/v1/checkout

Initiates a checkout session from the current cart. Validates stock levels, calculates taxes, and applies any loyalty point redemptions.

**Request**:

```http
POST /store/v1/checkout HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Content-Type: application/json

{
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
  "loyaltyPointsToRedeem": 500,
  "promoCode": "SPRING2025"
}
```

**Response** (`201 Created`):

```json
{
  "checkoutId": "chk_f47ac10b",
  "status": "pending_payment",
  "items": [
    {
      "productId": "prod_8f14e45f",
      "title": "The Great Gatsby",
      "format": "paperback",
      "unitPrice": 12.99,
      "quantity": 3,
      "lineTotal": 38.97
    }
  ],
  "subtotal": 38.97,
  "discount": -5.00,
  "loyaltyDiscount": -2.50,
  "shippingCost": 4.99,
  "taxAmount": 2.91,
  "total": 39.37,
  "currency": "USD",
  "deliveryMethod": "standard",
  "estimatedDelivery": "2025-03-20",
  "expiresAt": "2025-03-15T10:00:00Z"
}
```

**Error Responses**:

| Status | Code | Description |
|---|---|---|
| `400` | `EMPTY_CART` | Cart is empty |
| `400` | `INVALID_ADDRESS` | Shipping address is incomplete or invalid |
| `400` | `INVALID_PROMO_CODE` | Promo code is expired or invalid |
| `409` | `STOCK_CHANGED` | One or more items are no longer available in the requested quantity |
| `401` | `UNAUTHORIZED` | Missing or invalid authentication |
| `500` | `INTERNAL_ERROR` | Unexpected server error |

### POST /store/v1/checkout/payment

Submits payment for an active checkout session. Accepts a Stripe payment token generated client-side.

**Request**:

```http
POST /store/v1/checkout/payment HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Content-Type: application/json

{
  "checkoutId": "chk_f47ac10b",
  "paymentToken": "tok_visa_4242",
  "billingAddress": {
    "fullName": "Jane Doe",
    "line1": "742 Evergreen Terrace",
    "line2": "Apt 3B",
    "city": "Springfield",
    "state": "IL",
    "postalCode": "62704",
    "country": "US"
  },
  "savePaymentMethod": true
}
```

**Response** (`200 OK`):

```json
{
  "orderId": "ord_550e8400",
  "status": "confirmed",
  "paymentStatus": "captured",
  "total": 39.37,
  "currency": "USD",
  "confirmationUrl": "/store/v1/checkout/confirmation/ord_550e8400",
  "createdAt": "2025-03-15T09:35:00Z"
}
```

**Error Responses**:

| Status | Code | Description |
|---|---|---|
| `400` | `INVALID_TOKEN` | Payment token is malformed or expired |
| `402` | `PAYMENT_DECLINED` | Payment was declined by the processor |
| `404` | `CHECKOUT_NOT_FOUND` | Checkout session does not exist or has expired |
| `409` | `CHECKOUT_ALREADY_COMPLETED` | Payment has already been submitted for this checkout |
| `500` | `INTERNAL_ERROR` | Unexpected server error |

### GET /store/v1/checkout/confirmation/{orderId}

Returns the order confirmation details after successful payment.

**Request**:

```http
GET /store/v1/checkout/confirmation/ord_550e8400 HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Accept: application/json
```

**Response** (`200 OK`):

```json
{
  "orderId": "ord_550e8400",
  "status": "confirmed",
  "items": [
    {
      "productId": "prod_8f14e45f",
      "title": "The Great Gatsby",
      "format": "paperback",
      "quantity": 3,
      "lineTotal": 38.97
    }
  ],
  "subtotal": 38.97,
  "discount": -5.00,
  "loyaltyDiscount": -2.50,
  "shippingCost": 4.99,
  "taxAmount": 2.91,
  "total": 39.37,
  "currency": "USD",
  "shippingAddress": {
    "fullName": "Jane Doe",
    "line1": "742 Evergreen Terrace",
    "city": "Springfield",
    "state": "IL",
    "postalCode": "62704",
    "country": "US"
  },
  "deliveryMethod": "standard",
  "estimatedDelivery": "2025-03-20",
  "loyaltyPointsEarned": 39,
  "createdAt": "2025-03-15T09:35:00Z"
}
```

**Error Responses**:

| Status | Code | Description |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid authentication |
| `404` | `ORDER_NOT_FOUND` | No order exists with the given ID, or it belongs to another user |
| `500` | `INTERNAL_ERROR` | Unexpected server error |

---

## 4. Order API

Order endpoints are authenticated. Customers can view their order history, track shipments, request cancellations, and initiate returns.

### GET /store/v1/orders

Returns a paginated list of the authenticated user's orders, most recent first.

**Request**:

```http
GET /store/v1/orders?page=1&pageSize=10&status=shipped HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Accept: application/json
```

**Response** (`200 OK`):

```json
{
  "data": [
    {
      "orderId": "ord_550e8400",
      "status": "shipped",
      "total": 39.37,
      "currency": "USD",
      "itemCount": 3,
      "createdAt": "2025-03-15T09:35:00Z",
      "updatedAt": "2025-03-16T14:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "totalItems": 24,
    "totalPages": 3
  }
}
```

### GET /store/v1/orders/{orderId}

Returns full order detail including line items, shipping, and tracking information.

**Request**:

```http
GET /store/v1/orders/ord_550e8400 HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Accept: application/json
```

**Response** (`200 OK`):

```json
{
  "orderId": "ord_550e8400",
  "status": "shipped",
  "items": [
    {
      "productId": "prod_8f14e45f",
      "title": "The Great Gatsby",
      "format": "paperback",
      "unitPrice": 12.99,
      "quantity": 3,
      "lineTotal": 38.97
    }
  ],
  "subtotal": 38.97,
  "discount": -5.00,
  "loyaltyDiscount": -2.50,
  "shippingCost": 4.99,
  "taxAmount": 2.91,
  "total": 39.37,
  "currency": "USD",
  "shippingAddress": {
    "fullName": "Jane Doe",
    "line1": "742 Evergreen Terrace",
    "city": "Springfield",
    "state": "IL",
    "postalCode": "62704",
    "country": "US"
  },
  "tracking": {
    "carrier": "UPS",
    "trackingNumber": "1Z999AA10123456784",
    "trackingUrl": "https://www.ups.com/track?tracknum=1Z999AA10123456784",
    "status": "in_transit",
    "estimatedDelivery": "2025-03-20",
    "events": [
      { "timestamp": "2025-03-16T14:00:00Z", "status": "shipped", "location": "Chicago, IL" },
      { "timestamp": "2025-03-17T08:30:00Z", "status": "in_transit", "location": "Indianapolis, IN" }
    ]
  },
  "createdAt": "2025-03-15T09:35:00Z",
  "updatedAt": "2025-03-17T08:30:00Z"
}
```

**Order Status Values**:

| Status | Description |
|---|---|
| `confirmed` | Payment captured, order accepted |
| `processing` | Picked and being packed at warehouse |
| `shipped` | Handed to carrier, tracking available |
| `in_transit` | Carrier has confirmed movement |
| `delivered` | Carrier has confirmed delivery |
| `cancelled` | Order cancelled before shipment |
| `return_requested` | Customer requested a return |
| `returned` | Return received and refund processed |

### POST /store/v1/orders/{orderId}/cancel

Cancels an order. Only allowed if the order status is `confirmed` or `processing`.

**Request**:

```http
POST /store/v1/orders/ord_550e8400/cancel HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Content-Type: application/json

{
  "reason": "Changed my mind"
}
```

**Response** (`200 OK`):

```json
{
  "orderId": "ord_550e8400",
  "status": "cancelled",
  "refundStatus": "processing",
  "refundAmount": 39.37,
  "refundMethod": "original_payment_method",
  "estimatedRefundDate": "2025-03-18",
  "updatedAt": "2025-03-15T10:00:00Z"
}
```

**Error Responses**:

| Status | Code | Description |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid authentication |
| `404` | `ORDER_NOT_FOUND` | No order exists with the given ID |
| `409` | `CANCELLATION_NOT_ALLOWED` | Order has already shipped and cannot be cancelled; initiate a return instead |
| `500` | `INTERNAL_ERROR` | Unexpected server error |

### POST /store/v1/orders/{orderId}/return

Initiates a return for a delivered order. Returns must be requested within 30 days of delivery.

**Request**:

```http
POST /store/v1/orders/ord_550e8400/return HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Content-Type: application/json

{
  "items": [
    { "productId": "prod_8f14e45f", "quantity": 1, "reason": "Damaged during shipping" }
  ]
}
```

**Response** (`201 Created`):

```json
{
  "returnId": "ret_6ba7b810",
  "orderId": "ord_550e8400",
  "status": "return_requested",
  "items": [
    { "productId": "prod_8f14e45f", "quantity": 1, "reason": "Damaged during shipping" }
  ],
  "returnLabel": {
    "carrier": "UPS",
    "trackingNumber": "1Z999AA10987654321",
    "labelUrl": "https://api.acmeretail.com/store/v1/returns/ret_6ba7b810/label.pdf"
  },
  "refundEstimate": 12.99,
  "createdAt": "2025-03-15T10:05:00Z"
}
```

**Error Responses**:

| Status | Code | Description |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid authentication |
| `404` | `ORDER_NOT_FOUND` | No order exists with the given ID |
| `409` | `RETURN_WINDOW_EXPIRED` | The 30-day return window has passed |
| `409` | `RETURN_NOT_ELIGIBLE` | Order status does not allow returns (e.g., ebook purchases) |
| `500` | `INTERNAL_ERROR` | Unexpected server error |

---

## 5. Customer API

Customer profile endpoints are authenticated and scoped to the requesting user's own data.

### GET /store/v1/profile

Returns the authenticated user's profile.

**Request**:

```http
GET /store/v1/profile HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Accept: application/json
```

**Response** (`200 OK`):

```json
{
  "customerId": "cust_9b1deb4d",
  "email": "jane.doe@example.com",
  "firstName": "Jane",
  "lastName": "Doe",
  "phone": "+1-555-867-5309",
  "loyaltyMemberId": "loy_3c44dc24",
  "loyaltyTier": "gold",
  "loyaltyPoints": 4320,
  "preferences": {
    "newsletter": true,
    "smsNotifications": false,
    "preferredLanguage": "en"
  },
  "createdAt": "2023-11-01T12:00:00Z",
  "updatedAt": "2025-03-10T08:00:00Z"
}
```

### PUT /store/v1/profile

Updates the authenticated user's profile.

**Request**:

```http
PUT /store/v1/profile HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Content-Type: application/json

{
  "firstName": "Jane",
  "lastName": "Doe",
  "phone": "+1-555-867-5310",
  "preferences": {
    "newsletter": true,
    "smsNotifications": true,
    "preferredLanguage": "en"
  }
}
```

**Response** (`200 OK`):

```json
{
  "customerId": "cust_9b1deb4d",
  "email": "jane.doe@example.com",
  "firstName": "Jane",
  "lastName": "Doe",
  "phone": "+1-555-867-5310",
  "preferences": {
    "newsletter": true,
    "smsNotifications": true,
    "preferredLanguage": "en"
  },
  "updatedAt": "2025-03-15T10:10:00Z"
}
```

**Error Responses**:

| Status | Code | Description |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Invalid field value (e.g., malformed phone number) |
| `401` | `UNAUTHORIZED` | Missing or invalid authentication |
| `500` | `INTERNAL_ERROR` | Unexpected server error |

### GET /store/v1/profile/addresses

Returns all saved addresses for the authenticated user.

**Request**:

```http
GET /store/v1/profile/addresses HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Accept: application/json
```

**Response** (`200 OK`):

```json
{
  "addresses": [
    {
      "addressId": "addr_1a2b3c4d",
      "label": "Home",
      "fullName": "Jane Doe",
      "line1": "742 Evergreen Terrace",
      "line2": "Apt 3B",
      "city": "Springfield",
      "state": "IL",
      "postalCode": "62704",
      "country": "US",
      "isDefault": true
    },
    {
      "addressId": "addr_5e6f7a8b",
      "label": "Office",
      "fullName": "Jane Doe",
      "line1": "100 Industrial Way",
      "line2": null,
      "city": "Springfield",
      "state": "IL",
      "postalCode": "62701",
      "country": "US",
      "isDefault": false
    }
  ]
}
```

### POST /store/v1/profile/addresses

Adds a new saved address. Maximum 10 addresses per customer.

**Request**:

```http
POST /store/v1/profile/addresses HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Content-Type: application/json

{
  "label": "Parents",
  "fullName": "Jane Doe",
  "line1": "456 Oak Street",
  "city": "Shelbyville",
  "state": "IL",
  "postalCode": "62565",
  "country": "US",
  "isDefault": false
}
```

**Response** (`201 Created`):

```json
{
  "addressId": "addr_9c0d1e2f",
  "label": "Parents",
  "fullName": "Jane Doe",
  "line1": "456 Oak Street",
  "line2": null,
  "city": "Shelbyville",
  "state": "IL",
  "postalCode": "62565",
  "country": "US",
  "isDefault": false,
  "createdAt": "2025-03-15T10:15:00Z"
}
```

### PUT /store/v1/profile/addresses/{addressId}

Updates an existing saved address.

**Request**:

```http
PUT /store/v1/profile/addresses/addr_9c0d1e2f HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Content-Type: application/json

{
  "label": "Parents House",
  "line1": "456 Oak Street",
  "city": "Shelbyville",
  "state": "IL",
  "postalCode": "62565",
  "country": "US",
  "isDefault": false
}
```

**Response** (`200 OK`):

```json
{
  "addressId": "addr_9c0d1e2f",
  "label": "Parents House",
  "fullName": "Jane Doe",
  "line1": "456 Oak Street",
  "line2": null,
  "city": "Shelbyville",
  "state": "IL",
  "postalCode": "62565",
  "country": "US",
  "isDefault": false,
  "updatedAt": "2025-03-15T10:18:00Z"
}
```

### DELETE /store/v1/profile/addresses/{addressId}

Deletes a saved address. The default address cannot be deleted until another address is set as default.

**Request**:

```http
DELETE /store/v1/profile/addresses/addr_9c0d1e2f HTTP/1.1
Host: api.acmeretail.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

**Response** (`204 No Content`):

*(No body)*

**Error Responses**:

| Status | Code | Description |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid authentication |
| `404` | `ADDRESS_NOT_FOUND` | No address exists with the given ID |
| `409` | `DEFAULT_ADDRESS` | Cannot delete the default address; set another address as default first |
| `500` | `INTERNAL_ERROR` | Unexpected server error |

---

## Standard Error Envelope

All error responses share a consistent structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "A human-readable description of the error.",
    "details": [
      {
        "field": "quantity",
        "issue": "Must be between 1 and 99"
      }
    ],
    "traceId": "00-abcdef1234567890-abcdef12-01"
  }
}
```

The `traceId` field corresponds to the W3C Trace Context and can be provided to support for incident investigation.

---

## Related Documentation

- [API Landscape Overview](./overview.md) — authentication, versioning, and rate-limiting policies
- [Event Schemas](./event-schemas.md) — order and inventory events published to RabbitMQ
- [BookStore eCommerce Technical Documentation](../technical/bookstore-ecommerce.md) — service architecture and deployment
- [Payment Module](../technical/payment-module.md) — Stripe integration details
