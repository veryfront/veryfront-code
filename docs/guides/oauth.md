---
title: "OAuth"
description: "OAuth 2.0 helpers with a built-in provider catalog."
order: 34
---

Sign users in with OAuth 2.0 using `veryfront/oauth`.

The module provides:

- pre-configured providers such as GitHub, Google, Slack, and Notion
- route helpers for init, callback, status, and disconnect
- per-user token storage through a required `getUserId` function

## Prerequisites

- An app session that lets you identify the signed-in user (`getSessionUserId`
  in the examples below).
- A token store backing `OAuthService` (Redis, KV, or your own implementation).
- Provider credentials (client id, client secret, callback URL) set as
  environment variables. See the matching provider config object in
  [`veryfront/oauth`](../api-reference/veryfront/oauth.md).

## Quick setup

Two routes handle the full OAuth flow: redirect to the provider and handle the
callback. Both handlers require a `getUserId` function that returns the
authenticated user's id from your session; unauthenticated requests receive
a 401.

```ts
// app/api/auth/github/route.ts
import { createOAuthInitHandler, githubConfig } from "veryfront/oauth";
import { getSessionUserId } from "../../../../lib/auth.ts";

export const GET = createOAuthInitHandler(githubConfig, {
  // Return the signed-in user's id, or null/undefined to reject the request.
  getUserId: (request) => getSessionUserId(request),
});
```

```ts
// app/api/auth/github/callback/route.ts
import { createOAuthCallbackHandler, githubConfig } from "veryfront/oauth";

// The callback reads the initiating user id from the stored OAuth state row,
// so it does not need its own getUserId function.
export const GET = createOAuthCallbackHandler(githubConfig);
```

Set your credentials via environment variables:

