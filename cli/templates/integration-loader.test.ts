import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { EXPERIMENTAL_INTEGRATIONS_ENV } from "../../src/integrations/feature-flags.ts";
import {
  ALL_AVAILABLE_INTEGRATIONS,
  getAvailableIntegrations,
  IntegrationConfigLoadError,
  loadIntegration,
  loadIntegrations,
  parseIntegrationConfig,
  validateIntegrations,
} from "./integration-loader.ts";

describe("cli/templates/integration-loader feature gates", () => {
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

  it("allows operational feature-gated integrations but not incomplete OAuth adapters", () => {
    Deno.env.set(EXPERIMENTAL_INTEGRATIONS_ENV, "salesforce,sap,persona");

    assertEquals(getAvailableIntegrations().includes("salesforce"), false);
    assertEquals(getAvailableIntegrations().includes("sap"), true);
    assertEquals(getAvailableIntegrations().includes("persona"), true);
    assertEquals(validateIntegrations(["salesforce"]).valid, false);
    assertEquals(
      validateIntegrations(["salesforce"]).errors[0]?.includes(
        "provider-specific adapter",
      ),
      true,
    );
    assertEquals(validateIntegrations(["sap"]).valid, true);
    assertEquals(validateIntegrations(["persona"]).valid, true);
  });

  it("fails closed before loading files for a blocked provider template", async () => {
    Deno.env.set(EXPERIMENTAL_INTEGRATIONS_ENV, "salesforce");
    assertEquals(await loadIntegration("salesforce"), null);
    const result = await loadIntegrations(["salesforce"]);

    assertEquals(result.integrations, []);
    assertEquals(result.files, []);
    assertEquals(result.errors[0]?.includes("provider-specific adapter"), true);
  });

  it("does not advertise or emit default-visible OAuth integrations with no operational files", async () => {
    for (const name of ["harvest", "hubspot"] as const) {
      assertEquals(getAvailableIntegrations().includes(name), false);
      assertEquals(validateIntegrations([name]).valid, false);
      assertEquals(await loadIntegration(name), null);

      const result = await loadIntegrations([name]);
      assertEquals(result.integrations, []);
      assertEquals(result.files, []);
      assertEquals(
        result.errors[0]?.includes(
          "checked-in template has no operational files",
        ),
        true,
      );
    }
  });

  it("does not advertise or emit feature-gated OAuth integrations with no operational files", async () => {
    const names = [
      "box",
      "clickup",
      "intercom",
      "monday",
      "twitter",
      "webex",
      "zoom",
    ] as const;
    Deno.env.set(EXPERIMENTAL_INTEGRATIONS_ENV, names.join(","));

    for (const name of names) {
      assertEquals(getAvailableIntegrations().includes(name), false);
      assertEquals(validateIntegrations([name]).valid, false);
      assertEquals(await loadIntegration(name), null);

      const result = await loadIntegrations([name]);
      assertEquals(result.integrations, []);
      assertEquals(result.files, []);
      assertEquals(
        result.errors[0]?.includes(
          "checked-in template has no operational files",
        ),
        true,
      );
    }
  });
});

describe("cli/templates/integration-loader config failures", () => {
  it("distinguishes malformed JSON from schema validation failures", () => {
    const malformed = assertThrows(
      () => parseIntegrationConfig("{", "github"),
      IntegrationConfigLoadError,
    );
    assertEquals(malformed.failure, "parse");

    const invalid = assertThrows(
      () =>
        parseIntegrationConfig(JSON.stringify({ name: "github" }), "github"),
      IntegrationConfigLoadError,
    );
    assertEquals(invalid.failure, "validate");
  });

  it("rejects a connector whose declared name differs from the selected name", () => {
    const error = assertThrows(
      () =>
        parseIntegrationConfig(
          JSON.stringify({
            name: "gitlab",
            displayName: "GitLab",
            description: "GitLab connector",
            auth: { type: "oauth2" },
            tools: [],
          }),
          "github",
        ),
      IntegrationConfigLoadError,
    );
    assertEquals(error.failure, "validate");
  });
});
