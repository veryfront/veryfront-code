# NLSpec: src/embedding/

## Purpose

RAG (Retrieval-Augmented Generation) primitives for chunking text, generating embeddings, and performing similarity search. The module provides two tiers: a low-level composable API (`embedding`, `chunk`, `vectorStore`) for custom pipelines, and a high-level managed API (`uploadStore`, `createUploadHandler`, `useUploads`) that bundles file ingestion, persistent JSON storage, lazy embedding, and HTTP route handlers into a turnkey RAG solution. Provider resolution supports OpenAI, Google, and local embedding models via a registry pattern with automatic env-based initialization.

## Public API

### Exports

| Export | Type | Description |
|--------|------|-------------|
| `embedding` | `(config: EmbeddingConfig) => Embedding` | Factory that creates an embed/embedMany facade over AI SDK, with prefix support and automatic batching |
| `chunk` | `(text: string, options?: ChunkOptions) => Promise<string[]>` | Recursive character text splitter with configurable size, overlap, and separators |
| `similarity` | Re-export of `cosineSimilarity` from `ai` | Cosine similarity between two vectors |
| `vectorStore` | `(config: VectorStoreConfig) => VectorStore` | In-memory vector store with dense, MMR, and hybrid (BM25+RRF) search strategies |
| `uploadStore` | `(config: UploadStoreConfig) => UploadStore` | Persistent JSON-file-backed store with chunking, lazy embedding, mutex-serialized operations |
| `createUploadHandler` | `(store: UploadStore, config?) => { POST, GET, DELETE }` | HTTP route handler factory for multipart upload, listing, and deletion |
| `loadUpload` | `(buffer: ArrayBuffer, mimeType: string) => Promise<string>` | Text extraction from various formats (plain text, CSV, PDF, DOCX, etc. via kreuzberg) |
| `useUploads` | `(options: UseUploadsOptions) => UseUploadsResult` | React hook for client-side upload lifecycle (upload, delete, list, refresh) |
| `resolveEmbeddingModel` | `(modelString: string) => EmbeddingModel` | Resolves `"provider/model"` string to AI SDK EmbeddingModel instance |
| `registerEmbeddingProvider` | `(name: string, factory: EmbeddingProviderFactory) => void` | Registers a custom embedding provider factory |
| `clearEmbeddingProviders` | `() => void` | Clears all providers and resets auto-initialization (for testing) |
| Type exports | `ChunkOptions`, `Embedding`, `EmbeddingConfig`, `SearchOptions`, `SearchResult`, `StoredChunk`, `UploadMeta`, `UploadSearchOptions`, `UploadSearchResult`, `UploadStore`, `UploadStoreConfig`, `UploadStoreData`, `VectorStore`, `VectorStoreConfig`, `UseUploadsOptions`, `UseUploadsResult` | All public type definitions |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `embed`, `embedMany`, `cosineSimilarity` | `ai` (Vercel AI SDK) | Core embedding generation and similarity computation |
| `createOpenAI` | `@ai-sdk/openai` | OpenAI provider for embedding models |
| `createGoogleGenerativeAI` | `@ai-sdk/google` | Google provider for embedding models |
| `createError`, `toError` | `#veryfront/errors/veryfront-error.ts` | Structured error creation |
| `getOpenAIEnvConfig`, `getGoogleGenAIEnvConfig` | `#veryfront/config/env.ts` | Read API keys from environment |
| `createLocalEmbeddingModel` | `#veryfront/provider/local/local-embedding-adapter.ts` | Local/offline embedding support |
| `importKreuzberg` | `#veryfront/platform/compat/opaque-deps.ts` | Document text extraction (PDF, DOCX, etc.) |
| `isNotFoundError`, `mkdir`, `readDir`, `readTextFile`, `writeTextFile` | `#veryfront/platform/compat/fs.ts` | Platform-agnostic filesystem operations |
| `dirname`, `extname`, `join` | `#veryfront/platform/compat/path/basic-operations.ts` | Path manipulation |
| `react` (useState, useCallback, useEffect, useRef) | `react` | React hook primitives |

## Behaviors

