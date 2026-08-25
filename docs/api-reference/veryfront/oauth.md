---
title: "veryfront/oauth"
description: "OAuth 2.0 with pre-configured providers. Default supported integrations are visible in the CLI/MCP/runtime connector surface. Additional provider configs are retained for feature-gated integrations enabled with VERYFRONT_EXPERIMENTAL_INTEGRATIONS."
order: 22
---

## Import

```ts
import {
  createOAuthCallbackDispatcher,
  createOAuthCallbackHandler,
  createOAuthDisconnectHandler,
  createOAuthInitHandler,
  githubConfig,
  MemoryTokenStore,
} from "veryfront/oauth";
```

## Examples

```typescript
// Create OAuth routes with pre-configured providers
import { createOAuthCallbackHandler, createOAuthInitHandler, gmailConfig } from "veryfront/oauth";
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

| Name                            | Description | Source                                                                                                 |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `AuthorizationUrlOptionsSchema` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L315) |
| `OAuthProviderConfigSchema`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L310) |
| `OAuthServiceConfigSchema`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L311) |
| `OAuthStateSchema`              |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L313) |
| `OAuthTokensSchema`             |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L312) |
| `TokenExchangeOptionsSchema`    |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L316) |
| `TokenExchangeResultSchema`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L314) |

### Functions

| Name                            | Description                                                                  | Source                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `createOAuthCallbackDispatcher` | Create one callback handler shared by a fixed allowlist of logical services. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L400) |
| `createOAuthCallbackHandler`    | Create a callback handler for one logical OAuth service.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L360) |
| `createOAuthDisconnectHandler`  | Handler for create oauth disconnect.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L335)     |
| `createOAuthInitHandler`        | Handler for create oauth init.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L135)     |
| `createOAuthStatusHandler`      | Handler for create oauth status.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L269)     |

### Classes

| Name               | Description                                          | Source                                                                                              |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `MemoryTokenStore` | In-memory TokenStore keyed by `(serviceId, userId)`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/token-store/memory.ts#L92) |
| `OAuthProvider`    | Implement oauth provider.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts#L421)    |
| `OAuthService`     | Implement oauth service.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts#L1035)   |

### Types

| Name                             | Description                                                                                                           | Source                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `AuthorizationUrlOptions`        | Options accepted by authorization URL.                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L303)     |
| `GetUserIdFn`                    | Signature for resolving the authenticated user's ID from a request.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L91)     |
| `MemoryTokenStoreOptions`        | Options for `MemoryTokenStore`.                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/token-store/memory.ts#L46)        |
| `OAuthCallbackDispatcherOptions` | Options accepted by a shared OAuth callback dispatcher.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L71) |
| `OAuthCallbackHandlerOptions`    | Options accepted by oauth callback handler.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L32) |
| `OAuthDisconnectHandlerOptions`  |                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L321)    |
| `OAuthInitHandlerOptions`        | Options accepted by oauth init handler.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L94)     |
| `OAuthProviderConfig`            | Configuration used by oauth provider.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L293)     |
| `OAuthServiceConfig`             | Configuration used by oauth service.                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L295)     |
| `OAuthState`                     | State for oauth.                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L299)     |
| `OAuthStatusHandlerOptions`      |                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L251)    |
| `OAuthTokens`                    | Public API contract for oauth tokens.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L297)     |
| `OAuthTokenSnapshot`             | Detached token row plus an opaque store revision.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L46)                     |
| `RefreshCapableTokenStore`       | Token store contract required for safe refresh across concurrent workers.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L114)                    |
| `StoredOAuthState`               | Persisted OAuth state row. Created when init handler starts a flow and consumed exactly once by the callback handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L21)                     |
| `TokenExchangeOptions`           | Options accepted by token exchange.                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L307)     |
| `TokenExchangeResult`            | Result returned from token exchange.                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L301)     |
| `TokenStore`                     | TokenStore is keyed by `(serviceId, userId)` - tokens are per-user.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L60)                     |

### Constants

| Name                               | Description                        | Source                                                                                                 |
| ---------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `airtableConfig`                   | Configuration used by airtable.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L119)     |
| `asanaConfig`                      | Configuration used by asana.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L185)     |
| `bitbucketConfig`                  | Configuration used by bitbucket.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L53)   |
| `boxConfig`                        | Configuration used by box.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L327)     |
| `calendarConfig`                   | Configuration used by calendar.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L36)      |
| `clickupConfig`                    | Configuration used by clickup.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L378)     |
| `confluenceConfig`                 | Configuration used by confluence.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L34)   |
| `docsGoogleConfig`                 | Configuration used by Google Docs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L73)      |
| `driveConfig`                      | Configuration used by drive.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L63)      |
| `figmaConfig`                      | Configuration used by figma.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L70)      |
| `freshdeskConfig`                  | Configuration used by freshdesk.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L249)     |
| `getAuthorizationUrlOptionsSchema` |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L258) |
| `getOAuthProviderConfigSchema`     |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L67)  |
| `getOAuthServiceConfigSchema`      |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L155) |
| `getOAuthStateSchema`              | State for CSRF protection and PKCE | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L203) |
| `getOAuthTokensSchema`             |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L176) |
| `getTokenExchangeOptionsSchema`    |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L280) |
| `getTokenExchangeResultSchema`     |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L217) |
| `githubConfig`                     | Configuration used by GitHub.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L4)       |
| `gitlabConfig`                     | Configuration used by gitlab.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L105)     |
| `gmailConfig`                      | Configuration used by gmail.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L19)      |
| `hubspotConfig`                    | Configuration used by hubspot.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L139)     |
| `intercomConfig`                   | Configuration used by intercom.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L234)     |
| `jiraConfig`                       | Configuration used by jira.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L19)   |
| `linearConfig`                     | Configuration used by linear.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L90)      |
| `mailchimpConfig`                  | Configuration used by mailchimp.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L263)     |
| `mondayConfig`                     | Configuration used by monday.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L199)     |
| `notionConfig`                     | Configuration used by notion.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L45)      |
| `oneDriveConfig`                   | Configuration used by one drive.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L72)   |
| `outlookConfig`                    | Configuration used by outlook.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L19)   |
| `pipedriveConfig`                  | Configuration used by pipedrive.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L393)     |
| `quickbooksConfig`                 | Configuration used by quickbooks.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L291)     |
| `salesforceConfig`                 | Configuration used by salesforce.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L156)     |
| `sharePointConfig`                 | Configuration used by share point. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L56)   |
| `sheetsConfig`                     | Configuration used by sheets.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L49)      |
| `shopifyConfig`                    | Configuration used by shopify.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L277)     |
| `slackConfig`                      | Configuration used by slack.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L18)      |
| `teamsConfig`                      | Configuration used by teams.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L39)   |
| `trelloConfig`                     | Configuration used by trello.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L361)     |
| `twitterConfig`                    | Configuration used by twitter.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L170)     |
| `webexConfig`                      | Configuration used by webex.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L342)     |
| `xeroConfig`                       | Configuration used by xero.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L306)     |
| `zoomConfig`                       | Configuration used by zoom.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L213)     |
