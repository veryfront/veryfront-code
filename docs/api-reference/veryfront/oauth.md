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

| Name                            | Description | Source                                                                                            |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `AuthorizationUrlOptionsSchema` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts) |
| `OAuthProviderConfigSchema`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts) |
| `OAuthServiceConfigSchema`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts) |
| `OAuthStateSchema`              |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts) |
| `OAuthTokensSchema`             |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts) |
| `TokenExchangeOptionsSchema`    |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts) |
| `TokenExchangeResultSchema`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts) |

### Functions

| Name                            | Description                                                                                                                                                                                                    | Source                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `createOAuthCallbackDispatcher` | Create one callback handler shared by a fixed allowlist of logical services.                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts) |
| `createOAuthCallbackHandler`    | Create a callback handler for one logical OAuth service.                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts) |
| `createOAuthDisconnectHandler`  | Handler for create oauth disconnect.                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts)     |
| `createOAuthInitHandler`        | Handler for create oauth init.                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts)     |
| `createOAuthStatusHandler`      | Handler for create oauth status.                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts)     |
| `isSupersededOAuthGrant`        | Whether a stored OAuth token carries a broad built-in grant that the active config no longer requests. Explicit grants remain valid only when the exact broad scope appears in the persisted request snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/grant-policy.ts)              |

### Classes

| Name               | Description                                          | Source                                                                                          |
| ------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `MemoryTokenStore` | In-memory TokenStore keyed by `(serviceId, userId)`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/token-store/memory.ts) |
| `OAuthProvider`    | Implement oauth provider.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts)     |
| `OAuthService`     | Implement oauth service.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts)     |

### Types

| Name                             | Description                                                                                                           | Source                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `AuthorizationUrlOptions`        | Options accepted by authorization URL.                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts)      |
| `GetUserIdFn`                    | Signature for resolving the authenticated user's ID from a request.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts)     |
| `MemoryTokenStoreOptions`        | Options for `MemoryTokenStore`.                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/token-store/memory.ts)        |
| `OAuthCallbackDispatcherOptions` | Options accepted by a shared OAuth callback dispatcher.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts) |
| `OAuthCallbackHandlerOptions`    | Options accepted by oauth callback handler.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts) |
| `OAuthDisconnectHandlerOptions`  |                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts)     |
| `OAuthInitHandlerOptions`        | Options accepted by oauth init handler.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts)     |
| `OAuthProviderConfig`            | Configuration used by oauth provider.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts)      |
| `OAuthScopeSource`               | Provenance of the scope set recorded for one OAuth authorization.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts)                     |
| `OAuthServiceConfig`             | Configuration used by oauth service.                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts)      |
| `OAuthState`                     | State for oauth.                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts)      |
| `OAuthStatusHandlerOptions`      |                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts)     |
| `OAuthTokens`                    | Public API contract for oauth tokens.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts)      |
| `OAuthTokenSnapshot`             | Detached token row plus an opaque store revision.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts)                     |
| `RefreshCapableTokenStore`       | Token store contract required for safe refresh across concurrent workers.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts)                     |
| `StoredOAuthState`               | Persisted OAuth state row. Created when init handler starts a flow and consumed exactly once by the callback handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts)                     |
| `TokenExchangeOptions`           | Options accepted by token exchange.                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts)      |
| `TokenExchangeResult`            | Result returned from token exchange.                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts)      |
| `TokenStore`                     | TokenStore is keyed by `(serviceId, userId)` - tokens are per-user.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts)                     |

### Constants

| Name                               | Description                        | Source                                                                                            |
| ---------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `airtableConfig`                   | Configuration used by airtable.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `asanaConfig`                      | Configuration used by asana.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `bitbucketConfig`                  | Configuration used by bitbucket.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts)  |
| `boxConfig`                        | Configuration used by box.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `calendarConfig`                   | Configuration used by calendar.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts)     |
| `clickupConfig`                    | Configuration used by clickup.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `confluenceConfig`                 | Configuration used by confluence.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts)  |
| `docsGoogleConfig`                 | Configuration used by Google Docs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts)     |
| `driveConfig`                      | Configuration used by drive.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts)     |
| `figmaConfig`                      | Configuration used by figma.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `freshdeskConfig`                  | Configuration used by freshdesk.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `getAuthorizationUrlOptionsSchema` |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts) |
| `getOAuthProviderConfigSchema`     |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts) |
| `getOAuthServiceConfigSchema`      |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts) |
| `getOAuthStateSchema`              | State for CSRF protection and PKCE | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts) |
| `getOAuthTokensSchema`             |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts) |
| `getTokenExchangeOptionsSchema`    |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts) |
| `getTokenExchangeResultSchema`     |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts) |
| `githubConfig`                     | Configuration used by GitHub.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `gitlabConfig`                     | Configuration used by gitlab.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `gmailConfig`                      | Configuration used by gmail.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts)     |
| `hubspotConfig`                    | Configuration used by hubspot.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `intercomConfig`                   | Configuration used by intercom.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `jiraConfig`                       | Configuration used by jira.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts)  |
| `linearConfig`                     | Configuration used by linear.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `mailchimpConfig`                  | Configuration used by mailchimp.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `mondayConfig`                     | Configuration used by monday.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `notionConfig`                     | Configuration used by notion.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `oneDriveConfig`                   | Configuration used by one drive.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts)  |
| `outlookConfig`                    | Configuration used by outlook.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts)  |
| `pipedriveConfig`                  | Configuration used by pipedrive.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `quickbooksConfig`                 | Configuration used by quickbooks.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `salesforceConfig`                 | Configuration used by salesforce.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `sharePointConfig`                 | Configuration used by share point. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts)  |
| `sheetsConfig`                     | Configuration used by sheets.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts)     |
| `shopifyConfig`                    | Configuration used by shopify.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `slackConfig`                      | Configuration used by slack.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `teamsConfig`                      | Configuration used by teams.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts)  |
| `trelloConfig`                     | Configuration used by trello.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `twitterConfig`                    | Configuration used by twitter.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `webexConfig`                      | Configuration used by webex.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `xeroConfig`                       | Configuration used by xero.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
| `zoomConfig`                       | Configuration used by zoom.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts)     |
