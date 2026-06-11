# 🎯 Goal — Top 70 Most Usable & Popular Integrations

> The target catalog. Ranked by **usability × popularity**, weighted for
> veryfront's agent use cases and a **DACH-first** market. Each row shows current
> status so this doubles as a roadmap.
>
> Ranks **1–50** = global usability core. Ranks **51–70** = a deliberate
> **DACH-not-implemented** block (see file 04) — the integrations that make
> veryfront usable for the German/Austrian/Swiss market.
>
> Status legend: ✅ **GA** (shipped, default) · 🧪 **EXP** (shipped, gated) ·
> 🛠️ **Declared** (slot reserved, no data — see file 01) · ➕ **New** (proposed —
> DACH/Proton, see files 02 & 04)

## Scoreboard

| Bucket                                      | Count            |
| ------------------------------------------- | ---------------- |
| Already shipped (✅ GA + 🧪 EXP)            | 34 of the top 70 |
| Declared-but-missing (🛠️)                   | 10 of the top 70 |
| New / proposed (➕)                         | 26 of the top 70 |
| **Net new connectors to reach this Top 70** | **36**           |

> Of the 39 shipped connectors, 34 make the Top 70. The 5 that don't (Persona,
> SAP S/4HANA, Harvest, Anthropic, AWS) stay in the catalog but rank lower on
> broad popularity — keep them, don't remove. **20 of the 26 "new" entries are
> DACH-specific** (ranks 51–70), reflecting the requested focus.

## The Top 70

### Ranks 1–50 — global usability core

| Rank | Integration              | Category              | Status      | Notes                                      |
| ---: | ------------------------ | --------------------- | ----------- | ------------------------------------------ |
|    1 | **Gmail**                | Email                 | ✅ GA       | Highest-use surface (36 tools)             |
|    2 | **Google Calendar**      | Calendar              | ✅ GA       | Scheduling core                            |
|    3 | **Slack**                | Chat                  | ✅ GA       | #1 team comms                              |
|    4 | **GitHub**               | Dev/SCM               | ✅ GA       | #1 dev platform                            |
|    5 | **Google Drive**         | Storage               | ✅ GA       |                                            |
|    6 | **Microsoft Outlook**    | Email/Cal             | ✅ GA       | Enterprise + DACH (64 tools)               |
|    7 | **Notion**               | Docs/wiki             | ✅ GA       |                                            |
|    8 | **Google Sheets**        | Spreadsheets          | ✅ GA       | Data workhorse                             |
|    9 | **Jira**                 | Project mgmt          | ✅ GA       |                                            |
|   10 | **Microsoft Teams**      | Chat/meetings         | ✅ GA       | DACH enterprise default                    |
|   11 | **Salesforce**           | CRM                   | 🧪 EXP      | Promote to GA                              |
|   12 | **HubSpot**              | CRM/Marketing         | ✅ GA       |                                            |
|   13 | **Stripe**               | Payments              | 🧪 EXP      | Promote to GA                              |
|   14 | **Linear**               | Issues                | ✅ GA       |                                            |
|   15 | **Zoom**                 | Video/meetings        | 🛠️ Declared | **Build #1** — transcripts/recordings      |
|   16 | **Google Docs**          | Documents             | ✅ GA       |                                            |
|   17 | **Confluence**           | Docs/wiki             | ✅ GA       |                                            |
|   18 | **Asana**                | Project mgmt          | ✅ GA       |                                            |
|   19 | **Zendesk**              | Support               | 🧪 EXP      | Promote to GA                              |
|   20 | **GitLab**               | Dev/SCM               | ✅ GA       | Strong in EU/DACH                          |
|   21 | **Airtable**             | Database              | ✅ GA       |                                            |
|   22 | **OneDrive**             | Storage               | ✅ GA       |                                            |
|   23 | **SharePoint**           | Storage/Docs          | ✅ GA       | DACH enterprise                            |
|   24 | **Trello**               | Project mgmt          | 🧪 EXP      |                                            |
|   25 | **Figma**                | Design                | ✅ GA       |                                            |
|   26 | **Shopify**              | E-commerce            | 🧪 EXP      |                                            |
|   27 | **Intercom**             | Support/msg           | 🛠️ Declared | **Build #2**                               |
|   28 | **Mailchimp**            | Email marketing       | 🛠️ Declared |                                            |
|   29 | **Twilio**               | Comms (SMS)           | 🧪 EXP      |                                            |
|   30 | **monday.com**           | Work mgmt             | 🛠️ Declared | GraphQL (reuse Linear pattern)             |
|   31 | **ClickUp**              | Work mgmt             | 🛠️ Declared |                                            |
|   32 | **Pipedrive**            | CRM (SMB)             | 🛠️ Declared | Fills SMB-CRM gap                          |
|   33 | **Sentry**               | Observability         | ✅ GA       |                                            |
|   34 | **Personio**             | HR (DACH)             | ➕ New      | **DACH #1** — dominant HR                  |
|   35 | **QuickBooks**           | Accounting            | 🛠️ Declared | US SMB accounting                          |
|   36 | **Xero**                 | Accounting            | 🛠️ Declared | Global SMB accounting                      |
|   37 | **Lexware Office**       | Accounting (DACH)     | ➕ New      | **DACH #2** — clean REST                   |
|   38 | **DATEV**                | Accounting/tax (DACH) | ➕ New      | **DACH** — highest value, scope narrowly   |
|   39 | **Supabase**             | Database/BaaS         | 🧪 EXP      |                                            |
|   40 | **Freshdesk**            | Support               | 🛠️ Declared | Trivial auth; fast win                     |
|   41 | **Box**                  | Storage (enterprise)  | 🛠️ Declared |                                            |
|   42 | **Mollie**               | Payments (EU)         | ➕ New      | EU methods; Stripe complement              |
|   43 | **PostHog**              | Product analytics     | 🧪 EXP      |                                            |
|   44 | **ServiceNow**           | ITSM                  | 🧪 EXP      | Enterprise                                 |
|   45 | **sevDesk**              | Accounting (DACH)     | ➕ New      | e-invoice (XRechnung/ZUGFeRD)              |
|   46 | **Snowflake**            | Data warehouse        | 🧪 EXP      |                                            |
|   47 | **Mixpanel**             | Analytics             | 🧪 EXP      |                                            |
|   48 | **Bitbucket**            | Dev/SCM               | 🧪 EXP      |                                            |
|   49 | **Neon**                 | Database (Postgres)   | 🧪 EXP      |                                            |
|   50 | **Proton / SimpleLogin** | Privacy email aliases | ➕ New      | Only buildable Proton API; privacy-aligned |

