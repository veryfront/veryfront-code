import { readDir, readTextFile } from "#veryfront/platform/compat/fs.ts";
import { extname, join } from "#veryfront/platform/compat/path/basic-operations.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { serverLogger } from "#veryfront/utils";
import {
  createVeryfrontCloudFetch,
  requireVeryfrontCloudBootstrap,
} from "#veryfront/provider/veryfront-cloud/shared.ts";
import { chunk } from "../chunk.ts";
import { embedding } from "../embedding.ts";
import type {
  RagDocumentMeta,
  RagSearchOptions,
  RagSearchResult,
  RagStore,
  RagStoreConfig,
} from "../types.ts";

const DEFAULT_TOP_K = 5;
const MAX_TEXT_LENGTH = 5 * 1024 * 1024; // 5 MB text limit per document
const MAX_API_CHUNK_BATCH = 500;
const MAX_API_EMBEDDING_BATCH = 100;
const MAX_SEARCH_LIMIT = 100;
const SEARCH_OVERSCAN = 25;
const MANIFEST_FILE_PATH = ".veryfront/rag/manifest.json";
const DOCUMENTS_DIR = ".veryfront/rag/documents";
const MANIFEST_SEGMENT_LENGTH = 12_000;

type SupportedDimension = 768 | 1024 | 1536 | 3072 | 4096;

interface CloudRagDocumentMeta extends RagDocumentMeta {
  filePath: string;
}

interface CloudRagManifest {
  version: 1;
  documents: CloudRagDocumentMeta[];
}

interface CloudChunkListResponse {
  data: Array<{
    id: string;
    index: number;
    content: string;
    metadata?: Record<string, unknown>;
  }>;
  page_info?: {
    next?: string | null;
  };
}

interface CloudUpsertChunksResponse {
  chunks: Array<{ id: string; index: number }>;
}

interface CloudSearchResponse {
  data: Array<{
    chunk: {
      file_path: string;
      content: string;
      metadata?: Record<string, unknown>;
    };
    score: number;
  }>;
}

interface CloudStoreContext {
  apiBaseUrl: string;
  fetch: typeof fetch;
  projectSlug: string;
  branch: string;
}

interface ChunkMutationInput {
  chunk_index: number;
  content: string;
  start_offset: number;
  end_offset: number;
  token_count: number;
  metadata?: Record<string, unknown>;
}

type ResolvedCloudRagStoreConfig = RagStoreConfig & { model: string };

function buildUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function toSupportedDimension(length: number): SupportedDimension {
  switch (length) {
    case 768:
    case 1024:
    case 1536:
    case 3072:
    case 4096:
      return length;
    default:
      throw INVALID_ARGUMENT.create({
        detail:
          `Unsupported embedding dimension ${length}. Expected one of 768, 1024, 1536, 3072, 4096.`,
      });
  }
}

function normalizeEmbeddingModelDescriptor(model: string, dimension: SupportedDimension): {
  name: string;
  provider: string;
  dimension: SupportedDimension;
} {
  const normalized = model.startsWith("veryfront-cloud/")
    ? model.slice("veryfront-cloud/".length)
    : model;
  const slashIndex = normalized.indexOf("/");

  if (slashIndex === -1) {
    return {
      name: normalized,
      provider: "unknown",
      dimension,
    };
  }

  return {
    provider: normalized.slice(0, slashIndex),
    name: normalized.slice(slashIndex + 1),
    dimension,
  };
}

