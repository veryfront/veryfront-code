import { isVeryfrontCloudEnabled } from "#veryfront/platform/cloud/resolver.ts";
import { CONFIG_INVALID, isVeryfrontError } from "#veryfront/errors";
import { VeryfrontCloudBlobStorage } from "#veryfront/workflow/blob/veryfront-cloud-storage.ts";
import { isSafeBlobId } from "#veryfront/workflow/blob/blob-id.ts";
import { serverLogger } from "#veryfront/utils";
import type { RagDocumentMeta, RagStore } from "./types.ts";
import { waitWithAbort } from "./admission.ts";
import { loadUpload, UploadContentError } from "./upload-loader.ts";
import { MAX_RAG_DOCUMENT_TEXT_BYTES, requirePositiveSafeInteger } from "./validation.ts";
import * as nodeBuffer from "node:buffer";

const FileCtor = globalThis.File ??
  (nodeBuffer as typeof nodeBuffer & { File: typeof File }).File;

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_CONFIGURED_FILE_SIZE = 100 * 1024 * 1024;
const DEFAULT_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 1_000;
const MAX_FILE_NAME_LENGTH = 200;
const CLOUD_UPLOAD_PREFIX = ".veryfront/rag/uploads/";

const MIME_TO_TYPE: Record<string, string> = {
  "text/plain": "txt",
  "text/markdown": "md",
  "text/mdx": "mdx",
  "text/csv": "csv",
  "text/html": "html",
  "text/xml": "xml",
  "application/csv": "csv",
  "application/pdf": "pdf",
  "application/rtf": "rtf",
  "application/json": "json",
  "application/epub+zip": "epub",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
};

const EXT_TO_TYPE: Record<string, string> = {
  txt: "txt",
  md: "md",
  mdx: "mdx",
  csv: "csv",
  html: "html",
  htm: "html",
  xml: "xml",
  pdf: "pdf",
  rtf: "rtf",
  json: "json",
  epub: "epub",
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
  doc: "doc",
  xls: "xls",
  ppt: "ppt",
};

function inferType(file: File): string | null {
  const fromMime = MIME_TO_TYPE[file.type];
  if (fromMime) return fromMime;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return EXT_TO_TYPE[ext ?? ""] ?? null;
}

const TYPE_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_TO_TYPE).map(([mime, type]) => [type, mime]),
);

function typeToMime(type: string): string {
  return TYPE_TO_MIME[type] ?? "text/plain";
}

/**
 * Sanitize an uploaded file name to prevent stored XSS.
 *
 * Strips path traversal components, HTML/script characters, and control
 * characters. The result is safe to store, render in UI, and interpolate
 * into LLM prompts without HTML-encoding.
 */
