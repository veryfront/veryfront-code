import { API_ERROR, CONFIG_INVALID, INVALID_ARGUMENT } from "veryfront/errors";
import {
  assertSafeBlobId,
  type BlobRef,
  type BlobStorage,
  type StoreBlobOptions,
} from "veryfront/workflow/blob";
import {
  DEFAULT_RESUMABLE_CHUNK_SIZE,
  MAX_RESUMABLE_CHUNK_SIZE,
  MIN_RESUMABLE_CHUNK_SIZE,
  uploadUnknownLengthStream,
} from "./resumable-upload.ts";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const STORAGE_ORIGIN = "https://storage.googleapis.com";
const STORAGE_SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";
const MAX_OBJECT_KEY_BYTES = 1_024;
const MAX_SERVICE_ACCOUNT_KEY_BYTES = 64 * 1_024;
const MAX_METADATA_ENTRIES = 100;
const MAX_METADATA_BYTES = 8 * 1_024;
const MAX_ERROR_BODY_BYTES = 4 * 1_024;
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_ACCESS_TOKEN_BYTES = 16 * 1024;
const MAX_ACCESS_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;
const MAX_RESUMABLE_SESSION_URL_LENGTH = 16 * 1024;
const INTERNAL_EXPIRY_METADATA_KEY = "expiresat";

/** Fetch-compatible transport used for OAuth and Cloud Storage requests. */
export type GCSFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Injectable transport and clock seams for deterministic tests. */
export interface GCSBlobStorageDependencies {
  /** Fetch-compatible provider transport. */
  fetch?: GCSFetch;
  /** Millisecond Unix timestamp source. */
  now?: () => number;
}

/** Explicit Google Cloud Storage connection and object-layout configuration. */
export interface GCSBlobStorageConfig {
  /** GCS bucket name. */
  bucket: string;
  /** Google service-account JSON containing `private_key` and `client_email`. */
  serviceAccountKey: string;
  /** Object-key prefix applied verbatim before each blob id. */
  prefix?: string;
  /** Public base URL used only to populate `BlobRef.url`. */
  baseUrl?: string;
  /** Default TTL in seconds. Zero means no expiry. */
  defaultTtl?: number;
  /** Resumable stream chunk size; must be a 256 KiB multiple. Defaults to 8 MiB. */
  resumableChunkSize?: number;
  /** Cancellation signal applied to provider requests and returned streams. */
  signal?: AbortSignal;
}

interface ServiceAccount {
  clientEmail: string;
  privateKeyPem: string;
}

interface NormalizedGCSConfig {
  bucket: string;
  prefix?: string;
  baseUrlObject?: URL;
  defaultTtl?: number;
  resumableChunkSize: number;
  signal?: AbortSignal;
  serviceAccount: ServiceAccount;
}

interface GCSObject {
  size: number;
  contentType: string;
  timeCreated: Date;
  metadata: Record<string, string>;
}

interface TokenRequest {
  readonly promise: Promise<string>;
}

function linkAbortSignal(
  upstream: AbortSignal | undefined,
  controller: AbortController,
  fallbackMessage: string,
): () => void {
  if (!upstream) return () => {};
  const forward = () => {
    if (!controller.signal.aborted) {
      controller.abort(
        upstream.reason ?? new DOMException(fallbackMessage, "AbortError"),
      );
    }
  };
  if (upstream.aborted) forward();
  else upstream.addEventListener("abort", forward, { once: true });
  return () => upstream.removeEventListener("abort", forward);
}

function configError(detail: string, cause?: unknown): Error {
  return CONFIG_INVALID.create({ detail, cause });
}

function invalidArgument(detail: string, cause?: unknown): Error {
  return INVALID_ARGUMENT.create({ detail, cause });
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw configError(`GCSBlobStorage: ${field} must be a non-empty string`);
  }
  return value;
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname === "::1" || hostname === "[::1]" || /^127(?:\.[0-9]{1,3}){3}$/.test(hostname);
}

