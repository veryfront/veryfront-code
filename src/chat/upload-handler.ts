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
const MAX_FILE_NAME_LENGTH = 200;
/** Ids are storage-issued UUIDs; this guards the `GET ?id=` path against traversal. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const CLOUD_PREFIX = ".veryfront/chat-uploads/";

const FileCtor: typeof File | undefined = globalThis.File;

/** Configuration for {@link createChatUploadHandler}. */
export interface ChatUploadHandlerConfig {
  /** Max accepted file size in bytes. @default 25 MB */
  maxFileSize?: number;
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
  const maxFileSize = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
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

    const form = await request.formData();
    const file = form.get("file");
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
    const mediaType = file.type || "application/octet-stream";
    const ref = await storage.put(file, {
      mimeType: mediaType,
      metadata: { filename: name },
    });

    // Use the backend's own URL when it has one (cloud/S3); otherwise serve the
    // bytes back ourselves from the same origin (local disk in dev).
    const external = ref.url ?? (await storage.stat(ref.id))?.url;
    const url = external ?? fallbackUrl(request.url, ref.id);

    return Response.json({ id: ref.id, url, name, mediaType, size: file.size });
  }

  function toListItem(ref: BlobRef, requestUrl: string) {
    return {
      id: ref.id,
      url: ref.url ?? fallbackUrl(requestUrl, ref.id),
      name: ref.metadata?.filename ?? ref.id,
      mediaType: ref.mimeType,
      size: ref.size,
    };
  }

  async function GET(request: Request): Promise<Response> {
    const denied = await reject(request, config.authorize);
    if (denied) return denied;

    const id = new URL(request.url).searchParams.get("id");

    // No `id` → list the adapter's stored files (newest first). This is the
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
      return Response.json({ items: refs.map((ref) => toListItem(ref, request.url)) });
    }

    if (!SAFE_ID.test(id)) {
      return Response.json({ error: "Invalid id" }, { status: 400 });
    }
    const ref = await storage.stat(id);
    const stream = ref ? await storage.getStream(id) : null;
    if (!ref || !stream) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return new Response(stream, {
      headers: {
        "Content-Type": ref.mimeType,
        "Content-Length": String(ref.size),
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