```
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

Link users to `/api/auth/github` to start the flow. After authorization, they're
redirected back to your callback route. Tokens are stored in that user's
per-user slot: never in a single shared slot.

> **Security.** `getUserId` is required. The init handler rejects any request
> where it returns `null`, `undefined`, or an empty string. The user's id is
> bound into the OAuth state row and the callback stores tokens keyed by
> `(serviceId, userId)`, so one user cannot overwrite another user's tokens by
> completing an OAuth flow.

## Available providers

Pre-configured providers include: GitHub, Google, Discord, Slack, Twitter/X,
Facebook, LinkedIn, Microsoft, Apple, Spotify, Twitch, Notion, Figma, Linear,
Jira, Confluence, Dropbox, Box, Zoom, HubSpot, Salesforce, Stripe, Shopify,
GitLab, Bitbucket, and more.

Each provider exports a config object (e.g., `githubConfig`, `gmailConfig`,
`discordConfig`).

## API setup for OAuth credentials

If you are running your own API/service layer for integrations, register an
OAuth app for each provider you enable and configure the matching credentials
there.

### Provider registration

For each OAuth provider, create an application and configure the callback URL:

```
https://<api-host>/api/oauth/callback/{integration-name}
```

Then set the credentials as environment variables on the API:

| Provider                                         | Variable Prefix | Registration URL                                                  |
| ------------------------------------------------ | --------------- | ----------------------------------------------------------------- |
| GitHub                                           | `GITHUB_`       | https://github.com/settings/developers                            |
| Google (Gmail, Calendar, Docs, Drive, Sheets)    | `GOOGLE_`       | https://console.cloud.google.com/apis/credentials                 |
| Slack                                            | `SLACK_`        | https://api.slack.com/apps                                        |
| Microsoft (Outlook, Teams, OneDrive, SharePoint) | `MICROSOFT_`    | https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps      |
| Atlassian (Jira, Confluence)                     | `ATLASSIAN_`    | https://developer.atlassian.com/console/myapps/                   |
| Linear                                           | `LINEAR_`       | https://linear.app/settings/api                                   |
| Notion                                           | `NOTION_`       | https://www.notion.so/my-integrations                             |
| Figma                                            | `FIGMA_`        | https://www.figma.com/developers/apps                             |
| Discord                                          | `DISCORD_`      | https://discord.com/developers/applications                       |
| Dropbox                                          | `DROPBOX_`      | https://www.dropbox.com/developers/apps                           |
| Airtable                                         | `AIRTABLE_`     | https://airtable.com/create/oauth                                 |
| Asana                                            | `ASANA_`        | https://app.asana.com/0/developer-console                         |
| Bitbucket                                        | `BITBUCKET_`    | https://bitbucket.org/workspace/settings/oauth-consumers          |
| Box                                              | `BOX_`          | https://app.box.com/developers/console                            |
| ClickUp                                          | `CLICKUP_`      | https://app.clickup.com/settings/integrations                     |
| Freshdesk                                        | `FRESHDESK_`    | https://developers.freshdesk.com/                                 |
| GitLab                                           | `GITLAB_`       | https://gitlab.com/-/profile/applications                         |
| HubSpot                                          | `HUBSPOT_`      | https://app.hubspot.com/developer                                 |
| Intercom                                         | `INTERCOM_`     | https://app.intercom.com/a/apps/_/developer-hub                   |
| Mailchimp                                        | `MAILCHIMP_`    | https://admin.mailchimp.com/account/oauth2/                       |
| Monday.com                                       | `MONDAY_`       | https://monday.com/developers/apps                                |
| Pipedrive                                        | `PIPEDRIVE_`    | https://developers.pipedrive.com/docs/marketplace                 |
| QuickBooks                                       | `QUICKBOOKS_`   | https://developer.intuit.com/app/developer/dashboard              |
| Salesforce                                       | `SALESFORCE_`   | https://login.salesforce.com/lightning/setup/ConnectedApplication |
| ServiceNow                                       | `SERVICENOW_`   | Instance admin, Application Registry                              |
| Shopify                                          | `SHOPIFY_`      | https://partners.shopify.com/organizations                        |
| Trello                                           | `TRELLO_`       | https://trello.com/power-ups/admin                                |
| Twitter/X                                        | `TWITTER_`      | https://developer.twitter.com/en/portal/dashboard                 |
| Webex                                            | `WEBEX_`        | https://developer.webex.com/my-apps                               |
| Xero                                             | `XERO_`         | https://developer.xero.com/app/manage                             |
| Zendesk                                          | `ZENDESK_`      | https://zendesk.com/admin/apps-integrations                       |
| Zoom                                             | `ZOOM_`         | https://marketplace.zoom.us/develop                               |

Each provider needs two variables:

```bash
{PREFIX}CLIENT_ID=...
{PREFIX}CLIENT_SECRET=...
```

For example:

```bash
GITHUB_CLIENT_ID=<GITHUB_CLIENT_ID>
GITHUB_CLIENT_SECRET=<GITHUB_CLIENT_SECRET>
GOOGLE_CLIENT_ID=<GOOGLE_CLIENT_ID>
GOOGLE_CLIENT_SECRET=<GOOGLE_CLIENT_SECRET>
SLACK_CLIENT_ID=<SLACK_CLIENT_ID>
SLACK_CLIENT_SECRET=<SLACK_CLIENT_SECRET>
```

### Google APIs (shared credentials)

Google Calendar, Gmail, Docs, Drive, and Sheets all use the same
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Register one Google OAuth app and
enable all required APIs in the Cloud Console:

- [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)
- [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
- [Google Docs API](https://console.cloud.google.com/apis/library/docs.googleapis.com)
- [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
- [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)

### Microsoft APIs (shared credentials)

Outlook, Teams, OneDrive, and SharePoint all use `MICROSOFT_CLIENT_ID` /
`MICROSOFT_CLIENT_SECRET`. Register one Azure AD app with the required Microsoft
Graph permissions.

### API-key integrations

These integrations use API keys set by the developer in their project
environment variables. No OAuth app is needed:

| Integration | Required Variables                                                                     |
| ----------- | -------------------------------------------------------------------------------------- |
| Anthropic   | `ANTHROPIC_API_KEY`                                                                    |
| AWS         | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`                             |
| Mixpanel    | `MIXPANEL_PROJECT_TOKEN`, `MIXPANEL_API_SECRET`, `MIXPANEL_PROJECT_ID`                 |
| Neon        | `NEON_API_KEY`, `DATABASE_URL`                                                         |
| PostHog     | `POSTHOG_API_KEY`                                                                      |
| Sentry      | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`                                                      |
| Snowflake   | `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USERNAME`, `SNOWFLAKE_PASSWORD`, `SNOWFLAKE_WAREHOUSE` |
| Stripe      | `STRIPE_SECRET_KEY`                                                                    |
| Supabase    | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`                            |
| Twilio      | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`                       |

## Token storage

By default, tokens are stored in memory (lost on restart). For production,
implement a persistent store. The `TokenStore` interface is keyed by
`(serviceId, userId)` so each user's tokens live in their own slot, and OAuth
state rows are consumed atomically (one-shot):

```ts
import { createOAuthCallbackHandler, githubConfig } from "veryfront/oauth";
import type {
  OAuthTokens,
  StoredOAuthState,
  TokenStore,
} from "veryfront/oauth";

