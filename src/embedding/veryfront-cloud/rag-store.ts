import { isNotFoundError, readDir, readTextFile } from "#veryfront/platform/compat/fs.ts";
import { extname, join } from "#veryfront/platform/compat/path/basic-operations.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import {
  INVALID_ARGUMENT,
  isVeryfrontError,
  NETWORK_ERROR,
  TIMEOUT_ERROR,
} from "#veryfront/errors";
import { serverLogger } from "#veryfront/utils";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import {
  createVeryfrontCloudFetch,
  requireVeryfrontCloudBootstrap,
} from "#veryfront/provider/veryfront-cloud/shared.ts";
import { chunk } from "../chunk.ts";
import { embedding } from "../embedding.ts";
import { requirePositiveSafeInteger, requireUnitInterval } from "../validation.ts";
import type {
  RagDocumentMeta,
  RagRefreshOptions,
  RagSearchOptions,
  RagSearchResult,
  RagStore,
  RagStoreConfig,
} from "../types.ts";

const DEFAULT_TOP_K = 5;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_API_CHUNK_BATCH = 500;
const MAX_API_EMBEDDING_BATCH = 100;
const MAX_SEARCH_LIMIT = 100;
const SEARCH_OVERSCAN = 25;
const DOCUMENTS_DIR = ".veryfront/rag/documents";
const CLOUD_REQUEST_TIMEOUT_MS = 30_000;
const MAX_CLOUD_JSON_BYTES = 8 * 1024 * 1024;
const MAX_CLOUD_ERROR_BYTES = 16 * 1024;
const MAX_CLOUD_DOCUMENTS = 10_000;
const MAX_CLOUD_FILE_PAGES = 100;
const MAX_CLOUD_CONTENT_FILES = 10_000;
const MAX_CLOUD_INLINE_CONTENT_BYTES = 64 * 1024 * 1024;

type SupportedDimension = 768 | 1024 | 1536 | 3072 | 4096;

interface CloudUpsertChunksResponse {
  chunks: Array<{ id: string; index: number }>;
}

interface CloudUpsertEmbeddingsResponse {
  embeddings: Array<{ id: string }>;
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

type CloudRagDocumentMeta = RagDocumentMeta & {
  branch: string;
  filePath?: string;
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function invalidCloudResponse(detail: string): never {
  throw NETWORK_ERROR.create({
    detail: `Veryfront Cloud RAG response failed validation: ${detail}`,
  });
}

function parseCloudChunkMutationResponse(
  value: unknown,
  expectedCount: number,
): CloudUpsertChunksResponse {
  if (!isRecord(value) || !Array.isArray(value.chunks)) {
    invalidCloudResponse("chunk mutation response must contain a chunks array");
  }
  if (value.chunks.length !== expectedCount) {
    invalidCloudResponse(
      `chunk mutation returned ${value.chunks.length} entries for ${expectedCount} chunks`,
    );
  }
  const chunks = value.chunks.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      !entry.id ||
      !Number.isSafeInteger(entry.index) ||
      Number(entry.index) < 0
    ) {
      invalidCloudResponse(`chunk mutation entry ${index} is malformed`);
    }
    return { id: entry.id, index: entry.index as number };
  });
  return { chunks };
}

function parseCloudEmbeddingMutationResponse(
  value: unknown,
  expectedCount: number,
): CloudUpsertEmbeddingsResponse {
  if (!isRecord(value) || !Array.isArray(value.embeddings)) {
    invalidCloudResponse(
      "embedding mutation response must contain an embeddings array",
    );
  }
  if (value.embeddings.length !== expectedCount) {
    invalidCloudResponse(
      `embedding mutation returned ${value.embeddings.length} entries for ${expectedCount} vectors`,
    );
  }
  const embeddings = value.embeddings.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id) {
      invalidCloudResponse(`embedding mutation entry ${index} is malformed`);
    }
    return { id: entry.id };
  });
  return { embeddings };
}

