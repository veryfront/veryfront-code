import { readDir, readTextFile } from "#veryfront/platform/compat/fs.ts";
import { extname, join } from "#veryfront/platform/compat/path/basic-operations.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { INVALID_ARGUMENT, VeryfrontError } from "#veryfront/errors";
import { serverLogger } from "#veryfront/utils";
import {
  createVeryfrontCloudFetch,
  requireVeryfrontCloudBootstrap,
} from "#veryfront/provider/veryfront-cloud/shared.ts";
import { chunk } from "../chunk.ts";
import { embedding } from "../embedding.ts";
import {
  activeDocumentPaths,
  buildChunkFilePaths,
  CHUNKS_PER_FILE as MAX_API_CHUNK_BATCH,
  type DocumentParts,
  documentPartsMetadata,
  metadataWriteOutcome,
  readPartPaths,
  retiredDocumentPaths,
  retireDocumentParts,
} from "./document-parts.ts";
import type {
  RagDocumentMeta,
  RagRefreshOptions,
  RagSearchOptions,
  RagSearchResult,
  RagStore,
  RagStoreConfig,
} from "../types.ts";

const DEFAULT_TOP_K = 5;
const MAX_TEXT_LENGTH = 5 * 1024 * 1024; // 5 MB text limit per document
const MAX_API_EMBEDDING_BATCH = 100;
const MAX_SEARCH_LIMIT = 100;
const MAX_PART_READ_CONCURRENCY = 8;
const SEARCH_OVERSCAN = 25;
const DOCUMENTS_DIR = ".veryfront/rag/documents";

type SupportedDimension = 768 | 1024 | 1536 | 3072 | 4096;

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

