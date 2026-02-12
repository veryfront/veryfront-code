---
title: "OAuth"
description: "OAuth 2.0 with 37 pre-configured providers."
order: 14
---

# OAuth

OAuth 2.0 with 37 pre-configured providers.

## Quick setup

Two routes handle the full OAuth flow — redirect to the provider and handle the callback:

```ts
// app/api/auth/github/route.ts
import { createOAuthInitHandler, githubConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(githubConfig);
```

```ts
// app/api/auth/github/callback/route.ts
import { createOAuthCallbackHandler, githubConfig } from "veryfront/oauth";

export const GET = createOAuthCallbackHandler(githubConfig);
```

Set your credentials via environment variables:

```
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

Link users to `/api/auth/github` to start the flow. After authorization, they're redirected back to your callback route with tokens.

## Available providers

Pre-configured providers include: GitHub, Google, Discord, Slack, Twitter/X, Facebook, LinkedIn, Microsoft, Apple, Spotify, Twitch, Notion, Figma, Linear, Jira, Confluence, Dropbox, Box, Zoom, HubSpot, Salesforce, Stripe, Shopify, GitLab, Bitbucket, and more.

Each provider exports a config object (e.g., `githubConfig`, `gmailConfig`, `discordConfig`).

## Token storage

By default, tokens are stored in memory (lost on restart). For production, implement a persistent store:

```ts
import { createOAuthCallbackHandler, githubConfig } from "veryfront/oauth";
import type { TokenStore, OAuthTokens, OAuthState } from "veryfront/oauth";

const redisTokenStore: TokenStore = {
  async getTokens(serviceId) {
    const data = await redis.get(`oauth:tokens:${serviceId}`);
    return data ? JSON.parse(data) : null;
  },
  async setTokens(serviceId, tokens) {
    await redis.set(`oauth:tokens:${serviceId}`, JSON.stringify(tokens));
  },
  async clearTokens(serviceId) {
    await redis.del(`oauth:tokens:${serviceId}`);
  },
  async getState(state) {
    const data = await redis.get(`oauth:state:${state}`);
    return data ? JSON.parse(data) : null;
  },
  async setState(state) {
    await redis.set(`oauth:state:${state.state}`, JSON.stringify(state));
  },
  async clearState(state) {
    await redis.del(`oauth:state:${state}`);
  },
};

export const GET = createOAuthCallbackHandler(githubConfig, {
  tokenStore: redisTokenStore,
});
```

## Status and disconnect

Check if a user is connected, or disconnect them:

```ts
// app/api/auth/github/status/route.ts
import { createOAuthStatusHandler, githubConfig } from "veryfront/oauth";
export const GET = createOAuthStatusHandler(githubConfig);

// app/api/auth/github/disconnect/route.ts
import { createOAuthDisconnectHandler, githubConfig } from "veryfront/oauth";
export const POST = createOAuthDisconnectHandler(githubConfig);
```

## Custom OAuth provider

For providers not included, create your own config:

```ts
import { createOAuthInitHandler, createOAuthCallbackHandler } from "veryfront/oauth";

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
export const GET = createOAuthInitHandler(myProvider);

// app/api/auth/my-provider/callback/route.ts
export const GET = createOAuthCallbackHandler(myProvider);
```

## Next

- [MCP Server](./mcp-server.md) — expose your tools over the Model Context Protocol
- [Configuration](./configuration.md) — environment variables and secrets

## Related

- [`veryfront/oauth`](../reference/oauth.md) — OAuth API reference