function buildDocumentFilePath(documentId: string, type?: string): string {
  const extension = type?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${DOCUMENTS_DIR}/${documentId}.${extension || "txt"}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function buildManifestContentChunks(serialized: string): ChunkMutationInput[] {
  const chunks: ChunkMutationInput[] = [];
  for (
    let start = 0, index = 0;
    start < serialized.length;
    start += MANIFEST_SEGMENT_LENGTH, index++
  ) {
    const content = serialized.slice(start, start + MANIFEST_SEGMENT_LENGTH);
    chunks.push({
      chunk_index: index,
      content,
      start_offset: start,
      end_offset: start + content.length,
      token_count: estimateTokenCount(content),
      metadata: {
        kind: "rag-manifest",
      },
    });
  }

  return chunks;
}

function buildManifestPaddingChunks(
  startIndex: number,
  endIndex: number,
  baseOffset: number,
): ChunkMutationInput[] {
  const chunks: ChunkMutationInput[] = [];
  for (let index = startIndex; index < endIndex; index++) {
    const offset = baseOffset + (index - startIndex);
    chunks.push({
      chunk_index: index,
      content: " ",
      start_offset: offset,
      end_offset: offset + 1,
      token_count: 1,
      metadata: {
        kind: "rag-manifest-padding",
      },
    });
  }
  return chunks;
}

function buildDocumentChunks(
  sourceText: string,
  chunkTexts: string[],
  metadata: Record<string, unknown>,
): ChunkMutationInput[] {
  let searchStart = 0;

  return chunkTexts.map((content, index) => {
    const foundAt = sourceText.indexOf(content, searchStart);
    const startOffset = foundAt >= 0 ? foundAt : searchStart;
    const endOffset = startOffset + content.length;
    searchStart = Math.max(startOffset + 1, endOffset);

    return {
      chunk_index: index,
      content,
      start_offset: startOffset,
      end_offset: endOffset,
      token_count: estimateTokenCount(content),
      metadata,
    };
  });
}

async function requestJson<T>(
  context: CloudStoreContext,
  path: string,
  init?: RequestInit,
  options?: { allowNotFound?: boolean },
): Promise<T | null> {
  const request = new Request(buildUrl(context.apiBaseUrl, path), init);
  const headers = new Headers(request.headers);

  if (!headers.has("Content-Type") && request.method !== "GET" && request.method !== "HEAD") {
    headers.set("Content-Type", "application/json");
  }

  const response = await context.fetch(new Request(request, { headers }));
  if (options?.allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw INVALID_ARGUMENT.create({
      detail: `Veryfront Cloud RAG request failed (${response.status} ${response.statusText}): ${
        body || path
      }`,
    });
  }

  if (response.status === 204) {
    return null;
  }

  return await response.json() as T;
}

function getCloudStoreContext(config: RagStoreConfig): CloudStoreContext {
  const bootstrap = requireVeryfrontCloudBootstrap();
  if (!bootstrap.projectSlug) {
    throw INVALID_ARGUMENT.create({
      detail:
        "VERYFRONT_PROJECT_SLUG not set. Set the environment variable or runtime projectSlug before using the veryfront-cloud RAG store.",
    });
  }

  return {
    apiBaseUrl: bootstrap.apiBaseUrl,
    fetch: createVeryfrontCloudFetch(bootstrap.apiToken),
    projectSlug: bootstrap.projectSlug,
    branch: config.branch ?? getCurrentRequestContext()?.branch ?? "main",
  };
}

function getFileChunksPath(
  context: CloudStoreContext,
  filePath: string,
): string {
  return `/projects/${encodeURIComponent(context.projectSlug)}/branches/${
    encodeURIComponent(context.branch)
  }/files/${encodeURIComponent(filePath)}/chunks`;
}

function getSearchPath(context: CloudStoreContext): string {
  return `/projects/${encodeURIComponent(context.projectSlug)}/branches/${
    encodeURIComponent(context.branch)
  }/search`;
}

function getEmbeddingsPath(context: CloudStoreContext): string {
  return `/projects/${encodeURIComponent(context.projectSlug)}/embeddings`;
}

async function listAllFileChunks(
  context: CloudStoreContext,
  filePath: string,
): Promise<
  Array<{ id: string; index: number; content: string; metadata?: Record<string, unknown> }>
> {
  const chunks: Array<
    { id: string; index: number; content: string; metadata?: Record<string, unknown> }
  > = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);

    const response = await requestJson<CloudChunkListResponse>(
      context,
      `${getFileChunksPath(context, filePath)}?${params.toString()}`,
      undefined,
      { allowNotFound: true },
    );

    if (!response) return [];
    chunks.push(...response.data);
    cursor = response.page_info?.next ?? undefined;
  } while (cursor);

  chunks.sort((a, b) => a.index - b.index);
  return chunks;
}

