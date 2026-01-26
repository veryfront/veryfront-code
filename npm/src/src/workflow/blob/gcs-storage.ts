import * as dntShim from "../../../_dnt.shims.js";
import { logger } from "../../utils/index.js";
import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.js";

export interface GCSBlobStorageConfig {
  /** Google Cloud Project ID */
  projectId: string;
  /** GCS Bucket name */
  bucket: string;
  /** Google Cloud Service Account Key (JSON string) */
  serviceAccountKey: string;
  /** Key prefix for namespacing blobs */
  prefix?: string;
  /** Base URL for constructing public URLs (if bucket is public) */
  baseUrl?: string;
  /** Default TTL for blobs in seconds */
  defaultTtl?: number;
}

export class GCSBlobStorage implements BlobStorage {
  private config: GCSBlobStorageConfig;
  private tokenCache: { accessToken: string; expiresAt: Date } | null = null;

  constructor(config: GCSBlobStorageConfig) {
    this.config = config;
    try {
      JSON.parse(this.config.serviceAccountKey);
    } catch {
      throw new Error("GCSBlobStorage: serviceAccountKey must be a valid JSON string.");
    }
  }

  private getKey(id: string): string {
    return this.config.prefix ? `${this.config.prefix}${id}` : id;
  }

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > new Date()) {
      return this.tokenCache.accessToken;
    }

    const sa = JSON.parse(this.config.serviceAccountKey);
    const tokenEndpoint = "https://oauth2.googleapis.com/token";
    const scope = "https://www.googleapis.com/auth/devstorage.full_control";

    const now = Date.now();
    const jwtHeader = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const jwtClaimSet = btoa(
      JSON.stringify({
        iss: sa.client_email,
        scope,
        aud: tokenEndpoint,
        exp: Math.floor(now / 1000) + 3600,
        iat: Math.floor(now / 1000),
      }),
    );

    logger.warn(
      "[GCSBlobStorage] JWT signing requires djwt library - using placeholder (not for production)",
    );

    const signature = "PLACEHOLDER_SIGNATURE";
    const jwt = `${jwtHeader}.${jwtClaimSet}.${signature}`;

    const response = await dntShim.fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get GCS access token: ${response.status} - ${error}`);
    }

    const { access_token: accessToken, expires_in: expiresIn } = await response.json();

    this.tokenCache = {
      accessToken,
      expiresAt: new Date(Date.now() + (expiresIn - 60) * 1000),
    };

    return accessToken;
  }

  async put(
    data: string | Uint8Array | dntShim.Blob | ReadableStream,
    options: StoreBlobOptions = {},
  ): Promise<BlobRef> {
    const id = options.id ?? dntShim.crypto.randomUUID();
    const key = this.getKey(id);
    const mimeType = options.mimeType ?? "application/octet-stream";
    const createdAt = new Date();
    const ttl = options.ttl ?? this.config.defaultTtl;
    const expiresAt = ttl ? new Date(createdAt.getTime() + ttl * 1000) : undefined;

    let body: string | Uint8Array | ReadableStream | dntShim.Blob;
    let contentLength: number | undefined;

    if (typeof data === "string") {
      const bytes = new TextEncoder().encode(data);
      body = bytes;
      contentLength = bytes.byteLength;
    } else if (data instanceof Uint8Array) {
      body = data;
      contentLength = data.byteLength;
    } else if (data instanceof dntShim.Blob) {
      body = data;
      contentLength = data.size;
    } else if (data instanceof ReadableStream) {
      body = data;
    } else {
      throw new Error("Unsupported data type for GCSBlobStorage");
    }

    const token = await this.getAccessToken();
    const uploadUrl =
      `https://storage.googleapis.com/upload/storage/v1/b/${this.config.bucket}/o?uploadType=media&name=${key}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": mimeType,
    };

    if (contentLength !== undefined) {
      headers["Content-Length"] = String(contentLength);
    }

    if (options.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        headers[`x-goog-meta-${k.toLowerCase()}`] = v;
      }
    }

    if (expiresAt) {
      // Store expiresAt in metadata for stat retrieval, GCS native TTL is via object lifecycle rules
      headers["x-goog-meta-expiresat"] = expiresAt.toISOString();
    }

    const response = await dntShim.fetch(uploadUrl, {
      method: "POST",
      headers,
      body: body as dntShim.BodyInit,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to upload to GCS: ${response.status} - ${response.statusText}. Body: ${errorBody}`,
      );
    }

    const gcsObject = await response.json();

    return {
      __kind: "blob",
      id,
      size: Number(gcsObject.size),
      mimeType: gcsObject.contentType,
      createdAt: new Date(gcsObject.timeCreated),
      expiresAt,
      metadata: options.metadata,
      url: this.config.baseUrl ? `${this.config.baseUrl}/${key}` : gcsObject.mediaLink,
    };
  }

  async getStream(id: string): Promise<ReadableStream | null> {
    const key = this.getKey(id);
    const token = await this.getAccessToken();
    const downloadUrl =
      `https://storage.googleapis.com/storage/v1/b/${this.config.bucket}/o/${key}?alt=media`;

    try {
      const response = await dntShim.fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 404) return null;

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Failed to download from GCS: ${response.status} - ${response.statusText}. Body: ${errorBody}`,
        );
      }

      return response.body;
    } catch (e) {
      logger.error("[GCSBlobStorage] getStream error", e);
      throw e;
    }
  }

  async getText(id: string): Promise<string | null> {
    const stream = await this.getStream(id);
    if (!stream) return null;
    return await new dntShim.Response(stream).text();
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    const stream = await this.getStream(id);
    if (!stream) return null;
    const buffer = await new dntShim.Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  async delete(id: string): Promise<void> {
    const key = this.getKey(id);
    const token = await this.getAccessToken();
    const deleteUrl = `https://storage.googleapis.com/storage/v1/b/${this.config.bucket}/o/${key}`;

    const response = await dntShim.fetch(deleteUrl, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 404) return;

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to delete from GCS: ${response.status} - ${response.statusText}. Body: ${errorBody}`,
      );
    }
  }

  async exists(id: string): Promise<boolean> {
    const key = this.getKey(id);
    const token = await this.getAccessToken();
    const getUrl =
      `https://storage.googleapis.com/storage/v1/b/${this.config.bucket}/o/${key}?fields=id`;

    const response = await dntShim.fetch(getUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 200) return true;
    if (response.status === 404) return false;

    const errorBody = await response.text();
    throw new Error(
      `Failed to check existence in GCS: ${response.status} - ${response.statusText}. Body: ${errorBody}`,
    );
  }

  async stat(id: string): Promise<BlobRef | null> {
    const key = this.getKey(id);
    const token = await this.getAccessToken();
    const getUrl = `https://storage.googleapis.com/storage/v1/b/${this.config.bucket}/o/${key}`;

    const response = await dntShim.fetch(getUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 404) return null;

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to get metadata from GCS: ${response.status} - ${response.statusText}. Body: ${errorBody}`,
      );
    }

    const gcsObject = await response.json();

    const metadata: Record<string, string> = {};
    const rawMetadata = gcsObject.metadata as Record<string, string> | undefined;

    if (rawMetadata) {
      for (const [k, v] of Object.entries(rawMetadata)) {
        metadata[k.startsWith("x-goog-meta-") ? k.replace("x-goog-meta-", "") : k] = v;
      }
    }

    const expiresAt = metadata.expiresat ? new Date(metadata.expiresat) : undefined;

    return {
      __kind: "blob",
      id,
      size: Number(gcsObject.size),
      mimeType: gcsObject.contentType,
      createdAt: new Date(gcsObject.timeCreated),
      expiresAt,
      metadata,
      url: gcsObject.mediaLink,
    };
  }
}
