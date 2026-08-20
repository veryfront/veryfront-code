/**
 * useUpload — a minimal file-upload client that drives the `Attachment` pill
 * lifecycle states. Forks the *technique* of Studio's `useInlineFileUpload`
 * (blob preview → POST → resolved URL), simplified to a single multipart POST:
 *
 *   POST `{url}` with `FormData { file }` → `{ id?, url }`
 *
 * Each file is tracked as an `AttachmentInfo` that transitions
 * `uploading` (with `progress`) → `uploaded` (with `url`) or `error`. Upload
 * progress uses `XMLHttpRequest` (fetch has no upload-progress event). Image
 * files get an object-URL `preview` immediately.
 *
 * @module react/components/chat/hooks/use-upload
 */
import * as React from "react";
import { csrfMutationHeaders } from "#veryfront/security/csrf/browser-mutation-headers.ts";
import {
  scopeCommitRequiresRenderPublication,
  useScopeCommitEffect,
} from "#veryfront/react/compat/scope-commit-effect.ts";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import { isSafeUploadId, isSafeUploadUrl, resolveSafeUploadUrl } from "../upload-url.ts";
import { reportUnhandledError } from "./report-unhandled-error.ts";

const useIsomorphicLayoutEffect = typeof document === "undefined"
  ? React.useEffect
  : React.useLayoutEffect;

/** Options for {@link useUpload}. */
export interface UseUploadOptions {
  /**
   * Upload endpoint (multipart `file` → `{ url }`). When omitted, files are
   * inlined as base64 `data:` URLs instead — no backend required (guest mode).
   */
  url?: string;
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
  operation?: UploadOperation;
}

interface UploadOperation {
  scope: symbol;
  cancelled: boolean;
  settled: boolean;
  reader?: FileReader;
  xhr?: XMLHttpRequest;
}

/** Parsed success payload returned by a durable chat upload endpoint. */
export interface ChatUploadResponse {
  url: string;
  uploadId?: string;
}

const MAX_CHAT_UPLOAD_RESPONSE_BYTES = 64 * 1024;

/** Parse and validate a durable chat upload response. */
export function parseChatUploadResponse(
  responseText: string,
  baseUrl?: string,
): ChatUploadResponse | null {
  // Bound parsing work and retain room for normal signed URLs + metadata.
  if (
    responseText.length > MAX_CHAT_UPLOAD_RESPONSE_BYTES ||
    new TextEncoder().encode(responseText).byteLength > MAX_CHAT_UPLOAD_RESPONSE_BYTES
  ) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(responseText);
    if (
      typeof value !== "object" ||
      value === null ||
      !("url" in value) ||
      typeof value.url !== "string" ||
      value.url.length === 0 ||
      !isSafeUploadUrl(value.url)
    ) {
      return null;
    }
    let uploadId: string | undefined;
    if ("id" in value && value.id !== undefined) {
      if (!isSafeUploadId(value.id)) return null;
      uploadId = value.id;
    }
    const url = baseUrl === undefined ? value.url.trim() : resolveSafeUploadUrl(value.url, baseUrl);
    if (!url) return null;
    return {
      url,
      ...(uploadId ? { uploadId } : {}),
    };
  } catch {
    return null;
  }
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

interface UploadCrypto {
  getRandomValues?: Crypto["getRandomValues"];
  randomUUID?: () => string;
}