async function deleteFileChunks(context: CloudStoreContext, filePath: string): Promise<void> {
  await requestJson(
    context,
    getFileChunksPath(context, filePath),
    { method: "DELETE" },
    { allowNotFound: true },
  );
}

async function upsertFileChunks(
  context: CloudStoreContext,
  filePath: string,
  chunks: ChunkMutationInput[],
): Promise<Array<{ id: string; index: number }>> {
  if (chunks.length === 0) {
    return [];
  }

  const results: Array<{ id: string; index: number }> = [];
  for (let i = 0; i < chunks.length; i += MAX_API_CHUNK_BATCH) {
    const batch = chunks.slice(i, i + MAX_API_CHUNK_BATCH);
    const response = await requestJson<CloudUpsertChunksResponse>(
      context,
      getFileChunksPath(context, filePath),
      {
        method: "POST",
        body: JSON.stringify({ chunks: batch }),
      },
    );

    if (response) {
      results.push(...response.chunks);
    }
  }

  results.sort((a, b) => a.index - b.index);
  return results;
}

async function upsertEmbeddings(
  context: CloudStoreContext,
  chunkIds: string[],
  vectors: number[][],
  model: { name: string; provider: string; dimension: SupportedDimension },
): Promise<void> {
  for (let i = 0; i < chunkIds.length; i += MAX_API_EMBEDDING_BATCH) {
    const batchChunkIds = chunkIds.slice(i, i + MAX_API_EMBEDDING_BATCH);
    const batchVectors = vectors.slice(i, i + MAX_API_EMBEDDING_BATCH);

    await requestJson(
      context,
      getEmbeddingsPath(context),
      {
        method: "POST",
        body: JSON.stringify({
          chunk_ids: batchChunkIds,
          vectors: batchVectors,
          model,
        }),
      },
    );
  }
}

async function loadManifest(context: CloudStoreContext): Promise<CloudRagManifest> {
  const chunks = await listAllFileChunks(context, MANIFEST_FILE_PATH);
  if (chunks.length === 0) {
    return { version: 1, documents: [] };
  }

  const serialized = chunks
    .filter((c) => c.metadata?.kind !== "rag-manifest-padding")
    .map((chunk) => chunk.content)
    .join("");
  if (!serialized.trim()) {
    return { version: 1, documents: [] };
  }

  try {
    const parsed = JSON.parse(serialized) as Partial<CloudRagManifest>;
    if (!Array.isArray(parsed.documents)) {
      return { version: 1, documents: [] };
    }

    return {
      version: 1,
      documents: parsed.documents.filter((item): item is CloudRagDocumentMeta =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.source === "string" &&
        typeof item.type === "string" &&
        typeof item.createdAt === "number" &&
        typeof item.filePath === "string"
      ),
    };
  } catch (error) {
    serverLogger.warn("[rag-store/cloud] Failed to parse manifest, resetting", error);
    return { version: 1, documents: [] };
  }
}

async function saveManifest(
  context: CloudStoreContext,
  manifest: CloudRagManifest,
): Promise<void> {
  const serialized = manifest.documents.length === 0
    ? ""
    : JSON.stringify({ version: 1, documents: manifest.documents }, null, 2);

  const contentChunks = buildManifestContentChunks(serialized);
  const existingChunks = await listAllFileChunks(context, MANIFEST_FILE_PATH);

  // Step 1: Pad stale trailing chunks first.
  // If the process crashes after this step but before step 2, loadManifest
  // will see the OLD content chunks (still valid JSON) plus padding chunks
  // (filtered out by loadManifest). The manifest remains consistent.
  if (existingChunks.length > contentChunks.length) {
    const paddingChunks = buildManifestPaddingChunks(
      contentChunks.length,
      existingChunks.length,
      serialized.length,
    );
    await upsertFileChunks(context, MANIFEST_FILE_PATH, paddingChunks);
  }

  // Step 2: Upsert new content chunks.
  // If the process crashes here, the manifest is either fully old (padding
  // already written) or partially new — both are recoverable states.
  if (contentChunks.length > 0) {
    await upsertFileChunks(context, MANIFEST_FILE_PATH, contentChunks);
  }
}

