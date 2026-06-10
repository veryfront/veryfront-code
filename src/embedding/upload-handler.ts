import { isVeryfrontCloudEnabled } from "#veryfront/platform/cloud/resolver.ts";
import { VeryfrontCloudBlobStorage } from "#veryfront/workflow/blob/veryfront-cloud-storage.ts";
import { serverLogger } from "#veryfront/utils";
import type { RagStore } from "./types.ts";
import { loadUpload } from "./upload-loader.ts";
import * as nodeBuffer from "node:buffer";

const FileCtor = globalThis.File ??
  (nodeBuffer as typeof nodeBuffer & { File: typeof File }).File;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
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

export type UploadAuthorizationResult = boolean | Response | void | undefined;

export type UploadAuthorize = (
  request: Request,
) => UploadAuthorizationResult | Promise<UploadAuthorizationResult>;

export type UploadHandlerAuthConfig =
  | { type: "none"; allowUnauthenticated: true }
  | { authorize: UploadAuthorize };

export interface UploadHandlerConfig {
  maxFileSize?: number;
  auth?: UploadHandlerAuthConfig;
}

const MAX_CONCURRENT_URL_LOOKUPS = 5;
let missingAuthWarningEmitted = false;

function warnMissingAuthConfig(): void {
  if (missingAuthWarningEmitted) return;
  missingAuthWarningEmitted = true;
  serverLogger.warn(
    "createUploadHandler registered without auth. Pass auth: { authorize } for protected routes, " +
      "or auth: { type: 'none', allowUnauthenticated: true } to explicitly allow unauthenticated uploads.",
  );
}

function resolveUploadAuthorize(
  auth: UploadHandlerAuthConfig | undefined,
): UploadAuthorize | null {
  if (auth === undefined) {
    warnMissingAuthConfig();
    return null;
  }

  if ("type" in auth) {
    if (auth.type === "none" && auth.allowUnauthenticated === true) return null;
    throw new Error(
      "createUploadHandler auth type 'none' requires allowUnauthenticated: true.",
    );
  }

  if (typeof auth.authorize === "function") return auth.authorize;

  throw new Error(
    "createUploadHandler auth must be { authorize } or " +
      "{ type: 'none', allowUnauthenticated: true }.",
  );
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
  if (result === false) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function enrichUploadsWithSourceUrls(
  uploads: Awaited<ReturnType<RagStore["listDocuments"]>>,
): Promise<Awaited<ReturnType<RagStore["listDocuments"]>>> {
  const sourceBlobStorage = getSourceBlobStorage();
  if (!sourceBlobStorage) return uploads;

  const cloudUploads = uploads.filter((u) => u.source.startsWith("upload:"));
  if (cloudUploads.length === 0) return uploads;

  // Resolve signed URLs with bounded concurrency to avoid thundering herd
  // against the uploads API when the document list is large.
  const urlMap = new Map<string, string>();
  for (let i = 0; i < cloudUploads.length; i += MAX_CONCURRENT_URL_LOOKUPS) {
    const batch = cloudUploads.slice(i, i + MAX_CONCURRENT_URL_LOOKUPS);
    const results = await Promise.allSettled(
      batch.map(async (upload) => {
        const blob = await sourceBlobStorage.stat(upload.id);
        if (blob?.url) urlMap.set(upload.id, blob.url);
      }),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        serverLogger.warn("Upload source URL lookup failed:", result.reason);
      }
    }
  }

  return uploads.map((upload) => {
    const url = urlMap.get(upload.id);
    return url ? { ...upload, url } : upload;
  });
}

function getSourceBlobStorage(): VeryfrontCloudBlobStorage | null {
  return isVeryfrontCloudEnabled()
    ? new VeryfrontCloudBlobStorage({ prefix: CLOUD_UPLOAD_PREFIX })
    : null;
}

