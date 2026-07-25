/**
 * Authoritative hosted-project source binding for ordinary proxy requests.
 *
 * The proxy forwards an operationally coherent project/environment/release
 * tuple, but those headers are not themselves an authorization boundary. This
 * module resolves bounded routing metadata with the request credential and
 * proves the complete tuple before hosted configuration or environment values
 * are consumed.
 *
 * @module server/project-env/proxy-routing-binding
 */

import {
  API_CLIENT_ERROR,
  INVALID_ARGUMENT,
  RESOURCE_NOT_FOUND,
  SERVICE_OVERLOADED,
  type VeryfrontError,
} from "#veryfront/errors";
import type { VirtualConfigSourceContext } from "#veryfront/cache/keys.ts";
import {
  isCanonicalProjectSlug,
  MAX_OPAQUE_ID_CODE_UNITS,
  MAX_PROJECT_SLUG_CODE_UNITS,
} from "#veryfront/utils/project-identity.ts";

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 1_000;
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_INFLIGHT = 100;
const DEFAULT_MAX_INFLIGHT_PER_PROJECT = 16;
const MAX_RESPONSE_BYTES = 512 * 1_024;
const MAX_ENVIRONMENTS = 1_000;
const MAX_DOMAINS_PER_ENVIRONMENT = 100;
const MAX_ENVIRONMENT_NAME_CODE_UNITS = 256;
const MAX_DOMAIN_CODE_UNITS = 253;
const MAX_BRANCH_CODE_UNITS = 1_024;
const MAX_TOKEN_CODE_UNITS = 16_384;
const MAX_API_BASE_URL_CODE_UNITS = 2_048;
const MAX_TTL_MS = 2_147_483_647;
const MAX_CONFIGURED_ENTRIES = 10_000;
const MAX_CONFIGURED_INFLIGHT = 10_000;
const MAX_CONFIGURED_TIMEOUT_MS = 300_000;
const HEX_DIGITS = "0123456789abcdef";
const IntrinsicAbortController = AbortController;
const IntrinsicAbortSignal = AbortSignal;
const IntrinsicArray = Array;
const IntrinsicMap = Map;
const IntrinsicNumber = Number;
const IntrinsicPromise = Promise;
const IntrinsicSet = Set;
const IntrinsicURL = URL;
const ArrayIsArray = Array.isArray;
const AbortControllerPrototypeAbort = AbortController.prototype.abort;
const AbortSignalPrototypeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const EventTargetPrototypeAddEventListener = EventTarget.prototype.addEventListener;
const EventTargetPrototypeRemoveEventListener = EventTarget.prototype.removeEventListener;
const MapPrototypeClear = Map.prototype.clear;
const MapPrototypeDelete = Map.prototype.delete;
const MapPrototypeEntries = Map.prototype.entries;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeHas = Map.prototype.has;
const MapPrototypeKeys = Map.prototype.keys;
const MapPrototypeSet = Map.prototype.set;
const PromisePrototypeThen = Promise.prototype.then;
const RegExpPrototypeTest = RegExp.prototype.test;
const SetPrototypeAdd = Set.prototype.add;
const SetPrototypeHas = Set.prototype.has;
const StringPrototypeReplace = String.prototype.replace;
const StringPrototypeToLocaleLowerCase = String.prototype.toLocaleLowerCase;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const StringPrototypeTrim = String.prototype.trim;
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
const NumberIsSafeInteger = Number.isSafeInteger;
const ObjectFreeze = Object.freeze;
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

type BindingFailureCode =
  | "capacity-exceeded"
  | "fetch-timeout"
  | "invalid-upstream-response"
  | "proxy-context-mismatch"
  | "upstream-http"
  | "upstream-network";

class BindingFailure extends Error {
  constructor(
    readonly code: BindingFailureCode,
    readonly status: number,
    message: string,
    options: { cause?: unknown; reason?: string } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProxyRoutingBindingFailure";
    this.reason = options.reason;
  }

  readonly reason?: string;
}

interface RoutingEnvironment {
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly domains: readonly string[];
  readonly activeReleaseId: string | null | undefined;
}

interface RoutingMetadata {
  readonly projectId: string;
  readonly projectSlug: string;
  readonly normalizedProjectSlug: string;
  readonly environments: readonly RoutingEnvironment[];
}

interface CacheEntry {
  readonly normalizedProjectSlug: string;
  readonly value: RoutingMetadata;
  readonly expiresAt: number;
}

