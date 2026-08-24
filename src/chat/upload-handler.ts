/**
 * Chat upload handler: the server side of `<Chat>`'s batteries-included
 * attachments. Mount it at `app/api/uploads/route.ts` (the same endpoint the
 * composer POSTs to) and files "just work": stored on the local disk in dev,
 * on Veryfront Cloud (or a `BlobStorage` you pass) once deployed.
 *
 * ```ts
 * // app/api/uploads/route.ts
 * import { createChatUploadHandler } from "veryfront/chat/uploads";
 *
 * function authorize(request: Request) {
 *   const token = Deno.env.get("UPLOAD_TOKEN");
 *   return Boolean(token && request.headers.get("authorization") === `Bearer ${token}`);
 * }
 *
 * export const { POST, GET, DELETE } = createChatUploadHandler({ authorize });
 * ```
 *
 * `POST` stores the multipart `file` field and returns `{ id, url, name,
 * mediaType, size }`. The composer sends that `url` as a `file` message part,
 * which the runtime fetches, so the URL must be reachable by the runtime
 * (true for local dev, where `GET` streams the file back from the same origin).
 *
 * @module chat/upload-handler
 */

import { LocalBlobStorage } from "#veryfront/workflow/blob/local-storage.ts";
import { VeryfrontCloudBlobStorage } from "#veryfront/workflow/blob/veryfront-cloud-storage.ts";
import type { BlobRef, BlobStorage } from "#veryfront/workflow/blob/types.ts";
import { isVeryfrontCloudEnabled } from "#veryfront/platform/cloud/resolver.ts";
import { isProduction } from "#veryfront/platform/environment.ts";
import { CONFIG_INVALID } from "#veryfront/errors";
import { isSafeBlobId } from "#veryfront/workflow/blob/blob-id.ts";
import { serverLogger } from "#veryfront/utils";
import { resolveValidatedRequest } from "#veryfront/security/input-validation/handler.ts";
import * as nodeBuffer from "node:buffer";

/** 25 MB default cap. Attachments are references, not bulk transfer. */
const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024;
const DEFAULT_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_FILE_NAME_LENGTH = 200;
const MAX_BLOB_ID_LENGTH = 128;
const CLOUD_PREFIX = ".veryfront/chat-uploads/";
const MEDIA_TYPE_PATTERN = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

const FileCtor = globalThis.File ??
  (nodeBuffer as typeof nodeBuffer & { File: typeof File }).File;
const logger = serverLogger.component("chat-upload");

/** Result returned by a chat upload-route authorizer. */
export type ChatUploadAuthorizationResult = boolean | Response;

/** Authorizes one chat upload-route request. */
export type ChatUploadAuthorize = (
  request: Request,
) => ChatUploadAuthorizationResult | Promise<ChatUploadAuthorizationResult>;

/** Configuration for {@link createChatUploadHandler}. */
export interface ChatUploadHandlerConfig {
  /** Max accepted file size in bytes. @default 25 MB */
  maxFileSize?: number;
  /** Max complete multipart body size. @default maxFileSize + 64 KiB */
  maxBodySize?: number;
  /** Storage backend. Defaults to local disk in dev, Veryfront Cloud when deployed. */
  storage?: BlobStorage;
  /**
   * Gate every request. Only literal `true` permits access; return `false` or
   * a `Response` to reject.
   * Required unless `allowUnauthenticated` is explicitly set.
   */
  authorize?: ChatUploadAuthorize;
  /**
   * Allow POST, GET, and DELETE without an authorization callback.
   * Use this only for local prototypes or deliberately public upload routes.
   */
  allowUnauthenticated?: boolean;
}

interface ResolvedUploadLimits {
  maxFileSize: number;
  maxBodySize: number;
}

class ChatUploadRequestError extends Error {
  override readonly name = "ChatUploadRequestError";

  constructor(
    readonly status: number,
    readonly publicMessage: string,
    options?: ErrorOptions,
  ) {
    super(publicMessage, options);
  }
}

