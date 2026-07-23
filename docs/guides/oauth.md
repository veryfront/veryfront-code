---
title: "OAuth"
description: "OAuth 2.0 helpers with a built-in provider catalog."
order: 34
---

Connect a signed-in user to provider APIs with OAuth 2.0 using
`veryfront/oauth`. This module does not authenticate users or validate OpenID
Connect ID tokens. Use your application's session system for sign-in.

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

Two routes handle the OAuth flow: redirect to the provider and handle the
callback. The init handler requires a `getUserId` function that returns the
authenticated user's id from your session. The callback obtains that id from
the one-time state row created by the init handler.

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

```bash
GITHUB_CLIENT_ID=<CLIENT_ID>
GITHUB_CLIENT_SECRET=<CLIENT_SECRET>
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

Some provider configs are retained for source compatibility but correspond to
feature-gated integrations. They are hidden from the default CLI/MCP/runtime
integration surface unless `VERYFRONT_EXPERIMENTAL_INTEGRATIONS` enables the
matching integration name (for example, `salesforce` for `salesforceConfig`) or
`all`.

Each provider exports a config object (e.g., `githubConfig`, `gmailConfig`).
Use the matching export from
[`veryfront/oauth`](../api-reference/veryfront/oauth.md) as the source of truth
for exact config names.

## API setup for OAuth credentials

For each OAuth provider, create an application and configure its callback URL.
The service id is the `serviceId` field on the provider config:

```text
https://<APP_HOST>/api/auth/<SERVICE_ID>/callback
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

By default, tokens are stored in memory (lost on restart). For production,
implement a persistent store. The `TokenStore` interface is keyed by
`(serviceId, userId)` so each user's tokens live in their own slot, and OAuth
state rows are consumed atomically (one-shot):

```ts
import {
  createOAuthCallbackHandler,
  githubConfig,
  OAuthTokensSchema,
  StoredOAuthStateSchema,
} from "veryfront/oauth";
import type { TokenStore } from "veryfront/oauth";

const redisTokenStore: TokenStore = {
  async getTokens(serviceId, userId) {
    const data = await redis.get(tokenKey(serviceId, userId));
    if (!data) return null;
    const result = OAuthTokensSchema.safeParse(JSON.parse(data));
    return result.success ? result.data : null;
  },
  async setTokens(serviceId, userId, tokens) {
    await redis.set(
      tokenKey(serviceId, userId),
      JSON.stringify(tokens),
    );
  },
  async clearTokens(serviceId, userId) {
    await redis.del(tokenKey(serviceId, userId));
  },
  async setState(state, meta) {
    // Set with a short TTL (e.g. 10 minutes) so abandoned flows don't pile up.
    await redis.set(`oauth:state:${state}`, JSON.stringify(meta), "EX", 600);
  },
  async consumeState(state) {
    // Use Redis GETDEL or an equivalent transaction. Separate GET and DEL
    // calls allow two concurrent callbacks to consume the same state.
    const key = `oauth:state:${state}`;
    const data = await redis.getDel(key);
    if (!data) return null;
    const result = StoredOAuthStateSchema.safeParse(JSON.parse(data));
    return result.success ? result.data : null;
  },
};

function tokenKey(serviceId: string, userId: string): string {
  return `oauth:tokens:${encodeURIComponent(serviceId)}:${encodeURIComponent(userId)}`;
}

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

Mount disconnect handlers on a state-changing method such as `POST`. Apply the
same session and CSRF protections as other account-setting routes. If the
provider config has a revocation endpoint, the handler revokes the provider
token before deleting local state. A provider revocation failure returns `502`
and keeps the local token so the request can be retried.

## Custom OAuth provider

For providers not included, create your own config:

```ts
import { createOAuthCallbackHandler, createOAuthInitHandler } from "veryfront/oauth";

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
const response = await gmail.fetch(session.userId, "/users/me/messages", {
  maxResponseBytes: 4 * 1024 * 1024,
});
```

Provider requests time out after 30 seconds by default. Set
`VF_HTTP_FETCH_TIMEOUT` to a positive millisecond value of at most 300000 to
change that timeout. `OAuthService.fetch()` accepts JSON responses up to 16 MiB
by default, rejects cross-origin endpoint URLs, and does not follow redirects.

## Production checklist

- Set `APP_URL` to the exact public HTTPS origin and optional base path. Do not
  include credentials, a query, or a fragment.
- Inject the same durable `TokenStore` into the init, callback, status, and
  disconnect handlers. `MemoryTokenStore` is only for development and tests.
- Implement `consumeState()` as an atomic read-and-delete operation with a
  short expiry. State validation cannot be disabled.
- Keep PKCE enabled. The generated authorization URL uses `S256` by default.
- Keep success and error redirects on the application origin. Handler options
  reject cross-origin redirect targets.
- Encrypt provider tokens at rest and restrict access by both `serviceId` and
  authenticated `userId`.
- Treat `idToken` as unverified data. Do not use it for authentication or
  authorization without complete OpenID Connect validation.

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
