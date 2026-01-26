/**
 * OAuth Module
 *
 * Reusable OAuth 2.0 infrastructure for Veryfront integrations.
 *
 * @example
 * ```typescript
 * // Create OAuth routes with pre-configured providers
 * import { createOAuthInitHandler, createOAuthCallbackHandler, gmailConfig } from "veryfront/oauth";
 *
 * // app/api/auth/gmail/route.ts
 * export const GET = createOAuthInitHandler(gmailConfig);
 *
 * // app/api/auth/gmail/callback/route.ts
 * export const GET = createOAuthCallbackHandler(gmailConfig);
 * ```
 *
 * @module oauth
 */
import "../../_dnt.polyfills.js";
export type { AuthorizationUrlOptions, OAuthProviderConfig, OAuthServiceConfig, OAuthState, OAuthTokens, TokenExchangeOptions, TokenExchangeResult, TokenStore, } from "./types.js";
export { OAuthProvider, OAuthService } from "./providers/base.js";
export { airtableConfig, asanaConfig, atlassianServices, bitbucketConfig, boxConfig, calendarConfig, clickupConfig, commonServices, confluenceConfig, discordConfig, driveConfig, dropboxConfig, figmaConfig, freshdeskConfig, githubConfig, gitlabConfig, gmailConfig, googleServices, hubspotConfig, intercomConfig, jiraConfig, linearConfig, mailchimpConfig, microsoftServices, mondayConfig, notionConfig, oneDriveConfig, outlookConfig, pipedriveConfig, quickbooksConfig, salesforceConfig, sharePointConfig, sheetsConfig, shopifyConfig, slackConfig, teamsConfig, trelloConfig, twitterConfig, webexConfig, xeroConfig, zoomConfig, } from "./providers/index.js";
export { MemoryTokenStore, memoryTokenStore } from "./token-store/index.js";
export { createOAuthCallbackHandler, createOAuthDisconnectHandler, createOAuthInitHandler, createOAuthStatusHandler, type OAuthCallbackHandlerOptions, type OAuthInitHandlerOptions, } from "./handlers/index.js";
//# sourceMappingURL=index.d.ts.map