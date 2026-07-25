import {
  API_CLIENT_ERROR,
  INVALID_ARGUMENT,
  isVeryfrontError,
  NETWORK_ERROR,
  RESOURCE_NOT_FOUND,
  SERVICE_OVERLOADED,
} from "#veryfront/errors";

const ENVIRONMENT_LIST_PAGE_LIMIT = 100;
const ENVIRONMENT_LIST_MAX_PAGES = 10;
const ENVIRONMENT_LIST_MAX_PAGE_BYTES = 256 * 1024;
const ENVIRONMENT_ID_MAX_CODE_UNITS = 1_024;
const ENVIRONMENT_NAME_MAX_CODE_UNITS = 256;
const ENVIRONMENT_CURSOR_MAX_CODE_UNITS = 4_096;
const PROJECT_SLUG_MAX_CODE_UNITS = 1_024;
const API_TOKEN_MAX_CODE_UNITS = 16_384;
const API_BASE_URL_MAX_CODE_UNITS = 2_048;
const DEFAULT_IDENTITY_CACHE_ENTRIES = 1_000;
const DEFAULT_IDENTITY_CACHE_TTL_MS = 60_000;
const DEFAULT_IDENTITY_CACHE_MAX_INFLIGHT = 100;
const DEFAULT_IDENTITY_CACHE_MAX_INFLIGHT_PER_PROJECT = 16;
const DEFAULT_IDENTITY_FETCH_TIMEOUT_MS = 10_000;
const MAX_IDENTITY_CACHE_ENTRIES = 10_000;
const MAX_IDENTITY_CACHE_INFLIGHT = 1_000;
const MAX_IDENTITY_CACHE_TTL_MS = 2_147_483_647;
// Keep bounded string payload below the prior cache adapter's 50 MiB ceiling,
// leaving headroom for Map nodes and entry objects.
const MAX_IDENTITY_CACHE_STRING_CODE_UNITS = 20 * 1_024 * 1_024;
const MAX_IDENTITY_FETCH_TIMEOUT_MS = 300_000;
const HEX_DIGITS = "0123456789abcdef";
const IntrinsicAbortController = AbortController;
const IntrinsicAbortSignal = AbortSignal;
const IntrinsicArray = Array;
const IntrinsicMap = Map;
const IntrinsicNumber = Number;
const IntrinsicPromise = Promise;
const IntrinsicSet = Set;
const IntrinsicUint8Array = Uint8Array;
const IntrinsicURL = URL;
const ArrayIsArray = Array.isArray;
const AbortControllerPrototypeAbort = AbortController.prototype.abort;
const AbortSignalPrototypeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const EventTargetPrototypeAddEventListener = EventTarget.prototype.addEventListener;
const EventTargetPrototypeRemoveEventListener = EventTarget.prototype.removeEventListener;
const MapPrototypeDelete = Map.prototype.delete;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeHas = Map.prototype.has;
const MapPrototypeKeys = Map.prototype.keys;
const MapPrototypeSet = Map.prototype.set;
const MapPrototypeValues = Map.prototype.values;
const PromisePrototypeThen = Promise.prototype.then;
const RegExpPrototypeTest = RegExp.prototype.test;
const SetPrototypeAdd = Set.prototype.add;
const SetPrototypeHas = Set.prototype.has;
const StringPrototypeReplace = String.prototype.replace;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const abortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const abortSignalReasonGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "reason",
)?.get;
const abortControllerSignalGetter = Object.getOwnPropertyDescriptor(
  AbortController.prototype,
  "signal",
)?.get;
const mapSizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, "size")?.get;
const mapIteratorPrototype = Object.getPrototypeOf(new IntrinsicMap().keys());
const mapIteratorPrototypeNext = mapIteratorPrototype?.next;
const intrinsicSubtleCrypto = crypto.subtle;
const SubtleCryptoPrototypeDigest = intrinsicSubtleCrypto.digest;
const TextEncoderPrototypeEncode = TextEncoder.prototype.encode;
const intrinsicTextEncoder = new TextEncoder();
const MathMax = Math.max;
const MathMin = Math.min;
const NumberIsFinite = Number.isFinite;
const NumberIsSafeInteger = Number.isSafeInteger;
const ObjectFreeze = Object.freeze;
const ObjectHasOwn = Object.hasOwn;
const ReflectApply = Reflect.apply;
const monotonicNow = performance.now.bind(performance);
const scheduleTimeout = globalThis.setTimeout;
const cancelTimeout = globalThis.clearTimeout;
const resolvedPromise = new IntrinsicPromise<void>((resolve) => resolve());

if (
  typeof abortSignalAbortedGetter !== "function" ||
  typeof abortSignalReasonGetter !== "function" ||
  typeof abortControllerSignalGetter !== "function" ||
  typeof mapSizeGetter !== "function" ||
  typeof mapIteratorPrototypeNext !== "function"
) {
  throw new TypeError("Required cache intrinsics are unavailable");
}

const intrinsicAbortSignalAbortedGetter = abortSignalAbortedGetter as () => boolean;
const intrinsicAbortSignalReasonGetter = abortSignalReasonGetter as () => unknown;
const intrinsicAbortControllerSignalGetter = abortControllerSignalGetter as () => AbortSignal;
const intrinsicMapSizeGetter = mapSizeGetter as () => number;
const intrinsicMapIteratorNext = mapIteratorPrototypeNext as () => IteratorResult<unknown>;