interface InflightEntry {
  readonly marker: object;
  readonly normalizedProjectSlug: string;
  readonly controller: AbortController;
  readonly promise: Promise<RoutingMetadata>;
}

export type HostedProxyEnvironmentSelector =
  | Readonly<{ kind: "name"; name: string }>
  | Readonly<{ kind: "domain"; domain: string }>;

export interface HostedProxySourceBindingRequest {
  readonly projectSlug: string;
  readonly projectId: string | undefined;
  readonly environmentId: string | undefined;
  readonly selector: HostedProxyEnvironmentSelector;
  readonly mode: "preview" | "production";
  readonly releaseId: string | undefined;
  readonly branch: string | null | undefined;
  readonly token: string;
  readonly signal?: AbortSignal;
}

export interface HostedProxySourceBinding {
  readonly projectSlug: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly environmentName: string;
  readonly activeReleaseId: string | null | undefined;
  readonly sourceContext: Readonly<VirtualConfigSourceContext>;
}

export interface HostedProxyRoutingBindingCacheOptions {
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  readonly fetchTimeoutMs?: number;
  readonly maxInflight?: number;
  readonly maxInflightPerProject?: number;
}

interface ValidatedBindingRequest {
  readonly projectSlug: string;
  readonly normalizedProjectSlug: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly selector:
    | Readonly<{ kind: "name"; name: string; normalizedName: string }>
    | Readonly<{ kind: "domain"; domain: string }>;
  readonly mode: "preview" | "production";
  readonly releaseId: string | undefined;
  readonly branch: string | null;
  readonly token: string;
  readonly signal?: AbortSignal;
}

function getControllerSignal(controller: AbortController): AbortSignal {
  return ReflectApply(intrinsicAbortControllerSignalGetter, controller, []) as AbortSignal;
}

function abortController(controller: AbortController, reason: unknown): void {
  ReflectApply(AbortControllerPrototypeAbort, controller, [reason]);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal) {
    ReflectApply(AbortSignalPrototypeThrowIfAborted, signal, []);
  }
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

function mapClear<K, V>(map: Map<K, V>): void {
  ReflectApply(MapPrototypeClear, map, []);
}

function mapSize<K, V>(map: Map<K, V>): number {
  return ReflectApply(intrinsicMapSizeGetter, map, []) as number;
}

function mapEntries<K, V>(map: Map<K, V>): Iterator<[K, V]> {
  return ReflectApply(MapPrototypeEntries, map, []) as Iterator<[K, V]>;
}

