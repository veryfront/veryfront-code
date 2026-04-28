import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { createAIProviderRegistry } from "./ai-provider-registry.ts";
import type { AIProvider } from "../interfaces/ai-provider.ts";

function fakeProvider(id: string): AIProvider {
  return {
    id,
    createModel: () => {
      throw new Error("not used");
    },
  };
}

describe("AIProviderRegistry", () => {
  it("ships with built-in anthropic and google providers", () => {
    const reg = createAIProviderRegistry();
    assert(reg.has("anthropic"));
    assert(reg.has("google"));
    assertEquals(reg.has("openai"), false);
  });

  it("register + get returns the same instance", () => {
    const reg = createAIProviderRegistry();
    const p = fakeProvider("openai");
    reg.register(p);
    assertEquals(reg.get("openai"), p);
    assert(reg.has("openai"));
  });

  it("register overrides a built-in provider silently", () => {
    const reg = createAIProviderRegistry();
    const custom = fakeProvider("anthropic");
    reg.register(custom);
    assertEquals(reg.get("anthropic"), custom);
  });

  it("get returns undefined for unknown id", () => {
    const reg = createAIProviderRegistry();
    assertEquals(reg.get("nope"), undefined);
    assertEquals(reg.has("nope"), false);
  });

  it("require throws with a helpful message listing known providers", () => {
    const reg = createAIProviderRegistry();
    reg.register(fakeProvider("openai"));
    assertThrows(
      () => reg.require("nope"),
      Error,
      "nope",
    );
  });

  it("register throws on duplicate id for non-builtin providers", () => {
    const reg = createAIProviderRegistry();
    reg.register(fakeProvider("openai"));
    assertThrows(
      () => reg.register(fakeProvider("openai")),
      Error,
      'AIProvider "openai" is already registered',
    );
  });

  it("unregister allows re-registration", () => {
    const reg = createAIProviderRegistry();
    const p1 = fakeProvider("openai");
    const p2 = fakeProvider("openai");
    reg.register(p1);
    reg.unregister("openai");
    reg.register(p2);
    assertEquals(reg.get("openai"), p2);
  });

  it("list returns providers in insertion order", () => {
    const reg = createAIProviderRegistry();
    reg.register(fakeProvider("openai"));
    const ids = reg.list().map((p) => p.id);
    assertEquals(ids, ["anthropic", "google", "openai"]);
  });
});
