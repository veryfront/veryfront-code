import {
  isNotFoundError,
  mkdir,
  readDir,
  readTextFile,
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
  RagRefreshOptions,
  RagSearchOptions,
  RagSearchResult,
  RagStore,
  RagStoreBackend,
  RagStoreConfig,
  RagStoreData,
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
import { INVALID_ARGUMENT } from "#veryfront/errors";

type ResolvedRagStoreConfig = RagStoreConfig & { model: string };

/** Default number of top results returned by similarity search. */
const DEFAULT_TOP_K = 5;

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
  return Array.isArray(value.documents) &&
    value.documents.every(isRagDocumentMeta) &&
    Array.isArray(value.chunks) &&
    value.chunks.every(isRagChunk);
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

function hashStoreText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
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
  const storagePath = config.storagePath ?? "data/index.json";
  const contentDir = config.contentDir;
  const contentExtensions = new Set(config.contentExtensions ?? [".md", ".mdx", ".txt"]);
  const chunkOptions = config.chunkOptions;
  let storeDataCache: StoreDataCache | null = null;

  const MAX_TEXT_LENGTH = 5 * 1024 * 1024; // 5 MB text limit per document

  // Serialize all load→modify→save operations to prevent concurrent overwrites.
  // NOTE: This is a single-process, single-instance mutex. In multi-instance
  // deployments, concurrent stores targeting the same file will race.
  let mutex: Promise<void> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = mutex.then(fn);
    mutex = result.then(
      () => {},
      (err) => {
        serverLogger.error("[rag-store] Lock operation failed:", err);
      },
    );
    return result;
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

  async function readStoreFileSnapshot(): Promise<StoreFileSnapshot | null> {
    const metadata = await getStoreFileMetadata();
    if (metadata === null) return null;

    const text = await readTextFile(storagePath);
    return {
      signature: {
        ...metadata,
        contentHash: hashStoreText(text),
      },
      text,
    };
  }

  async function updateStoreDataCache(data: RagStoreData, payload: string): Promise<void> {
    const metadata = await getStoreFileMetadata();
    storeDataCache = metadata === null ? null : {
      signature: {
        ...metadata,
        contentHash: hashStoreText(payload),
      },
      data: cloneRagStoreData(data),
    };
  }

  async function load(): Promise<RagStoreData> {
    try {
      const snapshot = await readStoreFileSnapshot();
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

      const parsed = JSON.parse(snapshot.text);
      if (isLegacyUploadStoreData(parsed)) {
        const migrated = migrateLegacyUploadStoreData(parsed);
        storeDataCache = {
          signature: snapshot.signature,
          data: cloneRagStoreData(migrated),
        };
        return cloneRagStoreData(migrated);
      }
      if (!isRagStoreData(parsed)) {
        serverLogger.warn("[rag-store] Corrupted store file, resetting", { storagePath });
        storeDataCache = null;
        return { documents: [], chunks: [] };
      }
      storeDataCache = { signature: snapshot.signature, data: cloneRagStoreData(parsed) };
      return cloneRagStoreData(parsed);
    } catch (err) {
      // File not found is expected on first run; anything else is worth logging
      if (isNotFoundError(err)) {
        storeDataCache = null;
        return { documents: [], chunks: [] };
      }
      serverLogger.warn("[rag-store] Failed to load store, resetting", err);
      storeDataCache = null;
      return { documents: [], chunks: [] };
    }
  }

  async function save(data: RagStoreData): Promise<void> {
    const dir = dirname(storagePath);
    if (dir && dir !== ".") {
      await mkdir(dir, { recursive: true });
    }
    const payload = JSON.stringify(data);
    // Atomic write: write to temp file then rename to prevent corruption on crash
    const tmpPath = storagePath + ".tmp";
    await writeTextFile(tmpPath, payload);
    try {
      if (typeof Deno !== "undefined") {
        await Deno.rename(tmpPath, storagePath);
      } else {
        const fs = await import("node:fs/promises");
        await fs.rename(tmpPath, storagePath);
      }
    } catch (_) {
      // expected: rename not available in all environments, fall back to direct write
      await writeTextFile(storagePath, payload);
    }
    await updateStoreDataCache(data, payload);
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
      return withLock(async () => {
        const data = await load();
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
        await save(data);
      });
    },

    async search(
      query: string,
      options?: RagSearchOptions,
    ): Promise<RagSearchResult[]> {
      if (!query.trim()) return [];
      return withLock(async () => {
        const data = await load();
        if (data.chunks.length === 0) return [];

        const updated = await ensureEmbeddings(data);
        if (updated) await save(data);

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
        data.documents = data.documents.filter((d) => d.id !== id);
        data.chunks = data.chunks.filter((c) => c.documentId !== id);
        await save(data);
      });
    },

    async indexContentDir(): Promise<void> {
      if (!contentDir) return;

      return withLock(async () => {
        const data = await load();
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

        await save(data);
      });
    },
  };
}
