/**
 * AI category barrel — provider, embedding, and registry contracts.
 *
 * Interfaces re-exported with `export type { ... }` because Deno `--no-check`
 * transpiles each file in isolation and would otherwise emit a runtime value
 * re-export that fails ESM resolution. Reserve plain `export { ... }` for
 * runtime values.
 *
 * @module extensions/ai
 */

export { AIProviderRegistryName } from "./ai-provider.ts";
export type { AIProvider, AIProviderConfig, AIProviderRegistry } from "./ai-provider.ts";
export type { EmbeddingOptions, EmbeddingProvider, EmbeddingResult } from "./embedding-provider.ts";
export { createAIProviderRegistry } from "./ai-provider-registry.ts";
