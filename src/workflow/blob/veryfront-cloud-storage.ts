import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { agentLogger as logger } from "#veryfront/utils";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { API_ERROR, CONFIG_INVALID, INVALID_ARGUMENT } from "#veryfront/errors";
import {
  getVeryfrontCloudBootstrap,
  getVeryfrontCloudHostBootstrap,
  getVeryfrontCloudProjectSlug,
} from "#veryfront/platform/cloud/resolver.ts";
import {
  guardedOutboundFetch,
  OutboundRequestBlockedError,
} from "#veryfront/security/http/outbound-fetch.ts";
import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.ts";
import { assertSafeBlobId, isSafeBlobId } from "./blob-id.ts";

const DEFAULT_PREFIX = ".veryfront/blobs/";
const DATA_SUFFIX = ".blob";
const META_SUFFIX = ".meta.json";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;
const ERROR_RESPONSE_BYTES = 8 * 1024;
const MAX_BLOB_MIME_TYPE_BYTES = 1_024;
const MAX_BLOB_METADATA_ENTRIES = 128;
const MAX_BLOB_METADATA_KEY_BYTES = 256;
const MAX_BLOB_METADATA_VALUE_BYTES = 8 * 1024;
const MAX_BLOB_USER_METADATA_BYTES = 64 * 1024;
const MAX_BLOB_METADATA_ENVELOPE_BYTES = 4 * 1024;
const MAX_BLOB_METADATA_SIDECAR_BYTES = 128 * 1024;
const textEncoder = new TextEncoder();
// Stored-login credentials are attached after project code may have loaded.
// Construct and mutate their header container through captured intrinsics.
const NativeHeaders = Headers;
const applyIntrinsic = Reflect.apply;
const headersHas = NativeHeaders.prototype.has;
const headersSet = NativeHeaders.prototype.set;
const NativeURL = URL;
const urlOriginGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "origin")?.get;
const stringReplace = String.prototype.replace;

function readUrlOrigin(url: URL): string {
  if (!urlOriginGetter) throw new TypeError("Native URL origin getter is unavailable");
  return applyIntrinsic(urlOriginGetter, url, []) as string;
}

const getUploadCreateResponseSchema = defineSchema((v) =>
  v.object({
    file_upload_url: v.string().url(),
    file_path: v.string(),
    upload_id: v.string(),
    required_headers: v.record(v.string(), v.string()),
  })
);

const getUploadMetadataResponseSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    path: v.string(),
    file_name: v.string(),
    content_type: v.string().nullable(),
    size: v.number(),
    url: v.string().nullable(),
    status: v.enum(["pending", "active", "failed"]),
    visibility: v.enum(["project", "public", "private"]),
    created_at: v.string(),
    updated_at: v.string(),
    deleted_at: v.string().nullable(),
  })
);

const getUploadSignedUrlResponseSchema = defineSchema((v) =>
  v.object({
    signed_url: v.string().url(),
    expires_at: v.string(),
  })
);

const getUploadListResponseSchema = defineSchema((v) =>
  v.object({
    data: v.array(v.object({ path: v.string().optional() }).passthrough()).optional(),
  })
);

const getBlobMetadataSchema = defineSchema((v) =>
  v.object({
    version: v.literal(1),
    id: v.string(),
    size: v.number().nonnegative(),
    mimeType: v.string(),
    createdAt: v.string(),
    expiresAt: v.string().optional(),
    metadata: v.record(v.string(), v.string()).optional(),
  })
);

const UploadCreateResponseSchema = lazySchema(getUploadCreateResponseSchema);
const UploadMetadataResponseSchema = lazySchema(getUploadMetadataResponseSchema);
const UploadSignedUrlResponseSchema = lazySchema(getUploadSignedUrlResponseSchema);
const UploadListResponseSchema = lazySchema(getUploadListResponseSchema);
const BlobMetadataSchema = lazySchema(getBlobMetadataSchema);

type UploadMetadataResponse = InferSchema<ReturnType<typeof getUploadMetadataResponseSchema>>;
type BlobMetadata = InferSchema<ReturnType<typeof getBlobMetadataSchema>>;

