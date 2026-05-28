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
    assertEquals(getAvailableIntegrations().includes("sentry"), true);
    assertEquals(getAvailableIntegrations().includes("salesforce"), false);
    assertEquals(validateIntegrations(["salesforce"]).valid, false);
  });

  it("allows a feature-gated integration when explicitly enabled", () => {
    Deno.env.set(EXPERIMENTAL_INTEGRATIONS_ENV, "salesforce");

    assertEquals(getAvailableIntegrations().includes("salesforce"), true);
    assertEquals(validateIntegrations(["salesforce"]).valid, true);
  });
});