function validateTtl(
  value: unknown,
  field: string,
  kind: "config" | "argument",
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    const detail = `GCSBlobStorage: ${field} must be a finite non-negative number`;
    throw kind === "config" ? configError(detail) : invalidArgument(detail);
  }
  return value;
}

function validateResumableChunkSize(value: unknown): number {
  if (value === undefined) return DEFAULT_RESUMABLE_CHUNK_SIZE;
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) ||
    value < MIN_RESUMABLE_CHUNK_SIZE ||
    value > MAX_RESUMABLE_CHUNK_SIZE || value % MIN_RESUMABLE_CHUNK_SIZE !== 0
  ) {
    throw configError(
      `GCSBlobStorage: resumableChunkSize must be a 256 KiB multiple between ${MIN_RESUMABLE_CHUNK_SIZE} and ${MAX_RESUMABLE_CHUNK_SIZE} bytes`,
    );
  }
  return value;
}

function parseBaseUrl(value: unknown): URL | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw configError("GCSBlobStorage: baseUrl must be a non-empty HTTP(S) URL");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw configError("GCSBlobStorage: baseUrl must be a valid HTTP(S) URL", cause);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw configError("GCSBlobStorage: baseUrl must use HTTP or HTTPS");
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw configError(
      "GCSBlobStorage: baseUrl must use HTTPS unless its host is localhost or a loopback IP",
    );
  }
  if (url.username || url.password) {
    throw configError("GCSBlobStorage: baseUrl must not contain credentials");
  }
  if (url.search || url.hash) {
    throw configError("GCSBlobStorage: baseUrl must not contain a query or fragment");
  }
  return url;
}