export interface VeryfrontCloudBlobStorageConfig {
  /** Veryfront API base URL. Defaults to the current Veryfront Cloud bootstrap. */
  apiBaseUrl?: string;
  /** Explicit Veryfront auth token or API key override. */
  apiToken?: string;
  /** Project slug override. Defaults to request-scoped or env bootstrap. */
  projectSlug?: string;
  /** Upload path prefix inside the project's uploads store. */
  prefix?: string;
  /** Default TTL in seconds for new blobs. Stored in sidecar metadata only. */
  defaultTtl?: number;
  /** Requested TTL in seconds for signed download URLs. */
  downloadTtl?: number;
  /** Time source for tests. */
  now?: () => Date;
  /** Full-operation outbound deadline, including response-body consumption. */
  requestTimeoutMs?: number;
  /** Maximum decoded API or signed-download response body size. */
  maxResponseBytes?: number;
  /** Maximum bytes accepted for one blob upload, including streamed input. */
  maxUploadBytes?: number;
}

interface ResolvedConfig {
  apiBaseUrl: string;
  apiToken: string;
  projectSlug: string;
  prefix: string;
  defaultTtl?: number;
  downloadTtl?: number;
  now: () => Date;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  maxUploadBytes: number;
}

function requirePositiveInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw CONFIG_INVALID.create({
      detail: `${name} must be a positive integer no greater than ${maximum}`,
    });
  }
  return value;
}

function createRequestScope(timeoutMs: number): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Blob request timed out", "TimeoutError")),
    timeoutMs,
  );
  return { signal: controller.signal, dispose: () => clearTimeout(timeout) };
}

async function readResponseBytes(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  return await readStreamBytes(response.body, maximumBytes, signal, "Blob response");
}

async function readStreamBytes(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
  signal: AbortSignal,
  label: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let complete = false;
  let failure: unknown;
  const read = async (): Promise<ReadableStreamReadResult<Uint8Array>> =>
    await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      reader.read().then(resolve, reject).finally(() =>
        signal.removeEventListener("abort", onAbort)
      );
    });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await read();
      if (done) {
        complete = true;
        break;
      }
      if (length > maximumBytes - value.byteLength) {
        throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);
      }
      chunks.push(value);
      length += value.byteLength;
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (!complete) {
      // A project-owned stream can return a cancellation promise that never
      // settles. Start cleanup, but never let it extend the operation deadline.
      try {
        void reader.cancel(failure ?? signal.reason).catch(() => {});
      } catch {
        // Cancellation is best effort after the bounded read has failed.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // A pending hostile read can keep the lock until cancellation settles.
    }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function invalidBlobOption(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function boundedUtf8Length(value: string, maximumBytes: number, label: string): number {
  // UTF-8 uses at least one byte per UTF-16 code unit for valid scalar text.
  // Reject by code-unit length first so a huge string is never encoded merely
  // to discover that it exceeds the byte ceiling.
  if (value.length > maximumBytes) {
    return invalidBlobOption(`${label} exceeds ${maximumBytes} bytes`);
  }
  const length = textEncoder.encode(value).byteLength;
  if (length > maximumBytes) {
    return invalidBlobOption(`${label} exceeds ${maximumBytes} bytes`);
  }
  return length;
}

function normalizeMimeType(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    return invalidBlobOption("Blob mimeType must be a non-empty trimmed string");
  }
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      return invalidBlobOption("Blob mimeType must not contain control characters");
    }
  }
  boundedUtf8Length(value, MAX_BLOB_MIME_TYPE_BYTES, "Blob mimeType");
  return value;
}

