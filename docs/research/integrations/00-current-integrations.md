# Veryfront — Current Integration Catalog (Inventory)

> Source of truth: `src/integrations/_data.ts` (auto-generated connector catalog),
> `src/integrations/feature-flags.ts` (GA vs. experimental gating),
> `docs/guides/integrations.md` (public guide).
> Snapshot date: 2026-06-11.

## How integrations are modeled

A **connector** (`IntegrationConnector` in `src/integrations/types.ts`) bundles:

- `name` / `displayName` / `description` / `icon`
- `auth` — `oauth2` | `api-key` | `none` (+ provider, scopes, PKCE, token URLs)
- `envVars` — BYO-credential environment variables
- `tools[]` — individual REST/GraphQL operations (`IntegrationTool` →
  `IntegrationEndpoint`), each flagged `requiresWrite`

OAuth is brokered through shared providers in `src/oauth/providers/`:
**google**, **microsoft**, **atlassian** (plus per-connector providers like
`github`, `slack`, `linear`, `notion`, `figma`, `airtable`, `shopify`, …).

## Headline numbers

| Metric                                                        | Count   |
| ------------------------------------------------------------- | ------- |
| Connectors with full data (shipped templates)                 | **39**  |
| Total tools across all connectors                             | **474** |
| GA / generally-available (`SUPPORTED_INTEGRATION_NAMES`)      | **22**  |
| Experimental (gated by `VERYFRONT_EXPERIMENTAL_INTEGRATIONS`) | **17**  |
| Declared in code but **no data yet** (planned/missing)        | **12**  |
| Total _declared_ names (`DECLARED_INTEGRATION_NAMES`)         | **51**  |

## The 39 shipped connectors

Legend: **GA** = exposed by default · **EXP** = hidden behind
`VERYFRONT_EXPERIMENTAL_INTEGRATIONS` · auth: 🔑 api-key · 🔓 oauth2

| #  | Connector         | Provider / auth | Status |           Tools | Category            |
| -- | ----------------- | --------------- | ------ | --------------: | ------------------- |
| 1  | Gmail             | google 🔓       | GA     |              36 | Email               |
| 2  | Google Calendar   | google 🔓       | GA     |              10 | Calendar            |
| 3  | Google Drive      | google 🔓       | GA     |              10 | Storage             |
| 4  | Google Sheets     | google 🔓       | GA     |              19 | Spreadsheets        |
| 5  | Google Docs       | google 🔓       | GA     |               8 | Documents           |
| 6  | Microsoft Outlook | microsoft 🔓    | GA     |              64 | Email/Calendar      |
| 7  | Microsoft Teams   | microsoft 🔓    | GA     |               9 | Chat                |
| 8  | SharePoint        | microsoft 🔓    | GA     |               8 | Storage/Docs        |
| 9  | OneDrive          | microsoft 🔓    | GA     |               8 | Storage             |
| 10 | Slack             | slack 🔓        | GA     |               7 | Chat                |
| 11 | GitHub            | github 🔓       | GA     |              18 | Dev / SCM           |
| 12 | GitLab            | gitlab 🔓       | GA     |              14 | Dev / SCM           |
| 13 | Jira              | atlassian 🔓    | GA     |              15 | Project mgmt        |
| 14 | Confluence        | atlassian 🔓    | GA     |              10 | Docs/wiki           |
| 15 | Linear            | linear 🔓       | GA     |              14 | Issue tracking      |
| 16 | Asana             | asana 🔓        | GA     |              13 | Project mgmt        |
| 17 | Notion            | notion 🔓       | GA     |              11 | Docs/wiki           |
| 18 | Figma             | figma 🔓        | GA     |               8 | Design              |
| 19 | Airtable          | airtable 🔓     | GA     |              14 | Database            |
| 20 | Sentry            | sentry 🔓       | GA     |               8 | Observability       |
| 21 | Harvest           | harvest 🔓      | GA     |              32 | Time tracking       |
| 22 | HubSpot           | hubspot 🔓      | GA     |              23 | CRM/Marketing       |
| 23 | Salesforce        | salesforce 🔓   | EXP    |               9 | CRM                 |
| 24 | Stripe            | 🔑              | EXP    |               9 | Payments            |
| 25 | Shopify           | shopify 🔓      | EXP    |               8 | E-commerce          |
| 26 | Twilio            | 🔑              | EXP    |               9 | Comms (SMS/voice)   |
| 27 | Zendesk           | 🔑              | EXP    |               6 | Support             |
| 28 | ServiceNow        | 🔑              | EXP    |               8 | ITSM                |
| 29 | SAP S/4HANA       | 🔑              | EXP    |               5 | ERP                 |
| 30 | Trello            | trello 🔓       | EXP    |               7 | Project mgmt        |
| 31 | Bitbucket         | bitbucket 🔓    | EXP    |               7 | Dev / SCM           |
| 32 | Supabase          | 🔑              | EXP    |               9 | Database/BaaS       |
| 33 | Neon              | 🔑              | EXP    |               8 | Database (Postgres) |
| 34 | Snowflake         | 🔑              | EXP    |               9 | Data warehouse      |
| 35 | PostHog           | 🔑              | EXP    |               7 | Analytics           |
| 36 | Mixpanel          | 🔑              | EXP    |               8 | Analytics           |
| 37 | Persona           | 🔑              | EXP    |               6 | KYC/identity        |
| 38 | Anthropic         | 🔑              | EXP    |           (LLM) | AI                  |
| 39 | AWS               | 🔑              | EXP    | (S3/EC2/Lambda) | Cloud infra         |

### GA set (22) — `SUPPORTED_INTEGRATION_NAMES`

airtable, asana, calendar, confluence, docs-google, drive, figma, github,
gitlab, gmail, harvest, hubspot, jira, linear, notion, onedrive, outlook,
sentry, sharepoint, sheets, slack, teams.

### Experimental set (17)

anthropic, aws, bitbucket, mixpanel, neon, persona, posthog, salesforce, sap,
servicenow, shopify, snowflake, stripe, supabase, trello, twilio, zendesk.

## Coverage by category

- **Google Workspace** (5): Gmail, Calendar, Drive, Sheets, Docs
- **Microsoft 365** (4): Outlook, Teams, SharePoint, OneDrive
- **Dev / SCM** (4): GitHub, GitLab, Bitbucket, Sentry
- **Project / issues** (6): Jira, Confluence, Linear, Asana, Trello, Notion
- **CRM / Sales / Marketing** (2): Salesforce, HubSpot
- **Support / ITSM** (2): Zendesk, ServiceNow
- **Payments / Commerce** (2): Stripe, Shopify
- **Data / Analytics / DB** (6): Supabase, Neon, Snowflake, PostHog, Mixpanel, Airtable
- **Comms** (2): Slack, Twilio
- **ERP / Identity / AI / Cloud / Time** (6): SAP, Persona, Anthropic, AWS, Harvest, Figma

## Key observation — the declared-vs-shipped gap

`DECLARED_INTEGRATION_NAMES` lists **51** integration names, but only **39**
have connector data. **12 are declared but unimplemented** (see
[`01-missing-existing-integrations.md`](./01-missing-existing-integrations.md)):

> **twitter, monday, zoom, box, clickup, intercom, pipedrive, mailchimp,
> webex, freshdesk, quickbooks, xero**

These already have a reserved slot in the catalog enum — they are the
lowest-friction next integrations to build.