/**
 * Creates HTTP route handlers for upload, listing, and deletion.
 *
 * Pass `auth: { authorize }` to protect these handlers before they read
 * request bodies or access the RAG store. For local development, pass
 * `auth: { type: "none", allowUnauthenticated: true }` to explicitly allow
 * unauthenticated upload routes. Omitting `auth` still allows the route for
 * compatibility and logs a warning.
 *
 * Returns `{ POST, GET, DELETE }` handlers compatible with file-based routing.
 * POST accepts multipart form data with a `file` field, extracts text via
 * `loadUpload`, and ingests into the provided RAG store. When Veryfront Cloud
 * bootstrap is present, the original binary is also stored in the project's
 * uploads store via the cloud adapter. GET returns the upload list. DELETE
 * removes an upload by ID from route params.
 *
 * @example
 * ```ts
 * // app/api/uploads/route.ts
 * import { createUploadHandler } from "veryfront/embedding";
 * import { store } from "lib/store.ts";
 *
 * export const { POST, GET } = createUploadHandler(store, {
 *   auth: {
 *     authorize: (request) => {
 *       const token = Deno.env.get("UPLOAD_TOKEN");
 *       return token !== undefined &&
 *         request.headers.get("authorization") === `Bearer ${token}`;
 *     },
 *   },
 * });
 * ```
 *
 * @example
 * ```ts
 * // app/api/uploads/[id]/route.ts
 * import { createUploadHandler } from "veryfront/embedding";
 * import { store } from "lib/store.ts";
 *
 * export const { DELETE } = createUploadHandler(store, {
 *   auth: { type: "none", allowUnauthenticated: true },
 * });
 * ```
 */
export function createUploadHandler(
  store: RagStore,
  config?: UploadHandlerConfig,
) {
  const maxSize = config?.maxFileSize ?? MAX_FILE_SIZE;
  const authorize = resolveUploadAuthorize(config?.auth);

  async function POST(request: Request): Promise<Response> {
    try {
      const unauthorized = await authorizeUploadRequest(request, authorize);
      if (unauthorized) return unauthorized;

      const formData = await request.formData();
      const file = formData.get("file");

      if (!file || !(file instanceof FileCtor)) {
        return Response.json({ error: "No file provided" }, { status: 400 });
      }

      if (file.size > maxSize) {
        return Response.json(
          { error: `File exceeds ${Math.round(maxSize / 1024 / 1024)} MB limit` },
          { status: 400 },
        );
      }

      const fileType = inferType(file);
      if (!fileType) {
        return Response.json(
          { error: `Unsupported file type: ${sanitizeFileName(file.type || file.name)}` },
          { status: 400 },
        );
      }

      const buffer = await file.arrayBuffer();
      const text = await loadUpload(buffer, typeToMime(fileType));
      if (!text.trim()) {
        return Response.json(
          { error: "No text could be extracted from file" },
          { status: 400 },
        );
      }

      // Sanitize file name: strip path components, HTML characters, and
      // control characters to prevent stored XSS via filenames rendered in UI.
      const safeName = sanitizeFileName(file.name);

      const id = await store.ingest(safeName, text, {
        source: `upload:${safeName}`,
        type: fileType,
      });

      const sourceBlobStorage = getSourceBlobStorage();
      if (sourceBlobStorage) {
        try {
          await sourceBlobStorage.put(file, {
            id,
            mimeType: file.type || typeToMime(fileType),
            metadata: {
              originalName: safeName,
              source: `upload:${safeName}`,
              title: safeName,
              type: fileType,
            },
          });
        } catch (error) {
          try {
            await store.removeDocument(id);
          } catch (cleanupError) {
            serverLogger.warn(
              "Upload rollback failed after source persistence error:",
              cleanupError,
            );
          }
          throw error;
        }
      }

      return Response.json({
        success: true,
        upload: { id, title: safeName, type: fileType },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  async function GET(request?: Request): Promise<Response> {
    try {
      const unauthorized = await authorizeUploadRequest(request, authorize);
      if (unauthorized) return unauthorized;

      const uploads = await enrichUploadsWithSourceUrls(await store.listDocuments());
      return Response.json({ uploads });
    } catch (error) {
      serverLogger.error("Upload list failed:", error);
      return Response.json({ error: "Failed to list uploads" }, { status: 500 });
    }
  }

  async function DELETE(
    request: Request,
    context: { params: Record<string, string> },
  ): Promise<Response> {
    try {
      const unauthorized = await authorizeUploadRequest(request, authorize);
      if (unauthorized) return unauthorized;

      const id = context.params.id;
      if (!id) {
        return Response.json({ error: "Missing upload ID" }, { status: 400 });
      }

      await store.removeDocument(id);

      const sourceBlobStorage = getSourceBlobStorage();
      if (sourceBlobStorage) {
        try {
          await sourceBlobStorage.delete(id);
        } catch (error) {
          serverLogger.warn("Upload source blob cleanup failed:", error);
        }
      }

      return Response.json({ success: true });
    } catch (error) {
      serverLogger.error("Upload delete failed:", error);
      return Response.json({ error: "Delete failed" }, { status: 500 });
    }
  }

  return { POST, GET, DELETE };
}
