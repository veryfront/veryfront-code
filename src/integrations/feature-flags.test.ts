import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  DECLARED_INTEGRATION_NAMES,
  EXPERIMENTAL_INTEGRATIONS_ENV,
  filterVisibleIntegrations,
  HOST_ADAPTER_INTEGRATIONS_ENV,
  INTEGRATIONS_REQUIRING_PROVIDER_ADAPTER,
  isCatalogVisibleIntegration,
  isExperimentalIntegrationEnabled,
  isHostAdapterIntegration,
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

  it("keeps a host-declared adapter connector out of scaffolding visibility", () => {
    // The scaffolding guard must not move: generated routes run on the generic
    // runtime, which is exactly what cannot serve these connectors.
    Deno.env.set(HOST_ADAPTER_INTEGRATIONS_ENV, "salesforce");
    try {
      assertEquals(isVisibleIntegration("salesforce"), false);
      assertEquals(isExperimentalIntegrationEnabled("salesforce"), false);
    } finally {
      Deno.env.delete(HOST_ADAPTER_INTEGRATIONS_ENV);
    }
  });

  it("exposes a host-declared adapter connector to catalog lookup", () => {
    // A host naming a connector is asserting it ships the client itself, so it
    // keeps the tool definitions it needs to drive it.
    Deno.env.set(HOST_ADAPTER_INTEGRATIONS_ENV, "salesforce");
    try {
      assertEquals(isHostAdapterIntegration("salesforce"), true);
      assertEquals(isCatalogVisibleIntegration("salesforce"), true);
      // Not named, so still absent even though it is adapter-only too.
      assertEquals(isCatalogVisibleIntegration("pipedrive"), false);
    } finally {
      Deno.env.delete(HOST_ADAPTER_INTEGRATIONS_ENV);
    }
  });

  it("ignores blanket values for the host adapter declaration", () => {
    for (const blanket of ["1", "true", "all", "*"]) {
      Deno.env.set(HOST_ADAPTER_INTEGRATIONS_ENV, blanket);
      try {
        assertEquals(isHostAdapterIntegration("salesforce"), false, blanket);
        assertEquals(isCatalogVisibleIntegration("salesforce"), false, blanket);
      } finally {
        Deno.env.delete(HOST_ADAPTER_INTEGRATIONS_ENV);
      }
    }
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
