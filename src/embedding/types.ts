/** Configuration used by {@link embedding}. */
export interface EmbeddingConfig {
  /**
   * Model identifier in `provider/model` format.
   *
   * When omitted or set to `"auto"`, Veryfront chooses the runtime default.
   */
  model?: string;
  /** Prefix prepended to document inputs passed to `embedMany`. */
  documentPrefix?: string;
  /** Prefix prepended to query inputs passed to `embed`. */
  queryPrefix?: string;
  /** Maximum values sent in one provider call. Defaults to 100. */
  batchSize?: number;
}

/** Options shared by individual embedding operations. */
export interface EmbeddingCallOptions {
  /** Signal used to cancel provider work. */
  signal?: AbortSignal;
}

/** Embeds query and document text with one configured model. */
export interface Embedding {
  /** Resolved model identifier. */
  model: string;
  /** Embed one query string. */
  embed(text: string, options?: EmbeddingCallOptions): Promise<number[]>;
  /** Embed document strings in bounded provider batches. */
  embedMany(texts: string[], options?: EmbeddingCallOptions): Promise<number[][]>;
}

/** Options accepted by {@link chunk}. */
export interface ChunkOptions {
  /** Maximum characters in one chunk. Defaults to 2,000. */
  maxChars?: number;
  /** Characters repeated between consecutive chunks. Defaults to 200. */
  overlap?: number;
  /** Ordered separators from coarsest to finest. */
  separators?: string[];
}

/** Configuration used by {@link vectorStore}. */
export interface VectorStoreConfig {
  /** Embedder used for stored text and search queries. */
  embedder: Embedding;
  /** Maximum entries retained in memory. Defaults to 10,000. */
  maxEntries?: number;
}

/** Options accepted by vector-store search. */
export interface SearchOptions {
  /** Maximum results to return. Defaults to 5. */
  topK?: number;
  /** Minimum result score. */
  threshold?: number;
  /** Exact top-level metadata fields required on a result. */
  filter?: Record<string, unknown>;
  /** Ranking strategy. Defaults to `"dense"`. */
  strategy?: "dense" | "hybrid" | "mmr";
  /** MMR relevance weight from 0 to 1. Defaults to 0.5. */
  lambda?: number;
  /** Signal used to cancel query embedding. */
  signal?: AbortSignal;
}

/** Result returned from vector-store search. */
export interface SearchResult {
  /** Stored text. */
  text: string;
  /** Ranking score produced by the selected strategy. */
  score: number;
  /** Snapshotted metadata associated with the stored text. */
  metadata?: Record<string, unknown>;
}

/** In-memory vector store contract. */
export interface VectorStore {
  /** Embed and atomically add text entries. */
  add(
    texts: string[],
    metadata?: Record<string, unknown>[],
    options?: EmbeddingCallOptions,
  ): Promise<void>;
  /** Search stored entries. */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  /** Remove every stored entry. */
  clear(): void;
  /** Current number of stored entries. */
  size: number;
}

/** Metadata describing one RAG document. */
export interface RagDocumentMeta {
  /** Stable document identifier. */
  id: string;
  /** Display title. */
  title: string;
  /** Source identifier, path, or upload label. */
  source: string;
  /** Document format identifier. */
  type: string;
  /** Creation time in Unix milliseconds. */
  createdAt: number;
  /** Optional signed source URL. */
  url?: string;
}

/** One searchable chunk belonging to a RAG document. */
export interface RagChunk {
  /** Stable chunk identifier. */
  id: string;
  /** Identifier of the owning document. */
  documentId: string;
  /** Chunk text. */
  text: string;
  /** Embedding vector, or an empty array until lazy embedding completes. */
  embedding: number[];
  /** Zero-based position within the document. */
  index: number;
}

/** Serialized local RAG-store data. */
export interface RagStoreData {
  /** Stored document metadata. */
  documents: RagDocumentMeta[];
  /** Stored searchable chunks. */
  chunks: RagChunk[];
  /** Model used for persisted embeddings, when embeddings have been generated. */
  embeddingModel?: string;
  /** Fingerprint of the document prefix used for persisted embeddings. */
  embeddingDocumentPrefixHash?: string;
}

/** Supported RAG persistence backends. */
export type RagStoreBackend = "auto" | "local-json" | "veryfront-cloud";

/** Configuration used by {@link ragStore}. */
export interface RagStoreConfig {
  /** Embedding model in `provider/model` format. */
  model?: string;
  /** Persistence backend. Defaults to automatic selection. */
  backend?: RagStoreBackend;
  /** Branch override for a cloud-backed store. */
  branch?: string;
  /** Local JSON storage path. Defaults to `data/index.json`. */
  storagePath?: string;
  /** Optional directory indexed by `indexContentDir`. */
  contentDir?: string;
  /** File extensions accepted from `contentDir`. */
  contentExtensions?: string[];
  /** Text chunking policy. */
  chunkOptions?: ChunkOptions;
  /** Prefix prepended to document chunks before embedding. */
  documentPrefix?: string;
  /** Prefix prepended to search queries before embedding. */
  queryPrefix?: string;
  /** Maximum values sent in one embedding-provider call. */
  batchSize?: number;
}

/** Result returned from RAG search. */
export interface RagSearchResult {
  /** Matching chunk text. */
  text: string;
  /** Similarity score. */
  score: number;
  /** Owning document identifier. */
  documentId: string;
  /** Owning document title. */
  title: string;
  /** Owning document source. */
  source: string;
  /** Owning document format. */
  type: string;
}

/** Options accepted by RAG search. */
export interface RagSearchOptions {
  /** Maximum results to return. Defaults to 5. */
  topK?: number;
  /** Minimum cosine-similarity score. Defaults to 0. */
  threshold?: number;
  /** Signal used to cancel embedding and cloud-search work. */
  signal?: AbortSignal;
}

/** Metadata changes accepted when refreshing an existing RAG document. */
export interface RagRefreshOptions {
  /** Replacement title. */
  title?: string;
  /** Replacement source. */
  source?: string;
  /** Replacement document format. */
  type?: string;
}

/** Metadata accepted when ingesting a RAG document. */
export interface RagIngestMetadata {
  /** Source identifier, path, or upload label. */
  source?: string;
  /** Document format identifier. */
  type?: string;
}

/** Persistent RAG-store contract. */
export interface RagStore {
  /** Chunk and persist a document, returning its identifier. */
  ingest(title: string, text: string, meta?: RagIngestMetadata): Promise<string>;
  /** Replace the content of an existing document when supported. */
  refreshDocument?(id: string, text: string, meta?: RagRefreshOptions): Promise<void>;
  /** Search persisted chunks. */
  search(query: string, options?: RagSearchOptions): Promise<RagSearchResult[]>;
  /** List persisted documents. */
  listDocuments(): Promise<RagDocumentMeta[]>;
  /** Remove one document and its chunks. */
  removeDocument(id: string): Promise<void>;
  /** Index configured files that are not already represented by source. */
  indexContentDir(): Promise<void>;
}
