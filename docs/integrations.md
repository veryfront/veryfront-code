---
title: "Integrations"
description: "Config-driven integration tools with OAuth, token management, and API execution for 37+ services."
order: 1
---

# Integrations

Veryfront integrations let AI agents use third-party services on behalf of users. Developers enable integrations in `veryfront.config.ts` and the framework handles everything — tool registration, OAuth flows, token management, and API execution.

## How It Works

```
veryfront.config.ts            Renderer (framework)               API (token vault)
┌──────────────────┐     ┌────────────────────────────┐     ┌────────────────────────┐
│ integrations:    │────▶│ 1. Read config             │     │ Connector specs (JSON) │
│   github: {}     │     │ 2. Fetch connector spec    │────▶│ OAuth ceremonies       │
│   slack:         │     │    (cached 5 min)          │     │ Token storage          │
│     tools:       │     │ 3. Generate MCP tools      │     │ Auto-refresh           │
│       - send-msg │     │ 4. On tool call:           │     │                        │
│   linear:        │     │    a. Get token from API   │────▶│ GET /oauth/token/:name │
│     perUser: true│     │    b. Call external API    │     │ → { accessToken }      │
└──────────────────┘     └─────────────┬──────────────┘     └────────────────────────┘
                                       │ Bearer token
                                       ▼
                         ┌────────────────────────────┐
                         │ External API (GitHub, etc.) │
                         └────────────────────────────┘
```

**Key points:**
- The **renderer** owns tool listing and execution — tools run in-process, not proxied through the API
- The **API** is the token vault — it handles OAuth ceremonies, stores encrypted tokens, and auto-refreshes expired ones
- **Config-driven** — adding `github: {}` to the `integrations` record enables all GitHub tools instantly
- **Per-user tokens** — set `perUser: true` so each end-user authenticates with their own account
- **Tool allowlisting** — use `tools: ["send-message"]` to expose only specific tools

## Configuration

```ts
// veryfront.config.ts
import { defineConfig } from "veryfront/config";

export default defineConfig({
  integrations: {
    // All tools, project-level token
    github: {},

    // Only specific tools
    slack: {
      tools: ["send-message", "list-channels"],
    },

    // Per-user tokens (each end-user authenticates individually)
    linear: {
      perUser: true,
    },

    // API-key based (no OAuth needed)
    stripe: {},
  },
});
```

## Authentication Flow

When an agent calls an integration tool and no valid token exists:

1. Tool returns `{ error: "authentication_required", connectUrl: "..." }`
2. Agent surfaces the connect URL to the user
3. User clicks → Veryfront OAuth app → Provider consent screen → Callback
4. Token stored per (project, user, integration) — encrypted at rest
5. Subsequent tool calls succeed automatically
6. Token refresh is transparent — users never see expiry errors

### Zero-Config OAuth (Managed Apps)

For OAuth integrations, Veryfront provides **managed OAuth apps** by default. Developers don't need to create their own OAuth apps — just add the integration to config and it works.

### BYO Credentials

Enterprise teams can use their own OAuth app credentials by setting environment variables:

```bash
GITHUB_CLIENT_ID=your_app_id
GITHUB_CLIENT_SECRET=your_app_secret
```

When both are set, the system uses your credentials. Otherwise, it falls back to Veryfront's managed app.

## API Setup for Managed OAuth Apps

To enable zero-config OAuth for users, Veryfront needs a registered OAuth app for each provider. Here's how to set them up:

### Provider Registration

For each OAuth provider, create an application and configure the callback URL:

```
https://api.veryfront.com/api/oauth/callback/{integration-name}
```

Then set the credentials as environment variables on the API:

| Provider | Variable Prefix | Registration URL |
|----------|----------------|-----------------|
| GitHub | `GITHUB_` | https://github.com/settings/developers |
| Google (Gmail, Calendar, Docs, Drive, Sheets) | `GOOGLE_` | https://console.cloud.google.com/apis/credentials |
| Slack | `SLACK_` | https://api.slack.com/apps |
| Microsoft (Outlook, Teams, OneDrive, SharePoint) | `MICROSOFT_` | https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps |
| Atlassian (Jira, Confluence) | `ATLASSIAN_` | https://developer.atlassian.com/console/myapps/ |
| Linear | `LINEAR_` | https://linear.app/settings/api |
| Notion | `NOTION_` | https://www.notion.so/my-integrations |
| Figma | `FIGMA_` | https://www.figma.com/developers/apps |
| Discord | `DISCORD_` | https://discord.com/developers/applications |
| Dropbox | `DROPBOX_` | https://www.dropbox.com/developers/apps |
| Airtable | `AIRTABLE_` | https://airtable.com/create/oauth |
| Asana | `ASANA_` | https://app.asana.com/0/developer-console |
| Bitbucket | `BITBUCKET_` | https://bitbucket.org/workspace/settings/oauth-consumers |
| Box | `BOX_` | https://app.box.com/developers/console |
| ClickUp | `CLICKUP_` | https://app.clickup.com/settings/integrations |
| Freshdesk | `FRESHDESK_` | https://developers.freshdesk.com/ |
| GitLab | `GITLAB_` | https://gitlab.com/-/profile/applications |
| HubSpot | `HUBSPOT_` | https://app.hubspot.com/developer |
| Intercom | `INTERCOM_` | https://app.intercom.com/a/apps/_/developer-hub |
| Mailchimp | `MAILCHIMP_` | https://admin.mailchimp.com/account/oauth2/ |
| Monday.com | `MONDAY_` | https://monday.com/developers/apps |
| Pipedrive | `PIPEDRIVE_` | https://developers.pipedrive.com/docs/marketplace |
| QuickBooks | `QUICKBOOKS_` | https://developer.intuit.com/app/developer/dashboard |
| Salesforce | `SALESFORCE_` | https://login.salesforce.com/lightning/setup/ConnectedApplication |
| ServiceNow | `SERVICENOW_` | Instance admin → Application Registry |
| Shopify | `SHOPIFY_` | https://partners.shopify.com/organizations |
| Trello | `TRELLO_` | https://trello.com/power-ups/admin |
| Twitter/X | `TWITTER_` | https://developer.twitter.com/en/portal/dashboard |
| Webex | `WEBEX_` | https://developer.webex.com/my-apps |
| Xero | `XERO_` | https://developer.xero.com/app/manage |
| Zendesk | `ZENDESK_` | https://zendesk.com/admin/apps-integrations |
| Zoom | `ZOOM_` | https://marketplace.zoom.us/develop |

Each provider needs two variables:
```bash
{PREFIX}CLIENT_ID=...
{PREFIX}CLIENT_SECRET=...
```

For example:
```bash
GITHUB_CLIENT_ID=Iv1.abc123
GITHUB_CLIENT_SECRET=secret_xyz
GOOGLE_CLIENT_ID=123456789.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abc
SLACK_CLIENT_ID=123456.789012
SLACK_CLIENT_SECRET=abc123secret
```

### Google APIs (shared credentials)

Google Calendar, Gmail, Docs, Drive, and Sheets all use the same `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Register one Google OAuth app and enable all required APIs in the Cloud Console:

- [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)
- [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
- [Google Docs API](https://console.cloud.google.com/apis/library/docs.googleapis.com)
- [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
- [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)

### Microsoft APIs (shared credentials)

Outlook, Teams, OneDrive, and SharePoint all use `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`. Register one Azure AD app with the required Microsoft Graph permissions.

### API-Key Integrations (no OAuth setup needed)

These integrations use API keys set by the developer in their project environment variables — no Veryfront OAuth app needed:

| Integration | Required Variables |
|-------------|-------------------|
| Anthropic | `ANTHROPIC_API_KEY` |
| AWS | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| Mixpanel | `MIXPANEL_PROJECT_TOKEN`, `MIXPANEL_API_SECRET`, `MIXPANEL_PROJECT_ID` |
| Neon | `NEON_API_KEY`, `DATABASE_URL` |
| PostHog | `POSTHOG_API_KEY` |
| Sentry | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` |
| Snowflake | `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USERNAME`, `SNOWFLAKE_PASSWORD`, `SNOWFLAKE_WAREHOUSE` |
| Stripe | `STRIPE_SECRET_KEY` |
| Supabase | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |

## Available Integrations

### Project Management (30 tools)
| Integration | Tools | Auth |
|-------------|-------|------|
| **Jira** | search-issues, get-issue, create-issue, update-issue, list-projects | OAuth |
| **Linear** | search-issues, get-issue, create-issue, update-issue, list-projects | OAuth |
| **Asana** | list-tasks, get-task, create-task, update-task, list-projects | OAuth |
| **ClickUp** | list-tasks, get-task, create-task, update-task, list-lists | OAuth |
| **Monday.com** | list-boards, list-items, get-item, create-item, update-item | OAuth (GraphQL) |
| **Trello** | list-boards, list-cards, get-card, create-card, update-card | OAuth |

### Code & DevOps (22 tools)
| Integration | Tools | Auth |
|-------------|-------|------|
| **GitHub** | list-repos, list-prs, create-issue, get-pr-diff | OAuth |
| **GitLab** | search-issues, get-issue, create-issue, list-merge-requests, list-projects | OAuth |
| **Bitbucket** | list-repositories, list-pull-requests, create-pull-request, list-issues | OAuth |
| **Sentry** | list-projects, list-issues, get-issue, resolve-issue | API Key |
| **AWS** | list-s3-buckets, list-s3-objects, get-s3-object, list-ec2-instances, list-lambda-functions | API Key |

