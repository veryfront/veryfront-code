import { cosineSimilarity } from "ai";
import { mkdir, readDir, readTextFile, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { dirname, extname, join } from "#veryfront/platform/compat/path/basic-operations.ts";
import { embedding } from "./embedding.ts";
import { chunk } from "./chunk.ts";
import type {
  DocumentMeta,
  DocumentSearchOptions,
  DocumentSearchResult,
  DocumentStore,
  DocumentStoreConfig,
  DocumentStoreData,
  StoredChunk,
} from "./types.ts";

/**
 * Creates a persistent document store with lazy embedding and similarity search.
 *
 * Combines document management, chunking, embedding, and vector search into
 * a single factory. Documents are chunked on ingest; embeddings are generated
 * lazily on the first search call to avoid blocking uploads on AI API calls.
 *
 * Persistence is JSON-file-based (via the platform fs adapter), making it
 * suitable for prototypes, templates, and small-to-medium knowledge bases.
 *
 * @example
 * ```ts
 * import { documentStore } from "veryfront/embedding";
 *
 * const store = documentStore({
 *   model: "openai/text-embedding-3-small",
 *   storagePath: "data/index.json",
 *   contentDir: "content",
 * });
 *
 * await store.ingest("My Doc", text, { source: "upload:file.pdf", type: "pdf" });
 * const results = await store.search("query", { topK: 5, threshold: 0.7 });
 * ```
 */
export function documentStore(config: DocumentStoreConfig): DocumentStore {
  const storagePath = config.storagePath ?? "data/index.json";
  const contentDir = config.contentDir;
  const contentExtensions = new Set(config.contentExtensions ?? [".md", ".mdx", ".txt"]);
  const chunkOptions = config.chunkOptions;

  // Serialize all load→modify→save operations to prevent concurrent overwrites.
  let mutex: Promise<void> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = mutex.then(fn);
    mutex = result.then(() => {}, () => {});
    return result;
  }

  const embedder = embedding({
    model: config.model,
    documentPrefix: config.documentPrefix,
    queryPrefix: config.queryPrefix,
    batchSize: config.batchSize,
  });

  async function load(): Promise<DocumentStoreData> {
    try {
      const data = await readTextFile(storagePath);
      return JSON.parse(data) as DocumentStoreData;
    } catch {
      return { documents: [], chunks: [] };
    }
  }

  async function save(data: DocumentStoreData): Promise<void> {
    const dir = dirname(storagePath);
    if (dir && dir !== ".") {
      await mkdir(dir, { recursive: true });
    }
    await writeTextFile(storagePath, JSON.stringify(data, null, 2));
  }

  async function ensureEmbeddings(data: DocumentStoreData): Promise<boolean> {
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
    } catch {
      // directory may not exist yet
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

        const chunks = await chunk(text, chunkOptions);
        if (chunks.length === 0) {
          throw new Error("Document contains no extractable text");
        }

        const doc: DocumentMeta = {
          id: documentId,
          title,
          source: meta?.source ?? "",
          type: meta?.type ?? "",
          createdAt: Date.now(),
        };

        const chunkRecords: StoredChunk[] = chunks.map((text, i) => ({
          id: crypto.randomUUID(),
          documentId,
          text,
          embedding: [], // filled lazily on first search
          index: i,
        }));

        data.documents.push(doc);
        data.chunks.push(...chunkRecords);
        await save(data);

        return documentId;
      });
    },

    async search(
      query: string,
      options?: DocumentSearchOptions,
    ): Promise<DocumentSearchResult[]> {
      return withLock(async () => {
        const data = await load();
        if (data.chunks.length === 0) return [];

        const updated = await ensureEmbeddings(data);
        if (updated) await save(data);

        const queryEmbedding = await embedder.embed(query);
        const topK = options?.topK ?? 5;
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

    async listDocuments(): Promise<DocumentMeta[]> {
      const data = await load();
      return data.documents;
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

          const title = file.replace(new RegExp(`^${contentDir}/`), "").replace(/\.[^.]+$/, "");
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
            ...chunks.map((text, i) => ({
              id: crypto.randomUUID(),
              documentId,
              text,
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
