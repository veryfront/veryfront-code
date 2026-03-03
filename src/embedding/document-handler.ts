import type { DocumentStore } from "./types.ts";
import { loadDocument } from "./document-loader.ts";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const MIME_TO_TYPE: Record<string, string> = {
  "text/plain": "txt",
  "text/markdown": "md",
  "text/mdx": "mdx",
  "text/csv": "csv",
  "application/csv": "csv",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

const EXT_TO_TYPE: Record<string, string> = {
  txt: "txt",
  md: "md",
  mdx: "mdx",
  csv: "csv",
  pdf: "pdf",
  docx: "docx",
};

function inferType(file: File): string | null {
  const fromMime = MIME_TO_TYPE[file.type];
  if (fromMime) return fromMime;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return EXT_TO_TYPE[ext ?? ""] ?? null;
}

function mimeForType(type: string): string {
  return Object.entries(MIME_TO_TYPE).find(([, v]) => v === type)?.[0] ?? "text/plain";
}

interface DocumentHandlerConfig {
  maxFileSize?: number;
}

/**
 * Creates HTTP route handlers for document upload, listing, and deletion.
 *
 * Returns `{ POST, GET, DELETE }` handlers compatible with file-based routing.
 * POST accepts multipart form data with a `file` field, extracts text via
 * `loadDocument`, and ingests into the provided document store. GET returns
 * the document list. DELETE removes a document by ID from route params.
 *
 * @example
 * ```ts
 * // app/api/documents/route.ts
 * import { createDocumentHandler } from "veryfront/embedding";
 * import { store } from "../../../lib/store.ts";
 *
 * export const { POST, GET } = createDocumentHandler(store);
 * ```
 *
 * @example
 * ```ts
 * // app/api/documents/[id]/route.ts
 * import { createDocumentHandler } from "veryfront/embedding";
 * import { store } from "../../../../lib/store.ts";
 *
 * export const { DELETE } = createDocumentHandler(store);
 * ```
 */
export function createDocumentHandler(
  store: DocumentStore,
  config?: DocumentHandlerConfig,
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
      const text = await loadDocument(buffer, mimeForType(fileType));
      if (!text.trim()) {
        return Response.json(
          { error: "No text could be extracted from file" },
          { status: 400 },
        );
      }

      const id = await store.ingest(file.name, text, {
        source: `upload:${file.name}`,
        type: fileType,
      });

      return Response.json({
        success: true,
        document: { id, title: file.name, type: fileType },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  async function GET(): Promise<Response> {
    const documents = await store.listDocuments();
    return Response.json({ documents });
  }

  async function DELETE(
    _request: Request,
    context: { params: Record<string, string> },
  ): Promise<Response> {
    try {
      const id = context.params.id;
      if (!id) {
        return Response.json({ error: "Missing document ID" }, { status: 400 });
      }
      await store.removeDocument(id);
      return Response.json({ success: true });
    } catch (error) {
      console.error("Document delete failed:", error);
      return Response.json({ error: "Delete failed" }, { status: 500 });
    }
  }

  return { POST, GET, DELETE };
}
