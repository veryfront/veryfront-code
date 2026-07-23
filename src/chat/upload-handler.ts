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

/** 25 MB default cap. Attachments are references, not bulk transfer. */
const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024;
const DEFAULT_MAX_LISTED_FILES = 100;
const MAX_LISTED_FILES = 1_000;
const MAX_CONFIGURABLE_FILE_SIZE = 1024 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const MAX_FILE_NAME_LENGTH = 200;
/** Ids are storage-issued UUIDs; this guards the `GET ?id=` path against traversal. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const CLOUD_PREFIX = ".veryfront/chat-uploads/";

const FileCtor: typeof File | undefined = globalThis.File;

/** Configuration for {@link createChatUploadHandler}. */
export interface ChatUploadHandlerConfig {
  /** Max accepted file size in bytes. @default 25 MB */
  maxFileSize?: number;
  /** Maximum number of files returned by a list request. @default 100 */
  maxListedFiles?: number;
  /** Storage backend. Defaults to local disk in dev, Veryfront Cloud when deployed. */
  storage?: BlobStorage;
  /**
   * Gate every request. Return `false` or a `Response` to reject.
   * Required unless `allowUnauthenticated` is explicitly set.
   */
  authorize?: (
    request: Request,
  ) => boolean | Response | void | Promise<boolean | Response | void>;
  /**
   * Allow POST, GET, and DELETE without an authorization callback.
   * Use this only for local prototypes or deliberately public upload routes.
   */
  allowUnauthenticated?: boolean;
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

function resolveStorage(config: ChatUploadHandlerConfig): BlobStorage {
  if (config.storage) return config.storage;
  // Cloud storage only when actually deployed. In local dev the cloud bootstrap
  // is present (you're logged in) but the project isn't, so default to disk.
  if (isProduction() && isVeryfrontCloudEnabled()) {
    return new VeryfrontCloudBlobStorage({ prefix: CLOUD_PREFIX });
  }
  return new LocalBlobStorage(`${Deno.cwd()}/.veryfront/uploads`);
}

function fallbackUrl(requestUrl: string, id: string): string {
  const url = new URL(requestUrl);
  url.search = "";
  url.searchParams.set("id", id);
  return url.href;
}

function rejectsDeclaredSize(request: Request, maxBodySize: number): boolean {
  const value = request.headers.get("content-length");
  if (!value) return false;
  if (!/^(?:0|[1-9]\d*)$/.test(value.trim())) return false;
  const declared = Number(value);
  return Number.isSafeInteger(declared) && declared > maxBodySize;
}

function resolvePositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw CONFIG_INVALID.create({
      message: `${name} must be a positive integer no greater than ${maximum}.`,
      detail: `Received an invalid ${name} upload handler limit.`,
    });
  }
  return resolved;
}

function isSafeHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.username.length === 0 && url.password.length === 0;
  } catch {
    return false;
  }
}

function normalizeMediaType(value: string): string {
  const normalized = value.trim().toLowerCase().split(";", 1)[0]?.trim() ?? "";
  return normalized.length <= 255 &&
      /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)
    ? normalized
    : "application/octet-stream";
}

