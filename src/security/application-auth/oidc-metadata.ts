import {
  createOriginBoundOutboundFetch,
  guardedExactHttpLoopbackOutboundFetch,
} from "#veryfront/security/http/outbound-fetch.ts";
import { primordialArraySort } from "#veryfront/platform/compat/primordials/array.ts";

const MAX_ISSUER_LENGTH = 2_048;
const MAX_METADATA_BYTES = 256 * 1024;
const MAX_METADATA_FIELDS = 64;
const MAX_METADATA_STRING_LENGTH = 4_096;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_SECONDS = 600;
const MAX_CACHE_TTL_SECONDS = 2_592_000;
const DEFAULT_CACHE_ENTRIES = 64;
const MAX_CACHE_ENTRIES = 64;
const ArrayIsArray = Array.isArray;
const NativeMap = Map;
const NativePromise = Promise;
const NativeSet = Set;
const ReflectApply = Reflect.apply;
const JsonParse = JSON.parse;
const MapPrototypeDelete = NativeMap.prototype.delete;
const MapPrototypeForEach = NativeMap.prototype.forEach;
const MapPrototypeGet = NativeMap.prototype.get;
const MapPrototypeHas = NativeMap.prototype.has;
const MapPrototypeSet = NativeMap.prototype.set;
const MapSizeGetter = Object.getOwnPropertyDescriptor(NativeMap.prototype, "size")?.get;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectKeys = Object.keys;
const ObjectPrototype = Object.prototype;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const PromiseReject = NativePromise.reject;
const PromiseResolve = NativePromise.resolve;
const PromisePrototypeThen = NativePromise.prototype.then;
const SetPrototypeAdd = NativeSet.prototype.add;
const SetPrototypeHas = NativeSet.prototype.has;
const RegExpPrototypeTest = RegExp.prototype.test;
const StringPrototypeEndsWith = String.prototype.endsWith;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeSplit = String.prototype.split;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const StringPrototypeTrim = String.prototype.trim;
const TextDecoderDecode = TextDecoder.prototype.decode;
const Utf8Decoder = new TextDecoder("utf-8", { fatal: true });

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
  get(options: FetchOidcMetadataOptions, cacheTtlSeconds?: number): Promise<OidcMetadata>;
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
      stringEndsWith(issuer.issuer, "/") ? stringSlice(issuer.issuer, 0, -1) : issuer.issuer
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
  const defaultTtlMs = parseCacheTtlMs(options.ttlSeconds);
  const maxEntries = parseMaxEntries(options.maxEntries);
  const now = options.now ?? (() => performance.now());
  const entries = new NativeMap<string, CacheEntry>();

  function evictIfNeeded(): void {
    while (mapSize(entries) > maxEntries) {
      let oldestSettledKey: string | undefined;
      mapForEach(entries, (entry, key) => {
        if (oldestSettledKey === undefined && entry.pending === undefined) {
          oldestSettledKey = key;
        }
      });
      if (oldestSettledKey === undefined) return;
      mapDelete(entries, oldestSettledKey);
    }
  }

  function reserveLoadCapacity(key: string): void {
    if (mapHas(entries, key)) return;
    while (mapSize(entries) >= maxEntries) {
      let settledKey: string | undefined;
      mapForEach(entries, (entry, candidateKey) => {
        if (settledKey === undefined && entry.pending === undefined) {
          settledKey = candidateKey;
        }
      });
      if (settledKey === undefined) {
        throw new TypeError("OIDC metadata cache pending load capacity reached");
      }
      mapDelete(entries, settledKey);
    }
  }

  return ObjectFreeze({
    get(
      fetchOptions: FetchOidcMetadataOptions,
      cacheTtlSeconds?: number,
    ): Promise<OidcMetadata> {
      try {
        const ttlMs = cacheTtlSeconds === undefined
          ? defaultTtlMs
          : parseCacheTtlMs(cacheTtlSeconds);
        const key = cacheKey(fetchOptions, ttlMs);
        const current = mapGet(entries, key);
        const currentTime = now();
        if (current?.value !== undefined && current.expiresAt > currentTime) {
          try {
            const value = revalidateCachedMetadata(current.value, fetchOptions);
            mapDelete(entries, key);
            mapSet(entries, key, current);
            return ReflectApply(PromiseResolve, NativePromise, [value]) as Promise<OidcMetadata>;
          } catch {
            mapDelete(entries, key);
          }
        }
        if (current?.pending !== undefined) {
          return current.pending;
        }

        reserveLoadCapacity(key);
        const pending = promiseThen(
          fetchOidcMetadata(fetchOptions),
          (value) => {
            mapSet(entries, key, { value, expiresAt: now() + ttlMs });
            evictIfNeeded();
            return value;
          },
          (error) => {
            if (mapGet(entries, key)?.pending === pending) {
              mapDelete(entries, key);
            }
            throw error;
          },
        );
        mapSet(entries, key, { pending, expiresAt: currentTime + ttlMs });
        evictIfNeeded();
        return pending;
      } catch (error) {
        return ReflectApply(PromiseReject, NativePromise, [error]) as Promise<OidcMetadata>;
      }
    },
  });
}