function snapshotBlobMetadata(
  value: unknown,
  maximumBytes: number,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidBlobOption("Blob metadata must be a plain string record");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidBlobOption("Blob metadata must be a plain string record");
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > MAX_BLOB_METADATA_ENTRIES) {
    return invalidBlobOption(
      `Blob metadata must contain at most ${MAX_BLOB_METADATA_ENTRIES} entries`,
    );
  }

  const snapshot = Object.create(null) as Record<string, string>;
  let rawBytes = 0;
  for (const key of keys) {
    if (typeof key !== "string") {
      return invalidBlobOption("Blob metadata keys must be strings");
    }
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return invalidBlobOption("Blob metadata must contain enumerable data properties only");
    }
    if (typeof descriptor.value !== "string") {
      return invalidBlobOption("Blob metadata values must be strings");
    }
    const keyBytes = boundedUtf8Length(
      key,
      MAX_BLOB_METADATA_KEY_BYTES,
      "Blob metadata key",
    );
    const valueBytes = boundedUtf8Length(
      descriptor.value,
      MAX_BLOB_METADATA_VALUE_BYTES,
      `Blob metadata value for "${key}"`,
    );
    if (rawBytes > maximumBytes - keyBytes - valueBytes) {
      return invalidBlobOption(`Blob metadata exceeds ${maximumBytes} bytes`);
    }
    rawBytes += keyBytes + valueBytes;
    snapshot[key] = descriptor.value;
  }

  const serialized = JSON.stringify(snapshot);
  boundedUtf8Length(serialized, maximumBytes, "Blob metadata");
  return snapshot;
}

function snapshotStoreBlobOptions(value: unknown): {
  id: unknown;
  mimeType: unknown;
  metadata: unknown;
  ttl: unknown;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidBlobOption("Blob storage options must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidBlobOption("Blob storage options must be a plain object");
  }

  const read = (name: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor) return undefined;
    if (!("value" in descriptor)) {
      return invalidBlobOption(`Blob storage option "${name}" must be a data property`);
    }
    return descriptor.value;
  };
  return {
    id: read("id"),
    mimeType: read("mimeType"),
    metadata: read("metadata"),
    ttl: read("ttl"),
  };
}

function normalizeBlobTtl(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalidBlobOption("Blob ttl must be a non-negative safe integer");
  }
  return value;
}

async function readErrorBody(response: Response, signal: AbortSignal): Promise<string> {
  try {
    return (await readResponseTextPrefix(response, ERROR_RESPONSE_BYTES, signal, {
      fatalUtf8: true,
    })).text;
  } catch {
    return "";
  }
}

function normalizePrefix(prefix: string | undefined): string {
  const value = (prefix ?? DEFAULT_PREFIX).trim().replace(/^\/+/, "");
  if (!value) return DEFAULT_PREFIX;
  return value.endsWith("/") ? value : `${value}/`;
}

function joinUrl(base: string, path: string): string {
  const normalizedBase = applyIntrinsic(stringReplace, base, [/\/+$/, ""]) as string;
  const normalizedPath = applyIntrinsic(stringReplace, path, [/^\/+/, ""]) as string;
  return `${normalizedBase}/${normalizedPath}`;
}

function mapBlobMetadataToRef(blob: BlobMetadata): BlobRef {
  return {
    __kind: "blob",
    id: blob.id,
    size: blob.size,
    mimeType: blob.mimeType,
    createdAt: new Date(blob.createdAt),
    expiresAt: blob.expiresAt ? new Date(blob.expiresAt) : undefined,
    metadata: blob.metadata,
  };
}

function mapUploadMetadataToRef(upload: UploadMetadataResponse, id: string): BlobRef {
  return {
    __kind: "blob",
    id,
    size: upload.size,
    mimeType: upload.content_type ?? "application/octet-stream",
    createdAt: new Date(upload.created_at),
  };
}