export interface ProjectEnvironmentIdentity {
  readonly id: string;
  readonly name: string;
  /**
   * `undefined` means the API omitted the field, `null` means the API
   * explicitly reports no active release, and a string is the exact release ID.
   */
  readonly active_release_id: string | null | undefined;
}

export type ProjectEnvironmentIdentityLookup =
  | {
    readonly kind: "name";
    readonly name: string;
  }
  | {
    readonly kind: "id";
    readonly id: string;
    readonly expectedName?: string;
    readonly expectedActiveReleaseId?: string | null;
  };

export interface ResolveProjectEnvironmentIdentityOptions {
  readonly apiBaseUrl: string;
  readonly projectSlug: string;
  readonly token: string;
  readonly lookup: ProjectEnvironmentIdentityLookup;
  readonly signal: AbortSignal;
  readonly fetch: typeof globalThis.fetch;
}

export interface ProjectEnvironmentIdentityCacheOptions {
  readonly maxEntries?: number;
  readonly ttlMs?: number;
  readonly maxInflight?: number;
  readonly maxInflightPerProject?: number;
  readonly fetchTimeoutMs?: number;
}

interface ProjectEnvironmentIdentityFlight {
  readonly joinCohortKey: string;
  readonly marker: object;
  readonly controller: AbortController;
  readonly promise: Promise<ProjectEnvironmentIdentity>;
  waiterCount: number;
  settled: boolean;
}

interface ResolvedProjectEnvironmentIdentity {
  readonly value: ProjectEnvironmentIdentity;
  readonly expiresAt: number;
  readonly sizeCodeUnits: number;
}

function getControllerSignal(controller: AbortController): AbortSignal {
  return ReflectApply(intrinsicAbortControllerSignalGetter, controller, []) as AbortSignal;
}

function abortController(controller: AbortController, reason: unknown): void {
  ReflectApply(AbortControllerPrototypeAbort, controller, [reason]);
}

function throwIfAborted(signal: AbortSignal): void {
  ReflectApply(AbortSignalPrototypeThrowIfAborted, signal, []);
}

function isAborted(signal: AbortSignal): boolean {
  return ReflectApply(intrinsicAbortSignalAbortedGetter, signal, []) as boolean;
}

function getSignalReason(signal: AbortSignal): unknown {
  return ReflectApply(intrinsicAbortSignalReasonGetter, signal, []);
}

function addAbortListener(signal: AbortSignal, listener: () => void): void {
  ReflectApply(
    EventTargetPrototypeAddEventListener,
    signal,
    ["abort", listener, { once: true }],
  );
}

function removeAbortListener(signal: AbortSignal, listener: () => void): void {
  ReflectApply(
    EventTargetPrototypeRemoveEventListener,
    signal,
    ["abort", listener],
  );
}

function mapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  return ReflectApply(MapPrototypeGet, map, [key]) as V | undefined;
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  ReflectApply(MapPrototypeSet, map, [key, value]);
}

function mapHas<K, V>(map: Map<K, V>, key: K): boolean {
  return ReflectApply(MapPrototypeHas, map, [key]) as boolean;
}

function mapDelete<K, V>(map: Map<K, V>, key: K): boolean {
  return ReflectApply(MapPrototypeDelete, map, [key]) as boolean;
}

function mapSize<K, V>(map: Map<K, V>): number {
  return ReflectApply(intrinsicMapSizeGetter, map, []) as number;
}

function mapKeys<K, V>(map: Map<K, V>): Iterator<K> {
  return ReflectApply(MapPrototypeKeys, map, []) as Iterator<K>;
}

function mapValues<K, V>(map: Map<K, V>): Iterator<V> {
  return ReflectApply(MapPrototypeValues, map, []) as Iterator<V>;
}

function iteratorNext<T>(iterator: Iterator<T>): IteratorResult<T> {
  return ReflectApply(intrinsicMapIteratorNext, iterator, []) as IteratorResult<T>;
}

function setHas<T>(set: Set<T>, value: T): boolean {
  return ReflectApply(SetPrototypeHas, set, [value]) as boolean;
}

function setAdd<T>(set: Set<T>, value: T): void {
  ReflectApply(SetPrototypeAdd, set, [value]);
}

function promiseThen<T, U>(
  promise: Promise<T>,
  onFulfilled: (value: T) => U | PromiseLike<U>,
  onRejected?: (reason: unknown) => U | PromiseLike<U>,
): Promise<U> {
  return ReflectApply(
    PromisePrototypeThen,
    promise,
    [onFulfilled, onRejected],
  ) as Promise<U>;
}

function observePromise<T>(
  promise: Promise<T>,
  onFulfilled: (value: T) => void,
  onRejected: (reason: unknown) => void,
): void {
  void promiseThen(promise, onFulfilled, onRejected);
}

function regexpTest(pattern: RegExp, value: string): boolean {
  return ReflectApply(RegExpPrototypeTest, pattern, [value]) as boolean;
}