function parseServiceAccount(value: unknown): ServiceAccount {
  if (typeof value !== "string" || value.length === 0) {
    throw configError("GCSBlobStorage: serviceAccountKey must be a non-empty JSON string");
  }
  if (new TextEncoder().encode(value).byteLength > MAX_SERVICE_ACCOUNT_KEY_BYTES) {
    throw configError(
      `GCSBlobStorage: serviceAccountKey must not exceed ${MAX_SERVICE_ACCOUNT_KEY_BYTES} UTF-8 bytes`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    throw configError("GCSBlobStorage: serviceAccountKey must be a valid JSON string", cause);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw configError("GCSBlobStorage: serviceAccountKey must contain a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.private_key !== "string" ||
    !/^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----\s*$/.test(
      record.private_key,
    )
  ) {
    throw configError(
      "GCSBlobStorage: serviceAccountKey must contain a PKCS8 PEM private_key",
    );
  }
  if (
    typeof record.client_email !== "string" || record.client_email.trim().length === 0 ||
    record.client_email !== record.client_email.trim() ||
    record.client_email.length > 320 || hasAsciiControlCharacter(record.client_email)
  ) {
    throw configError(
      "GCSBlobStorage: serviceAccountKey must contain a non-empty client_email",
    );
  }
  return {
    privateKeyPem: record.private_key,
    clientEmail: record.client_email,
  };
}

function validateBucketName(value: string): string {
  if (value.length < 3 || value.length > 222 || /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(value)) {
    throw configError("GCSBlobStorage: bucket must be a valid Cloud Storage bucket name");
  }
  const labels = value.split(".");
  if (
    labels.some((label) =>
      label.length === 0 || label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/.test(label)
    )
  ) {
    throw configError("GCSBlobStorage: bucket must be a valid Cloud Storage bucket name");
  }
  return value;
}

function normalizeConfig(config: GCSBlobStorageConfig): NormalizedGCSConfig {
  if (!config || typeof config !== "object") {
    throw configError("GCSBlobStorage: configuration is required");
  }
  const bucket = validateBucketName(requireNonEmptyString(config.bucket, "bucket"));
  const serviceAccountKey = requireNonEmptyString(config.serviceAccountKey, "serviceAccountKey");
  const serviceAccount = parseServiceAccount(serviceAccountKey);
  const baseUrlObject = parseBaseUrl(config.baseUrl);
  const defaultTtl = validateTtl(config.defaultTtl, "defaultTtl", "config");
  const resumableChunkSize = validateResumableChunkSize(config.resumableChunkSize);
  if (config.prefix !== undefined && typeof config.prefix !== "string") {
    throw configError("GCSBlobStorage: prefix must be a string");
  }
  if (config.signal !== undefined && !(config.signal instanceof AbortSignal)) {
    throw configError("GCSBlobStorage: signal must be an AbortSignal");
  }
  return {
    bucket,
    serviceAccount,
    resumableChunkSize,
    ...(config.prefix === undefined ? {} : { prefix: config.prefix }),
    ...(baseUrlObject === undefined ? {} : { baseUrlObject }),
    ...(defaultTtl === undefined ? {} : { defaultTtl }),
    ...(config.signal === undefined ? {} : { signal: config.signal }),
  };
}

function validateDependencies(
  dependencies: GCSBlobStorageDependencies,
): GCSBlobStorageDependencies {
  if (!dependencies || typeof dependencies !== "object") {
    throw invalidArgument("GCSBlobStorage: dependencies must be an object");
  }
  if (dependencies.fetch !== undefined && typeof dependencies.fetch !== "function") {
    throw invalidArgument("GCSBlobStorage: dependencies.fetch must be a function");
  }
  if (dependencies.now !== undefined && typeof dependencies.now !== "function") {
    throw invalidArgument("GCSBlobStorage: dependencies.now must be a function");
  }
  return dependencies;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function textToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const encoded = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replaceAll(/\s/g, "");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  } catch (cause) {
    throw configError("GCSBlobStorage: private_key contains invalid base64", cause);
  }
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      bytes.buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (cause) {
    throw configError("GCSBlobStorage: private_key is not a valid RSA PKCS8 key", cause);
  }
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
  truncate: boolean,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  let cancelled = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maximumBytes - total;
      if (value.byteLength > remaining) {
        if (!truncate) {
          cancelled = true;
          try {
            await reader.cancel("response body exceeded configured limit");
          } catch {
            // The size violation remains the authoritative protocol failure.
          }
          throw API_ERROR.create({
            detail: `GCSBlobStorage: response body exceeded ${maximumBytes} bytes`,
          });
        }
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        total = maximumBytes;
        truncated = true;
        try {
          await reader.cancel("error body truncated");
        } catch {
          // Preserve the provider's HTTP failure instead of a cancellation detail.
        }
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (error) {
    if (!cancelled) {
      try {
        await reader.cancel(error);
      } catch {
        // Preserve the primary read/protocol failure.
      }
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  return truncated ? `${text}…` : text;
}

async function providerHttpError(operation: string, response: Response): Promise<Error> {
  let body: string;
  try {
    body = (await readBoundedText(response, MAX_ERROR_BODY_BYTES, true)).trim();
  } catch (cause) {
    return API_ERROR.create({
      detail: `GCSBlobStorage: ${operation} failed with HTTP ${response.status}`,
      cause,
    });
  }
  const status = response.statusText.trim();
  const suffix = [status, body].filter((part) => part.length > 0).join(": ");
  return API_ERROR.create({
    detail: `GCSBlobStorage: ${operation} failed with HTTP ${response.status}${
      suffix ? ` (${suffix})` : ""
    }`,
  });
}

async function readJson(response: Response, operation: string): Promise<unknown> {
  const text = await readBoundedText(response, MAX_JSON_BODY_BYTES, false);
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw API_ERROR.create({
      detail: `GCSBlobStorage: ${operation} returned invalid JSON`,
      cause,
    });
  }
}

function readSize(value: unknown, operation: string): number {
  const size = typeof value === "number"
    ? value
    : typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)
    ? Number(value)
    : Number.NaN;
  if (!Number.isSafeInteger(size) || size < 0) {
    throw API_ERROR.create({
      detail: `GCSBlobStorage: ${operation} returned an invalid object size`,
    });
  }
  return size;
}

function readGCSObject(value: unknown, operation: string): GCSObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw API_ERROR.create({
      detail: `GCSBlobStorage: ${operation} returned a non-object response`,
    });
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.contentType !== "string" || record.contentType.length === 0 ||
    record.contentType.length > 1_024 || hasAsciiControlCharacter(record.contentType)
  ) {
    throw API_ERROR.create({
      detail: `GCSBlobStorage: ${operation} returned an invalid content type`,
    });
  }
  if (typeof record.timeCreated !== "string") {
    throw API_ERROR.create({
      detail: `GCSBlobStorage: ${operation} returned an invalid creation time`,
    });
  }
  const timeCreated = new Date(record.timeCreated);
  if (!Number.isFinite(timeCreated.getTime())) {
    throw API_ERROR.create({
      detail: `GCSBlobStorage: ${operation} returned an invalid creation time`,
    });
  }
  const metadata: Record<string, string> = Object.create(null);
  if (record.metadata !== undefined) {
    if (!record.metadata || typeof record.metadata !== "object" || Array.isArray(record.metadata)) {
      throw API_ERROR.create({
        detail: `GCSBlobStorage: ${operation} returned invalid metadata`,
      });
    }
    const entries = Object.entries(record.metadata);
    if (entries.length > MAX_METADATA_ENTRIES) {
      throw API_ERROR.create({
        detail: `GCSBlobStorage: ${operation} returned too many metadata entries`,
      });
    }
    let metadataBytes = 0;
    for (const [key, entry] of entries) {
      const normalizedKey = key.toLowerCase();
      if (
        !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(normalizedKey) ||
        typeof entry !== "string" || /[\r\n\0]/.test(entry)
      ) {
        throw API_ERROR.create({
          detail: `GCSBlobStorage: ${operation} returned invalid metadata`,
        });
      }
      if (Object.hasOwn(metadata, normalizedKey)) {
        throw API_ERROR.create({
          detail: `GCSBlobStorage: ${operation} returned colliding metadata keys`,
        });
      }
      metadataBytes += new TextEncoder().encode(normalizedKey).byteLength +
        new TextEncoder().encode(entry).byteLength;
      if (metadataBytes > MAX_METADATA_BYTES) {
        throw API_ERROR.create({
          detail: `GCSBlobStorage: ${operation} returned oversized metadata`,
        });
      }
      metadata[normalizedKey] = entry;
    }
  }
  return {
    size: readSize(record.size, operation),
    contentType: record.contentType,
    timeCreated,
    metadata,
  };
}