const redisTokenStore: TokenStore = {
  async getTokens(serviceId, userId) {
    const data = await redis.get(`oauth:tokens:${serviceId}:${userId}`);
    return data ? (JSON.parse(data) as OAuthTokens) : null;
  },
  async setTokens(serviceId, userId, tokens) {
    await redis.set(
      `oauth:tokens:${serviceId}:${userId}`,
      JSON.stringify(tokens),
    );
  },
  async clearTokens(serviceId, userId) {
    await redis.del(`oauth:tokens:${serviceId}:${userId}`);
  },
  async setState(state, meta) {
    // Set with a short TTL (e.g. 10 minutes) so abandoned flows don't pile up.
    await redis.set(`oauth:state:${state}`, JSON.stringify(meta), "EX", 600);
  },
  async consumeState(state) {
    // Atomic read + delete: the state row must be usable exactly once.
    const key = `oauth:state:${state}`;
    const data = await redis.get(key);
    if (!data) return null;
    await redis.del(key);
    return JSON.parse(data) as StoredOAuthState;
  },
};

export const GET = createOAuthCallbackHandler(githubConfig, {
  tokenStore: redisTokenStore,
});
```

The callback handler reads the initiating user's id from the state row and calls
`setTokens(serviceId, userId, tokens)`. If the state row is missing, expired,
forged, or already consumed, the callback returns an error without storing
anything.

## Status and disconnect

Check if a user is connected, or disconnect them. These handlers also require
`getUserId` so they act on the caller's own tokens only:

```ts
// app/api/auth/github/status/route.ts
import { createOAuthStatusHandler, githubConfig } from "veryfront/oauth";
import { getSessionUserId } from "../../../../../lib/auth.ts";
export const GET = createOAuthStatusHandler(githubConfig, {
  getUserId: (request) => getSessionUserId(request),
});

// app/api/auth/github/disconnect/route.ts
import { createOAuthDisconnectHandler, githubConfig } from "veryfront/oauth";
import { getSessionUserId } from "../../../../../lib/auth.ts";
export const POST = createOAuthDisconnectHandler(githubConfig, {
  getUserId: (request) => getSessionUserId(request),
});
```

## Custom OAuth provider

For providers not included, create your own config:

```ts
import {
  createOAuthCallbackHandler,
  createOAuthInitHandler,
} from "veryfront/oauth";

const myProvider = {
  providerId: "my-provider",
  serviceId: "my-provider",
  displayName: "My Provider",
  authorizationUrl: "https://provider.com/oauth/authorize",
  tokenUrl: "https://provider.com/oauth/token",
  clientIdEnvVar: "MY_PROVIDER_CLIENT_ID",
  clientSecretEnvVar: "MY_PROVIDER_CLIENT_SECRET",
  defaultScopes: ["read", "write"],
  apiBaseUrl: "https://api.provider.com",
};

// app/api/auth/my-provider/route.ts
export const GET = createOAuthInitHandler(myProvider, {
  getUserId: (request) => getSessionUserId(request),
});

// app/api/auth/my-provider/callback/route.ts
export const GET = createOAuthCallbackHandler(myProvider);
```

## Calling provider APIs on behalf of a user

OAuth service clients (e.g. `OAuthService.fetch`, `OAuthService.getAccessToken`)
require the authenticated user's id so tokens are looked up from that user's
slot:

```ts
import { gmailConfig, OAuthService } from "veryfront/oauth";
import { tokenStore } from "../../lib/token-store.ts";

const gmail = new OAuthService(gmailConfig, tokenStore);

// Pass the signed-in user's id: never a hardcoded constant.
const response = await gmail.fetch(session.userId, "/users/me/messages");
```

## Verify it worked

Sign in as a test user, then open the init route in a browser:

```
http://localhost:3000/api/auth/github
```

A working setup:

- Redirects to the provider's consent screen.
- Returns to your callback route with `?code=...` and `state=...`.
- Stores tokens for the signed-in user. Confirm via:

  ```ts
  const tokens = await tokenStore.getTokens(githubConfig.serviceId, userId);
  console.log(tokens.accessToken ? "ok" : "missing");
  ```

- Calling `gmail.fetch(userId, ...)` (or any provider service) returns the
  expected provider response without a `401`.