### Behavior 1: Text Chunking
- **Given**: A text string and optional `ChunkOptions` (maxChars, overlap, separators)
- **When**: `chunk(text, options)` is called
- **Then**: Returns an array of overlapping text chunks, each at most `maxChars` long (default 2000), using recursive character splitting with separators tried in order (paragraphs, lines, words, characters)
- **Edge cases**: Text shorter than maxChars returns a single-element array; empty separator fallback splits by individual characters

### Behavior 2: Embedding Generation
- **Given**: An `EmbeddingConfig` with model string and optional prefixes/batchSize
- **When**: `embedding(config)` is called
- **Then**: Returns an `Embedding` object where `embed()` prepends `queryPrefix` and `embedMany()` prepends `documentPrefix`, with automatic batching for inputs exceeding `batchSize` (default 100)
- **Edge cases**: Empty array to `embedMany()` returns `[]` immediately without API call

### Behavior 3: Provider Resolution
- **Given**: A `"provider/model"` string (e.g., `"openai/text-embedding-3-small"`)
- **When**: `resolveEmbeddingModel(modelString)` is called
- **Then**: Auto-initializes built-in providers (openai, google, local) from env vars on first call, parses the string, and returns an `EmbeddingModel` from the matching provider factory
- **Edge cases**: Missing slash throws config error; unknown provider throws with list of available providers; missing API key throws on model creation (lazy)

### Behavior 4: Vector Store Dense Search
- **Given**: A `VectorStore` with entries added via `add()`
- **When**: `search(query, { strategy: "dense" })` is called
- **Then**: Embeds the query, computes cosine similarity against all entries (filtered by metadata if `filter` provided), returns top-K results sorted by descending score, filtered by `threshold` if set
- **Edge cases**: Empty store returns `[]`; no matching metadata filter returns `[]`

### Behavior 5: Vector Store MMR Search
- **Given**: A `VectorStore` with entries
- **When**: `search(query, { strategy: "mmr", lambda })` is called
- **Then**: Uses Maximum Marginal Relevance to iteratively select documents balancing relevance (lambda) vs diversity (1-lambda), returns results with original relevance scores (not MMR scores)
- **Edge cases**: Lambda=1 behaves like pure dense search; lambda=0 maximizes diversity

### Behavior 6: Vector Store Hybrid Search
- **Given**: A `VectorStore` with entries
- **When**: `search(query, { strategy: "hybrid" })` is called
- **Then**: Computes both dense (cosine) and sparse (BM25) rankings, fuses them via Reciprocal Rank Fusion (k=60), returns top-K by fused score
- **Edge cases**: Empty query terms give all-zero BM25 scores, falling back to dense ranking

### Behavior 7: Upload Store Ingest
- **Given**: An `UploadStore` instance
- **When**: `ingest(title, text, meta)` is called
- **Then**: Generates a UUID, chunks the text, stores upload metadata and chunk records (with empty embeddings) to the JSON file, returns the upload ID
- **Edge cases**: Text exceeding 5 MB throws; empty chunks after splitting throws; concurrent ingests are serialized by mutex

### Behavior 8: Upload Store Lazy Embedding
- **Given**: An `UploadStore` with unembedded chunks
- **When**: `search(query)` is called for the first time after ingest
- **Then**: Detects chunks with empty embedding arrays, calls `embedMany` to fill them, persists the updated data, then performs cosine similarity search
- **Edge cases**: If all chunks are already embedded, no embedding API call is made

### Behavior 9: Upload Store Persistence
- **Given**: An `UploadStore` with a configured `storagePath`
- **When**: Data is modified (ingest, remove, search with lazy embed)
- **Then**: Writes to a `.tmp` file first, then atomically renames to the target path; creates parent directories if needed
- **Edge cases**: If rename fails, falls back to direct write; corrupted JSON on load resets to empty state; missing file on load returns empty state

### Behavior 10: Upload Store Content Directory Indexing
- **Given**: An `UploadStore` with `contentDir` configured
- **When**: `indexContentDir()` is called
- **Then**: Recursively scans the directory for files matching `contentExtensions` (default: .md, .mdx, .txt), skips already-indexed files (by source path), ingests new files
- **Edge cases**: Non-existent directory is silently ignored; files exceeding 5 MB are skipped with a warning; empty files are skipped