function mapKeys<K, V>(map: Map<K, V>): Iterator<K> {
  return ReflectApply(MapPrototypeKeys, map, []) as Iterator<K>;
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

function stringToLocaleLowerCase(value: string, locale: string): string {
  return ReflectApply(
    StringPrototypeToLocaleLowerCase,
    value,
    [locale],
  ) as string;
}

function stringToLowerCase(value: string): string {
  return ReflectApply(StringPrototypeToLowerCase, value, []) as string;
}

function stringTrim(value: string): string {
  return ReflectApply(StringPrototypeTrim, value, []) as string;
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

function requireBoundedInteger(
  value: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (!NumberIsSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${field} must be ${minimum}-${maximum}`);
  }
  return value;
}

function requireString(
  value: unknown,
  field: string,
  maxCodeUnits: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxCodeUnits ||
    value !== stringTrim(value) ||
    regexpTest(/\p{Cc}/u, value)
  ) {
    throw INVALID_ARGUMENT.create({
      detail: `${field} must be a bounded non-empty string`,
    });
  }
  return value;
}

function requireUpstreamString(
  value: unknown,
  field: string,
  maxCodeUnits: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxCodeUnits ||
    value !== stringTrim(value) ||
    regexpTest(/\p{Cc}/u, value)
  ) {
    throw new BindingFailure(
      "invalid-upstream-response",
      502,
      `Proxy routing metadata returned an invalid ${field}`,
    );
  }
  return value;
}

function requireProjectSlug(value: unknown, field: string): string {
  const slug = requireString(value, field, MAX_PROJECT_SLUG_CODE_UNITS);
  if (!isCanonicalProjectSlug(slug)) {
    throw INVALID_ARGUMENT.create({
      detail: `${field} must be a valid project slug`,
    });
  }
  return slug;
}

function requireUpstreamProjectSlug(value: unknown): string {
  const slug = requireUpstreamString(
    value,
    "project slug",
    MAX_PROJECT_SLUG_CODE_UNITS,
  );
  if (!isCanonicalProjectSlug(slug)) {
    throw new BindingFailure(
      "invalid-upstream-response",
      502,
      "Proxy routing metadata returned an invalid project slug",
    );
  }
  return slug;
}

function normalizeName(value: string): string {
  return stringToLocaleLowerCase(value, "en-US");
}

function normalizeDomain(
  value: unknown,
  source: "request" | "upstream",
): string {
  const fail = (message: string): never => {
    if (source === "request") {
      throw INVALID_ARGUMENT.create({ detail: message });
    }
    throw new BindingFailure("invalid-upstream-response", 502, message);
  };

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_DOMAIN_CODE_UNITS + 8 ||
    value !== stringTrim(value) ||
    regexpTest(/[\p{Cc}\s/@?#]/u, value)
  ) {
    return fail(
      source === "request"
        ? "Source domain must be a valid bounded host"
        : "Proxy routing metadata returned an invalid environment domain",
    );
  }

  try {
    const parsed = new IntrinsicURL(`http://${value}`);
    if (
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.hostname.length === 0 ||
      parsed.hostname.length > MAX_DOMAIN_CODE_UNITS
    ) {
      return fail(
        source === "request"
          ? "Source domain must be a valid bounded host"
          : "Proxy routing metadata returned an invalid environment domain",
      );
    }
    return stringReplace(stringToLowerCase(parsed.hostname), /\.$/u, "");
  } catch {
    return fail(
      source === "request"
        ? "Source domain must be a valid bounded host"
        : "Proxy routing metadata returned an invalid environment domain",
    );
  }
}

function validateRequest(
  request: HostedProxySourceBindingRequest,
): ValidatedBindingRequest {
  if (
    request.signal !== undefined &&
    !(request.signal instanceof IntrinsicAbortSignal)
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Source binding signal must be an AbortSignal",
    });
  }
  if (request.mode !== "preview" && request.mode !== "production") {
    throw INVALID_ARGUMENT.create({
      detail: "Source mode must be preview or production",
    });
  }
  const projectSlug = requireProjectSlug(request.projectSlug, "Project slug");
  const projectId = requireString(
    request.projectId,
    "Project ID",
    MAX_OPAQUE_ID_CODE_UNITS,
  );
  const environmentId = requireString(
    request.environmentId,
    "Environment ID",
    MAX_OPAQUE_ID_CODE_UNITS,
  );
  const token = requireString(request.token, "API token", MAX_TOKEN_CODE_UNITS);
  const branch = request.branch === undefined || request.branch === null
    ? null
    : requireString(request.branch, "Branch", MAX_BRANCH_CODE_UNITS);

  let selector: ValidatedBindingRequest["selector"];
  if (request.selector.kind === "name") {
    const name = requireString(
      request.selector.name,
      "Source environment name",
      MAX_ENVIRONMENT_NAME_CODE_UNITS,
    );
    selector = { kind: "name", name, normalizedName: normalizeName(name) };
  } else {
    selector = {
      kind: "domain",
      domain: normalizeDomain(request.selector.domain, "request"),
    };
  }

  if (
    request.mode === "preview" &&
    (selector.kind !== "name" || selector.normalizedName !== "preview")
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Preview source binding requires the preview environment",
    });
  }

  const releaseId = request.mode === "production"
    ? requireString(
      request.releaseId,
      "Release ID",
      MAX_OPAQUE_ID_CODE_UNITS,
    )
    : request.releaseId === undefined
    ? undefined
    : requireString(request.releaseId, "Release ID", MAX_OPAQUE_ID_CODE_UNITS);

  throwIfAborted(request.signal);
  return {
    projectSlug,
    normalizedProjectSlug: stringToLowerCase(projectSlug),
    projectId,
    environmentId,
    selector,
    mode: request.mode,
    releaseId,
    branch,
    token,
    signal: request.signal,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !ArrayIsArray(value);
}

