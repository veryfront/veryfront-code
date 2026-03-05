/**
 * Embedding — RAG primitives for chunking, embedding, and similarity search.
 *
 * Provides a facade over AI SDK (embeddings, similarity) and LangChain
 * (text splitting) behind veryfront's own API.
 *
 * @module embedding
 *
 * @example
 * ```ts
 * import { uploadStore, createUploadHandler } from "veryfront/embedding";
 *
 * const store = uploadStore({ model: "openai/text-embedding-3-small" });
 * export const { POST, GET, DELETE } = createUploadHandler(store);
 * ```
 */

export { embedding } from "./embedding.ts";
export { chunk } from "./chunk.ts";
export { cosineSimilarity as similarity } from "ai";
export { vectorStore } from "./vector-store.ts";
export { uploadStore } from "./upload-store.ts";
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
  UploadMeta,
  UploadSearchOptions,
  UploadSearchResult,
  UploadStore,
  UploadStoreConfig,
  UploadStoreData,
  Embedding,
  EmbeddingConfig,
  SearchOptions,
  SearchResult,
  StoredChunk,
  VectorStore,
  VectorStoreConfig,
} from "./types.ts";
