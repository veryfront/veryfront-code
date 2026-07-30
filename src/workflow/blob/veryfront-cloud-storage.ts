import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { agentLogger as logger } from "#veryfront/utils";
import { API_ERROR, CONFIG_INVALID, INVALID_ARGUMENT } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  getVeryfrontCloudAuthToken,
  getVeryfrontCloudBootstrap,
  getVeryfrontCloudProjectSlug,
} from "#veryfront/platform/cloud/resolver.ts";
import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.ts";
import { assertSafeBlobId, isSafeBlobId } from "./blob-id.ts";
import { parsePositiveDurationWithLabel } from "../types.ts";
import {
  captureBlobBytes,
  captureBlobMetadata,
  captureBlobMimeType,
  captureExactBlobRecord,
  captureStoreBlobOptions,
  copyCapturedBlobMetadata,
  hasBlobControlCharacters,
} from "./contract.ts";

const DEFAULT_PREFIX = ".veryfront/blobs/";
const DATA_SUFFIX = ".blob";
const META_SUFFIX = ".meta.json";
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_CLOUD_URL_CODE_UNITS = 2_048;
const MAX_CLOUD_TOKEN_CODE_UNITS = 8_192;
const MAX_CLOUD_PROJECT_SLUG_CODE_UNITS = 256;
const MAX_CLOUD_PREFIX_CODE_UNITS = 1_024;
const CLOUD_CONFIG_KEYS = new Set([
  "apiBaseUrl",
  "apiToken",
  "projectSlug",
  "prefix",
  "defaultTtl",
  "downloadTtl",
  "requestTimeout",
  "now",
]);
const dateGetTime = Date.prototype.getTime;

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
  /** Positive request/upload/download timeout in milliseconds (default: 30000). */
  requestTimeout?: number;
  /** Time source for tests. */
  now?: () => Date;
}

interface ResolvedConfig {
  apiBaseUrl: string;
  apiToken: string;
  projectSlug: string;
  prefix: string;
  defaultTtl?: number;
  downloadTtl?: number;
  requestTimeout: number;
  now: () => Date;
}

type CapturedCloudConfig = Readonly<VeryfrontCloudBlobStorageConfig>;

function captureOptionalConfigString(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" || value.length === 0 || value.length > maxLength ||
    value.trim() !== value || hasBlobControlCharacters(value)
  ) {
    throw CONFIG_INVALID.create({
      detail: `${label} must be a canonical non-empty string of at most ${maxLength} code units`,
    });
  }
  return value;
}

function captureCloudConfig(value: unknown): CapturedCloudConfig {
  const fields = captureExactBlobRecord(value, "Cloud blob storage config", CLOUD_CONFIG_KEYS);
  const apiBaseUrl = captureOptionalConfigString(
    fields.get("apiBaseUrl"),
    "Cloud blob apiBaseUrl",
    MAX_CLOUD_URL_CODE_UNITS,
  );
  const apiToken = captureOptionalConfigString(
    fields.get("apiToken"),
    "Cloud blob apiToken",
    MAX_CLOUD_TOKEN_CODE_UNITS,
  );
  const projectSlug = captureOptionalConfigString(
    fields.get("projectSlug"),
    "Cloud blob projectSlug",
    MAX_CLOUD_PROJECT_SLUG_CODE_UNITS,
  );
  const prefix = captureOptionalConfigString(
    fields.get("prefix"),
    "Cloud blob prefix",
    MAX_CLOUD_PREFIX_CODE_UNITS,
  );
  const defaultTtl = validateTtl(fields.get("defaultTtl"), "Cloud blob defaultTtl");
  const downloadTtl = validateTtl(fields.get("downloadTtl"), "Cloud blob downloadTtl");
  const rawRequestTimeout = fields.get("requestTimeout");
  let requestTimeout: number | undefined;
  if (rawRequestTimeout !== undefined) {
    if (typeof rawRequestTimeout !== "number") {
      throw CONFIG_INVALID.create({ detail: "Cloud blob requestTimeout must be a number" });
    }
    requestTimeout = parsePositiveDurationWithLabel(
      rawRequestTimeout,
      "VeryfrontCloudBlobStorage requestTimeout",
    );
  }
  const now = fields.get("now");
  if (now !== undefined && (typeof now !== "function" || isProxyWithoutHooks(now))) {
    throw CONFIG_INVALID.create({ detail: "Cloud blob now must be a non-Proxy function" });
  }
  return Object.freeze({
    ...(apiBaseUrl === undefined ? {} : { apiBaseUrl }),
    ...(apiToken === undefined ? {} : { apiToken }),
    ...(projectSlug === undefined ? {} : { projectSlug }),
    ...(prefix === undefined ? {} : { prefix }),
    ...(defaultTtl === undefined ? {} : { defaultTtl }),
    ...(downloadTtl === undefined ? {} : { downloadTtl }),
    ...(requestTimeout === undefined ? {} : { requestTimeout }),
    ...(now === undefined ? {} : { now: now as () => Date }),
  });
}

