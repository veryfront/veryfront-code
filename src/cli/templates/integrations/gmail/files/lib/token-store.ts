/**
 * Gmail Token Store
 *
 * Re-exports the shared memory token store from veryfront/oauth.
 * Replace with a custom implementation for production (database, KV, etc.)
 */

export { memoryTokenStore as tokenStore, type OAuthTokens, type TokenStore } from "veryfront/oauth";
