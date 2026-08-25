import {
  guardedExactHttpLoopbackOutboundFetch,
  guardedOutboundFetch,
} from "#veryfront/security/http/outbound-fetch.ts";

const MAX_ISSUER_LENGTH = 2_048;
const MAX_METADATA_BYTES = 256 * 1024;
const MAX_METADATA_FIELDS = 64;
const MAX_METADATA_STRING_LENGTH = 4_096;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_SECONDS = 600;
const MAX_CACHE_TTL_SECONDS = 2_592_000;
const DEFAULT_CACHE_ENTRIES = 64;
const MAX_CACHE_ENTRIES = 64;

export interface OidcMetadata {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
}

export interface FetchOidcMetadataOptions {
  readonly issuer: string;
  readonly trustedEndpointOrigins?: readonly string[];
  readonly allowInsecureLoopback?: boolean;
  readonly timeoutMs?: number;
}

export interface OidcMetadataCacheOptions {
  readonly ttlSeconds?: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
}

export interface OidcMetadataCache {
  get(options: FetchOidcMetadataOptions): Promise<OidcMetadata>;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly value?: OidcMetadata;
  readonly pending?: Promise<OidcMetadata>;
}

interface ParsedIssuer {
  readonly issuer: string;
  readonly url: URL;
  readonly allowHttpIssuerOrigin: boolean;
}

type JsonObject = { readonly [key: string]: unknown };

export async function fetchOidcMetadata(
  options: FetchOidcMetadataOptions,
): Promise<OidcMetadata> {
  const issuer = parseConfiguredIssuer(options.issuer, options.allowInsecureLoopback === true);
  const trustedOrigins = parseTrustedEndpointOrigins(options.trustedEndpointOrigins ?? []);
  const discoveryUrl = new URL(
    `${
      issuer.issuer.endsWith("/") ? issuer.issuer.slice(0, -1) : issuer.issuer
    }/.well-known/openid-configuration`,
  );
  validateFetchUrl(discoveryUrl, issuer, trustedOrigins);
  const parsed = await fetchJsonObject({
    url: discoveryUrl,
    maxBytes: MAX_METADATA_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    allowExactHttpLoopbackEgress: issuer.allowHttpIssuerOrigin,
    authorizeUrl(url) {
      validateFetchUrl(url, issuer, trustedOrigins);
    },
    kind: "OIDC discovery",
  });
  return parseOidcMetadata(parsed, issuer, trustedOrigins);
}

export function createOidcMetadataCache(
  options: OidcMetadataCacheOptions = {},
): OidcMetadataCache {
  const ttlMs = parseCacheTtlMs(options.ttlSeconds);
  const maxEntries = parseMaxEntries(options.maxEntries);
  const now = options.now ?? (() => performance.now());
  const entries = new Map<string, CacheEntry>();

  function evictIfNeeded(): void {
    while (entries.size > maxEntries) {
      const oldestSettled = [...entries.entries()].find(([, entry]) => entry.pending === undefined);
      if (oldestSettled === undefined) return;
      entries.delete(oldestSettled[0]);
    }
  }

  return Object.freeze({
    get(fetchOptions: FetchOidcMetadataOptions): Promise<OidcMetadata> {
      const key = cacheKey(fetchOptions);
      const current = entries.get(key);
      const currentTime = now();
      if (current?.value !== undefined && current.expiresAt > currentTime) {
        entries.delete(key);
        entries.set(key, current);
        return Promise.resolve(current.value);
      }
      if (current?.pending !== undefined) {
        return current.pending;
      }

      const pending = fetchOidcMetadata(fetchOptions).then((value) => {
        entries.set(key, { value, expiresAt: now() + ttlMs });
        evictIfNeeded();
        return value;
      }).catch((error) => {
        if (entries.get(key)?.pending === pending) {
          entries.delete(key);
        }
        throw error;
      });
      entries.set(key, { pending, expiresAt: currentTime + ttlMs });
      evictIfNeeded();
      return pending;
    },
  });
}

function cacheKey(options: FetchOidcMetadataOptions): string {
  return JSON.stringify({
    issuer: options.issuer,
    trustedEndpointOrigins: [...(options.trustedEndpointOrigins ?? [])].sort(),
    allowInsecureLoopback: options.allowInsecureLoopback === true,
    timeoutMs: options.timeoutMs,
  });
}