function stringReplace(
  value: string,
  searchValue: string | RegExp,
  replaceValue: string,
): string {
  return ReflectApply(
    StringPrototypeReplace,
    value,
    [searchValue, replaceValue],
  ) as string;
}

function stringToLowerCase(value: string): string {
  return ReflectApply(StringPrototypeToLowerCase, value, []) as string;
}

function promiseWithResolvers<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new IntrinsicPromise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function fingerprintToken(token: string): Promise<string> {
  const encoded = ReflectApply(
    TextEncoderPrototypeEncode,
    intrinsicTextEncoder,
    [token],
  ) as Uint8Array;
  const digest = await ReflectApply(
    SubtleCryptoPrototypeDigest,
    intrinsicSubtleCrypto,
    ["SHA-256", encoded],
  ) as ArrayBuffer;
  const bytes = new IntrinsicUint8Array(digest);
  let fingerprint = "";
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!;
    fingerprint += HEX_DIGITS[byte >>> 4]! + HEX_DIGITS[byte & 0x0f]!;
  }
  return fingerprint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !ArrayIsArray(value);
}

function createUpstreamResponseError(detail: string, cause?: unknown): Error {
  return API_CLIENT_ERROR.create({
    status: 502,
    detail,
    cause,
  });
}

function requireBoundedString(
  value: unknown,
  field: string,
  maxCodeUnits: number,
  errorFactory: (detail: string) => Error,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxCodeUnits ||
    regexpTest(/\p{Cc}/u, value)
  ) {
    throw errorFactory(
      `${field} must be a non-empty string of at most ${maxCodeUnits} characters without control characters`,
    );
  }
  return value;
}

function requireResolverArgument(
  value: unknown,
  field: string,
  maxCodeUnits: number,
): string {
  return requireBoundedString(
    value,
    field,
    maxCodeUnits,
    (detail) => INVALID_ARGUMENT.create({ detail }),
  );
}

function requireEnvironmentResponseString(
  value: unknown,
  field: string,
  maxCodeUnits: number,
): string {
  return requireBoundedString(
    value,
    `Environment discovery ${field}`,
    maxCodeUnits,
    (detail) => createUpstreamResponseError(detail),
  );
}

function parseActiveReleaseId(entry: Record<string, unknown>): string | null | undefined {
  if (!ObjectHasOwn(entry, "active_release_id")) return undefined;
  const value = entry.active_release_id;
  if (value === null) return null;
  return requireEnvironmentResponseString(
    value,
    "active_release_id",
    ENVIRONMENT_ID_MAX_CODE_UNITS,
  );
}

function parseEnvironmentListPage(value: unknown): {
  environments: ProjectEnvironmentIdentity[];
  nextCursor: string | null;
} {
  if (!isRecord(value) || !ArrayIsArray(value.data)) {
    throw createUpstreamResponseError(
      "Environment discovery returned an invalid response envelope",
    );
  }
  if (value.data.length > ENVIRONMENT_LIST_PAGE_LIMIT) {
    throw createUpstreamResponseError(
      "Environment discovery returned too many entries in one page",
    );
  }

  const rawEnvironments = value.data;
  const environments = new IntrinsicArray<ProjectEnvironmentIdentity>(
    rawEnvironments.length,
  );
  for (let index = 0; index < rawEnvironments.length; index += 1) {
    const entry = rawEnvironments[index];
    if (!isRecord(entry)) {
      throw createUpstreamResponseError(
        "Environment discovery returned an invalid environment entry",
      );
    }
    environments[index] = ObjectFreeze({
      id: requireEnvironmentResponseString(
        entry.id,
        "environment id",
        ENVIRONMENT_ID_MAX_CODE_UNITS,
      ),
      name: requireEnvironmentResponseString(
        entry.name,
        "environment name",
        ENVIRONMENT_NAME_MAX_CODE_UNITS,
      ),
      active_release_id: parseActiveReleaseId(entry),
    });
  }

  if (value.page_info === undefined || value.page_info === null) {
    return { environments, nextCursor: null };
  }
  if (!isRecord(value.page_info)) {
    throw createUpstreamResponseError(
      "Environment discovery returned invalid pagination metadata",
    );
  }
  const next = value.page_info.next;
  if (next === undefined || next === null) {
    return { environments, nextCursor: null };
  }
  if (
    typeof next !== "string" ||
    next.length === 0 ||
    next.length > ENVIRONMENT_CURSOR_MAX_CODE_UNITS ||
    regexpTest(/\p{Cc}/u, next)
  ) {
    throw createUpstreamResponseError(
      "Environment discovery returned an invalid pagination cursor",
    );
  }
  return { environments, nextCursor: next };
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort cleanup; the original response error wins.
  }
}

