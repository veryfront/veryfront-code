import {
  createFileSystem,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/platform/compat/fs.ts";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";
import {
  basename,
  dirname,
  extname,
  join,
} from "#veryfront/platform/compat/path/basic-operations.ts";
import { resolve } from "#veryfront/platform/compat/path/resolution.ts";
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
  RagRefreshOptions,
  RagSearchOptions,
  RagSearchResult,
  RagStore,
  RagStoreBackend,
  RagStoreConfig,
  RagStoreData,
} from "./types.ts";
import { cosineSimilarity } from "#veryfront/runtime/runtime-bridge.ts";
import { type LocalJsonStoreLease, withLocalJsonStoreLock } from "./local-json-store-lock.ts";

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
  INVALID_ARGUMENT,
  isVeryfrontError,
  RAG_STORE_CORRUPT,
  RAG_STORE_UNAVAILABLE,
} from "#veryfront/errors";

type ResolvedRagStoreConfig = RagStoreConfig & { model: string };

/** Default number of top results returned by similarity search. */
const DEFAULT_TOP_K = 5;
const MAX_STORED_DOCUMENTS = 100_000;
const MAX_STORED_CHUNKS = 1_000_000;
const MAX_STORED_EMBEDDING_VALUES = 16_384;
const MAX_STORED_BYTES = 64 * 1024 * 1024;
const MAX_ORPHANED_STORE_TEMPS = 1_024;
const MAX_EMBEDDING_PERSIST_ATTEMPTS = 2;
const STORE_TEMP_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StoreDataCache {
  sourceBytes: Uint8Array;
  data: RagStoreData;
}

interface LoadedStoreData {
  data: RagStoreData;
  sourceBytes: Uint8Array | null;
}

interface StoreFileSnapshot {
  bytes: Uint8Array;
  text: string;
}

