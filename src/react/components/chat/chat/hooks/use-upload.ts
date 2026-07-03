/**
 * useUpload — a minimal file-upload client that drives the `Attachment` pill
 * lifecycle states. Forks the *technique* of Studio's `useInlineFileUpload`
 * (blob preview → POST → resolved URL), simplified to a single multipart POST:
 *
 *   POST `{api}` with `FormData { file }` → `{ id?, url }`
 *
 * Each file is tracked as an `AttachmentInfo` that transitions
 * `uploading` (with `progress`) → `uploaded` (with `url`) or `error`. Upload
 * progress uses `XMLHttpRequest` (fetch has no upload-progress event). Image
 * files get an object-URL `preview` immediately.
 *
 * @module react/components/chat/hooks/use-upload
 */
import * as React from "react";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";

/** Options for {@link useUpload}. */
export interface UseUploadOptions {
  /**
   * Upload endpoint (multipart `file` → `{ url }`). When omitted, files are
   * inlined as base64 `data:` URLs instead — no backend required (guest mode).
   */
  api?: string;
  /** Extra headers to send with each upload request. */
  headers?: Record<string, string>;
}

/** Result of {@link useUpload}. */
export interface UseUploadResult {
  /** Current attachments, in insertion order, with live lifecycle state. */
  attachments: AttachmentInfo[];
  /** Queue files for upload (from a file input or a drop). */
  upload: (files: FileList | File[]) => void;
  /** Remove an attachment (aborts an in-flight upload). */
  remove: (id: string) => void;
  /** Retry a failed upload. */
  retry: (id: string) => void;
  /** Clear all attachments (e.g. after sending the message). */
  clear: () => void;
}

/**
 * Max file size for inline (base64 `data:` URL) attachments. Guest mode has no
 * upload endpoint, and the encoded conversation is persisted to localStorage
 * (~5MB quota) on every save, so larger files must error up front instead of
 * silently breaking persistence for the whole conversation.
 */
export const INLINE_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;

interface Tracked {
  info: AttachmentInfo;
  file: File;
  xhr?: XMLHttpRequest;
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

let uploadCounter = 0;
function nextId(): string {
  uploadCounter += 1;
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(uploadCounter);
  return `upload-${rand}`;
}

/** Drive file uploads and expose the resulting attachment lifecycle. */
export function useUpload(
  { api, headers }: UseUploadOptions = {},
): UseUploadResult {
  const [tracked, setTracked] = React.useState<Tracked[]>([]);
  const trackedRef = React.useRef<Tracked[]>(tracked);
  trackedRef.current = tracked;

  const patch = React.useCallback(
    (id: string, next: Partial<AttachmentInfo>) => {
      setTracked((prev) =>
        prev.map((t) => t.info.id === id ? { ...t, info: { ...t.info, ...next } } : t)
      );
    },
    [],
  );

  // No endpoint → inline the file as a base64 `data:` URL (guest mode). The
  // data URL rides along as the `file` part's `url` so the model sees it
  // without any backend or fetchable upload URL.
  const startInline = React.useCallback(
    (entry: Tracked) => {
      const { file, info } = entry;
      if (file.size > INLINE_ATTACHMENT_MAX_BYTES) {
        patch(info.id, { state: "error" });
        return;
      }
      patch(info.id, { state: "uploading", progress: 0 });
      const reader = new FileReader();
      reader.onload = () =>
        patch(info.id, {
          state: "uploaded",
          progress: 100,
          url: typeof reader.result === "string" ? reader.result : undefined,
        });
      reader.onerror = () => patch(info.id, { state: "error" });
      reader.readAsDataURL(file);
    },
    [patch],
  );

  const start = React.useCallback(
    (entry: Tracked) => {
      if (!api) {
        startInline(entry);
        return;
      }
      const { file, info } = entry;
      const xhr = new XMLHttpRequest();
      entry.xhr = xhr;
      xhr.open("POST", api);
      for (const [key, value] of Object.entries(headers ?? {})) {
        xhr.setRequestHeader(key, value);
      }
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        patch(info.id, {
          state: "uploading",
          progress: Math.round((e.loaded / e.total) * 100),
        });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          let url: string | undefined;
          try {
            const body = JSON.parse(xhr.responseText) as {
              url?: string;
              id?: string;
            };
            url = body.url;
          } catch (_) {
            /* non-JSON response — leave url undefined */
          }
          patch(info.id, { state: "uploaded", progress: 100, url });
        } else {
          patch(info.id, { state: "error" });
        }
      };
      xhr.onerror = () => patch(info.id, { state: "error" });
      xhr.onabort = () => patch(info.id, { state: "error" });

      patch(info.id, { state: "uploading", progress: 0 });
      const form = new FormData();
      form.append("file", file, file.name);
      xhr.send(form);
    },
    [api, headers, patch, startInline],
  );

  const upload = React.useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      const entries: Tracked[] = list.map((file) => ({
        file,
        info: {
          id: nextId(),
          name: file.name,
          type: file.type,
          size: file.size,
          state: "uploading",
          progress: 0,
          preview: isImage(file) ? URL.createObjectURL(file) : undefined,
        },
      }));
      setTracked((prev) => [...prev, ...entries]);
      for (const entry of entries) start(entry);
    },
    [start],
  );

  const remove = React.useCallback((id: string) => {
    const entry = trackedRef.current.find((t) => t.info.id === id);
    entry?.xhr?.abort();
    if (entry?.info.preview) URL.revokeObjectURL(entry.info.preview);
    setTracked((prev) => prev.filter((t) => t.info.id !== id));
  }, []);

  const retry = React.useCallback((id: string) => {
    const entry = trackedRef.current.find((t) => t.info.id === id);
    if (entry) start(entry);
  }, [start]);

  const clear = React.useCallback(() => {
    for (const t of trackedRef.current) {
      t.xhr?.abort();
      if (t.info.preview) URL.revokeObjectURL(t.info.preview);
    }
    setTracked([]);
  }, []);

  const attachments = React.useMemo(() => tracked.map((t) => t.info), [
    tracked,
  ]);

  return { attachments, upload, remove, retry, clear };
}
