import {
  type BucketLocationConstraint,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadBucketCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  type PutObjectCommandInput,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import {
  API_ERROR,
  CONFIG_INVALID,
  INITIALIZATION_ERROR,
  INVALID_ARGUMENT,
} from "veryfront/errors";
import {
  assertSafeBlobId,
  type BlobRef,
  type BlobStorage,
  type StoreBlobOptions,
} from "veryfront/workflow/blob";
import {
  createS3BlobStorageStreamUploader,
  DEFAULT_MULTIPART_PART_SIZE,
  DEFAULT_MULTIPART_QUEUE_SIZE,
  MAX_MULTIPART_PART_SIZE,
  MAX_MULTIPART_QUEUE_SIZE,
  MIN_MULTIPART_PART_SIZE,
  type S3BlobStorageStreamUploader,
} from "./multipart-upload.ts";

const MAX_OBJECT_KEY_BYTES = 1_024;
const MAX_METADATA_ENTRIES = 100;
const MAX_METADATA_BYTES = 2 * 1_024;
const DEFAULT_MAX_ATTEMPTS = 3;

/** AWS commands issued through the injectable client boundary. */
export type S3BlobStorageCommand =
  | CreateBucketCommand
  | DeleteObjectCommand
  | GetObjectCommand
  | HeadBucketCommand
  | HeadObjectCommand
  | PutObjectCommand;

/** Provider request options required by the storage implementation. */
export interface S3BlobStorageSendOptions {
  abortSignal?: AbortSignal;
}

/** Minimal client boundary used by the storage implementation and deterministic tests. */
export interface S3BlobStorageClient {
  send(
    command: S3BlobStorageCommand,
    options?: S3BlobStorageSendOptions,
  ): Promise<unknown>;
  destroy?(): void;
}

/** Injectable provider seams for deterministic tests and custom transports. */
export interface S3BlobStorageDependencies {
  /** S3-compatible command client. */
  client?: S3BlobStorageClient;
  /** Required for stream uploads when a custom client is supplied. */
  streamUploader?: S3BlobStorageStreamUploader;
}

/** Explicit S3 connection, transport, and object-layout configuration. */
export interface S3BlobStorageConfig {
  /** AWS region used by the client and bucket creation. */
  region: string;
  /** S3 bucket name. */
  bucket: string;
  /** AWS access-key id. */
  accessKeyId: string;
  /** AWS secret access key. */
  secretAccessKey: string;
  /** Optional temporary-credential session token. */
  sessionToken?: string;
  /** Optional S3-compatible endpoint. */
  endpoint?: string;
  /** Force path-style requests for S3-compatible services. */
  forcePathStyle?: boolean;
  /** Maximum attempts, including the initial request. Defaults to three. */
  maxAttempts?: number;
  /** Explicit SDK retry algorithm. Defaults to standard. */
  retryMode?: "standard" | "adaptive";
  /** Use AWS dual-stack endpoints. Defaults to false. */
  useDualstackEndpoint?: boolean;
  /** Use AWS FIPS endpoints. Defaults to false. */
  useFipsEndpoint?: boolean;
  /** Resolve an ARN's region instead of the configured region. Defaults to false. */
  useArnRegion?: boolean;
  /** Request-checksum policy. Defaults to the SDK's deterministic supported policy. */
  requestChecksumCalculation?: "WHEN_SUPPORTED" | "WHEN_REQUIRED";
  /** Response-checksum policy. Defaults to the SDK's deterministic supported policy. */
  responseChecksumValidation?: "WHEN_SUPPORTED" | "WHEN_REQUIRED";
  /** Disable S3 Express session authentication. Defaults to false. */
  disableS3ExpressSessionAuth?: boolean;
  /** Multipart part size for unknown-length streams. Defaults to 8 MiB. */
  multipartPartSize?: number;
  /** Concurrent multipart requests for unknown-length streams. Defaults to two. */
  multipartQueueSize?: number;
  /** Object-key prefix applied verbatim before each blob id. */
  prefix?: string;
  /** Public base URL used only to populate `BlobRef.url`. */
  baseUrl?: string;
  /** Default TTL in seconds. Zero means no expiry. */
  defaultTtl?: number;
  /** Check for and create a missing bucket before the first upload. */
  autoCreateBucket?: boolean;
  /** Cancellation signal applied to provider requests. */
  signal?: AbortSignal;
}

interface NormalizedS3Config extends S3BlobStorageConfig {
  baseUrlObject?: URL;
  multipartPartSize: number;
  multipartQueueSize: number;
}

interface S3RuntimeConfig {
  region: string;
  bucket: string;
  prefix?: string;
  baseUrlObject?: URL;
  defaultTtl?: number;
  autoCreateBucket?: boolean;
  multipartPartSize: number;
  multipartQueueSize: number;
  signal?: AbortSignal;
}

interface DefaultS3Resources {
  readonly client: S3BlobStorageClient;
  readonly streamUploader: S3BlobStorageStreamUploader;
}

interface BucketInitialization {
  readonly promise: Promise<void>;
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
    throw configError(`S3BlobStorage: ${field} must be a non-empty string`);
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

function validateOptionalUrl(value: unknown, field: string): URL | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw configError(`S3BlobStorage: ${field} must be a non-empty HTTP(S) URL`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw configError(`S3BlobStorage: ${field} must be a valid HTTP(S) URL`, cause);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw configError(`S3BlobStorage: ${field} must use HTTP or HTTPS`);
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw configError(
      `S3BlobStorage: ${field} must use HTTPS unless its host is localhost or a loopback IP`,
    );
  }
  if (url.username || url.password) {
    throw configError(`S3BlobStorage: ${field} must not contain credentials`);
  }
  if (url.search || url.hash) {
    throw configError(`S3BlobStorage: ${field} must not contain a query or fragment`);
  }
  return url;
}

function validateTtl(
  value: unknown,
  field: string,
  kind: "config" | "argument",
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    const detail = `S3BlobStorage: ${field} must be a finite non-negative number`;
    throw kind === "config" ? configError(detail) : invalidArgument(detail);
  }
  return value;
}

