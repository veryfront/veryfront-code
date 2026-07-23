import { isNotFoundError, readDir, readTextFile, stat } from "#veryfront/platform/compat/fs.ts";
import { extname, join } from "#veryfront/platform/compat/path/basic-operations.ts";
import { isAbsolute } from "#veryfront/platform/compat/path/resolution.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { API_ERROR, CONFIG_INVALID, INVALID_ARGUMENT } from "#veryfront/errors";
import { serverLogger } from "#veryfront/utils";
import {
  createVeryfrontCloudFetch,
  requireVeryfrontCloudBootstrap,
} from "#veryfront/provider/veryfront-cloud/shared.ts";
import { chunk } from "../chunk.ts";
import { embedding } from "../embedding.ts";
import type {
  RagDocumentMeta,
  RagIngestMetadata,
  RagRefreshOptions,
  RagSearchOptions,
  RagSearchResult,
  RagStore,
  RagStoreConfig,
} from "../types.ts";
import {
  MAX_IDENTIFIER_LENGTH,
  MAX_PATH_LENGTH,
  MAX_RAG_TEXT_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_TYPE_LENGTH,
  throwIfAborted,
  validateBoundedString,
  validateRagTitle,
} from "../validation.ts";
import { embeddingFailureContext } from "../logging.ts";
import { buildContentFileSource } from "../content-source.ts";

const DEFAULT_TOP_K = 5;
const MAX_API_CHUNK_BATCH = 500;
const MAX_API_EMBEDDING_BATCH = 100;
const MAX_SEARCH_LIMIT = 100;
const DOCUMENTS_DIR = ".veryfront/rag/documents";
const MAX_CLOUD_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_CLOUD_DOCUMENTS = 10_000;
const MAX_CONTENT_FILES = 10_000;
const MAX_CONTENT_PAGES = 100;
const MAX_CONTENT_DEPTH = 32;
const MAX_CONTENT_FILE_BYTES = MAX_RAG_TEXT_LENGTH * 4;

type SupportedDimension = 768 | 1024 | 1536 | 3072 | 4096;

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

type CloudRagDocumentMeta = RagDocumentMeta & { filePath?: string };

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

