/**
 * useAttachments — a localStorage-backed index of files uploaded across a
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
import { csrfMutationHeaders } from "#veryfront/security/csrf/browser-mutation-headers.ts";
import { isBrowserEnvironment } from "#veryfront/platform/compat/runtime.ts";
import type { UploadedFile } from "../components/attachments-panel.tsx";
import { isSafeUploadId, isSafeUploadUrl } from "../upload-url.ts";

const useIsomorphicLayoutEffect = typeof document === "undefined"
  ? React.useEffect
  : React.useLayoutEffect;

/** Options for {@link useAttachments}. */
export interface UseAttachmentsOptions {
  /**
   * Upload endpoint — `GET` lists, `POST` (multipart `file`) uploads, `DELETE`
   * removes. Usually {@link createChatUploadHandler}'s route. @default "/api/uploads"
   */
  url?: string;
  /** localStorage key for the persisted list. @default "vf-uploads" */
  storageKey?: string;
  /** Extra headers sent with upload / delete requests. */
  headers?: Record<string, string>;
}

/** Result of {@link useAttachments}. */
export interface UseAttachmentsResult {
  /** All uploaded files, newest first. */
  items: UploadedFile[];
  /** `true` until the initial list fetch resolves (localStorage cache aside). */
  isLoading: boolean;
  /** `true` while at least one upload is in flight. */
  isUploading: boolean;
  /** Error from the most recent failed upload, or `null`. Cleared when `upload` is called again. */
  uploadError: Error | null;
  /** Clear the upload error (e.g. after showing a toast). */
  clearUploadError: () => void;
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

/** Additive cache-status contract returned by {@link useAttachments}. */
export interface UseAttachmentsStorageState {
  /** Cache read/write failure, or `null`. Registry items remain usable in memory. */
  storageError: Error | null;
  /** Clear the cache error after it has been reported to the user. */
  clearStorageError: () => void;
}

/** Additive remote-request status returned by {@link useAttachments}. */
export interface UseAttachmentsRequestState {
  /** Error from the most recent failed list request, or `null`. */
  refreshError: Error | null;
  /** Clear the list-request error after it has been reported to the user. */
  clearRefreshError: () => void;
  /** Error from the most recent failed delete request, or `null`. */
  removeError: Error | null;
  /** Clear the delete-request error after it has been reported to the user. */
  clearRemoveError: () => void;
}

interface CacheLoadResult {
  items: UploadedFile[];
  error: Error | null;
}

interface ActiveRefresh {
  controller: AbortController;
  scope: symbol;
  pendingAdds: UploadedFile[];
}

interface ActiveRemoval {
  controller: AbortController;
  scope: symbol;
}

const MAX_PERSISTED_REGISTRY_BYTES = 1024 * 1024;
const MAX_PERSISTED_REGISTRY_ITEMS = 1_000;
const MAX_UPLOAD_RESPONSE_BYTES = 64 * 1024;
const MAX_REGISTRY_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_REGISTRY_PAGE_REQUESTS = 100;
const MAX_UPLOAD_ID_LENGTH = 256;
const MAX_UPLOAD_NAME_LENGTH = 4_096;
const MAX_UPLOAD_TYPE_LENGTH = 512;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(
  value: unknown,
  maxLength: number,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): value is string {
  return typeof value === "string" &&
    value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0);
}

function toUploadedFile(
  value: unknown,
  defaults: Partial<UploadedFile> = {},
): UploadedFile | null {
  if (!isRecord(value)) return null;

  const id = value.id ?? defaults.id;
  if (!isSafeUploadId(id, MAX_UPLOAD_ID_LENGTH)) return null;

  const name = value.name ?? defaults.name ?? id;
  if (!isBoundedString(name, MAX_UPLOAD_NAME_LENGTH)) return null;

  const rawSize = value.size ?? defaults.size;
  if (
    rawSize !== undefined &&
    (typeof rawSize !== "number" || !Number.isFinite(rawSize) || rawSize < 0 ||
      rawSize > Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }

  const rawType = value.mediaType ?? value.type ?? defaults.type;
  if (
    rawType !== undefined &&
    !isBoundedString(rawType, MAX_UPLOAD_TYPE_LENGTH, { allowEmpty: true })
  ) {
    return null;
  }

  const rawUrl = value.url ?? defaults.url;
  if (rawUrl !== undefined && !isSafeUploadUrl(rawUrl)) {
    return null;
  }

  return {
    id,
    name,
    ...(rawSize !== undefined ? { size: rawSize } : {}),
    ...(rawType !== undefined ? { type: rawType } : {}),
    ...(rawUrl !== undefined ? { url: rawUrl.trim() } : {}),
  };
}

function storageFailure(action: string, cause: unknown): Error {
  const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : "";
  return new Error(`Upload registry cache ${action} failed${detail}`, { cause });
}

function requestFailure(
  action: "refresh" | "remove",
  cause: unknown,
  id?: string,
): Error {
  const subject = id === undefined ? "" : ` for "${id}"`;
  const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : "";
  return new Error(`Upload registry ${action}${subject} failed${detail}`, {
    cause,
  });
}

function serializedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasDuplicateIds(items: readonly UploadedFile[]): boolean {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) return true;
    ids.add(item.id);
  }
  return false;
}