function parseCloudRagDocument(
  value: unknown,
  index: number,
): CloudRagDocumentResponse {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.title !== "string" ||
    typeof value.source !== "string" ||
    typeof value.type !== "string" ||
    typeof value.created_at !== "string" ||
    !Number.isFinite(new Date(value.created_at).getTime()) ||
    (value.updated_at !== undefined && typeof value.updated_at !== "string") ||
    (value.metadata !== undefined && !isRecord(value.metadata))
  ) {
    invalidCloudResponse(`document entry ${index} is malformed`);
  }
  return {
    id: value.id,
    title: value.title,
    source: value.source,
    type: value.type,
    metadata: (value.metadata ?? {}) as Record<string, unknown>,
    created_at: value.created_at,
    updated_at: typeof value.updated_at === "string" ? value.updated_at : value.created_at,
  };
}

function parseCloudDocumentListResponse(
  value: unknown,
): CloudListRagDocumentsResponse {
  if (!isRecord(value) || !Array.isArray(value.documents)) {
    invalidCloudResponse("document list response must contain a documents array");
  }
  if (value.documents.length > MAX_CLOUD_DOCUMENTS) {
    invalidCloudResponse(
      `document list exceeds ${MAX_CLOUD_DOCUMENTS} entries`,
    );
  }
  const documents = value.documents.map(parseCloudRagDocument);
  const ids = new Set<string>();
  for (const document of documents) {
    if (ids.has(document.id)) {
      invalidCloudResponse(`document list contains duplicate id "${document.id}"`);
    }
    ids.add(document.id);
  }
  return {
    documents,
  };
}

function parseCloudSearchResponse(value: unknown): CloudSearchResponse {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    invalidCloudResponse("search response must contain a data array");
  }
  if (value.data.length > MAX_SEARCH_LIMIT) {
    invalidCloudResponse(`search response exceeds ${MAX_SEARCH_LIMIT} entries`);
  }
  const data = value.data.map((entry, index) => {
    if (
      !isRecord(entry) ||
      !Number.isFinite(entry.score) ||
      !isRecord(entry.chunk) ||
      typeof entry.chunk.file_path !== "string" ||
      typeof entry.chunk.content !== "string" ||
      (entry.chunk.metadata !== undefined &&
        !isRecord(entry.chunk.metadata))
    ) {
      invalidCloudResponse(`search result ${index} is malformed`);
    }
    return {
      chunk: {
        file_path: entry.chunk.file_path,
        content: entry.chunk.content,
        metadata: entry.chunk.metadata as
          | Record<string, unknown>
          | undefined,
      },
      score: entry.score as number,
    };
  });
  return { data };
}

function parseCloudFileListResponse(value: unknown): CloudFileListResponse {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    invalidCloudResponse("file list response must contain a data array");
  }
  if (value.data.length > 100) {
    invalidCloudResponse("file list page exceeds the requested 100 entries");
  }
  const data = value.data.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.path !== "string" ||
      !entry.path ||
      (entry.content !== undefined && typeof entry.content !== "string")
    ) {
      invalidCloudResponse(`file list entry ${index} is malformed`);
    }
    return {
      path: entry.path,
      content: entry.content as string | undefined,
    };
  });
  const pageInfo = value.page_info;
  if (
    pageInfo !== undefined &&
    (!isRecord(pageInfo) ||
      (pageInfo.next !== undefined &&
        pageInfo.next !== null &&
        typeof pageInfo.next !== "string"))
  ) {
    invalidCloudResponse("file list page_info is malformed");
  }
  return {
    data,
    page_info: pageInfo === undefined
      ? undefined
      : { next: (pageInfo.next ?? null) as string | null },
  };
}

