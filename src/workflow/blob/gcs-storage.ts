import { logger as baseLogger } from "#veryfront/utils";
import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.ts";

const logger = baseLogger.component("gcs-blob-storage");

function base64url(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPKCS8Key(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

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
  private serviceAccount: { private_key: string; client_email: string };
  private tokenCache: { accessToken: string; expiresAt: Date } | null = null;

  constructor(config: GCSBlobStorageConfig) {
    this.config = config;

    let sa: Record<string, unknown>;
    try {
      sa = JSON.parse(this.config.serviceAccountKey);
    } catch {
      throw new Error("GCSBlobStorage: serviceAccountKey must be a valid JSON string.");
    }

    if (typeof sa.private_key !== "string" || !sa.private_key.includes("BEGIN PRIVATE KEY")) {
      throw new Error(
        "GCSBlobStorage: serviceAccountKey must contain a valid private_key field (PKCS8 PEM).",
      );
    }

    if (typeof sa.client_email !== "string" || !sa.client_email) {
      throw new Error("GCSBlobStorage: serviceAccountKey must contain a valid client_email field.");
    }

    this.serviceAccount = { private_key: sa.private_key, client_email: sa.client_email };
  }

  private getKey(id: string): string {
    return this.config.prefix ? `${this.config.prefix}${id}` : id;
  }

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache?.expiresAt && this.tokenCache.expiresAt > new Date()) {
      return this.tokenCache.accessToken;
    }

    const sa = this.serviceAccount;
    const tokenEndpoint = "https://oauth2.googleapis.com/token";
    const scope = "https://www.googleapis.com/auth/devstorage.full_control";

    const now = Date.now();
    const iat = Math.floor(now / 1000);
    const exp = iat + 3600;

    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = base64url(
      JSON.stringify({
        iss: sa.client_email,
        scope,
        aud: tokenEndpoint,
        exp,
        iat,
      }),
    );

    const signingInput = `${header}.${claims}`;
    const privateKey = await importPKCS8Key(sa.private_key);
    const signatureBytes = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(signingInput),
    );
    const signature = base64urlFromBytes(new Uint8Array(signatureBytes));
    const jwt = `${signingInput}.${signature}`;

    const response = await fetch(tokenEndpoint, {
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
    data: string | Uint8Array | Blob | ReadableStream,
    options: StoreBlobOptions = {},
  ): Promise<BlobRef> {
    const id = options.id ?? crypto.randomUUID();
    const key = this.getKey(id);
    const mimeType = options.mimeType ?? "application/octet-stream";
    const createdAt = new Date();
    const ttl = options.ttl ?? this.config.defaultTtl;
    const expiresAt = ttl ? new Date(createdAt.getTime() + ttl * 1000) : undefined;

    let body: string | Uint8Array | ReadableStream | Blob;
    let contentLength: number | undefined;

    if (typeof data === "string") {
      const bytes = new TextEncoder().encode(data);
      body = bytes;
      contentLength = bytes.byteLength;
    } else if (data instanceof Uint8Array) {
      body = data;
      contentLength = data.byteLength;
    } else if (data instanceof Blob) {
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

    if (contentLength !== undefined) headers["Content-Length"] = String(contentLength);

    for (const [k, v] of Object.entries(options.metadata ?? {})) {
      headers[`x-goog-meta-${k.toLowerCase()}`] = v;
    }

    if (expiresAt) {
      // Store expiresAt in metadata for stat retrieval, GCS native TTL is via object lifecycle rules
      headers["x-goog-meta-expiresat"] = expiresAt.toISOString();
    }

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
      const response = await fetch(downloadUrl, {
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
      logger.error("getStream error", e);
      throw e;
    }
  }

  async getText(id: string): Promise<string | null> {
    const stream = await this.getStream(id);
    if (!stream) return null;
    return new Response(stream).text();
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    const stream = await this.getStream(id);
    if (!stream) return null;
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  async delete(id: string): Promise<void> {
    const key = this.getKey(id);
    const token = await this.getAccessToken();
    const deleteUrl = `https://storage.googleapis.com/storage/v1/b/${this.config.bucket}/o/${key}`;

    const response = await fetch(deleteUrl, {
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

    const response = await fetch(getUrl, {
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

    const response = await fetch(getUrl, {
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

    for (const [k, v] of Object.entries(rawMetadata ?? {})) {
      metadata[k.startsWith("x-goog-meta-") ? k.replace("x-goog-meta-", "") : k] = v;
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