async function readBoundedJsonResponse(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (
      Number.isFinite(parsedLength) &&
      parsedLength >= 0 &&
      parsedLength > maxBytes
    ) {
      throw new Error(`response exceeds ${maxBytes} bytes`);
    }
  }

  if (response.body === null) {
    const text = await response.text();
    if (serializedByteLength(text) > maxBytes) {
      throw new Error(`response exceeds ${maxBytes} bytes`);
    }
    return JSON.parse(text);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size violation is the actionable failure.
        }
        throw new Error(`response exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(UTF8_DECODER.decode(bytes));
}

function load(storageKey: string): CacheLoadResult {
  if (!isBrowserEnvironment()) return { items: [], error: null };

  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return { items: [], error: null };
    if (
      raw.length > MAX_PERSISTED_REGISTRY_BYTES ||
      serializedByteLength(raw) > MAX_PERSISTED_REGISTRY_BYTES
    ) {
      throw new Error(
        `payload exceeds ${MAX_PERSISTED_REGISTRY_BYTES} bytes`,
      );
    }

    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      parsed.length > MAX_PERSISTED_REGISTRY_ITEMS
    ) {
      throw new Error("payload is not a bounded array");
    }

    const items = parsed.map((entry) => toUploadedFile(entry));
    if (items.some((item) => item === null)) {
      throw new Error("payload contains an invalid upload entry");
    }
    const admitted = items as UploadedFile[];
    if (hasDuplicateIds(admitted)) {
      throw new Error("payload contains duplicate upload ids");
    }
    return { items: admitted, error: null };
  } catch (error) {
    return { items: [], error: storageFailure("read", error) };
  }
}

function save(storageKey: string, items: UploadedFile[]): Error | null {
  if (!isBrowserEnvironment()) return null;

  try {
    if (items.length > MAX_PERSISTED_REGISTRY_ITEMS) {
      throw new Error(
        `item count exceeds ${MAX_PERSISTED_REGISTRY_ITEMS}`,
      );
    }
    const serialized = JSON.stringify(items);
    if (serializedByteLength(serialized) > MAX_PERSISTED_REGISTRY_BYTES) {
      throw new Error(
        `payload exceeds ${MAX_PERSISTED_REGISTRY_BYTES} bytes`,
      );
    }
    localStorage.setItem(storageKey, serialized);
    return null;
  } catch (error) {
    return storageFailure("write", error);
  }
}

function stableHeadersKey(headers: Record<string, string> | undefined): string {
  if (!headers) return "";
  return JSON.stringify(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)));
}

function setQueryParameter(
  endpoint: string,
  key: string,
  value: string,
): string {
  const hashIndex = endpoint.indexOf("#");
  const base = hashIndex === -1 ? endpoint : endpoint.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : endpoint.slice(hashIndex);
  const queryIndex = base.indexOf("?");
  const pathname = queryIndex === -1 ? base : base.slice(0, queryIndex);
  const params = new URLSearchParams(
    queryIndex === -1 ? "" : base.slice(queryIndex + 1),
  );
  params.set(key, value);
  return `${pathname}?${params.toString()}${hash}`;
}

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

/**
 * `useAttachments` — the headless state hook for chat attachments: a persistent,
 * cross-conversation registry of uploaded files with the upload / remove / list
 * actions. This is the domain primitive; render any UI on top of it (the
 * `AttachmentsPanel` / `AttachmentPill` components are one skin — bring your own).
 */
export function useAttachments(
  options: UseAttachmentsOptions = {},
): UseAttachmentsResult & UseAttachmentsStorageState & UseAttachmentsRequestState {
  const { storageKey = "vf-uploads", headers } = options;
  const endpoint = options.url ?? "/api/uploads";
  const headersKey = stableHeadersKey(headers);
  const headersRef = React.useRef(headers);
  useIsomorphicLayoutEffect(() => {
    headersRef.current = headers;
  }, [headersKey]);

  const [initialCache] = React.useState<CacheLoadResult>(() => load(storageKey));
  const [items, setItems] = React.useState<UploadedFile[]>(initialCache.items);
  const [inFlight, setInFlight] = React.useState(0);
  // The localStorage cache paints instantly, but the storage adapter is the
  // source of truth — stay "loading" until the first GET lands so surfaces can
  // show a placeholder instead of flashing the empty state.
  const [isLoading, setIsLoading] = React.useState(true);
  const [uploadError, setUploadError] = React.useState<Error | null>(null);
  const [refreshError, setRefreshError] = React.useState<Error | null>(null);
  const [removeError, setRemoveError] = React.useState<Error | null>(null);
  const [storageError, setStorageError] = React.useState<Error | null>(
    initialCache.error,
  );

  // A storage-key change must load that key before persistence is allowed.
  // `previousItems` prevents the effect pass that still sees the previous key's
  // list from copying it into the newly selected cache.
  const cacheSnapshotRef = React.useRef<{
    key: string;
    items: UploadedFile[];
    previousItems?: UploadedFile[];
  }>({
    key: storageKey,
    items: initialCache.items,
  });

  useIsomorphicLayoutEffect(() => {
    if (cacheSnapshotRef.current.key === storageKey) return;
    const loaded = load(storageKey);
    cacheSnapshotRef.current = {
      key: storageKey,
      items: loaded.items,
      previousItems: items,
    };
    setItems(loaded.items);
    setStorageError(loaded.error);
  }, [storageKey, items]);

  // Persist whenever the list changes, while surfacing quota/security failures
  // instead of claiming that the in-memory update was durable.
  React.useEffect(() => {
    const snapshot = cacheSnapshotRef.current;
    if (snapshot.key !== storageKey || snapshot.previousItems === items) return;
    if (snapshot.items === items) {
      snapshot.previousItems = undefined;
      return;
    }
    snapshot.items = items;
    snapshot.previousItems = undefined;
    setStorageError(save(storageKey, items));
  }, [storageKey, items]);

  // Every endpoint/header/cache identity gets an ownership token. A token never
  // repeats, so A → B → A still invalidates work started by the first A.
  const scope = React.useMemo(
    () => Symbol("attachments-request-scope"),
    [endpoint, headersKey, storageKey],
  );
  const activeScopeRef = React.useRef<symbol | null>(scope);
  const mountedRef = React.useRef(true);
  const controllersRef = React.useRef(new Set<AbortController>());
  const activeRefreshRef = React.useRef<ActiveRefresh | null>(null);
  const activeRemovalsRef = React.useRef(new Map<string, ActiveRemoval>());

  const isCurrentScope = React.useCallback((candidate: symbol): boolean => {
    return mountedRef.current &&
      activeScopeRef.current === candidate;
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeScopeRef.current = null;
    };
  }, []);

  useIsomorphicLayoutEffect(() => {
    activeScopeRef.current = scope;
    setInFlight(0);
    setIsLoading(true);
    setUploadError(null);
    setRefreshError(null);
    setRemoveError(null);
    return () => {
      if (activeScopeRef.current === scope) activeScopeRef.current = null;
      for (const controller of controllersRef.current) controller.abort();
      controllersRef.current.clear();
      if (activeRefreshRef.current?.scope === scope) {
        activeRefreshRef.current = null;
      }
      for (const [id, removal] of activeRemovalsRef.current) {
        if (removal.scope === scope) activeRemovalsRef.current.delete(id);
      }
    };
  }, [scope]);

  const add = React.useCallback((file: UploadedFile) => {
    if (!isCurrentScope(scope)) return;
    const admitted = toUploadedFile(file);
    if (!admitted) return;

    const activeRefresh = activeRefreshRef.current;
    if (
      activeRefresh &&
      isCurrentScope(activeRefresh.scope) &&
      !activeRefresh.pendingAdds.some((item) => item.id === admitted.id)
    ) {
      activeRefresh.pendingAdds.push(admitted);
    }
    setItems((prev) => {
      if (prev.some((item) => item.id === admitted.id)) return prev;
      return [admitted, ...prev];
    });
  }, [isCurrentScope, scope]);

  const clearUploadError = React.useCallback(() => {
    if (isCurrentScope(scope)) setUploadError(null);
  }, [isCurrentScope, scope]);
  const clearStorageError = React.useCallback(() => {
    if (isCurrentScope(scope)) setStorageError(null);
  }, [isCurrentScope, scope]);
  const clearRefreshError = React.useCallback(() => {
    if (isCurrentScope(scope)) setRefreshError(null);
  }, [isCurrentScope, scope]);
  const clearRemoveError = React.useCallback(() => {
    if (isCurrentScope(scope)) setRemoveError(null);
  }, [isCurrentScope, scope]);

  const upload = React.useCallback(
    (files: FileList | File[]) => {
      if (!isCurrentScope(scope)) return;
      // Clear any previous error so the UI can reset before the new attempt.
      setUploadError(null);
      for (const file of Array.from(files)) {
        const controller = new AbortController();
        controllersRef.current.add(controller);
        setInFlight((n) => n + 1);
        void (async () => {
          try {
            const form = new FormData();
            form.append("file", file, file.name);
            const response = await fetch(endpoint, {
              method: "POST",
              body: form,
              // Production enables CSRF by default, so this POST has to echo
              // the `__Host-vf_csrf` cookie or the server answers 403.
              headers: csrfMutationHeaders(endpoint, { headers: headersRef.current }),
              signal: controller.signal,
            });
            if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
            const body = await readBoundedJsonResponse(
              response,
              MAX_UPLOAD_RESPONSE_BYTES,
            );
            const admitted = toUploadedFile(body, {
              name: file.name,
              size: file.size,
              type: file.type,
            });
            if (!admitted) throw new Error("Upload response is invalid");
            if (!isCurrentScope(scope) || controller.signal.aborted) return;
            add(admitted);
          } catch (error) {
            if (!isCurrentScope(scope) || controller.signal.aborted) return;
            setUploadError(toError(error, "Upload failed"));
          } finally {
            controllersRef.current.delete(controller);
            if (isCurrentScope(scope)) {
              setInFlight((n) => Math.max(0, n - 1));
            }
          }
        })();
      }
    },
    [add, endpoint, isCurrentScope, scope],
  );

  const remove = React.useCallback(
    async (id: string): Promise<void> => {
      if (!isCurrentScope(scope)) return;
      setRemoveError(null);
      const previous = activeRemovalsRef.current.get(id);
      previous?.controller.abort();

      const controller = new AbortController();
      const active: ActiveRemoval = { controller, scope };
      activeRemovalsRef.current.set(id, active);
      controllersRef.current.add(controller);
      try {
        const target = setQueryParameter(endpoint, "id", id);
        const response = await fetch(target, {
          method: "DELETE",
          // Same CSRF requirement as the upload POST above. The token is keyed
          // off the request target, so pass the `?id=` URL actually being hit.
          headers: csrfMutationHeaders(target, { headers: headersRef.current }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`request returned HTTP ${response.status}`);
        }
        if (
          !isCurrentScope(scope) ||
          controller.signal.aborted ||
          activeRemovalsRef.current.get(id) !== active
        ) {
          return;
        }
        setItems((prev) => prev.filter((f) => f.id !== id));
      } catch (error) {
        // Keep the local item so a transient network failure remains retryable.
        if (
          isCurrentScope(scope) &&
          !controller.signal.aborted &&
          activeRemovalsRef.current.get(id) === active
        ) {
          setRemoveError(requestFailure("remove", error, id));
        }
      } finally {
        controllersRef.current.delete(controller);
        if (activeRemovalsRef.current.get(id) === active) {
          activeRemovalsRef.current.delete(id);
        }
      }
    },
    [endpoint, isCurrentScope, scope],
  );

  const clear = React.useCallback(() => {
    if (isCurrentScope(scope)) setItems([]);
  }, [isCurrentScope, scope]);

  // The storage adapter is the source of truth: pull the full stored list so
  // the surface shows everything (other sessions, chat uploads, this tab),
  // not just what this browser's localStorage happens to remember.
  const refresh = React.useCallback(async () => {
    if (!isCurrentScope(scope)) return;
    activeRefreshRef.current?.controller.abort();
    setRefreshError(null);

    const controller = new AbortController();
    const active: ActiveRefresh = {
      controller,
      scope,
      pendingAdds: [],
    };
    activeRefreshRef.current = active;
    controllersRef.current.add(controller);
    setIsLoading(true);
    try {
      const serverItems: UploadedFile[] = [];
      const serverIds = new Set<string>();
      const requestedPages = new Set<string>();
      let requestUrl = endpoint;

      while (true) {
        if (
          requestedPages.has(requestUrl) ||
          requestedPages.size >= MAX_REGISTRY_PAGE_REQUESTS
        ) {
          throw new Error("paginated response exceeded the page-request budget");
        }
        requestedPages.add(requestUrl);
        const response = await fetch(requestUrl, {
          headers: headersRef.current,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`request returned HTTP ${response.status}`);
        }
        const body = await readBoundedJsonResponse(
          response,
          MAX_REGISTRY_RESPONSE_BYTES,
        );
        if (
          controller.signal.aborted ||
          !isCurrentScope(scope) ||
          activeRefreshRef.current !== active
        ) {
          return;
        }
        if (
          !isRecord(body) ||
          !Array.isArray(body.items) ||
          body.items.length > MAX_PERSISTED_REGISTRY_ITEMS ||
          ("hasMore" in body && typeof body.hasMore !== "boolean")
        ) {
          throw new Error("response is not a bounded upload list");
        }
        const normalizedItems = body.items.map((entry) =>
          toUploadedFile(entry, {
            size: 0,
            type: "application/octet-stream",
          })
        );
        // A page is one authoritative unit. Accepting a partial page would
        // silently erase malformed entries, so reject the complete refresh.
        if (normalizedItems.some((item) => item === null)) {
          throw new Error("response contains an invalid upload entry");
        }
        for (const item of normalizedItems as UploadedFile[]) {
          if (serverIds.has(item.id)) {
            throw new Error("response contains duplicate upload ids");
          }
          serverIds.add(item.id);
          serverItems.push(item);
        }
        if (serverItems.length > MAX_PERSISTED_REGISTRY_ITEMS) {
          throw new Error(
            `response exceeds ${MAX_PERSISTED_REGISTRY_ITEMS} upload entries`,
          );
        }
        if (body.hasMore !== true) break;
        if (
          !Number.isSafeInteger(body.offset) ||
          (body.offset as number) < 0 ||
          !Number.isSafeInteger(body.limit) ||
          (body.limit as number) <= 0 ||
          (body.limit as number) > MAX_PERSISTED_REGISTRY_ITEMS ||
          normalizedItems.length === 0
        ) {
          throw new Error("paginated response does not make forward progress");
        }
        const nextOffset = (body.offset as number) + normalizedItems.length;
        if (!Number.isSafeInteger(nextOffset)) {
          throw new Error("paginated response offset exceeds the safe integer range");
        }
        requestUrl = setQueryParameter(
          setQueryParameter(endpoint, "limit", String(body.limit)),
          "offset",
          String(nextOffset),
        );
      }

      // The server list wins, except for items added while this fetch was in
      // flight: the snapshot predates them, so fold them back on top.
      const concurrent = active.pendingAdds.filter(
        (f) => !serverItems.some((s) => s.id === f.id),
      );
      setItems([...concurrent, ...serverItems]);
    } catch (error) {
      // Offline, invalid, and unsupported list responses preserve the cache but
      // remain observable so the UI does not present stale data as server truth.
      if (
        isCurrentScope(scope) &&
        !controller.signal.aborted &&
        activeRefreshRef.current === active
      ) {
        setRefreshError(requestFailure("refresh", error));
      }
    } finally {
      controllersRef.current.delete(controller);
      if (activeRefreshRef.current === active) {
        activeRefreshRef.current = null;
      }
      if (isCurrentScope(scope) && activeRefreshRef.current === null) {
        setIsLoading(false);
      }
    }
  }, [endpoint, isCurrentScope, scope]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    items,
    isLoading,
    isUploading: inFlight > 0,
    uploadError,
    clearUploadError,
    refreshError,
    clearRefreshError,
    removeError,
    clearRemoveError,
    storageError,
    clearStorageError,
    upload,
    add,
    remove,
    clear,
    refresh,
  };
}
