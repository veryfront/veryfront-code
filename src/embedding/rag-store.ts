import {
  isNotFoundError,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  stat,
  writeTextFile,
} from "#veryfront/platform/compat/fs.ts";
import { dirname, extname, join } from "#veryfront/platform/compat/path/basic-operations.ts";
import { serverLogger } from "#veryfront/utils";
import { isVeryfrontCloudEnabled } from "#veryfront/platform/cloud/resolver.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { embedding } from "./embedding.ts";
import { chunk } from "./chunk.ts";
import { createVeryfrontCloudRagStore } from "./veryfront-cloud/rag-store.ts";
import { resolveConfiguredEmbeddingModel } from "./model-resolution.ts";
import type {
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
} from "./types.ts";
import { cosineSimilarity } from "#veryfront/runtime/runtime-bridge.ts";
import { API_ERROR, INVALID_ARGUMENT, VeryfrontError } from "#veryfront/errors";
import { buildContentFileSource } from "./content-source.ts";

// Legacy data shapes used only for migrating old upload-store JSON files.
interface LegacyStoredChunk {
  id: string;
  uploadId: string;
  text: string;
  embedding: number[];
  index: number;
}

interface LegacyUploadStoreData {
  uploads: RagDocumentMeta[];
  chunks: LegacyStoredChunk[];
}
import {
  hasFiniteSquaredNorm,
  MAX_EMBEDDING_DIMENSION,
  MAX_EMBEDDING_INPUT_LENGTH,
  MAX_EMBEDDING_INPUTS,
  MAX_EMBEDDING_TOTAL_LENGTH,
  MAX_IDENTIFIER_LENGTH,
  MAX_PATH_LENGTH,
  MAX_RAG_TEXT_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_TYPE_LENGTH,
  snapshotIngestMetadata,
  snapshotRagStoreConfig,
  snapshotRefreshOptions,
  throwIfAborted,
  validateBoundedString,
  validateRagDocumentId,
  validateRagSearchOptions,
  validateRagText,
  validateRagTitle,
} from "./validation.ts";

type ResolvedRagStoreConfig = RagStoreConfig & { model: string };

/** Default number of top results returned by similarity search. */
const DEFAULT_TOP_K = 5;
const MAX_LOCAL_STORE_BYTES = 128 * 1024 * 1024;
const MAX_LOCAL_DOCUMENTS = 100_000;
const MAX_LOCAL_CHUNKS = 1_000_000;
const MAX_CONTENT_FILES = 10_000;
const MAX_CONTENT_DEPTH = 32;
const MAX_CONTENT_FILE_BYTES = MAX_RAG_TEXT_LENGTH * 4;
const localStoreLocks = new Map<string, Promise<void>>();

function throwLocalRagIoError(detail: string, error: unknown): never {
  if (error instanceof VeryfrontError && error.slug === "invalid-argument") throw error;
  throw API_ERROR.create({ detail });
}

function isNotDirectoryError(error: unknown, seen = new Set<unknown>()): boolean {
  if (seen.has(error)) return false;
  seen.add(error);
  if (typeof error !== "object" || error === null) return false;
  const value = error as { name?: unknown; code?: unknown; cause?: unknown };
  if (value.name === "NotADirectory" || value.code === "ENOTDIR") return true;
  return value.cause === undefined ? false : isNotDirectoryError(value.cause, seen);
}

function withLocalStoreLock<T>(storagePath: string, fn: () => Promise<T>): Promise<T> {
  const previous = localStoreLocks.get(storagePath) ?? Promise.resolve();
  const result = previous.then(fn);
  const tail = result.then(
    () => {},
    () => {},
  );
  localStoreLocks.set(storagePath, tail);
  void tail.then(() => {
    if (localStoreLocks.get(storagePath) === tail) localStoreLocks.delete(storagePath);
  });
  return result;
}

interface StoreFileSignature {
  contentHash: string;
  mtimeMs: number | null;
  size: number;
}