function normalizeConfig(config: S3BlobStorageConfig): NormalizedS3Config {
  if (!config || typeof config !== "object") {
    throw configError("S3BlobStorage: configuration is required");
  }
  const region = requireNonEmptyString(config.region, "region");
  const bucket = requireNonEmptyString(config.bucket, "bucket");
  const accessKeyId = requireNonEmptyString(config.accessKeyId, "accessKeyId");
  const secretAccessKey = requireNonEmptyString(config.secretAccessKey, "secretAccessKey");
  const endpointObject = validateOptionalUrl(config.endpoint, "endpoint");
  const baseUrlObject = validateOptionalUrl(config.baseUrl, "baseUrl");
  const defaultTtl = validateTtl(config.defaultTtl, "defaultTtl", "config");

  if (
    config.sessionToken !== undefined &&
    (typeof config.sessionToken !== "string" || config.sessionToken.length === 0)
  ) {
    throw configError("S3BlobStorage: sessionToken must be a non-empty string");
  }
  if (config.prefix !== undefined && typeof config.prefix !== "string") {
    throw configError("S3BlobStorage: prefix must be a string");
  }
  if (config.forcePathStyle !== undefined && typeof config.forcePathStyle !== "boolean") {
    throw configError("S3BlobStorage: forcePathStyle must be a boolean");
  }
  if (
    config.maxAttempts !== undefined &&
    (!Number.isSafeInteger(config.maxAttempts) || config.maxAttempts < 1 || config.maxAttempts > 20)
  ) {
    throw configError("S3BlobStorage: maxAttempts must be an integer between 1 and 20");
  }
  if (
    config.retryMode !== undefined && config.retryMode !== "standard" &&
    config.retryMode !== "adaptive"
  ) {
    throw configError("S3BlobStorage: retryMode must be standard or adaptive");
  }
  for (
    const [field, value] of [
      ["useDualstackEndpoint", config.useDualstackEndpoint],
      ["useFipsEndpoint", config.useFipsEndpoint],
      ["useArnRegion", config.useArnRegion],
      ["disableS3ExpressSessionAuth", config.disableS3ExpressSessionAuth],
    ] as const
  ) {
    if (value !== undefined && typeof value !== "boolean") {
      throw configError(`S3BlobStorage: ${field} must be a boolean`);
    }
  }
  const checksumPolicies = ["WHEN_SUPPORTED", "WHEN_REQUIRED"] as const;
  if (
    config.requestChecksumCalculation !== undefined &&
    !checksumPolicies.includes(config.requestChecksumCalculation)
  ) {
    throw configError(
      "S3BlobStorage: requestChecksumCalculation must be WHEN_SUPPORTED or WHEN_REQUIRED",
    );
  }
  if (
    config.responseChecksumValidation !== undefined &&
    !checksumPolicies.includes(config.responseChecksumValidation)
  ) {
    throw configError(
      "S3BlobStorage: responseChecksumValidation must be WHEN_SUPPORTED or WHEN_REQUIRED",
    );
  }
  if (config.autoCreateBucket !== undefined && typeof config.autoCreateBucket !== "boolean") {
    throw configError("S3BlobStorage: autoCreateBucket must be a boolean");
  }
  if (
    config.multipartPartSize !== undefined &&
    (!Number.isSafeInteger(config.multipartPartSize) ||
      config.multipartPartSize < MIN_MULTIPART_PART_SIZE ||
      config.multipartPartSize > MAX_MULTIPART_PART_SIZE)
  ) {
    throw configError(
      `S3BlobStorage: multipartPartSize must be an integer between ${MIN_MULTIPART_PART_SIZE} and ${MAX_MULTIPART_PART_SIZE} bytes`,
    );
  }
  if (
    config.multipartQueueSize !== undefined &&
    (!Number.isSafeInteger(config.multipartQueueSize) || config.multipartQueueSize < 1 ||
      config.multipartQueueSize > MAX_MULTIPART_QUEUE_SIZE)
  ) {
    throw configError(
      `S3BlobStorage: multipartQueueSize must be an integer between 1 and ${MAX_MULTIPART_QUEUE_SIZE}`,
    );
  }
  if (config.signal !== undefined && !(config.signal instanceof AbortSignal)) {
    throw configError("S3BlobStorage: signal must be an AbortSignal");
  }

  return {
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    ...(config.sessionToken === undefined ? {} : { sessionToken: config.sessionToken }),
    ...(endpointObject === undefined ? {} : { endpoint: endpointObject.href }),
    ...(config.forcePathStyle === undefined ? {} : { forcePathStyle: config.forcePathStyle }),
    maxAttempts: config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    retryMode: config.retryMode ?? "standard",
    useDualstackEndpoint: config.useDualstackEndpoint ?? false,
    useFipsEndpoint: config.useFipsEndpoint ?? false,
    useArnRegion: config.useArnRegion ?? false,
    requestChecksumCalculation: config.requestChecksumCalculation ?? "WHEN_SUPPORTED",
    responseChecksumValidation: config.responseChecksumValidation ?? "WHEN_SUPPORTED",
    disableS3ExpressSessionAuth: config.disableS3ExpressSessionAuth ?? false,
    multipartPartSize: config.multipartPartSize ?? DEFAULT_MULTIPART_PART_SIZE,
    multipartQueueSize: config.multipartQueueSize ?? DEFAULT_MULTIPART_QUEUE_SIZE,
    ...(config.prefix === undefined ? {} : { prefix: config.prefix }),
    ...(baseUrlObject === undefined ? {} : { baseUrl: baseUrlObject.href, baseUrlObject }),
    ...(defaultTtl === undefined ? {} : { defaultTtl }),
    ...(config.autoCreateBucket === undefined ? {} : { autoCreateBucket: config.autoCreateBucket }),
    ...(config.signal === undefined ? {} : { signal: config.signal }),
  };
}

