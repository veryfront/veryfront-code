---
title: "OAuth"
description: "OAuth 2.0 helpers with a built-in provider catalog."
order: 34
---

Connect users' provider accounts with OAuth 2.0 using `veryfront/oauth`. The
module does not authenticate users into your application; your application
session remains the source of user identity.

The module provides:

- pre-configured providers such as GitHub, Google, Slack, and Notion
- route helpers for init, callback, status, and disconnect
- per-user token storage through a required `getUserId` function

## Prerequisites

- An app session that lets you identify the signed-in user (`getSessionUserId`
  in the examples below).
- A token store backing `OAuthService` (Redis, KV, or your own implementation).
  The init and callback handlers must use the same store.
- Provider credentials (client id, client secret, callback URL) set as
  environment variables. See the matching provider config object in
  [`veryfront/oauth`](../api-reference/veryfront/oauth.md).

## Quick setup

Two routes handle the full OAuth flow: redirect to the provider and handle the
callback. The init handler requires a `getUserId` function that returns the
authenticated user's id from your session; unauthenticated requests receive a
401. The callback recovers that user id from the one-shot state row.

```ts
// app/api/auth/github/route.ts
import { createOAuthInitHandler, githubConfig } from "veryfront/oauth";
import { getSessionUserId } from "../../../../lib/auth.ts";
import { oauthTokenStore } from "../../../../lib/oauth-token-store.ts";

export const GET = createOAuthInitHandler(githubConfig, {
  tokenStore: oauthTokenStore,
  // Return the signed-in user's id, or null/undefined to reject the request.
  getUserId: (request) => getSessionUserId(request),
});
```

```ts
// app/api/auth/github/callback/route.ts
import { createOAuthCallbackHandler, githubConfig } from "veryfront/oauth";
import { oauthTokenStore } from "../../../../../lib/oauth-token-store.ts";

// The callback reads the initiating user id from the stored OAuth state row,
// so it does not need its own getUserId function.
export const GET = createOAuthCallbackHandler(githubConfig, {
  tokenStore: oauthTokenStore,
});
```

Set your credentials via environment variables:

```bash
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

Link users to `/api/auth/github` to start the flow. After authorization, they're
redirected back to your callback route. Tokens are stored in that user's
per-user slot: never in a single shared slot.

> **Security.** `getUserId` is required by the init, status, and disconnect
> handlers. The init handler rejects any request where it returns `null`,
> `undefined`, or an empty string. The user's id is bound into the OAuth state
> row and the callback stores tokens keyed by `(serviceId, userId)`, so one user
> cannot overwrite another user's tokens by completing an OAuth flow. The init
> handler uses PKCE with the S256 challenge method for providers that support it
> and refuses caller-supplied state values. Providers that cannot use PKCE must
> declare `pkceMode:
> "unsupported"`; do not disable PKCE ad hoc in route
> options.

## Choose a provider

Pre-configured provider exports are available for the supported default end-user
integrations: GitHub, Slack, Notion, Figma, Linear, GitLab, Airtable, Asana,
Gmail, Google Calendar (`calendarConfig`), Google Docs (`docsGoogleConfig`),
Sheets, Google Drive, Jira, Confluence, Outlook, Teams, SharePoint, and
OneDrive.

HubSpot's provider metadata is retained for source compatibility, but its
generated connector is blocked until a provider-specific production adapter and
operational template are available.

Some provider configs are retained for source compatibility but correspond to
feature-gated integrations. They are hidden from the default CLI/MCP/runtime
integration surface unless `VERYFRONT_EXPERIMENTAL_INTEGRATIONS` enables the
matching integration name (for example, `salesforce` for `salesforceConfig`) or
`all`.

Visibility does not imply that the generic OAuth runtime can implement every
provider protocol. Configs marked `runtimeSupport:
"provider-adapter-required"`
need OAuth 1.0, a tenant-derived host, a response-derived API origin, or another
provider-specific binding. Passing one to `OAuthService` fails immediately, and
the CLI refuses to emit its template, until a dedicated adapter implements that
contract. Do not replace this gate with a placeholder tenant or fixed API host.

Each provider exports a config object (e.g., `githubConfig`, `gmailConfig`). Use
the matching export from
[`veryfront/oauth`](../api-reference/veryfront/oauth.md) as the source of truth
for exact config names.

## API setup for OAuth credentials

For each OAuth provider, create an application and configure the callback URL:

```text
https://<app-origin>/api/auth/{service-id}/callback
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
[Integrations](./integrations.md) for connector setup and keep API-key variables
in your deployment environment.

## Token storage

The implicit memory store is available only in explicit development and test
environments. It is process-local and loses tokens on restart. Deployments must
inject the same persistent store into init, callback, status, and disconnect
handlers.

The base `TokenStore` interface is keyed by `(serviceId, userId)` so each user's
tokens live in their own slot, and OAuth state rows are consumed atomically
(one-shot). Use `RefreshCapableTokenStore` when access tokens may be refreshed:

```ts
import { createOAuthCallbackHandler, githubConfig } from "veryfront/oauth";
import {
  OAuthTokensSchema,
  type RefreshCapableTokenStore,
  type StoredOAuthState,
} from "veryfront/oauth";

const redisTokenStore: RefreshCapableTokenStore = {
  async getTokens(serviceId, userId) {
    return (await this.getTokenSnapshot(serviceId, userId))?.tokens ?? null;
  },
  async getTokenSnapshot(serviceId, userId) {
    const row = await readEncryptedTokenRow(redis, tokenKey(serviceId, userId));
    if (!row) return null;
    return {
      revision: requireValidRevision(row.revision),
      tokens: OAuthTokensSchema.parse(await decryptJson(row.ciphertext)),
    };
  },
  async setTokens(serviceId, userId, tokens) {
    await writeEncryptedTokenRow(redis, tokenKey(serviceId, userId), {
      revision: crypto.randomUUID(),
      ciphertext: await encryptJson(tokens),
    });
  },
  async compareAndSetTokens(serviceId, userId, expectedRevision, tokens) {
    // One Redis-side script compares the non-secret opaque revision field and
    // swaps both it and the ciphertext. Do not GET and then SET.
    return compareAndSwapEncryptedTokenRow(redis, tokenKey(serviceId, userId), {
      expectedRevision,
      replacement: {
        revision: crypto.randomUUID(),
        ciphertext: await encryptJson(tokens),
      },
    });
  },
  async withTokenRefreshLock(serviceId, userId, operation) {
    // The lease helper must use a unique owner value, compare-owner release,
    // renew while operation is running, and fail when ownership is lost.
    return withRenewableRedisLease(
      redis,
      `${tokenKey(serviceId, userId)}:refresh`,
      operation,
    );
  },
  async clearTokens(serviceId, userId) {
    await redis.del(tokenKey(serviceId, userId));
  },
  async setState(state, meta) {
    const stored = await redis.set(
      `oauth:state:${state}`,
      await encryptJson(meta),
      "EX",
      600,
      "NX",
    );
    if (stored !== "OK") throw new Error("OAuth state collision");
  },
  async consumeState(state) {
    // Atomic read + delete: the state row must be usable exactly once.
    const key = `oauth:state:${state}`;
    const data = await redis.getDel(key);
    if (!data) return null;
    return await decryptJson(data) as StoredOAuthState;
  },
};

function tokenKey(serviceId: string, userId: string): string {
  return `oauth:tokens:${encodeURIComponent(serviceId)}:${
    encodeURIComponent(userId)
  }`;
}

export const GET = createOAuthCallbackHandler(githubConfig, {
  tokenStore: redisTokenStore,
});
```

The encrypted-row, compare-and-swap, revision-validation, and renewable-lease
helpers above are application/infrastructure primitives rather than Veryfront
APIs. Back them with an authenticated encryption key held in a secret manager or
KMS, use TLS with certificate verification for Redis, rotate keys without losing
old-key reads, and never log plaintext rows. Store the opaque revision and
ciphertext as separate fields in one Redis hash; the compare-and-swap Lua script
compares the revision and replaces both fields atomically, without decrypting or
exposing tokens.

`GETDEL` requires Redis 6.2 or newer. On older Redis versions, implement
`consumeState` with one Lua script that reads and deletes the key atomically;
separate `GET` and `DEL` commands are not one-shot under concurrency. Likewise,
an ordinary process-local mutex is not a valid refresh lock for a store shared
by multiple instances.

The callback handler reads the initiating user's id from the state row and calls
`setTokens(serviceId, userId, tokens)`. It validates the state timestamp,
service id, exact callback URI, and PKCE verifier after consuming the row. If
the row is missing, expired, forged, mismatched, or already consumed, the
callback redirects with an error without exchanging the code or storing tokens.

Use the same persistent `TokenStore` instance or backing keyspace for the init
and callback routes. The built-in memory store is process-local and intended
only for development and tests.

If a store implements only the base `TokenStore`, automatic refresh fails
closed. An expired access token with a refresh token is reported as disconnected
until the store also provides revisioned snapshots, atomic compare-and-set, and
the distributed refresh lease.

## Status and disconnect

Check if a user is connected, or disconnect them. These handlers also require
`getUserId` so they act on the caller's own tokens only:

```ts
// app/api/auth/github/status/route.ts
import { createOAuthStatusHandler, githubConfig } from "veryfront/oauth";
import { getSessionUserId } from "../../../../../lib/auth.ts";
import { oauthTokenStore } from "../../../../../lib/oauth-token-store.ts";
export const GET = createOAuthStatusHandler(githubConfig, {
  tokenStore: oauthTokenStore,
  getUserId: (request) => getSessionUserId(request),
});

// app/api/auth/github/disconnect/route.ts
import { createOAuthDisconnectHandler, githubConfig } from "veryfront/oauth";
import { getSessionUserId } from "../../../../../lib/auth.ts";
import { oauthTokenStore } from "../../../../../lib/oauth-token-store.ts";
export const POST = createOAuthDisconnectHandler(githubConfig, {
  tokenStore: oauthTokenStore,
  getUserId: (request) => getSessionUserId(request),
});
```

The disconnect handler accepts `POST` only and requires the request's `Origin`
to match the configured application origin (`baseUrl` or `APP_URL`). Browser
`fetch` supplies this header automatically; non-browser clients must send it
explicitly. Other methods return `405` without touching the token store.

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
  tokenStore: oauthTokenStore,
  getUserId: (request) => getSessionUserId(request),
});

// app/api/auth/my-provider/callback/route.ts
export const GET = createOAuthCallbackHandler(myProvider, {
  tokenStore: oauthTokenStore,
});
```

Success and error redirects must resolve to the same origin as the configured
application URL. This prevents the callback route from becoming an open
redirector.

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
