# Research — DACH Not-Yet-Implemented Integrations (Deep Dive)

> Focus requested: integrations **not implemented** in veryfront that matter most
> to **DACH** (Germany 🇩🇪, Austria 🇦🇹, Switzerland 🇨🇭) businesses.
> None of the connectors below exist in `src/integrations/_data.ts` today.
> Snapshot: 2026-06-11.

## Why this matters

veryfront's catalog is US-SaaS-centric. The German Mittelstand and DACH SMBs run
on a distinct stack: local accounting/tax (DATEV, Lexware, sevDesk), local HR
(Personio), **German e-commerce ERPs** (Shopware, Xentral, weclapp, JTL,
plentymarkets), **SEPA/open banking** (finAPI, GoCardless, Qonto), local
**logistics** (DHL, DPD, Sendcloud), GDPR-first **infra & privacy** (Hetzner,
Nextcloud, mailbox.org), and **eIDAS e-signature** (Skribble). These are the
integrations that decide whether veryfront is usable for a Stuttgart manufacturer
or a Zürich agency — and none are built yet.

## Fit caveat (read first)

veryfront's connector model expects **REST/GraphQL + `oauth2`/`api-key`**. Most
items below fit cleanly. A few use other protocols and need a different approach —
flagged **⚠️ protocol fit**:

- **Nextcloud** → WebDAV + OCS API (not OAuth-REST CRUD)
- **mailbox.org** → CalDAV/CardDAV/IMAP/SMTP (no public REST API — like Proton)
- **JTL-Wawi** → desktop ERP; integrate via JTL connectors / JTL-Worker API
- **DATEV** → core accounting is async XML batch, not REST (see file 02)

## A. DACH e-commerce platforms & ERPs (highest local leverage)

Germany is the largest e-commerce market in DACH and **Shopware is the leading
shop platform there**; merchants pair it with a German ERP/WaWi. All have REST APIs.

| Service                       | Role                                            | API                        | Auth                           | Fit                |
| ----------------------------- | ----------------------------------------------- | -------------------------- | ------------------------------ | ------------------ |
| **Shopware**                  | #1 DE shop platform (Shopware 6)                | REST Admin API + Store API | OAuth 2.0 (client-credentials) | ✅ Clean           |
| **Xentral**                   | DE cloud ERP for e-commerce (1,600+ interfaces) | REST API                   | api-key / OAuth                | ✅ Clean           |
| **weclapp**                   | DE cloud ERP + CRM                              | REST API                   | api-key (token)                | ✅ Clean           |
| **plentymarkets (PlentyONE)** | DE all-in-one commerce/inventory                | REST API                   | OAuth 2.0                      | ✅ Clean           |
| **JTL-Wawi**                  | DE multichannel ERP/WaWi (very common)          | JTL connectors / Worker    | api-key                        | ⚠️ desktop/on-prem |

## B. DACH banking, open banking & payments

E-invoicing is mandatory B2B in Germany since Jan 2025; SEPA + open banking are
the local payment reality, not US card rails.

| Service                  | Role                                                                    | API      | Auth                     | Fit      |
| ------------------------ | ----------------------------------------------------------------------- | -------- | ------------------------ | -------- |
| **Qonto**                | Business banking (DE/AT/FR/IT/ES)                                       | REST API | api-key / OAuth          | ✅ Clean |
| **finAPI**               | BaFin-licensed open banking, **99%+ DE bank coverage**, AIS + PIS, SEPA | REST API | OAuth 2.0                | ✅ Clean |
| **GoCardless**           | **SEPA Direct Debit** + bank-account data                               | REST API | OAuth 2.0 / access token | ✅ Clean |
| **Unzer** (ex-Heidelpay) | DE payment gateway, local methods                                       | REST API | api-key                  | ✅ Clean |
| **Moss**                 | DE spend management / corporate cards                                   | REST API | api-key                  | ✅ Clean |
| **FastBill**             | DE invoicing & accounting (SMB)                                         | REST API | api-key                  | ✅ Clean |
| **Billbee**              | DE multichannel order management                                        | REST API | api-key                  | ✅ Clean |

## C. DACH HR & payroll

| Service       | Role                                 | API      | Auth                  | Fit      |
| ------------- | ------------------------------------ | -------- | --------------------- | -------- |
| **Personio**  | Dominant DACH HR (in Top 50 already) | REST     | OAuth 2.0 client-cred | ✅ Clean |
| **Factorial** | Fast-growing EU/DACH HR              | REST API | api-key / OAuth       | ✅ Clean |

## D. DACH logistics & shipping

| Service                         | Role                                            | API                        | Auth            | Fit                                           |
| ------------------------------- | ----------------------------------------------- | -------------------------- | --------------- | --------------------------------------------- |
| **DHL** (Group/Paket/eCommerce) | Dominant DACH carrier                           | REST `developer.dhl.com`   | api-key / OAuth | ✅ Clean                                      |
| **Sendcloud**                   | EU multi-carrier (80+ incl. DHL/DPD/GLS/Hermes) | REST API                   | api-key / OAuth | ✅ Clean — one connector covers many carriers |
| **DPD**                         | Major DACH parcel network                       | REST (often via Sendcloud) | api-key         | ✅ Clean                                      |
| **GLS**                         | DACH parcel carrier                             | REST shipping API          | api-key         | ✅ Clean                                      |

