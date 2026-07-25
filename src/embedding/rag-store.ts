import {
  isNotFoundError,
  mkdir,
  readDir,
  readTextFile,
  remove,
  stat,
  writeTextFile,
} from "#veryfront/platform/compat/fs.ts";
import { dirname, extname, join } from "#veryfront/platform/compat/path/basic-operations.ts";
import { resolve } from "#veryfront/platform/compat/path/resolution.ts";
import { serverLogger } from "#veryfront/utils";
import { isVeryfrontCloudEnabled } from "#veryfront/platform/cloud/resolver.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { INVALID_ARGUMENT, PERMISSION_DENIED, SERVICE_OVERLOADED } from "#veryfront/errors";
import { embedding } from "./embedding.ts";
import { chunk } from "./chunk.ts";
import {
  computeContentIndexFingerprint,
  CONTENT_INDEX_MANAGED_BY,
  contentTitle,
  normalizeContentRoot,
} from "./content-index.ts";
import { createVeryfrontCloudRagStore } from "./veryfront-cloud/rag-store.ts";
import { resolveConfiguredEmbeddingModel } from "./model-resolution.ts";
import { waitWithAbort } from "./admission.ts";
import {
  MAX_EMBEDDING_DIMENSION,
  MAX_RAG_DOCUMENT_TEXT_BYTES,
  requirePositiveSafeInteger,
  requireUnitInterval,
  validateEmbeddingBatch,
  validateEmbeddingVector,
  validateRagDocumentMetadata,
  validateRagRemoveOptions,
} from "./validation.ts";
import type {
  RagChunk,
  RagDocumentMeta,
  RagEmbeddingFingerprint,
  RagIngestMeta,
  RagOperationOptions,
  RagRefreshOptions,
  RagRemoveOptions,
  RagSearchOptions,
  RagSearchResult,
  RagStore,
  RagStoreBackend,
  RagStoreConfig,
  RagStoreData,
  RagStoredDocumentMeta,
} from "./types.ts";
import { cosineSimilarity } from "#veryfront/runtime/runtime-bridge.ts";

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

type ResolvedRagStoreConfig = RagStoreConfig & { model: string };

/** Default number of top results returned by similarity search. */
const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 10_000;
const DEFAULT_MAX_STORAGE_BYTES = 64 * 1024 * 1024;
const MAX_CONTENT_FILES = 10_000;
const MAX_LOCAL_STORE_WAITERS = 256;
const RAG_STORE_SCHEMA_VERSION = 1;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

interface LocalStoreLockState {
  pending: number;
  tail: Promise<void>;
}

const localStoreLocks = new Map<string, LocalStoreLockState>();

class RagStoreDataError extends Error {
  override readonly name = "RagStoreDataError";

  constructor(
    readonly storagePath: string,
    detail: string,
    cause?: unknown,
  ) {
    super(
      `RAG store data at "${storagePath}" is invalid: ${detail}`,
      cause === undefined ? undefined : { cause },
    );
  }
}

