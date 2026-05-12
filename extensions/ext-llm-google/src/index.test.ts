import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import extGoogle, { GoogleProvider } from "./index.ts";
import type { LLMProviderRegistry } from "veryfront/extensions/llm";

describe("ext-llm-google", () => {
  it("factory descriptor advertises the LLMProvider:google capability", () => {
    const ext = extGoogle();
    assertEquals(ext.name, "ext-llm-google");
    assertEquals(ext.capabilities?.[0], {
      type: "contract",
      name: "LLMProvider:google",
    });
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
});
