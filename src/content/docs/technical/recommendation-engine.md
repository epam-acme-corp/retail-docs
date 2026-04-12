---
title: "Recommendation Engine"
---

# Recommendation Engine

## Service Overview

The Recommendation Engine is Acme Retail's machine learning–powered personalization service. It generates product recommendations across multiple touchpoints — homepage, product detail pages, cart, post-purchase emails, and search results — with the goal of increasing product discovery, average order value, and customer engagement. The engine serves recommendations for approximately 3.2 million registered users and a product catalog of roughly 500,000 active SKUs.

The API layer is built on **Python 3.11** using the **FastAPI** framework, providing asynchronous request handling with automatic OpenAPI documentation. Model inference is handled by **TensorFlow Serving**, which hosts trained models behind a gRPC interface for low-latency prediction. The feature store runs on **Redis 7**, holding precomputed user and item features that the API layer retrieves at request time to construct model inputs.

The ML/AI Team owns the Recommendation Engine end-to-end. The team comprises four software engineers responsible for the API, infrastructure, and deployment pipeline, and two data scientists who focus on model development, evaluation, and experimentation. Models are retrained on a **weekly cadence** using the latest behavioral data, with the ability to trigger ad-hoc retraining when significant catalog or behavioral shifts are detected.

The Recommendation Engine integrates with the broader Acme Retail architecture through REST APIs consumed by the [Bookstore E-Commerce Platform](bookstore-ecommerce.md) front end and email rendering service. It receives behavioral event data from **Segment** and pulls training data from **Snowflake**. For a full view of how the engine fits within the platform, see the [Architecture Overview](../architecture/overview.md) and the [System Landscape](system-landscape.md).

## Recommendation Strategies

The engine employs multiple recommendation strategies, each suited to different contexts and data availability. The strategy selection is determined by the request context and the user's behavioral history depth.

| Strategy | Algorithm | Surface | Eligibility |
|---|---|---|---|
| **Collaborative Filtering** | ALS matrix factorization | "Customers who bought this also bought" | Users with 3+ orders |
| **Content-Based** | TF-IDF + cosine similarity | "Similar products you may like" | Products with sufficient attribute data |
| **Hybrid** | Weighted ensemble (collaborative + content) | Homepage personalization | All authenticated users |
| **Trending** | Time-decay weighted purchase/view counts | "Trending Now" section | All users (including anonymous) |
| **Category-Based** | Most popular in user's preferred categories | New user cold-start recommendations | Users with fewer than 3 orders |

The **Hybrid** strategy is the primary personalization mechanism for authenticated users with sufficient behavioral history. It combines collaborative filtering and content-based signals using learned weights that are tuned through A/B experimentation. The current production weighting is 60% collaborative and 40% content-based, though this ratio is actively being tested (see A/B Testing Framework below).

The **Trending** strategy serves as the universal fallback and is the only strategy that generates recommendations for anonymous (unauthenticated) visitors. Trending scores are computed hourly using a time-decay function that weights recent purchases and page views more heavily than older activity.

## Feature Store

The feature store is built on **Redis 7** and serves as the real-time data layer that feeds model inference. All features required for recommendation generation are precomputed and stored in Redis to ensure sub-millisecond retrieval at request time, keeping the API response well within its latency budget.

### User Features

User features are stored as Redis hash sets, keyed by user ID. Each hash contains:

- **Browsing History**: The last 100 product page views, stored as an ordered list of product IDs with timestamps. Used by the collaborative and hybrid strategies to capture real-time interest signals.
- **Purchase History**: The last 50 completed orders, including product IDs, categories, and order values. This is the primary input for the ALS collaborative filtering model.
- **Category Affinity Scores**: A vector of normalized scores representing the user's preference strength across all product categories. Computed weekly during model retraining and updated in Redis as part of the feature refresh pipeline.
- **Price Sensitivity Score**: A single float value (0.0–1.0) indicating the user's tendency to purchase discounted versus full-price items. Derived from historical purchase patterns and used to adjust recommendation ranking.
- **Session Features**: Real-time features captured during the current browsing session, including pages viewed, search queries, and cart contents. These features are updated on every page view event received from Segment.

### Item Features

Item features are stored as Redis hash sets keyed by product ID:

- **Category Embeddings**: Dense vector representations of the product's category hierarchy, used by the content-based strategy for similarity calculations.
- **Attribute Vectors**: Encoded product attributes (author, publisher, format, page count, publication year) used for content-based similarity matching.
- **Popularity Score**: A time-decayed aggregate of purchases and page views, refreshed hourly. Used by the Trending strategy and as a ranking signal in the Hybrid strategy.
- **Co-Purchase Matrix**: The top 20 most frequently co-purchased products, stored as a sorted set with co-purchase frequency scores. Used as a direct lookup for the "also bought" collaborative filtering recommendations.

### Storage and Lifecycle

The feature store requires approximately **8 GB of memory** to hold features for 3 million users and 500,000 products. User features have a **TTL of 90 days** — if a user does not generate any activity within 90 days, their features expire and the user falls back to the cold-start strategy on their next visit. Item features are **refreshed daily** through a batch pipeline that runs during off-peak hours (02:00–04:00 UTC).

## Model Training Pipeline

The model training pipeline runs on a weekly schedule and produces updated model artifacts that are deployed to TensorFlow Serving with minimal disruption to the live recommendation service.

**Data Source**: Training data originates from behavioral events collected by **Segment** and landed in **Snowflake**. The training dataset covers a rolling **6-month window** of user interactions, including page views, add-to-cart events, purchases, and search queries. Data is filtered to exclude bot traffic and internal test accounts.

**Training Infrastructure**: Model training runs on **Azure Databricks** using an 8-node Spark cluster. The Databricks environment provides managed Spark for distributed data processing and supports both the ALS model (via Spark MLlib) and the TF-IDF pipeline (via custom PySpark transformations).

**Pipeline Stages**:

1. **Data Extraction**: Pull the latest 6 months of event data from Snowflake into Databricks. Apply data quality checks — row counts, null rates, and schema validation.
2. **Feature Engineering**: Compute user–item interaction matrices, category affinity vectors, content attribute encodings, and popularity scores. Output is written to a staging area in Azure Blob Storage.
3. **Model Training**: Train the ALS collaborative filtering model and the TF-IDF content similarity model. Hyperparameters are inherited from the last successful training run unless an active experiment overrides them.
4. **Evaluation**: Evaluate trained models against a held-out test set using the following metrics:
   - **Hit Rate @10**: Proportion of users for whom at least one of the top-10 recommendations matches a future purchase. Target: ≥ 0.35.
   - **NDCG @10**: Normalized Discounted Cumulative Gain at position 10, measuring ranking quality. Target: ≥ 0.20.
   - **Coverage**: Percentage of catalog items appearing in at least one user's top-10. Target: ≥ 40%.
   - **Diversity**: Average intra-list dissimilarity across recommendation sets. Target: ≥ 0.50.
5. **Export**: Convert trained models to **TensorFlow SavedModel** format and push artifacts to Azure Blob Storage.
6. **Deployment**: Deploy the new model to TensorFlow Serving using a **blue-green** strategy. The new model initially receives **10% of traffic** (canary phase). If latency and error rate metrics remain within thresholds for 30 minutes, traffic is shifted to 100%.

**Experiment Tracking**: All training runs, hyperparameters, evaluation metrics, and model artifacts are logged in **MLflow**, hosted on the Databricks workspace. MLflow provides the experiment comparison interface that data scientists use to evaluate model iterations and decide whether a new model is promoted to production.

## A/B Testing Framework

All changes to recommendation strategies, model parameters, and UX presentation are validated through controlled A/B experiments before full rollout. The experimentation infrastructure is built on **LaunchDarkly** feature flags and experiments.

**Assignment**: Users are assigned to experiment variants using **consistent hashing** on the user ID. This ensures that a given user always sees the same variant for the duration of an experiment, even across sessions and devices. Anonymous users are hashed on a device-level identifier stored in a first-party cookie.

**Metrics**: Every experiment is evaluated against four primary metrics, measured over the experiment's runtime:

- **Click-Through Rate (CTR)**: Percentage of displayed recommendations that receive a click.
- **Add-to-Cart Rate**: Percentage of recommendation clicks that result in the product being added to the cart.
- **Conversion Rate**: Percentage of recommendation clicks that ultimately result in a purchase.
- **Revenue per Recommendation**: Total revenue attributable to recommendations divided by the number of recommendations displayed.

**Statistical Rigor**: Experiments run for a **minimum of 2 weeks** to capture weekly seasonality. Results require **95% confidence intervals** that exclude zero effect. The platform uses **sequential testing** methodology, which allows for early stopping if a variant reaches statistical significance before the minimum runtime — though the minimum 2-week floor still applies.