interface StoreFileSignature {
  changeTimeMs: number | null;
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
  return Array.isArray(value) && value.every(isFiniteNumber);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRagDocumentMeta(value: unknown): value is RagStoredDocumentMeta {
  if (!isRecord(value)) return false;
  const hasContentIndexMetadata = value.contentIndexFingerprint !== undefined ||
    value.contentRoot !== undefined ||
    value.managedBy !== undefined;
  const validContentIndexMetadata = !hasContentIndexMetadata ||
    (typeof value.contentIndexFingerprint === "string" &&
      SHA256_HEX_PATTERN.test(value.contentIndexFingerprint) &&
      typeof value.contentRoot === "string" &&
      value.contentRoot.length > 0 &&
      value.contentRoot.length <= 4_096 &&
      value.managedBy === CONTENT_INDEX_MANAGED_BY);

  return validContentIndexMetadata &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.title === "string" &&
    typeof value.source === "string" &&
    typeof value.type === "string" &&
    isNonNegativeInteger(value.createdAt) &&
    (value.size === undefined || isNonNegativeInteger(value.size)) &&
    (value.mediaType === undefined ||
      (typeof value.mediaType === "string" &&
        value.mediaType.length > 0 &&
        value.mediaType.length <= 256)) &&
    (value.url === undefined || typeof value.url === "string");
}

function isRagChunk(value: unknown): value is RagChunk {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.documentId === "string" &&
    value.documentId.length > 0 &&
    typeof value.text === "string" &&
    value.text.trim().length > 0 &&
    isNumberArray(value.embedding) &&
    isNonNegativeInteger(value.index);
}

function isRagEmbeddingFingerprint(value: unknown): value is RagEmbeddingFingerprint {
  return isRecord(value) &&
    typeof value.model === "string" &&
    value.model.trim().length > 0 &&
    typeof value.documentPrefix === "string" &&
    Number.isSafeInteger(value.dimension) &&
    Number(value.dimension) > 0 &&
    Number(value.dimension) <= MAX_EMBEDDING_DIMENSION;
}

function isRagStoreData(value: unknown): value is RagStoreData {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== undefined &&
    value.schemaVersion !== RAG_STORE_SCHEMA_VERSION
  ) {
    return false;
  }
  if (
    value.embeddingFingerprint !== undefined &&
    !isRagEmbeddingFingerprint(value.embeddingFingerprint)
  ) {
    return false;
  }
  if (
    !Array.isArray(value.documents) ||
    !value.documents.every(isRagDocumentMeta) ||
    !Array.isArray(value.chunks) ||
    !value.chunks.every(isRagChunk)
  ) {
    return false;
  }

  const documentIds = new Set<string>();
  for (const document of value.documents) {
    if (documentIds.has(document.id)) return false;
    documentIds.add(document.id);
  }

  const chunkIds = new Set<string>();
  const documentChunkIndexes = new Set<string>();
  const expectedDimension = value.embeddingFingerprint?.dimension;
  for (const storedChunk of value.chunks) {
    if (
      chunkIds.has(storedChunk.id) ||
      !documentIds.has(storedChunk.documentId)
    ) {
      return false;
    }
    chunkIds.add(storedChunk.id);

    const indexKey = `${storedChunk.documentId}\u0000${storedChunk.index}`;
    if (documentChunkIndexes.has(indexKey)) return false;
    documentChunkIndexes.add(indexKey);

    if (storedChunk.embedding.length === 0) continue;
    try {
      validateEmbeddingVector(
        storedChunk.embedding,
        "persisted RAG embedding",
        expectedDimension,
      );
    } catch {
      return false;
    }
  }
  return true;
}

function cloneRagStoreData(data: RagStoreData): RagStoreData {
  return {
    schemaVersion: data.schemaVersion,
    embeddingFingerprint: data.embeddingFingerprint ? { ...data.embeddingFingerprint } : undefined,
    documents: data.documents.map((document) => ({ ...document })),
    chunks: data.chunks.map((chunk) => ({
      ...chunk,
      embedding: [...chunk.embedding],
    })),
  };
}

function createEmptyRagStoreData(): RagStoreData {
  return {
    schemaVersion: RAG_STORE_SCHEMA_VERSION,
    documents: [],
    chunks: [],
  };
}

function encodeUtf8(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}

async function hashStoreBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes),
  );
  let encoded = "";
  for (const byte of digest) {
    encoded += byte.toString(16).padStart(2, "0");
  }
  return encoded;
}

