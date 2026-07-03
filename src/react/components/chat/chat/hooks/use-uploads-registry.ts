/**
 * useUploadsRegistry — a localStorage-backed index of files uploaded across a
 * whole app, independent of any single conversation. The chat composer's
 * {@link useUpload} tracks attachments for *one* message and forgets them on
 * send; this hook instead keeps a durable list so an "Uploads" surface can show
 * everything and delete from storage.
 *
 * The list is sourced from the endpoint itself: on mount it `GET`s the `url`
 * (no `id`) for everything actually stored, so the surface reflects server
 * truth across sessions/browsers — not just what this tab uploaded. localStorage
 * is kept only as an instant-paint cache before the fetch lands.
 *
 *   GET    `{url}`                               → { items: [{ id, url, name, size, mediaType }] }
 *   POST   `{url}`            FormData { file }  → { id, url, name, size, mediaType }
 *   DELETE `{url}?id={id}`                        → removes from storage
 *
 * The endpoint is normally {@link createChatUploadHandler} (`veryfront/chat/uploads`),
 * which is where pluggable *storage* lives: it resolves a `BlobStorage`
 * (Veryfront Cloud when deployed, local disk in dev; or S3/GCS/your own). So
 * this hook needs only the `url` — "point storage anywhere" is the handler's
 * job, not the client's.
 *
 * @module react/components/chat/hooks/use-uploads-registry
 */
import * as React from "react";
import { isBrowserEnvironment } from "#veryfront/platform/compat/runtime.ts";
import type { UploadedFile } from "../components/attachments-panel.tsx";

/** Options for {@link useUploadsRegistry}. */
export interface UseUploadsRegistryOptions {
  /**
   * Upload endpoint — `GET` lists, `POST` (multipart `file`) uploads, `DELETE`
   * removes. Usually {@link createChatUploadHandler}'s route. @default "/api/uploads"
   */
  url?: string;
  /** @deprecated Renamed to `url`. */
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
  /** Re-fetch the list from the storage adapter (runs once on mount). */
  refresh: () => Promise<void>;
}

interface UploadResponse {
  id?: string;
  url?: string;
  name?: string;
  size?: number;
  mediaType?: string;
}

interface ListResponse {
  items?: UploadResponse[];
}

function toUploadedFile(entry: UploadResponse): UploadedFile | null {
  if (!entry.id) return null;
  return {
    id: entry.id,
    name: entry.name ?? entry.id,
    size: entry.size ?? 0,
    type: entry.mediaType ?? "application/octet-stream",
    ...(entry.url ? { url: entry.url } : {}),
  };
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
  const { storageKey = "vf-uploads", headers } = options;
  // `url` is canonical; `api` is the deprecated alias.
  const endpoint = options.url ?? options.api ?? "/api/uploads";

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
        void fetch(endpoint, { method: "POST", body: form, headers })
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
    [endpoint, headers, add],
  );

  const remove = React.useCallback(
    async (id: string): Promise<void> => {
      try {
        await fetch(`${endpoint}?id=${encodeURIComponent(id)}`, { method: "DELETE", headers });
      } catch (_) { /* best-effort server delete; still drop locally */ }
      setItems((prev) => prev.filter((f) => f.id !== id));
    },
    [endpoint, headers],
  );

  const clear = React.useCallback(() => setItems([]), []);

  // The storage adapter is the source of truth: pull the full stored list so
  // the surface shows everything (other sessions, chat uploads, this tab),
  // not just what this browser's localStorage happens to remember.
  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch(endpoint, { headers });
      if (!response.ok) return;
      const body = (await response.json()) as ListResponse;
      if (!Array.isArray(body.items)) return;
      const serverItems = (body.items ?? [])
        .map(toUploadedFile)
        .filter((f): f is UploadedFile => f !== null);
      setItems(serverItems);
    } catch (_) {
      /* offline / endpoint without listing — keep the cached list */
    }
  }, [endpoint, headers]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return { items, isUploading: inFlight > 0, upload, add, remove, clear, refresh };
}
