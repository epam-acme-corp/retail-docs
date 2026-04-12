---
title: "PCI-DSS Compliance"
last-updated: "2025-03-15"
owner: "Acme Retail — Payments Team / InfoSec"
status: "Active"
---

# PCI-DSS Compliance

## PCI-DSS Scope and Responsibilities

Acme Retail maintains compliance with the **Payment Card Industry Data Security Standard (PCI-DSS) version 4.0** under the **SAQ A-EP** (Self-Assessment Questionnaire A for E-commerce merchants with Partial Electronic Payment Processing) classification. This classification reflects Acme Retail's payment architecture in which cardholder data is collected entirely by Stripe.js on the client side, but the eCommerce platform controls the page that embeds the Stripe payment iframe. Because Acme Retail's servers deliver the checkout page — and therefore influence the security context in which card data is entered — the SAQ A-EP requirements apply rather than the simpler SAQ A.

The PCI-DSS scope at Acme Retail encompasses all systems, network segments, and personnel that are involved in or can affect the security of payment transactions. Specifically, the scope includes the [Payment Module](../technical/payment-module.md) application servers, the SQL Server database instance that stores payment transaction records, the network segments that carry payment traffic, and the development workstations used by engineers who have access to payment-related source code or configuration. The Payments team lead is the designated PCI-DSS compliance owner and is responsible for completing the annual SAQ, coordinating evidence collection, and liaising with the InfoSec team and external assessors.

Acme Retail's compliance posture relies on a **shared responsibility model with Stripe**. Stripe, as a PCI-DSS Level 1 certified service provider, is responsible for the security of all cardholder data it processes, stores, and transmits. Acme Retail is responsible for the security of its own infrastructure, the integrity of the checkout page, the protection of Stripe API keys and webhook secrets, and the proper handling of Stripe tokens and references that traverse Acme Retail systems. The Stripe Attestation of Compliance (AOC) is obtained annually and filed as supporting evidence during Acme Retail's own SAQ submission.

The annual SAQ is completed by March 31 each year. The Payments team lead prepares the questionnaire, the InfoSec team validates the technical evidence, and the completed SAQ along with the Attestation of Compliance (AOC) is submitted to Acme Retail's acquiring bank and payment brand contacts.

## Network Segmentation

The Payment Module and its associated database reside in a dedicated, isolated Azure virtual network subnet (**10.1.4.0/24**) that is physically and logically separated from the rest of the Acme Retail infrastructure. This segmentation ensures that a compromise of any non-payment system does not provide a network path to payment-processing components.

Inbound traffic to the PCI subnet is controlled by **Azure Web Application Firewall (WAF)** and **Network Security Groups (NSGs)**. The NSG rules allow inbound HTTPS traffic on port 443 exclusively from the BookStore application subnet. All other inbound traffic is denied by default. The Payment Module does not accept direct inbound connections from the internet — all customer-facing requests are proxied through the BookStore application tier.

Outbound traffic from the PCI subnet is restricted to the Stripe API endpoints, routed through an **Azure NAT Gateway** with a static public IP address. This NAT Gateway address is registered with Stripe for IP allowlisting, providing an additional layer of access control. Outbound connections to any destination other than Stripe's documented IP ranges are blocked at the NSG level.

**Micro-segmentation** is applied within the PCI scope to further isolate components. The SQL Server database instance accepts connections only from the Payment Module application servers — connections from any other source, including other servers within the PCI subnet, are denied by database-level firewall rules. Administrative access to any system within the PCI scope requires a bastion host connection with multi-factor authentication (MFA) through Entra ID Conditional Access policies.

## Data Handling

Acme Retail's cardinal principle for cardholder data is straightforward: **no Primary Account Number (PAN) is ever stored, processed, or transmitted by any Acme Retail system**. Card data is captured exclusively by Stripe.js in a secure iframe and tokenized by Stripe before any reference reaches Acme Retail's infrastructure. The only payment-related identifiers that exist within Acme Retail systems are Stripe tokens — `pm_xxx` for payment methods and `pi_xxx` for payment intents — which cannot be used to reconstruct cardholder data.

Despite the absence of raw PAN data, additional protective measures are applied to all payment-related data. Sensitive fields in the payment transaction database — including customer email addresses, billing addresses, and Stripe token references — are encrypted at rest using **AES-256** encryption with keys managed by Azure Key Vault. Key rotation occurs annually, with the ability to trigger an emergency rotation within 4 hours if a key compromise is suspected.