async function readBoundedEnvironmentListPage(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!regexpTest(/^\d+$/u, contentLength)) {
      await cancelResponseBody(response);
      throw createUpstreamResponseError(
        "Environment discovery returned an invalid Content-Length header",
      );
    }
    const declaredBytes = IntrinsicNumber(contentLength);
    if (
      !NumberIsSafeInteger(declaredBytes) ||
      declaredBytes > ENVIRONMENT_LIST_MAX_PAGE_BYTES
    ) {
      await cancelResponseBody(response);
      throw createUpstreamResponseError(
        "Environment discovery response exceeded the configured size limit",
      );
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw createUpstreamResponseError(
      "Environment discovery returned an empty response body",
    );
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > ENVIRONMENT_LIST_MAX_PAGE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Cancellation is best-effort cleanup; preserve the size error.
        }
        throw createUpstreamResponseError(
          "Environment discovery response exceeded the configured size limit",
        );
      }
      chunks[chunks.length] = value;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw createUpstreamResponseError(
      "Environment discovery returned invalid UTF-8",
      error,
    );
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw createUpstreamResponseError(
      "Environment discovery returned invalid JSON",
      error,
    );
  }
}

function normalizeEnvironmentName(name: string): string {
  return stringToLowerCase(name);
}

function frameCacheIdentity(value: string): string {
  return `${value.length}:${value}`;
}

function buildLookupCacheIdentity(lookup: ProjectEnvironmentIdentityLookup): string {
  switch (lookup.kind) {
    case "name": {
      const name = requireResolverArgument(
        lookup.name,
        "Environment name",
        ENVIRONMENT_NAME_MAX_CODE_UNITS,
      );
      return `name:${frameCacheIdentity(normalizeEnvironmentName(name))}`;
    }
    case "id": {
      const id = requireResolverArgument(
        lookup.id,
        "Environment ID",
        ENVIRONMENT_ID_MAX_CODE_UNITS,
      );
      const expectedName = lookup.expectedName === undefined
        ? "absent"
        : `value:${
          frameCacheIdentity(
            normalizeEnvironmentName(
              requireResolverArgument(
                lookup.expectedName,
                "Expected environment name",
                ENVIRONMENT_NAME_MAX_CODE_UNITS,
              ),
            ),
          )
        }`;
      const expectedRelease = lookup.expectedActiveReleaseId === undefined
        ? "absent"
        : lookup.expectedActiveReleaseId === null
        ? "null"
        : `value:${
          frameCacheIdentity(
            requireResolverArgument(
              lookup.expectedActiveReleaseId,
              "Expected active release ID",
              ENVIRONMENT_ID_MAX_CODE_UNITS,
            ),
          )
        }`;
      return `id:${frameCacheIdentity(id)}${frameCacheIdentity(expectedName)}${
        frameCacheIdentity(expectedRelease)
      }`;
    }
  }
}

async function buildIdentityCacheKey(
  options: ResolveProjectEnvironmentIdentityOptions,
): Promise<string> {
  const apiBaseUrl = requireResolverArgument(
    options.apiBaseUrl,
    "API base URL",
    API_BASE_URL_MAX_CODE_UNITS,
  );
  const projectSlug = requireResolverArgument(
    options.projectSlug,
    "Project slug",
    PROJECT_SLUG_MAX_CODE_UNITS,
  );
  const token = requireResolverArgument(
    options.token,
    "API token",
    API_TOKEN_MAX_CODE_UNITS,
  );
  const tokenFingerprint = await fingerprintToken(token);
  const lookupIdentity = buildLookupCacheIdentity(options.lookup);
  return frameCacheIdentity(apiBaseUrl) +
    frameCacheIdentity(projectSlug) +
    frameCacheIdentity(tokenFingerprint) +
    frameCacheIdentity(lookupIdentity);
}

function buildIdentityJoinCohortKey(
  options: ResolveProjectEnvironmentIdentityOptions,
): string {
  const apiBaseUrl = requireResolverArgument(
    options.apiBaseUrl,
    "API base URL",
    API_BASE_URL_MAX_CODE_UNITS,
  );
  const projectSlug = requireResolverArgument(
    options.projectSlug,
    "Project slug",
    PROJECT_SLUG_MAX_CODE_UNITS,
  );
  const lookupIdentity = buildLookupCacheIdentity(options.lookup);
  return frameCacheIdentity(apiBaseUrl) +
    frameCacheIdentity(projectSlug) +
    frameCacheIdentity(lookupIdentity);
}

function buildLookup(options: ProjectEnvironmentIdentityLookup): {
  matches: (identity: ProjectEnvironmentIdentity) => boolean;
  missingDetail: string;
  expectedName?: string;
  expectedActiveReleaseId?: string | null;
} {
  switch (options.kind) {
    case "name": {
      const name = requireResolverArgument(
        options.name,
        "Environment name",
        ENVIRONMENT_NAME_MAX_CODE_UNITS,
      );
      const normalizedName = normalizeEnvironmentName(name);
      return {
        matches: (identity) => normalizeEnvironmentName(identity.name) === normalizedName,
        missingDetail: `Source environment "${name}" was not found`,
      };
    }
    case "id": {
      const id = requireResolverArgument(
        options.id,
        "Environment ID",
        ENVIRONMENT_ID_MAX_CODE_UNITS,
      );
      const expectedName = options.expectedName === undefined ? undefined : requireResolverArgument(
        options.expectedName,
        "Expected environment name",
        ENVIRONMENT_NAME_MAX_CODE_UNITS,
      );
      const expectedActiveReleaseId = options.expectedActiveReleaseId === undefined ||
          options.expectedActiveReleaseId === null
        ? options.expectedActiveReleaseId
        : requireResolverArgument(
          options.expectedActiveReleaseId,
          "Expected active release ID",
          ENVIRONMENT_ID_MAX_CODE_UNITS,
        );
      return {
        matches: (identity) => identity.id === id,
        missingDetail: `Environment "${id}" was not found`,
        expectedName,
        expectedActiveReleaseId,
      };
    }
  }
}

