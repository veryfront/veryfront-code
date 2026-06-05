import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  EXPERIMENTAL_INTEGRATIONS_ENV,
  filterVisibleIntegrations,
  isSupportedIntegration,
  isVisibleIntegration,
} from "./feature-flags.ts";

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
});