/** Strip path separators, HTML-significant and control chars from a filename. */
function sanitizeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[/\\]/g, "_")
    .replace(/[<>"'`&]/g, "")
    // deno-lint-ignore no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH);
  return cleaned || "untitled";
}

/**
 * Select the blob backend for chat uploads: an explicitly configured storage
 * wins, then Veryfront Cloud once deployed, then local disk.
 *
 * Exported so the deployment-dependent selection can be pinned by a test
 * without performing a real upload.
 */
export function resolveStorage(config: ChatUploadHandlerConfig): BlobStorage {
  if (config.storage) return config.storage;
  // Cloud storage only when actually deployed. In local dev the cloud bootstrap
  // is present (you're logged in) but the project isn't, so default to disk.
  if (isProduction() && isVeryfrontCloudEnabled()) {
    return new VeryfrontCloudBlobStorage({ prefix: CLOUD_PREFIX });
  }
  return new LocalBlobStorage(`${Deno.cwd()}/.veryfront/uploads`);
}

function requirePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`createChatUploadHandler ${name} must be a positive safe integer`);
  }
  return value;
}

function resolveUploadLimits(config: ChatUploadHandlerConfig): ResolvedUploadLimits {
  try {
    const maxFileSize = requirePositiveSafeInteger(
      config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
      "maxFileSize",
    );
    const defaultMaxBodySize = maxFileSize + DEFAULT_MULTIPART_OVERHEAD_BYTES;
    const maxBodySize = requirePositiveSafeInteger(
      config.maxBodySize ?? defaultMaxBodySize,
      "maxBodySize",
    );
    if (maxBodySize < maxFileSize) {
      throw new RangeError(
        "createChatUploadHandler maxBodySize must not be smaller than maxFileSize",
      );
    }
    return { maxFileSize, maxBodySize };
  } catch (error) {
    throw CONFIG_INVALID.create({
      detail: error instanceof Error ? error.message : "Invalid chat upload limits",
      cause: error,
    });
  }
}

function isValidBlobId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_BLOB_ID_LENGTH && isSafeBlobId(id);
}

function fallbackUrl(requestUrl: string, id: string): string {
  const url = new URL(requestUrl);
  url.search = "";
  url.searchParams.set("id", id);
  return url.href;
}

function normalizeMediaType(value: string): string {
  const candidate = value.split(";", 1)[0]?.trim() ?? "";
  return MEDIA_TYPE_PATTERN.test(candidate) ? candidate : "application/octet-stream";
}

function validateStorageRef(value: unknown): BlobRef {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !isValidBlobId(value.id) ||
    !("size" in value) ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    !("mimeType" in value) ||
    typeof value.mimeType !== "string" ||
    ("url" in value && value.url !== undefined && typeof value.url !== "string")
  ) {
    throw new ChatUploadRequestError(502, "Upload storage returned invalid data");
  }
  return value as BlobRef;
}

function resolveExternalUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      throw new TypeError("Unsupported upload URL");
    }
    return url.href;
  } catch (error) {
    throw new ChatUploadRequestError(502, "Upload storage returned invalid data", {
      cause: error,
    });
  }
}

function storageFileName(ref: BlobRef): string {
  const candidate = ref.metadata?.filename;
  return sanitizeFileName(typeof candidate === "string" ? candidate : ref.id);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Upload cancelled", "AbortError");
}