class InvalidStoreEncodingError extends Error {
  override readonly name = "InvalidStoreEncodingError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length <= MAX_STORED_EMBEDDING_VALUES &&
    value.every(isFiniteNumber);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isRagDocumentMeta(value: unknown): value is RagDocumentMeta {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.source === "string" &&
    typeof value.type === "string" &&
    isFiniteNumber(value.createdAt) &&
    (value.url === undefined || typeof value.url === "string");
}

function isRagChunk(value: unknown): value is RagChunk {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" &&
    typeof value.documentId === "string" &&
    typeof value.text === "string" &&
    isNumberArray(value.embedding) &&
    isNonNegativeInteger(value.index);
}

function isRagStoreData(value: unknown): value is RagStoreData {
  if (!isRecord(value)) return false;
  if (
    !Array.isArray(value.documents) || value.documents.length > MAX_STORED_DOCUMENTS ||
    !Array.isArray(value.chunks) || value.chunks.length > MAX_STORED_CHUNKS
  ) {
    return false;
  }

  const documentIds = new Set<string>();
  for (const document of value.documents) {
    if (!isRagDocumentMeta(document) || document.id.length === 0 || documentIds.has(document.id)) {
      return false;
    }
    documentIds.add(document.id);
  }

  const chunkIds = new Set<string>();
  const indexesByDocument = new Map<string, Set<number>>();
  for (const chunk of value.chunks) {
    if (
      !isRagChunk(chunk) || chunk.id.length === 0 || chunk.documentId.length === 0 ||
      chunkIds.has(chunk.id) || !documentIds.has(chunk.documentId)
    ) {
      return false;
    }
    chunkIds.add(chunk.id);
    const indexes = indexesByDocument.get(chunk.documentId) ?? new Set<number>();
    if (indexes.has(chunk.index)) return false;
    indexes.add(chunk.index);
    indexesByDocument.set(chunk.documentId, indexes);
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
  };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
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
  const storeCache = new Map<string, RagStore>();

  function getStore(): RagStore {
    const resolvedConfig = resolveRagStoreConfig(config);
    const backend = resolveRagStoreBackend(config);
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
    ingest(title, text, meta) {
      return getStore().ingest(title, text, meta);
    },
    refreshDocument(id, text, meta) {
      const store = getStore();
      if (!store.refreshDocument) {
        throw INVALID_ARGUMENT.create({ detail: "RAG store does not support document refresh" });
      }
      return store.refreshDocument(id, text, meta);
    },
    search(query, options) {
      return getStore().search(query, options);
    },
    listDocuments() {
      return getStore().listDocuments();
    },
    removeDocument(id) {
      return getStore().removeDocument(id);
    },
    indexContentDir() {
      return getStore().indexContentDir();
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
        detail:
          `Invalid RAG backend "${value}". Expected "auto", "local-json", or "veryfront-cloud".`,
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
  const storagePath = resolve(config.storagePath ?? "data/index.json");
  const persistenceFs = createFileSystem();
  const contentDir = config.contentDir;
  const contentExtensions = new Set(config.contentExtensions ?? [".md", ".mdx", ".txt"]);
  const chunkOptions = config.chunkOptions;
  let storeDataCache: StoreDataCache | null = null;

  const MAX_TEXT_LENGTH = 5 * 1024 * 1024; // 5 MB text limit per document

  function withLock<T>(fn: (lease: LocalJsonStoreLease) => Promise<T>): Promise<T> {
    return withLocalJsonStoreLock(storagePath, async (lease) => {
      await validateStoragePath();
      await cleanupOrphanedTempFiles();
      return await fn(lease);
    }).catch((error) => {
      if (isVeryfrontError(error)) throw error;
      throw unavailableStoreError(error);
    });
  }

  async function validateStoragePath(): Promise<void> {
    const lstat = persistenceFs.lstat?.bind(persistenceFs);
    if (!lstat) {
      throw RAG_STORE_UNAVAILABLE.create({
        detail: "The filesystem cannot safely inspect the configured RAG store path.",
        context: { storagePath },
      });
    }
    try {
      const info = await lstat(storagePath);
      if (!info.isFile || info.isSymlink) {
        throw RAG_STORE_UNAVAILABLE.create({
          detail: "The configured RAG store path must be a regular file or be absent.",
          context: { storagePath },
        });
      }
    } catch (error) {
      if (isCanonicalNotFoundError(error)) return;
      if (isVeryfrontError(error)) throw error;
      throw unavailableStoreError(error);
    }
  }

  async function cleanupOrphanedTempFiles(): Promise<void> {
    const storageDirectory = dirname(storagePath);
    const storageName = basename(storagePath);
    const uniqueTempPrefix = `${storageName}.tmp.`;
    let matchingTemps = 0;
    try {
      for await (const entry of readDir(storageDirectory)) {
        const isLegacyTemp = entry.name === `${storageName}.tmp`;
        const token = entry.name.startsWith(uniqueTempPrefix)
          ? entry.name.slice(uniqueTempPrefix.length)
          : null;
        if (!isLegacyTemp && (token === null || !STORE_TEMP_TOKEN_PATTERN.test(token))) continue;
        matchingTemps++;
        if (matchingTemps > MAX_ORPHANED_STORE_TEMPS) {
          throw RAG_STORE_UNAVAILABLE.create({
            detail: "Too many orphaned RAG store temporary files require cleanup.",
            context: { storagePath },
          });
        }
        if (!entry.isFile || entry.isSymlink) {
          throw RAG_STORE_UNAVAILABLE.create({
            detail: "A RAG store temporary path is not a regular file.",
            context: { storagePath },
          });
        }
        try {
          await remove(join(storageDirectory, entry.name));
        } catch (error) {
          if (!isCanonicalNotFoundError(error)) throw unavailableStoreError(error);
        }
      }
    } catch (error) {
      if (isCanonicalNotFoundError(error)) return;
      if (isVeryfrontError(error)) throw error;
      throw unavailableStoreError(error);
    }
  }

  function createEmbedder() {
    return embedding({
      model: config.model,
      documentPrefix: config.documentPrefix,
      queryPrefix: config.queryPrefix,
      batchSize: config.batchSize,
    });
  }

  function isLegacyUploadStoreData(value: unknown): value is LegacyUploadStoreData {
    if (!value || typeof value !== "object") return false;
    const data = value as { uploads?: unknown; chunks?: unknown };
    return Array.isArray(data.uploads) && data.uploads.length <= MAX_STORED_DOCUMENTS &&
      data.uploads.every(isRagDocumentMeta) &&
      Array.isArray(data.chunks) && data.chunks.length <= MAX_STORED_CHUNKS &&
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

  async function readStoreFileSnapshot(): Promise<StoreFileSnapshot | null> {
    const readSnapshot = persistenceFs.readFileSnapshotWithinLimit?.bind(persistenceFs);
    if (!readSnapshot) {
      throw new Error("The native filesystem cannot safely read the RAG store");
    }
    let bytes: Uint8Array;
    try {
      bytes = await readSnapshot(storagePath, dirname(storagePath), MAX_STORED_BYTES);
    } catch (error) {
      if (isCanonicalNotFoundError(error)) return null;
      throw error;
    }
    try {
      return { bytes, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    } catch (cause) {
      throw new InvalidStoreEncodingError("RAG store is not valid UTF-8", { cause });
    }
  }

  function updateStoreDataCache(data: RagStoreData, payloadBytes: Uint8Array): void {
    try {
      storeDataCache = {
        sourceBytes: payloadBytes,
        data: cloneRagStoreData(data),
      };
    } catch (error) {
      storeDataCache = null;
      serverLogger.warn("[rag-store] Persisted the store but could not refresh its cache", error);
    }
  }

  function corruptStoreError(detail: string, cause?: unknown): Error {
    return RAG_STORE_CORRUPT.create({
      detail: `RAG store file is corrupt (${detail}). ` +
        "It was preserved as-is and no data was overwritten.",
      cause,
      context: { storagePath },
    });
  }

  function unavailableStoreError(cause: unknown): Error {
    return RAG_STORE_UNAVAILABLE.create({
      detail: "RAG store operation could not be completed safely. Check storage and retry.",
      cause,
      context: { storagePath },
    });
  }

  async function load(): Promise<LoadedStoreData> {
    let snapshot: StoreFileSnapshot | null;
    try {
      snapshot = await readStoreFileSnapshot();
    } catch (err) {
      storeDataCache = null;
      if (err instanceof RangeError) throw corruptStoreError("file exceeds size limit", err);
      if (err instanceof InvalidStoreEncodingError) {
        throw corruptStoreError("file is not valid UTF-8", err);
      }
      throw unavailableStoreError(err);
    }

    if (snapshot === null) {
      storeDataCache = null;
      return { data: { documents: [], chunks: [] }, sourceBytes: null };
    }

    if (
      storeDataCache !== null &&
      sameBytes(storeDataCache.sourceBytes, snapshot.bytes)
    ) {
      return {
        data: cloneRagStoreData(storeDataCache.data),
        sourceBytes: snapshot.bytes,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(snapshot.text);
    } catch (cause) {
      storeDataCache = null;
      throw corruptStoreError("malformed JSON", cause);
    }

    if (isLegacyUploadStoreData(parsed)) {
      const migrated = migrateLegacyUploadStoreData(parsed);
      if (!isRagStoreData(migrated)) {
        storeDataCache = null;
        throw corruptStoreError("legacy document or chunk relationships failed validation");
      }
      storeDataCache = {
        sourceBytes: snapshot.bytes,
        data: cloneRagStoreData(migrated),
      };
      return { data: cloneRagStoreData(migrated), sourceBytes: snapshot.bytes };
    }
    if (!isRagStoreData(parsed)) {
      storeDataCache = null;
      throw corruptStoreError("document or chunk entries failed validation");
    }
    storeDataCache = {
      sourceBytes: snapshot.bytes,
      data: cloneRagStoreData(parsed),
    };
    return { data: cloneRagStoreData(parsed), sourceBytes: snapshot.bytes };
  }

  async function save(
    data: RagStoreData,
    expectedSourceBytes: Uint8Array | null,
    lease: LocalJsonStoreLease,
  ): Promise<void> {
    if (!isRagStoreData(data)) {
      throw RAG_STORE_UNAVAILABLE.create({
        detail: "The RAG store update violated persisted-data limits or relationships.",
        context: { storagePath },
      });
    }
    const dir = dirname(storagePath);
    if (dir && dir !== ".") {
      await mkdir(dir, { recursive: true });
    }
    const payload = JSON.stringify(data);
    const payloadBytes = new TextEncoder().encode(payload);
    if (payloadBytes.byteLength > MAX_STORED_BYTES) {
      throw RAG_STORE_UNAVAILABLE.create({
        detail: "The RAG store update exceeds the persisted byte limit.",
        context: { storagePath },
      });
    }
    const tmpPath = lease.temporaryPath;
    try {
      await writeTextFile(tmpPath, payload);
      await lease.assertOwned();

      let currentSnapshot: StoreFileSnapshot | null;
      try {
        currentSnapshot = await readStoreFileSnapshot();
      } catch (error) {
        throw unavailableStoreError(error);
      }
      if (
        expectedSourceBytes === null
          ? currentSnapshot !== null
          : currentSnapshot === null || !sameBytes(expectedSourceBytes, currentSnapshot.bytes)
      ) {
        throw RAG_STORE_UNAVAILABLE.create({
          detail:
            "RAG store file changed while an update was in progress. No data was overwritten.",
          context: { storagePath },
        });
      }

      await lease.assertOwned();
      const rename = persistenceFs.rename?.bind(persistenceFs);
      if (!rename) {
        throw RAG_STORE_UNAVAILABLE.create({
          detail: "The filesystem cannot atomically replace the RAG store file.",
          context: { storagePath },
        });
      }
      await rename(tmpPath, storagePath);
    } catch (error) {
      try {
        await remove(tmpPath);
      } catch (cleanupError) {
        if (!isCanonicalNotFoundError(cleanupError)) {
          serverLogger.warn("[rag-store] Failed to clean up temporary store file", cleanupError);
        }
      }
      if (isVeryfrontError(error)) throw error;
      throw unavailableStoreError(error);
    }
    updateStoreDataCache(data, payloadBytes);
  }

  async function ensureEmbeddings(data: RagStoreData): Promise<boolean> {
    const unembedded = data.chunks.filter((c) => c.embedding.length === 0);
    if (unembedded.length === 0) return false;

    const embedder = createEmbedder();
    const embeddings = await embedder.embedMany(unembedded.map((c) => c.text));
    for (let i = 0; i < unembedded.length; i++) {
      unembedded[i]!.embedding = embeddings[i]!;
    }
    return true;
  }

  function sameStoreSource(
    expected: Uint8Array | null,
    actual: Uint8Array | null,
  ): boolean {
    if (expected === null) return actual === null;
    return actual !== null && sameBytes(expected, actual);
  }

  async function loadSearchDataWithEmbeddings(): Promise<RagStoreData | null> {
    let loaded = await withLock(async () => await load());
    for (let attempt = 0; attempt < MAX_EMBEDDING_PERSIST_ATTEMPTS; attempt++) {
      if (loaded.data.chunks.length === 0) return null;

      const updated = await ensureEmbeddings(loaded.data);
      if (!updated) return loaded.data;

      const embeddedData = loaded.data;
      const persisted = await withLock(async (lease) => {
        const current = await load();
        if (!sameStoreSource(loaded.sourceBytes, current.sourceBytes)) {
          return { saved: false as const, loaded: current };
        }
        await save(embeddedData, loaded.sourceBytes, lease);
        return { saved: true as const, data: embeddedData };
      });

      if (persisted.saved) return persisted.data;
      loaded = persisted.loaded;
    }
    throw RAG_STORE_UNAVAILABLE.create({
      detail: "The RAG store changed repeatedly while embeddings were persisted.",
      context: { storagePath },
    });
  }

  async function listContentFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    try {
      for await (const entry of readDir(dir)) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory) {
          files.push(...(await listContentFiles(fullPath)));
        } else if (entry.isFile && contentExtensions.has(extname(entry.name))) {
          files.push(fullPath);
        }
      }
    } catch (_) {
      // expected: directory may not exist yet
    }
    return files;
  }

  return {
    async ingest(
      title: string,
      text: string,
      meta?: { source?: string; type?: string },
    ): Promise<string> {
      return withLock(async (lease) => {
        const loaded = await load();
        const data = loaded.data;
        const documentId = crypto.randomUUID();

        if (text.length > MAX_TEXT_LENGTH) {
          throw INVALID_ARGUMENT.create({
            detail: `Upload text exceeds ${MAX_TEXT_LENGTH / 1024 / 1024} MB limit`,
          });
        }

        const chunks = await chunk(text, chunkOptions);
        if (chunks.length === 0) {
          throw INVALID_ARGUMENT.create({ detail: "Upload contains no extractable text" });
        }

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
        await save(data, loaded.sourceBytes, lease);

        return documentId;
      });
    },

    async refreshDocument(
      id: string,
      text: string,
      meta?: RagRefreshOptions,
    ): Promise<void> {
      return withLock(async (lease) => {
        const loaded = await load();
        const data = loaded.data;
        const document = data.documents.find((doc) => doc.id === id);
        if (!document) {
          throw INVALID_ARGUMENT.create({ detail: `RAG document not found: ${id}` });
        }

        if (text.length > MAX_TEXT_LENGTH) {
          throw INVALID_ARGUMENT.create({
            detail: `Upload text exceeds ${MAX_TEXT_LENGTH / 1024 / 1024} MB limit`,
          });
        }

        const chunks = await chunk(text, chunkOptions);
        if (chunks.length === 0) {
          throw INVALID_ARGUMENT.create({ detail: "Upload contains no extractable text" });
        }

        document.title = meta?.title ?? document.title;
        document.source = meta?.source ?? document.source;
        document.type = meta?.type ?? document.type;
        data.chunks = data.chunks.filter((chunk) => chunk.documentId !== id);
        data.chunks.push(
          ...chunks.map((chunkText, index) => ({
            id: crypto.randomUUID(),
            documentId: id,
            text: chunkText,
            embedding: [] as number[],
            index,
          })),
        );
        await save(data, loaded.sourceBytes, lease);
      });
    },

    async search(
      query: string,
      options?: RagSearchOptions,
    ): Promise<RagSearchResult[]> {
      if (!query.trim()) return [];
      const data = await loadSearchDataWithEmbeddings();
      if (data === null) return [];
      const embedder = createEmbedder();
      const queryEmbedding = await embedder.embed(query);
      const topK = options?.topK ?? DEFAULT_TOP_K;
      const threshold = options?.threshold;

      const docMap = new Map(data.documents.map((d) => [d.id, d]));

      const scored = data.chunks.map((c) => {
        const doc = docMap.get(c.documentId);
        return {
          text: c.text,
          score: cosineSimilarity(queryEmbedding, c.embedding),
          documentId: c.documentId,
          title: doc?.title ?? "Unknown",
          source: doc?.source ?? "",
          type: doc?.type ?? "",
        };
      });

      scored.sort((a, b) => b.score - a.score);

      let results = scored.slice(0, topK);
      if (threshold !== undefined) {
        results = results.filter((r) => r.score >= threshold);
      }
      return results;
    },

    async listDocuments(): Promise<RagDocumentMeta[]> {
      return withLock(async () => {
        const { data } = await load();
        return data.documents;
      });
    },

    async removeDocument(id: string): Promise<void> {
      return withLock(async (lease) => {
        const loaded = await load();
        const data = loaded.data;
        data.documents = data.documents.filter((d) => d.id !== id);
        data.chunks = data.chunks.filter((c) => c.documentId !== id);
        await save(data, loaded.sourceBytes, lease);
      });
    },

    async indexContentDir(): Promise<void> {
      if (!contentDir) return;

      return withLock(async (lease) => {
        const loaded = await load();
        const data = loaded.data;
        const indexedSources = new Set(data.documents.map((d) => d.source));

        const files = await listContentFiles(contentDir);
        const newFiles = files.filter((f) => !indexedSources.has(f));
        if (newFiles.length === 0) return;

        for (const file of newFiles) {
          const content = await readTextFile(file);
          if (!content?.trim()) continue;
          if (content.length > MAX_TEXT_LENGTH) {
            serverLogger.warn(
              `[rag-store] Skipping ${file}: exceeds ${
                MAX_TEXT_LENGTH / 1024 / 1024
              } MB text limit`,
            );
            continue;
          }

          const title = file.startsWith(contentDir + "/")
            ? file.slice(contentDir.length + 1).replace(/\.[^.]+$/, "")
            : file.replace(/\.[^.]+$/, "");
          const documentId = crypto.randomUUID();
          const type = extname(file).slice(1);

          const chunks = await chunk(content, chunkOptions);
          if (chunks.length === 0) continue;

          data.documents.push({
            id: documentId,
            title,
            source: file,
            type,
            createdAt: Date.now(),
          });

          data.chunks.push(
            ...chunks.map((chunkText, i) => ({
              id: crypto.randomUUID(),
              documentId,
              text: chunkText,
              embedding: [] as number[],
              index: i,
            })),
          );
        }

        await save(data, loaded.sourceBytes, lease);
      });
    },
  };
}