function validateDependencies(
  dependencies: S3BlobStorageDependencies,
): S3BlobStorageDependencies {
  if (!dependencies || typeof dependencies !== "object") {
    throw invalidArgument("S3BlobStorage: dependencies must be an object");
  }
  if (
    dependencies.client !== undefined &&
    (!dependencies.client || typeof dependencies.client !== "object" ||
      typeof dependencies.client.send !== "function" ||
      (dependencies.client.destroy !== undefined &&
        typeof dependencies.client.destroy !== "function"))
  ) {
    throw invalidArgument("S3BlobStorage: dependencies.client must implement send()");
  }
  if (
    dependencies.streamUploader !== undefined &&
    (!dependencies.streamUploader || typeof dependencies.streamUploader !== "object" ||
      typeof dependencies.streamUploader.upload !== "function")
  ) {
    throw invalidArgument("S3BlobStorage: dependencies.streamUploader must implement upload()");
  }
  return dependencies;
}

function createDefaultResources(config: NormalizedS3Config): DefaultS3Resources {
  const client = new S3Client({
    // Populate every SDK setting that otherwise resolves from process env or
    // shared AWS config files. This extension accepts only explicit config.
    authSchemePreference: [],
    defaultsMode: "standard",
    defaultUserAgentProvider: async () => [
      ["aws-sdk-js"],
      ["lang/js"],
      ["app/veryfront-ext-blob-s3", "0.1.0"],
    ],
    disableClockSkewCorrection: false,
    disableS3ExpressSessionAuth: config.disableS3ExpressSessionAuth,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      ...(config.sessionToken === undefined ? {} : { sessionToken: config.sessionToken }),
    },
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    maxAttempts: config.maxAttempts,
    requestChecksumCalculation: config.requestChecksumCalculation,
    responseChecksumValidation: config.responseChecksumValidation,
    retryMode: config.retryMode,
    sigv4aSigningRegionSet: [config.region],
    useArnRegion: config.useArnRegion,
    useDualstackEndpoint: config.useDualstackEndpoint,
    useFipsEndpoint: config.useFipsEndpoint,
    userAgentAppId: "veryfront-ext-blob-s3",
  });
  const send = client.send.bind(client) as S3BlobStorageClient["send"];
  return {
    client: {
      send,
      destroy: () => client.destroy(),
    },
    streamUploader: createS3BlobStorageStreamUploader(client),
  };
}