### Behavior 11: Upload Handler HTTP Routes
- **Given**: An `UploadStore` and optional config
- **When**: `createUploadHandler(store, config)` is called
- **Then**: Returns `{ POST, GET, DELETE }` route handlers: POST accepts multipart `file` field, validates size/type, extracts text via `loadUpload`, ingests; GET lists uploads; DELETE removes by ID from route params
- **Edge cases**: Missing file returns 400; oversized file returns 400; unsupported type returns 400; empty extracted text returns 400; path components in filename are sanitized; filename truncated to 200 chars

### Behavior 12: Upload Text Extraction
- **Given**: An `ArrayBuffer` and MIME type
- **When**: `loadUpload(buffer, mimeType)` is called
- **Then**: Plain text/markdown returns decoded text directly; CSV is converted to RAG-optimized format (headers denormalized into each row); all other formats delegate to kreuzberg
- **Edge cases**: CSV with fewer than 2 lines returns raw text; RFC 4180 quoted fields with escaped double-quotes are handled correctly

### Behavior 13: useUploads React Hook
- **Given**: An `api` endpoint URL
- **When**: `useUploads({ api })` is called in a React component
- **Then**: Fetches upload list on mount, provides `upload(file)` (multipart POST with abort support), `remove(id)` (DELETE), and `refresh()` functions; tracks `uploading` and `error` state
- **Edge cases**: Aborted uploads do not set error state; errors are cleared on next action

## Constraints

- Do NOT change public API signatures
- Do NOT modify files outside `src/embedding/`
- Must pass: `deno fmt --check src/embedding/` and `deno lint src/embedding/` and `deno test --no-check --allow-all src/embedding/`

## Error Handling

- **Provider resolution**: Throws structured `VeryFrontError` (type: "config") for invalid model strings, missing providers, or missing API keys
- **Upload store ingest**: Throws plain `Error` for text exceeding 5 MB or empty chunks
- **Upload handler POST**: Catches all errors, returns JSON `{ error }` with appropriate HTTP status (400 for validation, 500 for unexpected)
- **Upload handler GET/DELETE**: Catches errors, logs to console, returns 500
- **Upload store load**: Logs warnings for corrupted data or unexpected read errors; returns empty state rather than throwing
- **useUploads hook**: Sets `error` string state; never throws to the component

## Side Effects

- **File I/O**: `uploadStore` reads/writes a JSON file at `storagePath` (default `data/index.json`) and optionally reads from `contentDir`
- **Network**: `embedding.embed()` and `embedding.embedMany()` call external AI provider APIs
- **Console**: `upload-store.ts` logs warnings on corrupted/missing data; `upload-handler.ts` logs errors on GET/DELETE failures
- **Global state**: `resolve.ts` maintains a module-level `providers` Map and `autoInitialized` flag

## Performance Constraints

- **Batching**: `embedMany` batches API calls in chunks of `batchSize` (default 100) to stay within provider rate limits
- **Lazy embedding**: Upload store defers embedding generation until first search, avoiding blocking ingestion on slow API calls
- **Mutex serialization**: All upload store mutations are serialized through a promise chain to prevent concurrent file overwrites
- **BM25 tokenization**: Simple whitespace/punctuation split; no stemming or stop-word removal (adequate for small-to-medium corpora)
- **In-memory vector store**: Linear scan for search; suitable for up to ~10K entries, not designed for large-scale production use

## Invariants

- Every `StoredChunk.embedding` is either `[]` (not yet embedded) or a valid float array of model-determined dimensionality
- Upload IDs and chunk IDs are always valid UUIDs (via `crypto.randomUUID()`)
- The `providers` Map is auto-initialized exactly once per process (guarded by `autoInitialized` flag)
- All upload store file operations go through the mutex; no concurrent reads/writes to the storage file
- Chunk overlap is always less than chunk size (enforced by the recursive splitter structure)
- The atomic write pattern (tmp + rename) ensures the storage file is never partially written
