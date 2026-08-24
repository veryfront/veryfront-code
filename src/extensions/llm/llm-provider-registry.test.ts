import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { createLLMProviderRegistry } from "./llm-provider-registry.ts";
import type { LLMProvider } from "./llm-provider.ts";

function fakeProvider(id: string): LLMProvider {
  return {
    id,
    createModel: () => {
      throw new Error("not used");
    },
  };
}

describe("LLMProviderRegistry", () => {
  it("register + get returns the same instance", () => {
    const reg = createLLMProviderRegistry();
    const p = fakeProvider("openai");
    reg.register(p);
    assertEquals(reg.get("openai"), p);
    assert(reg.has("openai"));
  });

  it("get returns undefined for unknown id", () => {
    const reg = createLLMProviderRegistry();
    assertEquals(reg.get("nope"), undefined);
    assertEquals(reg.has("nope"), false);
  });

  it("require throws with a helpful message listing known providers", () => {
    const reg = createLLMProviderRegistry();
    reg.register(fakeProvider("openai"));
    reg.register(fakeProvider("anthropic"));
    assertThrows(
      () => reg.require("google"),
      Error,
      "google",
    );
    assertThrows(
      () => reg.require("google"),
      Error,
      "openai, anthropic",
    );
  });

  it("register is first-write-wins (duplicate id silently skipped)", () => {
    const reg = createLLMProviderRegistry();
    const p1 = fakeProvider("openai");
    const p2 = fakeProvider("openai");
    reg.register(p1);
    reg.register(p2);
    assertEquals(reg.get("openai"), p1);
  });

  it("unregister allows re-registration", () => {
    const reg = createLLMProviderRegistry();
    const p1 = fakeProvider("openai");
    const p2 = fakeProvider("openai");
    reg.register(p1);
    reg.unregister("openai");
    reg.register(p2);
    assertEquals(reg.get("openai"), p2);
  });

  it("list returns providers in insertion order", () => {
    const reg = createLLMProviderRegistry();
    reg.register(fakeProvider("openai"));
    reg.register(fakeProvider("anthropic"));
    reg.register(fakeProvider("google"));
    assertEquals(reg.list().map((p) => p.id), ["openai", "anthropic", "google"]);
  });

  it("captures provider identity once at registration", () => {
    const reg = createLLMProviderRegistry();
    let idReads = 0;
    const provider = {
      get id(): string {
        idReads++;
        if (idReads > 1) throw new Error("id read more than once");
        return "stable";
      },
      createModel: () => {
        throw new Error("not used");
      },
    };

    reg.register(provider);

    assertEquals(reg.get("stable"), provider);
    assertEquals(reg.has("stable"), true);
    assertEquals(idReads, 1);
  });

  it("rejects malformed provider registrations", () => {
    const reg = createLLMProviderRegistry();

    assertThrows(
      () => reg.register(fakeProvider("  ")),
      TypeError,
      "non-empty canonical string",
    );
    assertThrows(
      () =>
        reg.register({
          id: "missing-create-model",
        } as never),
      TypeError,
      'method "createModel"',
    );
    assertThrows(
      () =>
        reg.register({
          ...fakeProvider("bad-optional-method"),
          createEmbedding: "not a function",
        } as never),
      TypeError,
      'optional method "createEmbedding"',
    );
    assertThrows(
      () =>
        reg.register({
          ...fakeProvider("bad-responses"),
          createResponses: "not a function",
        } as never),
      TypeError,
      'optional method "createResponses"',
      "a non-function createResponses must be rejected at the registration boundary",
    );
  });
});
