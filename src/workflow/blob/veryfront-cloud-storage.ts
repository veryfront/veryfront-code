import { z } from "zod";
import { agentLogger as logger } from "#veryfront/utils";
import { API_ERROR, CONFIG_INVALID, INVALID_ARGUMENT } from "#veryfront/errors";

const SAFE_BLOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
import {
  getVeryfrontCloudAuthToken,
  getVeryfrontCloudBootstrap,
  getVeryfrontCloudProjectSlug,
} from "#veryfront/platform/cloud/resolver.ts";
import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.ts";

const DEFAULT_PREFIX = ".veryfront/blobs/";
const DATA_SUFFIX = ".blob";
const META_SUFFIX = ".meta.json";

const UploadCreateResponseSchema = z.object({
  file_upload_url: z.string().url(),
  file_path: z.string(),
  upload_id: z.string(),
  required_headers: z.record(z.string()),
});

const UploadMetadataResponseSchema = z.object({
  id: z.string(),
  path: z.string(),
  file_name: z.string(),
  content_type: z.string().nullable(),
  size: z.number(),
  url: z.string().nullable(),
  status: z.enum(["pending", "active", "failed"]),
  visibility: z.enum(["project", "public", "private"]),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

const UploadSignedUrlResponseSchema = z.object({
  signed_url: z.string().url(),
  expires_at: z.string(),
});

const BlobMetadataSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  size: z.number().nonnegative(),
  mimeType: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

type UploadMetadataResponse = z.infer<typeof UploadMetadataResponseSchema>;
type BlobMetadata = z.infer<typeof BlobMetadataSchema>;

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
}

interface ResolvedConfig {
  apiBaseUrl: string;
  apiToken: string;
  projectSlug: string;
  prefix: string;
  defaultTtl?: number;
  downloadTtl?: number;
  now: () => Date;
}

function normalizePrefix(prefix: string | undefined): string {
  const value = (prefix ?? DEFAULT_PREFIX).trim().replace(/^\/+/, "");
  if (!value) return DEFAULT_PREFIX;
  return value.endsWith("/") ? value : `${value}/`;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
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
): Promise<{ body: BodyInit; size: number }> {
  if (typeof data === "string") {
    const bytes = new TextEncoder().encode(data);
    return { body: bytes, size: bytes.byteLength };
  }

  if (data instanceof Uint8Array) {
    const bytes = Uint8Array.from(data);
    return { body: bytes, size: bytes.byteLength };
  }

  if (data instanceof Blob) {
    return { body: data, size: data.size };
  }

  if (data instanceof ReadableStream) {
    const bytes = new Uint8Array(await new Response(data).arrayBuffer());
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
    const resolved = this.resolveConfig();
    const id = options.id ?? crypto.randomUUID();
    const mimeType = options.mimeType ?? "application/octet-stream";
    const { body, size } = await normalizeUploadBody(data);
    const createdAt = resolved.now();
    const ttl = options.ttl ?? resolved.defaultTtl;
    const expiresAt = ttl ? new Date(createdAt.getTime() + ttl * 1000) : undefined;

    const blobRef: BlobRef = {
      __kind: "blob",
      id,
      size,
      mimeType,
      createdAt,
      expiresAt,
      metadata: options.metadata,
    };

    const metadataPayload = BlobMetadataSchema.parse({
      version: 1,
      id,
      size,
      mimeType,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt?.toISOString(),
      metadata: options.metadata,
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
        error: error instanceof Error ? error.message : String(error),
      });

      try {
        await this.deleteUpload(dataPath, resolved);
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
  }

  async getStream(id: string): Promise<ReadableStream | null> {
    const resolved = this.resolveConfig();
    return this.downloadUpload(this.getDataPath(id, resolved.prefix), resolved);
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
    const resolved = this.resolveConfig();
    await Promise.all([
      this.deleteUpload(this.getMetadataPath(id, resolved.prefix), resolved, {
        ignoreNotFound: true,
      }),
      this.deleteUpload(this.getDataPath(id, resolved.prefix), resolved, { ignoreNotFound: true }),
    ]);
  }

  async exists(id: string): Promise<boolean> {
    return (await this.stat(id)) !== null;
  }

  async stat(id: string): Promise<BlobRef | null> {
    const resolved = this.resolveConfig();
    const dataPath = this.getDataPath(id, resolved.prefix);
    const metadataPath = this.getMetadataPath(id, resolved.prefix);
    const metadataJson = await this.downloadUploadText(metadataPath, resolved);

    if (metadataJson) {
      try {
        const ref = mapBlobMetadataToRef(BlobMetadataSchema.parse(JSON.parse(metadataJson)));
        return await attachSignedUrl(ref, dataPath, resolved, this.getDownloadUrl.bind(this));
      } catch (error) {
        logger.warn("Failed to parse blob metadata sidecar, falling back to upload metadata", {
          id,
          metadataPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const upload = await this.getUploadMetadata(dataPath, resolved);
    if (!upload) return null;

    const ref = mapUploadMetadataToRef(upload, id);
    return await attachSignedUrl(ref, dataPath, resolved, this.getDownloadUrl.bind(this));
  }

  private resolveConfig(): ResolvedConfig {
    const apiBaseUrl = this.config.apiBaseUrl ?? getVeryfrontCloudBootstrap().apiBaseUrl;
    const apiToken = this.config.apiToken ?? getVeryfrontCloudAuthToken();
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
    };
  }

  private assertSafeBlobId(id: string): void {
    if (!SAFE_BLOB_ID_PATTERN.test(id)) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Invalid blob id: "${id}". IDs must contain only alphanumeric characters, hyphens, and underscores.`,
      });
    }
  }

  private getDataPath(id: string, prefix: string): string {
    this.assertSafeBlobId(id);
    return `${prefix}${id}${DATA_SUFFIX}`;
  }

  private getMetadataPath(id: string, prefix: string): string {
    this.assertSafeBlobId(id);
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
    return {
      signedUrl: parsed.signed_url,
      expiresAt: new Date(parsed.expires_at),
    };
  }

  private async downloadUpload(
    path: string,
    resolved: ResolvedConfig,
  ): Promise<ReadableStream | null> {
    const download = await this.getDownloadUrl(path, resolved);
    if (!download) return null;

    const response = await fetch(download.signedUrl);
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

    return response.body;
  }

  private async downloadUploadText(
    path: string,
    resolved: ResolvedConfig,
  ): Promise<string | null> {
    const stream = await this.downloadUpload(path, resolved);
    if (!stream) return null;
    return new Response(stream).text();
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
