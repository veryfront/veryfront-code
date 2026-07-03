/**
 * useUploadsRegistry — a localStorage-backed index of files uploaded across a
 * whole app, independent of any single conversation. The chat composer's
 * {@link useUpload} tracks attachments for *one* message and forgets them on
 * send; this hook instead keeps a durable list so an "Uploads" surface can show
 * everything and delete from storage.
 *
 * It owns its own upload (a direct multipart POST) so it captures the server's
 * `{ id, url, name, size, mediaType }` — `useUpload` only surfaces the `url`,
 * but the storage `id` is what `DELETE` needs.
 *
 *   POST   `{api}`            FormData { file }  → { id, url, name, size, mediaType }
 *   DELETE `{api}?id={id}`                        → removes from storage
 *
 * @module react/components/chat/hooks/use-uploads-registry
 */
import * as React from "react";
import { isBrowserEnvironment } from "#veryfront/platform/compat/runtime.ts";
import type { UploadedFile } from "../components/attachments-panel.tsx";

/** Options for {@link useUploadsRegistry}. */
export interface UseUploadsRegistryOptions {
  /** Upload endpoint (multipart `file` → `{ id, url, ... }`). @default "/api/uploads" */
  api?: string;
  /** localStorage key for the persisted list. @default "vf-uploads" */
  storageKey?: string;
  /** Extra headers sent with upload / delete requests. */
  headers?: Record<string, string>;
}

/** Result of {@link useUploadsRegistry}. */
export interface UseUploadsRegistryResult {
  /** All uploaded files, newest first. */
  items: UploadedFile[];
  /** `true` while at least one upload is in flight. */
  isUploading: boolean;
  /** Upload files (from an input or a drop) and add them to the registry. */
  upload: (files: FileList | File[]) => void;
  /** Add an already-uploaded file to the registry (e.g. one sent via chat). */
  add: (file: UploadedFile) => void;
  /** Delete from storage and drop from the registry. */
  remove: (id: string) => Promise<void>;
  /** Clear the local registry (does not delete from storage). */
  clear: () => void;
}

interface UploadResponse {
  id?: string;
  url?: string;
  name?: string;
  size?: number;
  mediaType?: string;
}

function load(storageKey: string): UploadedFile[] {
  if (!isBrowserEnvironment()) return [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) return JSON.parse(raw) as UploadedFile[];
  } catch (_) { /* expected: corrupted / blocked storage */ }
  return [];
}

function save(storageKey: string, items: UploadedFile[]): void {
  if (!isBrowserEnvironment()) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(items));
  } catch (_) { /* expected: quota exceeded or blocked storage */ }
}

/** Persistent, cross-conversation registry of uploaded files. */
export function useUploadsRegistry(
  options: UseUploadsRegistryOptions = {},
): UseUploadsRegistryResult {
  const { api = "/api/uploads", storageKey = "vf-uploads", headers } = options;

  const [items, setItems] = React.useState<UploadedFile[]>(() => load(storageKey));
  const [inFlight, setInFlight] = React.useState(0);

  // Persist whenever the list changes.
  React.useEffect(() => {
    save(storageKey, items);
  }, [storageKey, items]);

  const add = React.useCallback((file: UploadedFile) => {
    setItems((prev) => {
      if (prev.some((f) => f.id === file.id)) return prev;
      return [file, ...prev];
    });
  }, []);

  const upload = React.useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        setInFlight((n) => n + 1);
        const form = new FormData();
        form.append("file", file, file.name);
        void fetch(api, { method: "POST", body: form, headers })
          .then(async (response) => {
            if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
            const body = (await response.json()) as UploadResponse;
            if (!body.id) throw new Error("Upload response missing id");
            add({
              id: body.id,
              name: body.name ?? file.name,
              size: body.size ?? file.size,
              type: body.mediaType ?? file.type,
              ...(body.url ? { url: body.url } : {}),
            });
          })
          .catch(() => {/* surfaced via isUploading dropping; caller may retry */})
          .finally(() => setInFlight((n) => Math.max(0, n - 1)));
      }
    },
    [api, headers, add],
  );

  const remove = React.useCallback(
    async (id: string): Promise<void> => {
      try {
        await fetch(`${api}?id=${encodeURIComponent(id)}`, { method: "DELETE", headers });
      } catch (_) { /* best-effort server delete; still drop locally */ }
      setItems((prev) => prev.filter((f) => f.id !== id));
    },
    [api, headers],
  );

  const clear = React.useCallback(() => setItems([]), []);

  return { items, isUploading: inFlight > 0, upload, add, remove, clear };
}
