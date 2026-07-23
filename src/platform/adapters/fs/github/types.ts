import { CONFIG_INVALID } from "#veryfront/errors/error-registry/config.ts";

export type { DirectoryEntry } from "../shared-types.ts";

export type {
  GitHubBlobResponse,
  GitHubContentItem,
  GitHubContentsResponse,
  GitHubTreeEntry,
  GitHubTreeResponse,
} from "./schemas/index.ts";

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  ref?: string;
  cache?: {
    enabled?: boolean;
    ttl?: number;
    maxSize?: number;
    maxMemory?: number;
  };
  retry?: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    requestTimeout?: number;
    /** Maximum duration for one high-level GitHub operation, including retries. */
    totalTimeout?: number;
    /** Maximum decoded response body size for one GitHub API response. */
    maxResponseBytes?: number;
  };
}

export interface ResolvedGitHubConfig {
  token: string;
  owner: string;
  repo: string;
  ref: string;
  cache: {
    enabled: boolean;
    ttl: number;
    maxSize: number;
    maxMemory: number;
  };
  retry: {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
    requestTimeout: number;
    totalTimeout: number;
    maxResponseBytes: number;
  };
}

export interface FileInfo {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: Date | null;
}

export interface FileIndexEntry {
  path: string;
  sha: string;
  size: number;
  type: "blob" | "tree";
}

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_CACHE_MAX_ENTRIES = 1_000;
const DEFAULT_CACHE_MAX_MEMORY_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
const MAX_RETRIES = 20;
const MAX_TIMER_MS = 2_147_483_647;
const MAX_CACHE_ENTRIES = 1_000_000;
const MAX_CACHE_MEMORY_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_TOKEN_LENGTH = 4_096;
const MAX_IDENTIFIER_LENGTH = 1_024;

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function invalidConfig(detail: string): never {
  throw CONFIG_INVALID.create({ detail });
}

function assertConfigObject(value: unknown, label: string): asserts value is object {
  if (typeof value !== "object" || value === null) {
    invalidConfig(`${label} must be an object`);
  }

  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    invalidConfig(`${label} is not readable`);
  }
  if (isArray) invalidConfig(`${label} must be an object`);
}

function readConfigProperty(object: object, property: PropertyKey, label: string): unknown {
  try {
    return Reflect.get(object, property);
  } catch {
    invalidConfig(`${label} is not readable`);
  }
}

function readOptionalConfigObject(value: unknown, label: string): object | undefined {
  if (value === undefined) return undefined;
  assertConfigObject(value, label);
  return value;
}

function validateIdentifier(field: "owner" | "repo" | "ref", value: string): string {
  if (
    !value || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value ||
    hasControlCharacters(value)
  ) {
    invalidConfig(
      `GitHub ${field} must be a non-empty value without surrounding whitespace or control characters`,
    );
  }
  return value;
}

function validateRetryCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_RETRIES) {
    invalidConfig(`GitHub retry.maxRetries must be an integer between 0 and ${MAX_RETRIES}`);
  }
  return value;
}

function validateNonNegativeDelay(field: "initialDelay" | "maxDelay", value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMER_MS) {
    invalidConfig(
      `GitHub retry.${field} must be an integer between 0 and ${MAX_TIMER_MS} milliseconds`,
    );
  }
  return value;
}

function validatePositiveTimeout(field: "requestTimeout" | "totalTimeout", value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_MS) {
    invalidConfig(
      `GitHub retry.${field} must be an integer between 1 and ${MAX_TIMER_MS} milliseconds`,
    );
  }
  return value;
}

function validateMaxResponseBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_RESPONSE_BYTES) {
    invalidConfig(
      `GitHub retry.maxResponseBytes must be an integer between 1 and ${MAX_RESPONSE_BYTES} bytes`,
    );
  }
  return value;
}

function validatePositiveCacheValue(
  field: "ttl" | "maxSize" | "maxMemory",
  value: number,
): number {
  const maximum = field === "ttl"
    ? MAX_TIMER_MS
    : field === "maxSize"
    ? MAX_CACHE_ENTRIES
    : MAX_CACHE_MEMORY_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    invalidConfig(`GitHub cache.${field} must be a positive safe integer`);
  }
  return value;
}