async function readBodyChunkWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    throw abortReason(signal);
  }

  return await new Promise((resolve, rejectPromise) => {
    const onAbort = () => {
      cleanup();
      rejectPromise(abortReason(signal));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    reader.read().then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (error) => {
        cleanup();
        rejectPromise(error);
      },
    );
  });
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
    throw new ChatUploadRequestError(415, "Expected multipart form data");
  }

  const rawContentLength = request.headers.get("content-length");
  if (rawContentLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(rawContentLength)) {
      throw new ChatUploadRequestError(400, "Invalid Content-Length");
    }
    const declaredLength = Number(rawContentLength);
    if (!Number.isSafeInteger(declaredLength)) {
      throw new ChatUploadRequestError(400, "Invalid Content-Length");
    }
    if (declaredLength > maxBodySize) {
      throw new ChatUploadRequestError(413, "Upload request is too large");
    }
  }

  if (!request.body) {
    throw new ChatUploadRequestError(400, "Missing upload body");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await readBodyChunkWithAbort(reader, request.signal);
      if (done) {
        complete = true;
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBodySize) {
        throw new ChatUploadRequestError(413, "Upload request is too large");
      }
      chunks.push(value);
    }
  } finally {
    if (!complete) {
      try {
        await reader.cancel();
      } catch {
        // The request body may already have failed or been cancelled.
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

  request.signal.throwIfAborted();
  try {
    const form = await new Response(bytes, {
      headers: { "content-type": contentType },
    }).formData();
    request.signal.throwIfAborted();
    return form;
  } catch (error) {
    if (request.signal.aborted) throw abortReason(request.signal);
    throw new ChatUploadRequestError(400, "Invalid multipart form data", { cause: error });
  }
}

async function authorizeRequest(
  request: Request,
  authorize: ChatUploadHandlerConfig["authorize"],
): Promise<Response | null> {
  if (!authorize) return null;
  const result = await authorize(request);
  if (result instanceof Response) return result;
  return result === true ? null : Response.json({ error: "Unauthorized" }, { status: 401 });
}

function isAbortFailure(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError");
}

function failureResponse(error: unknown, signal: AbortSignal): Response {
  if (error instanceof ChatUploadRequestError) {
    return Response.json({ error: error.publicMessage }, { status: error.status });
  }
  if (isAbortFailure(error, signal)) {
    return Response.json({ error: "Upload cancelled" }, { status: 499 });
  }

  logger.error("Chat upload request failed", error);
  return Response.json({ error: "Upload request failed" }, { status: 500 });
}

/**
 * Build `{ POST, GET, DELETE }` route handlers for chat attachments.
 * Auto-selects local disk storage in dev and Veryfront Cloud once deployed, or
 * the `storage` you provide. Every route fails closed unless an authorizer
 * returns literal `true` or unauthenticated access is explicitly enabled.
 * Multipart request bodies and file bytes are bounded independently.
 * `DELETE ?id=` removes the file from storage.
 */
export function createChatUploadHandler(
  config: ChatUploadHandlerConfig = {},
): {
  POST: (request: Request) => Promise<Response>;
  GET: (request: Request) => Promise<Response>;
  DELETE: (request: Request) => Promise<Response>;
} {
  if (config.authorize !== undefined && typeof config.authorize !== "function") {
    throw CONFIG_INVALID.create({
      detail: "createChatUploadHandler authorize must be a function",
    });
  }
  if (config.authorize === undefined && config.allowUnauthenticated !== true) {
    throw CONFIG_INVALID.create({
      message: "createChatUploadHandler requires `authorize` or `allowUnauthenticated: true`.",
      detail:
        "Pass authorize to protect upload requests, or set allowUnauthenticated: true for a deliberately public endpoint.",
    });
  }
  const limits = resolveUploadLimits(config);
  const storage = resolveStorage(config);

  async function POST(request: Request): Promise<Response> {
    try {
      const denied = await authorizeRequest(request, config.authorize);
      if (denied) return denied;
      request.signal.throwIfAborted();

      const form = await readMultipartFormData(request, limits.maxBodySize);
      const files = form.getAll("file");
      const file = files[0];
      if (files.length !== 1 || !FileCtor || !(file instanceof FileCtor)) {
        return Response.json(
          { error: "Exactly one file must be provided" },
          { status: 400 },
        );
      }
      if (file.size > limits.maxFileSize) {
        return Response.json(
          { error: `File exceeds ${Math.round(limits.maxFileSize / 1024 / 1024)} MB limit` },
          { status: 413 },
        );
      }

      const name = sanitizeFileName(file.name);
      const mediaType = normalizeMediaType(file.type);
      const ref = validateStorageRef(
        await storage.put(file, {
          mimeType: mediaType,
          metadata: { filename: name },
        }),
      );

      // Use the backend's own URL when it has one (cloud/S3); otherwise serve
      // bytes from this handler's same-origin GET route.
      let external = resolveExternalUrl(ref.url);
      if (!external) {
        const storedRef = await storage.stat(ref.id);
        if (storedRef) {
          const validatedStoredRef = validateStorageRef(storedRef);
          if (validatedStoredRef.id !== ref.id) {
            throw new ChatUploadRequestError(502, "Upload storage returned invalid data");
          }
          external = resolveExternalUrl(validatedStoredRef.url);
        }
      }
      const url = external ?? fallbackUrl(request.url, ref.id);

      return Response.json({ id: ref.id, url, name, mediaType, size: file.size });
    } catch (error) {
      return failureResponse(error, request.signal);
    }
  }

  function toListItem(ref: BlobRef, requestUrl: string) {
    const validatedRef = validateStorageRef(ref);
    return {
      id: validatedRef.id,
      url: resolveExternalUrl(validatedRef.url) ?? fallbackUrl(requestUrl, validatedRef.id),
      name: storageFileName(validatedRef),
      mediaType: normalizeMediaType(validatedRef.mimeType),
      size: validatedRef.size,
    };
  }

  async function GET(request: Request): Promise<Response> {
    try {
      const denied = await authorizeRequest(request, config.authorize);
      if (denied) return denied;
      request.signal.throwIfAborted();

      const id = new URL(request.url).searchParams.get("id");

      // No `id` → list the adapter's stored files (newest first). This is the
      // source of truth for an "Uploads" surface, so it survives across
      // sessions and browsers, unlike a client-only index.
      if (!id) {
        if (!storage.list) {
          return Response.json(
            { error: "This storage backend does not support listing", items: [] },
            { status: 501 },
          );
        }
        const refs = await storage.list();
        return Response.json({ items: refs.map((ref) => toListItem(ref, request.url)) });
      }

      if (!isValidBlobId(id)) {
        return Response.json({ error: "Invalid id" }, { status: 400 });
      }
      const storedRef = await storage.stat(id);
      if (!storedRef) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      const ref = validateStorageRef(storedRef);
      if (ref.id !== id) {
        throw new ChatUploadRequestError(502, "Upload storage returned invalid data");
      }
      const stream = await storage.getStream(id);
      if (!stream) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      return new Response(stream, {
        headers: {
          "Content-Type": normalizeMediaType(ref.mimeType),
          "Content-Length": String(ref.size),
          "Content-Disposition": `attachment; filename="${storageFileName(ref)}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch (error) {
      return failureResponse(error, request.signal);
    }
  }

  async function DELETE(request: Request): Promise<Response> {
    try {
      const denied = await authorizeRequest(request, config.authorize);
      if (denied) return denied;
      request.signal.throwIfAborted();

      const id = new URL(request.url).searchParams.get("id");
      if (!id || !isValidBlobId(id)) {
        return Response.json({ error: "Invalid id" }, { status: 400 });
      }
      // Idempotent: deleting an already-gone file is a success, not a 404.
      await storage.delete(id);
      return Response.json({ id, deleted: true });
    } catch (error) {
      return failureResponse(error, request.signal);
    }
  }

  // Resolve at the boundary rather than at each use. The pages executor calls
  // method handlers with its APIContext, and these handlers read `signal`,
  // `headers` and `url` as well as the body, so unwrapping one of them would
  // still leave the rest reading from the context.
  return {
    POST: (request: Request) => POST(resolveValidatedRequest(request)),
    GET: (request: Request) => GET(resolveValidatedRequest(request)),
    DELETE: (request: Request) => DELETE(resolveValidatedRequest(request)),
  };
}
