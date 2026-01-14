/**
 * CLI Authentication Module
 *
 * Provides OAuth and API token authentication for the Veryfront CLI.
 *
 * @module cli/auth
 */

export {
  login,
  logout,
  whoami,
  ensureAuthenticated,
  validateToken,
  readToken,
  saveToken,
  deleteToken,
  hasToken,
  type AuthMethod,
  type UserInfo,
} from "./login.ts";

export { startCallbackServer, getCallbackUrl, type CallbackServer } from "./callback-server.ts";
export { getTokenLocation } from "./token-store.ts";
export { openBrowser, canOpenBrowser } from "./browser.ts";