**Current Active Experiments**:

| Experiment | Variants | Hypothesis | Status |
|---|---|---|---|
| Hybrid weight ratio | 60/40 (control) vs. 70/30 collaborative/content | Higher collaborative weight improves CTR for users with deep purchase history | Week 3 of 4 |
| Recommendation count | 8 items (control) vs. 12 items | More recommendations increase total clicks without reducing per-item CTR | Week 2 of 4 |
| Diversity injection | 0% (control) vs. 20% diversity injection | Injecting category-diverse items improves discovery without hurting conversion | Week 1 of 4 |

## Cold-Start Handling

Cold-start — the challenge of generating relevant recommendations when limited behavioral data is available — is handled through a graduated strategy that transitions users and products through progressively more sophisticated algorithms as data accumulates.

### New Users

New users follow a three-phase progression:

1. **Phase 1 — No History**: Users with no interaction data receive **Trending** recommendations. These are non-personalized but reflect current catalog popularity, providing a reasonable baseline experience.
2. **Phase 2 — Browsing History Only**: After a user has viewed **3 or more product pages**, the engine switches to **Content-Based** recommendations that leverage the viewed products' attributes to suggest similar items.
3. **Phase 3 — Post-Purchase**: After the user completes their **first purchase**, they become eligible for the **Hybrid** strategy, which incorporates collaborative filtering signals from users with similar purchase patterns.

The transition between phases is automatic and takes effect on the next recommendation request after the threshold is met.

### New Products

New products added to the catalog face a symmetric cold-start problem — no purchase or interaction data exists to feed collaborative filtering.

1. **Day One**: New products are eligible for **Content-Based** recommendations immediately, using their catalog attributes (category, author, format, price range) for similarity matching against the existing product catalog.
2. **New Arrivals Boost**: For the first 14 days after catalog entry, new products receive a configurable boost factor in the Trending strategy, increasing their visibility in "Trending Now" and category-level recommendation surfaces.
3. **Collaborative Eligibility**: Once a product accumulates approximately **100 purchases**, the co-purchase signals are statistically meaningful enough for the ALS model to generate reliable collaborative filtering recommendations. This threshold is typically reached within 4–6 weeks for mid-popularity titles.

## API Contract

The Recommendation Engine exposes a single primary endpoint consumed by the Acme Retail front end and email rendering services.

### Endpoint

```
GET /api/v1/recommendations/{userId}
```

### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `context` | string | Yes | — | Recommendation surface: `homepage`, `product_detail`, `cart`, `email`, `search_results` |
| `limit` | integer | No | 10 | Number of recommendations to return (max 50) |
| `exclude` | string | No | — | Comma-separated product IDs to exclude from results |
| `category` | string | No | — | Filter recommendations to a specific category |

### Response

```json
{
  "userId": "usr_8a3f2c91",
  "recommendations": [
    {
      "productId": "prod_29f841a3",
      "score": 0.94,
      "reason": "collaborative_filtering",
      "position": 1
    },
    {
      "productId": "prod_e17b5c02",
      "score": 0.89,
      "reason": "content_similarity",
      "position": 2
    },
    {
      "productId": "prod_7d4a9ef8",
      "score": 0.85,
      "reason": "trending",
      "position": 3
    }
  ],
  "metadata": {
    "strategy": "hybrid",
    "latency_ms": 42,
    "cached": false,
    "experiment_id": "exp_hybrid_weights_v3",
    "variant": "control",
    "model_version": "2025-03-10_weekly"
  }
}
```

### Performance SLA

The endpoint is bound by a **p95 latency target of less than 100 ms**. Current production performance is p50 = 18 ms, p95 = 62 ms, and p99 = 91 ms. Latency is dominated by Redis feature retrieval and TensorFlow Serving inference; the FastAPI overhead is negligible.

### Fallback Behavior

If TensorFlow Serving is unavailable or the inference call exceeds the 200 ms timeout, the API falls back to **cached Trending recommendations** stored in Redis. Trending results are refreshed hourly and are always available as a pre-warmed cache. The fallback response includes `"strategy": "trending_fallback"` in the metadata to signal that personalization was not applied. This graceful degradation ensures that recommendation surfaces never return empty results. For additional context on system resilience patterns, see the [Architecture Overview](../architecture/overview.md) and [Data Architecture](../data/architecture.md).
