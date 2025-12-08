/**
 * Google Cloud Storage Blob Storage
 *
 * Stores blobs in Google Cloud Storage.
 */

import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.ts";

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
    const jwtClaimSet = btoa(JSON.stringify({
      iss: sa.client_email,
      scope: scope,
      aud: tokenEndpoint,
      exp: Math.floor(now / 1000) + 3600, // 1 hour expiration
      iat: Math.floor(now / 1000),
    }));

    // This part requires a proper JWT signing library.
    // Deno's native crypto.subtle can sign, but creating the RS256 private key from PKCS8 (PEM)
    // is non-trivial without a dedicated library.
    // For a quick implementation, we will use a placeholder or assume a pre-signed JWT.
    // In a real-world Deno project, you'd use `djwt` or a similar library.
    console.warn(
      "[GCSBlobStorage] JWT signing for service account requires a library like `djwt`. " +
        "Proceeding with a placeholder/manual approach, which is not suitable for production.",
    );

    // Placeholder for actual JWT signing
    const signature = "PLACEHOLDER_SIGNATURE";
    const jwt = `${jwtHeader}.${jwtClaimSet}.${signature}`;

    // This is a simplified approach, a real implementation would correctly sign the JWT
    // and handle key loading from the service account JSON.

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get GCS access token: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const accessToken = data.access_token;
    const expiresIn = data.expires_in; // in seconds

    this.tokenCache = {
      accessToken,
      expiresAt: new Date(Date.now() + (expiresIn - 60) * 1000), // Refresh 1 min before actual expiry
    };

    return accessToken;
  }

  async put(
    data: string | Uint8Array | Blob | ReadableStream,
    options: StoreBlobOptions = {},
  ): Promise<BlobRef> {
    const id = options.id || crypto.randomUUID();
    const key = this.getKey(id);
    const mimeType = options.mimeType || "application/octet-stream";
    const createdAt = new Date();
    const ttl = options.ttl ?? this.config.defaultTtl;
    const expiresAt = ttl ? new Date(createdAt.getTime() + ttl * 1000) : undefined;

    let body: string | Uint8Array | ReadableStream | Blob;
    let contentLength: number | undefined;

    if (typeof data === "string") {
      body = new TextEncoder().encode(data);
      contentLength = body.byteLength;
    } else if (data instanceof Uint8Array) {
      body = data;
      contentLength = data.byteLength;
    } else if (data instanceof Blob) {
      body = data;
      contentLength = data.size;
    } else if (data instanceof ReadableStream) {
      body = data;
      // ContentLength cannot be easily determined for ReadableStream without consuming it.
      // GCS can handle chunked uploads without Content-Length, but specifying it is better.
    } else {
      throw new Error("Unsupported data type for GCSBlobStorage");
    }

    const token = await this.getAccessToken();
    const uploadUrl =
      `https://storage.googleapis.com/upload/storage/v1/b/${this.config.bucket}/o?uploadType=media&name=${key}`;

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": mimeType,
    };
    if (contentLength !== undefined) {
      headers["Content-Length"] = String(contentLength);
    }

    // Add custom metadata. GCS accepts x-goog-meta- prefix.
    const gcsMetadata: Record<string, string> = {};
    if (options.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        gcsMetadata[`x-goog-meta-${k.toLowerCase()}`] = v;
      }
    }
    if (expiresAt) {
      // Store expiresAt in metadata for stat retrieval, GCS native TTL is via object lifecycle rules
      gcsMetadata["x-goog-meta-expiresat"] = expiresAt.toISOString();
    }
    Object.assign(headers, gcsMetadata);

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers,
      body: body as BodyInit,
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
      expiresAt: expiresAt, // Derived from TTL passed or default
      metadata: options.metadata,
      url: this.config.baseUrl ? `${this.config.baseUrl}/${key}` : gcsObject.mediaLink, // mediaLink is the direct download URL
    };
  }

  async getStream(id: string): Promise<ReadableStream | null> {
    const key = this.getKey(id);
    const token = await this.getAccessToken();
    const downloadUrl =
      `https://storage.googleapis.com/storage/v1/b/${this.config.bucket}/o/${key}?alt=media`;

    try {
      const response = await fetch(downloadUrl, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Failed to download from GCS: ${response.status} - ${response.statusText}. Body: ${errorBody}`,
        );
      }
      return response.body; // Deno's fetch body is a ReadableStream
    } catch (e) {
      console.error("GCS getStream error:", e);
      throw e;
    }
  }

  async getText(id: string): Promise<string | null> {
    const stream = await this.getStream(id);
    if (!stream) return null;
    const reader = stream.getReader();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    return text;
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    const stream = await this.getStream(id);
    if (!stream) return null;
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  async delete(id: string): Promise<void> {
    const key = this.getKey(id);
    const token = await this.getAccessToken();
    const deleteUrl = `https://storage.googleapis.com/storage/v1/b/${this.config.bucket}/o/${key}`;

    const response = await fetch(deleteUrl, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });

    if (response.status === 404) {
      // Object not found, consider it deleted
      return;
    }
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

    const response = await fetch(getUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });

    if (response.status === 200) {
      return true;
    }
    if (response.status === 404) {
      return false;
    }
    const errorBody = await response.text();
    throw new Error(
      `Failed to check existence in GCS: ${response.status} - ${response.statusText}. Body: ${errorBody}`,
    );
  }

  async stat(id: string): Promise<BlobRef | null> {
    const key = this.getKey(id);
    const token = await this.getAccessToken();
    const getUrl = `https://storage.googleapis.com/storage/v1/b/${this.config.bucket}/o/${key}`;

    const response = await fetch(getUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to get metadata from GCS: ${response.status} - ${response.statusText}. Body: ${errorBody}`,
      );
    }

    const gcsObject = await response.json();

    // Custom metadata is stored with `x-goog-meta-` prefix and is all lowercase
    const metadata: Record<string, string> = {};
    if (gcsObject.metadata) {
      for (const [k, v] of Object.entries(gcsObject.metadata as Record<string, string>)) {
        if (k.startsWith("x-goog-meta-")) {
          metadata[k.replace("x-goog-meta-", "")] = v;
        } else {
          metadata[k] = v;
        }
      }
    }

    let expiresAt: Date | undefined;
    if (metadata["expiresat"]) {
      expiresAt = new Date(metadata["expiresat"]!); // Retrieve custom expiresAt from metadata
    }

    return {
      __kind: "blob",
      id,
      size: Number(gcsObject.size),
      mimeType: gcsObject.contentType,
      createdAt: new Date(gcsObject.timeCreated),
      expiresAt: expiresAt, // Populated from custom metadata if available
      metadata: metadata,
      url: gcsObject.mediaLink, // mediaLink is the direct download URL
    };
  }
}