### Communication (24 tools)
| Integration | Tools | Auth |
|-------------|-------|------|
| **Slack** | list-channels, send-message, get-messages | OAuth |
| **Discord** | list-guilds, list-channels, get-messages, send-message, get-user | OAuth |
| **Gmail** | list-emails, send-email, search-emails | OAuth |
| **Outlook** | list-emails, get-email, send-email, search-emails, list-folders | OAuth |
| **Teams** | list-chats, get-messages, send-message, list-teams, list-channels | OAuth |
| **Twilio** | send-sms, send-whatsapp, list-messages, get-message, list-calls | API Key |
| **Webex** | list-meetings, get-meeting, create-meeting, list-rooms, send-message | OAuth |

### Documents & Storage (34 tools)
| Integration | Tools | Auth |
|-------------|-------|------|
| **Notion** | search-notion, read-page, create-page, query-database | OAuth |
| **Google Docs** | list-documents, get-document, create-document, update-document, search-documents | OAuth |
| **Google Drive** | list-files, get-file, search-files, create-folder, upload-file | OAuth |
| **Google Sheets** | list-spreadsheets, get-spreadsheet, read-range, write-range, create-spreadsheet | OAuth |
| **Confluence** | search-content, get-page, create-page, update-page, list-spaces | OAuth |
| **Dropbox** | list-files, get-file, upload-file, search-files, get-account | OAuth |
| **Box** | list-files, get-file, search-files, create-folder, upload-file | OAuth |
| **OneDrive** | list-files, search-files, upload-file, download-file | OAuth |
| **SharePoint** | list-sites, get-site, list-files, get-file, upload-file | OAuth |

### CRM & Sales (20 tools)
| Integration | Tools | Auth |
|-------------|-------|------|
| **HubSpot** | list-contacts, get-contact, create-contact, list-deals, create-deal | OAuth |
| **Salesforce** | list-accounts, get-account, list-contacts, list-opportunities, create-lead | OAuth |
| **Pipedrive** | list-deals, get-deal, create-deal, update-deal, list-persons | OAuth |
| **Intercom** | list-contacts, get-contact, list-conversations, get-conversation, send-message | OAuth |

### Databases (15 tools)
| Integration | Tools | Auth |
|-------------|-------|------|
| **Supabase** | list-tables, query-table, insert-row, update-row, delete-row | API Key |
| **Neon** | list-projects, list-branches, query-database, list-tables, describe-table | API Key |
| **Snowflake** | run-query, list-databases, list-schemas, list-tables, describe-table | API Key |

### Design (5 tools)
| Integration | Tools | Auth |
|-------------|-------|------|
| **Figma** | list-files, get-file, get-comments, post-comment, list-projects | OAuth |

### Analytics (14 tools)
| Integration | Tools | Auth |
|-------------|-------|------|
| **Mixpanel** | track-event, query-events, get-funnel, get-retention, list-cohorts | API Key |
| **PostHog** | get-trends, list-feature-flags, list-persons, capture-event | API Key |
| **Anthropic** | list-workspaces, get-usage, list-api-keys, list-members, get-organization | API Key |

### Finance & Accounting (15 tools)
| Integration | Tools | Auth |
|-------------|-------|------|
| **Stripe** | list-customers, get-customer, list-payments, get-balance, list-subscriptions | API Key |
| **QuickBooks** | list-invoices, get-invoice, create-invoice, list-customers, get-customer | OAuth |
| **Xero** | list-invoices, get-invoice, create-invoice, list-contacts, get-contact | OAuth |

### Support (14 tools)
| Integration | Tools | Auth |
|-------------|-------|------|
| **Zendesk** | list-tickets, get-ticket, create-ticket, search-tickets | OAuth |
| **Freshdesk** | list-tickets, get-ticket, create-ticket, update-ticket, list-contacts | OAuth |
| **ServiceNow** | list-incidents, get-incident, create-incident, update-incident, search-knowledge | OAuth |

### Calendar & Meetings (13 tools)
| Integration | Tools | Auth |
|-------------|-------|------|
| **Google Calendar** | list-events, create-event, find-free-time | OAuth |
| **Zoom** | list-meetings, get-meeting, create-meeting, update-meeting, delete-meeting | OAuth |

### Marketing (5 tools)
| Integration | Tools | Auth |
|-------------|-------|------|
| **Mailchimp** | list-campaigns, get-campaign, list-lists, get-list, list-members | OAuth |

### E-Commerce (5 tools)
| Integration | Tools | Auth |
|-------------|-------|------|
| **Shopify** | list-products, get-product, list-orders, get-order, list-customers | OAuth |

### Social (6 tools)
| Integration | Tools | Auth |
|-------------|-------|------|
| **Twitter/X** | search-tweets, post-tweet, get-timeline | OAuth |
| **Airtable** | list-bases, get-base, list-records, get-record, create-record | OAuth |

---

**50 integrations** | **235 tools** | **40 OAuth + 10 API Key**
