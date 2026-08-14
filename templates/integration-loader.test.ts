import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { EXPERIMENTAL_INTEGRATIONS_ENV } from "../src/integrations/feature-flags.ts";
import {
  ALL_AVAILABLE_INTEGRATIONS,
  getAvailableIntegrations,
  loadIntegrations,
  validateIntegrations,
} from "./integration-loader.ts";

describe("templates/integration-loader feature gates", () => {
  afterEach(() => Deno.env.delete(EXPERIMENTAL_INTEGRATIONS_ENV));

  it("keeps unsupported integrations declared but unavailable by default", () => {
    assertEquals(ALL_AVAILABLE_INTEGRATIONS.includes("salesforce"), true);
    assertEquals(ALL_AVAILABLE_INTEGRATIONS.includes("sap"), true);
    assertEquals(ALL_AVAILABLE_INTEGRATIONS.includes("persona"), true);
    assertEquals(getAvailableIntegrations().includes("sentry"), true);
    assertEquals(getAvailableIntegrations().includes("salesforce"), false);
    assertEquals(getAvailableIntegrations().includes("sap"), false);
    assertEquals(getAvailableIntegrations().includes("persona"), false);
    assertEquals(validateIntegrations(["salesforce"]).valid, false);
    assertEquals(validateIntegrations(["sap"]).valid, false);
    assertEquals(validateIntegrations(["persona"]).valid, false);
  });

  it("allows eligible experiments but keeps provider-adapter-only integrations unavailable", () => {
    Deno.env.set(EXPERIMENTAL_INTEGRATIONS_ENV, "salesforce,sap,persona");

    assertEquals(getAvailableIntegrations().includes("salesforce"), false);
    assertEquals(getAvailableIntegrations().includes("sap"), true);
    assertEquals(getAvailableIntegrations().includes("persona"), true);
    assertEquals(validateIntegrations(["salesforce"]).valid, false);
    assertEquals(validateIntegrations(["sap"]).valid, true);
    assertEquals(validateIntegrations(["persona"]).valid, true);
  });
});

describe("templates/integration-loader file namespacing", () => {
  it("keeps both tool modules when two integrations ship the same tool filename", async () => {
    const { files, errors } = await loadIntegrations(["github", "bitbucket"]);

    assertEquals(errors, []);

    const listIssues = files.filter((file) => file.path.endsWith("list-issues.ts"));
    assertEquals(listIssues.map((file) => file.path), [
      "tools/bitbucket-list-issues.ts",
      "tools/github-list-issues.ts",
    ]);
  });

  it("keeps per-provider env examples off the generated root .env.example path", async () => {
    const { files } = await loadIntegrations(["drive", "slack"]);

    assertEquals(files.some((file) => file.path === ".env.example"), false);
    assertEquals(
      files.some((file) => file.path === "examples/env/drive.env.example"),
      true,
    );
  });

  it("keeps relocated Deno tool imports extensionful", async () => {
    const { files } = await loadIntegrations(["aws", "anthropic"]);
    const extensionlessRelativeImports = files
      .filter((file) => file.path.startsWith("tools/"))
      .flatMap((file) =>
        [...file.content.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)]
          .map((match) => ({ path: file.path, specifier: match[1] }))
      )
      .filter(({ specifier }) => !/\.[cm]?[jt]sx?$/.test(specifier ?? ""));

    assertEquals(extensionlessRelativeImports, []);
  });

  it("drops no tool module when every available integration is generated together", async () => {
    const { integrations, files } = await loadIntegrations(getAvailableIntegrations());

    const expectedToolCount = integrations.reduce(
      (total, integration) =>
        total + integration.files.filter((file) => file.path.startsWith("tools/")).length,
      0,
    );
    const toolPaths = files.filter((file) => file.path.startsWith("tools/")).map((f) => f.path);

    assertEquals(toolPaths.length, expectedToolCount);
    assertEquals(new Set(toolPaths).size, expectedToolCount);
  });
});