function parseRoutingMetadata(value: unknown): RoutingMetadata {
  if (!isRecord(value) || !ArrayIsArray(value.environments)) {
    throw new BindingFailure(
      "invalid-upstream-response",
      502,
      "Proxy routing metadata returned an invalid response envelope",
    );
  }
  if (value.environments.length > MAX_ENVIRONMENTS) {
    throw new BindingFailure(
      "invalid-upstream-response",
      502,
      "Proxy routing metadata returned too many environments",
    );
  }

  const projectId = requireUpstreamString(
    value.id,
    "project ID",
    MAX_OPAQUE_ID_CODE_UNITS,
  );
  const projectSlug = requireUpstreamProjectSlug(value.slug);
  const seenIds = new IntrinsicSet<string>();
  const seenNames = new IntrinsicSet<string>();
  const seenDomains = new IntrinsicSet<string>();
  const rawEnvironments = value.environments;
  const environments = new IntrinsicArray<RoutingEnvironment>(rawEnvironments.length);
  for (let index = 0; index < rawEnvironments.length; index += 1) {
    const rawEnvironment = rawEnvironments[index];
    if (!isRecord(rawEnvironment)) {
      throw new BindingFailure(
        "invalid-upstream-response",
        502,
        "Proxy routing metadata returned an invalid environment",
      );
    }
    const id = requireUpstreamString(
      rawEnvironment.id,
      "environment ID",
      MAX_OPAQUE_ID_CODE_UNITS,
    );
    const name = requireUpstreamString(
      rawEnvironment.name,
      "environment name",
      MAX_ENVIRONMENT_NAME_CODE_UNITS,
    );
    const normalizedName = normalizeName(name);
    if (setHas(seenIds, id) || setHas(seenNames, normalizedName)) {
      throw new BindingFailure(
        "invalid-upstream-response",
        502,
        "Proxy routing metadata returned duplicate environment identities",
      );
    }
    setAdd(seenIds, id);
    setAdd(seenNames, normalizedName);

    let domains: readonly string[] = ObjectFreeze(new IntrinsicArray<string>());
    if (rawEnvironment.domains !== undefined) {
      if (
        !ArrayIsArray(rawEnvironment.domains) ||
        rawEnvironment.domains.length > MAX_DOMAINS_PER_ENVIRONMENT
      ) {
        throw new BindingFailure(
          "invalid-upstream-response",
          502,
          "Proxy routing metadata returned invalid environment domains",
        );
      }
      const rawDomains = rawEnvironment.domains;
      const parsedDomains = new IntrinsicArray<string>(rawDomains.length);
      for (let domainIndex = 0; domainIndex < rawDomains.length; domainIndex += 1) {
        const domain = rawDomains[domainIndex];
        const normalized = normalizeDomain(domain, "upstream");
        if (setHas(seenDomains, normalized)) {
          throw new BindingFailure(
            "invalid-upstream-response",
            502,
            "Proxy routing metadata returned duplicate environment domains",
          );
        }
        setAdd(seenDomains, normalized);
        parsedDomains[domainIndex] = normalized;
      }
      domains = ObjectFreeze(parsedDomains);
    }

    let activeReleaseId: string | null | undefined;
    if (rawEnvironment.active_release_id === null) {
      activeReleaseId = null;
    } else if (rawEnvironment.active_release_id !== undefined) {
      activeReleaseId = requireUpstreamString(
        rawEnvironment.active_release_id,
        "active release ID",
        MAX_OPAQUE_ID_CODE_UNITS,
      );
    }

    environments[index] = ObjectFreeze({
      id,
      name,
      normalizedName,
      domains,
      activeReleaseId,
    });
  }

  return ObjectFreeze({
    projectId,
    projectSlug,
    normalizedProjectSlug: stringToLowerCase(projectSlug),
    environments: ObjectFreeze(environments),
  });
}

async function cancelResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup; the primary protocol error wins.
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!regexpTest(/^\d+$/u, contentLength)) {
      await cancelResponse(response);
      throw new BindingFailure(
        "invalid-upstream-response",
        502,
        "Proxy routing metadata returned an invalid Content-Length",
      );
    }
    const declaredBytes = IntrinsicNumber(contentLength);
    if (
      !NumberIsSafeInteger(declaredBytes) ||
      declaredBytes > MAX_RESPONSE_BYTES
    ) {
      await cancelResponse(response);
      throw new BindingFailure(
        "invalid-upstream-response",
        502,
        "Proxy routing metadata exceeded the response size limit",
      );
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new BindingFailure(
      "invalid-upstream-response",
      502,
      "Proxy routing metadata returned an empty body",
    );
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Best-effort cleanup; preserve the bounded-response failure.
        }
        throw new BindingFailure(
          "invalid-upstream-response",
          502,
          "Proxy routing metadata exceeded the response size limit",
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
    throw new BindingFailure(
      "invalid-upstream-response",
      502,
      "Proxy routing metadata returned invalid UTF-8",
      { cause: error },
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new BindingFailure(
      "invalid-upstream-response",
      502,
      "Proxy routing metadata returned invalid JSON",
      { cause: error },
    );
  }
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
  const bytes = new Uint8Array(digest);
  let fingerprint = "";
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!;
    fingerprint += HEX_DIGITS[byte >>> 4]! + HEX_DIGITS[byte & 0x0f]!;
  }
  return fingerprint;
}