async function attachSignedUrl(
  ref: BlobRef,
  path: string,
  resolved: ResolvedConfig,
  getDownloadUrl: (
    path: string,
    resolved: ResolvedConfig,
  ) => Promise<{ signedUrl: string; expiresAt: Date } | null>,
): Promise<BlobRef> {
  try {
    const download = await getDownloadUrl(path, resolved);
    return download ? { ...ref, url: download.signedUrl } : ref;
  } catch (error) {
    logger.warn("Failed to resolve signed URL for cloud blob", {
      id: ref.id,
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return ref;
  }
}

async function normalizeUploadBody(
  data: string | Uint8Array | Blob | ReadableStream,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<{ body: BodyInit; size: number }> {
  const assertWithinLimit = (size: number): void => {
    if (size > maximumBytes) {
      throw INVALID_ARGUMENT.create({
        detail: `Veryfront Cloud blob upload exceeds ${maximumBytes} bytes`,
      });
    }
  };

  signal.throwIfAborted();
  if (typeof data === "string") {
    const bytes = new TextEncoder().encode(data);
    assertWithinLimit(bytes.byteLength);
    return { body: bytes, size: bytes.byteLength };
  }

  if (data instanceof Uint8Array) {
    const bytes = Uint8Array.from(data);
    assertWithinLimit(bytes.byteLength);
    return { body: bytes, size: bytes.byteLength };
  }

  if (data instanceof Blob) {
    assertWithinLimit(data.size);
    return { body: data, size: data.size };
  }

  if (data instanceof ReadableStream) {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await readStreamBytes(data, maximumBytes, signal, "Blob upload");
    } catch (error) {
      if (error instanceof RangeError) {
        throw INVALID_ARGUMENT.create({ detail: error.message, cause: error });
      }
      throw error;
    }
    return { body: bytes, size: bytes.byteLength };
  }

  throw INVALID_ARGUMENT.create({
    detail: "Unsupported data type for VeryfrontCloudBlobStorage",
  });
}

export class VeryfrontCloudBlobStorage implements BlobStorage {
  private config: VeryfrontCloudBlobStorageConfig;

  constructor(config: VeryfrontCloudBlobStorageConfig = {}) {
    this.config = config;
  }

  async put(
    data: string | Uint8Array | Blob | ReadableStream,
    options: StoreBlobOptions = {},
  ): Promise<BlobRef> {
    const resolved = this.#resolveConfig();
    const scope = createRequestScope(resolved.requestTimeoutMs);
    try {
      const optionSnapshot = snapshotStoreBlobOptions(options);
      const id = optionSnapshot.id ?? crypto.randomUUID();
      assertSafeBlobId(id);
      const mimeType = normalizeMimeType(
        optionSnapshot.mimeType ?? "application/octet-stream",
      );
      const metadata = snapshotBlobMetadata(
        optionSnapshot.metadata,
        Math.min(resolved.maxUploadBytes, MAX_BLOB_USER_METADATA_BYTES),
      );
      const { body, size } = await normalizeUploadBody(
        data,
        resolved.maxUploadBytes,
        scope.signal,
      );
      const createdAt = resolved.now();
      const ttl = normalizeBlobTtl(optionSnapshot.ttl ?? resolved.defaultTtl);
      const expiresAt = ttl ? new Date(createdAt.getTime() + ttl * 1000) : undefined;

      const blobRef: BlobRef = {
        __kind: "blob",
        id,
        size,
        mimeType,
        createdAt,
        expiresAt,
        metadata,
      };

      const metadataPayload = BlobMetadataSchema.parse({
        version: 1,
        id,
        size,
        mimeType,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt?.toISOString(),
        metadata,
      });

      const dataPath = this.getDataPath(id, resolved.prefix);
      const metadataPath = this.getMetadataPath(id, resolved.prefix);
      const metadataBytes = new TextEncoder().encode(JSON.stringify(metadataPayload));
      const metadataSidecarLimit = Math.min(
        MAX_BLOB_METADATA_SIDECAR_BYTES,
        resolved.maxUploadBytes + MAX_BLOB_METADATA_ENVELOPE_BYTES,
      );
      if (metadataBytes.byteLength > metadataSidecarLimit) {
        throw INVALID_ARGUMENT.create({
          detail: `Blob metadata sidecar exceeds ${metadataSidecarLimit} bytes`,
        });
      }

      await this.#uploadFile(dataPath, mimeType, size, body, resolved, scope.signal);

      try {
        await this.#uploadFile(
          metadataPath,
          "application/json",
          metadataBytes.byteLength,
          metadataBytes,
          resolved,
          scope.signal,
        );
      } catch (error) {
        logger.warn("Failed to upload blob metadata sidecar, cleaning up primary upload", {
          id,
          dataPath,
          error: error instanceof Error ? error.message : String(error),
        });

        try {
          await this.#deleteUpload(dataPath, resolved);
        } catch (cleanupError) {
          logger.warn("Failed to clean up primary upload after metadata failure", {
            id,
            dataPath,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }

        throw error;
      }

      return blobRef;
    } finally {
      scope.dispose();
    }
  }

  async getStream(id: string): Promise<ReadableStream | null> {
    const resolved = this.#resolveConfig();
    return this.#downloadUpload(this.getDataPath(id, resolved.prefix), resolved);
  }

  async getText(id: string): Promise<string | null> {
    const stream = await this.getStream(id);
    if (!stream) return null;
    return new Response(stream).text();
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    const stream = await this.getStream(id);
    if (!stream) return null;
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async delete(id: string): Promise<void> {
    const resolved = this.#resolveConfig();
    await Promise.all([
      this.#deleteUpload(this.getMetadataPath(id, resolved.prefix), resolved, {
        ignoreNotFound: true,
      }),
      this.#deleteUpload(this.getDataPath(id, resolved.prefix), resolved, { ignoreNotFound: true }),
    ]);
  }

  async exists(id: string): Promise<boolean> {
    return (await this.stat(id)) !== null;
  }

  async stat(id: string): Promise<BlobRef | null> {
    const resolved = this.#resolveConfig();
    const dataPath = this.getDataPath(id, resolved.prefix);
    const metadataPath = this.getMetadataPath(id, resolved.prefix);
    const metadataJson = await this.#downloadUploadText(metadataPath, resolved);

    if (metadataJson) {
      try {
        const ref = mapBlobMetadataToRef(BlobMetadataSchema.parse(JSON.parse(metadataJson)));
        return await attachSignedUrl(
          ref,
          dataPath,
          resolved,
          (path, config) => this.#getDownloadUrl(path, config),
        );
      } catch (error) {
        logger.warn("Failed to parse blob metadata sidecar, falling back to upload metadata", {
          id,
          metadataPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const upload = await this.#getUploadMetadata(dataPath, resolved);
    if (!upload) return null;

    const ref = mapUploadMetadataToRef(upload, id);
    return await attachSignedUrl(
      ref,
      dataPath,
      resolved,
      (path, config) => this.#getDownloadUrl(path, config),
    );
  }

  /**
   * Enumerate blobs under this store's prefix, newest first. The list endpoint
   * (`GET /projects/{slug}/uploads`) carries only paths — the original filename
   * lives in each blob's sidecar — so ids are recovered from the `.blob` data
   * paths and enriched via {@link stat} (one extra request per blob). Suitable
   * for an uploads panel; not a hot path.
   *
   * Note: a single page is fetched. If the project accumulates more uploads than
   * one page, pagination will need wiring here.
   */
  async list(): Promise<BlobRef[]> {
    const resolved = this.#resolveConfig();
    const raw = await this.#requestJson(
      "GET",
      `/projects/${encodeURIComponent(resolved.projectSlug)}/uploads`,
      resolved,
      { headers: { Accept: "application/json" }, allowNotFound: true },
    );
    if (!raw) return [];

    const parsed = UploadListResponseSchema.parse(raw);
    const ids: string[] = [];
    for (const item of parsed.data ?? []) {
      const path = item.path;
      // Only the data objects under our prefix — skip `.meta.json` sidecars and
      // anything another store namespaced elsewhere.
      if (!path || !path.startsWith(resolved.prefix) || !path.endsWith(DATA_SUFFIX)) continue;
      const id = path.slice(resolved.prefix.length, path.length - DATA_SUFFIX.length);
      if (isSafeBlobId(id)) ids.push(id);
    }

    const refs = await Promise.all(ids.map((id) => this.stat(id)));
    return refs
      .filter((ref): ref is BlobRef => ref !== null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  #resolveConfig(): ResolvedConfig {
    const bootstrap = getVeryfrontCloudBootstrap();
    const hostBootstrap = getVeryfrontCloudHostBootstrap();
    if (this.config.apiBaseUrl && !this.config.apiToken) {
      throw CONFIG_INVALID.create({
        detail:
          "VeryfrontCloudBlobStorage apiBaseUrl requires an explicit apiToken. A caller-selected endpoint cannot use request- or host-owned credentials.",
      });
    }
    const connection = this.config.apiBaseUrl && this.config.apiToken
      ? { apiBaseUrl: this.config.apiBaseUrl, apiToken: this.config.apiToken }
      : this.config.apiToken
      ? { apiBaseUrl: hostBootstrap.apiBaseUrl, apiToken: this.config.apiToken }
      : { apiBaseUrl: bootstrap.apiBaseUrl, apiToken: bootstrap.apiToken };
    const { apiBaseUrl, apiToken } = connection;
    const projectSlug = this.config.projectSlug ?? getVeryfrontCloudProjectSlug();

    if (!apiToken) {
      throw CONFIG_INVALID.create({
        detail:
          "VeryfrontCloudBlobStorage requires auth. Set VERYFRONT_API_TOKEN, provide request-scoped Veryfront credentials, or pass apiToken explicitly.",
      });
    }

    if (!projectSlug) {
      throw CONFIG_INVALID.create({
        detail:
          "VeryfrontCloudBlobStorage requires a project slug. Set VERYFRONT_PROJECT_SLUG, provide request-scoped project context, or pass projectSlug explicitly.",
      });
    }

    return {
      apiBaseUrl,
      apiToken,
      projectSlug,
      prefix: normalizePrefix(this.config.prefix),
      defaultTtl: this.config.defaultTtl,
      downloadTtl: this.config.downloadTtl,
      now: this.config.now ?? (() => new Date()),
      requestTimeoutMs: requirePositiveInteger(
        this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        "requestTimeoutMs",
        DEFAULT_REQUEST_TIMEOUT_MS,
      ),
      maxResponseBytes: requirePositiveInteger(
        this.config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
        "maxResponseBytes",
        MAX_RESPONSE_BYTES,
      ),
      maxUploadBytes: requirePositiveInteger(
        this.config.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
        "maxUploadBytes",
        MAX_UPLOAD_BYTES,
      ),
    };
  }

  private getDataPath(id: string, prefix: string): string {
    assertSafeBlobId(id);
    return `${prefix}${id}${DATA_SUFFIX}`;
  }

  private getMetadataPath(id: string, prefix: string): string {
    assertSafeBlobId(id);
    return `${prefix}${id}${META_SUFFIX}`;
  }

  async #uploadFile(
    path: string,
    mimeType: string,
    size: number,
    body: BodyInit,
    resolved: ResolvedConfig,
    signal?: AbortSignal,
  ): Promise<void> {
    const upload = UploadCreateResponseSchema.parse(
      await this.#requestJson(
        "POST",
        `/projects/${encodeURIComponent(resolved.projectSlug)}/uploads`,
        resolved,
        {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_path: path,
            content_type: mimeType,
            size,
          }),
          signal,
        },
      ),
    );

    const headers = new NativeHeaders(upload.required_headers);
    if (!applyIntrinsic(headersHas, headers, ["Content-Type"])) {
      applyIntrinsic(headersSet, headers, ["Content-Type", mimeType]);
    }

    const scope = signal ? undefined : createRequestScope(resolved.requestTimeoutMs);
    const requestSignal = signal ?? scope?.signal;
    if (!requestSignal) throw new TypeError("Blob upload request signal is unavailable");
    let response: Response;
    try {
      response = await guardedOutboundFetch(upload.file_upload_url, {
        method: "PUT",
        headers,
        body,
        redirect: "error",
        signal: requestSignal,
      });

      if (!response.ok) {
        const errorBody = await readErrorBody(response, requestSignal);
        throw API_ERROR.create({
          detail:
            `Veryfront Cloud upload failed for "${path}": ${response.status} ${response.statusText}${
              errorBody ? ` - ${errorBody}` : ""
            }`,
        });
      }
      void response.body?.cancel().catch(() => {});
    } finally {
      scope?.dispose();
    }
  }

  async #getUploadMetadata(
    path: string,
    resolved: ResolvedConfig,
  ): Promise<UploadMetadataResponse | null> {
    const raw = await this.#requestJson(
      "GET",
      `/projects/${encodeURIComponent(resolved.projectSlug)}/uploads/${encodeURIComponent(path)}`,
      resolved,
      {
        headers: { Accept: "application/json" },
        allowNotFound: true,
      },
    );

    if (!raw) return null;
    return UploadMetadataResponseSchema.parse(raw);
  }

  async #deleteUpload(
    path: string,
    resolved: ResolvedConfig,
    options: { ignoreNotFound?: boolean } = {},
  ): Promise<void> {
    await this.#requestJson(
      "DELETE",
      `/projects/${encodeURIComponent(resolved.projectSlug)}/uploads/${encodeURIComponent(path)}`,
      resolved,
      {
        allowNotFound: options.ignoreNotFound,
        expectEmptyBody: true,
      },
    );
  }

  async #getDownloadUrl(
    path: string,
    resolved: ResolvedConfig,
  ): Promise<{ signedUrl: string; expiresAt: Date } | null> {
    const ttl = resolved.downloadTtl;
    const query = ttl ? `?ttl=${encodeURIComponent(String(ttl))}` : "";
    const raw = await this.#requestJson(
      "GET",
      `/projects/${encodeURIComponent(resolved.projectSlug)}/uploads/${
        encodeURIComponent(path)
      }/url${query}`,
      resolved,
      { allowNotFound: true },
    );

    if (!raw) return null;

    const parsed = UploadSignedUrlResponseSchema.parse(raw);
    return {
      signedUrl: parsed.signed_url,
      expiresAt: new Date(parsed.expires_at),
    };
  }

  async #downloadUpload(
    path: string,
    resolved: ResolvedConfig,
  ): Promise<ReadableStream | null> {
    const download = await this.#getDownloadUrl(path, resolved);
    if (!download) return null;

    const scope = createRequestScope(resolved.requestTimeoutMs);
    try {
      const response = await guardedOutboundFetch(download.signedUrl, {
        redirect: "error",
        signal: scope.signal,
      });
      if (response.status === 404) {
        void response.body?.cancel().catch(() => {});
        return null;
      }
      if (!response.ok) {
        const errorBody = await readErrorBody(response, scope.signal);
        throw API_ERROR.create({
          detail:
            `Veryfront Cloud download failed for "${path}": ${response.status} ${response.statusText}${
              errorBody ? ` - ${errorBody}` : ""
            }`,
        });
      }
      const bytes = await readResponseBytes(response, resolved.maxResponseBytes, scope.signal);
      return new Blob([
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      ]).stream();
    } finally {
      scope.dispose();
    }
  }

  async #downloadUploadText(
    path: string,
    resolved: ResolvedConfig,
  ): Promise<string | null> {
    const stream = await this.#downloadUpload(path, resolved);
    if (!stream) return null;
    return new Response(stream).text();
  }

  async #requestJson(
    method: string,
    path: string,
    resolved: ResolvedConfig,
    options: {
      headers?: HeadersInit;
      body?: BodyInit;
      allowNotFound?: boolean;
      expectEmptyBody?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<unknown | null> {
    const headers = new NativeHeaders(options.headers);
    applyIntrinsic(headersSet, headers, ["Authorization", `Bearer ${resolved.apiToken}`]);

    const scope = options.signal ? undefined : createRequestScope(resolved.requestTimeoutMs);
    const signal = options.signal ?? scope?.signal;
    if (!signal) throw new TypeError("Blob request signal is unavailable");
    const apiOrigin = readUrlOrigin(new NativeURL(resolved.apiBaseUrl));
    try {
      const response = await guardedOutboundFetch(
        joinUrl(resolved.apiBaseUrl, path),
        { method, headers, body: options.body, redirect: "error", signal },
        {
          authorizeUrl: (target) => {
            if (readUrlOrigin(target) !== apiOrigin) {
              throw new OutboundRequestBlockedError(
                "Veryfront Cloud Blob request blocked: destination origin is not authorized",
              );
            }
          },
        },
      );

      if (options.allowNotFound && response.status === 404) {
        void response.body?.cancel().catch(() => {});
        return null;
      }

      if (!response.ok) {
        const errorBody = await readErrorBody(response, signal);
        throw API_ERROR.create({
          detail:
            `Veryfront Cloud request failed: ${method} ${path} -> ${response.status} ${response.statusText}${
              errorBody ? ` - ${errorBody}` : ""
            }`,
        });
      }

      if (options.expectEmptyBody || response.status === 204) {
        void response.body?.cancel().catch(() => {});
        return null;
      }

      return JSON.parse(
        new TextDecoder().decode(
          await readResponseBytes(response, resolved.maxResponseBytes, signal),
        ),
      );
    } finally {
      scope?.dispose();
    }
  }
}