function isValidBlobSize(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function toContentDispositionFileName(value: string): string {
  return sanitizeFileName(value).replace(/[^\x20-\x7e]/g, "_");
}

type BoundedRequestBody =
  | { ok: true; body: Blob }
  | { ok: false };

async function readRequestBodyWithinLimit(
  request: Request,
  maxBodySize: number,
): Promise<BoundedRequestBody> {
  if (!request.body) {
    return { ok: true, body: new Blob() };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  try {
    while (true) {
      if (request.signal.aborted) {
        throw request.signal.reason;
      }
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.byteLength;
      if (totalSize > maxBodySize) {
        try {
          await reader.cancel("Upload body exceeds the configured limit");
        } catch {
          // The size response takes precedence over a transport cancellation error.
        }
        return { ok: false };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body: new Blob([bytes.buffer]) };
}

async function parseMultipartFormData(
  request: Request,
  maxBodySize: number,
): Promise<FormData | Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (
    !/^multipart\/form-data(?:;|$)/i.test(contentType) ||
    !/(?:^|;)\s*boundary=(?:"[^"]+"|[^;\s]+)/i.test(contentType)
  ) {
    return Response.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const boundedBody = await readRequestBodyWithinLimit(request, maxBodySize);
  if (!boundedBody.ok) {
    return Response.json({ error: "Upload body exceeds the configured limit" }, { status: 413 });
  }

  try {
    return await new Response(boundedBody.body, {
      headers: { "content-type": contentType },
    }).formData();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return Response.json({ error: "Invalid multipart form data" }, { status: 400 });
  }
}

async function reject(
  request: Request,
  authorize: ChatUploadHandlerConfig["authorize"],
): Promise<Response | null> {
  if (!authorize) return null;
  const result = await authorize(request);
  if (result instanceof Response) return result;
  if (result === false) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

/**
 * Build `{ POST, GET, DELETE }` route handlers for chat attachments.
 * Auto-selects local disk storage in dev and Veryfront Cloud once deployed, or
 * the `storage` you provide. `DELETE ?id=` removes the file from storage.
 */
export function createChatUploadHandler(
  config: ChatUploadHandlerConfig = {},
): {
  POST: (request: Request) => Promise<Response>;
  GET: (request: Request) => Promise<Response>;
  DELETE: (request: Request) => Promise<Response>;
} {
  const maxFileSize = resolvePositiveInteger(
    config.maxFileSize,
    DEFAULT_MAX_FILE_SIZE,
    MAX_CONFIGURABLE_FILE_SIZE,
    "maxFileSize",
  );
  const maxListedFiles = resolvePositiveInteger(
    config.maxListedFiles,
    DEFAULT_MAX_LISTED_FILES,
    MAX_LISTED_FILES,
    "maxListedFiles",
  );
  const maxBodySize = maxFileSize + MULTIPART_OVERHEAD_BYTES;
  if (!config.authorize && config.allowUnauthenticated !== true) {
    throw CONFIG_INVALID.create({
      message: "createChatUploadHandler requires `authorize` or `allowUnauthenticated: true`.",
      detail:
        "Pass authorize to protect upload requests, or set allowUnauthenticated: true for a deliberately public endpoint.",
    });
  }
  const storage = resolveStorage(config);

  async function POST(request: Request): Promise<Response> {
    const denied = await reject(request, config.authorize);
    if (denied) return denied;

    if (rejectsDeclaredSize(request, maxBodySize)) {
      return Response.json(
        { error: `File exceeds ${Math.round(maxFileSize / 1024 / 1024)} MB limit` },
        { status: 413 },
      );
    }

    const form = await parseMultipartFormData(request, maxBodySize);
    if (form instanceof Response) {
      return form;
    }
    const files = form.getAll("file");
    const file = files.length === 1 ? files[0] : null;
    if (!FileCtor || !(file instanceof FileCtor)) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > maxFileSize) {
      return Response.json(
        { error: `File exceeds ${Math.round(maxFileSize / 1024 / 1024)} MB limit` },
        { status: 413 },
      );
    }

    const name = sanitizeFileName(file.name);
    const mediaType = normalizeMediaType(file.type);
    const ref = await storage.put(file, {
      mimeType: mediaType,
      metadata: { filename: name },
    });

    // Use the backend's own URL when it has one (cloud/S3); otherwise serve the
    // bytes back ourselves from the same origin (local disk in dev).
    if (!SAFE_ID.test(ref.id)) {
      return Response.json({ error: "Storage returned an invalid file id" }, { status: 502 });
    }
    const external = ref.url ?? (await storage.stat(ref.id))?.url;
    const url = isSafeHttpUrl(external) ? external : fallbackUrl(request.url, ref.id);

    return Response.json({ id: ref.id, url, name, mediaType, size: file.size });
  }

  function toListItem(ref: BlobRef, requestUrl: string) {
    return {
      id: ref.id,
      url: isSafeHttpUrl(ref.url) ? ref.url : fallbackUrl(requestUrl, ref.id),
      name: sanitizeFileName(ref.metadata?.filename ?? ref.id),
      mediaType: normalizeMediaType(ref.mimeType),
      size: isValidBlobSize(ref.size) ? ref.size : 0,
    };
  }

  async function GET(request: Request): Promise<Response> {
    const denied = await reject(request, config.authorize);
    if (denied) return denied;

    const id = new URL(request.url).searchParams.get("id");

    // No `id` lists the adapter's stored files (newest first). This is the
    // source of truth for an "Uploads" surface, so it survives across sessions
    // and browsers, unlike a client-only index.
    if (!id) {
      if (!storage.list) {
        return Response.json(
          { error: "This storage backend does not support listing", items: [] },
          { status: 501 },
        );
      }
      const refs = await storage.list();
      const items = refs.filter((ref) => SAFE_ID.test(ref.id)).slice(0, maxListedFiles).map((ref) =>
        toListItem(ref, request.url)
      );
      return Response.json({ items });
    }

    if (!SAFE_ID.test(id)) {
      return Response.json({ error: "Invalid id" }, { status: 400 });
    }
    const ref = await storage.stat(id);
    if (!ref) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (!isValidBlobSize(ref.size)) {
      return Response.json({ error: "Storage returned invalid file metadata" }, { status: 502 });
    }
    const stream = await storage.getStream(id);
    if (!stream) return Response.json({ error: "Not found" }, { status: 404 });
    return new Response(stream, {
      headers: {
        "Content-Type": normalizeMediaType(ref.mimeType),
        "Content-Length": String(ref.size),
        "Content-Disposition": `attachment; filename="${
          toContentDispositionFileName(ref.metadata?.filename ?? ref.id)
        }"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  async function DELETE(request: Request): Promise<Response> {
    const denied = await reject(request, config.authorize);
    if (denied) return denied;

    const id = new URL(request.url).searchParams.get("id");
    if (!id || !SAFE_ID.test(id)) {
      return Response.json({ error: "Invalid id" }, { status: 400 });
    }
    // Idempotent: deleting an already-gone file is a success, not a 404.
    await storage.delete(id);
    return Response.json({ id, deleted: true });
  }

  return { POST, GET, DELETE };
}
