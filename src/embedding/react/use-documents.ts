/**
 * useDocuments Hook
 *
 * Manages document upload, deletion, and listing for RAG applications.
 * Pairs with `createDocumentHandler` on the server side.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentMeta } from "../types.ts";

export interface UseDocumentsOptions {
  /** API endpoint, e.g. "/api/documents" */
  api: string;
}

export interface UseDocumentsResult {
  /** All documents from the server */
  documents: DocumentMeta[];
  /** True while an upload is in progress */
  uploading: boolean;
  /** User-facing error message, cleared on next action */
  error: string | null;
  /** Upload a file (multipart POST) */
  upload: (file: File) => Promise<void>;
  /** Delete a document by ID */
  remove: (id: string) => Promise<void>;
  /** Re-fetch the document list */
  refresh: () => Promise<void>;
}

/**
 * useDocuments hook for managing RAG document lifecycle.
 */
export function useDocuments(options: UseDocumentsOptions): UseDocumentsResult {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(options.api);
      if (!res.ok) return;
      const data = await res.json();
      setDocuments(data.documents ?? []);
    } catch {
      setError("Failed to load documents");
    }
  }, [options.api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const upload = useCallback(
    async (file: File): Promise<void> => {
      setError(null);
      setUploading(true);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(options.api, {
          method: "POST",
          body: formData,
          signal: abortController.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Upload failed");
        await refresh();
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
        abortControllerRef.current = null;
      }
    },
    [options.api, refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      setError(null);
      try {
        await fetch(`${options.api}/${id}`, { method: "DELETE" });
        await refresh();
      } catch {
        setError("Failed to delete document");
      }
    },
    [options.api, refresh],
  );

  return { documents, uploading, error, upload, remove, refresh };
}
