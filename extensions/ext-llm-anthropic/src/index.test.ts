import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import extAnthropic, { AnthropicProvider } from "./index.ts";
import { type LLMProviderRegistry, LLMProviderRegistryName } from "veryfront/extensions/llm";

describe("ext-llm-anthropic", () => {
  it("factory descriptor requires the LLMProviderRegistry contract", () => {
    const ext = extAnthropic();
    assertEquals(ext.name, "ext-llm-anthropic");
    assertEquals(ext.contracts?.requires, [LLMProviderRegistryName]);
    assertEquals(ext.capabilities, []);
  });

  it("setup registers the provider in the LLMProviderRegistry", () => {
    const ext = extAnthropic();
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
    assert(registered.anthropic instanceof AnthropicProvider);
  });
});