function normalizePrefix(prefix: string | undefined): string {
  const value = prefix ?? DEFAULT_PREFIX;
  const segments = value.endsWith("/") ? value.slice(0, -1).split("/") : value.split("/");
  if (
    value.length === 0 || value !== value.trim() || value.startsWith("/") ||
    value.includes("\\") ||
    segments.some((segment) =>
      !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment)
    )
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Cloud blob prefix must be a portable relative path",
    });
  }
  return value.endsWith("/") ? value : `${value}/`;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function validateTtl(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw INVALID_ARGUMENT.create({ detail: `${label} must be a non-negative safe integer` });
  }
  return value;
}

function resolveBlobTimes(
  now: unknown,
  ttl: number | undefined,
): { createdAt: Date; expiresAt?: Date } {
  let createdAtMs: unknown;
  try {
    createdAtMs = Reflect.apply(dateGetTime, now, []);
  } catch (cause) {
    throw INVALID_ARGUMENT.create({
      detail: "Cloud blob storage clock returned an invalid date",
      cause,
    });
  }
  if (typeof createdAtMs !== "number" || !Number.isFinite(createdAtMs)) {
    throw INVALID_ARGUMENT.create({ detail: "Cloud blob storage clock returned an invalid date" });
  }
  const createdAt = new Date(createdAtMs);
  if (!ttl) return { createdAt };

  const expiresAtMs = createdAtMs + ttl * 1_000;
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs > MAX_DATE_MILLISECONDS) {
    throw INVALID_ARGUMENT.create({ detail: "Blob TTL exceeds the supported date range" });
  }
  return { createdAt, expiresAt: new Date(expiresAtMs) };
}

function parseDate(value: string, label: string): Date {
  if (value.length > 64) throw new TypeError(`${label} is too long`);
  const date = new Date(value);
  if (!Number.isFinite(Reflect.apply(dateGetTime, date, []))) {
    throw new TypeError(`${label} is invalid`);
  }
  return date;
}

function mapBlobMetadataToRef(blob: BlobMetadata, expectedId: string): BlobRef {
  if (
    !isSafeBlobId(blob.id) || blob.id !== expectedId ||
    !Number.isSafeInteger(blob.size) || blob.size < 0 || !blob.mimeType
  ) {
    throw new TypeError("Blob metadata has an invalid shape");
  }
  return {
    __kind: "blob",
    id: blob.id,
    size: blob.size,
    mimeType: captureBlobMimeType(blob.mimeType),
    createdAt: parseDate(blob.createdAt, "Blob creation date"),
    expiresAt: blob.expiresAt ? parseDate(blob.expiresAt, "Blob expiry date") : undefined,
    metadata: copyCapturedBlobMetadata(captureBlobMetadata(blob.metadata)),
  };
}

