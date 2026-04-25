import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import extAnthropic, { AnthropicProvider } from "./index.ts";
import type { AIProviderRegistry } from "veryfront/extensions/interfaces";

describe("ext-anthropic", () => {
  it("factory descriptor advertises the AIProvider:anthropic capability", () => {
    const ext = extAnthropic();
    assertEquals(ext.name, "ext-anthropic");
    assertEquals(ext.capabilities?.[0], {
      type: "contract",
      name: "AIProvider:anthropic",
    });
  });

  it("setup registers the provider in the AIProviderRegistry", () => {
    const ext = extAnthropic();
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
    assert(registered.anthropic instanceof AnthropicProvider);
  });
});