function snapshotMetadata(value: StoreBlobOptions["metadata"]): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  let entries: [string, unknown][];
  try {
    entries = Object.entries(value);
  } catch (cause) {
    throw invalidArgument("GCSBlobStorage: metadata must be a readable string record", cause);
  }
  if (entries.length > MAX_METADATA_ENTRIES) {
    throw invalidArgument(
      `GCSBlobStorage: metadata must contain at most ${MAX_METADATA_ENTRIES} entries`,
    );
  }
  const metadata: Record<string, string> = Object.create(null);
  let bytes = 0;
  for (const [rawKey, entry] of entries) {
    const key = rawKey.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(key)) {
      throw invalidArgument(
        `GCSBlobStorage: metadata key ${JSON.stringify(rawKey)} is not HTTP-header safe`,
      );
    }
    if (key === INTERNAL_EXPIRY_METADATA_KEY) {
      throw invalidArgument(
        `GCSBlobStorage: metadata key ${JSON.stringify(rawKey)} is reserved`,
      );
    }
    if (Object.hasOwn(metadata, key)) {
      throw invalidArgument(
        `GCSBlobStorage: metadata keys must be unique ignoring case (${JSON.stringify(rawKey)})`,
      );
    }
    if (typeof entry !== "string" || /[\r\n\0]/.test(entry)) {
      throw invalidArgument(
        `GCSBlobStorage: metadata value for ${JSON.stringify(rawKey)} must be a header-safe string`,
      );
    }
    bytes += new TextEncoder().encode(key).byteLength + new TextEncoder().encode(entry).byteLength;
    if (bytes > MAX_METADATA_BYTES) {
      throw invalidArgument(
        `GCSBlobStorage: metadata must not exceed ${MAX_METADATA_BYTES} UTF-8 bytes`,
      );
    }
    metadata[key] = entry;
  }
  return metadata;
}