interface CloudRagDocumentResponse {
  revision?: string;
  id: string;
  title: string;
  source: string;
  type: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface CloudListRagDocumentsResponse {
  documents: CloudRagDocumentResponse[];
}

interface CloudUpsertRagDocumentResponse {
  document: CloudRagDocumentResponse;
}

interface CloudStoreContext {
  apiBaseUrl: string;
  fetch: typeof fetch;
  projectSlug: string;
  branch: string;
  environmentName?: string | null;
  hasRequestContext: boolean;
  releaseId?: string | null;
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

type CloudRagDocumentMeta = RagDocumentMeta & DocumentParts & { revision?: string };

interface ContentFile {
  path: string;
  content?: string;
}

interface CloudFileListResponse {
  data: Array<{
    path: string;
    content?: string;
  }>;
  page_info?: {
    next?: string | null;
  };
}

interface CloudFileDetailResponse {
  path: string;
  content: string;
}

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

function normalizeExtension(type: string | undefined): string | undefined {
  return type?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function buildDocumentFilePath(documentId: string, type?: string): string {
  const extension = normalizeExtension(type);
  return `${DOCUMENTS_DIR}/${documentId}.${extension || "txt"}`;
}

function buildRefreshDocumentFilePath(documentId: string, type?: string): string {
  const extension = normalizeExtension(type);
  return `${DOCUMENTS_DIR}/${documentId}.refresh-${crypto.randomUUID()}.${extension || "txt"}`;
}

function documentFilePaths(document: CloudRagDocumentMeta): string[] {
  return activeDocumentPaths(document, buildDocumentFilePath(document.id, document.type));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toPublicRagDocumentMeta(document: CloudRagDocumentMeta): RagDocumentMeta {
  return {
    id: document.id,
    title: document.title,
    source: document.source,
    type: document.type,
    createdAt: document.createdAt,
    url: document.url,
  };
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

  if (request.method !== "GET" && request.method !== "HEAD") {
    headers.set("Content-Type", "application/json");
  }

  const response = await context.fetch(new Request(request, { headers }));
  if (options?.allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw INVALID_ARGUMENT.create({
      context: { upstreamStatus: response.status },
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
  const requestContext = getCurrentRequestContext();
  if (!bootstrap.projectSlug) {
    throw INVALID_ARGUMENT.create({
      detail:
        "VERYFRONT_PROJECT_SLUG not set. Set the environment variable or runtime projectSlug before using the veryfront-cloud RAG store.",
    });
  }

  return {
    apiBaseUrl: bootstrap.apiBaseUrl,
    fetch: createVeryfrontCloudFetch(bootstrap.apiToken, bootstrap.apiBaseUrl),
    projectSlug: bootstrap.projectSlug,
    branch: config.branch ?? requestContext?.branch ?? "main",
    environmentName: requestContext?.environmentName ?? null,
    hasRequestContext: requestContext !== null,
    releaseId: requestContext?.releaseId ?? null,
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

function getRagDocumentsPath(context: CloudStoreContext): string {
  return `/projects/${encodeURIComponent(context.projectSlug)}/rag/documents`;
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
  filePaths: string[],
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
      // Each POST replaces its file's complete chunk set.
      getFileChunksPath(context, filePaths[Math.floor(i / MAX_API_CHUNK_BATCH)]!),
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

// ---------------------------------------------------------------------------
// Server-side RAG document management
// ---------------------------------------------------------------------------

async function listRagDocuments(
  context: CloudStoreContext,
): Promise<CloudRagDocumentMeta[]> {
  const response = await requestJson<CloudListRagDocumentsResponse>(
    context,
    getRagDocumentsPath(context),
  );

  return (response?.documents ?? []).map((doc) => ({
    id: doc.id,
    title: doc.title,
    source: doc.source,
    type: doc.type,
    createdAt: new Date(doc.created_at).getTime(),
    filePath: typeof doc.metadata?.filePath === "string" ? doc.metadata.filePath : undefined,
    filePaths: readPartPaths(doc.metadata?.filePaths),
    cleanupFilePaths: readPartPaths(doc.metadata?.cleanupFilePaths),
    revision: doc.revision,
  }));
}

async function upsertRagDocument(
  context: CloudStoreContext,
  document: {
    id: string;
    title: string;
    source?: string;
    type?: string;
    metadata?: Record<string, unknown>;
    expectedRevision: string | null;
  },
): Promise<void> {
  await requestJson<CloudUpsertRagDocumentResponse>(
    context,
    getRagDocumentsPath(context),
    {
      method: "POST",
      body: JSON.stringify({
        id: document.id,
        title: document.title,
        source: document.source ?? "",
        type: document.type ?? "",
        metadata: document.metadata,
        expected_revision: document.expectedRevision,
      }),
    },
  );
}

async function deleteRagDocument(
  context: CloudStoreContext,
  documentId: string,
  expectedRevision: string,
): Promise<void> {
  await requestJson(
    context,
    `${getRagDocumentsPath(context)}/${encodeURIComponent(documentId)}?expected_revision=${
      encodeURIComponent(expectedRevision)
    }`,
    { method: "DELETE" },
    { allowNotFound: true },
  );
}

async function listDocumentPartFiles(
  context: CloudStoreContext,
  documentId: string,
): Promise<{ paths: string[]; errors: unknown[] }> {
  // Generated document IDs are one path segment. Never let a supplied glob or
  // separator select another document's namespace.
  if (!/^[A-Za-z0-9_-]+$/.test(documentId)) return { paths: [], errors: [] };
  const prefix = `${DOCUMENTS_DIR}/${documentId}.`;
  const paths: string[] = [];
  const errors: unknown[] = [];
  const cursors = new Set<string>();
  let cursor: string | null | undefined;
  do {
    const query = new URLSearchParams({
      branch: context.branch,
      pattern: `${prefix}*`,
      limit: "100",
      fields: "(path)",
    });
    if (cursor) query.set("cursor", cursor);
    let response: CloudFileListResponse | null;
    try {
      response = await requestJson<CloudFileListResponse>(
        context,
        `/projects/${encodeURIComponent(context.projectSlug)}/files?${query}`,
      );
    } catch (error) {
      errors.push(error);
      break;
    }
    const candidates = (response?.data ?? []).map((file) => file.path).filter((path) =>
      path.startsWith(prefix) && !path.slice(prefix.length).includes("/")
    );
    // Chunk deletion retains the file node and its immutable history. Do not
    // repeatedly add acknowledged empty generations back to the cleanup journal.
    for (let offset = 0; offset < candidates.length; offset += MAX_PART_READ_CONCURRENCY) {
      const results = await Promise.allSettled(
        candidates.slice(offset, offset + MAX_PART_READ_CONCURRENCY).map(async (path) => {
          const chunks = await requestJson<CloudChunkListResponse>(
            context,
            `${getFileChunksPath(context, path)}?limit=1`,
            {},
            { allowNotFound: true },
          );
          return chunks?.data.length ? path : null;
        }),
      );
      for (const result of results) {
        if (result.status === "rejected") errors.push(result.reason);
        else if (result.value) paths.push(result.value);
      }
    }
    cursor = response?.page_info?.next;
    if (cursor && cursors.has(cursor)) {
      errors.push(INVALID_ARGUMENT.create({ detail: "Document file listing repeated a cursor." }));
      break;
    }
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return { paths, errors };
}

// ---------------------------------------------------------------------------
// Document ingestion (chunks + embeddings + server-side record)
// ---------------------------------------------------------------------------

async function ingestDocument(
  context: CloudStoreContext,
  config: ResolvedCloudRagStoreConfig,
  title: string,
  text: string,
  meta?: { source?: string; type?: string },
): Promise<string> {
  const documentId = crypto.randomUUID();
  await writeDocumentContent(context, config, documentId, title, text, meta);
  return documentId;
}

async function refreshCloudDocument(
  context: CloudStoreContext,
  config: ResolvedCloudRagStoreConfig,
  documentId: string,
  text: string,
  meta?: RagRefreshOptions,
): Promise<void> {
  const documents = await listRagDocuments(context);
  const existing = documents.find((doc) => doc.id === documentId);
  if (!existing) {
    throw INVALID_ARGUMENT.create({ detail: `RAG document not found: ${documentId}` });
  }
  const expectedRevision = requireDocumentRevision(existing);

  const type = meta?.type ?? existing.type;
  const discovery = await listDocumentPartFiles(context, documentId);
  if (discovery.errors.length) throw discovery.errors[0];
  // Capture pre-existing parts before writing a new generation. Only retire
  // them after the revision-guarded metadata update succeeds.
  const previousFilePaths = [
    ...new Set([
      ...documentFilePaths(existing),
      ...discovery.paths,
    ]),
  ];
  const inheritedCleanupPaths = retiredDocumentPaths(
    existing,
    buildDocumentFilePath(documentId, existing.type),
  );
  const filePath = buildRefreshDocumentFilePath(documentId, type);

  const pendingCleanupPaths = await writeDocumentContent(
    context,
    config,
    documentId,
    meta?.title ?? existing.title,
    text,
    {
      source: meta?.source ?? existing.source,
      type,
    },
    { filePath, previousFilePaths, inheritedCleanupPaths, expectedRevision },
  );

  const cleanupFailures = await retireDocumentParts(
    pendingCleanupPaths,
    (path) => deleteFileChunks(context, path),
  );
  if (cleanupFailures.length > 0) throw cleanupFailures[0]!.error;
}

function requireDocumentRevision(document: CloudRagDocumentMeta): string {
  if (typeof document.revision !== "string" || !/^[a-f0-9]{64}$/.test(document.revision)) {
    throw INVALID_ARGUMENT.create({
      detail:
        "The document revision is unavailable. Update Veryfront Cloud before changing this document.",
    });
  }
  return document.revision;
}

async function writeDocumentContent(
  context: CloudStoreContext,
  config: ResolvedCloudRagStoreConfig,
  documentId: string,
  title: string,
  text: string,
  meta?: { source?: string; type?: string },
  options?: {
    filePath?: string;
    previousFilePaths?: string[];
    inheritedCleanupPaths?: string[];
    expectedRevision?: string;
  },
): Promise<string[]> {
  if (text.length > MAX_TEXT_LENGTH) {
    throw INVALID_ARGUMENT.create({
      detail: `Upload text exceeds ${MAX_TEXT_LENGTH / 1024 / 1024} MB limit`,
    });
  }

  const chunkTexts = await chunk(text, config.chunkOptions);
  if (chunkTexts.length === 0) {
    throw INVALID_ARGUMENT.create({ detail: "Upload contains no extractable text" });
  }

  const filePath = options?.filePath ?? buildDocumentFilePath(documentId, meta?.type);
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
  const filePaths = buildChunkFilePaths(filePath, chunkInputs.length);
  // Compact acknowledged historical cleanup before publishing the next record.
  // Active previous parts remain until the replacement is committed.
  const inheritedFailures = await retireDocumentParts(
    options?.inheritedCleanupPaths ?? [],
    (path) => deleteFileChunks(context, path),
  );
  const pendingCleanupPaths = [
    ...(options?.previousFilePaths ?? []),
    ...inheritedFailures.map((failure) => failure.path),
  ];
  let metadataWriteAttempted = false;

  try {
    const createdChunks = await upsertFileChunks(context, filePaths, chunkInputs);
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
    metadataWriteAttempted = true;
    await upsertRagDocument(context, {
      id: documentId,
      title,
      source: meta?.source ?? "",
      type: meta?.type ?? "",
      metadata: documentPartsMetadata(filePaths, pendingCleanupPaths),
      expectedRevision: options?.expectedRevision ?? null,
    });
  } catch (error) {
    if (metadataWriteAttempted) {
      let current: CloudRagDocumentMeta | undefined;
      try {
        current = (await listRagDocuments(context)).find((document) => document.id === documentId);
      } catch {
        // Without a readable result, the metadata write may have committed.
        throw error;
      }
      const upstreamStatus = error instanceof VeryfrontError && isRecord(error.context)
        ? error.context.upstreamStatus
        : undefined;
      const outcome = metadataWriteOutcome(
        filePaths,
        current ? documentFilePaths(current) : [],
        upstreamStatus,
      );
      if (outcome === "committed") return pendingCleanupPaths;
      if (outcome !== "rejected") {
        // Transport and gateway failures can leave the write in flight. Retain
        // the parts until its outcome is known instead of deleting live data.
        throw error;
      }
    }
    for (const cleanupPath of filePaths) {
      await deleteFileChunks(context, cleanupPath).catch((cleanupError) =>
        serverLogger.debug("[rag-store/cloud] file chunk cleanup failed", {
          filePath: cleanupPath,
          error: cleanupError,
        })
      );
    }
    throw error;
  }
  return pendingCleanupPaths;
}

function createEmbedder(config: ResolvedCloudRagStoreConfig) {
  return embedding({
    model: config.model,
    documentPrefix: config.documentPrefix,
    queryPrefix: config.queryPrefix,
    batchSize: config.batchSize,
  });
}

async function listContentFiles(
  contentDir: string,
  contentExtensions: Set<string>,
): Promise<ContentFile[]> {
  const files: ContentFile[] = [];

  try {
    for await (const entry of readDir(contentDir)) {
      const fullPath = join(contentDir, entry.name);
      if (entry.isDirectory) {
        files.push(...(await listContentFiles(fullPath, contentExtensions)));
      } else if (entry.isFile && contentExtensions.has(extname(entry.name))) {
        files.push({ path: fullPath });
      }
    }
  } catch (_) {
    // expected: directory may not exist yet
  }

  return files;
}

function buildContentDirPattern(contentDir: string): string {
  return `${contentDir.replace(/\/+$/, "")}/**`;
}

function buildContentFilesQuery(
  context: CloudStoreContext,
  contentDir: string,
  cursor?: string | null,
): string {
  const params = new URLSearchParams({
    include_server_functions: "true",
    limit: "100",
    pattern: buildContentDirPattern(contentDir),
  });

  if (!context.releaseId && !context.environmentName) {
    params.set("branch", context.branch);
  }

  if (cursor) {
    params.set("cursor", cursor);
  }

  return params.toString();
}

function getPublishedFileListPath(
  context: CloudStoreContext,
  contentDir: string,
  cursor?: string | null,
): string {
  const query = buildContentFilesQuery(context, contentDir, cursor);
  const projectRef = encodeURIComponent(context.projectSlug);

  if (context.releaseId) {
    return `/projects/${projectRef}/releases/${
      encodeURIComponent(context.releaseId)
    }/files?${query}`;
  }

  if (context.environmentName) {
    return `/projects/${projectRef}/environments/${
      encodeURIComponent(context.environmentName)
    }/files?${query}`;
  }

  return `/projects/${projectRef}/files?${query}`;
}

function getPublishedFileDetailPath(context: CloudStoreContext, path: string): string {
  const query = new URLSearchParams({ include_server_functions: "true" });
  const projectRef = encodeURIComponent(context.projectSlug);
  const encodedPath = encodeURIComponent(path);

  if (context.releaseId) {
    return `/projects/${projectRef}/releases/${
      encodeURIComponent(context.releaseId)
    }/files/${encodedPath}?${query}`;
  }

  if (context.environmentName) {
    return `/projects/${projectRef}/environments/${
      encodeURIComponent(context.environmentName)
    }/files/${encodedPath}?${query}`;
  }

  query.set("branch", context.branch);
  return `/projects/${projectRef}/files/${encodedPath}?${query}`;
}

async function listPublishedContentFiles(
  context: CloudStoreContext,
  contentDir: string,
  contentExtensions: Set<string>,
): Promise<ContentFile[]> {
  const files: ContentFile[] = [];
  let cursor: string | null | undefined;

  do {
    const response = await requestJson<CloudFileListResponse>(
      context,
      getPublishedFileListPath(context, contentDir, cursor),
    );

    files.push(
      ...(response?.data ?? [])
        .filter((file) => contentExtensions.has(extname(file.path)))
        .map((file) => ({ path: file.path, content: file.content })),
    );

    cursor = response?.page_info?.next ?? null;
  } while (cursor);

  return files;
}

async function readContentFile(
  context: CloudStoreContext,
  file: ContentFile,
): Promise<string> {
  if (file.content !== undefined) return file.content;
  if (!context.hasRequestContext) return readTextFile(file.path);

  const response = await requestJson<CloudFileDetailResponse>(
    context,
    getPublishedFileDetailPath(context, file.path),
  );

  return response?.content ?? "";
}

export function createVeryfrontCloudRagStore(config: ResolvedCloudRagStoreConfig): RagStore {
  const contentDir = config.contentDir;
  const contentExtensions = new Set(config.contentExtensions ?? [".md", ".mdx", ".txt"]);

  return {
    async ingest(
      title: string,
      text: string,
      meta?: { source?: string; type?: string },
    ): Promise<string> {
      const context = getCloudStoreContext(config);
      return ingestDocument(context, config, title, text, meta);
    },

    async refreshDocument(
      id: string,
      text: string,
      meta?: RagRefreshOptions,
    ): Promise<void> {
      const context = getCloudStoreContext(config);
      await refreshCloudDocument(context, config, id, text, meta);
    },

    async search(
      query: string,
      options?: RagSearchOptions,
    ): Promise<RagSearchResult[]> {
      if (!query.trim()) return [];
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
      const context = getCloudStoreContext(config);
      const documents = await listRagDocuments(context);
      return documents.map(toPublicRagDocumentMeta);
    },

    async removeDocument(id: string): Promise<void> {
      const context = getCloudStoreContext(config);

      // Fetch document metadata to find every file part for chunk cleanup.
      const documents = await listRagDocuments(context);
      const target = documents.find((doc) => doc.id === id);

      // Preserve record-first deletion so a refresh starting during cleanup
      // cannot publish a replacement through a still-visible document.
      if (target) await deleteRagDocument(context, id, requireDocumentRevision(target));
      // The file namespace also owns parts whose metadata acknowledgement was
      // lost. Read it after deletion, so a retry can collect them even when the
      // document record is already absent.
      const discovery = await listDocumentPartFiles(context, id);
      const paths = [
        ...discovery.paths,
        ...(target ? documentFilePaths(target) : []),
        ...(target ? retiredDocumentPaths(target, buildDocumentFilePath(id, target.type)) : []),
      ];
      const failures = await retireDocumentParts(
        paths,
        (path) => deleteFileChunks(context, path),
      );
      for (const failure of failures) {
        serverLogger.warn("[rag-store/cloud] Failed to clean up file chunks for document", {
          id,
          filePath: failure.path,
          error: failure.error instanceof Error ? failure.error.message : String(failure.error),
        });
      }
      if (discovery.errors.length) throw discovery.errors[0];
    },

    async indexContentDir(): Promise<void> {
      if (!contentDir) return;

      const context = getCloudStoreContext(config);
      const existingDocuments = await listRagDocuments(context);
      const indexedSources = new Set(existingDocuments.map((doc) => doc.source));
      const files = context.hasRequestContext
        ? await listPublishedContentFiles(context, contentDir, contentExtensions)
        : await listContentFiles(contentDir, contentExtensions);
      const newFiles = files.filter((file) => !indexedSources.has(file.path));

      for (const file of newFiles) {
        const content = await readContentFile(context, file);
        if (!content?.trim()) continue;
        if (content.length > MAX_TEXT_LENGTH) {
          serverLogger.warn(
            `[rag-store/cloud] Skipping ${file.path}: exceeds ${
              MAX_TEXT_LENGTH / 1024 / 1024
            } MB text limit`,
          );
          continue;
        }

        const title = file.path.startsWith(contentDir + "/")
          ? file.path.slice(contentDir.length + 1).replace(/\.[^.]+$/, "")
          : file.path.replace(/\.[^.]+$/, "");
        const type = extname(file.path).slice(1);

        await ingestDocument(context, config, title, content, {
          source: file.path,
          type,
        });
      }
    },
  };
}
