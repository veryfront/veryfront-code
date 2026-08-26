import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as handlerModule from "./handlers/index.ts";
import * as oauthModule from "./index.ts";
import * as providerModule from "./providers/index.ts";
import * as publicOAuthModule from "veryfront/oauth";
import * as tokenStoreModule from "./token-store/index.ts";

const expectedRuntimeExports = [
  "AuthorizationUrlOptionsSchema",
  "MemoryTokenStore",
  "OAuthProvider",
  "OAuthProviderConfigSchema",
  "OAuthService",
  "OAuthServiceConfigSchema",
  "OAuthStateSchema",
  "OAuthTokensSchema",
  "TokenExchangeOptionsSchema",
  "TokenExchangeResultSchema",
  "airtableConfig",
  "asanaConfig",
  "bitbucketConfig",
  "boxConfig",
  "calendarConfig",
  "clickupConfig",
  "confluenceConfig",
  "createOAuthCallbackDispatcher",
  "createOAuthCallbackHandler",
  "createOAuthDisconnectHandler",
  "createOAuthInitHandler",
  "createOAuthStatusHandler",
  "docsGoogleConfig",
  "driveConfig",
  "figmaConfig",
  "freshdeskConfig",
  "getAuthorizationUrlOptionsSchema",
  "getOAuthProviderConfigSchema",
  "getOAuthServiceConfigSchema",
  "getOAuthStateSchema",
  "getOAuthTokensSchema",
  "getTokenExchangeOptionsSchema",
  "getTokenExchangeResultSchema",
  "githubConfig",
  "gitlabConfig",
  "gmailConfig",
  "hubspotConfig",
  "intercomConfig",
  "isSupersededOAuthGrant",
  "jiraConfig",
  "linearConfig",
  "mailchimpConfig",
  "mondayConfig",
  "notionConfig",
  "oneDriveConfig",
  "outlookConfig",
  "pipedriveConfig",
  "quickbooksConfig",
  "salesforceConfig",
  "sharePointConfig",
  "sheetsConfig",
  "shopifyConfig",
  "slackConfig",
  "teamsConfig",
  "trelloConfig",
  "twitterConfig",
  "webexConfig",
  "xeroConfig",
  "zoomConfig",
].sort();

describe("oauth/index.ts exports", () => {
  it("preserves the exact runtime surface for veryfront/oauth", () => {
    assertEquals(Object.keys(oauthModule).sort(), expectedRuntimeExports);
    assertEquals(Object.keys(publicOAuthModule).sort(), expectedRuntimeExports);
  });

  it("keeps representative public exports wired to their owning modules", () => {
    assertStrictEquals(oauthModule.githubConfig, providerModule.githubConfig);
    assertStrictEquals(oauthModule.slackConfig, providerModule.slackConfig);
    assertStrictEquals(oauthModule.MemoryTokenStore, tokenStoreModule.MemoryTokenStore);
    assertStrictEquals(
      oauthModule.createOAuthCallbackDispatcher,
      handlerModule.createOAuthCallbackDispatcher,
    );
    assertStrictEquals(
      publicOAuthModule.createOAuthInitHandler,
      oauthModule.createOAuthInitHandler,
    );
    assertStrictEquals(publicOAuthModule.OAuthService, oauthModule.OAuthService);
  });
});
