# Research — DACH Business APIs + Proton.me Integrations

> Question answered: _Which business API integrations matter most for DACH
> (Germany, Austria, Switzerland) companies, and what is realistically possible
> with Proton.me?_

## Why DACH needs its own connector strategy

The current catalog is US-SaaS-centric. DACH SMBs and Mittelstand run on a
different stack: **DATEV** for accounting/tax, **Personio** for HR, local
e-invoicing (XRechnung/ZUGFeRD — legally mandatory for B2B since Jan 2025),
local payment methods, and a strong privacy preference (Proton, EU hosting).
Adding these turns veryfront from "works in the US" into "works for the German
Mittelstand."

## A. DACH accounting & tax (the highest-leverage gap)

| Service                                 | Role in DACH                                                        | API                                                                                                       | Auth                            | Notes                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DATEV**                               | De-facto standard; ~half a million German businesses + tax advisors | Mixed: REST for some products (DMS, MeinFiskal, DATEVconnect), **XML batch** (dxso jobs) for core booking | OAuth 2.0 (developer portal)    | ⚠️ Not a clean REST CRUD API — core accounting is async/batch/XML. Highest value **and** highest effort. Consider a narrow first scope (document upload + booking-suggestion export). |
| **Lexware Office** (formerly lexoffice) | Popular SMB cloud accounting                                        | REST `developers.lexware.io`                                                                              | OAuth 2.0 (auth-code) + API key | Clean REST: contacts, invoices, vouchers, files. **Best effort/value ratio for DACH accounting.**                                                                                     |
| **sevDesk**                             | Cloud accounting/invoicing, e-invoice (XRechnung/ZUGFeRD)           | REST `api.sevdesk.de`                                                                                     | api-key                         | Available from "Buchhaltung Pro" plan. Clean REST: contacts, invoices, vouchers.                                                                                                      |
| **QuickBooks / Xero**                   | Used by DACH startups & international SMBs                          | REST                                                                                                      | OAuth 2.0                       | Already covered as declared-but-missing; relevant here too.                                                                                                                           |

**Recommendation:** ship **Lexware Office** and **sevDesk** first (clean REST,
api-key/OAuth, immediate value), then scope a **DATEV** connector narrowly
because of its batch/XML model.

## B. DACH HR

| Service      | Role                                         | API                          | Auth                         |
| ------------ | -------------------------------------------- | ---------------------------- | ---------------------------- |
| **Personio** | Dominant DACH HR platform (8,000+ customers) | REST `developer.personio.de` | OAuth 2.0 client-credentials |

## C. DACH payments & logistics (e-commerce / operations)

| Service                         | Role                                                           | API                      | Auth            |
| ------------------------------- | -------------------------------------------------------------- | ------------------------ | --------------- |
| **Mollie**                      | EU/NL payments incl. local methods (SEPA, iDEAL, Klarna, etc.) | REST `api.mollie.com/v2` | api-key / OAuth |
| **Klarna**                      | BNPL, very common in DE checkout                               | REST                     | api-key (Basic) |
| **DHL** (Group/eCommerce/Paket) | Dominant DACH carrier                                          | REST `developer.dhl.com` | api-key/OAuth   |
| **GLS**                         | Major DACH parcel carrier                                      | REST shipping API        | api-key         |

## D. DACH-friendly collaboration already covered

Microsoft 365 (Outlook/Teams/SharePoint/OneDrive), SAP S/4HANA, and Stripe are
already in the catalog — these are heavily used in DACH and need no new work.

## E. Proton.me — reality check (important)

The user asked specifically for **Proton.me integrations**. The honest finding:

> **Proton has no public REST API for Mail, Calendar, or Drive.** After 10+ years
> Proton still does not offer a public developer API — this is a long-standing,
> frequently-requested gap (tracked on Proton's UserVoice). Everything is
> end-to-end encrypted, which is fundamentally at odds with a server-side
> OAuth/REST connector model.

What _is_ technically possible today:

| Proton surface                               | Programmatic access                                                                                                                                    | Fit for a veryfront connector?                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SimpleLogin** (Proton-owned email aliases) | ✅ **Real public REST API** — `app.simplelogin.io/api` (`/api/v2/aliases`, `/api/alias/random/new`, `/api/aliases/:id`, mailboxes, etc.), API-key auth | ✅ **Yes — the only clean Proton-family connector.** Ship this as "Proton / SimpleLogin."                                                         |
| **Proton Mail**                              | Proton Mail **Bridge** = local IMAP/SMTP for paid desktop users; `go-proton-api` = unofficial reverse-engineered client lib                            | ⚠️ Not a hosted REST/OAuth API → does not fit the connector model. Only viable as a self-hosted Bridge (IMAP/SMTP) recipe, not a cloud connector. |
| **Proton Calendar**                          | No public API (community-requested only)                                                                                                               | ❌ Not feasible now.                                                                                                                              |
| **Proton Drive**                             | No public API; SDK is for Proton's own clients                                                                                                         | ❌ Not feasible now.                                                                                                                              |
| **Proton VPN / Pass**                        | No public business automation API                                                                                                                      | ❌ Not feasible now.                                                                                                                              |

**Recommendation for Proton.me:**

1. **Ship a "Proton (SimpleLogin)" connector** — api-key auth, alias CRUD,
   mailbox management. This is the one genuinely buildable Proton-family
   integration and it's privacy-aligned (hide-my-email for DACH users).
2. **Document a Proton Mail Bridge recipe** (IMAP/SMTP) for self-hosters instead
   of a cloud connector — set expectations clearly.
3. **Track Proton's public API** for Mail/Calendar/Drive; revisit when/if Proton
   ships one. Do **not** build on `go-proton-api` (reverse-engineered, breaks on
   Proton changes, ToS risk).

## DACH + Proton shortlist (what to add)

Ranked by value/effort for DACH:

1. **Personio** (HR) — clean REST, dominant
2. **Lexware Office** (accounting) — clean REST, best effort/value
3. **sevDesk** (accounting/e-invoice) — clean REST
4. **Mollie** (payments) — EU methods, Stripe complement
5. **DHL** (logistics) — dominant carrier
6. **Proton / SimpleLogin** (privacy email aliases) — only buildable Proton API
7. **DATEV** (accounting/tax) — highest value, scope narrowly (batch/XML)
8. **Klarna** (BNPL) — DE checkout
9. **GLS** (logistics) — second carrier

## Sources

- DATEV: [Developer Portal](https://developer.datev.de/en/) · [API integration guide (Apideck)](https://www.apideck.com/blog/datev-api-integration-guide)
- Lexware Office: [developers.lexware.io](https://developers.lexware.io/) · [Public API](https://office.lexware.de/public-api/)
- sevDesk: [api.sevdesk.de](https://api.sevdesk.de/)
- Personio: [developer.personio.de](https://developer.personio.de/)
- Payments/logistics: [Mollie](https://docs.mollie.com/) · [Klarna Docs](https://docs.klarna.com/) · [DHL Developer Portal](https://developer.dhl.com/) · [GLS](https://gls-group.com/)
- Proton: [Proton API UserVoice request](https://protonmail.uservoice.com/forums/945460-general-ideas/suggestions/7179569-proton-api) · [go-proton-api](https://github.com/ProtonMail/go-proton-api) · [SimpleLogin API docs](https://github.com/simple-login/app/blob/master/docs/api.md)