function expiresAt(createdAt: Date, ttl: number | undefined): Date | undefined {
  if (ttl === undefined || ttl === 0) return undefined;
  const milliseconds = createdAt.getTime() + ttl * 1_000;
  if (!Number.isFinite(milliseconds)) {
    throw invalidArgument("GCSBlobStorage: ttl produces an invalid expiry time");
  }
  return new Date(milliseconds);
}

function validateMimeType(value: unknown): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 1_024 ||
    hasAsciiControlCharacter(value)
  ) {
    throw invalidArgument("GCSBlobStorage: mimeType must be a non-empty header-safe string");
  }
  return value;
}

function validateObjectKey(key: string): void {
  const byteLength = new TextEncoder().encode(key).byteLength;
  if (byteLength === 0 || byteLength > MAX_OBJECT_KEY_BYTES) {
    throw invalidArgument(
      `GCSBlobStorage: object key must contain between 1 and ${MAX_OBJECT_KEY_BYTES} UTF-8 bytes`,
    );
  }
  if (
    key === "." || key === ".." || /[\r\n]/.test(key) ||
    key.startsWith(".well-known/acme-challenge/")
  ) {
    throw invalidArgument("GCSBlobStorage: object key is forbidden by Cloud Storage");
  }
}

function publicObjectUrl(baseUrl: URL | undefined, key: string): string | undefined {
  if (!baseUrl) return undefined;
  const base = new URL(baseUrl.href);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return `${base.href}${encodeURIComponent(key)}`;
}

function gcsObjectUrl(bucket: string, key: string): URL {
  return new URL(
    `${STORAGE_ORIGIN}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}`,
  );
}

function gcsBucketUrl(bucket: string): URL {
  const url = new URL(`${STORAGE_ORIGIN}/storage/v1/b/${encodeURIComponent(bucket)}`);
  url.searchParams.set("fields", "id");
  return url;
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Body cleanup must not replace the provider status being classified.
  }
}

function readResumableSessionUrl(response: Response, bucket: string): URL {
  const location = response.headers.get("location");
  if (!location || location.length > MAX_RESUMABLE_SESSION_URL_LENGTH) {
    throw API_ERROR.create({
      detail: "GCSBlobStorage: upload initiation omitted the resumable session URI",
    });
  }
  let url: URL;
  try {
    url = new URL(location);
  } catch (cause) {
    throw API_ERROR.create({
      detail: "GCSBlobStorage: upload initiation returned an invalid session URI",
      cause,
    });
  }
  const expectedPath = `/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`;
  const uploadTypes = url.searchParams.getAll("uploadType");
  const uploadIds = url.searchParams.getAll("upload_id");
  if (
    url.origin !== STORAGE_ORIGIN || url.username || url.password || url.hash ||
    url.pathname !== expectedPath ||
    uploadTypes.length !== 1 || uploadTypes[0] !== "resumable" ||
    uploadIds.length !== 1 || !uploadIds[0]
  ) {
    throw API_ERROR.create({
      detail: "GCSBlobStorage: upload initiation returned an untrusted session URI",
    });
  }
  return url;
}

/** Google Cloud Storage implementation of the framework-owned contract. */
export class GCSBlobStorage implements BlobStorage {
  readonly #config: NormalizedGCSConfig;
  readonly #fetch: GCSFetch;
  readonly #now: () => number;
  readonly #lifecycleController = new AbortController();
  readonly #detachConfigAbort: () => void;
  #privateKey: Promise<CryptoKey> | undefined;
  #tokenRequest: TokenRequest | undefined;
  #tokenCache: { accessToken: string; refreshAt: number } | undefined;
  #closed = false;

