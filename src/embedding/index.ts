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
export { useUploads } from "./react/use-uploads.ts";
export type { UseUploadsOptions, UseUploadsResult } from "./react/use-uploads.ts";
export {
  clearEmbeddingProviders,
  registerEmbeddingProvider,
  resolveEmbeddingModel,
} from "./resolve.ts";
export type {
  ChunkOptions,
  Embedding,
  EmbeddingConfig,
  RagChunk,
  RagDocumentMeta,
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
} from "./upload-handler.ts";
