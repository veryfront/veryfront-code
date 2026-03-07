/**
 * useUploads Hook
 *
 * Manages upload, deletion, and listing for RAG applications.
 * Pairs with `createUploadHandler` on the server side.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { UploadMeta } from "../types.ts";
import { API_ERROR } from "#veryfront/errors";

export interface UseUploadsOptions {
  /** API endpoint, e.g. "/api/uploads" */
  api: string;
}

export interface UseUploadsResult {
  /** All uploads from the server */
  uploads: UploadMeta[];
  /** True while an upload is in progress */
  uploading: boolean;
  /** User-facing error message, cleared on next action */
  error: string | null;
  /** Upload a file (multipart POST) */
  upload: (file: File) => Promise<void>;
  /** Delete an upload by ID */
  remove: (id: string) => Promise<void>;
  /** Re-fetch the upload list */
  refresh: () => Promise<void>;
}

/**
 * useUploads hook for managing RAG upload lifecycle.
 */
export function useUploads(options: UseUploadsOptions): UseUploadsResult {
  const [uploads, setUploads] = useState<UploadMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(options.api);
      if (!res.ok) return;
      const data = await res.json();
      setUploads(data.uploads ?? []);
    } catch (error) {
      console.debug("useUploads: failed to load uploads", error);
      setError("Failed to load uploads");
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
        if (!res.ok) throw API_ERROR.create({ detail: data.error ?? "Upload failed" });
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
      } catch (error) {
        console.debug("useUploads: failed to delete upload", error);
        setError("Failed to delete upload");
      }
    },
    [options.api, refresh],
  );

  return { uploads, uploading, error, upload, remove, refresh };
}
