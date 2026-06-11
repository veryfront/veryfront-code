# Research — Missing "Existing" Integrations (Declared but Unshipped)

> Question answered: _Which integrations does veryfront already commit to (in
> code / catalog) but not yet implement, and what public API would each map to?_

## Method

`src/integrations/feature-flags.ts` exports `DECLARED_INTEGRATION_NAMES` — the
canonical list of 51 connector slots the catalog reserves. `src/integrations/_data.ts`
ships connector data for only 39 of them. The set difference is the concrete,
already-promised backlog. For each I checked the vendor's **public API docs** to
confirm a REST/OAuth surface exists that fits veryfront's connector model
(`oauth2` | `api-key` auth + REST/GraphQL tools).

```
DECLARED (51) − SHIPPED (39) = 12 missing
```

## The 12 missing declared connectors

All 12 have production-grade public APIs — none is blocked by a missing API.

| Connector       | Category          | Auth model                          | Public API                           | Why it matters                                         | Build difficulty   |
| --------------- | ----------------- | ----------------------------------- | ------------------------------------ | ------------------------------------------------------ | ------------------ |
| **Zoom**        | Video/meetings    | OAuth 2.0 (Server-to-Server + user) | REST `api.zoom.us/v2`                | Meetings, recordings, transcripts — top agent use case | Low–Med            |
| **monday.com**  | Work mgmt         | OAuth 2.0                           | **GraphQL** `api.monday.com/v2`      | Major PM tool; complements Asana/Jira                  | Med (GraphQL)      |
| **Intercom**    | Support/messaging | OAuth 2.0                           | REST `api.intercom.io`               | Conversations, contacts, tickets                       | Low                |
| **Mailchimp**   | Email marketing   | OAuth 2.0 / api-key                 | REST `*.api.mailchimp.com/3.0`       | Campaigns, audiences, automation                       | Low                |
| **ClickUp**     | Work mgmt         | OAuth 2.0 / api token               | REST `api.clickup.com/api/v2`        | Popular PM; tasks/docs/time                            | Low                |
| **Pipedrive**   | CRM               | OAuth 2.0 / api token               | REST `api.pipedrive.com/v1`          | SMB CRM; deals/persons/orgs                            | Low                |
| **Box**         | Storage           | OAuth 2.0 (+ JWT app)               | REST `api.box.com/2.0`               | Enterprise file storage                                | Low–Med            |
| **Freshdesk**   | Support           | api-key (Basic)                     | REST `<domain>.freshdesk.com/api/v2` | Tickets/contacts; Zendesk alt                          | Low                |
| **QuickBooks**  | Accounting        | OAuth 2.0                           | REST `quickbooks.api.intuit.com/v3`  | Dominant SMB accounting (US)                           | Med (entity model) |
| **Xero**        | Accounting        | OAuth 2.0 (PKCE)                    | REST `api.xero.com/api.xro/2.0`      | Global SMB accounting (UK/AU/NZ/EU)                    | Med                |
| **Twitter / X** | Social            | OAuth 2.0 (PKCE)                    | REST `api.twitter.com/2`             | Posting/listening; paid tiers, rate caps               | Med (cost/limits)  |
| **Webex**       | Video/meetings    | OAuth 2.0                           | REST `webexapis.com/v1`              | Enterprise (esp. EU/regulated) Teams/Zoom alt          | Low–Med            |

### Notes / caveats per connector

- **monday.com** is the only GraphQL-first one here — reuse the GraphQL endpoint
  shape already supported by `IntegrationEndpoint.type: "graphql"` (used by
  Linear).
- **Twitter/X**: API access now requires a paid plan; free tier is write-limited.
  Worth shipping but flag the cost/rate-limit reality to users.
- **QuickBooks / Xero**: both use rich accounting object models (invoices,
  bills, accounts, journal entries) — higher modeling effort but high value, and
  they pair naturally with the DACH accounting tools in
  [`02-dach-and-proton-integrations.md`](./02-dach-and-proton-integrations.md).
- **Freshdesk** uses simple API-key Basic auth — fastest of the 12 to ship.

## Recommended build order (highest value / lowest effort first)

1. **Zoom** — high demand, clean REST, transcripts/recordings are killer for agents
2. **Intercom** — clean REST, support automation
3. **Freshdesk** — trivial auth, rounds out support category
4. **Pipedrive** — clean REST, fills SMB-CRM gap below Salesforce/HubSpot
5. **ClickUp** — clean REST, popular PM
6. **Mailchimp** — clean REST, marketing automation
7. **Box** — enterprise storage parity with Drive/OneDrive/SharePoint
8. **monday.com** — GraphQL, reuse Linear pattern
9. **Xero** — accounting, global SMB
10. **QuickBooks** — accounting, US SMB
11. **Webex** — enterprise meetings (EU/regulated)
12. **Twitter/X** — last (paid API + rate limits dampen value)

## Bottom line

There is **no "missing existing integration" that lacks a public API** — every
one of the 12 reserved slots is shippable today. The gap is purely
implementation backlog. Closing it takes veryfront from **39 → 51** connectors
and fills the most visible holes versus competitors: **video meetings (Zoom,
Webex), SMB CRM (Pipedrive), SMB accounting (QuickBooks, Xero), marketing
(Mailchimp), and enterprise storage (Box)**.

## Sources

- [DATEV Developer Portal](https://developer.datev.de/en/) · [Personio Developer Hub](https://developer.personio.de/) (cross-ref)
- [Zoom API](https://developers.zoom.us/docs/api/) · [monday.com API](https://developer.monday.com/api-reference/) · [Intercom API](https://developers.intercom.com/) · [Mailchimp Marketing API](https://mailchimp.com/developer/marketing/api/)
- [ClickUp API](https://developer.clickup.com/) · [Pipedrive API](https://developers.pipedrive.com/) · [Box API](https://developer.box.com/) · [Freshdesk API](https://developers.freshdesk.com/api/)
- [QuickBooks Online API](https://developer.intuit.com/app/developer/qbo/docs/get-started) · [Xero API](https://developer.xero.com/documentation/api/accounting/overview) · [X/Twitter API](https://developer.x.com/en/docs/x-api) · [Webex API](https://developer.webex.com/docs)