function mapDelete<K, V>(map: Map<K, V>, key: K): boolean {
  return ReflectApply(MapPrototypeDelete, map, [key]) as boolean;
}

function mapForEach<K, V>(
  map: ReadonlyMap<K, V>,
  callback: (value: V, key: K) => void,
): void {
  ReflectApply(MapPrototypeForEach, map, [callback]);
}

function mapGet<K, V>(map: ReadonlyMap<K, V>, key: K): V | undefined {
  return ReflectApply(MapPrototypeGet, map, [key]) as V | undefined;
}

function mapHas<K>(map: ReadonlyMap<K, unknown>, key: K): boolean {
  return ReflectApply(MapPrototypeHas, map, [key]) as boolean;
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  ReflectApply(MapPrototypeSet, map, [key, value]);
}

function mapSize(map: ReadonlyMap<unknown, unknown>): number {
  if (MapSizeGetter === undefined) throw new TypeError("Map size accessor is unavailable");
  return ReflectApply(MapSizeGetter, map, []) as number;
}

function promiseThen<T, U>(
  promise: Promise<T>,
  onFulfilled: (value: T) => U | PromiseLike<U>,
  onRejected: (reason: unknown) => U | PromiseLike<U>,
): Promise<U> {
  return ReflectApply(PromisePrototypeThen, promise, [onFulfilled, onRejected]) as Promise<U>;
}

function setAdd<T>(set: Set<T>, value: T): void {
  ReflectApply(SetPrototypeAdd, set, [value]);
}

function setHas<T>(set: ReadonlySet<T>, value: T): boolean {
  return ReflectApply(SetPrototypeHas, set, [value]) as boolean;
}

function cacheKey(options: FetchOidcMetadataOptions, ttlMs: number): string {
  const configuredOrigins = options.trustedEndpointOrigins ?? [];
  const trustedOrigins: string[] = [];
  for (let index = 0; index < configuredOrigins.length; index += 1) {
    trustedOrigins[index] = configuredOrigins[index]!;
  }
  primordialArraySort(
    trustedOrigins,
    (left, right) => left < right ? -1 : left > right ? 1 : 0,
  );
  const fields = [
    "oidc-metadata-cache-v1",
    options.issuer,
    options.allowInsecureLoopback === true ? "loopback-http" : "https-only",
    `${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}`,
    `${ttlMs}`,
    `${trustedOrigins.length}`,
  ];
  for (let index = 0; index < trustedOrigins.length; index += 1) {
    fields[fields.length] = trustedOrigins[index]!;
  }
  return lengthPrefixedCacheKey(fields);
}

function lengthPrefixedCacheKey(fields: readonly string[]): string {
  let key = "";
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    key += `${field.length}:${field}`;
  }
  return key;
}

