---
title: "Loyalty Platform"
---

# Loyalty Platform

## Service Overview

The Loyalty Platform is the centralized rewards and membership system that powers Acme Retail's customer loyalty program. It manages tier progression, points accrual and redemption, campaign execution, and member analytics across all Acme Retail channels — web, mobile, and in-store point-of-sale terminals. The platform serves approximately 3.2 million active loyalty members and processes an average of 1.8 million point transactions per day during peak periods.

The service is built on **Node.js 20** using the **Express** framework, deployed as containerized workloads on **Azure Kubernetes Service (AKS)**. Member profiles, tier history, campaign configurations, and transaction logs are stored in **MongoDB 7**, which provides the document flexibility required to model varied reward structures and campaign rules without rigid schema migrations. The Loyalty Team, consisting of five engineers, owns the platform end-to-end — from API development through deployment and on-call support. The team follows a weekly deployment cadence, releasing to production every Wednesday after automated regression tests and a staging validation window.

The Loyalty Platform integrates with the broader Acme Retail ecosystem through RESTful APIs and event-driven messaging via **RabbitMQ**. It publishes events such as `member.tier_changed`, `points.accrued`, and `points.redeemed` that downstream systems — including the [Recommendation Engine](recommendation-engine.md), email marketing, and the analytics pipeline — consume for personalization and reporting. For a broader view of how the Loyalty Platform fits within the Acme Retail technology landscape, see the [Architecture Overview](../architecture/overview.md) and the [System Landscape](system-landscape.md).

## Tier Structure

The loyalty program operates a four-tier structure that determines the points multiplier and benefit level for each member. Tier placement is based on cumulative qualifying spend within the member's anniversary year — the 12-month period beginning on the date of enrollment.

| Tier | Annual Qualifying Spend | Points Multiplier | Core Benefits | Member Distribution |
|---|---|---|---|---|
| **Bronze** | $0 (default) | 1× | Base earn rate, birthday reward, member-only pricing | 55% |
| **Silver** | $250+ | 1.25× | Free standard shipping, early access to promotions | 28% |
| **Gold** | $750+ | 1.5× | Free express shipping, exclusive events, priority customer support | 14% |
| **Platinum** | $2,000+ | 2× | Free same-day delivery, personal shopper service, annual appreciation gift | 3% |

Tier status is **recalculated annually** on each member's enrollment anniversary date. The system evaluates the total qualifying spend accumulated during the preceding 12-month period and assigns the appropriate tier for the next year. Members who do not meet the spend threshold for their current tier receive a **90-day grace period** during which they retain their existing benefits. If the member reaches the required threshold during the grace period, their tier is reinstated; otherwise, the tier is downgraded at the end of the grace window.

Tier upgrades are processed in real time. When a purchase pushes a member's cumulative spend past the next tier threshold, the upgrade takes effect immediately and the member begins earning at the new multiplier on subsequent transactions. Downgrades, by contrast, only occur at the annual recalculation checkpoint to avoid mid-year disruption.

## Points System

Points are the core currency of the loyalty program. The accrual and redemption rules are designed to reward sustained purchasing behavior while remaining straightforward for members to understand.

**Base Earn Rate**: Members earn **1 point per $1 spent** on qualifying purchases. This base rate is then multiplied by the member's current tier multiplier (see Tier Structure above). For example, a Gold-tier member spending $100 earns 150 points (100 × 1.5×).

**Points Accrual Timing**: Points are credited to the member's account when the order **ships**, not when the order is placed. This prevents points from being issued on orders that are subsequently cancelled before fulfillment. For returns, the corresponding points are deducted at the time the return is processed.

**Double Points Promotions**: The platform supports configurable promotion periods during which all point earnings are doubled. These promotions stack with tier multipliers. A Gold-tier member during a Double Points event earns at an effective rate of 3× (1 base × 1.5 tier × 2 promo). Double Points windows are defined in the campaign configuration and can target all members or specific tier segments.

**Category Bonuses**: Administrators can configure category-level bonus multipliers for targeted promotional campaigns. For example, a "Reading Month" campaign might apply a 3× bonus on all purchases in the Books category. Category bonuses are applied on top of the base rate but are not further multiplied by tier — the higher of the tier multiplier or the category bonus applies.

**Points Expiry**: Points expire **18 months after the member's last qualifying activity**. Activity is defined as any earn or redeem transaction. This rolling expiry policy means that active members effectively never lose points, while dormant accounts are gradually cleared. The system sends automated reminder notifications at 90, 60, and 30 days before expiration.

**Redemption Rate**: The standard redemption rate is **100 points = $1**. Members can redeem points in increments aligned with the rewards catalog (see below).

## Rewards Catalog

The rewards catalog defines the set of items and benefits that members can redeem their points for. The catalog is managed through an internal administration tool and can be updated without a code deployment.

| Reward Type | Options | Points Cost | Availability |
|---|---|---|---|
| **Discount Vouchers** | $5, $10, $25, $50 off next purchase | 500 / 1,000 / 2,500 / 5,000 | All tiers |
| **Free Shipping** | One-time free standard shipping on any order | 500 | All tiers |
| **Exclusive Access** | Early access to new releases, limited editions | 1,000 | Silver and above |
| **Partner Rewards** | Third-party gift cards (dining, entertainment, travel) | Varies (1,500–10,000) | All tiers |
| **Experiential Rewards** | Meet-the-author events, curated experiences | 5,000–15,000 | Platinum exclusive |

