import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  DECLARED_INTEGRATION_NAMES,
  EXPERIMENTAL_INTEGRATIONS_ENV,
  filterVisibleIntegrations,
  isSupportedIntegration,
  isVisibleIntegration,
  SUPPORTED_INTEGRATION_NAMES,
} from "./feature-flags.ts";
import { ALL_INTEGRATION_NAMES } from "./schema.ts";
import { connectors } from "./_data.ts";

function setFlag(value: string | undefined): void {
  if (value === undefined) {
    Deno.env.delete(EXPERIMENTAL_INTEGRATIONS_ENV);
    return;
  }
  Deno.env.set(EXPERIMENTAL_INTEGRATIONS_ENV, value);
}

describe("integration feature flags", () => {
  afterEach(() => setFlag(undefined));

  it("keeps the supported integration surface visible by default", () => {
    assertEquals(isSupportedIntegration("figma"), true);
    assertEquals(isVisibleIntegration("figma"), true);
    assertEquals(isSupportedIntegration("sentry"), true);
    assertEquals(isVisibleIntegration("sentry"), true);
  });

  it("hides unsupported integrations by default without deleting their source", () => {
    assertEquals(isSupportedIntegration("salesforce"), false);
    assertEquals(isVisibleIntegration("salesforce"), false);
  });

  it("exposes a comma-listed unsupported integration", () => {
    setFlag("salesforce, stripe");

    assertEquals(isVisibleIntegration("salesforce"), true);
    assertEquals(isVisibleIntegration("stripe"), true);
    assertEquals(isVisibleIntegration("pipedrive"), false);
  });

  it("exposes all declared integrations when explicitly enabled", () => {
    setFlag("all");

    assertEquals(isVisibleIntegration("salesforce"), true);
    assertEquals(isVisibleIntegration("stripe"), true);
    assertEquals(isVisibleIntegration("not-a-provider"), false);
  });

  it("filters collections by integration id", () => {
    assertEquals(
      filterVisibleIntegrations([
        { id: "figma" },
        { id: "salesforce" },
      ]).map((item) => item.id),
      ["figma"],
    );
  });

  it("fails closed for an oversized experimental integration flag", () => {
    setFlag(`salesforce,${"x".repeat(16_384)}`);

    assertEquals(isVisibleIntegration("salesforce"), false);
  });

  it("keeps the exported name registries immutable", () => {
    assertEquals(Object.isFrozen(SUPPORTED_INTEGRATION_NAMES), true);
    assertEquals(Object.isFrozen(DECLARED_INTEGRATION_NAMES), true);
    assertEquals(Object.isFrozen(ALL_INTEGRATION_NAMES), true);
  });
});

describe("integration name registry", () => {
  it("derives the declared integration list from the canonical registry", () => {
    assertEquals(
      new Set<string>(DECLARED_INTEGRATION_NAMES),
      new Set<string>(ALL_INTEGRATION_NAMES),
    );
  });

  it("keeps every supported integration within the canonical registry", () => {
    const registry = new Set<string>(ALL_INTEGRATION_NAMES);
    const missing = SUPPORTED_INTEGRATION_NAMES.filter((name) => !registry.has(name));
    assertEquals(missing, []);
  });

  it("documents the compatibility-reserved name that has no connector source", () => {
    const connectorNames = new Set(connectors.map((connector) => connector.name));
    assertEquals(
      ALL_INTEGRATION_NAMES.filter((name) => !connectorNames.has(name)),
      ["twitter"],
    );
  });
});