function revalidateCachedMetadata(
  metadata: OidcMetadata,
  options: FetchOidcMetadataOptions,
): OidcMetadata {
  const issuer = parseConfiguredIssuer(options.issuer, options.allowInsecureLoopback === true);
  const trustedOrigins = parseTrustedEndpointOrigins(options.trustedEndpointOrigins ?? []);
  if (metadata.issuer !== issuer.issuer) {
    throw new TypeError("Cached OIDC discovery issuer does not match the configured issuer");
  }
  const authorizationEndpoint = parseMetadataEndpoint(
    metadata.authorizationEndpoint,
    "authorization_endpoint",
    issuer,
    trustedOrigins,
  );
  const tokenEndpoint = parseMetadataEndpoint(
    metadata.tokenEndpoint,
    "token_endpoint",
    issuer,
    trustedOrigins,
  );
  const jwksUri = parseMetadataEndpoint(metadata.jwksUri, "jwks_uri", issuer, trustedOrigins);
  if (
    authorizationEndpoint !== metadata.authorizationEndpoint ||
    tokenEndpoint !== metadata.tokenEndpoint ||
    jwksUri !== metadata.jwksUri
  ) {
    throw new TypeError("Cached OIDC discovery endpoints are not canonical");
  }
  return freezeMetadata({
    issuer: issuer.issuer,
    authorizationEndpoint,
    tokenEndpoint,
    jwksUri,
  });
}

function parseOidcMetadata(
  value: JsonObject,
  issuer: ParsedIssuer,
  trustedOrigins: ReadonlySet<string>,
): OidcMetadata {
  const keys = ObjectKeys(value);
  if (keys.length > MAX_METADATA_FIELDS) {
    throw new TypeError("OIDC discovery metadata exceeds the top-level field limit");
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const entry = value[key];
    if (typeof entry === "string" && entry.length > MAX_METADATA_STRING_LENGTH) {
      throw new TypeError("OIDC discovery metadata contains a string over the size limit");
    }
  }

  const discoveredIssuer = readRequiredString(value, "issuer");
  if (discoveredIssuer !== issuer.issuer) {
    throw new TypeError("OIDC discovery issuer must exactly match the configured issuer");
  }

  return freezeMetadata({
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

function freezeMetadata(metadata: OidcMetadata): OidcMetadata {
  return ObjectFreeze({
    issuer: metadata.issuer,
    authorizationEndpoint: metadata.authorizationEndpoint,
    tokenEndpoint: metadata.tokenEndpoint,
    jwksUri: metadata.jwksUri,
  });
}

function readRequiredString(value: JsonObject, key: string): string {
  const descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, Object, [
    value,
    key,
  ]) as PropertyDescriptor | undefined;
  const entry = descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
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
  const origins = new NativeSet<string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
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
    if (setHas(origins, url.origin)) {
      throw new TypeError("OIDC trusted endpoint origins must not contain duplicates");
    }
    setAdd(origins, url.origin);
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
  if (url.protocol === "https:" && setHas(trustedOrigins, url.origin)) {
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
    const init: RequestInit = {
      headers: { accept: "application/json" },
      redirect: "error",
      credentials: "omit",
      signal: controller.signal,
    };
    const response = options.allowExactHttpLoopbackEgress === true &&
        isLoopbackHttpUrl(options.url)
      ? await guardedExactHttpLoopbackOutboundFetch(options.url, init, {
        authorizeUrl: options.authorizeUrl,
      })
      : await fetchProviderJson(options.url, init, options.authorizeUrl);
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
    if (
      error instanceof Error &&
      stringIncludes(stringToLowerCase(error.message), "redirect")
    ) {
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

async function fetchProviderJson(
  url: URL,
  init: RequestInit,
  authorizeUrl: (url: URL) => void,
): Promise<Response> {
  authorizeUrl(url);
  return await createOriginBoundOutboundFetch(url.origin)(url, init);
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const parts = ReflectApply(StringPrototypeSplit, value, [";", 1]) as string[];
  const mediaType = parts[0] === undefined ? "" : stringToLowerCase(stringTrim(parts[0]));
  return mediaType === "application/json" ||
    (stringStartsWith(mediaType, "application/") && stringEndsWith(mediaType, "+json"));
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
      chunks[chunks.length] = result.value;
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
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex]!;
    for (let index = 0; index < chunk.byteLength; index += 1) {
      bytes[offset + index] = chunk[index]!;
    }
    offset += chunk.byteLength;
  }
  return ReflectApply(TextDecoderDecode, Utf8Decoder, [bytes]) as string;
}

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    return ReflectApply(PromiseReject, NativePromise, [
      new DOMException("aborted", "AbortError"),
    ]) as Promise<ReadableStreamReadResult<Uint8Array>>;
  }
  return new NativePromise((resolve, reject) => {
    const abort = () => {
      void reader.cancel();
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    promiseThen(
      reader.read(),
      (result) => {
        signal.removeEventListener("abort", abort);
        resolve(result);
        return undefined;
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
        return undefined;
      },
    );
  });
}

export function parseStrictJsonObject(text: string, kind: string): JsonObject {
  rejectDuplicateJsonObjectKeys(text, kind);
  let parsed: unknown;
  try {
    parsed = ReflectApply(JsonParse, JSON, [text]);
  } catch (error) {
    throw new TypeError(`${kind} must contain valid JSON`, { cause: error });
  }
  if (!isPlainObject(parsed)) {
    throw new TypeError(`${kind} must be a plain JSON object`);
  }
  isolateJsonObjectPrototypes(parsed, kind);
  rejectReservedJsonKeys(parsed, kind);
  return parsed;
}

function rejectDuplicateJsonObjectKeys(text: string, kind: string): void {
  const parser = new JsonDuplicateKeyParser(text, kind);
  parser.parse();
}

export function isPlainObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== "object") return false;
  const prototype = ObjectGetPrototypeOf(value);
  return prototype === ObjectPrototype || prototype === null;
}

