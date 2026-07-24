import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { confluenceConfig, jiraConfig } from "veryfront/oauth";
import {
  ATLASSIAN_OAUTH_CALLBACK_PATH,
  generateAtlassianOAuthFiles,
  getAtlassianOAuthScopes,
  getUnselectedAtlassianOAuthScopes,
} from "./atlassian-oauth-composition.ts";

const CONFIG_PATH = "lib/atlassian-oauth.generated.ts";

function getGeneratedContent(
  integrationNames: Parameters<typeof generateAtlassianOAuthFiles>[0],
  path: string,
): string {
  const file = generateAtlassianOAuthFiles(integrationNames).find((candidate) =>
    candidate.path === path
  );
  if (!file) throw new Error(`Missing generated Atlassian file: ${path}`);
  return file.content;
}

function getGeneratedScopeBlock(config: string, exportName: string): string {
  const start = config.indexOf(`export const ${exportName} = [`);
  if (start < 0) throw new Error(`Missing generated scope export: ${exportName}`);
  const end = config.indexOf("] as const;", start);
  if (end < 0) throw new Error(`Unterminated generated scope export: ${exportName}`);
  return config.slice(start, end);
}

describe("generateAtlassianOAuthFiles", () => {
  it("emits nothing when no Atlassian products are selected", () => {
    assertEquals(generateAtlassianOAuthFiles([]), []);
    assertEquals(generateAtlassianOAuthFiles(["github"]), []);
    assertEquals(getAtlassianOAuthScopes([]), []);
    assertEquals(getAtlassianOAuthScopes(["github"]), []);
    assertEquals(getUnselectedAtlassianOAuthScopes([]), []);
    assertEquals(getUnselectedAtlassianOAuthScopes(["github"]), []);
  });

  it("returns canonical least-privilege scope unions", () => {
    const expectedCombined = [
      ...new Set([
        ...jiraConfig.defaultScopes,
        ...confluenceConfig.defaultScopes,
      ]),
    ];

    assertEquals(
      getAtlassianOAuthScopes(["jira"]),
      jiraConfig.defaultScopes,
    );
    assertEquals(
      getAtlassianOAuthScopes(["confluence"]),
      confluenceConfig.defaultScopes,
    );
    assertEquals(
      getAtlassianOAuthScopes(["jira", "confluence"]),
      expectedCombined,
    );
    assertEquals(
      getAtlassianOAuthScopes(["confluence", "jira"]),
      expectedCombined,
    );
    assertEquals(
      getAtlassianOAuthScopes(["confluence", "jira", "jira"]),
      expectedCombined,
    );
    assertEquals(
      getUnselectedAtlassianOAuthScopes(["jira", "confluence"]),
      [],
    );
  });

  it("keeps a Jira-only selection least-privilege", () => {
    const files = generateAtlassianOAuthFiles(["jira"]);
    const config = getGeneratedContent(["jira"], CONFIG_PATH);
    const requested = getGeneratedScopeBlock(config, "atlassianOAuthScopes");
    const forbidden = getGeneratedScopeBlock(
      config,
      "atlassianOAuthForbiddenScopes",
    );

    assertEquals(
      files.map((file) => file.path),
      [ATLASSIAN_OAUTH_CALLBACK_PATH, CONFIG_PATH],
    );
    assertStringIncludes(config, 'import { jiraConfig } from "veryfront/oauth";');
    assertStringIncludes(config, "atlassianOAuthConfigs = [jiraConfig]");
    assertEquals(config.includes("confluenceConfig"), false);
    for (const scope of jiraConfig.defaultScopes) {
      assertStringIncludes(requested, JSON.stringify(scope));
    }
    for (
      const scope of confluenceConfig.defaultScopes.filter((scope) =>
        !jiraConfig.defaultScopes.includes(scope)
      )
    ) {
      assertEquals(requested.includes(JSON.stringify(scope)), false);
      assertStringIncludes(forbidden, JSON.stringify(scope));
      assertEquals(
        getUnselectedAtlassianOAuthScopes(["jira"]).includes(scope),
        true,
      );
    }
    assertStringIncludes(config, "atlassianOAuthForbiddenScopes");
    assertStringIncludes(config, "atlassianOAuthScopePolicy");
  });

  it("keeps a Confluence-only selection least-privilege", () => {
    const config = getGeneratedContent(["confluence"], CONFIG_PATH);
    const requested = getGeneratedScopeBlock(config, "atlassianOAuthScopes");
    const forbidden = getGeneratedScopeBlock(
      config,
      "atlassianOAuthForbiddenScopes",
    );

    assertStringIncludes(
      config,
      'import { confluenceConfig } from "veryfront/oauth";',
    );
    assertStringIncludes(
      config,
      "atlassianOAuthConfigs = [confluenceConfig]",
    );
    assertEquals(config.includes("jiraConfig"), false);
    for (const scope of confluenceConfig.defaultScopes) {
      assertStringIncludes(requested, JSON.stringify(scope));
    }
    for (
      const scope of jiraConfig.defaultScopes.filter((scope) =>
        !confluenceConfig.defaultScopes.includes(scope)
      )
    ) {
      assertEquals(requested.includes(JSON.stringify(scope)), false);
      assertStringIncludes(forbidden, JSON.stringify(scope));
      assertEquals(
        getUnselectedAtlassianOAuthScopes(["confluence"]).includes(scope),
        true,
      );
    }
  });

  it("deduplicates scopes and canonicalizes a combined selection", () => {
    const canonical = generateAtlassianOAuthFiles(["jira", "confluence"]);
    const reversed = generateAtlassianOAuthFiles(["confluence", "jira"]);
    const repeated = generateAtlassianOAuthFiles([
      "confluence",
      "jira",
      "jira",
    ]);
    const config = getGeneratedContent(["jira", "confluence"], CONFIG_PATH);
    const expectedScopes = [
      ...new Set([
        ...jiraConfig.defaultScopes,
        ...confluenceConfig.defaultScopes,
      ]),
    ];

    assertEquals(reversed, canonical);
    assertEquals(repeated, canonical);
    assertStringIncludes(
      config,
      "atlassianOAuthConfigs = [jiraConfig, confluenceConfig]",
    );
    assertEquals(
      expectedScopes.map((scope) => [
        scope,
        config.split(JSON.stringify(scope)).length - 1,
      ]),
      expectedScopes.map((scope) => [scope, 1]),
    );
  });

  it("emits one shared dispatcher callback with the shared route id", () => {
    const callback = getGeneratedContent(
      ["jira", "confluence"],
      ATLASSIAN_OAUTH_CALLBACK_PATH,
    );

    assertStringIncludes(callback, "createOAuthCallbackDispatcher");
    assertStringIncludes(callback, "atlassianOAuthConfigs");
    assertStringIncludes(callback, "atlassianOAuthCallbackRouteId");
    assertStringIncludes(callback, "callbackRouteId: atlassianOAuthCallbackRouteId");
    assertStringIncludes(callback, "tokenStore: oauthTokenStore");
  });

  it("binds both product init routes to the generated scopes and callback", async () => {
    for (const integration of ["jira", "confluence"]) {
      const routeUrl = new URL(
        `./integrations/${integration}/files/app/api/auth/${integration}/route.ts`,
        import.meta.url,
      );
      const callbackUrl = new URL(
        `./integrations/${integration}/files/app/api/auth/${integration}/callback/route.ts`,
        import.meta.url,
      );
      const clientUrl = new URL(
        `./integrations/${integration}/files/lib/${integration}-client.ts`,
        import.meta.url,
      );
      const route = await Deno.readTextFile(routeUrl);
      const client = await Deno.readTextFile(clientUrl);
      const callbackExists = await Deno.stat(callbackUrl).then(
        () => true,
        (error) => {
          if (error instanceof Deno.errors.NotFound) return false;
          throw error;
        },
      );

      assertStringIncludes(route, "atlassianOAuthScopes");
      assertStringIncludes(route, "atlassianOAuthCallbackRouteId");
      assertStringIncludes(route, "authOptions: { scopes: atlassianOAuthScopes }");
      assertStringIncludes(
        route,
        "callbackRouteId: atlassianOAuthCallbackRouteId",
      );
      assertStringIncludes(client, "atlassianOAuthScopePolicy");
      assertStringIncludes(client, "fetchOAuthJsonWithScopePolicy");
      assertStringIncludes(client, "resolveAtlassianCloudId");
      assertEquals(callbackExists, false);
    }
  });
});