function errorName(error: unknown): string | undefined {
  try {
    if (!error || typeof error !== "object") return undefined;
    const name = (error as { name?: unknown }).name;
    return typeof name === "string" ? name : undefined;
  } catch {
    return undefined;
  }
}

function errorStatus(error: unknown): number | undefined {
  try {
    if (!error || typeof error !== "object") return undefined;
    const metadata = (error as { $metadata?: unknown }).$metadata;
    if (!metadata || typeof metadata !== "object") return undefined;
    const status = (metadata as { httpStatusCode?: unknown }).httpStatusCode;
    return typeof status === "number" ? status : undefined;
  } catch {
    return undefined;
  }
}

function isBucketNotFound(error: unknown): boolean {
  const name = errorName(error);
  return name === "NoSuchBucket" || name === "NotFound" ||
    errorStatus(error) === 404;
}

function isObjectNotFound(error: unknown): boolean {
  return errorName(error) === "NoSuchKey";
}

function isAmbiguousObjectNotFound(error: unknown): boolean {
  const name = errorName(error);
  return name === "NotFound" || errorStatus(error) === 404;
}

function isOwnedBucket(error: unknown): boolean {
  return errorName(error) === "BucketAlreadyOwnedByYou";
}

function validateObjectKey(key: string): void {
  const byteLength = new TextEncoder().encode(key).byteLength;
  if (byteLength === 0 || byteLength > MAX_OBJECT_KEY_BYTES) {
    throw invalidArgument(
      `S3BlobStorage: object key must contain between 1 and ${MAX_OBJECT_KEY_BYTES} UTF-8 bytes`,
    );
  }
  if (key === "." || key === "..") {
    throw invalidArgument("S3BlobStorage: dot-only object keys cannot produce a stable public URL");
  }
}

function snapshotMetadata(value: StoreBlobOptions["metadata"]): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  let entries: [string, unknown][];
  try {
    entries = Object.entries(value);
  } catch (cause) {
    throw invalidArgument("S3BlobStorage: metadata must be a readable string record", cause);
  }
  if (entries.length > MAX_METADATA_ENTRIES) {
    throw invalidArgument(
      `S3BlobStorage: metadata must contain at most ${MAX_METADATA_ENTRIES} entries`,
    );
  }
  const metadata: Record<string, string> = Object.create(null);
  const normalizedKeys = new Set<string>();
  let bytes = 0;
  for (const [key, entry] of entries) {
    const normalizedKey = key.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(normalizedKey)) {
      throw invalidArgument(
        `S3BlobStorage: metadata key ${JSON.stringify(key)} is not HTTP-header safe`,
      );
    }
    if (normalizedKeys.has(normalizedKey)) {
      throw invalidArgument(
        `S3BlobStorage: metadata keys must be unique ignoring case (${JSON.stringify(key)})`,
      );
    }
    normalizedKeys.add(normalizedKey);
    if (typeof entry !== "string" || /[\r\n\0]/.test(entry)) {
      throw invalidArgument(
        `S3BlobStorage: metadata value for ${JSON.stringify(key)} must be a header-safe string`,
      );
    }
    bytes += new TextEncoder().encode(normalizedKey).byteLength +
      new TextEncoder().encode(entry).byteLength;
    if (bytes > MAX_METADATA_BYTES) {
      throw invalidArgument(
        `S3BlobStorage: metadata must not exceed ${MAX_METADATA_BYTES} UTF-8 bytes`,
      );
    }
    metadata[normalizedKey] = entry;
  }
  return metadata;
}

