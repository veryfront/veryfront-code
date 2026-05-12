import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import extOpenAI, { OpenAIProvider } from "./index.ts";
import type { LLMProviderRegistry } from "veryfront/extensions/llm";

describe("ext-llm-openai", () => {
  it("factory descriptor advertises the LLMProvider:openai capability", () => {
    const ext = extOpenAI();
    assertEquals(ext.name, "ext-llm-openai");
    assertEquals(ext.capabilities?.[0], {
      type: "contract",
      name: "LLMProvider:openai",
    });
  });

  it("setup registers the provider in the LLMProviderRegistry", () => {
    const ext = extOpenAI();
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
    assert(registered.openai instanceof OpenAIProvider);
  });
});