function sanitizeFileName(raw: string): string {
  const sanitized = raw
    .replace(/[/\\]/g, "_") // strip path separators
    .replace(/[<>"'`&]/g, "") // strip HTML-significant characters (incl. & for entity injection)
    // deno-lint-ignore no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "") // strip control characters
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH);

  return sanitized || "untitled";
}

/**
 * Result returned by an upload-route authorizer.
 *
 * Only the literal value `true` permits the request. `false` denies it with a
 * 401 response, while a `Response` lets the authorizer return a custom denial
 * or challenge response.
 */
export type UploadAuthorizationResult = boolean | Response;

/**
 * Authorizes one upload-route request.
 *
 * Return `true` to permit access, `false` to return the default 401 response,
 * or a `Response` to return a custom denial or authentication challenge.
 */
export type UploadAuthorize = (
  request: Request,
) => UploadAuthorizationResult | Promise<UploadAuthorizationResult>;

/**
 * Explicit authorization policy for upload routes.
 *
 * Public access requires the conspicuous `none` opt-in; omitting the policy is
 * invalid.
 */
export type UploadHandlerAuthConfig =
  | { type: "none"; allowUnauthenticated: true }
  | { authorize: UploadAuthorize };

/** Configuration for bounded, explicitly authorized upload route handlers. */
export interface UploadHandlerConfig {
  /** Maximum source file bytes accepted by POST. Defaults to 10 MiB. */
  maxFileSize?: number;
  /** Maximum complete multipart body bytes. Defaults to maxFileSize + 64 KiB. */
  maxBodySize?: number;
  /** Maximum extracted UTF-8 text bytes. Defaults to the built-in RAG document limit. */
  maxExtractedTextBytes?: number;
  /** Maximum upload records returned per GET request. Defaults to 100, maximum 1,000. */
  maxListItems?: number;
  /**
   * Required route authorization policy. Provide `authorize` for protected
   * routes. Intentionally public routes must opt in explicitly with
   * `{ type: "none", allowUnauthenticated: true }`.
   */
  auth: UploadHandlerAuthConfig;
}

const MAX_CONCURRENT_URL_LOOKUPS = 5;

interface ResolvedUploadLimits {
  maxBodySize: number;
  maxExtractedTextBytes: number;
  maxFileSize: number;
  maxListItems: number;
}

class UploadRequestError extends Error {
  override readonly name = "UploadRequestError";

  constructor(
    readonly status: number,
    readonly publicMessage: string,
    options?: ErrorOptions,
  ) {
    super(publicMessage, options);
  }
}

function resolveUploadLimits(config: UploadHandlerConfig | undefined): ResolvedUploadLimits {
  try {
    const maxFileSize = requirePositiveSafeInteger(
      config?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
      "createUploadHandler maxFileSize",
      MAX_CONFIGURED_FILE_SIZE,
    );
    const maxBodySize = requirePositiveSafeInteger(
      config?.maxBodySize ?? maxFileSize + DEFAULT_MULTIPART_OVERHEAD_BYTES,
      "createUploadHandler maxBodySize",
      MAX_CONFIGURED_FILE_SIZE + DEFAULT_MULTIPART_OVERHEAD_BYTES,
    );
    if (maxBodySize < maxFileSize) {
      throw new RangeError("createUploadHandler maxBodySize must not be smaller than maxFileSize");
    }
    return {
      maxBodySize,
      maxExtractedTextBytes: requirePositiveSafeInteger(
        config?.maxExtractedTextBytes ?? MAX_RAG_DOCUMENT_TEXT_BYTES,
        "createUploadHandler maxExtractedTextBytes",
        MAX_CONFIGURED_FILE_SIZE,
      ),
      maxFileSize,
      maxListItems: requirePositiveSafeInteger(
        config?.maxListItems ?? DEFAULT_LIST_LIMIT,
        "createUploadHandler maxListItems",
        MAX_LIST_LIMIT,
      ),
    };
  } catch (error) {
    throw CONFIG_INVALID.create({
      detail: error instanceof Error ? error.message : "Invalid createUploadHandler limits",
      cause: error,
    });
  }
}

function resolveUploadAuthorize(
  auth: UploadHandlerAuthConfig | undefined,
): UploadAuthorize | null {
  if (auth === undefined) {
    throw CONFIG_INVALID.create({
      detail: "createUploadHandler auth is required. Pass { authorize } or " +
        "{ type: 'none', allowUnauthenticated: true }.",
    });
  }

  if (auth === null || typeof auth !== "object") {
    throw CONFIG_INVALID.create({
      detail: "createUploadHandler auth must be { authorize } or " +
        "{ type: 'none', allowUnauthenticated: true }.",
    });
  }

  if ("type" in auth) {
    if (auth.type === "none" && auth.allowUnauthenticated === true) return null;
    throw CONFIG_INVALID.create({
      detail: "createUploadHandler auth type 'none' requires allowUnauthenticated: true.",
    });
  }

  if (typeof auth.authorize === "function") return auth.authorize;

  throw CONFIG_INVALID.create({
    detail: "createUploadHandler auth must be { authorize } or " +
      "{ type: 'none', allowUnauthenticated: true }.",
  });
}

async function authorizeUploadRequest(
  request: Request | undefined,
  authorize: UploadAuthorize | null,
): Promise<Response | null> {
  if (!authorize) return null;
  if (!request) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await authorize(request);
  if (result instanceof Response) return result;
  return result === true ? null : Response.json({ error: "Unauthorized" }, { status: 401 });
}

async function enrichUploadsWithSourceUrls(
  uploads: Awaited<ReturnType<RagStore["listDocuments"]>>,
  abortSignal?: AbortSignal,
): Promise<Awaited<ReturnType<RagStore["listDocuments"]>>> {
  const sourceBlobStorage = getSourceBlobStorage();
  if (!sourceBlobStorage) return uploads;

  const cloudUploads = uploads.filter((u) => u.source.startsWith("upload:"));
  if (cloudUploads.length === 0) return uploads;

  // Resolve signed URLs with bounded concurrency to avoid thundering herd
  // against the uploads API when the document list is large.
  const blobMap = new Map<
    string,
    { mediaType: string; size: number; url?: string }
  >();
  for (let i = 0; i < cloudUploads.length; i += MAX_CONCURRENT_URL_LOOKUPS) {
    abortSignal?.throwIfAborted();
    const batch = cloudUploads.slice(i, i + MAX_CONCURRENT_URL_LOOKUPS);
    const results = await waitWithAbort(
      Promise.allSettled(
        batch.map(async (upload) => {
          const blob = await sourceBlobStorage.stat(upload.id);
          if (blob) {
            blobMap.set(upload.id, {
              mediaType: blob.mimeType,
              size: blob.size,
              ...(blob.url ? { url: blob.url } : {}),
            });
          }
        }),
      ),
      abortSignal,
    );
    for (const result of results) {
      if (result.status === "rejected") {
        serverLogger.warn("Upload source URL lookup failed:", result.reason);
      }
    }
  }

  return uploads.map((upload) => {
    const blob = blobMap.get(upload.id);
    return blob ? { ...upload, ...blob } : upload;
  });
}

function getSourceBlobStorage(): VeryfrontCloudBlobStorage | null {
  return isVeryfrontCloudEnabled()
    ? new VeryfrontCloudBlobStorage({ prefix: CLOUD_UPLOAD_PREFIX })
    : null;
}

interface UploadRegistryItem {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  url?: string;
}

function toUploadRegistryItem(upload: RagDocumentMeta): UploadRegistryItem {
  return {
    id: upload.id,
    name: upload.title,
    mediaType: upload.mediaType ?? typeToMime(upload.type),
    size: upload.size ?? 0,
    ...(upload.url ? { url: upload.url } : {}),
  };
}

function resolveDeleteId(
  request: Request,
  context: { params: Record<string, string> } = { params: {} },
): string {
  const fromParams = context.params.id?.trim() ?? "";
  const fromQuery = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (fromParams && fromQuery && fromParams !== fromQuery) {
    throw new UploadRequestError(400, "Conflicting upload IDs");
  }
  const id = fromParams || fromQuery;
  if (!id) throw new UploadRequestError(400, "Missing upload ID");
  if (id.length > 256 || !isSafeBlobId(id)) {
    throw new UploadRequestError(400, "Invalid upload ID");
  }
  return id;
}

function parseListWindow(
  request: Request | undefined,
  maxListItems: number,
): { limit: number; offset: number } {
  if (!request) return { limit: maxListItems, offset: 0 };
  const params = new URL(request.url).searchParams;
  return {
    limit: parseQueryInteger(params.get("limit"), "limit", maxListItems, maxListItems),
    offset: parseQueryInteger(params.get("offset"), "offset", 0, Number.MAX_SAFE_INTEGER),
  };
}

function parseQueryInteger(
  raw: string | null,
  name: string,
  defaultValue: number,
  maximum: number,
): number {
  if (raw === null) return defaultValue;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) {
    throw new UploadRequestError(400, `Invalid ${name}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < (name === "limit" ? 1 : 0) || value > maximum) {
    throw new UploadRequestError(400, `Invalid ${name}`);
  }
  return value;
}

async function readMultipartFormData(
  request: Request,
  maxBodySize: number,
): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (
    !/^multipart\/form-data\s*;/i.test(contentType) ||
    !/(?:^|;)\s*boundary=(?:"[^"]+"|[^;\s]+)/i.test(contentType)
  ) {
    throw new UploadRequestError(415, "Expected multipart form data");
  }

  const rawContentLength = request.headers.get("content-length");
  if (rawContentLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(rawContentLength)) {
      throw new UploadRequestError(400, "Invalid Content-Length");
    }
    const declaredLength = Number(rawContentLength);
    if (!Number.isSafeInteger(declaredLength)) {
      throw new UploadRequestError(400, "Invalid Content-Length");
    }
    if (declaredLength > maxBodySize) {
      throw new UploadRequestError(413, "Upload request is too large");
    }
  }

  const body = request.body;
  if (!body) throw new UploadRequestError(400, "Missing upload body");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let complete = false;
  try {
    while (true) {
      request.signal.throwIfAborted();
      const { done, value } = await waitWithAbort(reader.read(), request.signal);
      if (done) {
        complete = true;
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBodySize) {
        throw new UploadRequestError(413, "Upload request is too large");
      }
      chunks.push(value);
    }
  } finally {
    if (!complete) {
      try {
        await reader.cancel();
      } catch {
        // The request source may already have failed or been cancelled.
      }
    }
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return await new Response(bytes, {
      headers: { "content-type": contentType },
    }).formData();
  } catch (error) {
    throw new UploadRequestError(400, "Invalid multipart form data", { cause: error });
  }
}

function isAbortFailure(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError");
}

function uploadFailureResponse(error: unknown, signal?: AbortSignal): Response {
  if (error instanceof UploadRequestError) {
    return Response.json({ error: error.publicMessage }, { status: error.status });
  }
  if (error instanceof UploadContentError) {
    const status = error.code === "invalid-content" ? 422 : 413;
    return Response.json({ error: error.message }, { status });
  }
  if (signal && isAbortFailure(error, signal)) {
    return Response.json({ error: "Upload cancelled" }, { status: 499 });
  }
  if (isVeryfrontError(error) && error.status >= 400 && error.status < 500) {
    return Response.json({ error: "Invalid upload content" }, { status: 422 });
  }
  serverLogger.error("Upload request failed:", error);
  return Response.json({ error: "Upload failed" }, { status: 500 });
}

/**
 * Creates HTTP route handlers for upload, listing, and deletion.
 *
 * Pass `auth: { authorize }` to protect these handlers before they read
 * request bodies or access the RAG store. For local development, pass
 * `auth: { type: "none", allowUnauthenticated: true }` to explicitly allow
 * unauthenticated upload routes. Omitting `auth` fails at construction.
 * Authorizers must return the literal value `true` to permit a request;
 * `false` and invalid runtime results such as `undefined` deny with 401.
 *
 * Returns `{ POST, GET, DELETE }` handlers compatible with file-based routing.
 * POST accepts multipart form data with a `file` field, extracts text via
 * `loadUpload`, and ingests into the provided RAG store. When Veryfront Cloud
 * bootstrap is present, the original binary is also stored in the project's
 * uploads store via the cloud adapter. Configured body, file, and extracted
 * text limits are enforced before persistence.
 *
 * GET returns only documents with upload provenance, ordered newest first.
 * It accepts bounded `limit` and non-negative `offset` query parameters and
 * returns `{ items, total, offset, limit, hasMore }`. DELETE removes an upload
 * by ID from the `id` query parameter or route params. A cloud source-cleanup
 * failure returns 502 and can be retried safely.
 *
 * @example
 * ```ts
 * // app/api/uploads/route.ts
 * import { createUploadHandler } from "veryfront/embedding";
 * import { getEnv } from "veryfront";
 * import { store } from "lib/store.ts";
 *
 * export const { POST, GET, DELETE } = createUploadHandler(store, {
 *   auth: {
 *     authorize: (request) => {
 *       const token = getEnv("UPLOAD_TOKEN");
 *       return token !== undefined &&
 *         request.headers.get("authorization") === `Bearer ${token}`;
 *     },
 *   },
 * });
 * ```
 */
export function createUploadHandler(
  store: RagStore,
  config: UploadHandlerConfig,
) {
  const limits = resolveUploadLimits(config);
  const authorize = resolveUploadAuthorize(config?.auth);

  async function POST(request: Request): Promise<Response> {
    try {
      const unauthorized = await authorizeUploadRequest(request, authorize);
      if (unauthorized) return unauthorized;
      request.signal.throwIfAborted();

      const formData = await readMultipartFormData(request, limits.maxBodySize);
      const files = formData.getAll("file");
      const file = files[0];

      if (files.length !== 1 || !file || !(file instanceof FileCtor)) {
        return Response.json(
          { error: "Exactly one file must be provided" },
          { status: 400 },
        );
      }

      if (file.size > limits.maxFileSize) {
        return Response.json(
          {
            error: `File exceeds ${Math.round(limits.maxFileSize / 1024 / 1024)} MB limit`,
          },
          { status: 413 },
        );
      }

      const fileType = inferType(file);
      if (!fileType) {
        return Response.json(
          { error: `Unsupported file type: ${sanitizeFileName(file.type || file.name)}` },
          { status: 400 },
        );
      }

      request.signal.throwIfAborted();
      const buffer = await file.arrayBuffer();
      request.signal.throwIfAborted();
      let text: string;
      try {
        text = await loadUpload(buffer, typeToMime(fileType), {
          abortSignal: request.signal,
          maxInputBytes: limits.maxFileSize,
          maxOutputBytes: limits.maxExtractedTextBytes,
        });
      } catch (error) {
        if (
          error instanceof UploadContentError ||
          isAbortFailure(error, request.signal) ||
          isVeryfrontError(error)
        ) {
          throw error;
        }
        serverLogger.warn("Upload extraction failed:", error);
        return Response.json(
          { error: "Unable to extract text from file" },
          { status: 422 },
        );
      }
      if (!text.trim()) {
        return Response.json(
          { error: "No text could be extracted from file" },
          { status: 400 },
        );
      }

      // Sanitize file name: strip path components, HTML characters, and
      // control characters to prevent stored XSS via filenames rendered in UI.
      const safeName = sanitizeFileName(file.name);
      const mediaType = file.type || typeToMime(fileType);

      request.signal.throwIfAborted();
      const id = await store.ingest(
        safeName,
        text,
        {
          source: `upload:${safeName}`,
          type: fileType,
          mediaType,
          size: file.size,
        },
        { abortSignal: request.signal },
      );

      const sourceBlobStorage = getSourceBlobStorage();
      try {
        request.signal.throwIfAborted();
        if (sourceBlobStorage) {
          await sourceBlobStorage.put(file, {
            id,
            mimeType: mediaType,
            metadata: {
              originalName: safeName,
              source: `upload:${safeName}`,
              title: safeName,
              type: fileType,
            },
          });
        }
        request.signal.throwIfAborted();
      } catch (error) {
        const cleanupResults = await Promise.allSettled([
          store.removeDocument(id),
          sourceBlobStorage?.delete(id) ?? Promise.resolve(),
        ]);
        for (const result of cleanupResults) {
          if (result.status === "rejected") {
            serverLogger.warn(
              "Upload rollback failed after source persistence error:",
              result.reason,
            );
          }
        }
        throw error;
      }

      return Response.json({
        id,
        name: safeName,
        mediaType,
        size: file.size,
      });
    } catch (error) {
      return uploadFailureResponse(error, request.signal);
    }
  }

  async function GET(request?: Request): Promise<Response> {
    try {
      const unauthorized = await authorizeUploadRequest(request, authorize);
      if (unauthorized) return unauthorized;

      const { limit, offset } = parseListWindow(request, limits.maxListItems);
      request?.signal.throwIfAborted();
      const uploads = (await store.listDocuments({ abortSignal: request?.signal }))
        .filter((document) => document.source.startsWith("upload:"))
        .sort((left, right) => {
          return right.createdAt - left.createdAt || left.id.localeCompare(right.id);
        });
      const total = uploads.length;
      const page = uploads.slice(offset, offset + limit);
      const enriched = await enrichUploadsWithSourceUrls(page, request?.signal);
      return Response.json({
        items: enriched.map(toUploadRegistryItem),
        total,
        offset,
        limit,
        hasMore: offset + enriched.length < total,
      });
    } catch (error) {
      if (error instanceof UploadRequestError) {
        return Response.json({ error: error.publicMessage }, { status: error.status });
      }
      if (request && isAbortFailure(error, request.signal)) {
        return Response.json({ error: "Upload list cancelled" }, { status: 499 });
      }
      serverLogger.error("Upload list failed:", error);
      return Response.json({ error: "Failed to list uploads" }, { status: 500 });
    }
  }

  async function DELETE(
    request: Request,
    context: { params: Record<string, string> } = { params: {} },
  ): Promise<Response> {
    try {
      const unauthorized = await authorizeUploadRequest(request, authorize);
      if (unauthorized) return unauthorized;

      const id = resolveDeleteId(request, context);
      request.signal.throwIfAborted();
      const existing = (await store.listDocuments()).find((document) => document.id === id);
      if (existing && !existing.source.startsWith("upload:")) {
        return Response.json({ error: "Upload not found" }, { status: 404 });
      }

      await store.removeDocument(id, {
        requiredSourcePrefix: "upload:",
        abortSignal: request.signal,
      });

      const sourceBlobStorage = getSourceBlobStorage();
      if (sourceBlobStorage) {
        try {
          await sourceBlobStorage.delete(id);
        } catch (error) {
          serverLogger.error("Upload source blob cleanup failed:", error);
          return Response.json(
            {
              error: "Upload was removed from the index, but source cleanup failed; retry deletion",
            },
            { status: 502 },
          );
        }
      }

      return Response.json({ success: true });
    } catch (error) {
      if (error instanceof UploadRequestError) {
        return Response.json({ error: error.publicMessage }, { status: error.status });
      }
      if (isAbortFailure(error, request.signal)) {
        return Response.json({ error: "Upload deletion cancelled" }, { status: 499 });
      }
      serverLogger.error("Upload delete failed:", error);
      return Response.json({ error: "Delete failed" }, { status: 500 });
    }
  }

  return { POST, GET, DELETE };
}