function parseOidcMetadata(
  value: JsonObject,
  issuer: ParsedIssuer,
  trustedOrigins: ReadonlySet<string>,
): OidcMetadata {
  const keys = Object.keys(value);
  if (keys.length > MAX_METADATA_FIELDS) {
    throw new TypeError("OIDC discovery metadata exceeds the top-level field limit");
  }
  for (const key of keys) {
    const entry = value[key];
    if (typeof entry === "string" && entry.length > MAX_METADATA_STRING_LENGTH) {
      throw new TypeError("OIDC discovery metadata contains a string over the size limit");
    }
  }

  const discoveredIssuer = readRequiredString(value, "issuer");
  if (discoveredIssuer !== issuer.issuer) {
    throw new TypeError("OIDC discovery issuer must exactly match the configured issuer");
  }

  return Object.freeze({
    issuer: discoveredIssuer,
    authorizationEndpoint: parseMetadataEndpoint(
      readRequiredString(value, "authorization_endpoint"),
      "authorization_endpoint",
      issuer,
      trustedOrigins,
    ),
    tokenEndpoint: parseMetadataEndpoint(
      readRequiredString(value, "token_endpoint"),
      "token_endpoint",
      issuer,
      trustedOrigins,
    ),
    jwksUri: parseMetadataEndpoint(
      readRequiredString(value, "jwks_uri"),
      "jwks_uri",
      issuer,
      trustedOrigins,
    ),
  });
}

function readRequiredString(value: JsonObject, key: string): string {
  const entry = value[key];
  if (typeof entry !== "string" || entry.length === 0) {
    throw new TypeError(`OIDC discovery ${key} must be a non-empty string`);
  }
  if (entry.length > MAX_METADATA_STRING_LENGTH) {
    throw new TypeError(`OIDC discovery ${key} exceeds the string size limit`);
  }
  return entry;
}

function parseMetadataEndpoint(
  value: string,
  field: string,
  issuer: ParsedIssuer,
  trustedOrigins: ReadonlySet<string>,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`OIDC discovery ${field} must be an absolute URL`);
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new TypeError(`OIDC discovery ${field} must not include URL credentials`);
  }
  if (url.hash.length > 0) {
    throw new TypeError(`OIDC discovery ${field} must not include a fragment`);
  }
  validateEndpointUrl(url, issuer, trustedOrigins, `OIDC discovery ${field}`);
  return url.href;
}

function parseConfiguredIssuer(value: string, allowInsecureLoopback: boolean): ParsedIssuer {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ISSUER_LENGTH) {
    throw new TypeError("OIDC issuer must be a bounded non-empty string");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("OIDC issuer must be an absolute URL");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new TypeError("OIDC issuer must not include URL credentials");
  }
  if (url.search.length > 0) {
    throw new TypeError("OIDC issuer must not include a query");
  }
  if (url.hash.length > 0) {
    throw new TypeError("OIDC issuer must not include a fragment");
  }
  if (url.protocol === "https:") {
    return { issuer: value, url, allowHttpIssuerOrigin: false };
  }
  if (url.protocol === "http:" && allowInsecureLoopback && isLoopbackHostname(url.hostname)) {
    return { issuer: value, url, allowHttpIssuerOrigin: true };
  }
  if (url.protocol === "http:") {
    throw new TypeError(
      "OIDC issuer must use HTTPS unless explicit loopback development is allowed",
    );
  }
  throw new TypeError("OIDC issuer must use HTTPS");
}

function parseTrustedEndpointOrigins(values: readonly string[]): ReadonlySet<string> {
  if (values.length > MAX_CACHE_ENTRIES) {
    throw new TypeError("OIDC trusted endpoint origins must contain at most 64 origins");
  }
  const origins = new Set<string>();
  for (const value of values) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new TypeError("OIDC trusted endpoint origins must be canonical HTTPS origins");
    }
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.pathname !== "/" ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      value !== url.origin
    ) {
      throw new TypeError("OIDC trusted endpoint origins must be canonical HTTPS origins");
    }
    if (origins.has(url.origin)) {
      throw new TypeError("OIDC trusted endpoint origins must not contain duplicates");
    }
    origins.add(url.origin);
  }
  return origins;
}