function assertExpectedIdentity(
  identity: ProjectEnvironmentIdentity,
  expectedName: string | undefined,
  expectedActiveReleaseId: string | null | undefined,
): void {
  if (
    expectedName !== undefined &&
    normalizeEnvironmentName(identity.name) !== normalizeEnvironmentName(expectedName)
  ) {
    throw RESOURCE_NOT_FOUND.create({
      detail: `Environment "${identity.id}" did not match the expected name`,
    });
  }
  if (
    expectedActiveReleaseId !== undefined &&
    identity.active_release_id !== expectedActiveReleaseId
  ) {
    throw RESOURCE_NOT_FOUND.create({
      detail: `Environment "${identity.id}" did not match the expected active release`,
    });
  }
}

/**
 * Resolve one project environment from the bounded, paginated environment list.
 *
 * Names use exact case-insensitive equality (no trimming, prefix, or fallback).
 * IDs and release IDs use exact case-sensitive equality.
 */
export async function resolveProjectEnvironmentIdentity(
  options: ResolveProjectEnvironmentIdentityOptions,
): Promise<ProjectEnvironmentIdentity> {
  const projectSlug = requireResolverArgument(
    options.projectSlug,
    "Project slug",
    PROJECT_SLUG_MAX_CODE_UNITS,
  );
  const token = requireResolverArgument(
    options.token,
    "API token",
    API_TOKEN_MAX_CODE_UNITS,
  );
  const apiBaseUrl = requireResolverArgument(
    options.apiBaseUrl,
    "API base URL",
    API_BASE_URL_MAX_CODE_UNITS,
  );
  const normalizedApiBaseUrl = stringReplace(apiBaseUrl, /\/+$/u, "");
  try {
    const parsedApiBaseUrl = new IntrinsicURL(normalizedApiBaseUrl);
    if (
      (parsedApiBaseUrl.protocol !== "https:" && parsedApiBaseUrl.protocol !== "http:") ||
      parsedApiBaseUrl.username !== "" ||
      parsedApiBaseUrl.password !== ""
    ) {
      throw new TypeError("unsupported API base URL");
    }
  } catch (error) {
    throw INVALID_ARGUMENT.create({
      detail: "API base URL must be an HTTP(S) URL without credentials",
      cause: error,
    });
  }
  if (typeof options.fetch !== "function") {
    throw INVALID_ARGUMENT.create({ detail: "Environment fetch must be a function" });
  }
  if (!(options.signal instanceof IntrinsicAbortSignal)) {
    throw INVALID_ARGUMENT.create({ detail: "Environment fetch signal must be an AbortSignal" });
  }

  throwIfAborted(options.signal);
  const lookup = buildLookup(options.lookup);
  const seenCursors = new IntrinsicSet<string>();
  const seenIds = new IntrinsicSet<string>();
  const seenNames = new IntrinsicSet<string>();
  let matchingIdentity: ProjectEnvironmentIdentity | undefined;
  let cursor: string | undefined;

  for (let page = 0; page < ENVIRONMENT_LIST_MAX_PAGES; page += 1) {
    throwIfAborted(options.signal);
    const url = new IntrinsicURL(
      `${normalizedApiBaseUrl}/projects/${encodeURIComponent(projectSlug)}/environments`,
    );
    url.searchParams.set("limit", String(ENVIRONMENT_LIST_PAGE_LIMIT));
    if (cursor) url.searchParams.set("cursor", cursor);

    let response: Response;
    try {
      response = await options.fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: options.signal,
      });
    } catch (error) {
      if (isAborted(options.signal) || isVeryfrontError(error)) throw error;
      throw NETWORK_ERROR.create({
        detail: "Environment discovery request failed",
        cause: error,
      });
    }

    if (!response.ok) {
      await cancelResponseBody(response);
      const status = response.status >= 400 && response.status < 600 ? response.status : 502;
      throw API_CLIENT_ERROR.create({
        status,
        detail: `Environment discovery failed with status ${response.status}`,
      });
    }

    let pageResult: ReturnType<typeof parseEnvironmentListPage>;
    try {
      pageResult = parseEnvironmentListPage(
        await readBoundedEnvironmentListPage(response),
      );
    } catch (error) {
      if (isAborted(options.signal) || isVeryfrontError(error)) throw error;
      throw NETWORK_ERROR.create({
        detail: "Environment discovery response could not be read",
        cause: error,
      });
    }

    for (
      let identityIndex = 0;
      identityIndex < pageResult.environments.length;
      identityIndex += 1
    ) {
      const identity = pageResult.environments[identityIndex]!;
      const normalizedName = normalizeEnvironmentName(identity.name);
      if (setHas(seenIds, identity.id) || setHas(seenNames, normalizedName)) {
        throw createUpstreamResponseError(
          "Environment discovery returned duplicate environment identities",
        );
      }
      setAdd(seenIds, identity.id);
      setAdd(seenNames, normalizedName);

      if (!lookup.matches(identity)) continue;
      if (matchingIdentity !== undefined) {
        throw createUpstreamResponseError(
          "Environment discovery returned multiple matching environments",
        );
      }
      matchingIdentity = identity;
    }

    if (pageResult.nextCursor === null) {
      if (!matchingIdentity) {
        throw RESOURCE_NOT_FOUND.create({ detail: lookup.missingDetail });
      }
      assertExpectedIdentity(
        matchingIdentity,
        lookup.expectedName,
        lookup.expectedActiveReleaseId,
      );
      return matchingIdentity;
    }
    if (setHas(seenCursors, pageResult.nextCursor)) {
      throw createUpstreamResponseError(
        "Environment discovery returned a repeated pagination cursor",
      );
    }
    setAdd(seenCursors, pageResult.nextCursor);
    cursor = pageResult.nextCursor;
  }

  throw createUpstreamResponseError(
    "Environment discovery exceeded the configured pagination limit",
  );
}

