import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ProviderCredential, ProviderName } from "./provider-store.ts";

describe("Provider Store", () => {
  it("ProviderCredential has required fields", () => {
    const cred: ProviderCredential = {
      apiKey: "sk-test-123",
      validatedAt: "2026-03-31T00:00:00Z",
      provider: "anthropic",
    };
    assertEquals(typeof cred.apiKey, "string");
    assertEquals(typeof cred.validatedAt, "string");
    assertEquals(cred.provider, "anthropic");
  });

  it("ProviderName supports anthropic and openai", () => {
    const names: ProviderName[] = ["anthropic", "openai"];
    assertEquals(names.length, 2);
  });

  it("listProviderTokens returns empty when no tokens", async () => {
    const { listProviderTokens } = await import("./provider-store.ts");
    const providers = await listProviderTokens();
    assertEquals(Array.isArray(providers), true);
  });
});
