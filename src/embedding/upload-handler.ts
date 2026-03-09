import { isVeryfrontCloudEnabled } from "#veryfront/platform/cloud/resolver.ts";
import { VeryfrontCloudBlobStorage } from "#veryfront/workflow/blob/veryfront-cloud-storage.ts";
import { serverLogger } from "#veryfront/utils";
import type { RagStore } from "./types.ts";
import { loadUpload } from "./upload-loader.ts";

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

interface UploadHandlerConfig {
  maxFileSize?: number;
}

async function enrichUploadsWithSourceUrls(
  uploads: Awaited<ReturnType<RagStore["listDocuments"]>>,
): Promise<Awaited<ReturnType<RagStore["listDocuments"]>>> {
  const sourceBlobStorage = getSourceBlobStorage();
  if (!sourceBlobStorage) return uploads;

  return await Promise.all(
    uploads.map(async (upload) => {
      if (!upload.source.startsWith("upload:")) {
        return upload;
      }

      try {
        const blob = await sourceBlobStorage.stat(upload.id);
        return blob?.url ? { ...upload, url: blob.url } : upload;
      } catch (error) {
        serverLogger.warn("Upload source URL lookup failed:", error);
        return upload;
      }
    }),
  );
}

function getSourceBlobStorage(): VeryfrontCloudBlobStorage | null {
  return isVeryfrontCloudEnabled()
    ? new VeryfrontCloudBlobStorage({ prefix: CLOUD_UPLOAD_PREFIX })
    : null;
}

/**
 * Creates HTTP route handlers for upload, listing, and deletion.
 *
 * **Important:** These handlers do not include authentication or authorization.
 * Add your own auth middleware before exposing them in production.
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
 * import { store } from "../../../lib/store.ts";
 *
 * export const { POST, GET } = createUploadHandler(store);
 * ```
 *
 * @example
 * ```ts
 * // app/api/uploads/[id]/route.ts
 * import { createUploadHandler } from "veryfront/embedding";
 * import { store } from "../../../../lib/store.ts";
 *
 * export const { DELETE } = createUploadHandler(store);
 * ```
 */
export function createUploadHandler(
  store: RagStore,
  config?: UploadHandlerConfig,
) {
  const maxSize = config?.maxFileSize ?? MAX_FILE_SIZE;

  async function POST(request: Request): Promise<Response> {
    try {
      const formData = await request.formData();
      const file = formData.get("file");

      if (!file || !(file instanceof File)) {
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
          { error: `Unsupported file type: ${file.type || file.name}` },
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

      // Sanitize file name: strip path components, limit length
      const safeName = file.name.replace(/[/\\]/g, "_").slice(0, MAX_FILE_NAME_LENGTH);

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
        upload: { id, title: file.name, type: fileType },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  async function GET(): Promise<Response> {
    try {
      const uploads = await enrichUploadsWithSourceUrls(await store.listDocuments());
      return Response.json({ uploads });
    } catch (error) {
      serverLogger.error("Upload list failed:", error);
      return Response.json({ error: "Failed to list uploads" }, { status: 500 });
    }
  }

  async function DELETE(
    _request: Request,
    context: { params: Record<string, string> },
  ): Promise<Response> {
    try {
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
          serverLogger.warn("Upload source cleanup failed:", error);
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
