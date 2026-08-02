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
- A shared token store backing every handler in the flow. Production stores
  that persist refresh tokens must implement `RefreshCapableTokenStore` using
  atomic compare-and-set and a distributed refresh lease.
- Provider credentials (client id, client secret, callback URL) set as
  environment variables. See the matching provider config object in
  [`veryfront/oauth`](../api-reference/veryfront/oauth.md).

## Quick setup

Two routes handle the full OAuth flow: redirect to the provider and handle the
callback. The init handler requires a `getUserId` function that returns the
authenticated user's id from your session; unauthenticated requests receive a
401. The callback recovers that identity from the one-shot state row.

```ts
// app/api/auth/github/route.ts
import { createOAuthInitHandler, githubConfig } from "veryfront/oauth";
import { getSessionUserId } from "../../../../lib/auth.ts";
import { tokenStore } from "../../../../lib/token-store.ts";

export const GET = createOAuthInitHandler(githubConfig, {
  // Return the signed-in user's id, or null/undefined to reject the request.
  getUserId: (request) => getSessionUserId(request),
  tokenStore,
});
```

```ts
// app/api/auth/github/callback/route.ts
import { createOAuthCallbackHandler, githubConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

// The callback reads the initiating user id from the stored OAuth state row,
// so it does not need its own getUserId function.
export const GET = createOAuthCallbackHandler(githubConfig, {
  tokenStore,
});
```

Set your credentials via environment variables:

```bash
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
APP_URL=https://your-app.example.com
```

Link users to `/api/auth/github` to start the flow. After authorization, they're
redirected back to your callback route. Tokens are stored in that user's
per-user slot: never in a single shared slot.

> **Security.** `getUserId` is required. The init handler rejects any request
> where it returns `null`, `undefined`, or an empty string. The user's id is
> bound into the OAuth state row and the callback stores tokens keyed by
> `(serviceId, userId)`, so one user cannot overwrite another user's tokens by
> completing an OAuth flow.

## Choose a provider

Pre-configured provider exports are available for the supported default
end-user integrations: GitHub, Slack, Notion, Figma, Linear, GitLab, Airtable,
Asana, Gmail, Google Calendar (`calendarConfig`), Sheets, Google Drive, Jira,
Confluence, Outlook, Teams, SharePoint, and OneDrive.

Some provider configs are retained for source compatibility but require a
provider-specific runtime adapter. Those configs cannot be passed to the
generic handlers. An integration becomes scaffoldable only after its adapter
implements the provider's complete wire protocol.

Each provider exports a config object (e.g., `githubConfig`, `gmailConfig`).
Use the matching export from
[`veryfront/oauth`](../api-reference/veryfront/oauth.md) as the source of truth
for exact config names.

## API setup for OAuth credentials

For each OAuth provider, create an application and configure the callback URL:

```text
https://<api-host>/api/oauth/callback/{integration-name}
```

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
environment variables. No OAuth app is needed. Use
[Integrations](./integrations.md) for connector setup and keep API-key
variables in your deployment environment.

## Token storage

The handlers use an in-memory store only in an explicit development or test
environment. Outside those environments, constructing a handler without a
store fails immediately. Use one shared store for init, callback, status,
disconnect, and provider API calls:

```ts
// lib/configure-oauth-storage.ts (import once during application startup)
import type { RefreshCapableTokenStore } from "veryfront/oauth";
import { createApplicationOAuthTokenStore } from "./storage/oauth.ts";
import { configureTokenStore } from "./token-store.ts";

const oauthStore: RefreshCapableTokenStore = createApplicationOAuthTokenStore();
configureTokenStore(oauthStore);
```

`createApplicationOAuthTokenStore` represents the factory exported by your
storage extension; it is not a core Veryfront dependency.

The application adapter must provide the complete contract:

- key tokens by `(serviceId, userId)` and issue a new opaque revision for every
  successful write;
- implement compare-and-set as one backing-store operation;
- serialize refresh for one token slot with a bounded, crash-recoverable,
  distributed lease;
- expire state rows after a short TTL and consume each row with one atomic
  read-and-delete operation.

Pass that store to each handler:

```ts
import { createOAuthCallbackHandler, githubConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(githubConfig, {
  tokenStore,
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
import { tokenStore } from "../../../../../lib/token-store.ts";
export const GET = createOAuthStatusHandler(githubConfig, {
  getUserId: (request) => getSessionUserId(request),
  tokenStore,
});

// app/api/auth/github/disconnect/route.ts
import { createOAuthDisconnectHandler, githubConfig } from "veryfront/oauth";
import { getSessionUserId } from "../../../../../lib/auth.ts";
import { tokenStore } from "../../../../../lib/token-store.ts";
export const POST = createOAuthDisconnectHandler(githubConfig, {
  getUserId: (request) => getSessionUserId(request),
  tokenStore,
});
```

## Custom OAuth provider

For providers not included, create your own config:

```ts
import { createOAuthCallbackHandler, createOAuthInitHandler } from "veryfront/oauth";
import { getSessionUserId } from "../../../../lib/auth.ts";
import { tokenStore } from "../../../../lib/token-store.ts";

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
  tokenStore,
});

// app/api/auth/my-provider/callback/route.ts
export const GET = createOAuthCallbackHandler(myProvider, {
  tokenStore,
});
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
  console.log(tokens?.accessToken ? "ok" : "missing");
  ```

- Calling `gmail.fetch(userId, ...)` (or any provider service) returns the
  expected provider response without a `401`.
