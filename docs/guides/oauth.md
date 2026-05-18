---
title: "OAuth"
description: "OAuth 2.0 helpers with a built-in provider catalog."
order: 24
---

# OAuth

OAuth 2.0 helpers with a built-in provider catalog.

Route examples below use the default app router. Veryfront Code also supports mounting equivalent handlers under `pages/api/**` when `router: "pages"` is enabled.

## Quick setup

Two routes handle the full OAuth flow: redirect to the provider and handle the callback. Both handlers require a `getUserId` function that returns the authenticated user's id from your session; unauthenticated requests receive a 401.

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

Link users to `/api/auth/github` to start the flow. After authorization, they're redirected back to your callback route. Tokens are stored in that user's per-user slot: never in a single shared slot.

> **Security.** `getUserId` is required. The init handler rejects any request where it returns `null`, `undefined`, or an empty string. The user's id is bound into the OAuth state row and the callback stores tokens keyed by `(serviceId, userId)`, so one user cannot overwrite another user's tokens by completing an OAuth flow.

## Available providers

Pre-configured providers include: GitHub, Google, Discord, Slack, Twitter/X, Facebook, LinkedIn, Microsoft, Apple, Spotify, Twitch, Notion, Figma, Linear, Jira, Confluence, Dropbox, Box, Zoom, HubSpot, Salesforce, Stripe, Shopify, GitLab, Bitbucket, and more.

Each provider exports a config object (e.g., `githubConfig`, `gmailConfig`, `discordConfig`).

## Token storage

By default, tokens are stored in memory (lost on restart). For production, implement a persistent store. The `TokenStore` interface is keyed by `(serviceId, userId)` so each user's tokens live in their own slot, and OAuth state rows are consumed atomically (one-shot):

```ts
import { createOAuthCallbackHandler, githubConfig } from "veryfront/oauth";
import type { OAuthTokens, StoredOAuthState, TokenStore } from "veryfront/oauth";

const redisTokenStore: TokenStore = {
  async getTokens(serviceId, userId) {
    const data = await redis.get(`oauth:tokens:${serviceId}:${userId}`);
    return data ? (JSON.parse(data) as OAuthTokens) : null;
  },
  async setTokens(serviceId, userId, tokens) {
    await redis.set(`oauth:tokens:${serviceId}:${userId}`, JSON.stringify(tokens));
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

The callback handler reads the initiating user's id from the state row and calls `setTokens(serviceId, userId, tokens)`. If the state row is missing, expired, forged, or already consumed, the callback returns an error without storing anything.

## Status and disconnect

Check if a user is connected, or disconnect them. These handlers also require `getUserId` so they act on the caller's own tokens only:

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

OAuth service clients (e.g. `OAuthService.fetch`, `OAuthService.getAccessToken`) require the authenticated user's id so tokens are looked up from that user's slot:

```ts
import { gmailConfig, OAuthService } from "veryfront/oauth";
import { tokenStore } from "../../lib/token-store.ts";

const gmail = new OAuthService(gmailConfig, tokenStore);

// Pass the signed-in user's id: never a hardcoded constant.
const response = await gmail.fetch(session.userId, "/users/me/messages");
```

## Next

- [MCP server](./mcp-server.md): expose your tools over the Model Context Protocol
- [Configuration](./configuration.md): environment variables and secrets

## Related

- [`veryfront/oauth`](../reference/veryfront/oauth.md): OAuth API reference
