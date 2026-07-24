import { confluenceConfig, jiraConfig } from "veryfront/oauth";
import type { IntegrationName, TemplateFile } from "./types.ts";

export const ATLASSIAN_OAUTH_CALLBACK_PATH = "app/api/auth/atlassian/callback/route.ts";

const ATLASSIAN_PRODUCT_CALLBACK_PATHS = [
  "app/api/auth/jira/callback/route.ts",
  "app/api/auth/confluence/callback/route.ts",
] as const;

export function isAtlassianProductCallbackPath(path: string): boolean {
  return ATLASSIAN_PRODUCT_CALLBACK_PATHS.some((candidate) => candidate === path);
}

const ATLASSIAN_PRODUCTS = [
  {
    name: "jira",
    configExport: "jiraConfig",
    scopes: [...jiraConfig.defaultScopes],
  },
  {
    name: "confluence",
    configExport: "confluenceConfig",
    scopes: [...confluenceConfig.defaultScopes],
  },
] as const satisfies ReadonlyArray<{
  name: IntegrationName;
  configExport: string;
  scopes: readonly string[];
}>;

type AtlassianProduct = (typeof ATLASSIAN_PRODUCTS)[number];

function getSelectedProducts(
  integrationNames: readonly IntegrationName[],
): AtlassianProduct[] {
  const selectedNames = new Set(integrationNames);
  return ATLASSIAN_PRODUCTS.filter((product) => selectedNames.has(product.name));
}

export function getAtlassianOAuthScopes(
  integrationNames: readonly IntegrationName[],
): string[] {
  return [
    ...new Set(
      getSelectedProducts(integrationNames).flatMap((product) => product.scopes),
    ),
  ];
}

export function getUnselectedAtlassianOAuthScopes(
  integrationNames: readonly IntegrationName[],
): string[] {
  const selectedProducts = getSelectedProducts(integrationNames);
  if (selectedProducts.length === 0) return [];

  const selectedNames = new Set(selectedProducts.map((product) => product.name));
  const selectedScopes = new Set(selectedProducts.flatMap((product) => product.scopes));
  return [
    ...new Set(
      ATLASSIAN_PRODUCTS
        .filter((product) => !selectedNames.has(product.name))
        .flatMap((product) => product.scopes)
        .filter((scope) => !selectedScopes.has(scope)),
    ),
  ];
}

function renderConfigModule(
  products: readonly AtlassianProduct[],
  scopes: readonly string[],
  forbiddenScopes: readonly string[],
): string {
  const configExports = products.map((product) => product.configExport);
  const importExports = [...configExports].sort();

  return `import { ${importExports.join(", ")} } from "veryfront/oauth";

export const atlassianOAuthCallbackRouteId = "atlassian";

export const atlassianOAuthConfigs = [${configExports.join(", ")}] as const;

export const atlassianOAuthScopes = [
${scopes.map((scope) => `  ${JSON.stringify(scope)},`).join("\n")}
] as const;

export const atlassianOAuthForbiddenScopes = [
${forbiddenScopes.map((scope) => `  ${JSON.stringify(scope)},`).join("\n")}
] as const;

export const atlassianOAuthScopePolicy = {
  requiredScopes: atlassianOAuthScopes,
  forbiddenScopes: atlassianOAuthForbiddenScopes,
} as const;
`;
}

const CALLBACK_ROUTE = `import { createOAuthCallbackDispatcher } from "veryfront/oauth";
import {
  atlassianOAuthCallbackRouteId,
  atlassianOAuthConfigs,
} from "../../../../../lib/atlassian-oauth.generated.ts";
import { oauthTokenStore } from "../../../../../lib/oauth-store.ts";

export const GET = createOAuthCallbackDispatcher(atlassianOAuthConfigs, {
  tokenStore: oauthTokenStore,
  callbackRouteId: atlassianOAuthCallbackRouteId,
});
`;

/**
 * Generate the shared Atlassian OAuth artifacts for the successfully selected
 * Jira and Confluence templates.
 */
export function generateAtlassianOAuthFiles(
  integrationNames: readonly IntegrationName[],
): TemplateFile[] {
  const products = getSelectedProducts(integrationNames);
  if (products.length === 0) return [];
  const scopes = getAtlassianOAuthScopes(integrationNames);
  const forbiddenScopes = getUnselectedAtlassianOAuthScopes(integrationNames);

  return [
    {
      path: ATLASSIAN_OAUTH_CALLBACK_PATH,
      content: CALLBACK_ROUTE,
    },
    {
      path: "lib/atlassian-oauth.generated.ts",
      content: renderConfigModule(products, scopes, forbiddenScopes),
    },
  ];
}