async function listContentFiles(
  contentDir: string,
  contentExtensions: Set<string>,
): Promise<string[]> {
  const files: string[] = [];

  try {
    for await (const entry of readDir(contentDir)) {
      const fullPath = join(contentDir, entry.name);
      if (entry.isDirectory) {
        files.push(...(await listContentFiles(fullPath, contentExtensions)));
      } else if (entry.isFile && contentExtensions.has(extname(entry.name))) {
        files.push(fullPath);
      }
    }
  } catch (_) {
    // expected: directory may not exist yet
  }

  return files;
}

async function ingestDocument(
  context: CloudStoreContext,
  manifest: CloudRagManifest,
  config: ResolvedCloudRagStoreConfig,
  title: string,
  text: string,
  meta?: { source?: string; type?: string },
): Promise<CloudRagDocumentMeta> {
  if (text.length > MAX_TEXT_LENGTH) {
    throw INVALID_ARGUMENT.create({
      detail: `Upload text exceeds ${MAX_TEXT_LENGTH / 1024 / 1024} MB limit`,
    });
  }

  const chunkTexts = await chunk(text, config.chunkOptions);
  if (chunkTexts.length === 0) {
    throw INVALID_ARGUMENT.create({ detail: "Upload contains no extractable text" });
  }

  const documentId = crypto.randomUUID();
  const filePath = buildDocumentFilePath(documentId, meta?.type);
  const embedder = createEmbedder(config);
  const vectors = await embedder.embedMany(chunkTexts);
  const dimension = toSupportedDimension(vectors[0]?.length ?? 0);
  const chunkInputs = buildDocumentChunks(text, chunkTexts, {
    kind: "rag-document",
    document_id: documentId,
    title,
    source: meta?.source ?? "",
    type: meta?.type ?? "",
  });

  try {
    const createdChunks = await upsertFileChunks(context, filePath, chunkInputs);
    const chunkIds = createdChunks.map((entry) => entry.id);

    if (chunkIds.length !== vectors.length) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Expected ${vectors.length} chunk IDs from Veryfront Cloud, received ${chunkIds.length}.`,
      });
    }

    await upsertEmbeddings(
      context,
      chunkIds,
      vectors,
      normalizeEmbeddingModelDescriptor(config.model, dimension),
    );
  } catch (error) {
    await deleteFileChunks(context, filePath).catch(() => undefined);
    throw error;
  }

  const document: CloudRagDocumentMeta = {
    id: documentId,
    title,
    source: meta?.source ?? "",
    type: meta?.type ?? "",
    createdAt: Date.now(),
    filePath,
  };

  manifest.documents.push(document);
  return document;
}

function createEmbedder(config: ResolvedCloudRagStoreConfig) {
  return embedding({
    model: config.model,
    documentPrefix: config.documentPrefix,
    queryPrefix: config.queryPrefix,
    batchSize: config.batchSize,
  });
}

function cloneManifest(manifest: CloudRagManifest): CloudRagManifest {
  return {
    version: manifest.version,
    documents: manifest.documents.map((document) => ({ ...document })),
  };
}

export function createVeryfrontCloudRagStore(config: ResolvedCloudRagStoreConfig): RagStore {
  const contentDir = config.contentDir;
  const contentExtensions = new Set(config.contentExtensions ?? [".md", ".mdx", ".txt"]);

  // Serialize all load→modify→save operations to prevent concurrent overwrites.
  // NOTE: This is a single-process, single-instance mutex. In multi-pod
  // deployments, concurrent stores from different instances targeting the
  // same project/branch can race on the manifest (last writer wins).
  let mutex: Promise<void> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = mutex.then(fn);
    mutex = result.then(
      () => {},
      (error) => {
        serverLogger.error("[rag-store/cloud] Lock operation failed:", error);
      },
    );
    return result;
  }

  return {
    async ingest(
      title: string,
      text: string,
      meta?: { source?: string; type?: string },
    ): Promise<string> {
      return withLock(async () => {
        const context = getCloudStoreContext(config);
        const manifest = await loadManifest(context);
        const originalManifest = cloneManifest(manifest);
        const document = await ingestDocument(context, manifest, config, title, text, meta);
        try {
          await saveManifest(context, manifest);
          return document.id;
        } catch (error) {
          await deleteFileChunks(context, document.filePath).catch(() => undefined);
          await saveManifest(context, originalManifest).catch(() => undefined);
          throw error;
        }
      });
    },

    async search(
      query: string,
      options?: RagSearchOptions,
    ): Promise<RagSearchResult[]> {
      const context = getCloudStoreContext(config);
      const queryEmbedder = createEmbedder(config);
      const vector = await queryEmbedder.embed(query);
      const topK = options?.topK ?? DEFAULT_TOP_K;
      const limit = Math.min(MAX_SEARCH_LIMIT, topK + SEARCH_OVERSCAN);
      const dimension = toSupportedDimension(vector.length);
      const response = await requestJson<CloudSearchResponse>(
        context,
        getSearchPath(context),
        {
          method: "POST",
          body: JSON.stringify({
            vector,
            dimension,
            limit,
            threshold: options?.threshold ?? 0,
          }),
        },
      );

      const results = (response?.data ?? [])
        .filter((result) =>
          result.chunk.metadata?.kind !== "rag-manifest" &&
          result.chunk.metadata?.kind !== "rag-manifest-padding"
        )
        .map((result) => {
          const metadata = isRecord(result.chunk.metadata) ? result.chunk.metadata : {};

          return {
            text: result.chunk.content,
            score: result.score,
            documentId: toStringValue(metadata.document_id, result.chunk.file_path),
            title: toStringValue(metadata.title, "Unknown"),
            source: toStringValue(metadata.source, result.chunk.file_path),
            type: toStringValue(metadata.type, ""),
          };
        });

      return results.slice(0, topK);
    },

    async listDocuments(): Promise<RagDocumentMeta[]> {
      return withLock(async () => {
        const context = getCloudStoreContext(config);
        const manifest = await loadManifest(context);
        return manifest.documents.map(({ filePath: _filePath, ...document }) => document);
      });
    },

    async removeDocument(id: string): Promise<void> {
      return withLock(async () => {
        const context = getCloudStoreContext(config);
        const manifest = await loadManifest(context);
        const target = manifest.documents.find((document) => document.id === id);
        if (!target) return;

        const nextManifest: CloudRagManifest = {
          version: manifest.version,
          documents: manifest.documents.filter((document) => document.id !== id),
        };

        await saveManifest(context, nextManifest);
        try {
          await deleteFileChunks(context, target.filePath);
        } catch (error) {
          await saveManifest(context, manifest).catch(() => undefined);
          throw error;
        }
      });
    },

    async indexContentDir(): Promise<void> {
      if (!contentDir) return;

      return withLock(async () => {
        const context = getCloudStoreContext(config);
        const manifest = await loadManifest(context);
        const originalManifest = cloneManifest(manifest);
        const addedDocuments: CloudRagDocumentMeta[] = [];
        const indexedSources = new Set(manifest.documents.map((document) => document.source));
        const files = await listContentFiles(contentDir, contentExtensions);
        const newFiles = files.filter((file) => !indexedSources.has(file));

        for (const file of newFiles) {
          const content = await readTextFile(file);
          if (!content?.trim()) continue;
          if (content.length > MAX_TEXT_LENGTH) {
            serverLogger.warn(
              `[rag-store/cloud] Skipping ${file}: exceeds ${
                MAX_TEXT_LENGTH / 1024 / 1024
              } MB text limit`,
            );
            continue;
          }

          const title = file.startsWith(contentDir + "/")
            ? file.slice(contentDir.length + 1).replace(/\.[^.]+$/, "")
            : file.replace(/\.[^.]+$/, "");
          const type = extname(file).slice(1);

          const document = await ingestDocument(context, manifest, config, title, content, {
            source: file,
            type,
          });
          addedDocuments.push(document);
        }

        try {
          await saveManifest(context, manifest);
        } catch (error) {
          for (const document of addedDocuments) {
            await deleteFileChunks(context, document.filePath).catch(() => undefined);
          }
          await saveManifest(context, originalManifest).catch(() => undefined);
          throw error;
        }
      });
    },
  };
}
