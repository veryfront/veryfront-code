/**
 * Embedding — RAG primitives for document chunking, embedding, and similarity search.
 *
 * Provides a facade over AI SDK (embeddings, similarity) and LangChain
 * (text splitting) behind veryfront's own API.
 *
 * @module embedding
 *
 * @example
 * ```ts
 * import { documentStore, createDocumentHandler } from "veryfront/embedding";
 *
 * const store = documentStore({ model: "openai/text-embedding-3-small" });
 * export const { POST, GET, DELETE } = createDocumentHandler(store);
 * ```
 */

export { embedding } from "./embedding.ts";
export { chunk } from "./chunk.ts";
export { cosineSimilarity as similarity } from "ai";
export { vectorStore } from "./vector-store.ts";
export { documentStore } from "./document-store.ts";
export { createDocumentHandler } from "./document-handler.ts";
export { loadDocument } from "./document-loader.ts";
export { useDocuments } from "./react/use-documents.ts";
export type { UseDocumentsOptions, UseDocumentsResult } from "./react/use-documents.ts";
export {
  clearEmbeddingProviders,
  registerEmbeddingProvider,
  resolveEmbeddingModel,
} from "./resolve.ts";
export type {
  ChunkOptions,
  DocumentMeta,
  DocumentSearchOptions,
  DocumentSearchResult,
  DocumentStore,
  DocumentStoreConfig,
  DocumentStoreData,
  Embedding,
  EmbeddingConfig,
  SearchOptions,
  SearchResult,
  StoredChunk,
  VectorStore,
  VectorStoreConfig,
} from "./types.ts";
