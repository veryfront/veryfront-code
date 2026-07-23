/**
 * LLM category barrel for provider, embedding, and registry contracts.
 *
 * Interfaces re-exported with `export type { ... }` because Deno `--no-check`
 * transpiles each file in isolation and would otherwise emit a runtime value
 * re-export that fails ESM resolution. Reserve plain `export { ... }` for
 * runtime values.
 *
 * @module extensions/llm
 */

export { LLMProviderRegistryName } from "./llm-provider.ts";
export type {
  EmbeddingRuntime,
  LLMProvider,
  LLMProviderConfig,
  LLMProviderRegistry,
  ModelRuntime,
} from "./llm-provider.ts";
export type { EmbeddingOptions, EmbeddingProvider, EmbeddingResult } from "./embedding-provider.ts";
export { createLLMProviderRegistry } from "./llm-provider-registry.ts";