function mapUploadMetadataToRef(upload: UploadMetadataResponse, id: string): BlobRef {
  if (!Number.isSafeInteger(upload.size) || upload.size < 0) {
    throw new TypeError("Upload metadata has an invalid size");
  }
  return {
    __kind: "blob",
    id,
    size: upload.size,
    mimeType: captureBlobMimeType(upload.content_type ?? "application/octet-stream"),
    createdAt: parseDate(upload.created_at, "Upload creation date"),
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
  const download = await getDownloadUrl(path, resolved);
  return download ? { ...ref, url: download.signedUrl } : ref;
}

export class VeryfrontCloudBlobStorage implements BlobStorage {
  private readonly config: CapturedCloudConfig;

  constructor(config: VeryfrontCloudBlobStorageConfig = {}) {
    this.config = captureCloudConfig(config);
  }

  async put(
    data: string | Uint8Array | Blob | ReadableStream,
    options?: StoreBlobOptions,
  ): Promise<BlobRef> {
    const capturedOptions = captureStoreBlobOptions(options);
    const resolved = this.resolveConfig();
    const id = capturedOptions.id ?? crypto.randomUUID();
    assertSafeBlobId(id);
    const mimeType = capturedOptions.mimeType ?? "application/octet-stream";
    const metadata = copyCapturedBlobMetadata(capturedOptions.metadata);
    const ttl = validateTtl(capturedOptions.ttl ?? resolved.defaultTtl, "Blob TTL");
    const { createdAt, expiresAt } = resolveBlobTimes(resolved.now(), ttl);
    const body = await captureBlobBytes(data);
    const size = body.byteLength;

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

    await this.uploadFile(dataPath, mimeType, size, body, resolved);

    try {
      await this.uploadFile(
        metadataPath,
        "application/json",
        metadataBytes.byteLength,
        metadataBytes,
        resolved,
      );
    } catch (error) {
      logger.warn("Failed to upload blob metadata sidecar, cleaning up primary upload", {
        id,
        dataPath,
        errorName: error instanceof Error ? error.name : typeof error,
      });

      try {
        await this.deleteUpload(dataPath, resolved);
      } catch (cleanupError) {
        logger.warn("Failed to clean up primary upload after metadata failure", {
          id,
          errorName: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
        });
        throw API_ERROR.create({
          detail: "Cloud blob metadata upload and primary cleanup both failed",
        });
      }

      throw error;
    }

    return blobRef;
  }

  async getStream(id: string): Promise<ReadableStream | null> {
    const resolved = this.resolveConfig();
    return this.downloadUpload(this.getDataPath(id, resolved.prefix), resolved);
  }

  async getText(id: string): Promise<string | null> {
    const stream = await this.getStream(id);
    if (!stream) return null;
    return new TextDecoder().decode(await captureBlobBytes(stream));
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    const stream = await this.getStream(id);
    if (!stream) return null;
    return await captureBlobBytes(stream);
  }

  async delete(id: string): Promise<void> {
    const resolved = this.resolveConfig();
    const results = await Promise.allSettled([
      this.deleteUpload(this.getMetadataPath(id, resolved.prefix), resolved, {
        ignoreNotFound: true,
      }),
      this.deleteUpload(this.getDataPath(id, resolved.prefix), resolved, { ignoreNotFound: true }),
    ]);
    const failureCount = results.filter((result) => result.status === "rejected").length;
    if (failureCount > 0) {
      logger.warn("Failed to delete cloud blob", { id, failureCount });
      throw API_ERROR.create({ detail: "Failed to delete cloud blob" });
    }
  }

  async exists(id: string): Promise<boolean> {
    return (await this.stat(id)) !== null;
  }

  async stat(id: string): Promise<BlobRef | null> {
    const resolved = this.resolveConfig();
    const dataPath = this.getDataPath(id, resolved.prefix);
    const metadataPath = this.getMetadataPath(id, resolved.prefix);
    const metadataJson = await this.downloadUploadText(metadataPath, resolved);

    if (metadataJson !== null) {
      let ref: BlobRef;
      try {
        ref = mapBlobMetadataToRef(
          BlobMetadataSchema.parse(JSON.parse(metadataJson)),
          id,
        );
      } catch (error) {
        logger.warn("Invalid cloud blob metadata sidecar", {
          id,
          errorName: error instanceof Error ? error.name : typeof error,
        });
        throw API_ERROR.create({ detail: "Invalid cloud blob metadata sidecar" });
      }
      return await attachSignedUrl(ref, dataPath, resolved, this.getDownloadUrl.bind(this));
    }

    const upload = await this.getUploadMetadata(dataPath, resolved);
    if (!upload) return null;

    const ref = mapUploadMetadataToRef(upload, id);
    return await attachSignedUrl(ref, dataPath, resolved, this.getDownloadUrl.bind(this));
  }

  private resolveConfig(): ResolvedConfig {
    const apiBaseUrl = captureOptionalConfigString(
      this.config.apiBaseUrl ?? getVeryfrontCloudBootstrap().apiBaseUrl,
      "Cloud blob apiBaseUrl",
      MAX_CLOUD_URL_CODE_UNITS,
    );
    const rawApiToken = this.config.apiToken ?? getVeryfrontCloudAuthToken();
    const rawProjectSlug = this.config.projectSlug ?? getVeryfrontCloudProjectSlug();

    if (!apiBaseUrl) {
      throw CONFIG_INVALID.create({ detail: "VeryfrontCloudBlobStorage apiBaseUrl is invalid" });
    }

    let parsedApiUrl: URL;
    try {
      parsedApiUrl = new URL(apiBaseUrl);
    } catch {
      throw CONFIG_INVALID.create({ detail: "VeryfrontCloudBlobStorage apiBaseUrl is invalid" });
    }
    if (
      !["http:", "https:"].includes(parsedApiUrl.protocol) || parsedApiUrl.username ||
      parsedApiUrl.password || parsedApiUrl.search || parsedApiUrl.hash
    ) {
      throw CONFIG_INVALID.create({ detail: "VeryfrontCloudBlobStorage apiBaseUrl is invalid" });
    }

    if (!rawApiToken?.trim()) {
      throw CONFIG_INVALID.create({
        detail:
          "VeryfrontCloudBlobStorage requires auth. Set VERYFRONT_API_TOKEN, provide request-scoped Veryfront credentials, or pass apiToken explicitly.",
      });
    }

    if (!rawProjectSlug?.trim()) {
      throw CONFIG_INVALID.create({
        detail:
          "VeryfrontCloudBlobStorage requires a project slug. Set VERYFRONT_PROJECT_SLUG, provide request-scoped project context, or pass projectSlug explicitly.",
      });
    }
    const apiToken = captureOptionalConfigString(
      rawApiToken,
      "Cloud blob apiToken",
      MAX_CLOUD_TOKEN_CODE_UNITS,
    )!;
    const projectSlug = captureOptionalConfigString(
      rawProjectSlug,
      "Cloud blob projectSlug",
      MAX_CLOUD_PROJECT_SLUG_CODE_UNITS,
    )!;

    return {
      apiBaseUrl: parsedApiUrl.toString().replace(/\/$/, ""),
      apiToken,
      projectSlug,
      prefix: normalizePrefix(this.config.prefix),
      defaultTtl: validateTtl(this.config.defaultTtl, "Cloud blob defaultTtl"),
      downloadTtl: validateTtl(this.config.downloadTtl, "Cloud blob downloadTtl"),
      requestTimeout: parsePositiveDurationWithLabel(
        this.config.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT_MS,
        "VeryfrontCloudBlobStorage requestTimeout",
      ),
      now: this.config.now ?? (() => new Date()),
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

  private async uploadFile(
    path: string,
    mimeType: string,
    size: number,
    body: BodyInit,
    resolved: ResolvedConfig,
  ): Promise<void> {
    const upload = UploadCreateResponseSchema.parse(
      await this.requestJson(
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
        },
      ),
    );

    const headers = new Headers(upload.required_headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", mimeType);

    const response = await fetch(upload.file_upload_url, {
      method: "PUT",
      headers,
      body,
      signal: AbortSignal.timeout(resolved.requestTimeout),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw API_ERROR.create({
        detail:
          `Veryfront Cloud upload failed for "${path}": ${response.status} ${response.statusText}${
            errorBody ? ` - ${errorBody}` : ""
          }`,
      });
    }
  }

  private async getUploadMetadata(
    path: string,
    resolved: ResolvedConfig,
  ): Promise<UploadMetadataResponse | null> {
    const raw = await this.requestJson(
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

  private async deleteUpload(
    path: string,
    resolved: ResolvedConfig,
    options: { ignoreNotFound?: boolean } = {},
  ): Promise<void> {
    await this.requestJson(
      "DELETE",
      `/projects/${encodeURIComponent(resolved.projectSlug)}/uploads/${encodeURIComponent(path)}`,
      resolved,
      {
        allowNotFound: options.ignoreNotFound,
        expectEmptyBody: true,
      },
    );
  }

  private async getDownloadUrl(
    path: string,
    resolved: ResolvedConfig,
  ): Promise<{ signedUrl: string; expiresAt: Date } | null> {
    const ttl = resolved.downloadTtl;
    const query = ttl ? `?ttl=${encodeURIComponent(String(ttl))}` : "";
    const raw = await this.requestJson(
      "GET",
      `/projects/${encodeURIComponent(resolved.projectSlug)}/uploads/${
        encodeURIComponent(path)
      }/url${query}`,
      resolved,
      { allowNotFound: true },
    );

    if (!raw) return null;

    const parsed = UploadSignedUrlResponseSchema.parse(raw);
    const expiresAt = parseDate(parsed.expires_at, "Signed URL expiry date");
    return {
      signedUrl: parsed.signed_url,
      expiresAt,
    };
  }

  private async downloadUpload(
    path: string,
    resolved: ResolvedConfig,
  ): Promise<ReadableStream | null> {
    const download = await this.getDownloadUrl(path, resolved);
    if (!download) return null;

    const response = await fetch(download.signedUrl, {
      signal: AbortSignal.timeout(resolved.requestTimeout),
    });
    if (response.status === 404) return null;

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw API_ERROR.create({
        detail:
          `Veryfront Cloud download failed for "${path}": ${response.status} ${response.statusText}${
            errorBody ? ` - ${errorBody}` : ""
          }`,
      });
    }

    if (!response.body) {
      throw API_ERROR.create({ detail: `Veryfront Cloud download returned no body for "${path}"` });
    }
    return response.body;
  }

  private async downloadUploadText(
    path: string,
    resolved: ResolvedConfig,
  ): Promise<string | null> {
    const stream = await this.downloadUpload(path, resolved);
    if (!stream) return null;
    return new TextDecoder().decode(await captureBlobBytes(stream));
  }

  private async requestJson(
    method: string,
    path: string,
    resolved: ResolvedConfig,
    options: {
      headers?: HeadersInit;
      body?: BodyInit;
      allowNotFound?: boolean;
      expectEmptyBody?: boolean;
    } = {},
  ): Promise<unknown | null> {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${resolved.apiToken}`);

    const response = await fetch(joinUrl(resolved.apiBaseUrl, path), {
      method,
      headers,
      body: options.body,
      signal: AbortSignal.timeout(resolved.requestTimeout),
    });

    if (options.allowNotFound && response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw API_ERROR.create({
        detail:
          `Veryfront Cloud request failed: ${method} ${path} -> ${response.status} ${response.statusText}${
            errorBody ? ` - ${errorBody}` : ""
          }`,
      });
    }

    if (options.expectEmptyBody || response.status === 204) {
      return null;
    }

    return response.json();
  }
}
