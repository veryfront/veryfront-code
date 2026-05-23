---
title: "veryfront/oauth"
description: "OAuth 2.0 with 37 pre-configured providers."
order: 20
---

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
| `createOAuthCallbackHandler` | Handler for create oauth callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L44) |
| `createOAuthDisconnectHandler` | Handler for create oauth disconnect. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L219) |
| `createOAuthInitHandler` | Handler for create oauth init. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L109) |
| `createOAuthStatusHandler` | Handler for create oauth status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L174) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MemoryTokenStore` | In-memory TokenStore keyed by `(serviceId, userId)`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/token-store/memory.ts#L13) |
| `OAuthProvider` | Implement oauth provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts#L47) |
| `OAuthService` | Implement oauth service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts#L295) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AuthorizationUrlOptions` | Options accepted by authorization URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L100) |
| `OAuthCallbackHandlerOptions` | Options accepted by oauth callback handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L14) |
| `OAuthInitHandlerOptions` | Options accepted by oauth init handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L76) |
| `OAuthProviderConfig` | Configuration used by oauth provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L90) |
| `OAuthServiceConfig` | Configuration used by oauth service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L92) |
| `OAuthState` | State for oauth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L96) |
| `OAuthTokens` | Public API contract for oauth tokens. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L94) |
| `TokenExchangeOptions` | Options accepted by token exchange. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L104) |
| `TokenExchangeResult` | Result returned from token exchange. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L98) |
| `TokenStore` | TokenStore is keyed by `(serviceId, userId)` - tokens are per-user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L41) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `airtableConfig` | Configuration used by airtable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L110) |
| `asanaConfig` | Configuration used by asana. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L185) |
| `bitbucketConfig` | Configuration used by bitbucket. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L47) |
| `boxConfig` | Configuration used by box. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L309) |
| `calendarConfig` | Configuration used by calendar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L35) |
| `clickupConfig` | Configuration used by clickup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L351) |
| `confluenceConfig` | Configuration used by confluence. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L32) |
| `discordConfig` | Configuration used by discord. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L71) |
| `driveConfig` | Configuration used by drive. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L59) |
| `dropboxConfig` | Configuration used by dropbox. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L129) |
| `figmaConfig` | Configuration used by figma. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L58) |
| `freshdeskConfig` | Configuration used by freshdesk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L238) |
| `githubConfig` | Configuration used by github. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L4) |
| `gitlabConfig` | Configuration used by gitlab. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L97) |
| `gmailConfig` | Configuration used by gmail. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L19) |
| `hubspotConfig` | Configuration used by hubspot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L145) |
| `intercomConfig` | Configuration used by intercom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L225) |
| `jiraConfig` | Configuration used by jira. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L18) |
| `linearConfig` | Configuration used by linear. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L84) |
| `mailchimpConfig` | Configuration used by mailchimp. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L251) |
| `mondayConfig` | Configuration used by monday. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L198) |
| `notionConfig` | Configuration used by notion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L41) |
| `oneDriveConfig` | Configuration used by one drive. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L69) |
| `outlookConfig` | Configuration used by outlook. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L19) |
| `pipedriveConfig` | Configuration used by pipedrive. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L364) |
| `quickbooksConfig` | Configuration used by quickbooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L277) |
| `salesforceConfig` | Configuration used by salesforce. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L158) |
| `sharePointConfig` | Configuration used by share point. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L53) |
| `sheetsConfig` | Configuration used by sheets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L47) |
| `shopifyConfig` | Configuration used by shopify. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L264) |
| `slackConfig` | Configuration used by slack. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L17) |
| `teamsConfig` | Configuration used by teams. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L36) |
| `trelloConfig` | Configuration used by trello. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L335) |
| `twitterConfig` | Configuration used by twitter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L171) |
| `webexConfig` | Configuration used by webex. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L322) |
| `xeroConfig` | Configuration used by xero. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L290) |
| `zoomConfig` | Configuration used by zoom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L211) |

## Related

Reference modules:

- [`veryfront/middleware`](./middleware.md): Combine with middleware pipeline

User guides:

- [oauth](../../guides/oauth.md): OAuth flows and provider setup