function parseCloudFileDetailResponse(value: unknown): CloudFileDetailResponse {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    typeof value.content !== "string"
  ) {
    invalidCloudResponse("file detail response is malformed");
  }
  return { path: value.path, content: value.content };
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
    if (foundAt < 0) {
      throw INVALID_ARGUMENT.create({
        detail: `Unable to map generated chunk ${index} back to its source text`,
      });
    }
    const startOffset = foundAt;
    const endOffset = startOffset + content.length;
    // Start after the previous chunk's first character rather than its end:
    // valid overlapping chunks begin before the prior end offset.
    searchStart = startOffset + 1;

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

function createCloudRequestSignal(callerSignal?: AbortSignal): {
  cleanup(): void;
  didTimeout(): boolean;
  signal: AbortSignal;
} {
  const timeoutSignal = AbortSignal.timeout(CLOUD_REQUEST_TIMEOUT_MS);
  if (!callerSignal) {
    return {
      cleanup() {},
      didTimeout: () => timeoutSignal.aborted,
      signal: timeoutSignal,
    };
  }
  if (typeof AbortSignal.any === "function") {
    return {
      cleanup() {},
      didTimeout: () => timeoutSignal.aborted && !callerSignal.aborted,
      signal: AbortSignal.any([callerSignal, timeoutSignal]),
    };
  }

  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(callerSignal.reason);
  const onTimeout = () => controller.abort(timeoutSignal.reason);
  callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  timeoutSignal.addEventListener("abort", onTimeout, { once: true });
  if (callerSignal.aborted) onCallerAbort();
  else if (timeoutSignal.aborted) onTimeout();

  return {
    cleanup() {
      callerSignal.removeEventListener("abort", onCallerAbort);
      timeoutSignal.removeEventListener("abort", onTimeout);
    },
    didTimeout: () => timeoutSignal.aborted && !callerSignal.aborted,
    signal: controller.signal,
  };
}

