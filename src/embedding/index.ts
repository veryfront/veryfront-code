/**
 * RAG primitives for chunking, embedding, and similarity search.
 *
 * @module embedding
 *
 * @example
 * ```ts
 * import { ragStore, createUploadHandler } from "veryfront/embedding";
 *
 * const store = ragStore({});
 * export const { POST, GET, DELETE } = createUploadHandler(store, {
 *   auth: { type: "none", allowUnauthenticated: true },
 * });
 * ```
 */

export { embedding } from "./embedding.ts";
export { chunk } from "./chunk.ts";
export { cosineSimilarity as similarity } from "#veryfront/runtime/runtime-bridge.ts";
export { vectorStore } from "./vector-store.ts";
export { ragStore } from "./rag-store.ts";
export { createUploadHandler } from "./upload-handler.ts";
export { loadUpload } from "./upload-loader.ts";
export {
  clearEmbeddingProviders,
  registerEmbeddingProvider,
  resolveEmbeddingModel,
} from "./resolve.ts";
export type {
  ChunkOptions,
  Embedding,
  EmbeddingCallOptions,
  EmbeddingConfig,
  RagChunk,
  RagDocumentMeta,
  RagIngestMetadata,
  RagRefreshOptions,
  RagSearchOptions,
  RagSearchResult,
  RagStore,
  RagStoreBackend,
  RagStoreConfig,
  RagStoreData,
  SearchOptions,
  SearchResult,
  VectorStore,
  VectorStoreConfig,
} from "./types.ts";
export type {
  UploadAuthorizationResult,
  UploadAuthorize,
  UploadHandlerAuthConfig,
  UploadHandlerConfig,
  UploadHandlers,
  UploadRouteContext,
} from "./upload-handler.ts";
export type { UploadLoadOptions } from "./upload-loader.ts";
export type { EmbeddingProviderFactory } from "./resolve.ts";
export type { EmbeddingRuntime, RuntimeMetadata } from "#veryfront/provider/types.ts";