interface CloudRagSearchMetadata {
  kind: "rag-document";
  document_id: string;
  title: string;
  source: string;
  type: string;
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

function buildDocumentFilePath(documentId: string, type?: string): string {
  const extension = type?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${DOCUMENTS_DIR}/${documentId}.${extension || "txt"}`;
}

function buildRefreshDocumentFilePath(documentId: string, type?: string): string {
  const extension = type?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${DOCUMENTS_DIR}/${documentId}.refresh-${crypto.randomUUID()}.${extension || "txt"}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximum: number, allowEmpty = true): value is string {
  return typeof value === "string" && value.length <= maximum &&
    (allowEmpty || value.trim().length > 0);
}

function parseCloudRagSearchMetadata(value: unknown): CloudRagSearchMetadata | null {
  if (!isRecord(value) || value.kind !== "rag-document") return null;
  if (
    !isBoundedString(value.document_id, MAX_IDENTIFIER_LENGTH, false) ||
    !isBoundedString(value.title, MAX_TITLE_LENGTH, false) ||
    !isBoundedString(value.source, MAX_SOURCE_LENGTH) ||
    !isBoundedString(value.type, MAX_TYPE_LENGTH)
  ) {
    throw API_ERROR.create({
      detail: "Veryfront Cloud returned invalid RAG search metadata",
    });
  }
  return {
    kind: "rag-document",
    document_id: value.document_id,
    title: value.title,
    source: value.source,
    type: value.type,
  };
}

function isCloudRagDocument(value: unknown): value is CloudRagDocumentResponse {
  if (!isRecord(value)) return false;
  const createdAt = typeof value.created_at === "string"
    ? new Date(value.created_at).getTime()
    : Number.NaN;
  const updatedAt = typeof value.updated_at === "string"
    ? new Date(value.updated_at).getTime()
    : Number.NaN;
  return isBoundedString(value.id, MAX_IDENTIFIER_LENGTH, false) &&
    isBoundedString(value.title, MAX_TITLE_LENGTH, false) &&
    isBoundedString(value.source, MAX_SOURCE_LENGTH) &&
    isBoundedString(value.type, MAX_TYPE_LENGTH) &&
    Number.isFinite(createdAt) && Number.isFinite(updatedAt) &&
    (value.metadata === undefined ||
      (isRecord(value.metadata) &&
        (value.metadata.filePath === undefined ||
          isBoundedString(value.metadata.filePath, MAX_PATH_LENGTH, false))));
}

function assertCloudDocumentList(value: unknown): asserts value is CloudListRagDocumentsResponse {
  if (
    !isRecord(value) || !Array.isArray(value.documents) ||
    value.documents.length > MAX_CLOUD_DOCUMENTS ||
    !value.documents.every(isCloudRagDocument)
  ) {
    throw API_ERROR.create({
      detail: "Veryfront Cloud returned an invalid RAG document response",
    });
  }
  const ids = new Set<string>();
  for (const document of value.documents) {
    if (ids.has(document.id)) {
      throw API_ERROR.create({
        detail: "Veryfront Cloud returned duplicate RAG document IDs",
      });
    }
    ids.add(document.id);
  }
}

function assertCloudChunkUpsert(
  value: unknown,
  expectedIndexes: Set<number>,
): asserts value is CloudUpsertChunksResponse {
  if (!isRecord(value) || !Array.isArray(value.chunks)) {
    throw API_ERROR.create({
      detail: "Veryfront Cloud returned an invalid chunk response",
    });
  }
  const ids = new Set<string>();
  const indexes = new Set<number>();
  for (const entry of value.chunks) {
    if (
      !isRecord(entry) || !isBoundedString(entry.id, MAX_IDENTIFIER_LENGTH, false) ||
      !Number.isSafeInteger(entry.index) || Number(entry.index) < 0 ||
      !expectedIndexes.has(Number(entry.index)) || ids.has(entry.id) ||
      indexes.has(Number(entry.index))
    ) {
      throw API_ERROR.create({
        detail: "Veryfront Cloud returned an invalid chunk response",
      });
    }
    ids.add(entry.id);
    indexes.add(Number(entry.index));
  }
  if (indexes.size !== expectedIndexes.size) {
    throw API_ERROR.create({
      detail: "Veryfront Cloud returned an incomplete chunk response",
    });
  }
}

function assertCloudSearchResponse(value: unknown): asserts value is CloudSearchResponse {
  if (!isRecord(value) || !Array.isArray(value.data) || value.data.length > MAX_SEARCH_LIMIT) {
    throw API_ERROR.create({
      detail: "Veryfront Cloud returned an invalid search response",
    });
  }
  for (const result of value.data) {
    if (
      !isRecord(result) || typeof result.score !== "number" || !Number.isFinite(result.score) ||
      !isRecord(result.chunk) ||
      !isBoundedString(result.chunk.file_path, MAX_PATH_LENGTH, false) ||
      !isBoundedString(result.chunk.content, MAX_RAG_TEXT_LENGTH) ||
      (result.chunk.metadata !== undefined && !isRecord(result.chunk.metadata))
    ) {
      throw API_ERROR.create({
        detail: "Veryfront Cloud returned an invalid search response",
      });
    }
  }
}

function assertCloudFileList(value: unknown): asserts value is CloudFileListResponse {
  if (!isRecord(value) || !Array.isArray(value.data) || value.data.length > 100) {
    throw API_ERROR.create({ detail: "Veryfront Cloud returned an invalid file response" });
  }
  for (const file of value.data) {
    if (
      !isRecord(file) || !isBoundedString(file.path, MAX_PATH_LENGTH, false) ||
      (file.content !== undefined && !isBoundedString(file.content, MAX_RAG_TEXT_LENGTH))
    ) {
      throw API_ERROR.create({
        detail: "Veryfront Cloud returned an invalid file response",
      });
    }
  }
  const pageInfo = value.page_info;
  if (
    pageInfo !== undefined &&
    (!isRecord(pageInfo) ||
      (pageInfo.next !== undefined && pageInfo.next !== null &&
        !isBoundedString(pageInfo.next, MAX_PATH_LENGTH, false)))
  ) {
    throw API_ERROR.create({ detail: "Veryfront Cloud returned an invalid file response" });
  }
}

function assertCloudFileDetail(value: unknown): asserts value is CloudFileDetailResponse {
  if (
    !isRecord(value) || !isBoundedString(value.path, MAX_PATH_LENGTH, false) ||
    !isBoundedString(value.content, MAX_RAG_TEXT_LENGTH)
  ) {
    throw API_ERROR.create({ detail: "Veryfront Cloud returned an invalid file response" });
  }
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
    const foundAt = sourceText.indexOf(content, Math.max(0, searchStart - content.length));
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

async function requestJson(
  context: CloudStoreContext,
  path: string,
  init?: RequestInit,
  options?: { allowNotFound?: boolean },
): Promise<unknown | null> {
  const request = new Request(buildUrl(context.apiBaseUrl, path), init);
  const headers = new Headers(request.headers);

  if (request.method !== "GET" && request.method !== "HEAD") {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await context.fetch(new Request(request, { headers }));
  } catch {
    throwIfAborted(init?.signal ?? undefined);
    throw API_ERROR.create({ detail: "Veryfront Cloud RAG request could not be completed" });
  }
  if (options?.allowNotFound && response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw API_ERROR.create({
      detail: `Veryfront Cloud RAG request failed with status ${response.status}`,
    });
  }

  if (response.status === 204) {
    return null;
  }

  const text = await readBoundedResponseText(response);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw API_ERROR.create({
      detail: "Veryfront Cloud RAG returned an invalid JSON response",
    });
  }
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_CLOUD_RESPONSE_BYTES)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw API_ERROR.create({
      detail: "Veryfront Cloud RAG response exceeds the supported size",
    });
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_CLOUD_RESPONSE_BYTES) {
        await reader.cancel();
        throw API_ERROR.create({
          detail: "Veryfront Cloud RAG response exceeds the supported size",
        });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function getCloudStoreContext(config: RagStoreConfig): CloudStoreContext {
  const bootstrap = requireVeryfrontCloudBootstrap();
  const requestContext = getCurrentRequestContext();
  if (!isContextIdentifier(bootstrap.projectSlug)) {
    throw CONFIG_INVALID.create({
      detail:
        "Veryfront Cloud project context is missing or invalid. Configure a project slug before using the cloud RAG store.",
    });
  }
  const branch = config.branch ?? requestContext?.branch ?? "main";
  const environmentName = requestContext?.environmentName ?? null;
  const releaseId = requestContext?.releaseId ?? null;
  if (
    !isContextIdentifier(branch) ||
    (environmentName !== null && !isContextIdentifier(environmentName)) ||
    (releaseId !== null && !isContextIdentifier(releaseId))
  ) {
    throw CONFIG_INVALID.create({ detail: "Veryfront Cloud RAG context is invalid" });
  }

  return {
    apiBaseUrl: bootstrap.apiBaseUrl,
    fetch: createVeryfrontCloudFetch(bootstrap.apiToken, undefined, bootstrap.apiBaseUrl),
    projectSlug: bootstrap.projectSlug,
    branch,
    environmentName,
    hasRequestContext: requestContext !== null,
    releaseId,
  };
}

function isContextIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH && value === value.trim() && !/\p{C}/u.test(value);
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
  filePath: string,
  chunks: ChunkMutationInput[],
): Promise<Array<{ id: string; index: number }>> {
  if (chunks.length === 0) {
    return [];
  }

  const results: Array<{ id: string; index: number }> = [];
  for (let i = 0; i < chunks.length; i += MAX_API_CHUNK_BATCH) {
    const batch = chunks.slice(i, i + MAX_API_CHUNK_BATCH);
    const response = await requestJson(
      context,
      getFileChunksPath(context, filePath),
      {
        method: "POST",
        body: JSON.stringify({ chunks: batch }),
      },
    );

    const expectedIndexes = new Set(batch.map((entry) => entry.chunk_index));
    assertCloudChunkUpsert(response, expectedIndexes);
    results.push(...response.chunks);
  }

  results.sort((a, b) => a.index - b.index);
  if (new Set(results.map((entry) => entry.id)).size !== results.length) {
    throw API_ERROR.create({ detail: "Veryfront Cloud returned duplicate chunk IDs" });
  }
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
  const response = await requestJson(
    context,
    getRagDocumentsPath(context),
  );
  assertCloudDocumentList(response);

  return response.documents.map((doc) => ({
    id: doc.id,
    title: doc.title,
    source: doc.source,
    type: doc.type,
    createdAt: new Date(doc.created_at).getTime(),
    filePath: typeof doc.metadata?.filePath === "string" ? doc.metadata.filePath : undefined,
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
  },
): Promise<void> {
  await requestJson(
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
      }),
    },
  );
}

async function deleteRagDocument(
  context: CloudStoreContext,
  documentId: string,
): Promise<void> {
  await requestJson(
    context,
    `${getRagDocumentsPath(context)}/${encodeURIComponent(documentId)}`,
    { method: "DELETE" },
    { allowNotFound: true },
  );
}

// ---------------------------------------------------------------------------
// Document ingestion (chunks + embeddings + server-side record)
// ---------------------------------------------------------------------------

async function ingestDocument(
  context: CloudStoreContext,
  config: ResolvedCloudRagStoreConfig,
  title: string,
  text: string,
  meta?: RagIngestMetadata,
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
    throw INVALID_ARGUMENT.create({ detail: "RAG document was not found" });
  }

  const type = meta?.type ?? existing.type;
  const previousFilePath = existing.filePath ?? buildDocumentFilePath(documentId, existing.type);
  const filePath = buildRefreshDocumentFilePath(documentId, type);

  await writeDocumentContent(
    context,
    config,
    documentId,
    meta?.title ?? existing.title,
    text,
    {
      source: meta?.source ?? existing.source,
      type,
    },
    { filePath },
  );

  if (previousFilePath !== filePath) {
    await deleteFileChunks(context, previousFilePath);
  }
}

async function writeDocumentContent(
  context: CloudStoreContext,
  config: ResolvedCloudRagStoreConfig,
  documentId: string,
  title: string,
  text: string,
  meta?: RagIngestMetadata,
  options?: { filePath?: string },
): Promise<void> {
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

  try {
    const createdChunks = await upsertFileChunks(context, filePath, chunkInputs);
    const chunkIds = createdChunks.map((entry) => entry.id);

    if (chunkIds.length !== vectors.length) {
      throw API_ERROR.create({
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

    await upsertRagDocument(context, {
      id: documentId,
      title,
      source: meta?.source ?? "",
      type: meta?.type ?? "",
      metadata: { filePath },
    });
  } catch (error) {
    await deleteFileChunks(context, filePath).catch((cleanupError) =>
      serverLogger.debug(
        "[rag-store/cloud] File chunk cleanup failed",
        embeddingFailureContext(cleanupError),
      )
    );
    throw error;
  }
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
  depth = 0,
): Promise<ContentFile[]> {
  if (depth > MAX_CONTENT_DEPTH) {
    throw INVALID_ARGUMENT.create({ detail: "RAG content directory nesting is too deep" });
  }
  const files: ContentFile[] = [];

  try {
    if (depth === 0) {
      const info = await stat(contentDir);
      if (!info.isDirectory) {
        throw API_ERROR.create({ detail: "RAG content files could not be read" });
      }
    }
    for await (const entry of readDir(contentDir)) {
      const fullPath = join(contentDir, entry.name);
      if (entry.isDirectory) {
        files.push(...(await listContentFiles(fullPath, contentExtensions, depth + 1)));
      } else if (entry.isFile && contentExtensions.has(extname(entry.name).toLowerCase())) {
        files.push({ path: fullPath });
      }
      if (files.length > MAX_CONTENT_FILES) {
        throw INVALID_ARGUMENT.create({
          detail: `RAG content indexing supports at most ${MAX_CONTENT_FILES} files`,
        });
      }
    }
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw API_ERROR.create({ detail: "RAG content files could not be read" });
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
  const seenCursors = new Set<string>();
  const seenPaths = new Set<string>();
  let pageCount = 0;

  do {
    if (++pageCount > MAX_CONTENT_PAGES) {
      throw API_ERROR.create({
        detail: "Veryfront Cloud file pagination exceeded its limit",
      });
    }
    const response = await requestJson(
      context,
      getPublishedFileListPath(context, contentDir, cursor),
    );
    assertCloudFileList(response);

    for (const file of response.data) {
      if (seenPaths.has(file.path)) {
        throw API_ERROR.create({
          detail: "Veryfront Cloud returned duplicate content file paths",
        });
      }
      seenPaths.add(file.path);
    }

    files.push(
      ...response.data
        .filter((file) => contentExtensions.has(extname(file.path).toLowerCase()))
        .map((file) => ({ path: file.path, content: file.content })),
    );
    if (files.length > MAX_CONTENT_FILES) {
      throw INVALID_ARGUMENT.create({
        detail: `RAG content indexing supports at most ${MAX_CONTENT_FILES} files`,
      });
    }

    cursor = response.page_info?.next ?? null;
    if (cursor && seenCursors.has(cursor)) {
      throw API_ERROR.create({ detail: "Veryfront Cloud pagination cursor repeated" });
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);

  return files;
}

async function readContentFile(
  context: CloudStoreContext,
  file: ContentFile,
  published: boolean,
): Promise<string> {
  if (file.content !== undefined) return file.content;
  if (!published) {
    try {
      const info = await stat(file.path);
      if (info.size > MAX_CONTENT_FILE_BYTES) {
        serverLogger.warn("[rag-store/cloud] Skipping an oversized content file");
        return "";
      }
      return await readTextFile(file.path);
    } catch {
      throw API_ERROR.create({ detail: "RAG content files could not be read" });
    }
  }

  const response = await requestJson(
    context,
    getPublishedFileDetailPath(context, file.path),
  );

  assertCloudFileDetail(response);
  if (response.path !== file.path) {
    throw API_ERROR.create({ detail: "Veryfront Cloud returned an invalid file response" });
  }
  return response.content;
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
      throwIfAborted(options?.signal);
      const context = getCloudStoreContext(config);
      const queryEmbedder = createEmbedder(config);
      const vector = await queryEmbedder.embed(query, { signal: options?.signal });
      const topK = options?.topK ?? DEFAULT_TOP_K;
      const dimension = toSupportedDimension(vector.length);
      const response = await requestJson(
        context,
        getSearchPath(context),
        {
          method: "POST",
          signal: options?.signal,
          body: JSON.stringify({
            vector,
            dimension,
            limit: MAX_SEARCH_LIMIT,
            threshold: options?.threshold ?? 0,
          }),
        },
      );
      assertCloudSearchResponse(response);

      const results = response.data.flatMap((result): RagSearchResult[] => {
        const metadata = parseCloudRagSearchMetadata(result.chunk.metadata);
        return metadata === null ? [] : [{
          text: result.chunk.content,
          score: result.score,
          documentId: metadata.document_id,
          title: metadata.title,
          source: metadata.source,
          type: metadata.type,
        }];
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

      // Fetch document metadata to find its filePath for chunk cleanup
      const documents = await listRagDocuments(context);
      const target = documents.find((doc) => doc.id === id);

      if (target) {
        const filePath = target.filePath ?? buildDocumentFilePath(id, target.type);
        await deleteFileChunks(context, filePath);
      }
      await deleteRagDocument(context, id);
    },

    async indexContentDir(): Promise<void> {
      if (!contentDir) return;

      const context = getCloudStoreContext(config);
      const existingDocuments = await listRagDocuments(context);
      const indexedSources = new Set(existingDocuments.map((doc) => doc.source));
      const usePublishedContent = context.hasRequestContext && !isAbsolute(contentDir);
      const files = usePublishedContent
        ? await listPublishedContentFiles(context, contentDir, contentExtensions)
        : await listContentFiles(contentDir, contentExtensions);
      const fileEntries = files.map((file) => {
        return {
          file,
          ...buildContentFileSource(contentDir, file.path, {
            preserveContentDir: usePublishedContent,
          }),
        };
      });
      const newFiles = fileEntries.filter(({ file, source }) =>
        !indexedSources.has(source) && !indexedSources.has(file.path)
      );

      for (const { file, relativeSource, source } of newFiles) {
        const content = await readContentFile(context, file, usePublishedContent);
        if (!content?.trim()) continue;
        if (content.length > MAX_RAG_TEXT_LENGTH) {
          serverLogger.warn(
            "[rag-store/cloud] Skipping an oversized content file",
          );
          continue;
        }

        const title = relativeSource.replace(/\.[^.]+$/, "");
        const type = extname(file.path).slice(1);
        validateRagTitle(title);
        validateBoundedString(source, "RAG document source", MAX_SOURCE_LENGTH, {
          allowEmpty: true,
        });
        validateBoundedString(type, "RAG document type", MAX_TYPE_LENGTH, {
          allowEmpty: true,
        });

        await ingestDocument(context, config, title, content, {
          source,
          type,
        });
      }
    },
  };
}