### Ranks 51–70 — DACH not-implemented block (the requested focus)

All ➕ New, none shipped today. Details + APIs in
[`04-dach-not-implemented-deep-dive.md`](./04-dach-not-implemented-deep-dive.md).

| Rank | Integration                   | Category                 | Region | API / fit         | Notes                                          |
| ---: | ----------------------------- | ------------------------ | ------ | ----------------- | ---------------------------------------------- |
|   51 | **Shopware**                  | E-commerce platform      | 🇩🇪     | REST Admin API ✅ | #1 DE shop platform                            |
|   52 | **Qonto**                     | Business banking         | 🇩🇪🇦🇹   | REST ✅           | Neobank for DE/AT/FR/IT                        |
|   53 | **Sendcloud**                 | Shipping (multi-carrier) | 🇪🇺     | REST ✅           | One connector → DHL/DPD/GLS/Hermes             |
|   54 | **Brevo** (Sendinblue)        | Email/SMS marketing      | 🇪🇺     | REST ✅           | EU Mailchimp alternative                       |
|   55 | **finAPI**                    | Open banking (AIS/PIS)   | 🇩🇪     | REST ✅           | BaFin-licensed, 99% DE bank coverage           |
|   56 | **Xentral**                   | ERP for e-commerce       | 🇩🇪     | REST ✅           | 1,600+ shop/marketplace interfaces             |
|   57 | **GoCardless**                | SEPA Direct Debit        | 🇪🇺     | REST ✅           | Recurring EUR collections                      |
|   58 | **weclapp**                   | Cloud ERP + CRM          | 🇩🇪     | REST ✅           | SMB all-in-one                                 |
|   59 | **Hetzner Cloud**             | Cloud infrastructure     | 🇩🇪     | REST ✅           | Hugely popular GDPR infra                      |
|   60 | **plentymarkets** (PlentyONE) | E-commerce/inventory     | 🇩🇪     | REST ✅           | Multichannel commerce                          |
|   61 | **Factorial**                 | HR                       | 🇪🇺     | REST ✅           | Fast-growing DACH/EU HR                        |
|   62 | **Unzer** (ex-Heidelpay)      | Payment gateway          | 🇩🇪     | REST ✅           | Local DE payment methods                       |
|   63 | **FastBill**                  | Invoicing/accounting     | 🇩🇪     | REST ✅           | SMB invoicing                                  |
|   64 | **Skribble**                  | eIDAS e-signature        | 🇨🇭     | REST ✅           | Legally-binding QES in DACH                    |
|   65 | **Billbee**                   | Order management         | 🇩🇪     | REST ✅           | Multichannel order ops                         |
|   66 | **Nextcloud**                 | Files/collab (self-host) | 🇩🇪     | WebDAV/OCS ⚠️     | DACH gov/SME staple                            |
|   67 | **Moss**                      | Spend management/cards   | 🇩🇪     | REST ✅           | Corporate cards + AP                           |
|   68 | **CleverReach**               | Email marketing          | 🇩🇪     | REST ✅           | DE newsletter automation                       |
|   69 | **Trusted Shops**             | Trust mark + reviews     | 🇩🇪     | REST ✅           | DE checkout trust                              |
|   70 | **mailbox.org**               | Privacy email            | 🇩🇪     | CalDAV/IMAP ⚠️    | GDPR email; Proton/Tuta alt (recipe, not REST) |