function readProviderMetadata(value: unknown): Record<string, string> {
  if (value === undefined) return Object.create(null) as Record<string, string>;
  let entries: [string, unknown][];
  try {
    entries = Object.entries(value as object);
  } catch (cause) {
    throw API_ERROR.create({
      detail: "S3BlobStorage: provider returned unreadable metadata",
      cause,
    });
  }
  if (entries.length > MAX_METADATA_ENTRIES) {
    throw API_ERROR.create({
      detail: "S3BlobStorage: provider returned too many metadata entries",
    });
  }
  const metadata: Record<string, string> = Object.create(null);
  let bytes = 0;
  for (const [key, entry] of entries) {
    const normalizedKey = key.toLowerCase();
    if (
      !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(normalizedKey) ||
      typeof entry !== "string" || /[\r\n\0]/.test(entry)
    ) {
      throw API_ERROR.create({ detail: "S3BlobStorage: provider returned invalid metadata" });
    }
    if (Object.hasOwn(metadata, normalizedKey)) {
      throw API_ERROR.create({
        detail: "S3BlobStorage: provider returned colliding metadata keys",
      });
    }
    bytes += new TextEncoder().encode(normalizedKey).byteLength +
      new TextEncoder().encode(entry).byteLength;
    if (bytes > MAX_METADATA_BYTES) {
      throw API_ERROR.create({ detail: "S3BlobStorage: provider returned oversized metadata" });
    }
    metadata[normalizedKey] = entry;
  }
  return metadata;
}

function validateMimeType(value: unknown): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 1_024 ||
    hasAsciiControlCharacter(value)
  ) {
    throw invalidArgument("S3BlobStorage: mimeType must be a non-empty header-safe string");
  }
  return value;
}

function expiresAt(createdAt: Date, ttl: number | undefined): Date | undefined {
  if (ttl === undefined || ttl === 0) return undefined;
  const milliseconds = createdAt.getTime() + ttl * 1_000;
  if (!Number.isFinite(milliseconds)) {
    throw invalidArgument("S3BlobStorage: ttl produces an invalid expiry time");
  }
  return new Date(milliseconds);
}

function publicObjectUrl(baseUrl: URL | undefined, key: string): string | undefined {
  if (!baseUrl) return undefined;
  const base = new URL(baseUrl.href);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return `${base.href}${encodeURIComponent(key)}`;
}

function toNodeReadable(stream: ReadableStream): Readable {
  // The npm AWS SDK selects its Node transport in Deno, Bun, and Node. Convert
  // the framework's web-stream contract at this extension boundary.
  return Readable.fromWeb(
    stream as Parameters<typeof Readable.fromWeb>[0],
    { objectMode: false },
  );
}

/** AWS S3 implementation of the framework-owned `BlobStorage` interface. */
export class S3BlobStorage implements BlobStorage {
  readonly #config: S3RuntimeConfig;
  readonly #client: S3BlobStorageClient;
  readonly #streamUploader: S3BlobStorageStreamUploader | undefined;
  readonly #lifecycleController = new AbortController();
  readonly #detachConfigAbort: () => void;
  #bucketReady: BucketInitialization | undefined;
  #clientDestroyed = false;
  #closed = false;

