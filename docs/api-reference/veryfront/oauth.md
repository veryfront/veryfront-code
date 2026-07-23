---
title: "veryfront/oauth"
description: "OAuth 2.0 with pre-configured providers. Default supported integrations are visible in the CLI/MCP/runtime connector surface. Additional provider configs are retained for feature-gated integrations enabled with VERYFRONT_EXPERIMENTAL_INTEGRATIONS."
order: 19
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
import { createOAuthInitHandler, createOAuthCallbackHandler, gmailConfig } from "veryfront/oauth";
import { getSessionUserId } from "./auth.ts";

export const gmailOAuthInit = createOAuthInitHandler(gmailConfig, {
  getUserId: (request) => getSessionUserId(request),
});
export const gmailOAuthCallback = createOAuthCallbackHandler(gmailConfig);
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `AuthorizationUrlOptionsSchema` | Validates authorization URL options. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L280) |
| `OAuthProviderConfigSchema` | Validates OAuth provider configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L268) |
| `OAuthServiceConfigSchema` | Validates OAuth service configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L270) |
| `OAuthStateSchema` | Validates generated OAuth authorization state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L274) |
| `OAuthTokensSchema` | Validates persisted OAuth tokens. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L272) |
| `StoredOAuthStateSchema` | Validates a persisted OAuth state row. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L276) |
| `TokenExchangeOptionsSchema` | Validates authorization-code exchange options. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L282) |
| `TokenExchangeResultSchema` | Validates OAuth token-exchange results. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L278) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createOAuthCallbackHandler` | Create an OAuth callback handler that consumes one-time state, exchanges the authorization code, and stores tokens in the initiating user's slot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L86) |
| `createOAuthDisconnectHandler` | Create a handler that revokes provider credentials when supported, then clears the caller's local token slot. A failed provider revocation returns 502 and retains the local token so the request can be retried. The handler accepts `POST` requests only. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L270) |
| `createOAuthInitHandler` | Create a handler that authenticates the caller, persists one-time OAuth state, and redirects the caller to the provider authorization endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L135) |
| `createOAuthStatusHandler` | Create a no-store handler that reports the caller's OAuth connection status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L205) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MemoryTokenStore` | In-memory TokenStore keyed by `(serviceId, userId)`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/token-store/memory.ts#L146) |
| `OAuthProvider` | OAuth 2.0 authorization, code exchange, refresh, and revocation client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts#L391) |
| `OAuthService` | Per-user OAuth token manager and authenticated provider API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts#L864) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AuthorizationUrlOptions` | Options accepted by authorization URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L260) |
| `GetUserIdFn` | Signature for resolving the authenticated user's ID from a request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L94) |
| `MemoryTokenStoreOptions` | Options for {@link MemoryTokenStore}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/token-store/memory.ts#L119) |
| `OAuthCallbackHandlerOptions` | Options for {@link createOAuthCallbackHandler}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L50) |
| `OAuthDisconnectHandlerOptions` | Options for {@link createOAuthDisconnectHandler}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L253) |
| `OAuthFetchOptions` | Request options for {@link OAuthService.fetch}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts#L73) |
| `OAuthInitHandlerOptions` | Options for {@link createOAuthInitHandler}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L99) |
| `OAuthProviderConfig` | OAuth provider configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L250) |
| `OAuthServiceConfig` | OAuth service configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L252) |
| `OAuthState` | One-time OAuth authorization state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L256) |
| `OAuthStatusHandlerOptions` | Options for {@link createOAuthStatusHandler}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L190) |
| `OAuthTokens` | OAuth token persistence contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L254) |
| `StoredOAuthState` | Persisted OAuth state row. Created when init handler starts a flow and consumed exactly once by the callback handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L22) |
| `TokenExchangeOptions` | Options accepted by token exchange. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L264) |
| `TokenExchangeResult` | Result returned from token exchange. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L258) |
| `TokenStore` | TokenStore is keyed by `(serviceId, userId)`. Tokens are per-user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L41) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `airtableConfig` | Configuration used by airtable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L107) |
| `asanaConfig` | Configuration used by asana. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L169) |
| `bitbucketConfig` | Configuration used by bitbucket. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L52) |
| `boxConfig` | Configuration used by box. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L301) |
| `calendarConfig` | Configuration used by calendar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L36) |
| `clickupConfig` | Configuration used by clickup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L348) |
| `confluenceConfig` | Configuration used by confluence. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L34) |
| `driveConfig` | Configuration used by drive. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L61) |
| `figmaConfig` | Configuration used by figma. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L61) |
| `freshdeskConfig` | Configuration used by freshdesk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L228) |
| `githubConfig` | Configuration used by github. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L6) |
| `gitlabConfig` | Configuration used by gitlab. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L94) |
| `gmailConfig` | Configuration used by gmail. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L20) |
| `hubspotConfig` | Configuration used by hubspot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L126) |
| `intercomConfig` | Configuration used by intercom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L215) |
| `jiraConfig` | Configuration used by jira. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L20) |
| `linearConfig` | Configuration used by linear. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L80) |
| `mailchimpConfig` | Configuration used by mailchimp. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L241) |
| `mondayConfig` | Configuration used by monday. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L182) |
| `notionConfig` | Configuration used by notion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L43) |
| `oneDriveConfig` | Configuration used by one drive. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L69) |
| `outlookConfig` | Configuration used by outlook. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L20) |
| `pipedriveConfig` | Configuration used by pipedrive. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L361) |
| `quickbooksConfig` | Configuration used by quickbooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L267) |
| `salesforceConfig` | Configuration used by salesforce. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L142) |
| `sharePointConfig` | Configuration used by share point. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L54) |
| `sheetsConfig` | Configuration used by sheets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L48) |
| `shopifyConfig` | Configuration used by shopify. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L254) |
| `slackConfig` | Configuration used by slack. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L19) |
| `teamsConfig` | Configuration used by teams. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L38) |
| `trelloConfig` | Configuration used by trello. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L332) |
| `twitterConfig` | Configuration used by twitter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L155) |
| `webexConfig` | Configuration used by webex. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L314) |
| `xeroConfig` | Configuration used by xero. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L281) |
| `zoomConfig` | Configuration used by zoom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L195) |