function buildCacheKey(
  normalizedProjectSlug: string,
  tokenFingerprint: string,
): string {
  return `${normalizedProjectSlug.length}:${normalizedProjectSlug}${tokenFingerprint}`;
}

function waitForSharedPromise<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new IntrinsicPromise<T>((resolve, reject) => {
    let settled = false;
    let listenerRegistered = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      if (listenerRegistered) {
        removeAbortListener(signal, onAbort);
        listenerRegistered = false;
      }
      callback();
    };
    const onAbort = (): void => {
      finish(() =>
        reject(
          isAborted(signal) ? getSignalReason(signal) : new DOMException("Aborted", "AbortError"),
        )
      );
    };
    try {
      addAbortListener(signal, onAbort);
      listenerRegistered = true;
      if (isAborted(signal)) onAbort();
    } catch (error) {
      finish(() => reject(error));
    }
    observePromise(
      promise,
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function createMismatch(reason: string): BindingFailure {
  return new BindingFailure(
    "proxy-context-mismatch",
    502,
    "Proxy context did not match authoritative routing metadata",
    { reason },
  );
}

function bindMetadata(
  metadata: RoutingMetadata,
  request: ValidatedBindingRequest,
): HostedProxySourceBinding {
  if (
    metadata.normalizedProjectSlug !== request.normalizedProjectSlug ||
    metadata.projectId !== request.projectId
  ) {
    throw createMismatch("project");
  }

  const selector = request.selector;
  let environment: RoutingEnvironment | undefined;
  for (let index = 0; index < metadata.environments.length; index += 1) {
    const candidate = metadata.environments[index]!;
    let matches = false;
    if (selector.kind === "name") {
      matches = candidate.normalizedName === selector.normalizedName;
    } else {
      for (let domainIndex = 0; domainIndex < candidate.domains.length; domainIndex += 1) {
        if (candidate.domains[domainIndex] === selector.domain) {
          matches = true;
          break;
        }
      }
    }
    if (matches) {
      environment = candidate;
      break;
    }
  }
  if (!environment) throw createMismatch("environment-selector");
  if (environment.id !== request.environmentId) {
    throw createMismatch("environment-id");
  }
  if (
    request.mode === "production" &&
    environment.activeReleaseId !== request.releaseId
  ) {
    throw createMismatch("active-release");
  }

  const sourceContext: Readonly<VirtualConfigSourceContext> = request.mode === "production"
    ? ObjectFreeze({
      productionMode: true,
      releaseId: request.releaseId ?? null,
      environmentName: environment.name,
    })
    : ObjectFreeze({
      productionMode: false,
      branch: request.branch,
    });

  return ObjectFreeze({
    projectSlug: metadata.projectSlug,
    projectId: metadata.projectId,
    environmentId: environment.id,
    environmentName: environment.name,
    activeReleaseId: environment.activeReleaseId,
    sourceContext,
  });
}

function toPublicError(error: BindingFailure): VeryfrontError {
  const context = {
    code: error.code,
    ...(error.reason === undefined ? {} : { reason: error.reason }),
  };
  if (error.code === "capacity-exceeded" || error.code === "fetch-timeout") {
    return SERVICE_OVERLOADED.create({
      detail: error.message,
      cause: error.cause,
      context,
    });
  }
  if (error.status === 404) {
    return RESOURCE_NOT_FOUND.create({
      detail: "Authoritative proxy routing metadata was not found",
      cause: error.cause,
      context,
    });
  }
  return API_CLIENT_ERROR.create({
    status: error.status,
    detail: error.message,
    cause: error.cause,
    context,
  });
}

/**
 * Bounded process-local cache for authoritative proxy routing metadata.
 *
 * Shared fetches use their own timeout signal. A request abort only cancels
 * that waiter, never work needed by other requests for the same capability.
 */
export class HostedProxyRoutingBindingCache {
  private readonly cache = new IntrinsicMap<string, CacheEntry>();
  private readonly inflight = new IntrinsicMap<string, InflightEntry>();
  private readonly activeByProject = new IntrinsicMap<string, number>();
  private readonly activeKeyBuildsByProject = new IntrinsicMap<string, number>();
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly fetchTimeoutMs: number;
  private readonly maxInflight: number;
  private readonly maxInflightPerProject: number;
  private activeFetches = 0;
  private activeKeyBuilds = 0;

  constructor(
    apiBaseUrl: string,
    fetchImpl: typeof globalThis.fetch = globalThis.fetch,
    options: HostedProxyRoutingBindingCacheOptions = {},
  ) {
    const boundedBaseUrl = requireString(
      apiBaseUrl,
      "API base URL",
      MAX_API_BASE_URL_CODE_UNITS,
    );
    const normalizedBaseUrl = stringReplace(boundedBaseUrl, /\/+$/u, "");
    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new IntrinsicURL(normalizedBaseUrl);
    } catch (error) {
      throw new TypeError("API base URL must be a valid HTTP(S) URL", {
        cause: error,
      });
    }
    if (
      (parsedBaseUrl.protocol !== "https:" && parsedBaseUrl.protocol !== "http:") ||
      parsedBaseUrl.username !== "" ||
      parsedBaseUrl.password !== "" ||
      parsedBaseUrl.search !== "" ||
      parsedBaseUrl.hash !== ""
    ) {
      throw new TypeError(
        "API base URL must be an HTTP(S) URL without credentials, query, or fragment",
      );
    }
    if (typeof fetchImpl !== "function") {
      throw new TypeError("Proxy routing fetch must be a function");
    }

    this.apiBaseUrl = normalizedBaseUrl;
    this.fetchImpl = fetchImpl;
    this.ttlMs = requireBoundedInteger(
      options.ttlMs ?? DEFAULT_TTL_MS,
      "ttlMs",
      0,
      MAX_TTL_MS,
    );
    this.maxEntries = requireBoundedInteger(
      options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      "maxEntries",
      1,
      MAX_CONFIGURED_ENTRIES,
    );
    this.fetchTimeoutMs = requireBoundedInteger(
      options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
      "fetchTimeoutMs",
      1,
      MAX_CONFIGURED_TIMEOUT_MS,
    );
    this.maxInflight = requireBoundedInteger(
      options.maxInflight ?? DEFAULT_MAX_INFLIGHT,
      "maxInflight",
      1,
      MAX_CONFIGURED_INFLIGHT,
    );
    this.maxInflightPerProject = requireBoundedInteger(
      options.maxInflightPerProject ??
        MathMin(DEFAULT_MAX_INFLIGHT_PER_PROJECT, this.maxInflight),
      "maxInflightPerProject",
      1,
      this.maxInflight,
    );
  }

  async resolve(
    input: HostedProxySourceBindingRequest,
  ): Promise<HostedProxySourceBinding> {
    const request = validateRequest(input);
    try {
      this.admitKeyBuild(request.normalizedProjectSlug);
      let tokenFingerprint: string;
      try {
        tokenFingerprint = await fingerprintToken(request.token);
        throwIfAborted(request.signal);
      } finally {
        this.releaseKeyBuild(request.normalizedProjectSlug);
      }
      const cacheKey = buildCacheKey(
        request.normalizedProjectSlug,
        tokenFingerprint,
      );
      const first = await this.getMetadata(cacheKey, request, false);
      try {
        return bindMetadata(first, request);
      } catch (error) {
        if (!(error instanceof BindingFailure) || error.code !== "proxy-context-mismatch") {
          throw error;
        }
        const refreshed = await this.getMetadata(cacheKey, request, true);
        return bindMetadata(refreshed, request);
      }
    } catch (error) {
      if (error instanceof BindingFailure) throw toPublicError(error);
      throw error;
    }
  }

  invalidate(projectSlug?: string): void {
    if (projectSlug === undefined) {
      mapClear(this.cache);
      mapClear(this.inflight);
      return;
    }
    const normalized = stringToLowerCase(requireProjectSlug(projectSlug, "Project slug"));
    const cacheEntries = mapEntries(this.cache);
    while (true) {
      const step = iteratorNext(cacheEntries);
      if (step.done) break;
      const [key, entry] = step.value;
      if (entry.normalizedProjectSlug === normalized) mapDelete(this.cache, key);
    }
    const inflightEntries = mapEntries(this.inflight);
    while (true) {
      const step = iteratorNext(inflightEntries);
      if (step.done) break;
      const [key, entry] = step.value;
      if (entry.normalizedProjectSlug === normalized) mapDelete(this.inflight, key);
    }
  }

  private async getMetadata(
    cacheKey: string,
    request: ValidatedBindingRequest,
    forceRefresh: boolean,
  ): Promise<RoutingMetadata> {
    throwIfAborted(request.signal);
    if (forceRefresh) mapDelete(this.cache, cacheKey);
    if (!forceRefresh && this.ttlMs > 0) {
      const cached = mapGet(this.cache, cacheKey);
      if (cached) {
        if (cached.expiresAt > monotonicNow()) {
          mapDelete(this.cache, cacheKey);
          mapSet(this.cache, cacheKey, cached);
          return cached.value;
        }
        mapDelete(this.cache, cacheKey);
      }
    }

    let existing = mapGet(this.inflight, cacheKey);
    if (existing && isAborted(getControllerSignal(existing.controller))) {
      if (mapGet(this.inflight, cacheKey) === existing) {
        mapDelete(this.inflight, cacheKey);
      }
      existing = undefined;
    }
    if (existing) {
      return await waitForSharedPromise(existing.promise, request.signal);
    }

    const controller = new IntrinsicAbortController();
    const sharedSignal = getControllerSignal(controller);
    const marker = ObjectFreeze({});
    this.admit(request.normalizedProjectSlug);
    let underlyingReleased = false;
    const releaseUnderlying = (): void => {
      if (underlyingReleased) return;
      underlyingReleased = true;
      this.release(request.normalizedProjectSlug);
    };
    const work = promiseThen(
      resolvedPromise,
      () => this.fetchMetadata(request, sharedSignal),
    );
    const guardedWork = promiseThen(
      work,
      (value) => {
        throwIfAborted(sharedSignal);
        return value;
      },
    );
    observePromise(guardedWork, releaseUnderlying, releaseUnderlying);

    const promise = promiseThen(
      this.raceWithFetchDeadline(guardedWork, controller),
      (value) => {
        if (mapGet(this.inflight, cacheKey)?.marker === marker) {
          this.store(cacheKey, request.normalizedProjectSlug, value);
        }
        return value;
      },
    );
    const removeSettledFlight = (): void => {
      if (mapGet(this.inflight, cacheKey)?.marker === marker) {
        mapDelete(this.inflight, cacheKey);
      }
    };
    observePromise(promise, removeSettledFlight, removeSettledFlight);
    mapSet(this.inflight, cacheKey, {
      marker,
      normalizedProjectSlug: request.normalizedProjectSlug,
      controller,
      promise,
    });
    return await waitForSharedPromise(promise, request.signal);
  }

  private raceWithFetchDeadline(
    work: Promise<RoutingMetadata>,
    controller: AbortController,
  ): Promise<RoutingMetadata> {
    const signal = getControllerSignal(controller);
    const result = promiseWithResolvers<RoutingMetadata>();
    let settled = false;
    let listenerRegistered = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timeoutId !== undefined) {
        cancelTimeout(timeoutId);
        timeoutId = undefined;
      }
      if (listenerRegistered) {
        removeAbortListener(signal, onAbort);
        listenerRegistered = false;
      }
    };
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      settle();
    };
    const onAbort = (): void => {
      finish(() => result.reject(getSignalReason(signal)));
    };

    try {
      addAbortListener(signal, onAbort);
      listenerRegistered = true;
      timeoutId = scheduleTimeout(() => {
        abortController(
          controller,
          new BindingFailure(
            "fetch-timeout",
            503,
            "Proxy routing metadata request timed out",
          ),
        );
      }, this.fetchTimeoutMs);
      if (isAborted(signal)) onAbort();
    } catch (error) {
      try {
        abortController(controller, error);
      } finally {
        finish(() => result.reject(error));
      }
    }
    observePromise(
      work,
      (value) => finish(() => result.resolve(value)),
      (error: unknown) => finish(() => result.reject(error)),
    );
    return result.promise;
  }

  private admit(normalizedProjectSlug: string): void {
    if (this.activeFetches >= this.maxInflight) {
      throw new BindingFailure(
        "capacity-exceeded",
        503,
        "Proxy routing metadata capacity is exhausted",
      );
    }
    const activeForProject = mapGet(this.activeByProject, normalizedProjectSlug) ?? 0;
    if (activeForProject >= this.maxInflightPerProject) {
      throw new BindingFailure(
        "capacity-exceeded",
        503,
        "Proxy routing metadata project capacity is exhausted",
      );
    }
    this.activeFetches += 1;
    mapSet(this.activeByProject, normalizedProjectSlug, activeForProject + 1);
  }

  private release(normalizedProjectSlug: string): void {
    this.activeFetches = MathMax(0, this.activeFetches - 1);
    const activeForProject = mapGet(this.activeByProject, normalizedProjectSlug) ?? 0;
    if (activeForProject <= 1) mapDelete(this.activeByProject, normalizedProjectSlug);
    else mapSet(this.activeByProject, normalizedProjectSlug, activeForProject - 1);
  }

  private admitKeyBuild(normalizedProjectSlug: string): void {
    if (this.activeKeyBuilds >= this.maxInflight) {
      throw new BindingFailure(
        "capacity-exceeded",
        503,
        "Proxy routing cache-key capacity is exhausted",
      );
    }
    const activeForProject = mapGet(this.activeKeyBuildsByProject, normalizedProjectSlug) ?? 0;
    if (activeForProject >= this.maxInflightPerProject) {
      throw new BindingFailure(
        "capacity-exceeded",
        503,
        "Proxy routing cache-key capacity for this project is exhausted",
      );
    }
    this.activeKeyBuilds += 1;
    mapSet(
      this.activeKeyBuildsByProject,
      normalizedProjectSlug,
      activeForProject + 1,
    );
  }

  private releaseKeyBuild(normalizedProjectSlug: string): void {
    this.activeKeyBuilds = MathMax(0, this.activeKeyBuilds - 1);
    const activeForProject = mapGet(this.activeKeyBuildsByProject, normalizedProjectSlug) ?? 0;
    if (activeForProject <= 1) {
      mapDelete(this.activeKeyBuildsByProject, normalizedProjectSlug);
    } else {
      mapSet(
        this.activeKeyBuildsByProject,
        normalizedProjectSlug,
        activeForProject - 1,
      );
    }
  }

  private store(
    cacheKey: string,
    normalizedProjectSlug: string,
    value: RoutingMetadata,
  ): void {
    if (this.ttlMs <= 0) return;
    if (!mapHas(this.cache, cacheKey)) {
      while (mapSize(this.cache) >= this.maxEntries) {
        const oldestKey = iteratorNext(mapKeys(this.cache)).value;
        if (oldestKey === undefined) break;
        mapDelete(this.cache, oldestKey);
      }
    } else {
      mapDelete(this.cache, cacheKey);
    }
    mapSet(this.cache, cacheKey, {
      normalizedProjectSlug,
      value,
      expiresAt: monotonicNow() + this.ttlMs,
    });
  }

  private async fetchMetadata(
    request: ValidatedBindingRequest,
    signal: AbortSignal,
  ): Promise<RoutingMetadata> {
    const url = `${this.apiBaseUrl}/projects/-/proxy-routing/${
      encodeURIComponent(request.projectSlug)
    }`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${request.token}`,
          Accept: "application/json",
        },
        signal,
      });
    } catch (error) {
      const abortReason = isAborted(signal) ? getSignalReason(signal) : undefined;
      if (abortReason instanceof BindingFailure) throw abortReason;
      throw new BindingFailure(
        "upstream-network",
        502,
        "Proxy routing metadata request failed",
        { cause: error },
      );
    }

    if (!response.ok) {
      await cancelResponse(response);
      const status = response.status === 401 || response.status === 403 ||
          response.status === 404 || response.status === 429
        ? response.status
        : 502;
      throw new BindingFailure(
        "upstream-http",
        status,
        status === 404
          ? "Proxy routing metadata was not found"
          : "Proxy routing metadata request was rejected",
      );
    }
    try {
      return parseRoutingMetadata(await readBoundedJson(response));
    } catch (error) {
      if (error instanceof BindingFailure) throw error;
      const abortReason = isAborted(signal) ? getSignalReason(signal) : undefined;
      if (abortReason instanceof BindingFailure) throw abortReason;
      throw new BindingFailure(
        "upstream-network",
        502,
        "Proxy routing metadata response could not be read",
        { cause: error },
      );
    }
  }
}
