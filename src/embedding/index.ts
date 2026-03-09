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
 * import { ragStore, createUploadHandler } from "veryfront/embedding";
 *
 * const store = ragStore({});
 * export const { POST, GET, DELETE } = createUploadHandler(store);
 * ```
 */

export { embedding } from "./embedding.ts";
export { chunk } from "./chunk.ts";
export { cosineSimilarity as similarity } from "ai";
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
