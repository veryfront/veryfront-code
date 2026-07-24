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
  createOAuthCallbackDispatcher,
  createOAuthDisconnectHandler,
} from "veryfront/oauth";
```

## Examples

```typescript
// Create OAuth routes with pre-configured providers
import { createOAuthInitHandler, createOAuthCallbackHandler, gmailConfig } from "veryfront/oauth";
import { tokenStore } from "./persistent-token-store.ts";

// app/api/auth/gmail/route.ts
export const GET = createOAuthInitHandler(gmailConfig, {
  tokenStore,
  getUserId: (request) => getSessionUserId(request),
});

// app/api/auth/gmail/callback/route.ts
export const GET = createOAuthCallbackHandler(gmailConfig, { tokenStore });
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `AuthorizationUrlOptionsSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L300) |
| `OAuthProviderConfigSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L295) |
| `OAuthServiceConfigSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L296) |
| `OAuthStateSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L298) |
| `OAuthTokensSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L297) |
| `TokenExchangeOptionsSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L301) |
| `TokenExchangeResultSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L299) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createOAuthCallbackDispatcher` | Create one callback handler shared by a fixed allowlist of logical services. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L345) |
| `createOAuthCallbackHandler` | Create a callback handler for one logical OAuth service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L305) |
| `createOAuthDisconnectHandler` | Handler for create oauth disconnect. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L320) |
| `createOAuthInitHandler` | Handler for create oauth init. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L135) |
| `createOAuthStatusHandler` | Handler for create oauth status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L256) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MemoryTokenStore` | In-memory TokenStore keyed by `(serviceId, userId)`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/token-store/memory.ts#L91) |
| `OAuthProvider` | Implement oauth provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts#L297) |
| `OAuthService` | Implement oauth service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts#L809) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AuthorizationUrlOptions` | Options accepted by authorization URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L288) |
| `GetUserIdFn` | Signature for resolving the authenticated user's ID from a request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L91) |
| `MemoryTokenStoreOptions` | Options for `MemoryTokenStore`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/token-store/memory.ts#L45) |
| `OAuthCallbackDispatcherOptions` | Options accepted by a shared OAuth callback dispatcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L70) |
| `OAuthCallbackHandlerOptions` | Options accepted by oauth callback handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L31) |
| `OAuthDisconnectHandlerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L306) |
| `OAuthInitHandlerOptions` | Options accepted by oauth init handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L94) |
| `OAuthProviderConfig` | Configuration used by oauth provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L278) |
| `OAuthServiceConfig` | Configuration used by oauth service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L280) |
| `OAuthState` | State for oauth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L284) |
| `OAuthStatusHandlerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L238) |
| `OAuthTokens` | Public API contract for oauth tokens. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L282) |
| `OAuthTokenSnapshot` | Detached token row plus an opaque store revision. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L47) |
| `RefreshCapableTokenStore` | Token store contract required for safe refresh across concurrent workers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L115) |
| `StoredOAuthState` | Persisted OAuth state row. Created when init handler starts a flow and consumed exactly once by the callback handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L22) |
| `TokenExchangeOptions` | Options accepted by token exchange. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L292) |
| `TokenExchangeResult` | Result returned from token exchange. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L286) |
| `TokenStore` | TokenStore is keyed by `(serviceId, userId)` - tokens are per-user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L61) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `airtableConfig` | Configuration used by airtable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L120) |
| `asanaConfig` | Configuration used by asana. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L186) |
| `bitbucketConfig` | Configuration used by bitbucket. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L54) |
| `boxConfig` | Configuration used by box. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L328) |
| `calendarConfig` | Configuration used by calendar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L37) |
| `clickupConfig` | Configuration used by clickup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L379) |
| `confluenceConfig` | Configuration used by confluence. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L35) |
| `docsGoogleConfig` | Configuration used by Google Docs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L74) |
| `driveConfig` | Configuration used by drive. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L64) |
| `figmaConfig` | Configuration used by figma. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L71) |
| `freshdeskConfig` | Configuration used by freshdesk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L250) |
| `getAuthorizationUrlOptionsSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L243) |
| `getOAuthProviderConfigSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L52) |
| `getOAuthServiceConfigSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L140) |
| `getOAuthStateSchema` | State for CSRF protection and PKCE | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L188) |
| `getOAuthTokensSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L161) |
| `getTokenExchangeOptionsSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L265) |
| `getTokenExchangeResultSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L202) |
| `githubConfig` | Configuration used by github. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L5) |
| `gitlabConfig` | Configuration used by gitlab. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L106) |
| `gmailConfig` | Configuration used by gmail. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L20) |
| `hubspotConfig` | Configuration used by hubspot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L140) |
| `intercomConfig` | Configuration used by intercom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L235) |
| `jiraConfig` | Configuration used by jira. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L20) |
| `linearConfig` | Configuration used by linear. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L91) |
| `mailchimpConfig` | Configuration used by mailchimp. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L264) |
| `mondayConfig` | Configuration used by monday. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L200) |
| `notionConfig` | Configuration used by notion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L46) |
| `oneDriveConfig` | Configuration used by one drive. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L73) |
| `outlookConfig` | Configuration used by outlook. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L20) |
| `pipedriveConfig` | Configuration used by pipedrive. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L394) |
| `quickbooksConfig` | Configuration used by quickbooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L292) |
| `salesforceConfig` | Configuration used by salesforce. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L157) |
| `sharePointConfig` | Configuration used by share point. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L57) |
| `sheetsConfig` | Configuration used by sheets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L50) |
| `shopifyConfig` | Configuration used by shopify. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L278) |
| `slackConfig` | Configuration used by slack. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L19) |
| `teamsConfig` | Configuration used by teams. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L40) |
| `trelloConfig` | Configuration used by trello. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L362) |
| `twitterConfig` | Configuration used by twitter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L171) |
| `webexConfig` | Configuration used by webex. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L343) |
| `xeroConfig` | Configuration used by xero. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L307) |
| `zoomConfig` | Configuration used by zoom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L214) |