function withLocalStoreLock<T>(
  storagePath: string,
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const key = resolve(storagePath);
  let state = localStoreLocks.get(key);
  if (!state) {
    state = { pending: 0, tail: Promise.resolve() };
    localStoreLocks.set(key, state);
  }
  if (state.pending >= MAX_LOCAL_STORE_WAITERS + 1) {
    return Promise.reject(
      SERVICE_OVERLOADED.create({
        detail:
          `RAG store queue for "${storagePath}" is full (${MAX_LOCAL_STORE_WAITERS} waiting operations)`,
      }),
    );
  }

  state.pending++;
  const predecessor = state.tail;
  const gate = Promise.withResolvers<void>();
  state.tail = predecessor.then(() => gate.promise);

  return waitWithAbort(predecessor, signal)
    .then(() => {
      signal?.throwIfAborted();
      return operation();
    })
    .finally(() => {
      gate.resolve();
      state!.pending--;
      if (state!.pending !== 0) return;

      const finalTail = state!.tail;
      void finalTail.then(() => {
        if (
          state!.pending === 0 &&
          state!.tail === finalTail &&
          localStoreLocks.get(key) === state
        ) {
          localStoreLocks.delete(key);
        }
      });
    });
}

function sameStoreFileSignature(
  left: StoreFileSignature,
  right: StoreFileSignature,
): boolean {
  return left.contentHash === right.contentHash &&
    left.changeTimeMs === right.changeTimeMs &&
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
    ingest(title, text, meta, options) {
      return getStore().ingest(title, text, meta, options);
    },
    refreshDocument(id, text, meta, options) {
      const store = getStore();
      if (!store.refreshDocument) {
        throw INVALID_ARGUMENT.create({ detail: "RAG store does not support document refresh" });
      }
      return store.refreshDocument(id, text, meta, options);
    },
    search(query, options) {
      return getStore().search(query, options);
    },
    listDocuments(options) {
      return getStore().listDocuments(options);
    },
    removeDocument(id, options) {
      return getStore().removeDocument(id, options);
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
  const storagePath = config.storagePath ?? "data/index.json";
  const maxStorageBytes = requirePositiveSafeInteger(
    config.maxStorageBytes ?? DEFAULT_MAX_STORAGE_BYTES,
    "ragStore maxStorageBytes",
  );
  const contentDir = config.contentDir;
  const contentExtensions = new Set(config.contentExtensions ?? [".md", ".mdx", ".txt"]);
  const chunkOptions = config.chunkOptions;
  let storeDataCache: StoreDataCache | null = null;

  function withLock<T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return withLocalStoreLock(storagePath, operation, signal);
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
    return Array.isArray(data.uploads) &&
      data.uploads.every(isRagDocumentMeta) &&
      Array.isArray(data.chunks) &&
      data.chunks.every(isLegacyStoredChunk);
  }

  function migrateLegacyUploadStoreData(data: LegacyUploadStoreData): RagStoreData {
    return {
      schemaVersion: RAG_STORE_SCHEMA_VERSION,
      documents: data.uploads.map((upload) => ({ ...upload })),
      chunks: data.chunks.map((chunk: LegacyStoredChunk) => ({
        id: chunk.id,
        documentId: chunk.uploadId,
        text: chunk.text,
        embedding: [...chunk.embedding],
        index: chunk.index,
      })),
    };
  }

  async function getStoreFileMetadata(): Promise<StoreFileMetadata | null> {
    try {
      if (typeof Deno !== "undefined") {
        const info = await Deno.stat(storagePath);
        const changeTime = (info as { ctime?: Date | null }).ctime;
        return {
          changeTimeMs: changeTime?.getTime() ?? null,
          mtimeMs: info.mtime?.getTime() ?? null,
          size: info.size,
        };
      }

      const info = await stat(storagePath);
      let changeTimeMs: number | null = null;
      try {
        const nodeFs = await import("node:fs/promises");
        const nodeInfo = await nodeFs.stat(storagePath);
        changeTimeMs = nodeInfo.ctime.getTime();
      } catch {
        // expected: not every runtime exposes a file change time
      }

      return {
        changeTimeMs,
        mtimeMs: info.mtime?.getTime() ?? null,
        size: info.size,
      };
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  function assertStoreSize(size: number): void {
    if (size > maxStorageBytes) {
      throw new RangeError(
        `RAG store file "${storagePath}" is ${size} bytes, exceeding maxStorageBytes ${maxStorageBytes}`,
      );
    }
  }

  async function readStoreFileSnapshot(): Promise<StoreFileSnapshot | null> {
    const metadata = await getStoreFileMetadata();
    if (metadata === null) return null;
    assertStoreSize(metadata.size);

    let text: string;
    try {
      text = await readTextFile(storagePath);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
    const bytes = encodeUtf8(text);
    assertStoreSize(bytes.byteLength);
    return {
      signature: {
        ...metadata,
        contentHash: await hashStoreBytes(bytes),
      },
      text,
    };
  }

  async function updateStoreDataCache(
    data: RagStoreData,
    contentHash: string,
  ): Promise<void> {
    const metadata = await getStoreFileMetadata();
    storeDataCache = metadata === null ? null : {
      signature: {
        ...metadata,
        contentHash,
      },
      data: cloneRagStoreData(data),
    };
  }

  async function load(): Promise<RagStoreData> {
    const snapshot = await readStoreFileSnapshot();
    if (snapshot === null) {
      storeDataCache = null;
      return createEmptyRagStoreData();
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
    } catch (cause) {
      storeDataCache = null;
      throw new RagStoreDataError(storagePath, "malformed JSON", cause);
    }

    let data: RagStoreData;
    if (isLegacyUploadStoreData(parsed)) {
      data = migrateLegacyUploadStoreData(parsed);
      if (!isRagStoreData(data)) {
        storeDataCache = null;
        throw new RagStoreDataError(
          storagePath,
          "legacy document or chunk relationships are inconsistent",
        );
      }
    } else if (isRagStoreData(parsed)) {
      data = parsed;
    } else {
      storeDataCache = null;
      throw new RagStoreDataError(
        storagePath,
        "document, chunk, fingerprint, or schema fields failed validation",
      );
    }

    storeDataCache = {
      signature: snapshot.signature,
      data: cloneRagStoreData(data),
    };
    return cloneRagStoreData(data);
  }

  async function save(data: RagStoreData): Promise<void> {
    data.schemaVersion = RAG_STORE_SCHEMA_VERSION;
    if (!isRagStoreData(data)) {
      throw new RagStoreDataError(
        storagePath,
        "refusing to persist invalid in-memory data",
      );
    }

    const payload = JSON.stringify(data);
    const payloadBytes = encodeUtf8(payload);
    assertStoreSize(payloadBytes.byteLength);
    const contentHash = await hashStoreBytes(payloadBytes);

    const dir = dirname(storagePath);
    if (dir && dir !== ".") {
      await mkdir(dir, { recursive: true });
    }

    // Keep the temporary file in the destination directory so rename remains
    // an atomic same-filesystem replacement. A unique name prevents independent
    // store instances from overwriting one another's in-flight payload.
    const tmpPath = `${storagePath}.tmp.${crypto.randomUUID()}`;
    try {
      await writeTextFile(tmpPath, payload);
      if (typeof Deno !== "undefined") {
        await Deno.rename(tmpPath, storagePath);
      } else {
        const fs = await import("node:fs/promises");
        await fs.rename(tmpPath, storagePath);
      }
    } catch (error) {
      try {
        await remove(tmpPath);
      } catch (cleanupError) {
        if (!isNotFoundError(cleanupError)) {
          serverLogger.warn("[rag-store] Failed to remove incomplete temp file", {
            tmpPath,
            cleanupError,
          });
        }
      }
      throw error;
    }
    await updateStoreDataCache(data, contentHash);
  }

  async function ensureEmbeddings(
    data: RagStoreData,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (data.chunks.length === 0) return false;

    const expectedModel = config.model;
    const expectedDocumentPrefix = config.documentPrefix ?? "";
    const fingerprint = data.embeddingFingerprint;
    const fingerprintChanged = fingerprint === undefined ||
      fingerprint.model !== expectedModel ||
      fingerprint.documentPrefix !== expectedDocumentPrefix;
    const pendingChunks = fingerprintChanged
      ? data.chunks
      : data.chunks.filter((storedChunk) => storedChunk.embedding.length === 0);
    if (pendingChunks.length === 0) return false;

    const embedder = createEmbedder();
    const embeddings = await embedder.embedMany(
      pendingChunks.map((storedChunk) => storedChunk.text),
      { abortSignal: signal },
    );
    const validated = validateEmbeddingBatch(
      embeddings,
      pendingChunks.length,
      "RAG document embedding result",
      fingerprintChanged ? undefined : fingerprint.dimension,
    );

    // Do not mutate the loaded snapshot until the complete provider response
    // has passed cardinality, dimension, and finiteness validation.
    for (let index = 0; index < pendingChunks.length; index++) {
      pendingChunks[index]!.embedding = [...validated.vectors[index]!];
    }
    data.embeddingFingerprint = {
      model: expectedModel,
      documentPrefix: expectedDocumentPrefix,
      dimension: validated.dimension!,
    };
    data.schemaVersion = RAG_STORE_SCHEMA_VERSION;
    return true;
  }

  async function listContentFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const pendingDirectories = [dir];

    while (pendingDirectories.length > 0) {
      const directory = pendingDirectories.pop()!;
      try {
        for await (const entry of readDir(directory)) {
          const fullPath = join(directory, entry.name);
          if (entry.isDirectory) {
            pendingDirectories.push(fullPath);
          } else if (entry.isFile && contentExtensions.has(extname(entry.name))) {
            files.push(fullPath);
            if (files.length > MAX_CONTENT_FILES) {
              throw INVALID_ARGUMENT.create({
                detail: `RAG content directory exceeds ${MAX_CONTENT_FILES} supported files`,
              });
            }
          }
        }
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
    }

    files.sort();
    return files;
  }

  function encodeDocumentText(text: string): Uint8Array<ArrayBuffer> {
    if (typeof text !== "string" || !text.trim()) {
      throw INVALID_ARGUMENT.create({
        detail: "Upload contains no extractable text",
      });
    }
    if (text.length > MAX_RAG_DOCUMENT_TEXT_BYTES) {
      throw INVALID_ARGUMENT.create({
        detail: `Upload text exceeds the ${MAX_RAG_DOCUMENT_TEXT_BYTES}-byte limit`,
      });
    }
    const textBytes = encodeUtf8(text);
    if (textBytes.byteLength > MAX_RAG_DOCUMENT_TEXT_BYTES) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Upload text is ${textBytes.byteLength} bytes, exceeding the ${MAX_RAG_DOCUMENT_TEXT_BYTES}-byte limit`,
      });
    }
    return textBytes;
  }

  async function createChunkTexts(text: string): Promise<string[]> {
    encodeDocumentText(text);
    const chunks = (await chunk(text, chunkOptions)).filter((value) => value.trim().length > 0);
    if (chunks.length === 0) {
      throw INVALID_ARGUMENT.create({ detail: "Upload contains no extractable text" });
    }
    return chunks;
  }

  function normalizeSearchOptions(options?: RagSearchOptions): {
    abortSignal?: AbortSignal;
    threshold?: number;
    topK: number;
  } {
    return {
      abortSignal: options?.abortSignal,
      threshold: options?.threshold === undefined
        ? undefined
        : requireUnitInterval(options.threshold, "ragStore search threshold"),
      topK: requirePositiveSafeInteger(
        options?.topK ?? DEFAULT_TOP_K,
        "ragStore search topK",
        MAX_TOP_K,
      ),
    };
  }

  return {
    async ingest(
      title: string,
      text: string,
      meta?: RagIngestMeta,
      options?: RagOperationOptions,
    ): Promise<string> {
      options?.abortSignal?.throwIfAborted();
      try {
        validateRagDocumentMetadata({ title }, "ragStore ingest document");
        validateRagDocumentMetadata(meta, "ragStore ingest metadata");
      } catch (error) {
        throw INVALID_ARGUMENT.create({
          detail: error instanceof Error ? error.message : "Invalid RAG document metadata",
        });
      }
      return withLock(async () => {
        const data = await load();
        const documentId = crypto.randomUUID();
        const chunks = await createChunkTexts(text);
        options?.abortSignal?.throwIfAborted();

        const doc: RagDocumentMeta = {
          id: documentId,
          title,
          source: meta?.source ?? "",
          type: meta?.type ?? "",
          createdAt: Date.now(),
          ...(meta?.size !== undefined ? { size: meta.size } : {}),
          ...(meta?.mediaType !== undefined ? { mediaType: meta.mediaType } : {}),
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
      }, options?.abortSignal);
    },

    async refreshDocument(
      id: string,
      text: string,
      meta?: RagRefreshOptions,
      options?: RagOperationOptions,
    ): Promise<void> {
      options?.abortSignal?.throwIfAborted();
      try {
        validateRagDocumentMetadata(meta, "ragStore refresh metadata");
      } catch (error) {
        throw INVALID_ARGUMENT.create({
          detail: error instanceof Error ? error.message : "Invalid RAG document metadata",
        });
      }
      return withLock(async () => {
        const data = await load();
        const document = data.documents.find((doc) => doc.id === id);
        if (!document) {
          throw INVALID_ARGUMENT.create({ detail: `RAG document not found: ${id}` });
        }
        const chunks = await createChunkTexts(text);
        options?.abortSignal?.throwIfAborted();

        document.title = meta?.title ?? document.title;
        document.source = meta?.source ?? document.source;
        document.type = meta?.type ?? document.type;
        document.size = meta?.size ?? document.size;
        document.mediaType = meta?.mediaType ?? document.mediaType;
        delete document.contentIndexFingerprint;
        delete document.contentRoot;
        delete document.managedBy;
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
        await save(data);
      }, options?.abortSignal);
    },

    async search(
      query: string,
      options?: RagSearchOptions,
    ): Promise<RagSearchResult[]> {
      const normalized = normalizeSearchOptions(options);
      normalized.abortSignal?.throwIfAborted();
      if (typeof query !== "string") {
        throw INVALID_ARGUMENT.create({ detail: "RAG search query must be a string" });
      }
      if (!query.trim()) return [];
      return withLock(async () => {
        const data = await load();
        if (data.chunks.length === 0) return [];

        const updated = await ensureEmbeddings(data, normalized.abortSignal);
        if (updated) await save(data);

        const embedder = createEmbedder();
        const queryEmbedding = validateEmbeddingVector(
          await embedder.embed(query, {
            abortSignal: normalized.abortSignal,
          }),
          "RAG query embedding result",
          data.embeddingFingerprint?.dimension,
        );

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

        let results = scored.slice(0, normalized.topK);
        if (normalized.threshold !== undefined) {
          results = results.filter((result) => result.score >= normalized.threshold!);
        }
        return results;
      }, normalized.abortSignal);
    },

    async listDocuments(options?: RagOperationOptions): Promise<RagDocumentMeta[]> {
      return withLock(async () => {
        options?.abortSignal?.throwIfAborted();
        const data = await load();
        return data.documents.map((document) => ({
          id: document.id,
          title: document.title,
          source: document.source,
          type: document.type,
          createdAt: document.createdAt,
          ...(document.size !== undefined ? { size: document.size } : {}),
          ...(document.mediaType !== undefined ? { mediaType: document.mediaType } : {}),
          ...(document.url !== undefined ? { url: document.url } : {}),
        }));
      }, options?.abortSignal);
    },

    async removeDocument(id: string, options?: RagRemoveOptions): Promise<void> {
      options?.abortSignal?.throwIfAborted();
      try {
        validateRagRemoveOptions(options, "ragStore remove options");
      } catch (error) {
        throw INVALID_ARGUMENT.create({
          detail: error instanceof Error ? error.message : "Invalid RAG remove options",
        });
      }
      return withLock(async () => {
        const data = await load();
        options?.abortSignal?.throwIfAborted();
        const document = data.documents.find((candidate) => candidate.id === id);
        if (
          document &&
          options?.requiredSourcePrefix !== undefined &&
          !document.source.startsWith(options.requiredSourcePrefix)
        ) {
          throw PERMISSION_DENIED.create({
            detail: `RAG document "${id}" does not satisfy the required source provenance`,
          });
        }
        data.documents = data.documents.filter((d) => d.id !== id);
        data.chunks = data.chunks.filter((c) => c.documentId !== id);
        await save(data);
      }, options?.abortSignal);
    },

    async indexContentDir(): Promise<void> {
      if (!contentDir) return;

      return withLock(async () => {
        const data = await load();
        const contentRoot = normalizeContentRoot(contentDir);
        const files = await listContentFiles(contentRoot);
        const currentSources = new Set(files);
        const documentsBySource = new Map<string, RagStoredDocumentMeta>();
        for (const document of data.documents) {
          const current = documentsBySource.get(document.source);
          const documentIsManaged = document.managedBy === CONTENT_INDEX_MANAGED_BY &&
            document.contentRoot === contentRoot;
          const currentIsManaged = current?.managedBy === CONTENT_INDEX_MANAGED_BY &&
            current.contentRoot === contentRoot;
          if (
            !current ||
            (documentIsManaged &&
              (!currentIsManaged || document.id.localeCompare(current.id) < 0))
          ) {
            documentsBySource.set(document.source, document);
          }
        }

        let changed = false;
        const removeManagedDocument = (document: RagStoredDocumentMeta): void => {
          data.documents = data.documents.filter((candidate) => candidate.id !== document.id);
          data.chunks = data.chunks.filter((candidate) => candidate.documentId !== document.id);
          if (documentsBySource.get(document.source)?.id === document.id) {
            documentsBySource.delete(document.source);
          }
          changed = true;
        };

        for (const file of files) {
          const content = await readTextFile(file);
          const existing = documentsBySource.get(file);
          if (!content?.trim()) {
            if (
              existing?.managedBy === CONTENT_INDEX_MANAGED_BY &&
              existing.contentRoot === contentRoot
            ) {
              removeManagedDocument(existing);
            }
            continue;
          }

          let contentBytes: Uint8Array<ArrayBuffer>;
          try {
            contentBytes = encodeDocumentText(content);
          } catch (error) {
            if (
              existing?.managedBy === CONTENT_INDEX_MANAGED_BY &&
              existing.contentRoot === contentRoot
            ) {
              removeManagedDocument(existing);
            }
            serverLogger.warn(
              `[rag-store] Skipping ${file}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            continue;
          }

          const contentHash = await hashStoreBytes(contentBytes);
          const contentIndexFingerprint = await computeContentIndexFingerprint(
            contentHash,
            config,
          );
          if (
            existing?.managedBy === CONTENT_INDEX_MANAGED_BY &&
            existing.contentRoot === contentRoot &&
            existing.contentIndexFingerprint === contentIndexFingerprint
          ) {
            continue;
          }

          const title = contentTitle(contentRoot, file);
          const type = extname(file).slice(1);
          const chunks = await createChunkTexts(content);
          if (chunks.length === 0) continue;

          const document: RagStoredDocumentMeta = existing ?? {
            id: crypto.randomUUID(),
            title,
            source: file,
            type,
            createdAt: Date.now(),
          };
          document.title = title;
          document.source = file;
          document.type = type;
          document.managedBy = CONTENT_INDEX_MANAGED_BY;
          document.contentRoot = contentRoot;
          document.contentIndexFingerprint = contentIndexFingerprint;
          if (!existing) data.documents.push(document);

          data.chunks = data.chunks.filter((candidate) => candidate.documentId !== document.id);
          data.chunks.push(...chunks.map((chunkText, index) => ({
            id: crypto.randomUUID(),
            documentId: document.id,
            text: chunkText,
            embedding: [] as number[],
            index,
          })));
          documentsBySource.set(file, document);
          changed = true;
        }

        for (const document of [...data.documents]) {
          const retained = documentsBySource.get(document.source);
          if (
            document.managedBy === CONTENT_INDEX_MANAGED_BY &&
            document.contentRoot === contentRoot &&
            (
              !currentSources.has(document.source) ||
              retained?.id !== document.id
            )
          ) {
            removeManagedDocument(document);
          }
        }

        if (changed) await save(data);
      });
    },
  };
}