**Log sanitization** is enforced across all components within the PCI scope. A regex-based PAN detection filter runs inline on all log output, identifying and masking any string that matches a credit card number pattern (Luhn-valid sequences of 13–19 digits). While the architecture should prevent PAN data from ever appearing in logs, this defense-in-depth measure guards against unexpected data leakage from third-party libraries or misconfigured logging. The sanitization filter is tested quarterly with known PAN patterns to verify continued effectiveness.

**Data retention** follows a tiered policy. Full transaction records, including Stripe token references and audit metadata, are retained for **7 years** to satisfy financial and tax audit requirements. After 3 years, records are **anonymized**: customer identifiers are replaced with non-reversible hashes, and billing address fields are truncated to ZIP/postal code only. Anonymized records retain sufficient detail for financial reconciliation and trend analysis without constituting personal data under GDPR or CCPA.

## Logging and Audit Trail

Every interaction with the Payment Module is logged to provide a complete, tamper-evident audit trail. Each log entry captures the **timestamp** (UTC, millisecond precision), **action** (e.g., `PaymentIntentCreated`, `CaptureCompleted`, `RefundInitiated`), **user ID** (the authenticated customer or internal operator), **source IP address**, **result** (success, failure, or error with code), and the **Stripe request ID** that correlates the action to Stripe's internal logs.

Audit logs are shipped to **Azure Sentinel** (Microsoft's cloud-native SIEM) in near-real time. Sentinel retains logs in two tiers: **90 days of hot storage** for active investigation and query access, and **1 year of cold storage** in Azure Blob (archive tier) for compliance and forensic purposes. Logs older than 1 year are purged unless a legal hold or active investigation requires extended retention.

Log integrity is protected through **immutable, append-only** storage. Once a log entry is written, it cannot be modified or deleted through normal administrative operations. Each log record includes a **row-level SHA-256 checksum** computed at write time. A nightly integrity verification job recalculates checksums for the previous day's log entries and alerts the InfoSec team if any discrepancy is detected.

Access to payment audit logs is restricted through **Entra ID role-based access control (RBAC)**. Only members of the `PCI-Audit-Readers` Entra ID group — which includes the Payments team lead, the InfoSec team, and designated finance auditors — can query payment logs in Sentinel. All access to the Sentinel workspace is itself logged, creating a secondary audit trail that records who accessed payment log data, when, and what queries were executed.

## Vulnerability Scanning Schedule

Acme Retail maintains a layered vulnerability management program that covers the PCI scope from external perimeter through application code to third-party dependencies. The scanning schedule is summarized below.

| Scan Type | Frequency | Tool | Scope | Owner |
|---|---|---|---|---|
| External ASV Scan | Quarterly | Qualys | All internet-facing PCI components | InfoSec |
| Internal Vulnerability Scan | Monthly | Tenable Nessus | All servers and databases within PCI subnet | InfoSec |
| Penetration Test | Annually | Third-party firm (rotated every 2 years) | Full PCI scope including application and network layers | InfoSec |
| Static Application Security Testing (SAST) | Every pull request | SonarQube + Semgrep | Payment Module source code | Payments Team |
| Dynamic Application Security Testing (DAST) | Monthly | OWASP ZAP | Payment Module API endpoints | InfoSec |
| Dependency Scanning | Every build | Dependabot + Snyk | All third-party libraries in Payment Module | Payments Team |

Findings from all scan types are triaged according to severity. **Critical** findings in the PCI scope must be remediated within 24 hours. **High** findings must be remediated within 7 days. **Medium** findings must be remediated within 30 days. **Low** findings are tracked and addressed within the next quarterly maintenance window. Remediation evidence is recorded in the vulnerability management system and included in the annual SAQ evidence package.

The quarterly ASV scan results are submitted directly to the acquiring bank as part of the ongoing PCI-DSS validation. A passing ASV scan (no exploitable vulnerabilities rated 4.0 or higher on the CVSS scale) is a prerequisite for continued SAQ A-EP compliance. If a quarterly scan fails, a rescan must be completed and passed within 30 days.

## Annual Compliance Assessment

The PCI-DSS compliance assessment follows an annual cycle anchored to a **March 31 completion deadline**. The assessment process begins in January with evidence collection and concludes with SAQ submission and AOC filing by the end of March.

The evidence package assembled for each annual assessment includes:

- **Network diagrams** showing the PCI subnet, segmentation boundaries, firewall rules, and data flow paths for payment transactions
- **Access control lists (ACLs)** documenting which personnel and service accounts have access to PCI-scoped systems, reviewed and attested by the Payments team lead
- **ASV scan results** from all four quarterly scans in the assessment period, demonstrating continuous compliance
- **Internal scan results** from Tenable Nessus, including evidence of remediation for any findings
- **Penetration test report** from the most recent annual test, including the executive summary and detailed findings with remediation evidence
- **Training records** confirming that all Payments team members completed PCI-DSS awareness training within the assessment period
- **Incident response test results** from the most recent tabletop exercise
- **Stripe AOC** confirming the payment processor's current PCI-DSS Level 1 certification

Every two years, Acme Retail engages an **external Qualified Security Assessor (QSA)** to perform an independent review of the PCI-DSS controls. While the SAQ A-EP classification does not mandate a QSA assessment, Acme Retail performs this review voluntarily as an additional assurance measure. The QSA's findings and recommendations are presented to the Acme Retail CISO and the Group CTO's office.

The completed SAQ A-EP and the accompanying AOC are filed with Acme Retail's **acquiring bank** (the financial institution that processes Acme Retail's card transactions). Copies are retained by the InfoSec team and are available to card brand representatives upon request.