async function requestJson<T>(
  context: CloudStoreContext,
  path: string,
  init?: RequestInit,
  options?: { abortSignal?: AbortSignal; allowNotFound?: boolean },
): Promise<T | null> {
  options?.abortSignal?.throwIfAborted();
  const requestSignal = createCloudRequestSignal(options?.abortSignal);
  try {
    const request = new Request(buildUrl(context.apiBaseUrl, path), {
      ...init,
      signal: requestSignal.signal,
    });
    const headers = new Headers(request.headers);

    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("Content-Type", "application/json");
    }

    const response = await context.fetch(new Request(request, { headers }));
    if (options?.allowNotFound && response.status === 404) {
      void response.body?.cancel().catch(() => {});
      return null;
    }

    if (!response.ok) {
      await readResponseTextPrefix(
        response,
        MAX_CLOUD_ERROR_BYTES,
        requestSignal.signal,
      ).catch(() => ({ text: "", truncated: false }));
      throw INVALID_ARGUMENT.create({
        detail:
          `Veryfront Cloud RAG request failed (${response.status} ${response.statusText}) for ${path}`,
      });
    }

    if (response.status === 204) {
      return null;
    }

    const body = await readResponseTextPrefix(
      response,
      MAX_CLOUD_JSON_BYTES,
      requestSignal.signal,
    );
    if (body.truncated) {
      throw NETWORK_ERROR.create({
        detail: `Veryfront Cloud RAG response exceeded ${MAX_CLOUD_JSON_BYTES} bytes for ${path}`,
      });
    }
    try {
      return JSON.parse(body.text) as T;
    } catch (cause) {
      throw NETWORK_ERROR.create({
        detail: `Veryfront Cloud RAG returned malformed JSON for ${path}`,
        cause,
      });
    }
  } catch (error) {
    if (requestSignal.didTimeout()) {
      throw TIMEOUT_ERROR.create({
        detail:
          `Veryfront Cloud RAG request timed out after ${CLOUD_REQUEST_TIMEOUT_MS}ms for ${path}`,
        cause: error,
      });
    }
    if (options?.abortSignal?.aborted) {
      throw options.abortSignal.reason ?? error;
    }
    if (isVeryfrontError(error)) throw error;
    throw NETWORK_ERROR.create({
      detail: `Veryfront Cloud RAG request failed for ${path}`,
      cause: error,
    });
  } finally {
    requestSignal.cleanup();
  }
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
  const branch = config.branch ?? requestContext?.branch ?? "main";
  if (typeof branch !== "string" || !branch.trim() || branch.length > 512) {
    throw INVALID_ARGUMENT.create({
      detail: "Cloud RAG branch must be a non-empty string of at most 512 characters",
    });
  }

  return {
    apiBaseUrl: bootstrap.apiBaseUrl,
    fetch: createVeryfrontCloudFetch(bootstrap.apiToken, bootstrap.projectSlug),
    projectSlug: bootstrap.projectSlug,
    branch,
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
  filePath: string,
  chunks: ChunkMutationInput[],
): Promise<Array<{ id: string; index: number }>> {
  if (chunks.length === 0) {
    return [];
  }

  const results: Array<{ id: string; index: number }> = [];
  for (let i = 0; i < chunks.length; i += MAX_API_CHUNK_BATCH) {
    const batch = chunks.slice(i, i + MAX_API_CHUNK_BATCH);
    const response = await requestJson<unknown>(
      context,
      getFileChunksPath(context, filePath),
      {
        method: "POST",
        body: JSON.stringify({ chunks: batch }),
      },
    );

    results.push(...parseCloudChunkMutationResponse(response, batch.length).chunks);
  }

  results.sort((a, b) => a.index - b.index);
  const ids = new Set<string>();
  for (let index = 0; index < results.length; index++) {
    const result = results[index]!;
    const expectedIndex = chunks[index]?.chunk_index;
    if (result.index !== expectedIndex || ids.has(result.id)) {
      invalidCloudResponse(
        "chunk mutation returned duplicate IDs or indexes that do not match the request",
      );
    }
    ids.add(result.id);
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

    const response = await requestJson<unknown>(
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
    parseCloudEmbeddingMutationResponse(response, batchChunkIds.length);
  }
}

// ---------------------------------------------------------------------------
// Server-side RAG document management
// ---------------------------------------------------------------------------

async function listRagDocuments(
  context: CloudStoreContext,
  abortSignal?: AbortSignal,
): Promise<CloudRagDocumentMeta[]> {
  const response = await requestJson<unknown>(
    context,
    getRagDocumentsPath(context),
    undefined,
    { abortSignal },
  );

  return parseCloudDocumentListResponse(response).documents
    .filter((doc) => {
      const branch = doc.metadata?.branch;
      return typeof branch === "string" ? branch === context.branch : context.branch === "main";
    })
    .map((doc) => ({
      id: doc.id,
      title: doc.title,
      source: doc.source,
      type: doc.type,
      createdAt: new Date(doc.created_at).getTime(),
      branch: typeof doc.metadata?.branch === "string" ? doc.metadata.branch : "main",
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
  const response = await requestJson<unknown>(
    context,
    getRagDocumentsPath(context),
    {
      method: "POST",
      body: JSON.stringify({
        id: document.id,
        title: document.title,
        source: document.source ?? "",
        type: document.type ?? "",
        metadata: {
          ...document.metadata,
          branch: context.branch,
        },
      }),
    },
  );
  if (!isRecord(response)) {
    invalidCloudResponse("document mutation response must be an object");
  }
  if (response.document !== undefined) {
    parseCloudRagDocument(response.document, 0);
  } else if (response.id !== document.id) {
    invalidCloudResponse(
      "document mutation response must contain the written document or matching id",
    );
  }
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
    { filePath, rollbackDocument: existing },
  );

  if (previousFilePath !== filePath) {
    try {
      await deleteFileChunks(context, previousFilePath);
    } catch (error) {
      // The authoritative document record already points at the replacement,
      // so stale chunks are filtered from RAG search. Report cleanup debt
      // without misrepresenting the committed refresh as a failed write.
      serverLogger.warn("[rag-store/cloud] Failed to remove superseded chunks", {
        documentId,
        previousFilePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
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
    rollbackDocument?: CloudRagDocumentMeta;
  },
): Promise<void> {
  if (typeof text !== "string" || !text.trim()) {
    throw INVALID_ARGUMENT.create({ detail: "Upload contains no extractable text" });
  }
  const textBytes = new TextEncoder().encode(text).byteLength;
  if (textBytes > MAX_TEXT_BYTES) {
    throw INVALID_ARGUMENT.create({
      detail: `Upload text is ${textBytes} bytes, exceeding the ${MAX_TEXT_BYTES}-byte limit`,
    });
  }

  const chunkTexts = (await chunk(text, config.chunkOptions))
    .filter((value) => value.trim().length > 0);
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
    branch: context.branch,
  });

  let publicationAttempted = false;
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

    // The server-side document record is authoritative for RAG visibility.
    // Publish it only after every chunk and vector has been accepted.
    publicationAttempted = true;
    await upsertRagDocument(context, {
      id: documentId,
      title,
      source: meta?.source ?? "",
      type: meta?.type ?? "",
      metadata: { filePath },
    });
  } catch (error) {
    const rollbackErrors: unknown[] = [error];
    try {
      await deleteFileChunks(context, filePath);
    } catch (cleanupError) {
      rollbackErrors.push(cleanupError);
    }
    if (publicationAttempted) {
      try {
        if (options?.rollbackDocument) {
          const previous = options.rollbackDocument;
          await upsertRagDocument(context, {
            id: previous.id,
            title: previous.title,
            source: previous.source,
            type: previous.type,
            metadata: {
              filePath: previous.filePath ??
                buildDocumentFilePath(previous.id, previous.type),
            },
          });
        } else {
          await deleteRagDocument(context, documentId);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 1) {
      throw new AggregateError(
        rollbackErrors,
        `Veryfront Cloud RAG write failed and compensating cleanup for "${filePath}" was incomplete`,
      );
    }
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
): Promise<ContentFile[]> {
  const files: ContentFile[] = [];
  const pendingDirectories = [contentDir];

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop()!;
    try {
      for await (const entry of readDir(directory)) {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory) {
          pendingDirectories.push(fullPath);
        } else if (entry.isFile && contentExtensions.has(extname(entry.name))) {
          files.push({ path: fullPath });
          if (files.length > MAX_CLOUD_CONTENT_FILES) {
            throw INVALID_ARGUMENT.create({
              detail: `RAG content directory exceeds ${MAX_CLOUD_CONTENT_FILES} supported files`,
            });
          }
        }
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
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
  let pageCount = 0;
  let inlineContentBytes = 0;
  const seenCursors = new Set<string>();

  do {
    if (pageCount >= MAX_CLOUD_FILE_PAGES) {
      throw NETWORK_ERROR.create({
        detail: `Veryfront Cloud RAG file listing exceeded ${MAX_CLOUD_FILE_PAGES} pages`,
      });
    }
    pageCount++;
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw NETWORK_ERROR.create({
          detail: "Veryfront Cloud RAG file listing repeated a cursor",
        });
      }
      seenCursors.add(cursor);
    }

    const rawResponse = await requestJson<unknown>(
      context,
      getPublishedFileListPath(context, contentDir, cursor),
    );
    const response = parseCloudFileListResponse(rawResponse);

    files.push(
      ...response.data
        .filter((file) => contentExtensions.has(extname(file.path)))
        .map((file) => ({ path: file.path, content: file.content })),
    );
    for (const file of response.data) {
      if (
        file.content !== undefined &&
        contentExtensions.has(extname(file.path))
      ) {
        inlineContentBytes += new TextEncoder().encode(file.content).byteLength;
      }
    }
    if (files.length > MAX_CLOUD_CONTENT_FILES) {
      throw NETWORK_ERROR.create({
        detail:
          `Veryfront Cloud RAG file listing exceeds ${MAX_CLOUD_CONTENT_FILES} matching files`,
      });
    }
    if (inlineContentBytes > MAX_CLOUD_INLINE_CONTENT_BYTES) {
      throw NETWORK_ERROR.create({
        detail:
          `Veryfront Cloud RAG inline file content exceeds ${MAX_CLOUD_INLINE_CONTENT_BYTES} bytes`,
      });
    }

    cursor = response.page_info?.next ?? null;
  } while (cursor);

  return files;
}

async function readContentFile(
  context: CloudStoreContext,
  file: ContentFile,
): Promise<string> {
  if (file.content !== undefined) return file.content;
  if (!context.hasRequestContext) return readTextFile(file.path);

  const response = await requestJson<unknown>(
    context,
    getPublishedFileDetailPath(context, file.path),
  );

  return parseCloudFileDetailResponse(response).content;
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
      const topK = requirePositiveSafeInteger(
        options?.topK ?? DEFAULT_TOP_K,
        "ragStore cloud search topK",
        MAX_SEARCH_LIMIT,
      );
      const threshold = options?.threshold === undefined ? 0 : requireUnitInterval(
        options.threshold,
        "ragStore cloud search threshold",
      );
      options?.abortSignal?.throwIfAborted();
      if (typeof query !== "string") {
        throw INVALID_ARGUMENT.create({ detail: "RAG search query must be a string" });
      }
      if (!query.trim()) return [];
      const context = getCloudStoreContext(config);
      const queryEmbedder = createEmbedder(config);
      const vector = await queryEmbedder.embed(query, {
        abortSignal: options?.abortSignal,
      });
      const limit = Math.min(MAX_SEARCH_LIMIT, topK + SEARCH_OVERSCAN);
      const dimension = toSupportedDimension(vector.length);
      const rawResponse = await requestJson<unknown>(
        context,
        getSearchPath(context),
        {
          method: "POST",
          body: JSON.stringify({
            vector,
            dimension,
            limit,
            threshold,
          }),
        },
        { abortSignal: options?.abortSignal },
      );
      const response = parseCloudSearchResponse(rawResponse);
      const activeDocuments = await listRagDocuments(
        context,
        options?.abortSignal,
      );
      const activeFilePaths = new Map(
        activeDocuments.map((document) => [
          document.id,
          document.filePath ??
            buildDocumentFilePath(document.id, document.type),
        ]),
      );

      const results = response.data
        .filter((result) => {
          const metadata = isRecord(result.chunk.metadata) ? result.chunk.metadata : {};
          if (metadata.kind !== "rag-document") return false;
          const documentId = toStringValue(metadata.document_id);
          return documentId.length > 0 &&
            activeFilePaths.get(documentId) === result.chunk.file_path;
        })
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

      // Fetch document metadata to find its filePath for chunk cleanup
      const documents = await listRagDocuments(context);
      const target = documents.find((doc) => doc.id === id);
      if (!target) return;

      // Remove searchable content before the authoritative record. If chunk
      // cleanup fails, retain the record and surface the failure so callers
      // never receive a false successful deletion while content remains.
      const filePath = target.filePath ?? buildDocumentFilePath(id, target.type);
      await deleteFileChunks(context, filePath);
      await deleteRagDocument(context, id);
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
        const contentBytes = new TextEncoder().encode(content).byteLength;
        if (contentBytes > MAX_TEXT_BYTES) {
          serverLogger.warn(
            `[rag-store/cloud] Skipping ${file.path}: ${contentBytes} bytes exceeds ` +
              `${MAX_TEXT_BYTES}-byte text limit`,
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