  constructor(config: GCSBlobStorageConfig, dependencies: GCSBlobStorageDependencies = {}) {
    const normalized = normalizeConfig(config);
    const validatedDependencies = validateDependencies(dependencies);
    this.#detachConfigAbort = linkAbortSignal(
      normalized.signal,
      this.#lifecycleController,
      "The GCS blob-storage configuration was revoked.",
    );
    this.#config = {
      ...normalized,
      signal: this.#lifecycleController.signal,
    };
    this.#fetch = validatedDependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = validatedDependencies.now ?? Date.now;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#detachConfigAbort();
    this.#tokenCache = undefined;
    if (!this.#lifecycleController.signal.aborted) {
      this.#lifecycleController.abort(
        new DOMException("GCS blob storage is closing.", "AbortError"),
      );
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new DOMException("GCS blob storage is closed.", "InvalidStateError");
    }
  }

  #key(id: string): string {
    this.#assertOpen();
    assertSafeBlobId(id);
    const key = `${this.#config.prefix ?? ""}${id}`;
    validateObjectKey(key);
    return key;
  }

  #request(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    this.#assertOpen();
    this.#config.signal?.throwIfAborted();
    return this.#fetch(input, {
      ...init,
      signal: this.#config.signal,
      redirect: "error",
    });
  }

  #getPrivateKey(): Promise<CryptoKey> {
    this.#privateKey ??= importPrivateKey(this.#config.serviceAccount.privateKeyPem);
    return this.#privateKey;
  }

  async #requestAccessToken(): Promise<string> {
    this.#config.signal?.throwIfAborted();
    const now = this.#now();
    if (!Number.isFinite(now)) {
      throw configError("GCSBlobStorage: clock returned an invalid timestamp");
    }
    const issuedAt = Math.floor(now / 1_000);
    const expiresAt = issuedAt + 3_600;
    const header = textToBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = textToBase64Url(JSON.stringify({
      iss: this.#config.serviceAccount.clientEmail,
      scope: STORAGE_SCOPE,
      aud: TOKEN_ENDPOINT,
      exp: expiresAt,
      iat: issuedAt,
    }));
    const signingInput = `${header}.${claims}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      await this.#getPrivateKey(),
      new TextEncoder().encode(signingInput),
    );
    this.#config.signal?.throwIfAborted();
    const assertion = `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;

    const response = await this.#request(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok) throw await providerHttpError("access-token request", response);
    const payload = await readJson(response, "access-token request");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw API_ERROR.create({
        detail: "GCSBlobStorage: access-token request returned a non-object response",
      });
    }
    const record = payload as Record<string, unknown>;
    if (
      typeof record.access_token !== "string" || record.access_token.length === 0 ||
      new TextEncoder().encode(record.access_token).byteLength > MAX_ACCESS_TOKEN_BYTES ||
      hasAsciiControlCharacter(record.access_token)
    ) {
      throw API_ERROR.create({
        detail: "GCSBlobStorage: access-token response contained an invalid access_token",
      });
    }
    if (
      record.token_type !== undefined &&
      (typeof record.token_type !== "string" || record.token_type.toLowerCase() !== "bearer")
    ) {
      throw API_ERROR.create({
        detail: "GCSBlobStorage: access-token response contained an invalid token_type",
      });
    }
    if (
      typeof record.expires_in !== "number" || !Number.isSafeInteger(record.expires_in) ||
      record.expires_in <= 0 || record.expires_in > MAX_ACCESS_TOKEN_LIFETIME_SECONDS
    ) {
      throw API_ERROR.create({
        detail: "GCSBlobStorage: access-token response contained an invalid expires_in",
      });
    }
    this.#tokenCache = {
      accessToken: record.access_token,
      refreshAt: now + Math.max(0, record.expires_in - 60) * 1_000,
    };
    return record.access_token;
  }

  async #getAccessToken(): Promise<string> {
    const now = this.#now();
    if (this.#tokenCache && this.#tokenCache.refreshAt > now) {
      return this.#tokenCache.accessToken;
    }
    if (!this.#tokenRequest) {
      const request: TokenRequest = { promise: this.#requestAccessToken() };
      this.#tokenRequest = request;
      try {
        return await request.promise;
      } finally {
        if (this.#tokenRequest === request) this.#tokenRequest = undefined;
      }
    }
    return await this.#tokenRequest.promise;
  }

  async #authorizedHeaders(): Promise<Headers> {
    return new Headers({ authorization: `Bearer ${await this.#getAccessToken()}` });
  }

  async #verifyObjectMissing(response: Response, operation: string): Promise<void> {
    await discardResponseBody(response);
    const bucketResponse = await this.#request(gcsBucketUrl(this.#config.bucket), {
      headers: await this.#authorizedHeaders(),
    });
    if (bucketResponse.status === 200) {
      await discardResponseBody(bucketResponse);
      return;
    }
    throw await providerHttpError(`${operation} bucket verification`, bucketResponse);
  }

  async put(
    data: string | Uint8Array | Blob | ReadableStream,
    options: StoreBlobOptions = {},
  ): Promise<BlobRef> {
    const id = options.id ?? crypto.randomUUID();
    const key = this.#key(id);
    const mimeType = validateMimeType(options.mimeType ?? "application/octet-stream");
    const metadata = snapshotMetadata(options.metadata);
    const ttl = validateTtl(options.ttl ?? this.#config.defaultTtl, "ttl", "argument");
    const createdAt = new Date(this.#now());
    if (!Number.isFinite(createdAt.getTime())) {
      throw configError("GCSBlobStorage: clock returned an invalid timestamp");
    }
    const expiry = expiresAt(createdAt, ttl);

    let body: Uint8Array | Blob | ReadableStream;
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
      if (data.locked) {
        throw invalidArgument("GCSBlobStorage: upload stream must be unlocked");
      }
      body = data;
    } else {
      throw invalidArgument("Unsupported data type for GCSBlobStorage");
    }

    const providerMetadata: Record<string, string> = {
      ...(metadata ?? {}),
      ...(expiry ? { [INTERNAL_EXPIRY_METADATA_KEY]: expiry.toISOString() } : {}),
    };
    if (Object.keys(providerMetadata).length > MAX_METADATA_ENTRIES) {
      throw invalidArgument(
        `GCSBlobStorage: metadata including expiry must contain at most ${MAX_METADATA_ENTRIES} entries`,
      );
    }
    let providerMetadataBytes = 0;
    for (const [metadataKey, metadataValue] of Object.entries(providerMetadata)) {
      providerMetadataBytes += new TextEncoder().encode(metadataKey).byteLength +
        new TextEncoder().encode(metadataValue).byteLength;
    }
    if (providerMetadataBytes > MAX_METADATA_BYTES) {
      throw invalidArgument(
        `GCSBlobStorage: metadata including expiry must not exceed ${MAX_METADATA_BYTES} UTF-8 bytes`,
      );
    }
    const metadataDocument = new TextEncoder().encode(JSON.stringify({
      name: key,
      contentType: mimeType,
      ...(Object.keys(providerMetadata).length === 0 ? {} : { metadata: providerMetadata }),
    }));
    const initiationHeaders = await this.#authorizedHeaders();
    initiationHeaders.set("content-type", "application/json; charset=utf-8");
    initiationHeaders.set("content-length", String(metadataDocument.byteLength));
    initiationHeaders.set("x-upload-content-type", mimeType);
    if (contentLength !== undefined) {
      initiationHeaders.set("x-upload-content-length", String(contentLength));
    }
    const initiationUrl = new URL(
      `${STORAGE_ORIGIN}/upload/storage/v1/b/${encodeURIComponent(this.#config.bucket)}/o`,
    );
    initiationUrl.searchParams.set("uploadType", "resumable");
    initiationUrl.searchParams.set("name", key);
    const initiationResponse = await this.#request(initiationUrl, {
      method: "POST",
      headers: initiationHeaders,
      body: metadataDocument,
    });
    if (!initiationResponse.ok) {
      throw await providerHttpError("upload initiation", initiationResponse);
    }
    const sessionUrl = readResumableSessionUrl(initiationResponse, this.#config.bucket);

    let response: Response;
    let uploadedSize: number;
    if (body instanceof ReadableStream) {
      const upload = await uploadUnknownLengthStream({
        stream: body,
        sessionUrl,
        contentType: mimeType,
        chunkSize: this.#config.resumableChunkSize,
        signal: this.#config.signal,
        request: (input, init) => this.#request(input, init),
        createHttpError: (failedResponse) => providerHttpError("upload", failedResponse),
      });
      response = upload.response;
      uploadedSize = upload.size;
    } else {
      const uploadHeaders = new Headers({
        "content-length": String(contentLength),
        "content-type": mimeType,
      });
      response = await this.#request(sessionUrl, {
        method: "PUT",
        headers: uploadHeaders,
        body: body as BodyInit,
      });
      if (response.status !== 200 && response.status !== 201) {
        throw await providerHttpError("upload", response);
      }
      uploadedSize = contentLength!;
    }
    const object = readGCSObject(await readJson(response, "upload"), "upload");
    if (object.size !== uploadedSize) {
      throw API_ERROR.create({
        detail: "GCSBlobStorage: upload response size did not match the request body",
      });
    }
    return {
      __kind: "blob",
      id,
      size: object.size,
      mimeType: object.contentType,
      createdAt: object.timeCreated,
      expiresAt: expiry,
      metadata,
      url: publicObjectUrl(this.#config.baseUrlObject, key),
    };
  }

  async getStream(id: string): Promise<ReadableStream | null> {
    const url = gcsObjectUrl(this.#config.bucket, this.#key(id));
    url.searchParams.set("alt", "media");
    const response = await this.#request(url, {
      headers: await this.#authorizedHeaders(),
    });
    if (response.status === 404) {
      await this.#verifyObjectMissing(response, "download");
      return null;
    }
    if (!response.ok) throw await providerHttpError("download", response);
    if (!response.body) {
      throw API_ERROR.create({ detail: "GCSBlobStorage: successful download returned no body" });
    }
    return response.body;
  }

  async getText(id: string): Promise<string | null> {
    const stream = await this.getStream(id);
    return stream ? await new Response(stream).text() : null;
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    const stream = await this.getStream(id);
    if (!stream) return null;
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async delete(id: string): Promise<void> {
    const response = await this.#request(gcsObjectUrl(this.#config.bucket, this.#key(id)), {
      method: "DELETE",
      headers: await this.#authorizedHeaders(),
    });
    if (response.status === 404) {
      await this.#verifyObjectMissing(response, "delete");
      return;
    }
    if (!response.ok) throw await providerHttpError("delete", response);
  }

  async exists(id: string): Promise<boolean> {
    const url = gcsObjectUrl(this.#config.bucket, this.#key(id));
    url.searchParams.set("fields", "id");
    const response = await this.#request(url, {
      headers: await this.#authorizedHeaders(),
    });
    if (response.status === 200) return true;
    if (response.status === 404) {
      await this.#verifyObjectMissing(response, "existence check");
      return false;
    }
    throw await providerHttpError("existence check", response);
  }

  async stat(id: string): Promise<BlobRef | null> {
    const key = this.#key(id);
    const response = await this.#request(gcsObjectUrl(this.#config.bucket, key), {
      headers: await this.#authorizedHeaders(),
    });
    if (response.status === 404) {
      await this.#verifyObjectMissing(response, "metadata request");
      return null;
    }
    if (!response.ok) throw await providerHttpError("metadata request", response);
    const object = readGCSObject(
      await readJson(response, "metadata request"),
      "metadata request",
    );
    const rawExpiry = object.metadata[INTERNAL_EXPIRY_METADATA_KEY];
    delete object.metadata[INTERNAL_EXPIRY_METADATA_KEY];
    const expiry = rawExpiry === undefined ? undefined : new Date(rawExpiry);
    if (expiry && !Number.isFinite(expiry.getTime())) {
      throw API_ERROR.create({
        detail: "GCSBlobStorage: metadata response contained an invalid expiry",
      });
    }
    return {
      __kind: "blob",
      id,
      size: object.size,
      mimeType: object.contentType,
      createdAt: object.timeCreated,
      expiresAt: expiry,
      metadata: object.metadata,
      url: publicObjectUrl(this.#config.baseUrlObject, key),
    };
  }
}
