---
title: "veryfront/oauth"
description: "OAuth 2.0 with 36 pre-configured providers."
order: 17
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
| `createOAuthCallbackHandler` | Handler for create oauth callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L43) |
| `createOAuthDisconnectHandler` | Handler for create oauth disconnect. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L218) |
| `createOAuthInitHandler` | Handler for create oauth init. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L108) |
| `createOAuthStatusHandler` | Handler for create oauth status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L173) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MemoryTokenStore` | In-memory TokenStore keyed by `(serviceId, userId)`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/token-store/memory.ts#L12) |
| `OAuthProvider` | Implement oauth provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts#L46) |
| `OAuthService` | Implement oauth service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/base.ts#L294) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AuthorizationUrlOptions` | Options accepted by authorization URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L99) |
| `OAuthCallbackHandlerOptions` | Options accepted by oauth callback handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/callback-handler.ts#L13) |
| `OAuthInitHandlerOptions` | Options accepted by oauth init handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/handlers/init-handler.ts#L75) |
| `OAuthProviderConfig` | Configuration used by oauth provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L89) |
| `OAuthServiceConfig` | Configuration used by oauth service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L91) |
| `OAuthState` | State for oauth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L95) |
| `OAuthTokens` | Public API contract for oauth tokens. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L93) |
| `TokenExchangeOptions` | Options accepted by token exchange. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L103) |
| `TokenExchangeResult` | Result returned from token exchange. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/schemas/oauth.schema.ts#L97) |
| `TokenStore` | TokenStore is keyed by `(serviceId, userId)` - tokens are per-user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/types.ts#L40) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `airtableConfig` | Configuration used by airtable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L96) |
| `asanaConfig` | Configuration used by asana. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L155) |
| `bitbucketConfig` | Configuration used by bitbucket. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L46) |
| `boxConfig` | Configuration used by box. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L279) |
| `calendarConfig` | Configuration used by calendar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L34) |
| `clickupConfig` | Configuration used by clickup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L321) |
| `confluenceConfig` | Configuration used by confluence. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L31) |
| `driveConfig` | Configuration used by drive. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L58) |
| `figmaConfig` | Configuration used by figma. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L57) |
| `freshdeskConfig` | Configuration used by freshdesk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L208) |
| `githubConfig` | Configuration used by github. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L3) |
| `gitlabConfig` | Configuration used by gitlab. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L83) |
| `gmailConfig` | Configuration used by gmail. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L18) |
| `hubspotConfig` | Configuration used by hubspot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L115) |
| `intercomConfig` | Configuration used by intercom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L195) |
| `jiraConfig` | Configuration used by jira. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/atlassian.ts#L17) |
| `linearConfig` | Configuration used by linear. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L70) |
| `mailchimpConfig` | Configuration used by mailchimp. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L221) |
| `mondayConfig` | Configuration used by monday. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L168) |
| `notionConfig` | Configuration used by notion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L40) |
| `oneDriveConfig` | Configuration used by one drive. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L68) |
| `outlookConfig` | Configuration used by outlook. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L18) |
| `pipedriveConfig` | Configuration used by pipedrive. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L334) |
| `quickbooksConfig` | Configuration used by quickbooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L247) |
| `salesforceConfig` | Configuration used by salesforce. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L128) |
| `sharePointConfig` | Configuration used by share point. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L52) |
| `sheetsConfig` | Configuration used by sheets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/google.ts#L46) |
| `shopifyConfig` | Configuration used by shopify. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L234) |
| `slackConfig` | Configuration used by slack. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L16) |
| `teamsConfig` | Configuration used by teams. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/microsoft.ts#L35) |
| `trelloConfig` | Configuration used by trello. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L305) |
| `twitterConfig` | Configuration used by twitter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L141) |
| `webexConfig` | Configuration used by webex. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L292) |
| `xeroConfig` | Configuration used by xero. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L260) |
| `zoomConfig` | Configuration used by zoom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/oauth/providers/common.ts#L181) |