function validateFetchUrl(
  url: URL,
  issuer: ParsedIssuer,
  trustedOrigins: ReadonlySet<string>,
): void {
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new TypeError("OIDC discovery URL must not include a query or fragment");
  }
  validateEndpointUrl(url, issuer, trustedOrigins, "OIDC discovery URL");
}

function validateEndpointUrl(
  url: URL,
  issuer: ParsedIssuer,
  trustedOrigins: ReadonlySet<string>,
  label: string,
): void {
  if (url.origin === issuer.url.origin) {
    if (url.protocol === "https:" || (url.protocol === "http:" && issuer.allowHttpIssuerOrigin)) {
      return;
    }
  }
  if (url.protocol === "https:" && trustedOrigins.has(url.origin)) {
    return;
  }
  throw new TypeError(`${label} must use the issuer origin or a trusted HTTPS endpoint origin`);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" ||
    hostname === "::1";
}

function parseCacheTtlMs(value: number | undefined): number {
  const ttl = value ?? DEFAULT_CACHE_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_CACHE_TTL_SECONDS) {
    throw new TypeError("OIDC metadata cache TTL must be 1 through 2592000 seconds");
  }
  return ttl * 1_000;
}

function parseMaxEntries(value: number | undefined): number {
  const maxEntries = value ?? DEFAULT_CACHE_ENTRIES;
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_CACHE_ENTRIES) {
    throw new TypeError("OIDC metadata cache entry count must be 1 through 64");
  }
  return maxEntries;
}

export interface FetchJsonObjectOptions {
  readonly url: URL;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly allowExactHttpLoopbackEgress?: boolean;
  readonly authorizeUrl: (url: URL) => void;
  readonly kind: string;
}

export async function fetchJsonObject(options: FetchJsonObjectOptions): Promise<JsonObject> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const fetcher = options.allowExactHttpLoopbackEgress === true &&
        isLoopbackHttpUrl(options.url)
      ? guardedExactHttpLoopbackOutboundFetch
      : guardedOutboundFetch;
    const response = await fetcher(
      options.url,
      {
        headers: { accept: "application/json" },
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
      },
      {
        authorizeUrl: options.authorizeUrl,
      },
    );
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new TypeError(`${options.kind} request refused a redirect response`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new TypeError(`${options.kind} request failed with HTTP ${response.status}`);
    }
    if (!isJsonContentType(response.headers.get("content-type"))) {
      await response.body?.cancel();
      throw new TypeError(`${options.kind} response must be JSON`);
    }
    const text = await readBoundedText(response, options.maxBytes, options.kind, controller.signal);
    return parseStrictJsonObject(text, `${options.kind} response`);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new TypeError(`${options.kind} request timed out`, { cause: error });
    }
    if (error instanceof Error && error.message.toLowerCase().includes("redirect")) {
      throw new TypeError(`${options.kind} request refused a redirect response`, { cause: error });
    }
    if (error instanceof TypeError) {
      throw error;
    }
    throw new TypeError(`${options.kind} request failed`, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" ||
    (mediaType.startsWith("application/") && mediaType.endsWith("+json"));
}

function isLoopbackHttpUrl(url: URL): boolean {
  return url.protocol === "http:" && isLoopbackHostname(url.hostname);
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  kind: string,
  signal: AbortSignal,
): Promise<string> {
  const body = response.body;
  if (body === null) {
    return "";
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await readWithAbort(reader, signal);
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new TypeError(`${kind} response exceeds the size limit`);
      }
      chunks.push(result.value);
    }
  } catch (error) {
    if (signal.aborted) {
      await reader.cancel();
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
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      void reader.cancel();
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    reader.read().then(
      (result) => {
        signal.removeEventListener("abort", abort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export function parseStrictJsonObject(text: string, kind: string): JsonObject {
  rejectDuplicateJsonObjectKeys(text, kind);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new TypeError(`${kind} must contain valid JSON`, { cause: error });
  }
  if (!isPlainObject(parsed)) {
    throw new TypeError(`${kind} must be a plain JSON object`);
  }
  rejectReservedJsonKeys(parsed, kind);
  return parsed;
}

function rejectDuplicateJsonObjectKeys(text: string, kind: string): void {
  const parser = new JsonDuplicateKeyParser(text, kind);
  parser.parse();
}

export function isPlainObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rejectReservedJsonKeys(value: unknown, kind: string): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      rejectReservedJsonKeys(entry, kind);
    }
    return;
  }
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new TypeError(`${kind} contains a reserved JSON object key`);
    }
    rejectReservedJsonKeys(value[key], kind);
  }
}

