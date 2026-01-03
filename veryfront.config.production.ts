/**
 * Veryfront Renderer Production Config
 *
 * Enables proxy mode for multi-project rendering.
 * Each request receives a project slug and OAuth token from the proxy.
 */
import type { VeryfrontConfig } from "./src/core/config/types.ts";

// Derive REST API base URL from GraphQL URL
// VERYFRONT_API_URL: http://veryfront-api.veryfront-production/graphql
// We need: http://veryfront-api.veryfront-production/api
function getApiBaseUrl(): string {
  const graphqlUrl = Deno.env.get("VERYFRONT_API_URL") || "";
  if (graphqlUrl.endsWith("/graphql")) {
    return graphqlUrl.replace("/graphql", "/api");
  }
  return Deno.env.get("VERYFRONT_API_BASE_URL") || "https://api.veryfront.com/api";
}

const config: VeryfrontConfig = {
  fs: {
    type: "veryfront-api",
    veryfront: {
      proxyMode: true,
      baseUrl: getApiBaseUrl(),
      // Token is provided per-request via x-token header from proxy
      // This fallback is used during initialization only
      apiToken: Deno.env.get("VERYFRONT_API_TOKEN") || "",
    },
  },
};

export default config;