interface StoreDataCache {
  signature: StoreFileSignature;
  data: RagStoreData;
}

type StoreFileMetadata = Omit<StoreFileSignature, "contentHash">;

interface StoreFileSnapshot {
  signature: StoreFileSignature;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length <= MAX_EMBEDDING_DIMENSION &&
    value.every(isFiniteNumber) && hasFiniteSquaredNorm(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRagDocumentMeta(value: unknown): value is RagDocumentMeta {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && value.id.length > 0 &&
    value.id.length <= MAX_IDENTIFIER_LENGTH &&
    typeof value.title === "string" && value.title.length > 0 &&
    value.title.length <= MAX_TITLE_LENGTH &&
    typeof value.source === "string" && value.source.length <= MAX_SOURCE_LENGTH &&
    typeof value.type === "string" && value.type.length <= MAX_TYPE_LENGTH &&
    isNonNegativeInteger(value.createdAt) &&
    (value.url === undefined ||
      (typeof value.url === "string" && value.url.length <= MAX_PATH_LENGTH));
}

function isRagChunk(value: unknown): value is RagChunk {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" &&
    value.id.length > 0 && value.id.length <= MAX_IDENTIFIER_LENGTH &&
    typeof value.documentId === "string" && value.documentId.length > 0 &&
    value.documentId.length <= MAX_IDENTIFIER_LENGTH &&
    typeof value.text === "string" && value.text.length <= MAX_RAG_TEXT_LENGTH &&
    isNumberArray(value.embedding) &&
    isNonNegativeInteger(value.index);
}

function isRagStoreData(value: unknown): value is RagStoreData {
  if (!isRecord(value)) return false;
  if (
    !Array.isArray(value.documents) || value.documents.length > MAX_LOCAL_DOCUMENTS ||
    !value.documents.every(isRagDocumentMeta) ||
    !Array.isArray(value.chunks) || value.chunks.length > MAX_LOCAL_CHUNKS ||
    !value.chunks.every(isRagChunk) ||
    (value.embeddingModel !== undefined &&
      (typeof value.embeddingModel !== "string" ||
        value.embeddingModel.length === 0 ||
        value.embeddingModel.length > MAX_IDENTIFIER_LENGTH)) ||
    (value.embeddingDocumentPrefixHash !== undefined &&
      (typeof value.embeddingDocumentPrefixHash !== "string" ||
        !/^(?:[0-9a-f]{8}|[0-9a-f]{64})$/.test(value.embeddingDocumentPrefixHash)))
  ) {
    return false;
  }

  const documentIds = new Set<string>();
  for (const document of value.documents) {
    if (documentIds.has(document.id)) return false;
    documentIds.add(document.id);
  }
  const chunkIds = new Set<string>();
  const documentIndexes = new Set<string>();
  let embeddingDimension: number | undefined;
  for (const storedChunk of value.chunks) {
    if (!documentIds.has(storedChunk.documentId) || chunkIds.has(storedChunk.id)) return false;
    chunkIds.add(storedChunk.id);
    const indexKey = `${storedChunk.documentId}\u0000${storedChunk.index}`;
    if (documentIndexes.has(indexKey)) return false;
    documentIndexes.add(indexKey);
    if (storedChunk.embedding.length > 0) {
      embeddingDimension ??= storedChunk.embedding.length;
      if (embeddingDimension !== storedChunk.embedding.length) return false;
    }
  }
  return true;
}

function cloneRagStoreData(data: RagStoreData): RagStoreData {
  return {
    documents: data.documents.map((document) => ({ ...document })),
    chunks: data.chunks.map((chunk) => ({
      ...chunk,
      embedding: [...chunk.embedding],
    })),
    embeddingModel: data.embeddingModel,
    embeddingDocumentPrefixHash: data.embeddingDocumentPrefixHash,
  };
}

async function hashStoreText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameStoreFileSignature(
  left: StoreFileSignature,
  right: StoreFileSignature,
): boolean {
  return left.contentHash === right.contentHash &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size;
}

function isLegacyStoredChunk(value: unknown): value is LegacyStoredChunk {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" &&
    typeof value.uploadId === "string" &&
    typeof value.text === "string" &&
    isNumberArray(value.embedding) &&
    isNonNegativeInteger(value.index);
}

/**
 * Creates a persistent RAG store with lazy embedding and similarity search.
 *
 * Combines document ingestion, chunking, embedding, and vector search into
 * a single factory. Documents are chunked on ingest; embeddings are generated
 * lazily on the first search call to avoid blocking uploads on AI API calls.
 *
 * By default, this uses the local JSON store. When Veryfront Cloud bootstrap
 * is present, it automatically upgrades to the cloud-backed store unless
 * explicitly overridden.
 *
 * @example
 * ```ts
 * import { ragStore } from "veryfront/embedding";
 *
 * const store = ragStore({
 *   storagePath: "data/index.json",
 *   contentDir: "content",
 * });
 *
 * await store.ingest("My Doc", text, { source: "upload:file.pdf", type: "pdf" });
 * const results = await store.search("query", { topK: 5, threshold: 0.7 });
 * ```
 */
export function ragStore(config: RagStoreConfig): RagStore {
  const stableConfig = snapshotRagStoreConfig(config);
  normalizeRagStoreBackend(stableConfig.backend);
  const storeCache = new Map<string, RagStore>();

  function getStore(): RagStore {
    const resolvedConfig = resolveRagStoreConfig(stableConfig);
    const backend = resolveRagStoreBackend(stableConfig);
    const cacheKey = JSON.stringify({ backend, config: resolvedConfig });
    const cached = storeCache.get(cacheKey);
    if (cached) return cached;

    const store = backend === "veryfront-cloud"
      ? createVeryfrontCloudRagStore(resolvedConfig)
      : createLocalJsonRagStore(resolvedConfig);
    storeCache.set(cacheKey, store);
    return store;
  }

  return {
    async ingest(title, text, meta) {
      const stableTitle = validateRagTitle(title);
      const stableText = validateRagText(text);
      const stableMeta = snapshotIngestMetadata(meta);
      return await getStore().ingest(stableTitle, stableText, stableMeta);
    },
    async refreshDocument(id, text, meta) {
      const stableId = validateRagDocumentId(id);
      const stableText = validateRagText(text);
      const stableMeta = snapshotRefreshOptions(meta);
      const store = getStore();
      if (!store.refreshDocument) {
        throw INVALID_ARGUMENT.create({ detail: "RAG store does not support document refresh" });
      }
      await store.refreshDocument(stableId, stableText, stableMeta);
    },
    async search(query, options) {
      const stableOptions = validateRagSearchOptions(options);
      const stableQuery = validateBoundedString(
        query,
        "RAG search query",
        MAX_RAG_TEXT_LENGTH,
        { allowEmpty: true },
      );
      if (!stableQuery.trim()) return [];
      throwIfAborted(stableOptions.signal);
      return await getStore().search(stableQuery, stableOptions);
    },
    async listDocuments() {
      return await getStore().listDocuments();
    },
    async removeDocument(id) {
      await getStore().removeDocument(validateRagDocumentId(id));
    },
    async indexContentDir() {
      await getStore().indexContentDir();
    },
  };
}

function resolveRagStoreConfig(config: RagStoreConfig): ResolvedRagStoreConfig {
  return {
    ...config,
    model: resolveConfiguredEmbeddingModel(config.model),
  };
}

function normalizeRagStoreBackend(
  value: string | undefined,
): RagStoreBackend | undefined {
  if (value !== undefined && (typeof value !== "string" || value.length > 32)) {
    throw INVALID_ARGUMENT.create({ detail: "Invalid RAG backend" });
  }
  const normalized = value?.trim().toLowerCase();

  switch (normalized) {
    case undefined:
    case "":
      return undefined;
    case "auto":
      return "auto";
    case "local":
    case "local-json":
      return "local-json";
    case "cloud":
    case "veryfront-cloud":
      return "veryfront-cloud";
    default:
      throw INVALID_ARGUMENT.create({
        detail: 'Invalid RAG backend. Expected "auto", "local-json", or "veryfront-cloud".',
      });
  }
}

function resolveRagStoreBackend(config: RagStoreConfig): Exclude<RagStoreBackend, "auto"> {
  const configured = normalizeRagStoreBackend(config.backend);
  if (configured && configured !== "auto") return configured;

  const envOverride = normalizeRagStoreBackend(getEnv("VERYFRONT_RAG_BACKEND"));
  if (envOverride && envOverride !== "auto") return envOverride;

  return isVeryfrontCloudEnabled() ? "veryfront-cloud" : "local-json";
}

function createLocalJsonRagStore(config: ResolvedRagStoreConfig): RagStore {
  const storagePath = join(config.storagePath ?? "data/index.json");
  const contentDir = config.contentDir ? join(config.contentDir) : undefined;
  const contentExtensions = new Set(config.contentExtensions ?? [".md", ".mdx", ".txt"]);
  const chunkOptions = config.chunkOptions;
  const documentPrefixHashPromise = hashStoreText(config.documentPrefix ?? "");
  let storeDataCache: StoreDataCache | null = null;

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    return withLocalStoreLock(storagePath, fn);
  }

  function createEmbedder() {
    return embedding({
      model: config.model,
      documentPrefix: config.documentPrefix,
      queryPrefix: config.queryPrefix,
      batchSize: config.batchSize,
    });
  }

  function assertStoreCapacity(
    documentCount: number,
    chunkCount: number,
  ): void {
    if (documentCount > MAX_LOCAL_DOCUMENTS || chunkCount > MAX_LOCAL_CHUNKS) {
      throw INVALID_ARGUMENT.create({ detail: "RAG store capacity exceeded" });
    }
  }

  function isLegacyUploadStoreData(value: unknown): value is LegacyUploadStoreData {
    if (!value || typeof value !== "object") return false;
    const data = value as { uploads?: unknown; chunks?: unknown };
    return Array.isArray(data.uploads) && data.uploads.length <= MAX_LOCAL_DOCUMENTS &&
      data.uploads.every(isRagDocumentMeta) &&
      Array.isArray(data.chunks) && data.chunks.length <= MAX_LOCAL_CHUNKS &&
      data.chunks.every(isLegacyStoredChunk);
  }

  function migrateLegacyUploadStoreData(data: LegacyUploadStoreData): RagStoreData {
    return {
      documents: data.uploads.map((upload) => ({ ...upload })),
      chunks: data.chunks.map((chunk: LegacyStoredChunk) => ({
        id: chunk.id,
        documentId: chunk.uploadId,
        text: chunk.text,
        embedding: chunk.embedding,
        index: chunk.index,
      })),
    };
  }

  async function getStoreFileMetadata(): Promise<StoreFileMetadata | null> {
    try {
      const info = await stat(storagePath);
      return {
        mtimeMs: info.mtime?.getTime() ?? null,
        size: info.size,
      };
    } catch (err) {
      if (isNotFoundError(err) && !isNotDirectoryError(err)) return null;
      throwLocalRagIoError("Local RAG store data could not be read", err);
    }
  }

  async function readStoreFileSnapshot(): Promise<StoreFileSnapshot | null> {
    const metadata = await getStoreFileMetadata();
    if (metadata === null) return null;
    if (metadata.size > MAX_LOCAL_STORE_BYTES) {
      throw INVALID_ARGUMENT.create({ detail: "RAG store file exceeds the supported size" });
    }

    let text: string;
    try {
      text = await readTextFile(storagePath);
    } catch (error) {
      throwLocalRagIoError("Local RAG store data could not be read", error);
    }
    return {
      signature: {
        ...metadata,
        contentHash: await hashStoreText(text),
      },
      text,
    };
  }

  async function updateStoreDataCache(data: RagStoreData, payload: string): Promise<void> {
    const metadata = await getStoreFileMetadata();
    storeDataCache = metadata === null ? null : {
      signature: {
        ...metadata,
        contentHash: await hashStoreText(payload),
      },
      data: cloneRagStoreData(data),
    };
  }

  async function load(): Promise<RagStoreData> {
    let snapshot: StoreFileSnapshot | null;
    try {
      snapshot = await readStoreFileSnapshot();
    } catch (error) {
      if (isNotFoundError(error)) {
        storeDataCache = null;
        return { documents: [], chunks: [] };
      }
      throw error;
    }
    if (snapshot === null) {
      storeDataCache = null;
      return { documents: [], chunks: [] };
    }

    if (
      storeDataCache !== null &&
      sameStoreFileSignature(storeDataCache.signature, snapshot.signature)
    ) {
      return cloneRagStoreData(storeDataCache.data);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(snapshot.text);
    } catch {
      throw INVALID_ARGUMENT.create({ detail: "RAG store data is invalid JSON" });
    }
    if (isLegacyUploadStoreData(parsed)) {
      const migrated = migrateLegacyUploadStoreData(parsed);
      if (!isRagStoreData(migrated)) {
        throw INVALID_ARGUMENT.create({ detail: "RAG store data is invalid" });
      }
      storeDataCache = {
        signature: snapshot.signature,
        data: cloneRagStoreData(migrated),
      };
      return cloneRagStoreData(migrated);
    }
    if (!isRagStoreData(parsed)) {
      throw INVALID_ARGUMENT.create({ detail: "RAG store data is invalid" });
    }
    storeDataCache = { signature: snapshot.signature, data: cloneRagStoreData(parsed) };
    return cloneRagStoreData(parsed);
  }

  async function save(data: RagStoreData): Promise<void> {
    if (!isRagStoreData(data)) {
      throw INVALID_ARGUMENT.create({ detail: "RAG store data exceeds supported limits" });
    }
    const dir = dirname(storagePath);
    const payload = JSON.stringify(data);
    if (new TextEncoder().encode(payload).byteLength > MAX_LOCAL_STORE_BYTES) {
      throw INVALID_ARGUMENT.create({ detail: "RAG store file exceeds the supported size" });
    }
    const tmpPath = `${storagePath}.tmp-${crypto.randomUUID()}`;
    try {
      if (dir && dir !== ".") {
        await mkdir(dir, { recursive: true });
      }
      await writeTextFile(tmpPath, payload);
      await rename(tmpPath, storagePath);
    } catch (error) {
      await remove(tmpPath).catch(() => undefined);
      throwLocalRagIoError("Local RAG store data could not be written", error);
    }
    await updateStoreDataCache(data, payload);
  }

  async function ensureEmbeddings(
    data: RagStoreData,
    embedder: ReturnType<typeof createEmbedder>,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const documentPrefixHash = await documentPrefixHashPromise;
    let changed = false;
    if (
      data.embeddingModel !== config.model ||
      data.embeddingDocumentPrefixHash !== documentPrefixHash
    ) {
      for (const storedChunk of data.chunks) {
        if (storedChunk.embedding.length > 0) {
          storedChunk.embedding = [];
          changed = true;
        }
      }
    }
    const unembedded = data.chunks.filter((c) => c.embedding.length === 0);
    if (unembedded.length === 0) return changed;

    const prefixLength = config.documentPrefix?.length ?? 0;
    let batch: RagChunk[] = [];
    let batchLength = 0;
    const embedBatch = async () => {
      if (batch.length === 0) return;
      throwIfAborted(signal);
      const embeddings = await embedder.embedMany(
        batch.map((storedChunk) => storedChunk.text),
        { signal },
      );
      for (let index = 0; index < batch.length; index++) {
        batch[index]!.embedding = embeddings[index]!;
      }
      batch = [];
      batchLength = 0;
    };

    for (const storedChunk of unembedded) {
      const inputLength = storedChunk.text.length + prefixLength;
      if (inputLength > MAX_EMBEDDING_INPUT_LENGTH) {
        throw INVALID_ARGUMENT.create({
          detail: "RAG chunk exceeds the embedding input limit",
        });
      }
      if (
        batch.length >= MAX_EMBEDDING_INPUTS ||
        batchLength + inputLength > MAX_EMBEDDING_TOTAL_LENGTH
      ) {
        await embedBatch();
      }
      batch.push(storedChunk);
      batchLength += inputLength;
    }
    await embedBatch();
    data.embeddingModel = config.model;
    data.embeddingDocumentPrefixHash = documentPrefixHash;
    return true;
  }

  async function listContentFiles(dir: string, depth = 0): Promise<string[]> {
    if (depth > MAX_CONTENT_DEPTH) {
      throw INVALID_ARGUMENT.create({ detail: "RAG content directory nesting is too deep" });
    }
    const files: string[] = [];
    try {
      if (depth === 0) {
        const info = await stat(dir);
        if (!info.isDirectory) {
          throw API_ERROR.create({ detail: "RAG content files could not be read" });
        }
      }
      for await (const entry of readDir(dir)) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory) {
          files.push(...(await listContentFiles(fullPath, depth + 1)));
        } else if (entry.isFile && contentExtensions.has(extname(entry.name).toLowerCase())) {
          files.push(fullPath);
        }
        if (files.length > MAX_CONTENT_FILES) {
          throw INVALID_ARGUMENT.create({
            detail: `RAG content indexing supports at most ${MAX_CONTENT_FILES} files`,
          });
        }
      }
    } catch (error) {
      if (isNotFoundError(error) && !isNotDirectoryError(error)) return [];
      throwLocalRagIoError("RAG content files could not be read", error);
    }
    return files;
  }

  return {
    async ingest(
      title: string,
      text: string,
      meta?: RagIngestMetadata,
    ): Promise<string> {
      return withLock(async () => {
        const data = await load();
        const documentId = crypto.randomUUID();

        const chunks = await chunk(text, chunkOptions);
        if (chunks.length === 0) {
          throw INVALID_ARGUMENT.create({ detail: "Upload contains no extractable text" });
        }
        assertStoreCapacity(
          data.documents.length + 1,
          data.chunks.length + chunks.length,
        );

        const doc: RagDocumentMeta = {
          id: documentId,
          title,
          source: meta?.source ?? "",
          type: meta?.type ?? "",
          createdAt: Date.now(),
        };

        const chunkRecords: RagChunk[] = chunks.map((chunkText, i) => ({
          id: crypto.randomUUID(),
          documentId,
          text: chunkText,
          embedding: [], // filled lazily on first search
          index: i,
        }));

        data.documents.push(doc);
        data.chunks.push(...chunkRecords);
        await save(data);

        return documentId;
      });
    },

    async refreshDocument(
      id: string,
      text: string,
      meta?: RagRefreshOptions,
    ): Promise<void> {
      return withLock(async () => {
        const data = await load();
        const document = data.documents.find((doc) => doc.id === id);
        if (!document) {
          throw INVALID_ARGUMENT.create({ detail: "RAG document was not found" });
        }

        const chunks = await chunk(text, chunkOptions);
        if (chunks.length === 0) {
          throw INVALID_ARGUMENT.create({ detail: "Upload contains no extractable text" });
        }

        document.title = meta?.title ?? document.title;
        document.source = meta?.source ?? document.source;
        document.type = meta?.type ?? document.type;
        const retainedChunks = data.chunks.filter((chunk) => chunk.documentId !== id);
        assertStoreCapacity(data.documents.length, retainedChunks.length + chunks.length);
        data.chunks = retainedChunks;
        data.chunks.push(
          ...chunks.map((chunkText, index) => ({
            id: crypto.randomUUID(),
            documentId: id,
            text: chunkText,
            embedding: [],
            index,
          })),
        );
        await save(data);
      });
    },

    async search(
      query: string,
      options?: RagSearchOptions,
    ): Promise<RagSearchResult[]> {
      if (!query.trim()) return [];
      return withLock(async () => {
        throwIfAborted(options?.signal);
        const data = await load();
        if (data.chunks.length === 0) return [];

        const embedder = createEmbedder();
        const updated = await ensureEmbeddings(data, embedder, options?.signal);
        if (updated) await save(data);

        const queryEmbedding = await embedder.embed(query, { signal: options?.signal });
        const topK = options?.topK ?? DEFAULT_TOP_K;
        const threshold = options?.threshold;

        const docMap = new Map(data.documents.map((d) => [d.id, d]));

        const scored = data.chunks.map((c) => {
          const doc = docMap.get(c.documentId);
          if (!doc) {
            throw INVALID_ARGUMENT.create({ detail: "RAG store data is invalid" });
          }
          return {
            text: c.text,
            score: cosineSimilarity(queryEmbedding, c.embedding),
            documentId: c.documentId,
            title: doc.title,
            source: doc.source,
            type: doc.type,
          };
        });

        scored.sort((a, b) => b.score - a.score);

        let results = scored.slice(0, topK);
        if (threshold !== undefined) {
          results = results.filter((r) => r.score >= threshold);
        }
        return results;
      });
    },

    async listDocuments(): Promise<RagDocumentMeta[]> {
      return withLock(async () => {
        const data = await load();
        return data.documents;
      });
    },

    async removeDocument(id: string): Promise<void> {
      return withLock(async () => {
        const data = await load();
        const documentCount = data.documents.length;
        data.documents = data.documents.filter((d) => d.id !== id);
        data.chunks = data.chunks.filter((c) => c.documentId !== id);
        if (data.documents.length === documentCount) return;
        await save(data);
      });
    },

    async indexContentDir(): Promise<void> {
      if (!contentDir) return;

      return withLock(async () => {
        const data = await load();
        const indexedSources = new Set(data.documents.map((d) => d.source));
        const files = await listContentFiles(contentDir);
        const fileEntries = files.map((file) => {
          return { file, ...buildContentFileSource(contentDir, file) };
        });
        const newFiles = fileEntries.filter(({ file, source }) =>
          !indexedSources.has(source) && !indexedSources.has(file)
        );
        if (newFiles.length === 0) return;

        for (const { file, relativeSource, source } of newFiles) {
          let info;
          let content: string;
          try {
            info = await stat(file);
            if (info.size <= MAX_CONTENT_FILE_BYTES) {
              content = await readTextFile(file);
            } else {
              content = "";
            }
          } catch (error) {
            throwLocalRagIoError("RAG content files could not be read", error);
          }
          if (info.size > MAX_CONTENT_FILE_BYTES) {
            serverLogger.warn(
              "[rag-store] Skipping an oversized content file",
            );
            continue;
          }
          if (!content?.trim()) continue;
          if (content.length > MAX_RAG_TEXT_LENGTH) {
            serverLogger.warn(
              "[rag-store] Skipping an oversized content file",
            );
            continue;
          }

          const title = relativeSource.replace(/\.[^.]+$/, "");
          const documentId = crypto.randomUUID();
          const type = extname(file).slice(1);
          validateRagTitle(title);
          validateBoundedString(source, "RAG document source", MAX_SOURCE_LENGTH, {
            allowEmpty: true,
          });

          const chunks = await chunk(content, chunkOptions);
          if (chunks.length === 0) continue;
          assertStoreCapacity(
            data.documents.length + 1,
            data.chunks.length + chunks.length,
          );

          data.documents.push({
            id: documentId,
            title,
            source,
            type,
            createdAt: Date.now(),
          });

          data.chunks.push(
            ...chunks.map((chunkText, i) => ({
              id: crypto.randomUUID(),
              documentId,
              text: chunkText,
              embedding: [],
              index: i,
            })),
          );
        }

        await save(data);
      });
    },
  };
}
