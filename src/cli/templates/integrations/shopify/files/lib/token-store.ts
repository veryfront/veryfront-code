/**
 * Shopify Token Store
 */

export { memoryTokenStore as tokenStore, type OAuthTokens, type TokenStore } from "veryfront/oauth";

export async function getAccessToken(): Promise<string | null> {
  const { tokenStore } = await import("./token-store.ts");
  const tokens = await tokenStore.get("shopify");
  return tokens?.accessToken ?? null;
}