/** Create a collision-resistant local attachment id from Web Crypto. */
export function createUploadId(
  cryptoProvider: UploadCrypto | null | undefined = globalThis.crypto,
): string {
  if (typeof cryptoProvider?.randomUUID === "function") {
    const id = cryptoProvider.randomUUID();
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError("crypto.randomUUID() returned an invalid upload identifier");
    }
    return `upload-${id}`;
  }

  if (typeof cryptoProvider?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoProvider.getRandomValues(bytes);
    // RFC 4122 version 4 / variant bits make the fallback interoperable with
    // UUID tooling while retaining 122 bits of Web Crypto entropy.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `upload-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
      hex.slice(16, 20)
    }-${hex.slice(20)}`;
  }

  throw new Error(
    "File uploads require crypto.randomUUID() or crypto.getRandomValues() for collision-resistant attachment identifiers",
  );
}

function stableHeadersKey(headers: Record<string, string> | undefined): string {
  if (!headers) return "";
  return JSON.stringify(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)));
}

function detachOperationHandlers(operation: UploadOperation): void {
  if (operation.reader) {
    operation.reader.onload = null;
    operation.reader.onerror = null;
    operation.reader.onabort = null;
  }
  if (operation.xhr) {
    operation.xhr.onload = null;
    operation.xhr.onerror = null;
    operation.xhr.onabort = null;
    operation.xhr.upload.onprogress = null;
  }
}

function revokePreview(preview: string | undefined): void {
  if (!preview) return;
  try {
    URL.revokeObjectURL(preview);
  } catch (cause) {
    reportUnhandledError(cause);
  }
}

/** Drive file uploads and expose the resulting attachment lifecycle. */
export function useUpload(
  { url, headers }: UseUploadOptions = {},
): UseUploadResult {
  const [tracked, setTracked] = React.useState<Tracked[]>([]);
  const trackedRef = React.useRef<Tracked[]>(tracked);
  useIsomorphicLayoutEffect(() => {
    trackedRef.current = tracked;
  }, [tracked]);
  const mountedRef = React.useRef(true);
  const headersKey = stableHeadersKey(headers);
  const headerEntries = React.useMemo(() => {
    return Object.freeze(Object.entries(headers ?? {}));
  }, [headersKey]);
  const scope = React.useMemo(
    () => Symbol("chat-upload-scope"),
    [url, headersKey],
  );
  const activeScopeRef = React.useRef<symbol | null>(scope);

  const isCurrentOperation = React.useCallback(
    (operation: UploadOperation): boolean => {
      return mountedRef.current &&
        !operation.cancelled &&
        !operation.settled &&
        operation.scope === activeScopeRef.current &&
        trackedRef.current.some((entry) => entry.operation === operation);
    },
    [],
  );

  const updateOperation = React.useCallback(
    (operation: UploadOperation, nextInfo: Partial<AttachmentInfo>): boolean => {
      if (!isCurrentOperation(operation)) return false;
      const previous = trackedRef.current;
      const index = previous.findIndex((entry) => entry.operation === operation);
      if (index === -1) return false;
      const next = [...previous];
      next[index] = {
        ...previous[index]!,
        info: { ...previous[index]!.info, ...nextInfo },
      };
      trackedRef.current = next;
      setTracked(next);
      return true;
    },
    [isCurrentOperation],
  );

  const settleOperation = React.useCallback(
    (operation: UploadOperation, nextInfo: Partial<AttachmentInfo>) => {
      if (!updateOperation(operation, nextInfo)) return;
      operation.settled = true;
      detachOperationHandlers(operation);
      operation.reader = undefined;
      operation.xhr = undefined;
    },
    [updateOperation],
  );

  const cancelOperation = React.useCallback((entry: Tracked) => {
    const operation = entry.operation;
    if (!operation || operation.cancelled) return;
    operation.cancelled = true;
    detachOperationHandlers(operation);
    const reader = operation.reader;
    const xhr = operation.xhr;
    operation.reader = undefined;
    operation.xhr = undefined;
    if (reader && reader.readyState === reader.LOADING) {
      try {
        reader.abort();
      } catch (cause) {
        reportUnhandledError(cause);
      }
    }
    if (xhr) {
      try {
        xhr.abort();
      } catch (cause) {
        reportUnhandledError(cause);
      }
    }
  }, []);

  const start = React.useCallback(
    (candidate: Tracked) => {
      if (!mountedRef.current || activeScopeRef.current !== scope) return;
      const entry = trackedRef.current.find((item) => item.info.id === candidate.info.id);
      if (!entry) return;

      cancelOperation(entry);
      const operation: UploadOperation = {
        scope,
        cancelled: false,
        settled: false,
      };
      const nextInfo = {
        ...entry.info,
        state: "uploading" as const,
        progress: 0,
      };
      delete nextInfo.url;
      delete nextInfo.uploadId;
      const replacement: Tracked = { ...entry, info: nextInfo, operation };
      const nextTracked = trackedRef.current.map((item) =>
        item.info.id === entry.info.id ? replacement : item
      );
      trackedRef.current = nextTracked;
      setTracked(nextTracked);

      // No endpoint → inline the file as a base64 `data:` URL (guest mode).
      // This is the one explicit data-URL policy: the value is generated from
      // the selected File and never admitted from a server/cache response.
      if (!url) {
        if (entry.file.size > INLINE_ATTACHMENT_MAX_BYTES) {
          settleOperation(operation, { state: "error" });
          return;
        }
        try {
          const reader = new FileReader();
          operation.reader = reader;
          reader.onload = () => {
            const url = typeof reader.result === "string" ? reader.result : null;
            settleOperation(
              operation,
              url ? { state: "uploaded", progress: 100, url } : { state: "error" },
            );
          };
          reader.onerror = () => settleOperation(operation, { state: "error" });
          reader.onabort = () => {
            if (!operation.cancelled) {
              settleOperation(operation, { state: "error" });
            }
          };
          reader.readAsDataURL(entry.file);
        } catch {
          settleOperation(operation, { state: "error" });
        }
        return;
      }
      try {
        const xhr = new XMLHttpRequest();
        operation.xhr = xhr;
        xhr.open("POST", url);
        // A production build turns `security.csrf` on by default, so this POST
        // has to echo the `__Host-vf_csrf` cookie back or the server answers
        // 403 — dev, where CSRF is off, would never show it. The helper keeps
        // any caller-supplied header and skips cross-origin endpoints.
        for (const [key, value] of csrfMutationHeaders(url, [...headerEntries])) {
          xhr.setRequestHeader(key, value);
        }
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable || event.total <= 0) return;
          updateOperation(operation, {
            state: "uploading",
            progress: Math.max(
              0,
              Math.min(100, Math.round((event.loaded / event.total) * 100)),
            ),
          });
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const response = parseChatUploadResponse(
              xhr.responseText,
              xhr.responseURL ||
                (typeof document === "undefined" ? undefined : document.baseURI),
            );
            settleOperation(
              operation,
              response
                ? {
                  state: "uploaded",
                  progress: 100,
                  url: response.url,
                  ...(response.uploadId ? { uploadId: response.uploadId } : {}),
                }
                : { state: "error" },
            );
          } else {
            settleOperation(operation, { state: "error" });
          }
        };
        xhr.onerror = () => settleOperation(operation, { state: "error" });
        xhr.onabort = () => {
          if (!operation.cancelled) {
            settleOperation(operation, { state: "error" });
          }
        };

        const form = new FormData();
        form.append("file", entry.file, entry.file.name);
        xhr.send(form);
      } catch {
        settleOperation(operation, { state: "error" });
      }
    },
    [
      cancelOperation,
      headerEntries,
      url,
      scope,
      settleOperation,
      updateOperation,
    ],
  );

  const upload = React.useCallback(
    (files: FileList | File[]) => {
      if (!mountedRef.current || activeScopeRef.current !== scope) return;
      const list = Array.from(files);
      const entries: Tracked[] = [];
      try {
        for (const file of list) {
          entries.push({
            file,
            info: {
              id: createUploadId(),
              name: file.name,
              type: file.type,
              size: file.size,
              state: "uploading",
              progress: 0,
              preview: isImage(file) ? URL.createObjectURL(file) : undefined,
            },
          });
        }
      } catch (cause) {
        for (const entry of entries) revokePreview(entry.info.preview);
        throw cause;
      }
      const next = [...trackedRef.current, ...entries];
      trackedRef.current = next;
      setTracked(next);
      for (const entry of entries) start(entry);
    },
    [start],
  );

  const remove = React.useCallback((id: string) => {
    if (!mountedRef.current) return;
    const entry = trackedRef.current.find((t) => t.info.id === id);
    if (entry) cancelOperation(entry);
    revokePreview(entry?.info.preview);
    const next = trackedRef.current.filter((t) => t.info.id !== id);
    trackedRef.current = next;
    setTracked(next);
  }, [cancelOperation]);

  const retry = React.useCallback((id: string) => {
    if (!mountedRef.current) return;
    const entry = trackedRef.current.find((t) => t.info.id === id);
    if (entry) start(entry);
  }, [start]);

  const clear = React.useCallback(() => {
    if (!mountedRef.current) return;
    for (const t of trackedRef.current) {
      cancelOperation(t);
      revokePreview(t.info.preview);
    }
    trackedRef.current = [];
    setTracked([]);
  }, [cancelOperation]);

  if (scopeCommitRequiresRenderPublication) {
    activeScopeRef.current = scope;
  }
  useScopeCommitEffect(() => {
    activeScopeRef.current = scope;
    return () => {
      if (activeScopeRef.current === scope) activeScopeRef.current = null;
    };
  }, [scope]);

  // Prop changes transfer ownership to a fresh scope. Abort the previous
  // endpoint/header work and leave each affected attachment explicitly
  // retryable; callbacks from transports that ignore abort no longer own state.
  useIsomorphicLayoutEffect(() => {
    let changed = false;
    const next = trackedRef.current.map((entry) => {
      const operation = entry.operation;
      if (
        !operation ||
        operation.scope === scope ||
        operation.cancelled ||
        operation.settled
      ) {
        return entry;
      }
      cancelOperation(entry);
      changed = true;
      return {
        ...entry,
        operation: undefined,
        info: { ...entry.info, state: "error" as const },
      };
    });
    if (changed) {
      trackedRef.current = next;
      setTracked(next);
    }
  }, [cancelOperation, scope]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const entry of trackedRef.current) {
        cancelOperation(entry);
        revokePreview(entry.info.preview);
      }
      trackedRef.current = [];
    };
  }, [cancelOperation]);

  const attachments = React.useMemo(() => tracked.map((t) => t.info), [
    tracked,
  ]);

  return { attachments, upload, remove, retry, clear };
}
