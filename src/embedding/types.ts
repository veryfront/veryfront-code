export interface EmbeddingConfig {
  /**
   * Optional model string in "provider/model" format.
   *
   * When omitted or set to `"auto"`, Veryfront chooses the runtime default:
   * a local embedding model by default, automatically switching to the
   * Veryfront Cloud embedding default when cloud bootstrap is present.
   */
  model?: string;
  documentPrefix?: string; // prepended when embedding documents, e.g. "search_document: "
  queryPrefix?: string; // prepended when embedding queries, e.g. "search_query: "
  batchSize?: number; // max texts per embedMany API call (default 100)
}

export interface Embedding {
  model: string;
  /** Embed a single text. Applies queryPrefix if configured. */
  embed(text: string): Promise<number[]>;
  /** Embed multiple texts. Applies documentPrefix if configured. Batches automatically. */
  embedMany(texts: string[]): Promise<number[][]>;
}

export interface ChunkOptions {
  maxChars?: number; // default 2000 (~512 tokens)
  overlap?: number; // default 200 chars
  separators?: string[]; // default ["\n\n", "\n", " ", ""]
}

export interface VectorStoreConfig {
  embedder: Embedding;
}

export interface SearchOptions {
  topK?: number; // default 5
  threshold?: number; // minimum similarity score (0-1), discard below
  filter?: Record<string, unknown>; // metadata exact-match filter
  strategy?: "dense" | "hybrid" | "mmr"; // default "dense"
  lambda?: number; // MMR diversity param (0 = max diversity, 1 = max relevance, default 0.5)
}

export interface SearchResult {
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface VectorStore {
  add(texts: string[], metadata?: Record<string, unknown>[]): Promise<void>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  clear(): void;
  size: number;
}

// ---------------------------------------------------------------------------
// RAG Store
// ---------------------------------------------------------------------------

export interface RagDocumentMeta {
  id: string;
  title: string;
  source: string;
  type: string;
  createdAt: number;
  url?: string;
}

export interface RagChunk {
  id: string;
  documentId: string;
  text: string;
  embedding: number[]; // [] = not yet embedded
  index: number;
}

export interface RagStoreData {
  documents: RagDocumentMeta[];
  chunks: RagChunk[];
}

export type RagStoreBackend = "auto" | "local-json" | "veryfront-cloud";

export interface RagStoreConfig {
  model?: string;
  backend?: RagStoreBackend;
  branch?: string; // optional branch override for cloud-backed stores
  storagePath?: string; // default "data/index.json"
  contentDir?: string; // optional auto-index dir
  contentExtensions?: string[]; // default [".md", ".mdx", ".txt"]
  chunkOptions?: ChunkOptions;
  documentPrefix?: string;
  queryPrefix?: string;
  batchSize?: number;
}

export interface RagSearchResult {
  text: string;
  score: number;
  documentId: string;
  title: string;
  source: string;
  type: string;
}

export interface RagSearchOptions {
  topK?: number; // default 5
  threshold?: number; // minimum similarity score
}

export interface RagStore {
  ingest(title: string, text: string, meta?: { source?: string; type?: string }): Promise<string>;
  search(query: string, options?: RagSearchOptions): Promise<RagSearchResult[]>;
  listDocuments(): Promise<RagDocumentMeta[]>;
  removeDocument(id: string): Promise<void>;
  indexContentDir(): Promise<void>;
}