## Counts to reach this Top 70

**Net new = 36 connectors:**

- **10 declared-but-missing** (slots reserved — file 01): Zoom · Intercom ·
  Mailchimp · monday.com · ClickUp · Pipedrive · QuickBooks · Xero · Freshdesk · Box
- **6 new — global/EU** (files 02): Personio · Lexware Office · DATEV · Mollie ·
  sevDesk · Proton/SimpleLogin
- **20 new — DACH block** (file 04, ranks 51–70): Shopware · Qonto · Sendcloud ·
  Brevo · finAPI · Xentral · GoCardless · weclapp · Hetzner Cloud · plentymarkets ·
  Factorial · Unzer · FastBill · Skribble · Billbee · Nextcloud · Moss ·
  CleverReach · Trusted Shops · mailbox.org

> Webex and Twitter/X are declared but rank **below 70** on agent-usability —
> keep as backlog. ⚠️ = non-REST protocol; needs a recipe/adapter, not the
> standard OAuth-REST connector (see file 04 fit caveats).

## Suggested execution order

**Phase 1 — global gaps (clean REST, high demand):**
Zoom → Intercom → Freshdesk → Pipedrive → ClickUp → Mailchimp → Box → monday.com

**Phase 2 — DACH market entry (the strategic block):**
Shopware → Personio → Lexware Office → sevDesk → Qonto → Sendcloud → Brevo →
finAPI → GoCardless → Xentral/weclapp/plentymarkets → Hetzner → Skribble → DATEV (narrow scope)

**Phase 3 — accounting depth, privacy & finish:**
QuickBooks → Xero → Mollie → Proton/SimpleLogin → FastBill/Billbee/Moss/Unzer →
Factorial → Nextcloud + mailbox.org (recipes) → CleverReach/Trusted Shops →
promote EXP→GA (Salesforce, Stripe, Zendesk, Supabase, …)

## What to keep but de-prioritize (below top 70)

SAP S/4HANA, Persona (KYC), Harvest, Anthropic (better served by `ext-llm-*`),
AWS (infra, not agent connector), Webex, Twitter/X, IONOS, DPD/GLS (covered by
Sendcloud), JTL-Wawi (desktop), North Data. All remain valid catalog entries;
they just don't rank in the most-used 70.

---

_Companion docs:_
[`00-current-integrations.md`](./00-current-integrations.md) ·
[`01-missing-existing-integrations.md`](./01-missing-existing-integrations.md) ·
[`02-dach-and-proton-integrations.md`](./02-dach-and-proton-integrations.md) ·
[`04-dach-not-implemented-deep-dive.md`](./04-dach-not-implemented-deep-dive.md)
