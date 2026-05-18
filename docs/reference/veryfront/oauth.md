---
title: "veryfront/oauth"
description: "OAuth 2.0 with 37 pre-configured providers."
order: 19
---

# veryfront/oauth

OAuth 2.0 with 37 pre-configured providers.

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

| Name | Description | Source |
|------|-------------|--------|
| `createOAuthCallbackHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L41) |
| `createOAuthDisconnectHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L214) |
| `createOAuthInitHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L106) |
| `createOAuthStatusHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L170) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MemoryTokenStore` | In-memory TokenStore keyed by `(serviceId, userId)`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/token-store/memory.ts#L12) |
| `OAuthProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts#L45) |
| `OAuthService` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts#L292) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AuthorizationUrlOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L93) |
| `OAuthCallbackHandlerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L12) |
| `OAuthInitHandlerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L74) |
| `OAuthProviderConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L88) |
| `OAuthServiceConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L89) |
| `OAuthState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L91) |
| `OAuthTokens` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L90) |
| `TokenExchangeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L96) |
| `TokenExchangeResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L92) |
| `TokenStore` | TokenStore is keyed by `(serviceId, userId)` - tokens are per-user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L40) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `airtableConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L101) |
| `asanaConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L171) |
| `bitbucketConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L43) |
| `boxConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L286) |
| `calendarConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L32) |
| `clickupConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L325) |
| `confluenceConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L29) |
| `discordConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L65) |
| `driveConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L54) |
| `dropboxConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L119) |
| `figmaConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L53) |
| `freshdeskConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L220) |
| `githubConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L2) |
| `gitlabConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L89) |
| `gmailConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L17) |
| `hubspotConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L134) |
| `intercomConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L208) |
| `jiraConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L16) |
| `linearConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L77) |
| `mailchimpConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L232) |
| `mondayConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L183) |
| `notionConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L37) |
| `oneDriveConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L64) |
| `outlookConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L17) |
| `pipedriveConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L337) |
| `quickbooksConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L256) |
| `salesforceConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L146) |
| `sharePointConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L49) |
| `sheetsConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L43) |
| `shopifyConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L244) |
| `slackConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L14) |
| `teamsConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L33) |
| `trelloConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L310) |
| `twitterConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L158) |
| `webexConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L298) |
| `xeroConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L268) |
| `zoomConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L195) |

## Related

Reference modules:

- [`veryfront/middleware`](./middleware.md): Combine with middleware pipeline

User guides:

- [oauth](../../guides/oauth.md): OAuth flows and provider setup

Architecture:

- [18-oauth-runtime](../../architecture/18-oauth-runtime.md): OAuth runtime architecture