function requireCacheLimit(
  value: number,
  field: string,
  maximum: number,
): number {
  if (!NumberIsSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${field} must be an integer from 1 through ${maximum}`);
  }
  return value;
}

function getAbortReason(signal: AbortSignal): unknown {
  return isAborted(signal)
    ? getSignalReason(signal)
    : new DOMException("The operation was aborted", "AbortError");
}

/**
 * Bounded TTL cache and singleflight coordinator for environment identities.
 *
 * The credential is represented only by a SHA-256 fingerprint in cache keys.
 * Caller abort signals stop only that waiter; shared discovery is aborted once
 * no waiters remain.
 */
export class ProjectEnvironmentIdentityCache {
  private readonly resolved = new IntrinsicMap<string, ResolvedProjectEnvironmentIdentity>();
  private readonly inflight = new IntrinsicMap<string, ProjectEnvironmentIdentityFlight>();
  private readonly pendingKeyBuildsByCohort = new IntrinsicMap<string, number>();
  private readonly pendingKeyBuildsByProject = new IntrinsicMap<string, number>();
  private readonly activeDiscoveriesByProject = new IntrinsicMap<string, number>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly maxInflight: number;
  private readonly maxInflightPerProject: number;
  private readonly fetchTimeoutMs: number;
  private resolvedCodeUnits = 0;
  private pendingKeyBuilds = 0;
  private activeDiscoveries = 0;

  constructor(options: ProjectEnvironmentIdentityCacheOptions = {}) {
    this.maxEntries = requireCacheLimit(
      options.maxEntries ?? DEFAULT_IDENTITY_CACHE_ENTRIES,
      "Environment identity cache entries",
      MAX_IDENTITY_CACHE_ENTRIES,
    );
    const ttlMs = options.ttlMs ?? DEFAULT_IDENTITY_CACHE_TTL_MS;
    if (
      !NumberIsFinite(ttlMs) ||
      ttlMs <= 0 ||
      ttlMs > MAX_IDENTITY_CACHE_TTL_MS
    ) {
      throw new RangeError(
        `Environment identity cache TTL must be a positive finite number no greater than ${MAX_IDENTITY_CACHE_TTL_MS}`,
      );
    }
    this.ttlMs = ttlMs;
    this.maxInflight = requireCacheLimit(
      options.maxInflight ?? DEFAULT_IDENTITY_CACHE_MAX_INFLIGHT,
      "Environment identity cache in-flight requests",
      MAX_IDENTITY_CACHE_INFLIGHT,
    );
    this.maxInflightPerProject = requireCacheLimit(
      options.maxInflightPerProject ??
        MathMin(DEFAULT_IDENTITY_CACHE_MAX_INFLIGHT_PER_PROJECT, this.maxInflight),
      "Environment identity cache per-project in-flight requests",
      this.maxInflight,
    );
    this.fetchTimeoutMs = requireCacheLimit(
      options.fetchTimeoutMs ?? DEFAULT_IDENTITY_FETCH_TIMEOUT_MS,
      "Environment identity fetch timeout",
      MAX_IDENTITY_FETCH_TIMEOUT_MS,
    );
  }

  async get(
    options: ResolveProjectEnvironmentIdentityOptions,
  ): Promise<ProjectEnvironmentIdentity> {
    if (!(options.signal instanceof IntrinsicAbortSignal)) {
      throw INVALID_ARGUMENT.create({
        detail: "Environment fetch signal must be an AbortSignal",
      });
    }
    throwIfAborted(options.signal);
    const joinCohortKey = buildIdentityJoinCohortKey(options);
    const validatedProjectSlug = requireResolverArgument(
      options.projectSlug,
      "Project slug",
      PROJECT_SLUG_MAX_CODE_UNITS,
    );
    const projectAdmissionKey = stringToLowerCase(validatedProjectSlug);
    this.beginKeyBuild(joinCohortKey, projectAdmissionKey);
    let waiter!: Promise<ProjectEnvironmentIdentity>;
    try {
      const cacheKey = await buildIdentityCacheKey(options);
      throwIfAborted(options.signal);

      const cached = this.getResolved(cacheKey);
      if (cached) return cached;

      let flight = mapGet(this.inflight, cacheKey);
      if (flight && isAborted(getControllerSignal(flight.controller))) {
        if (mapGet(this.inflight, cacheKey) === flight) {
          mapDelete(this.inflight, cacheKey);
        }
        flight = undefined;
      }
      if (!flight) {
        flight = this.createFlight(
          cacheKey,
          joinCohortKey,
          projectAdmissionKey,
          options,
        );
      }
      waiter = this.waitForFlight(flight, options.signal);
    } finally {
      this.endKeyBuild(joinCohortKey, projectAdmissionKey);
    }
    return await waiter;
  }

  private getResolved(cacheKey: string): ProjectEnvironmentIdentity | undefined {
    const entry = mapGet(this.resolved, cacheKey);
    if (!entry) return undefined;
    if (entry.expiresAt <= monotonicNow()) {
      this.deleteResolved(cacheKey);
      return undefined;
    }
    mapDelete(this.resolved, cacheKey);
    mapSet(this.resolved, cacheKey, entry);
    return entry.value;
  }

  private setResolved(
    cacheKey: string,
    value: ProjectEnvironmentIdentity,
  ): void {
    const sizeCodeUnits = cacheKey.length + value.id.length + value.name.length +
      (typeof value.active_release_id === "string" ? value.active_release_id.length : 0);
    this.deleteResolved(cacheKey);
    while (
      mapSize(this.resolved) >= this.maxEntries ||
      this.resolvedCodeUnits + sizeCodeUnits > MAX_IDENTITY_CACHE_STRING_CODE_UNITS
    ) {
      const oldest = iteratorNext(mapKeys(this.resolved));
      if (oldest.done) break;
      this.deleteResolved(oldest.value);
    }
    mapSet(this.resolved, cacheKey, {
      value,
      expiresAt: monotonicNow() + this.ttlMs,
      sizeCodeUnits,
    });
    this.resolvedCodeUnits += sizeCodeUnits;
  }

  private deleteResolved(cacheKey: string): void {
    const existing = mapGet(this.resolved, cacheKey);
    if (!existing || !mapDelete(this.resolved, cacheKey)) return;
    this.resolvedCodeUnits = MathMax(
      0,
      this.resolvedCodeUnits - existing.sizeCodeUnits,
    );
  }

  private createFlight(
    cacheKey: string,
    joinCohortKey: string,
    projectAdmissionKey: string,
    options: ResolveProjectEnvironmentIdentityOptions,
  ): ProjectEnvironmentIdentityFlight {
    const controller = new IntrinsicAbortController();
    const sharedSignal = getControllerSignal(controller);
    const marker = ObjectFreeze({});
    this.admitDiscovery(projectAdmissionKey);
    let underlyingReleased = false;
    const releaseUnderlying = (): void => {
      if (underlyingReleased) return;
      underlyingReleased = true;
      this.releaseDiscovery(projectAdmissionKey);
    };

    const work = promiseThen(
      resolvedPromise,
      () =>
        resolveProjectEnvironmentIdentity({
          ...options,
          signal: sharedSignal,
        }),
    );
    const guardedWork = promiseThen(
      work,
      (identity) => {
        throwIfAborted(sharedSignal);
        if (mapGet(this.inflight, cacheKey)?.marker === marker) {
          this.setResolved(cacheKey, identity);
        }
        return identity;
      },
    );
    observePromise(guardedWork, releaseUnderlying, releaseUnderlying);

    const result = promiseWithResolvers<ProjectEnvironmentIdentity>();
    let visibleSettled = false;
    let listenerRegistered = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cleanupVisible = (): void => {
      if (timeoutId !== undefined) {
        cancelTimeout(timeoutId);
        timeoutId = undefined;
      }
      if (listenerRegistered) {
        removeAbortListener(sharedSignal, onAbort);
        listenerRegistered = false;
      }
    };
    const finishVisible = (settle: () => void): void => {
      if (visibleSettled) return;
      visibleSettled = true;
      cleanupVisible();
      settle();
    };
    const onAbort = (): void => {
      finishVisible(() => result.reject(getAbortReason(sharedSignal)));
    };

    try {
      addAbortListener(sharedSignal, onAbort);
      listenerRegistered = true;
      timeoutId = scheduleTimeout(() => {
        abortController(
          controller,
          SERVICE_OVERLOADED.create({
            detail: `Environment identity discovery exceeded ${this.fetchTimeoutMs} ms`,
            context: { code: "fetch-timeout" },
          }),
        );
      }, this.fetchTimeoutMs);
      if (isAborted(sharedSignal)) onAbort();
    } catch (error) {
      try {
        abortController(controller, error);
      } finally {
        finishVisible(() => result.reject(error));
      }
    }
    observePromise(
      guardedWork,
      (identity) => finishVisible(() => result.resolve(identity)),
      (error: unknown) => finishVisible(() => result.reject(error)),
    );

    const flight: ProjectEnvironmentIdentityFlight = {
      joinCohortKey,
      marker,
      controller,
      promise: result.promise,
      waiterCount: 0,
      settled: false,
    };
    const settle = (): void => {
      flight.settled = true;
      if (mapGet(this.inflight, cacheKey) === flight) {
        mapDelete(this.inflight, cacheKey);
      }
    };
    mapSet(this.inflight, cacheKey, flight);
    observePromise(result.promise, settle, settle);
    return flight;
  }

  private waitForFlight(
    flight: ProjectEnvironmentIdentityFlight,
    signal: AbortSignal,
  ): Promise<ProjectEnvironmentIdentity> {
    throwIfAborted(signal);
    flight.waiterCount += 1;

    return new IntrinsicPromise<ProjectEnvironmentIdentity>((resolve, reject) => {
      let waiterSettled = false;
      let listenerRegistered = false;
      const finish = (settleWaiter: () => void): void => {
        if (waiterSettled) return;
        waiterSettled = true;
        if (listenerRegistered) {
          removeAbortListener(signal, onAbort);
          listenerRegistered = false;
        }
        flight.waiterCount -= 1;
        settleWaiter();
        this.abortFlightIfOrphaned(flight);
      };
      const onAbort = (): void => {
        finish(() => reject(getAbortReason(signal)));
      };

      try {
        addAbortListener(signal, onAbort);
        listenerRegistered = true;
        if (isAborted(signal)) onAbort();
      } catch (error) {
        finish(() => reject(error));
      }
      observePromise(
        flight.promise,
        (identity) => finish(() => resolve(identity)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }

  private beginKeyBuild(
    joinCohortKey: string,
    projectAdmissionKey: string,
  ): void {
    if (this.pendingKeyBuilds >= this.maxInflight) {
      throw SERVICE_OVERLOADED.create({
        detail: "Environment identity cache-key capacity is exhausted",
      });
    }
    const pendingForProject = mapGet(this.pendingKeyBuildsByProject, projectAdmissionKey) ?? 0;
    if (pendingForProject >= this.maxInflightPerProject) {
      throw SERVICE_OVERLOADED.create({
        detail: "Environment identity cache-key capacity for this project is exhausted",
      });
    }

    this.pendingKeyBuilds += 1;
    mapSet(
      this.pendingKeyBuildsByProject,
      projectAdmissionKey,
      pendingForProject + 1,
    );
    mapSet(
      this.pendingKeyBuildsByCohort,
      joinCohortKey,
      (mapGet(this.pendingKeyBuildsByCohort, joinCohortKey) ?? 0) + 1,
    );
  }

  private endKeyBuild(
    joinCohortKey: string,
    projectAdmissionKey: string,
  ): void {
    this.pendingKeyBuilds -= 1;
    const pendingForProject = mapGet(this.pendingKeyBuildsByProject, projectAdmissionKey) ?? 1;
    if (pendingForProject <= 1) {
      mapDelete(this.pendingKeyBuildsByProject, projectAdmissionKey);
    } else {
      mapSet(this.pendingKeyBuildsByProject, projectAdmissionKey, pendingForProject - 1);
    }

    const pending = mapGet(this.pendingKeyBuildsByCohort, joinCohortKey);
    if (pending === undefined) return;
    if (pending > 1) {
      mapSet(this.pendingKeyBuildsByCohort, joinCohortKey, pending - 1);
      return;
    }

    mapDelete(this.pendingKeyBuildsByCohort, joinCohortKey);
    const flights = mapValues(this.inflight);
    while (true) {
      const step = iteratorNext(flights);
      if (step.done) break;
      const flight = step.value;
      if (flight.joinCohortKey === joinCohortKey) {
        this.abortFlightIfOrphaned(flight);
      }
    }
  }

  private admitDiscovery(projectAdmissionKey: string): void {
    if (this.activeDiscoveries >= this.maxInflight) {
      throw SERVICE_OVERLOADED.create({
        detail: "Environment identity discovery capacity is exhausted",
      });
    }
    const activeForProject = mapGet(this.activeDiscoveriesByProject, projectAdmissionKey) ?? 0;
    if (activeForProject >= this.maxInflightPerProject) {
      throw SERVICE_OVERLOADED.create({
        detail: "Environment identity discovery capacity for this project is exhausted",
      });
    }
    this.activeDiscoveries += 1;
    mapSet(
      this.activeDiscoveriesByProject,
      projectAdmissionKey,
      activeForProject + 1,
    );
  }

  private releaseDiscovery(projectAdmissionKey: string): void {
    this.activeDiscoveries = MathMax(0, this.activeDiscoveries - 1);
    const activeForProject = mapGet(this.activeDiscoveriesByProject, projectAdmissionKey) ?? 0;
    if (activeForProject <= 1) {
      mapDelete(this.activeDiscoveriesByProject, projectAdmissionKey);
    } else {
      mapSet(
        this.activeDiscoveriesByProject,
        projectAdmissionKey,
        activeForProject - 1,
      );
    }
  }

  private abortFlightIfOrphaned(
    flight: ProjectEnvironmentIdentityFlight,
  ): void {
    const sharedSignal = getControllerSignal(flight.controller);
    if (
      flight.waiterCount !== 0 ||
      flight.settled ||
      isAborted(sharedSignal) ||
      mapHas(this.pendingKeyBuildsByCohort, flight.joinCohortKey)
    ) {
      return;
    }
    abortController(
      flight.controller,
      new DOMException("Environment identity discovery has no waiters", "AbortError"),
    );
  }
}
