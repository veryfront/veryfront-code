/**
 * OAuth Handlers
 *
 * @module oauth/handlers
 */

export {
  createOAuthCallbackDispatcher,
  createOAuthCallbackHandler,
  type OAuthCallbackDispatcherOptions,
  type OAuthCallbackHandlerOptions,
} from "./callback-handler.ts";

export {
  createOAuthDisconnectHandler,
  createOAuthInitHandler,
  createOAuthStatusHandler,
  type GetUserIdFn,
  type OAuthDisconnectHandlerOptions,
  type OAuthInitHandlerOptions,
  type OAuthStatusHandlerOptions,
} from "./init-handler.ts";
