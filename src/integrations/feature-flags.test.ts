import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  DECLARED_INTEGRATION_NAMES,
  EXPERIMENTAL_INTEGRATIONS_ENV,
  filterVisibleIntegrations,
  INTEGRATIONS_REQUIRING_PROVIDER_ADAPTER,
  isExperimentalIntegrationEnabled,
  isSupportedIntegration,
  isVisibleIntegration,
  SUPPORTED_INTEGRATION_NAMES,
} from "./feature-flags.ts";
import { ALL_INTEGRATION_NAMES } from "./schema.ts";

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

  it("exposes eligible experimental integrations but not adapter-only providers", () => {
    setFlag("salesforce, stripe");

    assertEquals(isExperimentalIntegrationEnabled("salesforce"), false);
    assertEquals(isExperimentalIntegrationEnabled("stripe"), true);
    assertEquals(isVisibleIntegration("salesforce"), false);
    assertEquals(isVisibleIntegration("stripe"), true);
    assertEquals(isVisibleIntegration("pipedrive"), false);
  });

  it("keeps adapter-only providers unavailable when all experiments are enabled", () => {
    setFlag("all");

    assertEquals(isVisibleIntegration("salesforce"), false);
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

  it("keeps every provider-adapter-only integration within the canonical registry", () => {
    const registry = new Set<string>(ALL_INTEGRATION_NAMES);
    const missing = INTEGRATIONS_REQUIRING_PROVIDER_ADAPTER.filter((name) => !registry.has(name));
    assertEquals(missing, []);
  });
});