function rejectReservedJsonKeys(value: unknown, kind: string): void {
  if (ArrayIsArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      rejectReservedJsonKeys(value[index], kind);
    }
    return;
  }
  if (!isPlainObject(value)) return;
  const keys = ObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
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
    const keys = new NativeSet<string>();
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
      if (setHas(keys, key)) {
        throw new TypeError(`${this.kind} contains a duplicate JSON object key`);
      }
      setAdd(keys, key);
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
          const parsed = ReflectApply(JsonParse, JSON, [
            stringSlice(this.text, start, this.#index),
          ]);
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
    while (
      this.#index < this.text.length &&
      !regexpTest(/[\s,\]}]/u, this.text[this.#index] ?? "")
    ) {
      this.#index += 1;
    }
    const token = stringSlice(this.text, start, this.#index);
    if (token.length === 0) {
      throw new TypeError(`${this.kind} must contain valid JSON`);
    }
    try {
      ReflectApply(JsonParse, JSON, [token]);
    } catch {
      throw new TypeError(`${this.kind} must contain valid JSON`);
    }
  }

  #skipWhitespace(): void {
    while (regexpTest(/[\t\n\r ]/u, this.text[this.#index] ?? "")) {
      this.#index += 1;
    }
  }
}

function isolateJsonObjectPrototypes(value: unknown, kind: string): void {
  if (ArrayIsArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      isolateJsonObjectPrototypes(value[index], kind);
    }
    return;
  }
  if (!isPlainObject(value)) return;
  ReflectApply(ObjectSetPrototypeOf, Object, [value, null]);
  const keys = ObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, Object, [
      value,
      key,
    ]) as PropertyDescriptor | undefined;
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${kind} contains an unsupported JSON object property`);
    }
    isolateJsonObjectPrototypes(descriptor.value, kind);
  }
}

function regexpTest(pattern: RegExp, value: string): boolean {
  return ReflectApply(RegExpPrototypeTest, pattern, [value]) as boolean;
}

function stringEndsWith(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeEndsWith, value, [search]) as boolean;
}

function stringIncludes(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeIncludes, value, [search]) as boolean;
}

function stringSlice(value: string, start?: number, end?: number): string {
  return ReflectApply(StringPrototypeSlice, value, [start, end]) as string;
}

function stringStartsWith(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeStartsWith, value, [search]) as boolean;
}

function stringToLowerCase(value: string): string {
  return ReflectApply(StringPrototypeToLowerCase, value, []) as string;
}

function stringTrim(value: string): string {
  return ReflectApply(StringPrototypeTrim, value, []) as string;
}