## E. DACH infrastructure & privacy (GDPR-first — extends the Proton theme)

DACH strongly prefers EU-hosted, GDPR-compliant, often self-hosted tools.

| Service                  | Role                                           | API                      | Auth                      | Fit            |
| ------------------------ | ---------------------------------------------- | ------------------------ | ------------------------- | -------------- |
| **Hetzner Cloud**        | Hugely popular DE cloud infra                  | REST API + CLI           | api token                 | ✅ Clean       |
| **Nextcloud**            | Self-hosted files/collab (DACH gov/SME staple) | WebDAV + OCS API         | app password / OAuth2 app | ⚠️ WebDAV/OCS  |
| **IONOS**                | Leading DE hosting/cloud                       | REST API                 | api-key                   | ✅ Clean       |
| **mailbox.org**          | DE privacy email (Proton/Tuta alternative)     | CalDAV/CardDAV/IMAP/SMTP | app password              | ⚠️ no REST API |
| **Proton / SimpleLogin** | Privacy email aliases (in Top 50 already)      | REST                     | api-key                   | ✅ Clean       |

> **Tuta (Tutanota)** and **Proton Mail/Calendar/Drive** are intentionally
> excluded here: like Proton's mail surface, they have **no public REST API**
> (E2E-encrypted by design). The only buildable privacy-email connectors are
> **SimpleLogin** (REST) and **mailbox.org** (CalDAV/IMAP recipe).

## F. DACH marketing, e-signature, trust & company data

| Service                   | Role                                     | API      | Auth      | Fit                                           |
| ------------------------- | ---------------------------------------- | -------- | --------- | --------------------------------------------- |
| **Brevo** (ex-Sendinblue) | EU email/SMS/WhatsApp marketing          | REST API | api-key   | ✅ Clean                                      |
| **CleverReach**           | DE email marketing/automation            | REST API | OAuth 2.0 | ✅ Clean                                      |
| **Skribble**              | CH **eIDAS qualified e-signature**       | REST API | api-key   | ✅ Clean — legally-binding signatures in DACH |
| **Trusted Shops**         | DE trust mark + reviews (checkout trust) | REST API | api-key   | ✅ Clean                                      |
| **North Data**            | DE/AT/CH company & Handelsregister data  | REST API | api-key   | ✅ Clean                                      |

## Prioritized DACH build list (value × effort, not-implemented only)

**Tier 1 — clean REST, broad DACH reach:**

1. **Shopware** (commerce backbone)
2. **Personio** (HR — already proposed)
3. **Lexware Office** + **sevDesk** (accounting — already proposed)
4. **Qonto** (business banking)
5. **Sendcloud** (one connector → all DACH carriers)
6. **Brevo** (EU marketing)

**Tier 2 — high local value:**
7. **finAPI** (open banking / SEPA, 99% DE coverage)
8. **GoCardless** (SEPA Direct Debit)
9. **Xentral** / **weclapp** / **plentymarkets** (commerce ERPs)
10. **DATEV** (narrow scope — batch/XML)
11. **Hetzner Cloud** (DE infra)
12. **Skribble** (eIDAS e-signature)

**Tier 3 — niche but differentiating:**
FastBill · Billbee · Moss · Unzer · Factorial · Nextcloud (WebDAV) ·
mailbox.org (CalDAV recipe) · Trusted Shops · North Data · CleverReach · IONOS ·
JTL-Wawi · DPD · GLS

## Sources

- E-commerce/ERP: [Shopware](https://developer.shopware.com/docs/) · [Xentral](https://developer.xentral.com/) · [weclapp API](https://www.weclapp.com/en/api/) · [plentymarkets REST API](https://developers.plentymarkets.com/en-gb/plentymarkets-rest-api/) · [JTL](https://developer.jtl-software.com/)
- Banking/payments: [finAPI](https://www.finapi.io/en/products/open-banking/banking-api/) · [Qonto API](https://docs.qonto.com/) · [GoCardless](https://developer.gocardless.com/api-reference/) · [Unzer](https://docs.unzer.com/) · [FastBill](https://apidocs.fastbill.com/) · [Billbee](https://app.billbee.io/swagger/) · [Moss](https://de.getmoss.com/)
- HR: [Personio](https://developer.personio.de/) · [Factorial](https://apidoc.factorialhr.com/)
- Logistics: [DHL](https://developer.dhl.com/) · [Sendcloud API](https://www.sendcloud.com/api/) · DPD/GLS (via Sendcloud or carrier accounts)
- Infra/privacy: [Hetzner Cloud API](https://docs.hetzner.cloud/) · [IONOS](https://developer.hosting.ionos.de/) · [Nextcloud APIs](https://docs.nextcloud.com/server/latest/developer_manual/) · [mailbox.org](https://kb.mailbox.org/)
- Marketing/signature/trust: [Brevo](https://developers.brevo.com/) · [CleverReach](https://rest.cleverreach.com/) · [Skribble API](https://api.skribble.com/) · [Trusted Shops](https://developers.trustedshops.com/) · [North Data](https://www.northdata.com/_/api)