export function createGitHubConfig(config: GitHubConfig): ResolvedGitHubConfig {
  assertConfigObject(config, "GitHub configuration");
  const token = readConfigProperty(config, "token", "GitHub configuration");
  const owner = readConfigProperty(config, "owner", "GitHub configuration");
  const repo = readConfigProperty(config, "repo", "GitHub configuration");
  const ref = readConfigProperty(config, "ref", "GitHub configuration");
  const cache = readOptionalConfigObject(
    readConfigProperty(config, "cache", "GitHub configuration"),
    "GitHub cache configuration",
  );
  const retry = readOptionalConfigObject(
    readConfigProperty(config, "retry", "GitHub configuration"),
    "GitHub retry configuration",
  );

  if (
    typeof token !== "string" || !token || token.length > MAX_TOKEN_LENGTH ||
    token.trim() !== token || hasControlCharacters(token)
  ) {
    invalidConfig(
      "GitHub adapter requires a token. Set GITHUB_TOKEN or provide config.github.token",
    );
  }

  if (typeof owner !== "string" || typeof repo !== "string" || !owner || !repo) {
    invalidConfig(
      "GitHub adapter requires owner and repo. Provide them in config or through the corresponding environment variables",
    );
  }

  const retryMaxRetries = retry === undefined
    ? undefined
    : readConfigProperty(retry, "maxRetries", "GitHub retry configuration");
  const retryInitialDelay = retry === undefined
    ? undefined
    : readConfigProperty(retry, "initialDelay", "GitHub retry configuration");
  const retryMaxDelay = retry === undefined
    ? undefined
    : readConfigProperty(retry, "maxDelay", "GitHub retry configuration");
  const retryRequestTimeout = retry === undefined
    ? undefined
    : readConfigProperty(retry, "requestTimeout", "GitHub retry configuration");
  const retryTotalTimeout = retry === undefined
    ? undefined
    : readConfigProperty(retry, "totalTimeout", "GitHub retry configuration");
  const retryMaxResponseBytes = retry === undefined
    ? undefined
    : readConfigProperty(retry, "maxResponseBytes", "GitHub retry configuration");
  const cacheEnabled = cache === undefined
    ? undefined
    : readConfigProperty(cache, "enabled", "GitHub cache configuration");
  const cacheTtlInput = cache === undefined
    ? undefined
    : readConfigProperty(cache, "ttl", "GitHub cache configuration");
  const cacheMaxSizeInput = cache === undefined
    ? undefined
    : readConfigProperty(cache, "maxSize", "GitHub cache configuration");
  const cacheMaxMemoryInput = cache === undefined
    ? undefined
    : readConfigProperty(cache, "maxMemory", "GitHub cache configuration");

  const maxRetries = validateRetryCount(
    (retryMaxRetries ?? DEFAULT_MAX_RETRIES) as number,
  );
  const initialDelay = validateNonNegativeDelay(
    "initialDelay",
    (retryInitialDelay ?? DEFAULT_INITIAL_RETRY_DELAY_MS) as number,
  );
  const maxDelay = validateNonNegativeDelay(
    "maxDelay",
    (retryMaxDelay ?? DEFAULT_MAX_RETRY_DELAY_MS) as number,
  );
  if (maxDelay < initialDelay) {
    invalidConfig("GitHub retry.maxDelay must be greater than or equal to retry.initialDelay");
  }
  const requestTimeout = validatePositiveTimeout(
    "requestTimeout",
    (retryRequestTimeout ?? DEFAULT_REQUEST_TIMEOUT_MS) as number,
  );
  const totalTimeout = validatePositiveTimeout(
    "totalTimeout",
    (retryTotalTimeout ?? DEFAULT_TOTAL_TIMEOUT_MS) as number,
  );
  const maxResponseBytes = validateMaxResponseBytes(
    (retryMaxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES) as number,
  );
  const cacheTtl = validatePositiveCacheValue(
    "ttl",
    (cacheTtlInput ?? DEFAULT_CACHE_TTL_MS) as number,
  );
  const cacheMaxSize = validatePositiveCacheValue(
    "maxSize",
    (cacheMaxSizeInput ?? DEFAULT_CACHE_MAX_ENTRIES) as number,
  );
  const cacheMaxMemory = validatePositiveCacheValue(
    "maxMemory",
    (cacheMaxMemoryInput ?? DEFAULT_CACHE_MAX_MEMORY_BYTES) as number,
  );
  if (cacheEnabled !== undefined && typeof cacheEnabled !== "boolean") {
    invalidConfig("GitHub cache.enabled must be a boolean");
  }

  if (ref !== undefined && typeof ref !== "string") {
    invalidConfig("GitHub ref must be a string");
  }

  return Object.freeze({
    token,
    owner: validateIdentifier("owner", owner),
    repo: validateIdentifier("repo", repo),
    ref: validateIdentifier("ref", ref ?? "main"),
    cache: Object.freeze({
      enabled: cacheEnabled ?? true,
      ttl: cacheTtl,
      maxSize: cacheMaxSize,
      maxMemory: cacheMaxMemory,
    }),
    retry: Object.freeze({
      maxRetries,
      initialDelay,
      maxDelay,
      requestTimeout,
      totalTimeout,
      maxResponseBytes,
    }),
  });
}