  constructor(config: S3BlobStorageConfig, dependencies: S3BlobStorageDependencies = {}) {
    const normalized = normalizeConfig(config);
    const validatedDependencies = validateDependencies(dependencies);
    const defaults = validatedDependencies.client === undefined
      ? createDefaultResources(normalized)
      : undefined;
    this.#client = validatedDependencies.client ?? defaults!.client;
    this.#streamUploader = validatedDependencies.streamUploader ?? defaults?.streamUploader;
    this.#detachConfigAbort = linkAbortSignal(
      normalized.signal,
      this.#lifecycleController,
      "The S3 blob-storage configuration was revoked.",
    );
    this.#config = {
      region: normalized.region,
      bucket: normalized.bucket,
      ...(normalized.prefix === undefined ? {} : { prefix: normalized.prefix }),
      ...(normalized.baseUrlObject === undefined
        ? {}
        : { baseUrlObject: normalized.baseUrlObject }),
      ...(normalized.defaultTtl === undefined ? {} : { defaultTtl: normalized.defaultTtl }),
      ...(normalized.autoCreateBucket === undefined
        ? {}
        : { autoCreateBucket: normalized.autoCreateBucket }),
      multipartPartSize: normalized.multipartPartSize,
      multipartQueueSize: normalized.multipartQueueSize,
      signal: this.#lifecycleController.signal,
    };
  }

  close(): void {
    if (!this.#closed) {
      this.#closed = true;
      this.#detachConfigAbort();
      if (!this.#lifecycleController.signal.aborted) {
        this.#lifecycleController.abort(
          new DOMException("S3 blob storage is closing.", "AbortError"),
        );
      }
    }
    if (this.#clientDestroyed) return;
    this.#client.destroy?.();
    this.#clientDestroyed = true;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw INITIALIZATION_ERROR.create({ detail: "S3BlobStorage is closed" });
    }
  }

  #send(command: S3BlobStorageCommand): Promise<unknown> {
    this.#assertOpen();
    this.#config.signal?.throwIfAborted();
    return this.#client.send(
      command,
      this.#config.signal ? { abortSignal: this.#config.signal } : undefined,
    );
  }

  #key(id: string): string {
    this.#assertOpen();
    assertSafeBlobId(id);
    const key = `${this.#config.prefix ?? ""}${id}`;
    validateObjectKey(key);
    return key;
  }

  async #isMissingObject(error: unknown): Promise<boolean> {
    if (isObjectNotFound(error)) return true;
    if (errorName(error) === "NoSuchBucket") throw error;
    if (!isAmbiguousObjectNotFound(error)) return false;

    // S3 uses an ambiguous 404/NotFound for HeadObject. Verify that the bucket
    // still exists before reducing the failure to the BlobStorage null/false
    // contract; otherwise a configuration or availability failure is hidden.
    await this.#send(new HeadBucketCommand({ Bucket: this.#config.bucket }));
    return true;
  }

  async #initializeBucket(): Promise<void> {
    try {
      await this.#send(new HeadBucketCommand({ Bucket: this.#config.bucket }));
      return;
    } catch (error) {
      if (!isBucketNotFound(error)) throw error;
    }

    try {
      await this.#send(
        new CreateBucketCommand({
          Bucket: this.#config.bucket,
          CreateBucketConfiguration: this.#config.region === "us-east-1" ? undefined : {
            LocationConstraint: this.#config.region as BucketLocationConstraint,
          },
        }),
      );
    } catch (error) {
      if (!isOwnedBucket(error)) throw error;
    }
  }

  async #ensureBucket(): Promise<void> {
    if (!this.#config.autoCreateBucket) return;
    if (!this.#bucketReady) {
      const initialization: BucketInitialization = {
        promise: this.#initializeBucket(),
      };
      this.#bucketReady = initialization;
      try {
        await initialization.promise;
      } catch (error) {
        if (this.#bucketReady === initialization) this.#bucketReady = undefined;
        throw error;
      }
      return;
    }
    await this.#bucketReady.promise;
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
    const createdAt = new Date();
    const expiry = expiresAt(createdAt, ttl);

    let body: Uint8Array | Readable | undefined;
    let stream: ReadableStream | undefined;
    let contentLength: number | undefined;
    if (typeof data === "string") {
      body = new TextEncoder().encode(data);
      contentLength = body.byteLength;
    } else if (data instanceof Uint8Array) {
      body = data;
      contentLength = data.byteLength;
    } else if (data instanceof Blob) {
      body = toNodeReadable(data.stream());
      contentLength = data.size;
    } else if (data instanceof ReadableStream) {
      if (data.locked) {
        throw invalidArgument("S3BlobStorage: upload stream must be unlocked");
      }
      stream = data;
    } else {
      throw invalidArgument("Unsupported data type for S3BlobStorage");
    }

    const streamUploader = stream === undefined ? undefined : this.#streamUploader;
    if (stream !== undefined && streamUploader === undefined) {
      throw INITIALIZATION_ERROR.create({
        detail:
          "S3BlobStorage: streamUploader is required for ReadableStream uploads when using a custom client",
      });
    }

    await this.#ensureBucket();

    let size: number;
    if (stream !== undefined) {
      size = await streamUploader!.upload({
        bucket: this.#config.bucket,
        key,
        stream,
        mimeType,
        expiresAt: expiry,
        metadata,
        partSize: this.#config.multipartPartSize,
        queueSize: this.#config.multipartQueueSize,
        signal: this.#config.signal,
      });
    } else {
      const input: PutObjectCommandInput = {
        Bucket: this.#config.bucket,
        Key: key,
        Body: body as PutObjectCommandInput["Body"],
        ContentType: mimeType,
        ContentLength: contentLength,
        Expires: expiry,
        Metadata: metadata,
      };
      await this.#send(new PutObjectCommand(input));
      size = contentLength!;
    }
    if (!Number.isSafeInteger(size) || size < 0) {
      throw API_ERROR.create({
        detail: "S3BlobStorage: stream uploader returned an invalid object size",
      });
    }

    return {
      __kind: "blob",
      id,
      size,
      mimeType,
      createdAt,
      expiresAt: expiry,
      metadata,
      url: publicObjectUrl(this.#config.baseUrlObject, key),
    };
  }

  async getStream(id: string): Promise<ReadableStream | null> {
    const key = this.#key(id);
    let output: GetObjectCommandOutput;
    try {
      output = await this.#send(
        new GetObjectCommand({
          Bucket: this.#config.bucket,
          Key: key,
        }),
      ) as GetObjectCommandOutput;
    } catch (error) {
      if (await this.#isMissingObject(error)) return null;
      throw error;
    }
    if (!output.Body) {
      throw API_ERROR.create({ detail: "S3BlobStorage: successful download returned no body" });
    }
    if (typeof output.Body.transformToWebStream !== "function") {
      throw API_ERROR.create({
        detail: "S3BlobStorage: provider returned an invalid download body",
      });
    }
    const stream = output.Body.transformToWebStream();
    if (!(stream instanceof ReadableStream)) {
      throw API_ERROR.create({
        detail: "S3BlobStorage: provider returned an invalid download stream",
      });
    }
    return stream;
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
    await this.#send(
      new DeleteObjectCommand({
        Bucket: this.#config.bucket,
        Key: this.#key(id),
      }),
    );
  }

  async exists(id: string): Promise<boolean> {
    try {
      await this.#send(
        new HeadObjectCommand({
          Bucket: this.#config.bucket,
          Key: this.#key(id),
        }),
      );
      return true;
    } catch (error) {
      if (await this.#isMissingObject(error)) return false;
      throw error;
    }
  }

  async stat(id: string): Promise<BlobRef | null> {
    const key = this.#key(id);
    let output: HeadObjectCommandOutput;
    try {
      output = await this.#send(
        new HeadObjectCommand({
          Bucket: this.#config.bucket,
          Key: key,
        }),
      ) as HeadObjectCommandOutput;
    } catch (error) {
      if (await this.#isMissingObject(error)) return null;
      throw error;
    }
    if (!(output.LastModified instanceof Date) || !Number.isFinite(output.LastModified.getTime())) {
      throw API_ERROR.create({
        detail: "S3BlobStorage: successful metadata response omitted LastModified",
      });
    }
    const metadata = readProviderMetadata(output.Metadata);
    const expiry = output.Expires === undefined ? undefined : new Date(output.Expires);
    if (expiry && !Number.isFinite(expiry.getTime())) {
      throw API_ERROR.create({ detail: "S3BlobStorage: provider returned an invalid expiry" });
    }
    const size = output.ContentLength;
    if (size === undefined || !Number.isSafeInteger(size) || size < 0) {
      throw API_ERROR.create({ detail: "S3BlobStorage: provider returned an invalid object size" });
    }

    const mimeType = output.ContentType ?? "application/octet-stream";
    if (
      typeof mimeType !== "string" || mimeType.length === 0 || mimeType.length > 1_024 ||
      hasAsciiControlCharacter(mimeType)
    ) {
      throw API_ERROR.create({
        detail: "S3BlobStorage: provider returned an invalid content type",
      });
    }

    return {
      __kind: "blob",
      id,
      size,
      mimeType,
      createdAt: output.LastModified,
      expiresAt: expiry,
      metadata,
      url: publicObjectUrl(this.#config.baseUrlObject, key),
    };
  }
}
