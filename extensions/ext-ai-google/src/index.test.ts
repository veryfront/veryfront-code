import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import extGoogle, { GoogleProvider } from "./index.ts";
import type { AIProviderRegistry } from "veryfront/extensions/ai";

describe("ext-ai-google", () => {
  it("factory descriptor advertises the AIProvider:google capability", () => {
    const ext = extGoogle();
    assertEquals(ext.name, "ext-ai-google");
    assertEquals(ext.capabilities?.[0], {
      type: "contract",
      name: "AIProvider:google",
    });
  });

  it("setup registers the provider in the AIProviderRegistry", () => {
    const ext = extGoogle();
    const registered: Record<string, unknown> = {};
    const fakeRegistry: AIProviderRegistry = {
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
        if (name === "AIProviderRegistry") return fakeRegistry as unknown as T;
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