class JsonDuplicateKeyParser {
  #index = 0;

  constructor(
    private readonly text: string,
    private readonly kind: string,
  ) {}

  parse(): void {
    this.#skipWhitespace();
    this.#parseValue();
    this.#skipWhitespace();
    if (this.#index !== this.text.length) {
      throw new TypeError(`${this.kind} must contain valid JSON`);
    }
  }

  #parseValue(): void {
    this.#skipWhitespace();
    const char = this.text[this.#index];
    if (char === "{") {
      this.#parseObject();
      return;
    }
    if (char === "[") {
      this.#parseArray();
      return;
    }
    if (char === '"') {
      this.#parseString();
      return;
    }
    this.#parseLiteralOrNumber();
  }

  #parseObject(): void {
    this.#index += 1;
    const keys = new Set<string>();
    this.#skipWhitespace();
    if (this.text[this.#index] === "}") {
      this.#index += 1;
      return;
    }
    while (true) {
      this.#skipWhitespace();
      if (this.text[this.#index] !== '"') {
        throw new TypeError(`${this.kind} must contain valid JSON`);
      }
      const key = this.#parseString();
      if (keys.has(key)) {
        throw new TypeError(`${this.kind} contains a duplicate JSON object key`);
      }
      keys.add(key);
      this.#skipWhitespace();
      if (this.text[this.#index] !== ":") {
        throw new TypeError(`${this.kind} must contain valid JSON`);
      }
      this.#index += 1;
      this.#parseValue();
      this.#skipWhitespace();
      const next = this.text[this.#index];
      if (next === "}") {
        this.#index += 1;
        return;
      }
      if (next !== ",") {
        throw new TypeError(`${this.kind} must contain valid JSON`);
      }
      this.#index += 1;
    }
  }

  #parseArray(): void {
    this.#index += 1;
    this.#skipWhitespace();
    if (this.text[this.#index] === "]") {
      this.#index += 1;
      return;
    }
    while (true) {
      this.#parseValue();
      this.#skipWhitespace();
      const next = this.text[this.#index];
      if (next === "]") {
        this.#index += 1;
        return;
      }
      if (next !== ",") {
        throw new TypeError(`${this.kind} must contain valid JSON`);
      }
      this.#index += 1;
    }
  }

  #parseString(): string {
    const start = this.#index;
    this.#index += 1;
    let escaped = false;
    while (this.#index < this.text.length) {
      const char = this.text[this.#index];
      if (escaped) {
        escaped = false;
        this.#index += 1;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        this.#index += 1;
        continue;
      }
      if (char === '"') {
        this.#index += 1;
        try {
          const parsed = JSON.parse(this.text.slice(start, this.#index));
          if (typeof parsed !== "string") {
            throw new TypeError(`${this.kind} must contain valid JSON`);
          }
          return parsed;
        } catch {
          throw new TypeError(`${this.kind} must contain valid JSON`);
        }
      }
      this.#index += 1;
    }
    throw new TypeError(`${this.kind} must contain valid JSON`);
  }

  #parseLiteralOrNumber(): void {
    const start = this.#index;
    while (this.#index < this.text.length && !/[\s,\]}]/u.test(this.text[this.#index] ?? "")) {
      this.#index += 1;
    }
    const token = this.text.slice(start, this.#index);
    if (token.length === 0) {
      throw new TypeError(`${this.kind} must contain valid JSON`);
    }
    try {
      JSON.parse(token);
    } catch {
      throw new TypeError(`${this.kind} must contain valid JSON`);
    }
  }

  #skipWhitespace(): void {
    while (/[\t\n\r ]/u.test(this.text[this.#index] ?? "")) {
      this.#index += 1;
    }
  }
}
