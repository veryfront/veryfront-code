import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { LLMProviderRegistry } from "veryfront/extensions/llm";
import { LLMProviderRegistryName } from "veryfront/extensions/llm";
import manifest from "../deno.json" with { type: "json" };
import extOnnx, { OnnxProvider } from "./index.ts";
import { TRANSFORMERS_VERSION } from "./local-engine.ts";

describe("ext-llm-onnx", () => {
  const capabilities = [
    {
      type: "env:read",
      keys: [
        "VERYFRONT_DISABLE_LOCAL_AI",
        "VERYFRONT_LOCAL_AI_DEVICE",
        "VERYFRONT_LOCAL_AI_THINKING",
      ],
    },
    { type: "fs:read", paths: ["./.cache/models"] },
    { type: "fs:write", paths: ["./.cache/models"] },
    { type: "net:outbound", hosts: ["*"] },
    { type: "native:ffi" },
  ];

  it("declares and registers the local LLM provider contract", () => {
    const extension = extOnnx();
    assertEquals(extension.name, "ext-llm-onnx");
    assertEquals(extension.contracts?.provides, ["LLMProvider:local"]);
    assertEquals(extension.contracts?.requires, [LLMProviderRegistryName]);
    assertEquals(extension.capabilities, capabilities);
    assertEquals(manifest.veryfront.capabilities, capabilities);

    const registered: Record<string, unknown> = {};
    const registry: LLMProviderRegistry = {
      register(provider) {
        registered[provider.id] = provider;
      },
      unregister() {},
      get: () => undefined,
      require() {
        throw new Error("unused");
      },
      list: () => [],
      has: () => false,
    };
    extension.setup?.({
      config: {},
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      provide() {},
      get: () => undefined,
      require<T>(name: string): T {
        if (name === LLMProviderRegistryName) return registry as T;
        throw new Error(`unexpected require(${name})`);
      },
    } as never);

    assert(registered.local instanceof OnnxProvider);
  });

  it("creates credential-free local model and embedding runtimes", () => {
    const provider = new OnnxProvider();

    assertEquals(provider.id, "local");
    assertEquals(provider.defaultEmbeddingModelId, "all-MiniLM-L6-v2");

    const model = provider.createModel("qwen3.5-0.8b", {});
    assertEquals(model.provider, "local");
    assertEquals(model.modelId, "local/qwen3.5-0.8b");
    assertEquals(model.executionMode, "server-local");
    assertEquals(model.runtimeCapabilities?.toolCalling, false);
    assertEquals(typeof model.prepare, "function");

    const embedding = provider.createEmbedding("all-MiniLM-L6-v2", {});
    assertEquals(embedding.provider, "local");
    assertEquals(embedding.modelId, "local/all-MiniLM-L6-v2");
  });

  it("keeps the optional peer declaration aligned with the opaque runtime import", () => {
    assertEquals(
      manifest.imports["@huggingface/transformers"],
      `npm:@huggingface/transformers@${TRANSFORMERS_VERSION}`,
    );
    assertEquals(manifest.veryfront.npm.optionalPeers, ["@huggingface/transformers"]);
  });
});
