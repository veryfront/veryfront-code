import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { EXPERIMENTAL_INTEGRATIONS_ENV } from "../../src/integrations/feature-flags.ts";
import {
  ALL_AVAILABLE_INTEGRATIONS,
  getAvailableIntegrations,
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

  it("allows a feature-gated integration when explicitly enabled", () => {
    Deno.env.set(EXPERIMENTAL_INTEGRATIONS_ENV, "salesforce,sap,persona");

    assertEquals(getAvailableIntegrations().includes("salesforce"), true);
    assertEquals(getAvailableIntegrations().includes("sap"), true);
    assertEquals(getAvailableIntegrations().includes("persona"), true);
    assertEquals(validateIntegrations(["salesforce"]).valid, true);
    assertEquals(validateIntegrations(["sap"]).valid, true);
    assertEquals(validateIntegrations(["persona"]).valid, true);
  });
});
