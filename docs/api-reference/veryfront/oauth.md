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
| `AuthorizationUrlOptionsSchema` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L318) |
| `OAuthProviderConfigSchema`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L313) |
| `OAuthServiceConfigSchema`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L314) |
| `OAuthStateSchema`              |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L316) |
| `OAuthTokensSchema`             |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L315) |
| `TokenExchangeOptionsSchema`    |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L319) |
| `TokenExchangeResultSchema`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L317) |

### Functions

| Name                            | Description                                                                                                                              | Source                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `createOAuthCallbackDispatcher` | Create one callback handler shared by a fixed allowlist of logical services.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L403) |
| `createOAuthCallbackHandler`    | Create a callback handler for one logical OAuth service.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L363) |
| `createOAuthDisconnectHandler`  | Handler for create oauth disconnect.                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L338)     |
| `createOAuthInitHandler`        | Handler for create oauth init.                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L136)     |
| `createOAuthStatusHandler`      | Handler for create oauth status.                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L271)     |
| `isSupersededOAuthGrant`        | Whether a stored OAuth token carries a default broad grant that a current service narrowed. Explicit caller-requested grants stay valid. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/grant-policy.ts#L20)               |

### Classes

| Name               | Description                                          | Source                                                                                              |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `MemoryTokenStore` | In-memory TokenStore keyed by `(serviceId, userId)`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/token-store/memory.ts#L93) |
| `OAuthProvider`    | Implement oauth provider.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts#L422)    |
| `OAuthService`     | Implement oauth service.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts#L1036)   |

### Types

| Name                             | Description                                                                                                           | Source                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `AuthorizationUrlOptions`        | Options accepted by authorization URL.                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L306)     |
| `GetUserIdFn`                    | Signature for resolving the authenticated user's ID from a request.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L92)     |
| `MemoryTokenStoreOptions`        | Options for `MemoryTokenStore`.                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/token-store/memory.ts#L47)        |
| `OAuthCallbackDispatcherOptions` | Options accepted by a shared OAuth callback dispatcher.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L72) |
| `OAuthCallbackHandlerOptions`    | Options accepted by oauth callback handler.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L33) |
| `OAuthDisconnectHandlerOptions`  |                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L324)    |
| `OAuthInitHandlerOptions`        | Options accepted by oauth init handler.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L95)     |
| `OAuthProviderConfig`            | Configuration used by oauth provider.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L296)     |
| `OAuthScopeSource`               | Provenance of the scope set recorded for one OAuth authorization.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L16)                     |
| `OAuthServiceConfig`             | Configuration used by oauth service.                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L298)     |
| `OAuthState`                     | State for oauth.                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L302)     |
| `OAuthStatusHandlerOptions`      |                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L253)    |
| `OAuthTokens`                    | Public API contract for oauth tokens.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L300)     |
| `OAuthTokenSnapshot`             | Detached token row plus an opaque store revision.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L52)                     |
| `RefreshCapableTokenStore`       | Token store contract required for safe refresh across concurrent workers.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L135)                    |
| `StoredOAuthState`               | Persisted OAuth state row. Created when init handler starts a flow and consumed exactly once by the callback handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L25)                     |
| `TokenExchangeOptions`           | Options accepted by token exchange.                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L310)     |
| `TokenExchangeResult`            | Result returned from token exchange.                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L304)     |
| `TokenStore`                     | TokenStore is keyed by `(serviceId, userId)` - tokens are per-user.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L66)                     |

### Constants

| Name                               | Description                        | Source                                                                                                 |
| ---------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `airtableConfig`                   | Configuration used by airtable.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L120)     |
| `asanaConfig`                      | Configuration used by asana.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L186)     |
| `bitbucketConfig`                  | Configuration used by bitbucket.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L54)   |
| `boxConfig`                        | Configuration used by box.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L328)     |
| `calendarConfig`                   | Configuration used by calendar.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L37)      |
| `clickupConfig`                    | Configuration used by clickup.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L379)     |
| `confluenceConfig`                 | Configuration used by confluence.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L35)   |
| `docsGoogleConfig`                 | Configuration used by Google Docs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L77)      |
| `driveConfig`                      | Configuration used by drive.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L64)      |
| `figmaConfig`                      | Configuration used by figma.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L71)      |
| `freshdeskConfig`                  | Configuration used by freshdesk.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L250)     |
| `getAuthorizationUrlOptionsSchema` |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L261) |
| `getOAuthProviderConfigSchema`     |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L68)  |
| `getOAuthServiceConfigSchema`      |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L156) |
| `getOAuthStateSchema`              | State for CSRF protection and PKCE | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L205) |
| `getOAuthTokensSchema`             |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L177) |
| `getTokenExchangeOptionsSchema`    |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L283) |
| `getTokenExchangeResultSchema`     |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L220) |
| `githubConfig`                     | Configuration used by GitHub.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L5)       |
| `gitlabConfig`                     | Configuration used by gitlab.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L106)     |
| `gmailConfig`                      | Configuration used by gmail.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L20)      |
| `hubspotConfig`                    | Configuration used by hubspot.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L140)     |
| `intercomConfig`                   | Configuration used by intercom.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L235)     |
| `jiraConfig`                       | Configuration used by jira.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L20)   |
| `linearConfig`                     | Configuration used by linear.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L91)      |
| `mailchimpConfig`                  | Configuration used by mailchimp.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L264)     |
| `mondayConfig`                     | Configuration used by monday.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L200)     |
| `notionConfig`                     | Configuration used by notion.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L46)      |
| `oneDriveConfig`                   | Configuration used by one drive.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L71)   |
| `outlookConfig`                    | Configuration used by outlook.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L20)   |
| `pipedriveConfig`                  | Configuration used by pipedrive.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L394)     |
| `quickbooksConfig`                 | Configuration used by quickbooks.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L292)     |
| `salesforceConfig`                 | Configuration used by salesforce.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L157)     |
| `sharePointConfig`                 | Configuration used by share point. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L55)   |
| `sheetsConfig`                     | Configuration used by sheets.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L50)      |
| `shopifyConfig`                    | Configuration used by shopify.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L278)     |
| `slackConfig`                      | Configuration used by slack.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L19)      |
| `teamsConfig`                      | Configuration used by teams.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L38)   |
| `trelloConfig`                     | Configuration used by trello.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L362)     |
| `twitterConfig`                    | Configuration used by twitter.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L171)     |
| `webexConfig`                      | Configuration used by webex.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L343)     |
| `xeroConfig`                       | Configuration used by xero.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L307)     |
| `zoomConfig`                       | Configuration used by zoom.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L214)     |
