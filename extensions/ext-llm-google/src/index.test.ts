import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import extGoogle, { GoogleProvider } from "./index.ts";
import { type LLMProviderRegistry, LLMProviderRegistryName } from "veryfront/extensions/llm";

describe("ext-llm-google", () => {
  it("factory descriptor requires the LLMProviderRegistry contract", () => {
    const ext = extGoogle();
    assertEquals(ext.name, "ext-llm-google");
    assertEquals(ext.contracts?.provides, ["LLMProvider:google"]);
    assertEquals(ext.contracts?.requires, [LLMProviderRegistryName]);
    assertEquals(ext.capabilities, []);
  });

  it("setup registers the provider in the LLMProviderRegistry", () => {
    const ext = extGoogle();
    const registered: Record<string, unknown> = {};
    const fakeRegistry: LLMProviderRegistry = {
      register: (p) => {
        registered[p.id] = p;
      },
      unregister: () => {},
      get: () => undefined,
      require: () => {
        throw new Error("unused");
      },
      list: () => [],
      has: () => false,
    };
    const ctx = {
      config: {},
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      provide: () => {},
      get: () => undefined,
      require: <T>(name: string): T => {
        if (name === "LLMProviderRegistry") return fakeRegistry as unknown as T;
        throw new Error(`unexpected require(${name})`);
      },
    };
    ext.setup?.(ctx as never);
    assert(registered.google instanceof GoogleProvider);
  });

  it("GoogleProvider exposes both createModel and createEmbedding", () => {
    const provider = new GoogleProvider();
    assertEquals(typeof provider.createModel, "function");
    assertEquals(typeof provider.createEmbedding, "function");
  });

  it("rejects a missing credential at the provider boundary", () => {
    assertThrows(
      () => new GoogleProvider().createModel("gemini-2.5-flash", {} as never),
      TypeError,
      "Google provider requires a credential",
    );
  });
});