## Incident Response Plan

The PCI-DSS incident response plan defines the procedures for detecting, containing, investigating, and recovering from security incidents that affect the payment processing environment. The plan is tested annually through a tabletop exercise involving the Payments team, the InfoSec team, and representatives from Acme Retail's legal and communications departments.

### Detection

Payment security incidents may be detected through multiple channels. **Azure WAF alerts** identify suspicious traffic patterns such as injection attempts, anomalous request volumes, or requests from known malicious IP ranges. **Azure Sentinel SIEM correlation rules** detect behavioral anomalies including unusual login patterns to PCI-scoped systems, bulk data access, and privilege escalation attempts. **Stripe anomaly notifications** alert the Payments team to unusual transaction patterns such as spikes in decline rates, elevated dispute rates, or geographic anomalies in transaction origins.

### Containment

Upon detection of a confirmed or suspected payment security incident, immediate containment actions are executed by the on-call Payments team engineer in coordination with the InfoSec team. Containment procedures include: **isolating the PCI subnet** by activating a pre-configured NSG rule set that blocks all inbound and outbound traffic except for active investigation sessions; **revoking Stripe API keys** and generating new keys from the Stripe Dashboard (a process that can be completed in under 5 minutes); and placing the Payment Module in **maintenance mode**, which returns a user-friendly "payments temporarily unavailable" message to customers while preserving the ability for authorized personnel to access systems for investigation.

### Investigation

The forensic investigation phase involves analyzing Azure Sentinel logs, WAF logs, Stripe audit logs, and system-level telemetry to determine the scope and impact of the incident. The investigation team documents the attack vector, the systems affected, the data potentially exposed (if any), and the timeline of the incident from initial compromise through detection. If the incident involves potential cardholder data exposure — which is unlikely given the tokenization architecture but must be considered — Stripe's incident response team is engaged to perform a parallel investigation on their side.

### Notification

Card brand operating regulations require notification within strict timelines. Acme Retail's policy mandates notification to **card brands and the acquiring bank within 24 hours** of confirming a payment data security incident. **Customer notification** is issued within **72 hours** of confirmation, in compliance with GDPR and state-level breach notification laws. Notification content is prepared by the legal team in consultation with the communications department and includes a description of the incident, the data potentially affected, the remediation steps taken, and resources available to affected customers.

### Recovery

Recovery procedures restore normal payment processing operations after the investigation confirms that the threat has been neutralized. Recovery steps include: generating and deploying **new Stripe API keys and webhook signing secrets**; **rotating all secrets** stored in Azure Key Vault that are accessible from the PCI scope; deploying any required **security patches** or configuration changes identified during the investigation; and performing a **verification ASV scan** to confirm that no exploitable vulnerabilities remain.

### Post-Incident Review

Within 5 business days of incident closure, the Payments team and InfoSec team conduct a **root cause analysis (RCA)**. The RCA documents the root cause, contributing factors, the effectiveness of the detection and response, and specific improvements to prevent recurrence. Improvements are tracked as action items with assigned owners and deadlines. The RCA summary is reported to the **Acme Retail CISO** and, for incidents meeting the severity threshold, to the **Group CTO's office**.

Controls identified as insufficient during the incident are updated in the PCI-DSS control matrix, and the updated controls are verified during the next quarterly review cycle. The incident and its resolution are included in the annual SAQ evidence package.

For details on the Payment Module's architecture and Stripe integration, see [Payment Module](../technical/payment-module.md). For the broader Acme Retail architecture, see the [Architecture Overview](../architecture/overview.md).