Discount vouchers are the most frequently redeemed reward, accounting for approximately 68% of all redemptions by volume. Experiential rewards, while low in volume, have the highest engagement impact — members who redeem experiential rewards show a 40% higher retention rate in the following 12-month period.

## Campaign Management

The Loyalty Platform includes a campaign management subsystem that enables marketing and merchandising teams to configure and deploy targeted loyalty promotions without engineering involvement.

**Campaign Types**:

- **Holiday Promotions**: Time-bound campaigns tied to key retail events (e.g., Black Friday, back-to-school season). These typically involve elevated earn rates, bonus point offers, or exclusive tier-specific rewards.
- **Birthday Rewards**: An automated campaign that issues a **$10 discount voucher** to every member during their birthday month. No manual activation required — the system triggers the reward on the first day of the birth month.
- **Referral Bonuses**: Members who refer a new customer receive **500 bonus points** when the referred friend completes their first purchase. The referred friend receives a **$10 discount** on their first order. Referral tracking uses unique referral codes tied to the referring member's account.
- **Win-Back Campaigns**: Automated campaigns targeting members who have been inactive for more than **90 days**. Win-back offers typically include a bonus point incentive or a discount voucher to encourage re-engagement.

**Campaign Configuration**: All campaign parameters are stored as documents in MongoDB. Each campaign document includes the campaign date range, eligibility criteria (tier, segment, activity level), reward type and value, budget cap (optional), and activation status. Campaigns can be scheduled in advance and activate automatically at the configured start time.

**A/B Testing**: The campaign subsystem supports A/B testing for campaign variants. When A/B testing is enabled, the system randomly assigns eligible members to control and variant groups using consistent hashing on the member ID. The platform tracks conversion metrics — including redemption rate, incremental revenue, and engagement uplift — for each variant. Results are surfaced in the campaign analytics dashboard with statistical significance indicators.

## Integration with Checkout

The Loyalty Platform exposes a dedicated API consumed by the [Bookstore E-Commerce Platform](bookstore-ecommerce.md) checkout flow. This integration enables real-time points display and redemption during the purchase process.

**Points Balance Query**: When a member reaches the checkout page, the front end calls the Loyalty API to retrieve the current points balance, pending points (accrued but not yet confirmed), and available redemption options. The response includes the member's tier and any active promotions that affect the transaction.

**Points Redemption at Checkout**: Members may redeem points toward their purchase with a minimum redemption of **500 points ($5)**. The checkout interface presents the available point balance and allows the member to specify a redemption amount in $5 increments. Points redemption can be combined with other payment methods — for example, a member can redeem $10 in points and pay the remaining balance with a credit card.

**Post-Purchase Accrual**: After a purchase that includes partial points redemption, new points are accrued only on the **net amount paid** — the portion of the order total that was not covered by redeemed points. For example, on a $50 order where the member redeems $10 in points, new points are earned on the remaining $40. This prevents circular inflation of the points economy.

**Error Handling**: If the Loyalty API is unavailable during checkout, the checkout flow proceeds without displaying points information and without blocking the transaction. Points accrual for the order is queued and processed once the Loyalty Platform recovers. This graceful degradation ensures that loyalty system outages do not impact revenue.

## Member Analytics and Segmentation

The Loyalty Platform generates rich behavioral data that feeds into Acme Retail's analytics and personalization infrastructure. The analytics capabilities are divided between in-platform dashboards and integrations with external analytics tools.

**RFM Analysis**: The platform computes Recency, Frequency, and Monetary (RFM) scores for every active member on a weekly batch cycle. RFM scores are stored in MongoDB and exposed through the Loyalty API, enabling downstream systems to segment members for targeted campaigns and personalized recommendations.

**Churn Prediction**: A monthly batch job generates churn risk scores for all active members using a logistic regression model trained on historical activity patterns, tier trajectory, redemption frequency, and engagement signals. Members flagged as high churn risk (score > 0.7) are automatically enrolled in win-back campaigns.

**Segment Analytics Dashboard**: The internal analytics dashboard provides real-time and historical views of key loyalty program metrics:

- **Tier Distribution**: Current membership counts and percentages by tier, with trend lines showing month-over-month movement.
- **Earn/Burn Ratios**: The ratio of points earned to points redeemed, tracked by tier and overall. A healthy program targets an earn-to-burn ratio between 2:1 and 4:1.
- **Redemption Rates**: Percentage of issued points that are ultimately redeemed, broken down by reward type.
- **Campaign ROI**: Revenue lift and incremental engagement attributed to each active campaign, calculated using control group comparison where A/B testing is enabled.

**Segment Platform Integration**: Loyalty events — including tier changes, point transactions, and campaign interactions — are forwarded to **Segment** for unification with broader customer behavior data. This integration enables cross-system analytics and powers personalization workflows in the [Recommendation Engine](recommendation-engine.md) and email marketing platforms. For details on the data pipeline, see the [Data Architecture](../data/architecture.md) documentation.
