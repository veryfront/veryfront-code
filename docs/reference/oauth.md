---
title: "veryfront/oauth"
description: "OAuth 2.0 with 37 pre-configured providers."
order: 16
---

## Import

```ts
import {
  createOAuthInitHandler,
  createOAuthCallbackHandler,
  githubConfig,
  MemoryTokenStore,
  createOAuthDisconnectHandler,
  createOAuthStatusHandler,
} from "veryfront/oauth";
```

## Examples

```typescript
// Create OAuth routes with pre-configured providers
import { createOAuthInitHandler, createOAuthCallbackHandler, gmailConfig } from "veryfront/oauth";

// app/api/auth/gmail/route.ts
export const GET = createOAuthInitHandler(gmailConfig);

// app/api/auth/gmail/callback/route.ts
export const GET = createOAuthCallbackHandler(gmailConfig);
```

## Exports

### Functions

| Name | Description |
|------|-------------|
| `createOAuthCallbackHandler` | Exchange auth code for tokens |
| `createOAuthDisconnectHandler` | Revoke and remove tokens |
| `createOAuthInitHandler` | Redirect user to OAuth provider |
| `createOAuthStatusHandler` | Check OAuth connection status |

### Classes

| Name | Description |
|------|-------------|
| `MemoryTokenStore` | In-memory token store (dev) |
| `OAuthProvider` | Base OAuth provider |
| `OAuthService` | Full OAuth flow manager |

### Types

| Name | Description |
|------|-------------|
| `AuthorizationUrlOptions` | Authorization URL options |
| `OAuthCallbackHandlerOptions` | `createOAuthCallbackHandler()` options |
| `OAuthInitHandlerOptions` | `createOAuthInitHandler()` options |
| `OAuthProviderConfig` | Provider config (client ID, scopes, URLs) |
| `OAuthServiceConfig` | OAuth service config |
| `OAuthState` | OAuth redirect state param |
| `OAuthTokens` | Access + refresh tokens |
| `TokenExchangeOptions` | Token exchange options |
| `TokenExchangeResult` | Token exchange result |
| `TokenStore` | Token storage interface |

### Constants

| Name | Description |
|------|-------------|
| `airtableConfig` | Airtable |
| `asanaConfig` | Asana |
| `bitbucketConfig` | Bitbucket |
| `boxConfig` | Box |
| `calendarConfig` | Google Calendar |
| `clickupConfig` | ClickUp |
| `confluenceConfig` | Confluence |
| `discordConfig` | Discord |
| `driveConfig` | Google Drive |
| `dropboxConfig` | Dropbox |
| `figmaConfig` | Figma |
| `freshdeskConfig` | Freshdesk |
| `githubConfig` | GitHub |
| `gitlabConfig` | GitLab |
| `gmailConfig` | Gmail |
| `hubspotConfig` | HubSpot |
| `intercomConfig` | Intercom |
| `jiraConfig` | Jira |
| `linearConfig` | Linear |
| `mailchimpConfig` | Mailchimp |
| `mondayConfig` | Monday.com |
| `notionConfig` | Notion |
| `oneDriveConfig` | OneDrive |
| `outlookConfig` | Outlook |
| `pipedriveConfig` | Pipedrive |
| `quickbooksConfig` | QuickBooks |
| `salesforceConfig` | Salesforce |
| `sharePointConfig` | SharePoint |
| `sheetsConfig` | Google Sheets |
| `shopifyConfig` | Shopify |
| `slackConfig` | Slack |
| `teamsConfig` | Microsoft Teams |
| `trelloConfig` | Trello |
| `twitterConfig` | Twitter/X |
| `webexConfig` | Webex |
| `xeroConfig` | Xero |
| `zoomConfig` | Zoom |

## Related

- [`veryfront/middleware`](./middleware.md) — Combine with middleware pipeline
