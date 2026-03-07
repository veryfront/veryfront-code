import { cosineSimilarity } from "ai";
import {
  isNotFoundError,
  mkdir,
  readDir,
  readTextFile,
  writeTextFile,
} from "#veryfront/platform/compat/fs.ts";
import { dirname, extname, join } from "#veryfront/platform/compat/path/basic-operations.ts";
import { serverLogger } from "#veryfront/utils";
import { embedding } from "./embedding.ts";
import { chunk } from "./chunk.ts";
import type {
  StoredChunk,
  UploadMeta,
  UploadSearchOptions,
  UploadSearchResult,
  UploadStore,
  UploadStoreConfig,
  UploadStoreData,
} from "./types.ts";

/** Default number of top results returned by similarity search. */
const DEFAULT_TOP_K = 5;

/**
 * Creates a persistent upload store with lazy embedding and similarity search.
 *
 * Combines upload management, chunking, embedding, and vector search into
 * a single factory. Uploads are chunked on ingest; embeddings are generated
 * lazily on the first search call to avoid blocking uploads on AI API calls.
 *
 * Persistence is JSON-file-based (via the platform fs adapter), making it
 * suitable for prototypes, templates, and small-to-medium knowledge bases.
 *
 * @example
 * ```ts
 * import { uploadStore } from "veryfront/embedding";
 *
 * const store = uploadStore({
 *   model: "openai/text-embedding-3-small",
 *   storagePath: "data/index.json",
 *   contentDir: "content",
 * });
 *
 * await store.ingest("My Doc", text, { source: "upload:file.pdf", type: "pdf" });
 * const results = await store.search("query", { topK: 5, threshold: 0.7 });
 * ```
 */
export function uploadStore(config: UploadStoreConfig): UploadStore {
  const storagePath = config.storagePath ?? "data/index.json";
  const contentDir = config.contentDir;
  const contentExtensions = new Set(config.contentExtensions ?? [".md", ".mdx", ".txt"]);
  const chunkOptions = config.chunkOptions;

  const MAX_TEXT_LENGTH = 5 * 1024 * 1024; // 5 MB text limit per document

  // Serialize all load→modify→save operations to prevent concurrent overwrites.
  let mutex: Promise<void> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = mutex.then(fn);
    mutex = result.then(
      () => {},
      (err) => {
        serverLogger.error("[upload-store] Lock operation failed:", err);
      },
    );
    return result;
  }

  const embedder = embedding({
    model: config.model,
    documentPrefix: config.documentPrefix,
    queryPrefix: config.queryPrefix,
    batchSize: config.batchSize,
  });

  async function load(): Promise<UploadStoreData> {
    try {
      const data = await readTextFile(storagePath);
      const parsed = JSON.parse(data);
      if (!parsed || !Array.isArray(parsed.uploads) || !Array.isArray(parsed.chunks)) {
        serverLogger.warn("[upload-store] Corrupted store file, resetting", { storagePath });
        return { uploads: [], chunks: [] };
      }
      return parsed as UploadStoreData;
    } catch (err) {
      // File not found is expected on first run; anything else is worth logging
      if (isNotFoundError(err)) {
        return { uploads: [], chunks: [] };
      }
      serverLogger.warn("[upload-store] Failed to load store, resetting", err);
      return { uploads: [], chunks: [] };
    }
  }

  async function save(data: UploadStoreData): Promise<void> {
    const dir = dirname(storagePath);
    if (dir && dir !== ".") {
      await mkdir(dir, { recursive: true });
    }
    const payload = JSON.stringify(data, null, 2);
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
  }

  async function ensureEmbeddings(data: UploadStoreData): Promise<boolean> {
    const unembedded = data.chunks.filter((c) => c.embedding.length === 0);
    if (unembedded.length === 0) return false;

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
        const uploadId = crypto.randomUUID();

        if (text.length > MAX_TEXT_LENGTH) {
          throw new Error(
            `Upload text exceeds ${MAX_TEXT_LENGTH / 1024 / 1024} MB limit`,
          );
        }

        const chunks = await chunk(text, chunkOptions);
        if (chunks.length === 0) {
          throw new Error("Upload contains no extractable text");
        }

        const doc: UploadMeta = {
          id: uploadId,
          title,
          source: meta?.source ?? "",
          type: meta?.type ?? "",
          createdAt: Date.now(),
        };

        const chunkRecords: StoredChunk[] = chunks.map((chunkText, i) => ({
          id: crypto.randomUUID(),
          uploadId,
          text: chunkText,
          embedding: [], // filled lazily on first search
          index: i,
        }));

        data.uploads.push(doc);
        data.chunks.push(...chunkRecords);
        await save(data);

        return uploadId;
      });
    },

    async search(
      query: string,
      options?: UploadSearchOptions,
    ): Promise<UploadSearchResult[]> {
      return withLock(async () => {
        const data = await load();
        if (data.chunks.length === 0) return [];

        const updated = await ensureEmbeddings(data);
        if (updated) await save(data);

        const queryEmbedding = await embedder.embed(query);
        const topK = options?.topK ?? DEFAULT_TOP_K;
        const threshold = options?.threshold;

        const docMap = new Map(data.uploads.map((d) => [d.id, d]));

        const scored = data.chunks.map((c) => {
          const doc = docMap.get(c.uploadId);
          return {
            text: c.text,
            score: cosineSimilarity(queryEmbedding, c.embedding),
            uploadId: c.uploadId,
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

    async listUploads(): Promise<UploadMeta[]> {
      return withLock(async () => {
        const data = await load();
        return data.uploads;
      });
    },

    async removeUpload(id: string): Promise<void> {
      return withLock(async () => {
        const data = await load();
        data.uploads = data.uploads.filter((d) => d.id !== id);
        data.chunks = data.chunks.filter((c) => c.uploadId !== id);
        await save(data);
      });
    },

    async indexContentDir(): Promise<void> {
      if (!contentDir) return;

      return withLock(async () => {
        const data = await load();
        const indexedSources = new Set(data.uploads.map((d) => d.source));

        const files = await listContentFiles(contentDir);
        const newFiles = files.filter((f) => !indexedSources.has(f));
        if (newFiles.length === 0) return;

        for (const file of newFiles) {
          const content = await readTextFile(file);
          if (!content?.trim()) continue;
          if (content.length > MAX_TEXT_LENGTH) {
            serverLogger.warn(
              `[upload-store] Skipping ${file}: exceeds ${
                MAX_TEXT_LENGTH / 1024 / 1024
              } MB text limit`,
            );
            continue;
          }

          const title = file.startsWith(contentDir + "/")
            ? file.slice(contentDir.length + 1).replace(/\.[^.]+$/, "")
            : file.replace(/\.[^.]+$/, "");
          const uploadId = crypto.randomUUID();
          const type = extname(file).slice(1);

          const chunks = await chunk(content, chunkOptions);
          if (chunks.length === 0) continue;

          data.uploads.push({
            id: uploadId,
            title,
            source: file,
            type,
            createdAt: Date.now(),
          });

          data.chunks.push(
            ...chunks.map((chunkText, i) => ({
              id: crypto.randomUUID(),
              uploadId,
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
