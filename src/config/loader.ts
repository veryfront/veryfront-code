import type { VeryfrontConfig } from "./schemas/index.ts";
import { validateVeryfrontConfig } from "./schemas/index.ts";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  toFileUrl,
} from "#veryfront/compat/path/index.ts";
import { runtimeUsesWindowsPaths } from "#veryfront/platform/compat/path/portable.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  isExtendedFSAdapter,
  isVirtualFilesystem,
} from "#veryfront/platform/adapters/fs/wrapper.ts";
import { isBun, isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { ESBUILD_WASM_URL } from "#veryfront/platform/compat/esbuild-shared.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { sanitizeUrlCredentials } from "#veryfront/utils/logger/redact.ts";
import { isValidServerExternalPackageName } from "./server-external-packages.ts";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { DEFAULT_CACHE_DIR } from "#veryfront/utils/constants/server.ts";
import { buildConfigCacheKey, type VirtualConfigSourceContext } from "#veryfront/cache/keys.ts";
import { DEFAULT_PORT, DEFAULT_RENDER_CACHE_MAX_ENTRIES } from "./defaults.ts";
import { createFileSystem, isNotFoundError, realPath } from "#veryfront/platform/compat/fs.ts";
import {
  CACHE_INVARIANT_VIOLATION,
  CONFIG_PARSE_ERROR,
  CONFIG_VALIDATION_FAILED,
  DEPENDENCY_MISSING,
  INITIALIZATION_ERROR,
  SERVICE_OVERLOADED,
} from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { getHostEnv } from "#veryfront/platform/compat/process/env.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache/registry.ts";
import { VERYFRONT_CONFIG_FILES } from "./config-files.ts";
import { currentRequestContext } from "#veryfront/platform/request-context-access.ts";
import type { ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";
import type { ASTNode } from "#veryfront/extensions/parser/index.ts";
import { tryResolve as tryResolveContract } from "#veryfront/extensions/contracts.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import { parseBarePackageSpecifier } from "#veryfront/transforms/shared/package-specifier.ts";
import { NODE_BUILTINS } from "#veryfront/transforms/import-rewriter/node-builtins.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { VERYFRONT_CONFIG_SHIM_URL } from "./config-shim.ts";
import {
  createPreparedDeclarativeConfigWorkerPayload,
  DeclarativeConfigEvaluationError,
  type DeclarativeConfigFileName,
  type PreparedDeclarativeConfigContext,
  type PreparedDeclarativeConfigWorkerPayload,
  prepareDeclarativeConfigContext,
} from "./declarative-evaluator.ts";
import {
  DECLARATIVE_CONFIG_WORKER_ADMISSION_LIMITS,
  evaluatePreparedDeclarativeConfigInWorker,
} from "./declarative-evaluator-worker-runner.ts";
import { createDeclarativeConfigWorkerInfrastructureError } from "./declarative-evaluator-worker-protocol.ts";
import { describeHostedConfigRejection } from "./hosted-compatibility.ts";

// Capture the collection and reflection intrinsics before trusted executable
// project configuration can mutate the shared host realm. Hosted configuration
// crosses a tenant boundary later in the same process, so its cache identity,
// singleflight state, and immutable result must not depend on ambient methods.
const IntrinsicMap = Map;
const IntrinsicSet = Set;
const ArrayIsArray = Array.isArray;
const IntrinsicPromise = Promise;
const IntrinsicString = String;
const IntrinsicTextDecoder = TextDecoder;
const IntrinsicErrorPrototype = Error.prototype;
const IntrinsicObjectPrototype = Object.prototype;
const IntrinsicWeakMap = WeakMap;
const IntrinsicWeakSet = WeakSet;
const IntrinsicAbortController = AbortController;
const IntrinsicURL = URL;
const EncodeURIComponent = encodeURIComponent;
const JSONParse = JSON.parse;
const JSONStringify = JSON.stringify;
const DecodeURIComponent = decodeURIComponent;
const AbortControllerPrototypeAbort = AbortController.prototype.abort;
const EventTargetPrototypeAddEventListener = EventTarget.prototype.addEventListener;
const EventTargetPrototypeRemoveEventListener = EventTarget.prototype.removeEventListener;
const MapPrototypeClear = Map.prototype.clear;
const MapPrototypeDelete = Map.prototype.delete;
const MapPrototypeForEach = Map.prototype.forEach;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeSet = Map.prototype.set;
const NumberPrototypeToString = Number.prototype.toString;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectIsFrozen = Object.isFrozen;
const PromisePrototypeThen = Promise.prototype.then;
const PromiseReject = Promise.reject;
const PromiseResolve = Promise.resolve;
const PromiseWithResolvers = Promise.withResolvers;
const ReflectApply = Reflect.apply;
const RegExpPrototypeExec = RegExp.prototype.exec;
const ReflectGet = Reflect.get;
const ReflectSet = Reflect.set;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeEndsWith = String.prototype.endsWith;
const StringPrototypeReplaceAll = String.prototype.replaceAll;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeSplit = String.prototype.split;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const StringPrototypeTrim = String.prototype.trim;
const SetPrototypeAdd = Set.prototype.add;
const SetPrototypeForEach = Set.prototype.forEach;
const SetPrototypeHas = Set.prototype.has;
const ReflectDeleteProperty = Reflect.deleteProperty;
const ReflectOwnKeys = Reflect.ownKeys;
const SymbolToPrimitive = Symbol.toPrimitive;
const SymbolSpecies = Symbol.species;
const SymbolToStringTag = Symbol.toStringTag;
const TextDecoderPrototypeDecode = TextDecoder.prototype.decode;
const WeakMapPrototypeGet = WeakMap.prototype.get;
const WeakMapPrototypeSet = WeakMap.prototype.set;
const WeakSetPrototypeAdd = WeakSet.prototype.add;
const WeakSetPrototypeHas = WeakSet.prototype.has;
const bunDescriptor = ObjectGetOwnPropertyDescriptor(globalThis, "Bun");
const CapturedBun = bunDescriptor && "value" in bunDescriptor ? bunDescriptor.value : undefined;
const bunResolveSyncDescriptor = typeof CapturedBun === "object" && CapturedBun !== null
  ? ObjectGetOwnPropertyDescriptor(CapturedBun, "resolveSync")
  : undefined;
const CapturedBunResolveSync = bunResolveSyncDescriptor && "value" in bunResolveSyncDescriptor &&
    typeof bunResolveSyncDescriptor.value === "function"
  ? bunResolveSyncDescriptor.value as (specifier: string, from: string) => string
  : undefined;
const abortControllerSignalGetter = ObjectGetOwnPropertyDescriptor(
  AbortController.prototype,
  "signal",
)?.get;
const abortSignalAbortedGetter = ObjectGetOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const mapSizeGetter = ObjectGetOwnPropertyDescriptor(Map.prototype, "size")?.get;
const urlHrefGetter = ObjectGetOwnPropertyDescriptor(URL.prototype, "href")?.get;
const urlHostnameGetter = ObjectGetOwnPropertyDescriptor(URL.prototype, "hostname")?.get;
const urlPathnameGetter = ObjectGetOwnPropertyDescriptor(URL.prototype, "pathname")?.get;
const urlProtocolGetter = ObjectGetOwnPropertyDescriptor(URL.prototype, "protocol")?.get;

if (
  typeof abortControllerSignalGetter !== "function" ||
  typeof abortSignalAbortedGetter !== "function" ||
  typeof mapSizeGetter !== "function" ||
  typeof urlHrefGetter !== "function" ||
  typeof urlHostnameGetter !== "function" ||
  typeof urlPathnameGetter !== "function" ||
  typeof urlProtocolGetter !== "function"
) {
  throw new TypeError("Loader lifecycle intrinsics are unavailable");
}
const intrinsicAbortControllerSignalGetter = abortControllerSignalGetter as () => AbortSignal;
const intrinsicAbortSignalAbortedGetter = abortSignalAbortedGetter as () => boolean;
const intrinsicMapSizeGetter = mapSizeGetter as () => number;
const intrinsicUrlHrefGetter = urlHrefGetter as () => string;
const intrinsicUrlHostnameGetter = urlHostnameGetter as () => string;
const intrinsicUrlPathnameGetter = urlPathnameGetter as () => string;
const intrinsicUrlProtocolGetter = urlProtocolGetter as () => string;
const HOSTED_CONFIG_TEXT_DECODER_OPTIONS = createHostedConfigTextDecoderOptions();
const ABORT_LISTENER_OPTIONS = createAbortListenerOptions();
const SAFE_PROMISE_SPECIES_HOLDER = createSafePromiseSpeciesHolder();
const NODE_BUILTIN_PACKAGE_NAMES: ReadonlySet<string> = new IntrinsicSet(NODE_BUILTINS);

type RuntimeReflectionRecord = Record<PropertyKey, unknown>;

function freezeObject<T>(value: T): T {
  return ReflectApply(ObjectFreeze, Object, [value]) as T;
}

function getOwnPropertyDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  return ReflectApply(ObjectGetOwnPropertyDescriptor, Object, [value, key]) as
    | PropertyDescriptor
    | undefined;
}

function getPrototypeOf(value: object): object | null {
  return ReflectApply(ObjectGetPrototypeOf, Object, [value]) as object | null;
}

function isFrozen(value: object): boolean {
  return ReflectApply(ObjectIsFrozen, Object, [value]) as boolean;
}

function ownKeys(value: object): PropertyKey[] {
  return ReflectApply(ReflectOwnKeys, Reflect, [value]) as PropertyKey[];
}

function stringStartsWith(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeStartsWith, value, [search]) as boolean;
}

function stringIncludes(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeIncludes, value, [search]) as boolean;
}

function stringEndsWith(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeEndsWith, value, [search]) as boolean;
}

function stringIndexOf(value: string, search: string, position?: number): number {
  return ReflectApply(StringPrototypeIndexOf, value, [search, position]) as number;
}

function stringSlice(value: string, start: number, end?: number): string {
  return ReflectApply(StringPrototypeSlice, value, [start, end]) as string;
}

function reflectGet(value: RuntimeReflectionRecord, key: PropertyKey): unknown {
  return ReflectApply(ReflectGet, Reflect, [value, key]) as unknown;
}

function mapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  return ReflectApply(MapPrototypeGet, map, [key]) as V | undefined;
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  ReflectApply(MapPrototypeSet, map, [key, value]);
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

function mapForEach<K, V>(
  map: Map<K, V>,
  callback: (value: V, key: K) => void,
): void {
  ReflectApply(MapPrototypeForEach, map, [callback]);
}

function weakMapGet<K extends object, V>(
  map: WeakMap<K, V>,
  key: K,
): V | undefined {
  return ReflectApply(WeakMapPrototypeGet, map, [key]) as V | undefined;
}

function weakMapSet<K extends object, V>(
  map: WeakMap<K, V>,
  key: K,
  value: V,
): void {
  ReflectApply(WeakMapPrototypeSet, map, [key, value]);
}

function weakSetHas<T extends object>(set: WeakSet<T>, value: T): boolean {
  return ReflectApply(WeakSetPrototypeHas, set, [value]) as boolean;
}

function weakSetAdd<T extends object>(set: WeakSet<T>, value: T): void {
  ReflectApply(WeakSetPrototypeAdd, set, [value]);
}

function createNullPrototypeDescriptor(): PropertyDescriptor {
  return ReflectApply(ObjectCreate, Object, [null]) as PropertyDescriptor;
}

function createNullPrototypeRecord<T extends object>(): T {
  return ReflectApply(ObjectCreate, Object, [null]) as T;
}

function defineOwnDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  const descriptor = createNullPrototypeDescriptor();
  descriptor.value = value;
  descriptor.writable = false;
  descriptor.enumerable = false;
  descriptor.configurable = false;
  ReflectApply(ObjectDefineProperty, Object, [target, key, descriptor]);
}

function defineOwnTemporaryDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  const descriptor = createNullPrototypeDescriptor();
  descriptor.value = value;
  descriptor.writable = false;
  descriptor.enumerable = false;
  descriptor.configurable = true;
  ReflectApply(ObjectDefineProperty, Object, [target, key, descriptor]);
}

function defineOwnGetterProperty(
  target: object,
  key: PropertyKey,
  getter: () => unknown,
): void {
  const descriptor = createNullPrototypeDescriptor();
  descriptor.get = getter;
  descriptor.enumerable = false;
  descriptor.configurable = false;
  ReflectApply(ObjectDefineProperty, Object, [target, key, descriptor]);
}

function createHostedConfigTextDecoderOptions(): TextDecoderOptions {
  const options = createNullPrototypeRecord<TextDecoderOptions>();
  defineOwnDataProperty(options, "fatal", true);
  defineOwnDataProperty(options, "ignoreBOM", false);
  return freezeObject(options);
}

function createAbortListenerOptions(): AddEventListenerOptions {
  const options = createNullPrototypeRecord<AddEventListenerOptions>();
  defineOwnDataProperty(options, "capture", false);
  defineOwnDataProperty(options, "once", true);
  defineOwnDataProperty(options, "passive", false);
  return freezeObject(options);
}

function createSafePromiseSpeciesHolder(): object {
  const holder = createNullPrototypeRecord<object>();
  defineOwnDataProperty(holder, SymbolSpecies, IntrinsicPromise);
  return freezeObject(holder);
}

function restoreOwnPropertyDescriptor(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): void {
  const safeDescriptor = createNullPrototypeDescriptor();
  const value = getOwnPropertyDescriptor(descriptor, "value");
  const writable = getOwnPropertyDescriptor(descriptor, "writable");
  const getter = getOwnPropertyDescriptor(descriptor, "get");
  const setter = getOwnPropertyDescriptor(descriptor, "set");
  const enumerable = getOwnPropertyDescriptor(descriptor, "enumerable");
  const configurable = getOwnPropertyDescriptor(descriptor, "configurable");
  if (value) safeDescriptor.value = value.value;
  if (writable) safeDescriptor.writable = writable.value as boolean;
  if (getter) safeDescriptor.get = getter.value as (() => unknown) | undefined;
  if (setter) safeDescriptor.set = setter.value as ((value: unknown) => void) | undefined;
  if (enumerable) safeDescriptor.enumerable = enumerable.value as boolean;
  if (configurable) safeDescriptor.configurable = configurable.value as boolean;
  ReflectApply(ObjectDefineProperty, Object, [target, key, safeDescriptor]);
}

function callPromiseThen<T, TResult1 = T, TResult2 = never>(
  promise: Promise<T>,
  onFulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
  onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
): Promise<TResult1 | TResult2> {
  const originalConstructor = getOwnPropertyDescriptor(promise, "constructor");
  if (originalConstructor?.configurable === false) {
    throw new TypeError("Cannot safely observe a promise with a fixed constructor");
  }

  defineOwnTemporaryDataProperty(
    promise,
    "constructor",
    SAFE_PROMISE_SPECIES_HOLDER,
  );
  try {
    return ReflectApply(PromisePrototypeThen, promise, [
      onFulfilled,
      onRejected,
    ]) as Promise<TResult1 | TResult2>;
  } finally {
    if (originalConstructor) {
      restoreOwnPropertyDescriptor(
        promise,
        "constructor",
        originalConstructor,
      );
    } else {
      ReflectApply(ReflectDeleteProperty, Reflect, [promise, "constructor"]);
    }
  }
}

function getAbortControllerSignal(controller: AbortController): AbortSignal {
  return ReflectApply(
    intrinsicAbortControllerSignalGetter,
    controller,
    [],
  ) as AbortSignal;
}

function abortController(controller: AbortController): void {
  ReflectApply(AbortControllerPrototypeAbort, controller, []);
}

function isSignalAborted(signal: AbortSignal): boolean {
  return ReflectApply(intrinsicAbortSignalAbortedGetter, signal, []) as boolean;
}

function intrinsicSignalAbortedOwnGetter(this: AbortSignal): boolean {
  return isSignalAborted(this);
}

function createHostedAbortController(): AbortController {
  const controller = new IntrinsicAbortController();
  const signal = getAbortControllerSignal(controller);
  // Deno's AbortController implementation dynamically reads both public
  // properties while aborting. Own properties keep that native path bound to
  // captured getters even if trusted executable config later poisons either
  // prototype. Null-prototype descriptors prevent inherited descriptor hooks.
  defineOwnDataProperty(controller, "signal", signal);
  defineOwnGetterProperty(
    signal,
    "aborted",
    intrinsicSignalAbortedOwnGetter,
  );
  return controller;
}

function addAbortListener(signal: AbortSignal, listener: () => void): void {
  ReflectApply(EventTargetPrototypeAddEventListener, signal, [
    "abort",
    listener,
    ABORT_LISTENER_OPTIONS,
  ]);
}

function removeAbortListener(signal: AbortSignal, listener: () => void): void {
  ReflectApply(EventTargetPrototypeRemoveEventListener, signal, [
    "abort",
    listener,
  ]);
}

function deferPromise<T>(operation: () => T | PromiseLike<T>): Promise<Awaited<T>> {
  const ready = ReflectApply(PromiseResolve, IntrinsicPromise, []) as Promise<void>;
  return callPromiseThen(ready, operation) as Promise<Awaited<T>>;
}

function rejectPromise<T = never>(error: unknown): Promise<T> {
  return ReflectApply(PromiseReject, IntrinsicPromise, [error]) as Promise<T>;
}

function promiseWithResolvers<T>(): PromiseWithResolvers<T> {
  return ReflectApply(PromiseWithResolvers, IntrinsicPromise, []) as PromiseWithResolvers<T>;
}

function thenPromise<T, TResult1 = T, TResult2 = never>(
  promise: Promise<T>,
  onFulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
  onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
): Promise<TResult1 | TResult2> {
  return callPromiseThen(promise, onFulfilled, onRejected);
}

function decimalIdentityNumber(value: number): string {
  return ReflectApply(NumberPrototypeToString, value, [10]) as string;
}

function frameConfigIdentityString(value: string): string {
  return `${decimalIdentityNumber(value.length)}:${value}`;
}

function frameOptionalConfigIdentityString(
  value: string | null | undefined,
): string {
  return value === null || value === undefined
    ? "absent;"
    : `value:${frameConfigIdentityString(value)}`;
}

const logger = serverLogger.component("config");

/** Cache TTL for veryfront-api filesystem in proxy mode */
const DEFAULT_FS_CACHE_TTL_MS = 60_000;
/** Maximum retry attempts for veryfront-api filesystem requests */
const DEFAULT_FS_MAX_RETRIES = 3;
/** Initial backoff delay between retries */
const DEFAULT_FS_INITIAL_DELAY_MS = 500;
/** Maximum backoff delay between retries */
const DEFAULT_FS_MAX_DELAY_MS = 5_000;
/** Maximum entries in the per-project config cache */
const DEFAULT_CONFIG_CACHE_MAX_ENTRIES = 100;

/** @internal Test-only tracking capacity. */
export function __getBunProjectConfigModuleTrackingCapacityForTests(): number {
  return DEFAULT_CONFIG_CACHE_MAX_ENTRIES;
}

export type { VeryfrontConfig } from "./schemas/index.ts";

/**
 * Creates fresh default import map per-request.
 * Previously this was called once at module load, causing all projects to share
 * the same import map object which could be mutated.
 *
 * @see plans/architecture-audit/007.3-default-config-shared-reference.md
 */
function getDefaultImportMapForConfig(): { imports: ReturnType<typeof getReactImportMap> } {
  return { imports: getReactImportMap(REACT_DEFAULT_VERSION) };
}

function requireProxyApiBaseUrl(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw CONFIG_VALIDATION_FAILED.create({
      detail: "PROXY_MODE=1 requires VERYFRONT_API_BASE_URL",
    });
  }

  try {
    const url = new URL(normalized);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new TypeError("unsupported proxy API URL");
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    throw CONFIG_VALIDATION_FAILED.create({
      detail:
        "VERYFRONT_API_BASE_URL must be an HTTP(S) base URL without credentials, query, or fragment in proxy mode",
    });
  }
}

/**
 * Creates default fs config based on environment.
 * In proxy mode (PROXY_MODE=1), uses veryfront-api filesystem.
 * Otherwise uses local filesystem.
 */
function getDefaultFsConfig(): VeryfrontConfig["fs"] {
  const proxyModeEnv = getHostEnv("PROXY_MODE");
  const isProxyMode = proxyModeEnv === "1";
  const apiBaseUrl = getHostEnv("VERYFRONT_API_BASE_URL");

  logger.debug("getDefaultFsConfig called", {
    proxyModeEnv,
    isProxyMode,
    hasApiBaseUrl: Boolean(apiBaseUrl),
  });

  if (isProxyMode) {
    const trustedApiBaseUrl = requireProxyApiBaseUrl(apiBaseUrl);
    logger.info("Using veryfront-api filesystem (proxy mode)");
    return {
      type: "veryfront-api",
      veryfront: {
        apiBaseUrl: trustedApiBaseUrl,
        proxyMode: true,
        cache: { enabled: true, ttl: DEFAULT_FS_CACHE_TTL_MS },
        retry: {
          maxRetries: DEFAULT_FS_MAX_RETRIES,
          initialDelay: DEFAULT_FS_INITIAL_DELAY_MS,
          maxDelay: DEFAULT_FS_MAX_DELAY_MS,
        },
      },
    };
  }

  logger.debug("Using local filesystem (no proxy mode)");
  return { type: "local" };
}

/**
 * Creates a fresh copy of default config for each merge operation.
 * This prevents shared mutable state between projects.
 *
 * Previously DEFAULT_CONFIG was a module-level object that could be mutated
 * through shallow spreads, causing cross-tenant contamination.
 *
 * @see plans/architecture-audit/007.3-default-config-shared-reference.md
 */
function createFreshDefaults(): Partial<VeryfrontConfig> {
  return {
    title: "Veryfront App",
    description: "Built with Veryfront",
    fs: getDefaultFsConfig(),
    experimental: {
      esmLayouts: true,
    },
    router: undefined,
    theme: {
      colors: {
        primary: "#3B82F6",
      },
    },
    build: {
      outDir: "dist",
      trailingSlash: false,
      esbuild: {
        wasmURL: ESBUILD_WASM_URL,
        worker: false,
      },
    },
    cache: {
      dir: DEFAULT_CACHE_DIR,
      render: {
        type: "memory",
        ttl: undefined,
        maxEntries: DEFAULT_RENDER_CACHE_MAX_ENTRIES,
        kvPath: undefined,
      },
    },
    dev: {
      port: DEFAULT_PORT,
      host: "localhost",
      open: false,
      hmr: true,
    },
    resolve: {
      importMap: getDefaultImportMapForConfig(),
    },
    client: {
      moduleResolution: "cdn",
      cdn: {
        provider: "esm.sh",
        versions: "auto",
      },
    },
  };
}

export type ConfigLoadProvenance =
  | Readonly<{ kind: "file"; configFile: DeclarativeConfigFileName }>
  | Readonly<{ kind: "defaults" }>;

export interface ConfigLoadResult {
  readonly config: VeryfrontConfig;
  readonly provenance: ConfigLoadProvenance;
}

interface MergedConfigLoadResult {
  readonly config: VeryfrontConfig;
  readonly bunTrackingPublication?: BunProjectConfigTrackingPublication;
}

interface ConfigCacheEntry {
  readonly revision: number;
  readonly config: VeryfrontConfig;
  readonly provenance: ConfigLoadProvenance;
  readonly bunTrackingKey?: string;
}

interface BunProjectDynamicImportObserver {
  readonly key: string;
  readonly dispose: () => void;
}

interface BunProjectConfigModuleCacheEntry {
  readonly cache: Record<string, unknown>;
  readonly keys: readonly string[];
  readonly projectDirectory: string;
  readonly dynamicImportObserver?: BunProjectDynamicImportObserver;
}

interface BunProjectConfigTrackingPublication {
  readonly key: string;
  readonly publish: () => void;
  readonly discard: () => void;
}

const bunProjectConfigTrackingOwnerCounts = new IntrinsicMap<string, number>();

const configCacheByProject = new LRUCache<string, ConfigCacheEntry>({
  maxEntries: DEFAULT_CONFIG_CACHE_MAX_ENTRIES,
  onEvict: (_key, value) => {
    const entry = value as ConfigCacheEntry;
    releaseBunProjectConfigTrackingOwner(entry.bunTrackingKey);
  },
});
const bunProjectConfigModuleTrackingEntries = new IntrinsicMap<
  string,
  BunProjectConfigModuleCacheEntry
>();
let clearingBunProjectConfigModuleTracking = false;
const BUN_PROJECT_CONFIG_LOAD_INVALIDATED = Symbol("bun-project-config-load-invalidated");
const bunProjectConfigModuleCacheKeys = new LRUCache<
  string,
  BunProjectConfigModuleCacheEntry
>({
  maxEntries: DEFAULT_CONFIG_CACHE_MAX_ENTRIES,
  // require.cache contains live module namespace objects with getters and TDZ
  // bindings, so the generic recursive estimator must never inspect it.
  estimateSizeOf: () => 1,
  onEvict: (key, value) => {
    mapDelete(bunProjectConfigModuleTrackingEntries, key);
    if (!clearingBunProjectConfigModuleTracking) {
      evictBunProjectConfigModules(value as BunProjectConfigModuleCacheEntry);
    }
  },
});
/** Serialize Bun loads for one config path, including across cache revisions. */
const bunProjectConfigLoadTurns = new IntrinsicMap<string, Promise<void>>();
const bunProjectConfigPendingDependencyCollections = new IntrinsicMap<
  string,
  Promise<void>
>();
let bunProjectConfigDynamicImportObserverSequence = 0;

function setBunProjectConfigModuleTracking(
  key: string,
  entry: BunProjectConfigModuleCacheEntry,
): void {
  mapSet(bunProjectConfigModuleTrackingEntries, key, entry);
  bunProjectConfigModuleCacheKeys.set(key, entry);
}

function retainBunProjectConfigTrackingOwner(trackingKey: string | undefined): void {
  if (trackingKey === undefined) return;
  mapSet(
    bunProjectConfigTrackingOwnerCounts,
    trackingKey,
    (mapGet(bunProjectConfigTrackingOwnerCounts, trackingKey) ?? 0) + 1,
  );
}

function releaseBunProjectConfigTrackingOwner(trackingKey: string | undefined): void {
  if (trackingKey === undefined) return;
  const ownerCount = mapGet(bunProjectConfigTrackingOwnerCounts, trackingKey);
  if (ownerCount !== undefined && ownerCount > 1) {
    mapSet(bunProjectConfigTrackingOwnerCounts, trackingKey, ownerCount - 1);
    return;
  }
  mapDelete(bunProjectConfigTrackingOwnerCounts, trackingKey);
  bunProjectConfigModuleCacheKeys.delete(trackingKey);
}

function setConfigCacheEntry(cacheKey: string, entry: ConfigCacheEntry): void {
  const previous = configCacheByProject.get(cacheKey);
  if (previous?.bunTrackingKey === entry.bunTrackingKey) {
    configCacheByProject.set(cacheKey, entry);
    return;
  }

  // Retain the incoming owner before set() can evict another cache alias of
  // the same canonical config path at capacity.
  retainBunProjectConfigTrackingOwner(entry.bunTrackingKey);
  configCacheByProject.set(cacheKey, entry);
  releaseBunProjectConfigTrackingOwner(previous?.bunTrackingKey);
}

/**
 * Keep Bun module-tracking recency coupled to the config cache. A config
 * cache hit touches only `configCacheByProject`; without refreshing the
 * tracking entry too, the independent tracking LRU can reach capacity and
 * evict -- and thereby delete -- the module graph of a config that is still
 * being served from cache, splitting later application imports into a second
 * singleton generation.
 */
function touchBunProjectConfigModuleTracking(
  projectDir: string,
  provenance: ConfigLoadProvenance,
  trackingKey?: string,
): void {
  if (!isBun || provenance.kind !== "file") return;
  bunProjectConfigModuleCacheKeys.get(
    trackingKey ?? resolve(join(projectDir, provenance.configFile)),
  );
}

interface HostedConfigFailureCacheEntry {
  readonly revision: number;
  readonly error: DeclarativeConfigEvaluationError;
}

/**
 * Negative cache for deterministic hosted config rejections.
 *
 * The hosted cache key already folds in the exact source digest, policy
 * version and environment fingerprint, so a rejected source stays rejected
 * until the tenant ships different content; re-sending it to the evaluator
 * worker on every request only repeats the same failure.
 */
const hostedConfigFailureCacheByProject = new LRUCache<
  string,
  HostedConfigFailureCacheEntry
>({
  maxEntries: DEFAULT_CONFIG_CACHE_MAX_ENTRIES,
});

type HostedConfigEvaluator = typeof evaluatePreparedDeclarativeConfigInWorker;

interface HostedConfigSourceSelection {
  readonly configPath: string;
  readonly configFile: DeclarativeConfigFileName;
  readonly source: string;
}

type HostedConfigSourceReadKey = string | object;
type HostedConfigSourceReadState = "queued" | "active" | "ready" | "failed";

interface HostedConfigSourceReadFlight {
  readonly key: HostedConfigSourceReadKey;
  readonly start: PromiseWithResolvers<void>;
  readonly promise: Promise<HostedConfigSourceSelection | null>;
  queueNode: HostedConfigSourceReadQueueNode | null;
  waiterCount: number;
  state: HostedConfigSourceReadState;
}

interface HostedConfigSourceReadQueueNode {
  flight: HostedConfigSourceReadFlight;
  previous: HostedConfigSourceReadQueueNode | null;
  next: HostedConfigSourceReadQueueNode | null;
}

interface HostedConfigSourceReadLease {
  readonly selection: HostedConfigSourceSelection | null;
  readonly release: () => void;
}

const MAX_ACTIVE_HOSTED_CONFIG_SOURCE_READS = DECLARATIVE_CONFIG_WORKER_ADMISSION_LIMITS.maxActive;
const MAX_QUEUED_HOSTED_CONFIG_SOURCE_READS = DECLARATIVE_CONFIG_WORKER_ADMISSION_LIMITS.maxQueued;
const hostedConfigSourceReadFlights = new IntrinsicMap<
  HostedConfigSourceReadKey,
  HostedConfigSourceReadFlight
>();
let hostedConfigSourceReadQueueHead: HostedConfigSourceReadQueueNode | null = null;
let hostedConfigSourceReadQueueTail: HostedConfigSourceReadQueueNode | null = null;
let queuedHostedConfigSourceReads = 0;
const hostedConfigSourceReadFilesystemIds = new IntrinsicWeakMap<object, number>();
let nextHostedConfigSourceReadFilesystemId = 1;
let activeHostedConfigSourceReads = 0;

interface HostedConfigFlight {
  readonly controller: AbortController;
  readonly promise: Promise<VeryfrontConfig>;
  waiterCount: number;
  settled: boolean;
}

const MAX_HOSTED_CONFIG_FLIGHTS = DECLARATIVE_CONFIG_WORKER_ADMISSION_LIMITS.maxActive +
  DECLARATIVE_CONFIG_WORKER_ADMISSION_LIMITS.maxQueued;
const hostedConfigFlights = new IntrinsicMap<string, HostedConfigFlight>();
let hostedConfigEvaluator: HostedConfigEvaluator = evaluatePreparedDeclarativeConfigInWorker;

interface TrustedConfigFlight {
  readonly promise: Promise<ConfigLoadResult>;
}

const MAX_TRUSTED_CONFIG_FLIGHTS = 64;
const trustedConfigFlights = new IntrinsicMap<string, TrustedConfigFlight>();
const trustedVirtualFilesystemIds = new IntrinsicWeakMap<object, number>();
let nextTrustedVirtualFilesystemId = 1;

// Register caches for monitoring
registerLRUCache("config-cache", configCacheByProject);
registerLRUCache("config-failure-cache", hostedConfigFailureCacheByProject);

let cacheRevision = 0;

function configFileProvenance(
  configFile: DeclarativeConfigFileName,
): ConfigLoadProvenance {
  return freezeObject({ kind: "file", configFile });
}

function defaultConfigProvenance(): ConfigLoadProvenance {
  return freezeObject({ kind: "defaults" });
}

function createConfigLoadResult(
  config: VeryfrontConfig,
  provenance: ConfigLoadProvenance,
): ConfigLoadResult {
  return freezeObject({ config, provenance });
}

function buildTrustedConfigFlightKey(
  effectiveCacheKey: string,
  revision: number,
): string {
  return `${revision}:${effectiveCacheKey}`;
}

function getOrCreateTrustedConfigFlight(
  effectiveCacheKey: string,
  revision: number,
  operation: () => Promise<ConfigLoadResult>,
): Promise<ConfigLoadResult> {
  const flightKey = buildTrustedConfigFlightKey(effectiveCacheKey, revision);
  const existing = mapGet(trustedConfigFlights, flightKey);
  if (existing) return existing.promise;

  if (mapSize(trustedConfigFlights) >= MAX_TRUSTED_CONFIG_FLIGHTS) {
    throw SERVICE_OVERLOADED.create({
      detail: `Too many concurrent trusted configuration loads (${MAX_TRUSTED_CONFIG_FLIGHTS})`,
    });
  }

  const flight: TrustedConfigFlight = {
    promise: deferPromise(operation),
  };
  mapSet(trustedConfigFlights, flightKey, flight);

  const finish = (): void => {
    if (mapGet(trustedConfigFlights, flightKey) === flight) {
      mapDelete(trustedConfigFlights, flightKey);
    }
  };
  void thenPromise(flight.promise, finish, finish);
  return flight.promise;
}

function isHostedMultiProjectFilesystem(adapter: RuntimeAdapter): boolean {
  return isExtendedFSAdapter(adapter.fs) && adapter.fs.isMultiProjectMode();
}

function throwIfHostedConfigAborted(signal: AbortSignal | undefined): void {
  if (signal && isSignalAborted(signal)) {
    throw createDeclarativeConfigWorkerInfrastructureError("worker-aborted");
  }
}

function decodeConfigSource(content: string | Uint8Array): string {
  if (typeof content === "string") return content;
  const decoder = new IntrinsicTextDecoder(
    "utf-8",
    HOSTED_CONFIG_TEXT_DECODER_OPTIONS,
  );
  return ReflectApply(TextDecoderPrototypeDecode, decoder, [content]) as string;
}

function decodeTrustedConfigSource(content: string | Uint8Array): string {
  if (typeof content === "string") return content;
  const decoder = new IntrinsicTextDecoder();
  return ReflectApply(TextDecoderPrototypeDecode, decoder, [content]) as string;
}

function hostedConfigSourceReadFilesystemId(adapter: RuntimeAdapter): number {
  const filesystem = adapter.fs as object;
  let filesystemId = weakMapGet(hostedConfigSourceReadFilesystemIds, filesystem);
  if (filesystemId === undefined) {
    filesystemId = nextHostedConfigSourceReadFilesystemId;
    nextHostedConfigSourceReadFilesystemId += 1;
    weakMapSet(hostedConfigSourceReadFilesystemIds, filesystem, filesystemId);
  }
  return filesystemId;
}

function buildHostedConfigSourceReadKey(
  effectiveCacheKey: string,
  configBaseDir: string,
  adapter: RuntimeAdapter,
  sourceContext: VirtualConfigSourceContext,
  revisionAtStart: number,
): HostedConfigSourceReadKey {
  // Branch names identify mutable pointers, not immutable source snapshots.
  // Giving every preview request a fresh identity keeps reads independently
  // observable while still routing them through the shared admission budget.
  if (!sourceContext.productionMode) return freezeObject({});

  const filesystemId = hostedConfigSourceReadFilesystemId(adapter);
  return `hosted-config-source-read-v1:${
    frameConfigIdentityString(decimalIdentityNumber(filesystemId))
  }${frameConfigIdentityString(effectiveCacheKey)}${frameConfigIdentityString(configBaseDir)}${
    frameConfigIdentityString(decimalIdentityNumber(revisionAtStart))
  }`;
}

async function readHostedConfigSource(
  adapter: RuntimeAdapter,
  configBaseDir: string,
): Promise<HostedConfigSourceSelection | null> {
  let apiNotFound: { error: unknown } | undefined;
  for (const configFile of VERYFRONT_CONFIG_FILES) {
    const configPath = join(configBaseDir, configFile);
    try {
      const content = await adapter.fs.readFile(configPath);
      return freezeObject({
        configPath,
        configFile,
        source: decodeConfigSource(content),
      });
    } catch (error) {
      if (isNotFoundError(error)) {
        logger.debug("Hosted config candidate not found", { configPath });
        continue;
      }
      if (hasNotFoundStatus(error)) {
        // A candidate-scoped API 404 must not abort discovery: a later
        // candidate may still exist. Remember the first one instead -- if no
        // candidate is found at all, the 404 has to surface (see below).
        logger.debug("Hosted config candidate not found", { configPath });
        if (apiNotFound === undefined) apiNotFound = { error };
        continue;
      }
      if (error instanceof DeclarativeConfigEvaluationError) {
        throw translateHostedConfigEvaluationError(error, configFile);
      }
      if (isPreservedConfigLoadError(error)) throw error;
      logger.warn("Failed to load config file", { configFile });
      // Deliberately generic, unlike the three evaluation sites. Everything
      // reaching here came out of `adapter.fs.readFile`, so the cause describes
      // the storage backend -- internal hostnames, paths, account identifiers --
      // not the project's own config module. CONFIG_PARSE_ERROR is a 400, and
      // the HTTP boundary strips `detail` only at 5xx
      // (src/errors/middleware/http-error-boundary.ts:113-116), so a cause
      // repeated here would reach the tenant. It stays on `cause` for the logs.
      throw CONFIG_PARSE_ERROR.create({
        detail: `Failed to load ${configFile}`,
        cause: error,
        context: { configFile },
      });
    }
  }
  if (apiNotFound !== undefined) {
    // Every candidate is missing and at least one miss was an API-layer 404:
    // the release publishes no config. Rethrow it so the caller reports the
    // project as "hosted-absent" (adapter-factory then substitutes the
    // process-wide defaults) instead of synthesizing a default config that
    // downstream would treat as the project's own.
    throw apiNotFound.error;
  }
  return null;
}

function hasNotFoundStatus(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 8; depth++) {
    if (
      typeof current !== "object" || current === null || isProxyWithoutHooks(current)
    ) return false;
    const status = ObjectGetOwnPropertyDescriptor(current, "status");
    if (status?.value === 404) return true;
    const cause = ObjectGetOwnPropertyDescriptor(current, "cause");
    if (cause === undefined) return false;
    current = cause.value;
  }
  return false;
}

function removeQueuedHostedConfigSourceRead(
  flight: HostedConfigSourceReadFlight,
): void {
  const node = flight.queueNode;
  if (!node) return;
  if (node.previous) node.previous.next = node.next;
  else hostedConfigSourceReadQueueHead = node.next;
  if (node.next) node.next.previous = node.previous;
  else hostedConfigSourceReadQueueTail = node.previous;
  node.previous = null;
  node.next = null;
  flight.queueNode = null;
  queuedHostedConfigSourceReads -= 1;
}

function enqueueHostedConfigSourceRead(
  flight: HostedConfigSourceReadFlight,
): void {
  const node = createNullPrototypeRecord<HostedConfigSourceReadQueueNode>();
  node.flight = flight;
  node.previous = hostedConfigSourceReadQueueTail;
  node.next = null;
  if (hostedConfigSourceReadQueueTail) {
    hostedConfigSourceReadQueueTail.next = node;
  } else {
    hostedConfigSourceReadQueueHead = node;
  }
  hostedConfigSourceReadQueueTail = node;
  flight.queueNode = node;
  queuedHostedConfigSourceReads += 1;
}

function dequeueHostedConfigSourceRead(): HostedConfigSourceReadFlight | undefined {
  const node = hostedConfigSourceReadQueueHead;
  if (!node) return undefined;
  const flight = node.flight;
  removeQueuedHostedConfigSourceRead(flight);
  return flight;
}

function dispatchHostedConfigSourceReads(): void {
  while (
    activeHostedConfigSourceReads < MAX_ACTIVE_HOSTED_CONFIG_SOURCE_READS &&
    queuedHostedConfigSourceReads > 0
  ) {
    const flight = dequeueHostedConfigSourceRead();
    if (!flight) {
      throw new TypeError("Hosted config source-read queue state is inconsistent");
    }
    if (flight.state !== "queued") continue;
    flight.state = "active";
    activeHostedConfigSourceReads += 1;
    flight.start.resolve();
  }
}

function finishHostedConfigSourceRead(
  flight: HostedConfigSourceReadFlight,
  succeeded: boolean,
): void {
  if (flight.state !== "active") return;
  flight.state = succeeded ? "ready" : "failed";
  if (
    (!succeeded || flight.waiterCount === 0) &&
    mapGet(hostedConfigSourceReadFlights, flight.key) === flight
  ) {
    mapDelete(hostedConfigSourceReadFlights, flight.key);
  }
  activeHostedConfigSourceReads -= 1;
  dispatchHostedConfigSourceReads();
}

function cancelQueuedHostedConfigSourceRead(
  flight: HostedConfigSourceReadFlight,
  error: unknown,
): void {
  if (flight.state !== "queued") return;
  flight.state = "failed";
  removeQueuedHostedConfigSourceRead(flight);
  if (mapGet(hostedConfigSourceReadFlights, flight.key) === flight) {
    mapDelete(hostedConfigSourceReadFlights, flight.key);
  }
  // Rejecting the start gate settles the already-observed operation promise
  // without ever invoking the filesystem adapter.
  flight.start.reject(error);
}

function createHostedConfigSourceReadFlight(
  key: HostedConfigSourceReadKey,
  operation: () => Promise<HostedConfigSourceSelection | null>,
): HostedConfigSourceReadFlight {
  const start = promiseWithResolvers<void>();
  // Register the deferred operation in the caller's async context now. A
  // queued multi-project read must not inherit the request context of whichever
  // earlier flight later releases capacity.
  const promise = thenPromise(start.promise, operation);
  const flight: HostedConfigSourceReadFlight = {
    key,
    start,
    promise,
    queueNode: null,
    waiterCount: 0,
    state: "queued",
  };
  mapSet(hostedConfigSourceReadFlights, key, flight);
  void thenPromise(
    promise,
    () => finishHostedConfigSourceRead(flight, true),
    () => finishHostedConfigSourceRead(flight, false),
  );

  if (activeHostedConfigSourceReads < MAX_ACTIVE_HOSTED_CONFIG_SOURCE_READS) {
    flight.state = "active";
    activeHostedConfigSourceReads += 1;
    start.resolve();
  } else {
    enqueueHostedConfigSourceRead(flight);
  }
  return flight;
}

function getOrCreateHostedConfigSourceReadFlight(
  key: HostedConfigSourceReadKey,
  operation: () => Promise<HostedConfigSourceSelection | null>,
): HostedConfigSourceReadFlight {
  const existing = mapGet(hostedConfigSourceReadFlights, key);
  if (existing && existing.state !== "failed") return existing;
  if (existing) mapDelete(hostedConfigSourceReadFlights, key);

  if (
    activeHostedConfigSourceReads >= MAX_ACTIVE_HOSTED_CONFIG_SOURCE_READS &&
    queuedHostedConfigSourceReads >= MAX_QUEUED_HOSTED_CONFIG_SOURCE_READS
  ) {
    throw createDeclarativeConfigWorkerInfrastructureError("worker-overloaded");
  }
  return createHostedConfigSourceReadFlight(key, operation);
}

function releaseHostedConfigSourceReadLease(
  flight: HostedConfigSourceReadFlight,
): void {
  flight.waiterCount -= 1;
  if (flight.waiterCount !== 0) return;
  if (flight.state === "queued") {
    cancelQueuedHostedConfigSourceRead(
      flight,
      createDeclarativeConfigWorkerInfrastructureError("worker-aborted"),
    );
  } else if (
    flight.state === "ready" &&
    mapGet(hostedConfigSourceReadFlights, flight.key) === flight
  ) {
    mapDelete(hostedConfigSourceReadFlights, flight.key);
  }
}

function waitForHostedConfigSourceReadFlight(
  flight: HostedConfigSourceReadFlight,
  signal: AbortSignal | undefined,
): Promise<HostedConfigSourceReadLease> {
  if (signal && isSignalAborted(signal)) {
    if (flight.waiterCount === 0) {
      cancelQueuedHostedConfigSourceRead(
        flight,
        createDeclarativeConfigWorkerInfrastructureError("worker-aborted"),
      );
    }
    return rejectPromise(
      createDeclarativeConfigWorkerInfrastructureError("worker-aborted"),
    );
  }

  flight.waiterCount += 1;
  return new IntrinsicPromise<HostedConfigSourceReadLease>((resolve, reject) => {
    let settled = false;
    let released = false;
    let listenerAttached = false;
    const release = (): void => {
      if (released) return;
      released = true;
      releaseHostedConfigSourceReadLease(flight);
    };
    const detachAbortListener = (): void => {
      if (!signal || !listenerAttached) return;
      listenerAttached = false;
      removeAbortListener(signal, onAbort);
    };
    const finish = (settleWaiter: () => void): void => {
      if (settled) return;
      settled = true;
      try {
        detachAbortListener();
      } catch (error) {
        release();
        reject(error);
        return;
      }
      settleWaiter();
    };
    const onAbort = (): void => {
      finish(() => {
        release();
        reject(
          createDeclarativeConfigWorkerInfrastructureError("worker-aborted"),
        );
      });
    };

    try {
      if (signal) {
        // Mark the listener as attached first so a partially completed native
        // registration can still be rolled back if WebIDL conversion throws.
        listenerAttached = true;
        addAbortListener(signal, onAbort);
      }
      void thenPromise(
        flight.promise,
        (selection) =>
          finish(() =>
            resolve(freezeObject({
              selection,
              release,
            }))
          ),
        (error: unknown) =>
          finish(() => {
            release();
            reject(error);
          }),
      );
      if (signal && isSignalAborted(signal)) onAbort();
    } catch (error) {
      if (settled) return;
      settled = true;
      try {
        detachAbortListener();
      } catch {
        // Preserve the primary listener/reaction setup failure.
      }
      release();
      reject(error);
    }
  });
}

function deepFreezeHostedConfig(config: VeryfrontConfig): VeryfrontConfig {
  const seen = new IntrinsicWeakSet<object>();
  const visit = (value: unknown): void => {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return;
    if (weakSetHas(seen, value)) return;
    weakSetAdd(seen, value);
    for (const key of ownKeys(value)) {
      const descriptor = getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) visit(descriptor.value);
    }
    freezeObject(value);
  };
  visit(config);
  return config;
}

async function buildHostedConfigCacheKey(
  baseCacheKey: string,
  configPath: string,
  source: string,
  payload: PreparedDeclarativeConfigWorkerPayload,
): Promise<string> {
  const sourceDigest = await computeHash(source);
  const identityMaterial = `veryfront-hosted-config-cache-v2:${
    frameConfigIdentityString(configPath)
  }${frameConfigIdentityString(sourceDigest)}${frameConfigIdentityString(payload.policyVersion)}${
    frameConfigIdentityString(payload.cacheFingerprint)
  }`;
  const identityDigest = await computeHash(identityMaterial);
  return `${baseCacheKey}:hosted:${identityDigest}`;
}

function buildHostedConfigFlightKey(hostedCacheKey: string, revision: number): string {
  return `${revision}:${hostedCacheKey}`;
}

/**
 * Whether a hosted evaluation failure is guaranteed to repeat for the same
 * cache key. Worker-phase and retryable failures are infrastructure
 * conditions that can succeed on retry, so they must never be cached.
 */
function isDeterministicHostedConfigRejection(
  error: unknown,
): error is DeclarativeConfigEvaluationError {
  return error instanceof DeclarativeConfigEvaluationError &&
    !error.retryable &&
    error.phase !== "worker";
}

function createHostedConfigFlight(
  flightKey: string,
  hostedCacheKey: string,
  payload: PreparedDeclarativeConfigWorkerPayload,
  usePersistentCache: boolean,
  revisionAtStart: number,
  validationBoundary?: (validate: () => VeryfrontConfig) => VeryfrontConfig,
): HostedConfigFlight {
  const controller = createHostedAbortController();
  const controllerSignal = getAbortControllerSignal(controller);
  const result = promiseWithResolvers<VeryfrontConfig>();
  const flight: HostedConfigFlight = {
    controller,
    promise: result.promise,
    waiterCount: 0,
    settled: false,
  };
  const operation = deferPromise(async () => {
    throwIfHostedConfigAborted(controllerSignal);
    const snapshot = await hostedConfigEvaluator(payload, {
      signal: controllerSignal,
    });
    throwIfHostedConfigAborted(controllerSignal);
    const validate = () => deepFreezeHostedConfig(validateAndMergeConfig(snapshot));
    const merged = validationBoundary ? validationBoundary(validate) : validate();
    throwIfHostedConfigAborted(controllerSignal);
    if (usePersistentCache && cacheRevision === revisionAtStart) {
      setConfigCacheEntry(hostedCacheKey, {
        revision: revisionAtStart,
        config: merged,
        provenance: configFileProvenance(payload.evaluationOptions.fileName),
      });
    }
    return merged;
  });

  const finish = (): void => {
    flight.settled = true;
    if (mapGet(hostedConfigFlights, flightKey) === flight) {
      mapDelete(hostedConfigFlights, flightKey);
    }
  };
  void thenPromise(
    operation,
    (config) => {
      finish();
      result.resolve(config);
    },
    (error: unknown) => {
      finish();
      if (
        usePersistentCache && cacheRevision === revisionAtStart &&
        isDeterministicHostedConfigRejection(error)
      ) {
        hostedConfigFailureCacheByProject.set(hostedCacheKey, {
          revision: revisionAtStart,
          error,
        });
      }
      result.reject(error);
    },
  );
  mapSet(hostedConfigFlights, flightKey, flight);
  return flight;
}

function getOrCreateHostedConfigFlight(
  hostedCacheKey: string,
  payload: PreparedDeclarativeConfigWorkerPayload,
  usePersistentCache: boolean,
  revisionAtStart: number,
  validationBoundary?: (validate: () => VeryfrontConfig) => VeryfrontConfig,
): HostedConfigFlight {
  const flightKey = buildHostedConfigFlightKey(hostedCacheKey, revisionAtStart);
  const existing = mapGet(hostedConfigFlights, flightKey);
  if (
    existing &&
    !isSignalAborted(getAbortControllerSignal(existing.controller))
  ) {
    return existing;
  }
  if (existing) mapDelete(hostedConfigFlights, flightKey);

  if (mapSize(hostedConfigFlights) >= MAX_HOSTED_CONFIG_FLIGHTS) {
    throw createDeclarativeConfigWorkerInfrastructureError("worker-overloaded");
  }

  return createHostedConfigFlight(
    flightKey,
    hostedCacheKey,
    payload,
    usePersistentCache,
    revisionAtStart,
    validationBoundary,
  );
}

function waitForHostedConfigFlight(
  flight: HostedConfigFlight,
  signal: AbortSignal | undefined,
): Promise<VeryfrontConfig> {
  if (signal && isSignalAborted(signal)) {
    return rejectPromise(
      createDeclarativeConfigWorkerInfrastructureError("worker-aborted"),
    );
  }

  flight.waiterCount += 1;
  return new IntrinsicPromise<VeryfrontConfig>((resolve, reject) => {
    let settled = false;
    let released = false;
    let listenerAttached = false;
    const releaseWaiter = (): void => {
      if (released) return;
      released = true;
      flight.waiterCount -= 1;
      if (flight.waiterCount === 0 && !flight.settled) {
        abortController(flight.controller);
      }
    };
    const detachAbortListener = (): void => {
      if (!signal || !listenerAttached) return;
      listenerAttached = false;
      removeAbortListener(signal, onAbort);
    };
    const finish = (settleWaiter: () => void): void => {
      if (settled) return;
      settled = true;
      let detachFailed = false;
      let detachError: unknown;
      try {
        detachAbortListener();
      } catch (error) {
        detachFailed = true;
        detachError = error;
      }
      try {
        releaseWaiter();
      } catch (error) {
        reject(detachFailed ? detachError : error);
        return;
      }
      if (detachFailed) {
        reject(detachError);
        return;
      }
      settleWaiter();
    };
    const onAbort = (): void => {
      finish(() =>
        reject(
          createDeclarativeConfigWorkerInfrastructureError("worker-aborted"),
        )
      );
    };

    try {
      if (signal) {
        listenerAttached = true;
        addAbortListener(signal, onAbort);
      }
      void thenPromise(
        flight.promise,
        (config) => finish(() => resolve(config)),
        (error: unknown) => finish(() => reject(error)),
      );
      if (signal && isSignalAborted(signal)) onAbort();
    } catch (error) {
      if (settled) return;
      settled = true;
      try {
        detachAbortListener();
      } catch {
        // Preserve the primary listener/reaction setup failure.
      }
      try {
        releaseWaiter();
      } catch {
        // Preserve the primary listener/reaction setup failure.
      }
      reject(error);
    }
  });
}

function validateConfigShape(userConfig: unknown): VeryfrontConfig {
  return validateVeryfrontConfig(userConfig) as VeryfrontConfig;
}

const FILESYSTEM_BACKEND_KEYS = ["local", "veryfront", "memory", "github"] as const;
type FilesystemBackendKey = (typeof FILESYSTEM_BACKEND_KEYS)[number];

function filesystemBackendKey(
  type: string,
): FilesystemBackendKey {
  switch (type) {
    case "local":
    case "memory":
    case "github":
      return type;
    case "veryfront-api":
      return "veryfront";
    default:
      throw CONFIG_VALIDATION_FAILED.create({
        detail: `Unsupported filesystem backend "${type}"`,
      });
  }
}

function mergeFilesystemConfig(
  defaults: VeryfrontConfig["fs"],
  userConfig: VeryfrontConfig["fs"],
): NonNullable<VeryfrontConfig["fs"]> {
  if (defaults?.type === "veryfront-api" && defaults.veryfront?.proxyMode === true) {
    if (userConfig && Object.keys(userConfig).length > 0) {
      throw CONFIG_VALIDATION_FAILED.create({
        detail:
          "Filesystem configuration is platform-managed in proxy mode and cannot be overridden by project config",
      });
    }
    return {
      ...defaults,
      veryfront: {
        ...defaults.veryfront,
        ...(defaults.veryfront.cache ? { cache: { ...defaults.veryfront.cache } } : {}),
        ...(defaults.veryfront.retry ? { retry: { ...defaults.veryfront.retry } } : {}),
      },
    };
  }

  const selectedType = userConfig?.type ?? defaults?.type ?? "local";
  const selectedKey = filesystemBackendKey(selectedType);
  for (const key of FILESYSTEM_BACKEND_KEYS) {
    if (key !== selectedKey && userConfig?.[key] !== undefined) {
      throw CONFIG_VALIDATION_FAILED.create({
        detail: `Filesystem options for "${key}" do not match selected backend "${selectedType}"`,
      });
    }
  }

  const selectedDefaults = defaults?.type === selectedType ? defaults : undefined;
  const merged: NonNullable<VeryfrontConfig["fs"]> = {
    type: selectedType,
  };

  if (selectedKey === "local" && (selectedDefaults?.local || userConfig?.local)) {
    merged.local = { ...selectedDefaults?.local, ...userConfig?.local };
  } else if (selectedKey === "memory" && (selectedDefaults?.memory || userConfig?.memory)) {
    merged.memory = { ...selectedDefaults?.memory, ...userConfig?.memory };
  } else if (
    selectedKey === "veryfront" &&
    (selectedDefaults?.veryfront || userConfig?.veryfront)
  ) {
    const veryfront = {
      ...selectedDefaults?.veryfront,
      ...userConfig?.veryfront,
    } as NonNullable<NonNullable<VeryfrontConfig["fs"]>["veryfront"]>;
    if (selectedDefaults?.veryfront?.cache || userConfig?.veryfront?.cache) {
      veryfront.cache = {
        ...selectedDefaults?.veryfront?.cache,
        ...userConfig?.veryfront?.cache,
      };
    }
    if (selectedDefaults?.veryfront?.retry || userConfig?.veryfront?.retry) {
      veryfront.retry = {
        ...selectedDefaults?.veryfront?.retry,
        ...userConfig?.veryfront?.retry,
      };
    }
    merged.veryfront = veryfront;
  } else if (selectedKey === "github" && (selectedDefaults?.github || userConfig?.github)) {
    const github = {
      ...selectedDefaults?.github,
      ...userConfig?.github,
    } as NonNullable<NonNullable<VeryfrontConfig["fs"]>["github"]>;
    if (selectedDefaults?.github?.cache || userConfig?.github?.cache) {
      github.cache = {
        ...selectedDefaults?.github?.cache,
        ...userConfig?.github?.cache,
      };
    }
    if (selectedDefaults?.github?.retry || userConfig?.github?.retry) {
      github.retry = {
        ...selectedDefaults?.github?.retry,
        ...userConfig?.github?.retry,
      };
    }
    merged.github = github;
  }

  return merged;
}

/** @internal Exported for tests: merges user config over fresh defaults (deep for nested objects). */
export function mergeConfigs(userConfig: Partial<VeryfrontConfig>): VeryfrontConfig {
  const defaults = createFreshDefaults();
  const mergedFs = mergeFilesystemConfig(defaults.fs, userConfig.fs);

  const merged = {
    ...defaults,
    ...userConfig,
    fs: mergedFs,
    dev: {
      ...defaults.dev,
      ...userConfig.dev,
    },
    theme: {
      ...defaults.theme,
      ...userConfig.theme,
      // Deep-merge colors so a user setting one color keeps the default palette.
      colors: {
        ...defaults.theme?.colors,
        ...userConfig.theme?.colors,
      },
    },
    build: {
      ...defaults.build,
      ...userConfig.build,
      // Deep-merge esbuild so a partial override keeps default wasmURL/worker.
      esbuild: {
        ...defaults.build?.esbuild,
        ...userConfig.build?.esbuild,
      },
    },
    cache: {
      ...defaults.cache,
      ...userConfig.cache,
      // Deep-merge render so `cache: { dir: "/custom" }` doesn't drop the default
      // render sub-object (whose absence crashed callers reading cache.render.type).
      render: {
        ...defaults.cache?.render,
        ...userConfig.cache?.render,
      },
    },
    resolve: {
      ...defaults.resolve,
      ...userConfig.resolve,
    },
    client: {
      ...defaults.client,
      ...userConfig.client,
      cdn: {
        ...defaults.client?.cdn,
        ...userConfig.client?.cdn,
      },
    },
  } as VeryfrontConfig;

  const defaultMap = defaults.resolve?.importMap;
  const userMap = userConfig.resolve?.importMap;

  if (merged.resolve && (defaultMap || userMap)) {
    merged.resolve.importMap = {
      imports: {
        ...(defaultMap?.imports ?? {}),
        ...(userMap?.imports ?? {}),
      },
      scopes: {
        ...(defaultMap?.scopes ?? {}),
        ...(userMap?.scopes ?? {}),
      },
    };
  }

  return merged;
}

function validateAndMergeConfig(userConfig: unknown): VeryfrontConfig {
  const normalizedConfig = validateConfigShape(userConfig);

  const merged = mergeConfigs(normalizedConfig);

  if (merged.react?.version) {
    logger.debug("React version from config", { version: merged.react.version });
  }

  return merged;
}

/**
 * Select the authored configuration value from an imported module namespace.
 *
 * Presence, rather than truthiness, determines whether the default export is
 * authoritative. This preserves explicit falsy exports for validation while
 * retaining named-export-only configuration modules.
 */
function selectConfigModuleValue(configModule: object): unknown {
  const defaultExport = getOwnPropertyDescriptor(configModule, "default");
  if (defaultExport === undefined) return configModule;

  const value = getOwnPropertyDescriptor(defaultExport, "value");
  if (value === undefined) {
    throw CONFIG_PARSE_ERROR.create({
      detail: "The configuration module default export is not a data binding",
    });
  }
  return value.value;
}

function translateHostedConfigEvaluationError(
  error: DeclarativeConfigEvaluationError,
  configFile?: string,
): Error {
  if (error.reason === "worker-aborted") return error;

  const context = {
    ...(configFile === undefined ? {} : { configFile }),
    code: error.code,
    phase: error.phase,
    reason: error.reason,
    retryable: error.retryable,
    location: error.location,
  };

  if (error.reason === "worker-protocol") {
    return INITIALIZATION_ERROR.create({
      detail: "Hosted configuration evaluator returned an invalid response",
      cause: error,
      context,
    });
  }

  if (error.code === "evaluator-unavailable" || error.code === "parser-unavailable") {
    return SERVICE_OVERLOADED.create({
      detail: "Hosted configuration evaluation is temporarily unavailable",
      cause: error,
      context,
    });
  }

  // The code/reason pair is what operators correlate on, so it stays first
  // and unchanged. The sentence after it is for the developer whose project
  // this is: without it the only signal a rejected config gives is a 500.
  return CONFIG_PARSE_ERROR.create({
    detail: `Hosted configuration rejected (${error.code}: ${error.reason}). ` +
      describeHostedConfigRejection(error.reason),
    cause: error,
    context,
  });
}

function isPreservedConfigLoadError(error: unknown): boolean {
  return error instanceof VeryfrontError;
}

/**
 * How much of a config module's own failure the report repeats.
 *
 * The cause is authored by the project being loaded, so a hosted build log must
 * not become a paste surface for it. One line, bounded, control characters
 * removed.
 */
const MAX_CONFIG_LOAD_CAUSE_CHARACTERS = 200;

// deno-lint-ignore no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;
// A colorized cause arrives as ESC + "[31m" + text. Dropping only the ESC as a
// control character leaves the "[31m" behind, and that residue sits between the
// start of the token and the path -- which defeats any pattern anchored on what
// precedes a path. Remove the whole sequence so the path patterns see the text
// a plain terminal would.
//
// Matches the full CSI grammar rather than the colour sequences alone:
// parameter bytes 0x30-0x3F, intermediate bytes 0x20-0x2F, one final byte
// 0x40-0x7E. Accepting only digits and semicolons missed the colon-separated
// form a true-colour sequence uses (`ESC[38:2:255:0:0m`), whose residue then
// defeated POSIX_ABSOLUTE_PATH exactly as an unstripped `[31m` would.
// deno-lint-ignore no-control-regex
const ANSI_CSI_SEQUENCE = /(?:\u001B\[|\u009B)[\u0030-\u003F]*[\u0020-\u002F]*[\u0040-\u007E]/g;
// A CSI introducer, with any parameter and intermediate bytes it carries,
// immediately followed by a path start. Removed before the full CSI pass so
// that pass cannot consume the path's first characters; see
// summarizeConfigLoadCause for why the path itself is not redacted here.
//
// The parameter and intermediate runs are part of the match, not just the bare
// introducer: `ESC[31C:\\Users\\alice` is a legal CUF sequence whose final byte
// is the drive letter, and `ESC[31/home/alice` is a legal sequence whose
// intermediate is the leading `/` and whose final byte is the `h`. Matching only
// the introducer left `:\\Users\\alice` and `ome/alice` behind, which no later
// path pattern recognises.
//
// The intermediate run stops at 0x2E rather than the grammar's 0x2F, because
// 0x2F is `/` -- the first character of the path this pass exists to preserve.
//
// The final byte is optional so a *completed* sequence is covered too, not only
// an introducer. `Failed at` + `ESC[3~` + `/home/alice/x` is a legal CSI whose
// final byte is `~`; removing it during de-colorization joined `at` to the path,
// POSIX_ABSOLUTE_PATH's lookbehind then refused the slash, and the path reached
// the caller. Optional rather than required, because `ESC[/home` has no final
// byte before the path at all.
//
// The backslash branch of the lookahead requires *both* UNC separators, not one.
// A backslash is 0x5C, inside the final-byte range, so in an introducer followed by
// a UNC path the optional final byte ate the first separator while the lookahead was
// satisfied by the second. The pass then emitted a single-separator path, which
// WINDOWS_ABSOLUTE_PATH does not recognise -- it requires a doubled separator or a
// drive letter -- so the UNC path reached the caller. `origin/main` redacts that same
// input, so this pre-pass introduced the leak rather than inheriting it. Demanding
// both separators makes the engine backtrack the optional final byte to zero width
// and leave the prefix whole. A forward slash needs no such care: 0x2F sits below the
// final-byte range, and the intermediate run already stops at 0x2E to protect it.
//
// The sequence is taken here rather than by making de-colorization emit a space
// instead of nothing. That pass must keep emitting nothing: `sk-` + `ESC[0m` +
// `ABCD1234EFGH5678` only rejoins into a contiguous credential if the removal
// leaves no gap, and the sanitiser that runs after it matches nothing otherwise.
// Fixing a path boundary must not reopen that.
const CSI_GLUED_PATH =
  // deno-lint-ignore no-control-regex
  /(?:\u001B\[|\u009B)[\u0030-\u003F]*[\u0020-\u002E]*[\u0040-\u007E]?(?=\\\\|\/|[A-Za-z]:[\\/])/g;
// The same pre-pass for a special-scheme URL start, which the CSI grammar eats
// exactly as it eats a path. In `ESC[https:registry.internal/x`, `h` is a legal
// final byte, so the CSI pass left `ttps:registry.internal/x`:
// ZERO_SLASH_SCHEME_URL no longer recognises the damaged scheme, and
// POSIX_ABSOLUTE_PATH refuses the `/x` that follows a hostname, so the private
// host reached the caller. `wss`, `ftp`, the 8-bit introducer, a parameterized
// introducer and an uppercase scheme all leaked the same way; the single-slash
// form survived but emitted `ttp[path]`, the path-as-URL mislabel this PR
// exists to remove.
//
// A separate constant rather than a third alternative in the one above. The two
// share a prefix, so folding them together is the obvious move -- and it is what
// took SonarCloud's maintainability rating on new code to B. Splitting a dense
// alternation into plain per-shape constants is what cleared the same gate
// earlier in this PR, when `REMOTE_URL` became SCHEME_URL and
// MALFORMED_SCHEME_URL. Each pass reads as one rule.
//
// The list is every scheme the redactor itself recognises: the special schemes
// of MALFORMED_SCHEME_URL and ZERO_SLASH_SCHEME_URL, plus `file`, which
// FILE_URL_ABSOLUTE_PATH claims. `file` is here because `f` is a legal final
// byte, so `ESC[file:///home/alice/x` lost `ESC[f` and SCHEME_URL read the
// remaining `ile:///home/alice/x` as a remote URL -- reporting `[url]` for a
// local path. Keep this list in sync with those three. A generic
// `[A-Za-z][A-Za-z0-9+.-]*:` lookahead cannot be used: it matches the prose in
// `ESC[0mError: cannot find module`, which would strip `ESC[0` and leave a
// stray `m` in an ordinary diagnostic. A generic `scheme://` needs no help
// here, because SCHEME_URL still matches the damaged `ttps://host/x`.
//
// `i` is safe on the whole pattern: every other class is either explicitly
// both cases (`[A-Za-z]`) or contains no letters at all.
const CSI_GLUED_URL =
  // deno-lint-ignore no-control-regex
  /(?:\u001B\[|\u009B)[\u0030-\u003F]*[\u0020-\u002E]*[\u0040-\u007E]?(?=(?:https?|wss?|ftp|file):)/gi;
// The scheme needs at least two characters: `C://Users/alice` is a drive path
// that Node normalises, not a URL with the one-letter scheme `C`, and matching it
// here reintroduced the path-as-URL mislabel this PR exists to remove. No
// registered scheme is a single character.
// A remote config URL is redacted whole rather than picked apart: AGENTS.md
// counts private hostnames among the values user-facing output must not carry,
// and the caller cannot tell an internal registry from a public CDN by looking
// at it (veryfront-issue-inbox#836).
//
// The ordinary form. Unanchored on the left so a scheme glued to preceding
// text (`3https://host/x`) is still recognised rather than falling through to
// the Windows pattern.
//
// The scheme length is bounded because this runs over the whole message before
// the 200-character cap applies. Unbounded, the greedy prefix rescans to the
// end of the input at every position starting with a letter, so a long
// alphabetic message with no colon costs O(n^2) -- 100k characters measured at
// ~17.9s, versus ~34ms bounded. Every registered scheme is far shorter than 31.
//
// The final two alternatives keep an unbalanced parenthesis from ending the
// match. Without them the
// hostname redacted but the tail did not, so
// `https://host/a(TOKEN/c.ts` came back as `[url](TOKEN/c.ts` and a query-string
// token printed verbatim into the caller-visible error
// (veryfront-issue-inbox#845). It reproduces on `origin/main`, so this is a
// pre-existing gap rather than one introduced with the URL passes.
//
// The distinct lookaheads are load-bearing. A lone opening parenthesis may
// precede any non-blank URL tail. A lone closing parenthesis continues only
// before a URL-like character, so prose punctuation in
// `Failed (see https://host/x). Retry` stays outside the match.
//
// Dropping the balanced branch instead would be simpler and 25x faster, and was
// rejected. It takes the quadratic guard's probe from ~45ms to ~0.2ms, which
// leaves that guard passing while measuring nothing -- a failure mode that
// already defanged it once -- and it emits `[url])` for a URL ending in `(b)`,
// adding a cosmetic artefact to a change whose purpose is removing one.
//
// The balanced and lone-`(` branches are both ambiguous on `(`, so the cost was
// measured rather than assumed. On the quadratic guard's own `"ab://(".repeat(n)`
// input, for n of 10k/20k/40k, the tail costs 20/40/80ms against origin/main's
// 21/45/83ms -- within noise, still linear at 2x per doubling, and far inside the
// guard's 20x ratio. Shapes that exercise the `)` branch stay at 0-3ms on both.
//
// The closing-paren lookahead asks a structural question -- is the rest of this
// token nothing but trailing punctuation or symbols? -- rather than listing the
// characters prose is allowed to end with. Listing them does not converge: `.,;:)]` still
// mangled `Failed (see https://host/x)! Retry` into `Failed (see [url] Retry`,
// and adding `!` next would have left `?`, `}`, `>` and the rest of sentence
// punctuation behind it. Worse, `?` can never go in such a list -- it legitimately
// opens a query string, so excluding it would strand `https://host/a)?t=SECRET`
// with its token in the caller-visible detail.
// Unicode's `Punctuation`, `Symbol`, `Mark`, and `Format` properties supply the
// structural categories, covering sentence marks and complete emoji sequences.
// The latter need marks such as variation selectors and format characters such
// as zero-width joiners in addition to their symbol code points.
//
// Asking the structural question settles both at once. A `)` whose remaining
// token is only punctuation before a boundary is prose, so it stays outside the
// match; anything else is URL and is consumed. `https://host/a)?t=SECRET` is
// redacted whole because `t=SECRET` follows the `?`, while `(see .../x)? Retry`
// keeps its bracket because nothing but the space follows.
//
// The `{0,16}` bound is load-bearing, like every other bound in this file. An
// unbounded run rescans from each `)` in a long chain of them, so a single token
// carrying 2k/4k/8k closing parens cost 6/22/89ms -- 4x per doubling, quadratic,
// and reachable from a project-authored error. Bounded, the same inputs are
// 0/0/1ms. No real sentence ends in 16 punctuation marks.
//
// Keep this source shared by every URL shape. Apart from preventing the four
// redactors from drifting, the extraction keeps each complete expression below
// the static-analysis complexity threshold.
//
// An RFC 3986 URI is ASCII before percent-encoding. Defining the token from
// that legal set makes any non-ASCII character after a completed ASCII prefix
// a boundary, including scripts that do not put spaces between a URL and the
// following sentence. A percent-encoded equivalent stays entirely inside the
// token.
//
// Apostrophes are intentionally absent even though RFC 3986 lists them as a
// sub-delimiter. The userinfo prefix handles them before `@`, while the tail
// must leave the closing quote in `Cannot find module 'https://host/x'` intact.
const URI_TOKEN_CHARACTER_SOURCE = String.raw`[A-Za-z0-9\-._~:/?#\[\]@!$&*+,;=%]`;
const URI_PAREN_INTERIOR_SOURCE = String.raw`[A-Za-z0-9\-._~:/?#\[\]@!$&()*+,;=%]`;
const URL_TOKEN_TAIL_SOURCE = String
  .raw`(?:${URI_TOKEN_CHARACTER_SOURCE}|\(${URI_PAREN_INTERIOR_SOURCE}{0,512}\)|\((?=${URI_PAREN_INTERIOR_SOURCE})|\)(?=${URI_PAREN_INTERIOR_SOURCE})(?![\p{P}\p{S}\p{M}\p{Cf}]{0,16}(?:[\s"']|$)))+`;
const SCHEME_URL = new RegExp(
  String.raw`[A-Za-z][A-Za-z0-9+.-]{1,31}://(?:[^\s"/]{0,512}@)?${URL_TOKEN_TAIL_SOURCE}`,
  "gu",
);
// The ASCII-tail rule above deliberately ends before raw IRI characters. If
// the authority itself contains one, however, the completed ASCII prefix is
// not the complete host. Fail closed on the whitespace-delimited token so an
// internationalized hostname cannot fall through to the path passes and reach
// the diagnostic. This runs after the file-URL pass, which keeps local file
// URLs classified as paths.
//
// Unicode after the first slash does not match this fallback. The normal rule
// handles that shape and preserves the following prose, which is the no-space
// boundary this fallback must not undo.
const NON_ASCII_AUTHORITY_URL =
  /[A-Za-z][A-Za-z0-9+.-]{1,31}:\/\/(?:[^\s"/]{0,512}@)?(?=[^\s"/]{0,512}[\u0080-\u{10FFFF}])[^\s"']*/gu;
// Raw Unicode at the start of a slash-delimited path segment is part of an IRI,
// rather than prose glued to the preceding ASCII segment. Match the complete
// whitespace-delimited token in that unambiguous case. Requiring the segment
// boundary preserves `https://host/x次を試す` as `[url]次を試す`.
const NON_ASCII_URL_PATH = new RegExp(
  String
    .raw`[A-Za-z][A-Za-z0-9+.-]{1,31}://(?:[^\s"/]{0,512}@)?[^\s"/]{1,512}(?:/${URI_TOKEN_CHARACTER_SOURCE}{0,2048})?/(?=[^\x00-\x7F])[^\s"']*`,
  "gu",
);
// Avoid a second generic scheme scan for ordinary ASCII diagnostics. Without
// this gate, the long-alphabetic quadratic guard reached its unchanged 20x
// limit even though the fallback could not match.
const NON_ASCII_CHARACTER = /[\u0080-\u{10FFFF}]/u;
// A sticky continuation used only when an ASCII URL match ends on a structural
// component delimiter. In that position a following non-ASCII character is a
// raw IRI path, query, or fragment rather than prose glued after a completed
// path segment. The continuation consumes the rest of that token fail-closed.
const RAW_IRI_REMAINDER = /\P{ASCII}[^\s"']*/uy;

// Both the userinfo run and the parenthesised interior are length-bounded, and
// the userinfo run also stops at `/`. Neither bound is cosmetic. An unbounded
// greedy interior rescans the rest of the message from every `(` that never
// finds a `)`, so `"a://(".repeat(20_000)` cost 2.6s and grew 4x per doubling --
// quadratic, and reachable from a project-authored error because
// summarizeConfigLoadCause runs this before the 200-character cap. Bounded, the
// same input is 42ms and grows 2x per doubling. `/` cannot appear unencoded in
// userinfo (it terminates the authority), so excluding it costs nothing and
// keeps that run inside the authority rather than the whole message.
//
// The interior of a parenthesised segment is `[^\s"']*`, not `[^\s"'()]*`: a
// flat interior matches one nesting level, so `/a((TOKEN))` ended the token at
// the first `(` and left `((TOKEN))` in the caller-visible detail -- a URL path
// or query fragment, which can carry the value it was redacting. A greedy
// interior backtracks to the last `)` in the run, so any nesting depth is
// consumed in one pass. A token with no `(` at all is unaffected, which is what
// still leaves a trailing prose `)` outside the match.
// The userinfo run excludes only whitespace and a double quote, not an
// apostrophe: RFC 3986 puts `'` in sub-delims, so `user'name@registry.internal`
// is a legal authority, and stopping at the apostrophe left the hostname in the
// caller-visible detail. The tail still excludes `'`, so a quoted config
// message such as `Cannot find module 'some-pkg'` is unaffected and the quoted
// path and quoted URL regressions keep their delimiters.
// Userinfo gets its own permissive run up to `@`, rather than relying on the
// balanced-parentheses alternative that covers the rest of the token. That
// alternative matches one flat `(...)` pair, so a legal nested userinfo such as
// `u((x))y@registry.internal` ended the match at the first `(` and left the
// hostname in the caller-visible detail. RFC 3986 puts `(` and `)` in
// sub-delims, so nesting there is valid rather than exotic. `[^\s"']*` cannot
// cross whitespace or a quote, so the run stays inside one URL token and a
// trailing prose `)` is still left behind.
// The malformed single-slash form, kept separate from SCHEME_URL rather than
// folded in as an alternation: two plain patterns read more clearly than one
// branching expression, and each stays independently checkable.
//
// Restricted to the WHATWG special schemes, like the zero-slash form below and
// for a sharper version of the same reason. A generic `[A-Za-z][...]{1,31}:`
// shape claimed `atC` in `Failed atC:/Users/alice/x` -- reporting `Failed [url]`,
// which both mislabels a local path and eats the word `at`. A two-character
// minimum is not enough to separate a scheme from prose glued to a drive letter.
// A glued *URL* still redacts: the match simply starts later in the token, so
// `Failed athttps:/registry.internal/x` gives `Failed at[url]` and keeps `at`.
const ASCII_SPECIAL_SCHEME_SOURCE = "(?:[hH][tT][tT][pP][sS]?|[wW][sS][sS]?|[fF][tT][pP])";
const MALFORMED_SCHEME_URL = new RegExp(
  String.raw`${ASCII_SPECIAL_SCHEME_SOURCE}:/(?!/)(?:[^\s"/]{0,512}@)?${URL_TOKEN_TAIL_SOURCE}`,
  "gu",
);
// The zero-slash form of a WHATWG special scheme. `https:registry.internal/x`
// parses to `https://registry.internal/x`, so the hostname is just as real as in
// the two-slash form, but neither pattern above matches it -- both require at
// least one slash -- and POSIX_ABSOLUTE_PATH refuses `/x` because it follows an
// alphanumeric. Restricted to the special schemes rather than the generic
// `[A-Za-z][A-Za-z0-9+.-]+:` shape, because that would claim ordinary prose
// (`warning:something`) and, at one character, drive letters.
//
// Scheme matching is ASCII-case-insensitive by construction. The Unicode `iu`
// combination folds `ſ` to `s`, which would make ordinary `httpſ:failure` prose
// look like a special-scheme URL even though URL schemes are ASCII-only.
const ZERO_SLASH_SCHEME_URL = new RegExp(
  String.raw`${ASCII_SPECIAL_SCHEME_SOURCE}:(?![/\s])(?:[^\s"/]{0,512}@)?${URL_TOKEN_TAIL_SOURCE}`,
  "gu",
);
// The IRI fallbacks mirror the malformed single-slash and zero-slash forms
// above. Each authority matcher catches a raw Unicode hostname, while each path
// matcher catches a raw Unicode segment after a complete ASCII authority. All
// are bounded before the first non-ASCII character so hostile diagnostics
// remain linear-time.
const NON_ASCII_MALFORMED_AUTHORITY_URL = new RegExp(
  String
    .raw`${ASCII_SPECIAL_SCHEME_SOURCE}:/(?!/)(?:[^\s"/]{0,512}@)?(?=[^\s"/]{0,512}[^\x00-\x7F])[^\s"']*`,
  "gu",
);
const NON_ASCII_MALFORMED_URL_PATH = new RegExp(
  String
    .raw`${ASCII_SPECIAL_SCHEME_SOURCE}:/(?!/)(?:[^\s"/]{0,512}@)?[^\s"/]{1,512}(?:/${URI_TOKEN_CHARACTER_SOURCE}{0,2048})?/(?=[^\x00-\x7F])[^\s"']*`,
  "gu",
);
const NON_ASCII_ZERO_SLASH_AUTHORITY_URL = new RegExp(
  String
    .raw`${ASCII_SPECIAL_SCHEME_SOURCE}:(?![/\s])(?:[^\s"/]{0,512}@)?(?=[^\s"/]{0,512}[^\x00-\x7F])[^\s"']*`,
  "gu",
);
const NON_ASCII_ZERO_SLASH_URL_PATH = new RegExp(
  String
    .raw`${ASCII_SPECIAL_SCHEME_SOURCE}:(?![/\s])(?:[^\s"/]{0,512}@)?[^\s"/]{1,512}(?:/${URI_TOKEN_CHARACTER_SOURCE}{0,2048})?/(?=[^\x00-\x7F])[^\s"']*`,
  "gu",
);
const QUOTED_WINDOWS_ABSOLUTE_PATH = /(?<=["'])(?:[A-Za-z]:[\\/]|\\\\)[^"'\r\n]+(?=["'])/g;
const QUOTED_POSIX_ABSOLUTE_PATH = /(?<=["'])\/[^"'\r\n]+(?=["'])/g;
// Case-insensitive for the same reason. `FILE:///home/alice` otherwise fell
// past this pattern to SCHEME_URL and came back as `[url]`. Not a leak -- the
// home directory was redacted either way -- but it reported a local path as a
// remote URL, which is this PR's original misclassification running backwards.
const FILE_URL_ABSOLUTE_PATH = new RegExp(
  `file:///${URL_TOKEN_TAIL_SOURCE}`,
  "giu",
);
// Run before FILE_URL_ABSOLUTE_PATH. That ASCII matcher intentionally stops at
// raw Unicode, but replacing only its prefix would expose a later IRI segment.
// As with NON_ASCII_URL_PATH, the segment boundary distinguishes path data from
// prose glued directly to an ASCII filename.
const NON_ASCII_FILE_URL_PATH = new RegExp(
  String.raw`file:///(?:${URI_TOKEN_CHARACTER_SOURCE}{0,2048}/)?(?=[^\x00-\x7F])[^\s"']*`,
  "giu",
);
// Unanchored on the left. A boundary here refuses a path glued to preceding
// text (`Failed atC:\\Users\\alice\\...`), and neither URL pattern can claim a
// backslash form, so the path would reach the caller intact. The scheme match in
// SCHEME_URL and MALFORMED_SCHEME_URL is what keeps `https:/` away from the
// drive-letter alternative, so the boundary is not needed for that either.
const WINDOWS_ABSOLUTE_PATH = /(?:[A-Za-z]:[\\/]|\\\\)[^\s"'()]+/g;
const POSIX_ABSOLUTE_PATH = /(?<![A-Za-z0-9:/.\\])\/[^\s"'()]+/g;

function rawIriMatchEnd(value: string, matched: string, offset: number): number {
  const lastCharacter = ReflectApply(StringPrototypeSlice, matched, [-1]) as string;
  if (
    lastCharacter !== "/" &&
    lastCharacter !== "?" &&
    lastCharacter !== "#" &&
    lastCharacter !== "&" &&
    lastCharacter !== "="
  ) {
    return offset;
  }

  RAW_IRI_REMAINDER.lastIndex = offset;
  try {
    const remainder = ReflectApply(RegExpPrototypeExec, RAW_IRI_REMAINDER, [value]) as
      | RegExpExecArray
      | null;
    return remainder === null ? offset : RAW_IRI_REMAINDER.lastIndex;
  } finally {
    RAW_IRI_REMAINDER.lastIndex = 0;
  }
}

function replaceMatchesWithCapturedExec(
  value: string,
  pattern: RegExp,
  replacement: string,
  extendRawIri = false,
): string {
  pattern.lastIndex = 0;
  let output = "";
  let offset = 0;
  try {
    while (true) {
      const match = ReflectApply(RegExpPrototypeExec, pattern, [value]) as
        | RegExpExecArray
        | null;
      if (match === null) break;
      const matched = match[0];
      if (matched.length === 0) throw new TypeError("Diagnostic pattern must make progress");
      if (extendRawIri) pattern.lastIndex = rawIriMatchEnd(value, matched, pattern.lastIndex);
      output += ReflectApply(StringPrototypeSlice, value, [offset, match.index]) as string;
      output += replacement;
      offset = pattern.lastIndex;
    }
    output += ReflectApply(StringPrototypeSlice, value, [offset]) as string;
    return output;
  } finally {
    pattern.lastIndex = 0;
  }
}

function containsNonAscii(value: string): boolean {
  return ReflectApply(RegExpPrototypeExec, NON_ASCII_CHARACTER, [value]) !== null;
}

/**
 * Replace machine-identifying locations in a diagnostic with stable markers.
 *
 * The order is load-bearing, narrowest first. Each pass consumes its matches
 * before the next runs, so an earlier pattern is what keeps a later, greedier
 * one away from text it would mis-read:
 *
 * 1. the quoted forms, whose surrounding quotes bound the match precisely;
 * 2. `file:///`, including its unambiguous raw-IRI path form, which is a path
 *    wearing a URL and is reported as `[path]`;
 * 3. the non-ASCII authority and path fallbacks, then `SCHEME_URL` and
 *    `MALFORMED_SCHEME_URL`, each reported as `[url]` -- together these are
 *    also what keep `https:/` away from step 4, whose drive-letter alternative
 *    would otherwise match the `s:/` inside it and emit `http[path]`;
 * 4. unquoted Windows drive and UNC paths;
 * 5. unquoted POSIX paths.
 *
 * Callers must strip ANSI sequences first -- `summarizeConfigLoadCause` does,
 * before it sanitises credentials. Colorized text leaves `[31m` style residue
 * directly in front of a path once the escape itself is gone, which defeats the
 * boundary lookbehind step 5 relies on.
 *
 * That caller also removes a CSI introducer glued to a path start beforehand
 * (`CSI_GLUED_PATH`), because the CSI grammar would otherwise consume the path's
 * own first characters. It removes only the introducer, so this function still
 * runs exactly once and still runs after de-colorization.
 */
function redactMachinePaths(value: string): string {
  let redacted = replaceMatchesWithCapturedExec(value, QUOTED_WINDOWS_ABSOLUTE_PATH, "[path]");
  redacted = replaceMatchesWithCapturedExec(redacted, QUOTED_POSIX_ABSOLUTE_PATH, "[path]");
  if (containsNonAscii(redacted)) {
    redacted = replaceMatchesWithCapturedExec(redacted, NON_ASCII_FILE_URL_PATH, "[path]");
  }
  redacted = replaceMatchesWithCapturedExec(redacted, FILE_URL_ABSOLUTE_PATH, "[path]", true);
  if (containsNonAscii(redacted)) {
    redacted = replaceMatchesWithCapturedExec(redacted, NON_ASCII_AUTHORITY_URL, "[url]");
    redacted = replaceMatchesWithCapturedExec(redacted, NON_ASCII_URL_PATH, "[url]");
    redacted = replaceMatchesWithCapturedExec(
      redacted,
      NON_ASCII_MALFORMED_AUTHORITY_URL,
      "[url]",
    );
    redacted = replaceMatchesWithCapturedExec(redacted, NON_ASCII_MALFORMED_URL_PATH, "[url]");
    redacted = replaceMatchesWithCapturedExec(
      redacted,
      NON_ASCII_ZERO_SLASH_AUTHORITY_URL,
      "[url]",
    );
    redacted = replaceMatchesWithCapturedExec(redacted, NON_ASCII_ZERO_SLASH_URL_PATH, "[url]");
  }
  redacted = replaceMatchesWithCapturedExec(redacted, SCHEME_URL, "[url]", true);
  redacted = replaceMatchesWithCapturedExec(redacted, MALFORMED_SCHEME_URL, "[url]", true);
  redacted = replaceMatchesWithCapturedExec(redacted, ZERO_SLASH_SCHEME_URL, "[url]", true);
  redacted = replaceMatchesWithCapturedExec(redacted, WINDOWS_ABSOLUTE_PATH, "[path]");
  return replaceMatchesWithCapturedExec(redacted, POSIX_ABSOLUTE_PATH, "[path]");
}

/**
 * Return the one-line summary of `error`, or `undefined` when it has none.
 *
 * Redaction runs over the complete message before anything is cut away, the
 * order `sanitizeBoundedDiagnosticText` documents: taking the first line or the
 * first 200 characters can split `scheme://user:password@host` before the
 * trailing `@host` the redactor matches on, which would leave the password
 * prefix in a status-400 detail.
 */
function summarizeConfigLoadCause(error: unknown): string | undefined {
  const message = typeof error === "string"
    ? error
    : isIntrinsicError(error)
    ? readOwnDataString(error, "message")
    : undefined;
  if (message === undefined) return undefined;
  // Sanitize on both sides of de-colorization. A sequence inside a credential
  // can make it noncontiguous before removal, while a CSI final byte can also
  // consume the first character of a key such as API_KEY. Either ordering alone
  // can therefore expose a usable value after the transformation.
  const initiallyRedacted = sanitizeUrlCredentials(message);
  // Drop a CSI introducer that is glued to the start of a path, before the CSI
  // pass can eat into the path itself. `/` is a valid intermediate byte and `h`
  // a valid final, so `ESC[/home/alice/x` would lose `ESC[/h` and leave
  // `ome/alice/x`, which no later path pattern recognises; `ESC[C:\\Users` would
  // lose the drive letter the same way. Both are legal CSI sequences, so no
  // tightening of the grammar separates them from a path.
  //
  // Replaced with a space, not with nothing. `Failed at` + `ESC[` + `/home/alice`
  // would otherwise become `Failed at/home/alice`, and POSIX_ABSOLUTE_PATH's
  // lookbehind refuses a slash that follows an alphanumeric -- so removing the
  // introducer cleanly would manufacture the one adjacency that defeats the very
  // pass meant to catch it. A doubled space when the text already ended in one is
  // the whole cost.
  //
  // Only the introducer is removed, not the path: redacting here instead would
  // produce `ESC[[path]`, and `[` is itself a valid CSI final byte, so the pass
  // below would eat the marker's opening bracket and emit `path]`. Removing just
  // the introducer leaves the path intact for the single redaction pass at the
  // end, which keeps `redactMachinePaths` running exactly once and after
  // de-colorization -- the precondition its own docstring states.
  const unglued = replaceMatchesWithCapturedExec(initiallyRedacted, CSI_GLUED_PATH, " ");
  const ungluedUrl = replaceMatchesWithCapturedExec(unglued, CSI_GLUED_URL, " ");
  const deColorized = replaceMatchesWithCapturedExec(
    ungluedUrl,
    ANSI_CSI_SEQUENCE,
    "",
  );
  const redacted = sanitizeUrlCredentials(deColorized);
  const firstLine = (ReflectApply(StringPrototypeSplit, redacted, ["\n", 1]) as string[])[0] ??
    "";
  const replaced = replaceMatchesWithCapturedExec(firstLine, CONTROL_CHARACTERS, " ");
  const clean = ReflectApply(StringPrototypeTrim, redactMachinePaths(replaced), []) as string;
  if (clean.length === 0) return undefined;
  return clean.length > MAX_CONFIG_LOAD_CAUSE_CHARACTERS
    ? `${ReflectApply(StringPrototypeSlice, clean, [
      0,
      MAX_CONFIG_LOAD_CAUSE_CHARACTERS - 1,
    ]) as string}…`
    : clean;
}

/**
 * Report why the config module failed, not only which file did.
 *
 * `cause` is attached to the error, but nothing between here and the terminal
 * reads it, at any log level. A reader whose config imports a subpath the
 * package does not export got "Failed to load veryfront.config.ts" and a
 * suggestion to check their syntax -- while the runtime had already said
 * "Package subpath './config' is not defined by exports". Repeating that line
 * is the difference between a build the reader can fix and one they cannot.
 */
function configLoadFailureDetail(configFile: string, error: unknown): string {
  const summary = summarizeConfigLoadCause(error);
  return summary === undefined
    ? `Failed to load ${configFile}`
    : `Failed to load ${configFile}: ${summary}`;
}

/**
 * The installable package a resolution failure names, or `undefined`.
 *
 * Only a bare specifier is fixable by installing dependencies. Every runtime
 * reports a missing relative *file* through the same phrasing as a missing
 * package, so telling that reader to run `npm install` for a file they have
 * not written yet would be the same misdirection this classification exists to
 * remove. The shape of the specifier, not the error code, is what separates
 * them.
 *
 * Rejected here, each for a reader an install would not help:
 * - `./x`, `/x`, `\\x`, and UNC paths are files, on either path separator;
 * - `#x` is a package-internal subpath import;
 * - any URI scheme, which also covers `C:\\...` since a drive letter parses as
 *   one;
 * - `@/x`, Veryfront's own project-module alias, which `parseBarePackageSpecifier`
 *   already rejects: no package named `@/lib/config` exists to install.
 * - Node built-in roots, where an invalid subpath cannot be fixed by installing
 *   a package with the same name;
 * - npm-reserved roots, which package managers reject even though their lexical
 *   shape resembles a package name.
 *
 * Returns the package name rather than the whole specifier. That is the part
 * the reader installs -- `pkg` for `pkg/deep/path` -- and it drops the subpath,
 * which is the only part of a bare specifier that can carry arbitrary
 * author-written text. The result is bounded and stripped of control characters
 * for the same reason `summarizeConfigLoadCause` does it: this string reaches
 * `VeryfrontError.message` and its context, which callers log.
 */
function missingPackageName(specifier: string): string | undefined {
  const hasNpmPrefix = ReflectApply(StringPrototypeStartsWith, specifier, ["npm:"]) as boolean;
  const hasJsrPrefix = ReflectApply(StringPrototypeStartsWith, specifier, ["jsr:"]) as boolean;
  const hasRuntimePrefix = hasNpmPrefix || hasJsrPrefix;
  const bare = hasRuntimePrefix
    ? ReflectApply(StringPrototypeSlice, specifier, [4]) as string
    : specifier;
  if (bare.length === 0) return undefined;
  if (ReflectApply(RegExpPrototypeExec, /^[./\\#]/, [bare]) !== null) return undefined;
  if (ReflectApply(StringPrototypeIncludes, bare, ["\\"]) as boolean) return undefined;
  if (ReflectApply(RegExpPrototypeExec, /^[a-zA-Z][a-zA-Z0-9+.-]*:/, [bare]) !== null) {
    return undefined;
  }

  const parsed = parseBarePackageSpecifier(bare);
  if (parsed === null) return undefined;

  // Only `npm:`/`jsr:` specifiers carry a version. Node and Bun cannot resolve a
  // plain `left-pad@1.3.0` at all, so installing `left-pad` would not help --
  // that is invalid import syntax, not an absent package.
  if (!hasRuntimePrefix && parsed.version !== null) return undefined;

  // A specifier with a subpath cannot be classified from the message alone.
  // Node reports `require("installed-pkg/missing")` for an *installed* package
  // as `Cannot find module 'installed-pkg/missing'`, identical in shape to a
  // package that is genuinely absent -- so naming the package root would tell
  // a reader to install something they already have, and the subpath, which is
  // the real fault, is not installable at all. Falling through to the parse
  // error keeps the runtime's own message, which names the whole specifier.
  if (parsed.subpath !== null) return undefined;
  if (
    !hasRuntimePrefix &&
    ReflectApply(SetPrototypeHas, NODE_BUILTIN_PACKAGE_NAMES, [parsed.packageName]) as boolean
  ) {
    return undefined;
  }
  if (
    hasJsrPrefix
      ? !isValidServerExternalPackageName(parsed.packageName)
      : !isInstallableLegacyNpmPackageName(parsed.packageName)
  ) {
    return undefined;
  }
  const lowercasePackageName = ReflectApply(
    StringPrototypeToLowerCase,
    parsed.packageName,
    [],
  ) as string;
  if (lowercasePackageName === "node_modules" || lowercasePackageName === "favicon.ico") {
    return undefined;
  }

  const replaced = replaceMatchesWithCapturedExec(
    sanitizeUrlCredentials(parsed.packageName),
    CONTROL_CHARACTERS,
    " ",
  );
  const clean = ReflectApply(StringPrototypeTrim, replaced, []) as string;
  if (clean.length === 0) return undefined;
  return clean;
}

const LEGACY_NPM_PACKAGE_NAME_PATTERN =
  /^(?:[A-Za-z0-9-][A-Za-z0-9._-]*|@[A-Za-z0-9._-]+\/[A-Za-z0-9_-][A-Za-z0-9._-]*)$/;
const MAX_LEGACY_NPM_PACKAGE_NAME_LENGTH = 214;

/** Accept existing npm names without broadening server-external configuration. */
function isInstallableLegacyNpmPackageName(packageName: string): boolean {
  return packageName.length <= MAX_LEGACY_NPM_PACKAGE_NAME_LENGTH &&
    ReflectApply(
        RegExpPrototypeExec,
        LEGACY_NPM_PACKAGE_NAME_PATTERN,
        [packageName],
      ) !== null;
}

/**
 * How far to walk `cause` when looking for the runtime's resolution error.
 *
 * The loader wraps import failures on its way out, so the runtime's own error
 * is rarely the outermost one. The bound keeps a self-referential chain from
 * spinning.
 */
const MAX_CONFIG_LOAD_CAUSE_DEPTH = 8;
const BUN_RESOLVE_MESSAGE_MODULE_NOT_FOUND_CODE = "ERR_MODULE_NOT_FOUND";

function isIntrinsicError(value: unknown): value is Error & RuntimeReflectionRecord {
  if (typeof value !== "object") return false;
  let prototype: object | null;
  try {
    prototype = ReflectApply(ObjectGetPrototypeOf, Object, [value]) as object | null;
    for (let depth = 0; prototype !== null && depth < 16; depth += 1) {
      if (prototype === IntrinsicErrorPrototype) return true;
      prototype = ReflectApply(ObjectGetPrototypeOf, Object, [prototype]) as object | null;
    }
  } catch {
    return false;
  }
  return false;
}

function readOwnDataString(
  value: RuntimeReflectionRecord,
  key: PropertyKey,
): string | undefined {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return readDataDescriptorString(descriptor);
}

function readDataDescriptorString(
  descriptor: PropertyDescriptor | undefined,
): string | undefined {
  if (descriptor === undefined || !("value" in descriptor)) return undefined;
  return typeof descriptor.value === "string" ? descriptor.value : undefined;
}

function readAccessorString(
  value: RuntimeReflectionRecord,
  key: PropertyKey,
): string | undefined {
  let accessorValue: unknown;
  try {
    accessorValue = reflectGet(value, key);
  } catch {
    return undefined;
  }
  return typeof accessorValue === "string" ? accessorValue : undefined;
}

function isBunResolveMessagePrototypeAccessor(
  descriptor: PropertyDescriptor | undefined,
  options: Readonly<{ hasSetter: boolean }>,
): boolean {
  return descriptor !== undefined &&
    typeof descriptor.get === "function" &&
    (options.hasSetter ? typeof descriptor.set === "function" : descriptor.set === undefined) &&
    descriptor.enumerable === true &&
    descriptor.configurable === false &&
    !("value" in descriptor);
}

function isBunResolveMessagePrototypeData(
  descriptor: PropertyDescriptor | undefined,
  options: Readonly<{
    type: "function" | "string";
    writable: boolean;
    enumerable: boolean;
    configurable: boolean;
    value?: string;
  }>,
): boolean {
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    descriptor.writable !== options.writable ||
    descriptor.enumerable !== options.enumerable ||
    descriptor.configurable !== options.configurable ||
    typeof descriptor.value !== options.type
  ) {
    return false;
  }

  return options.value === undefined || descriptor.value === options.value;
}

function hasReducedBunResolveMessagePrototypeSurface(
  prototype: RuntimeReflectionRecord,
): boolean {
  const keys = ownKeys(prototype);
  if (keys.length !== 3) return false;

  let hasCode = false;
  let hasMessage = false;
  let hasName = false;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === "code") {
      hasCode = true;
    } else if (key === "message") {
      hasMessage = true;
    } else if (key === "name") {
      hasName = true;
    } else {
      return false;
    }
  }

  return hasCode && hasMessage && hasName;
}

function hasNativeBunResolveMessagePrototypeSurface(
  prototype: RuntimeReflectionRecord,
): boolean {
  const keys = ownKeys(prototype);
  if (keys.length !== 15) return false;

  let hasCode = false;
  let hasColumn = false;
  let hasImportKind = false;
  let hasLevel = false;
  let hasLine = false;
  let hasMessage = false;
  let hasPosition = false;
  let hasReferrer = false;
  let hasSpecifier = false;
  let hasToJSON = false;
  let hasToString = false;
  let hasName = false;
  let hasConstructor = false;
  let hasToPrimitive = false;
  let hasToStringTag = false;

  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === "code") {
      hasCode = true;
    } else if (key === "column") {
      hasColumn = true;
    } else if (key === "importKind") {
      hasImportKind = true;
    } else if (key === "level") {
      hasLevel = true;
    } else if (key === "line") {
      hasLine = true;
    } else if (key === "message") {
      hasMessage = true;
    } else if (key === "position") {
      hasPosition = true;
    } else if (key === "referrer") {
      hasReferrer = true;
    } else if (key === "specifier") {
      hasSpecifier = true;
    } else if (key === "toJSON") {
      hasToJSON = true;
    } else if (key === "toString") {
      hasToString = true;
    } else if (key === "name") {
      hasName = true;
    } else if (key === "constructor") {
      hasConstructor = true;
    } else if (key === SymbolToPrimitive) {
      hasToPrimitive = true;
    } else if (key === SymbolToStringTag) {
      hasToStringTag = true;
    } else {
      return false;
    }
  }

  if (
    !hasCode ||
    !hasColumn ||
    !hasImportKind ||
    !hasLevel ||
    !hasLine ||
    !hasMessage ||
    !hasPosition ||
    !hasReferrer ||
    !hasSpecifier ||
    !hasToJSON ||
    !hasToString ||
    !hasName ||
    !hasConstructor ||
    !hasToPrimitive ||
    !hasToStringTag
  ) {
    return false;
  }

  return isBunResolveMessagePrototypeAccessor(
    getOwnPropertyDescriptor(prototype, "column"),
    { hasSetter: false },
  ) &&
    isBunResolveMessagePrototypeAccessor(
      getOwnPropertyDescriptor(prototype, "importKind"),
      { hasSetter: false },
    ) &&
    isBunResolveMessagePrototypeAccessor(
      getOwnPropertyDescriptor(prototype, "level"),
      { hasSetter: false },
    ) &&
    isBunResolveMessagePrototypeAccessor(
      getOwnPropertyDescriptor(prototype, "line"),
      { hasSetter: false },
    ) &&
    isBunResolveMessagePrototypeAccessor(
      getOwnPropertyDescriptor(prototype, "position"),
      { hasSetter: false },
    ) &&
    isBunResolveMessagePrototypeAccessor(
      getOwnPropertyDescriptor(prototype, "referrer"),
      { hasSetter: false },
    ) &&
    isBunResolveMessagePrototypeAccessor(
      getOwnPropertyDescriptor(prototype, "specifier"),
      { hasSetter: false },
    ) &&
    isBunResolveMessagePrototypeData(getOwnPropertyDescriptor(prototype, "toJSON"), {
      type: "function",
      writable: true,
      enumerable: true,
      configurable: false,
    }) &&
    isBunResolveMessagePrototypeData(getOwnPropertyDescriptor(prototype, "toString"), {
      type: "function",
      writable: true,
      enumerable: true,
      configurable: false,
    }) &&
    isBunResolveMessagePrototypeData(
      getOwnPropertyDescriptor(prototype, "constructor"),
      {
        type: "function",
        writable: true,
        enumerable: false,
        configurable: true,
      },
    ) &&
    isBunResolveMessagePrototypeData(
      getOwnPropertyDescriptor(prototype, SymbolToPrimitive),
      {
        type: "function",
        writable: false,
        enumerable: false,
        configurable: true,
      },
    ) &&
    isBunResolveMessagePrototypeData(
      getOwnPropertyDescriptor(prototype, SymbolToStringTag),
      {
        type: "string",
        writable: false,
        enumerable: false,
        configurable: true,
        value: "ResolveMessage",
      },
    );
}

function hasBunResolveMessagePrototypeSurface(prototype: RuntimeReflectionRecord): boolean {
  return hasReducedBunResolveMessagePrototypeSurface(prototype) ||
    hasNativeBunResolveMessagePrototypeSurface(prototype);
}

function isBunResolveMessageAccessorObject(value: RuntimeReflectionRecord): boolean {
  try {
    if (ownKeys(value).length !== 0) return false;
    if (getOwnPropertyDescriptor(value, "code") !== undefined) return false;
    if (getOwnPropertyDescriptor(value, "message") !== undefined) return false;

    const rawPrototype = getPrototypeOf(value);
    if (rawPrototype === null || getPrototypeOf(rawPrototype) !== IntrinsicObjectPrototype) {
      return false;
    }
    const prototype = rawPrototype as RuntimeReflectionRecord;
    if (!hasBunResolveMessagePrototypeSurface(prototype)) {
      return false;
    }
    if (
      !isBunResolveMessagePrototypeAccessor(
        getOwnPropertyDescriptor(prototype, "code"),
        { hasSetter: false },
      )
    ) {
      return false;
    }
    if (
      !isBunResolveMessagePrototypeAccessor(
        getOwnPropertyDescriptor(prototype, "message"),
        { hasSetter: true },
      )
    ) {
      return false;
    }

    const name = readDataDescriptorString(
      getOwnPropertyDescriptor(prototype, "name"),
    );
    return name === "ResolveMessage";
  } catch {
    return false;
  }
}

function missingPackageNameFromBunResolveMessageObject(
  value: RuntimeReflectionRecord,
): string | undefined {
  const ownCode = readOwnDataString(value, "code");
  const ownMessage = readOwnDataString(value, "message");
  const hasBunResolveMessageAccessors = ownCode === undefined || ownMessage === undefined
    ? isBunResolveMessageAccessorObject(value)
    : false;
  const code = ownCode ??
    (hasBunResolveMessageAccessors ? readAccessorString(value, "code") : undefined);
  if (code !== BUN_RESOLVE_MESSAGE_MODULE_NOT_FOUND_CODE) return undefined;
  const message = ownMessage ??
    (hasBunResolveMessageAccessors ? readAccessorString(value, "message") : undefined);
  if (message === undefined) return undefined;
  const specifier = reportedMissingSpecifier(message);
  return specifier === undefined ? undefined : missingPackageName(specifier);
}

/**
 * Name the package a config module imports that the runtime cannot resolve.
 *
 * A config file whose imports do not resolve is not a malformed config file:
 * the remedy is installing dependencies, not editing syntax. Classifying it as
 * a parse error sends the reader to inspect a file that is fine, while the
 * detail line already carries the real cause.
 *
 * Returns `undefined` for resolution failures an install cannot fix -- an
 * unknown subpath of a package that *is* installed resolves the package and
 * rejects the export, and its reported specifier (`./config`) is not bare, so
 * it stays with the parse-error family.
 */
function unresolvedConfigDependency(error: unknown): string | undefined {
  let current: unknown = error;
  // Captured WeakSet, like the rest of this module: a trusted config can replace
  // `globalThis.Set` or poison its prototype before throwing, and a cycle guard
  // that invoked project code would leak that exception in place of the
  // classification. The walker only tracks objects, so a WeakSet fits.
  const seen = new IntrinsicWeakSet<object>();
  for (let depth = 0; depth < MAX_CONFIG_LOAD_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    if (weakSetHas(seen, current)) return undefined;
    weakSetAdd(seen, current);
    if (!isIntrinsicError(current)) {
      return missingPackageNameFromBunResolveMessageObject(
        current as RuntimeReflectionRecord,
      );
    }
    let message: string | undefined;
    try {
      message = typeof current.message === "string" ? current.message : undefined;
    } catch {
      message = undefined;
    }
    const specifier = message === undefined ? undefined : reportedMissingSpecifier(message);
    const packageName = specifier === undefined ? undefined : missingPackageName(specifier);
    if (packageName !== undefined) return packageName;
    // `cause` on a config-thrown error can be a getter that throws. Reading it
    // defensively, as the sibling `errorChain` does, keeps a hostile accessor
    // from escaping in place of the classification.
    try {
      current = current.cause;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * The specifier a runtime says it could not resolve, or `undefined`.
 *
 * Anchored on purpose: a config author's own `Setup failed: Module not found
 * "db"` quotes a resolver phrase without being one, and classifying it as a
 * missing dependency would hand that reader the wrong remedy.
 *
 * Deno appends an ANSI-coloured `hint:` line and an `at <location>` line to its
 * resolution errors, so the real message is three lines where the pattern
 * expects one. The first line is retried rather than the anchors loosened.
 *
 * These formats are also recognised, for a different purpose, by
 * `reportedMissingSpecifier` in `src/extensions/first-party-import.ts`. That
 * module is a published export path whose generated API reference is
 * CI-checked, so its matcher is deliberately not exported; a runtime whose
 * phrasing changes needs updating in both places.
 */
function reportedMissingSpecifier(message: string): string | undefined {
  const firstLine = firstLineIfOnlyRuntimeTrailerFollows(message);
  const candidateCount = firstLine === undefined ? 1 : 2;

  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
    const line = candidateIndex === 0 ? message : firstLine ?? message;
    for (
      let patternIndex = 0;
      patternIndex < MISSING_SPECIFIER_PATTERNS.length;
      patternIndex += 1
    ) {
      const pattern = MISSING_SPECIFIER_PATTERNS[patternIndex]!;
      // Captured intrinsics, like the rest of this module: a trusted config
      // executes in the shared host realm and can poison `String.prototype`
      // before throwing, and a classifier that threw would leave the caller
      // with the poisoned result instead of a VeryfrontError.
      const match = ReflectApply(RegExpPrototypeExec, pattern, [line]) as
        | RegExpExecArray
        | null;
      if (match?.[1] !== undefined) return match[1];
    }
  }
  return undefined;
}

/**
 * What an ANSI SGR sequence leaves behind once its ESC is gone.
 *
 * Deno colours its hint and location lines. Stripping the escape with the
 * existing {@link CONTROL_CHARACTERS} pass leaves `[36m`-shaped residue, which
 * would otherwise sit between the indent and the keyword and defeat the trailer
 * test below. Written without the control character itself so the regex stays
 * within `no-control-regex`; it only ever gates that test, never the specifier
 * that gets extracted.
 */
const SGR_RESIDUE = /\[[0-9;]*m/g;

/** The only Deno trailers this classifier may discard after a resolution error. */
const RUNTIME_TRAILER_LINE =
  /^\s*(?:hint:\s+(?:If you want to use (?:the npm|a JSR) package, try running `deno add (?:npm|jsr):[^`]+`|try running `deno add`)|at\s+(?:file|https?|npm|jsr):\S+:\d+:\d+)$/;

/**
 * The first line, but only when every line after it is a runtime trailer.
 *
 * Deno appends a `hint:` line and an `at <location>` line to its resolution
 * errors, so the real message is three lines where the patterns expect one.
 * Retrying on the first line unconditionally would defeat the end anchor for
 * *any* multi-line message: `new Error("Cannot find module 'db'\ninitialization
 * failed")` is an application error, and matching its first line would answer
 * an uninstalled dependency for it. Requiring the remainder to be trailers
 * keeps the anchor meaningful for everything else.
 */
function firstLineIfOnlyRuntimeTrailerFollows(message: string): string | undefined {
  const lines = ReflectApply(StringPrototypeSplit, message, ["\n"]) as string[];
  if (lines.length < 2) return undefined;
  for (let index = 1; index < lines.length; index += 1) {
    const stripped = replaceMatchesWithCapturedExec(lines[index]!, CONTROL_CHARACTERS, "");
    const line = replaceMatchesWithCapturedExec(stripped, SGR_RESIDUE, "");
    if ((ReflectApply(StringPrototypeTrim, line, []) as string).length === 0) continue;
    if (ReflectApply(RegExpPrototypeExec, RUNTIME_TRAILER_LINE, [line]) === null) {
      return undefined;
    }
  }
  return lines[0];
}

/** Anchored resolution-failure formats, per runtime. */
const MISSING_SPECIFIER_PATTERNS: readonly RegExp[] = [
  // Node (`imported from <path>`) and Bun (`from '<path>'`, sometimes prefixed
  // `ResolveMessage:`). The importer suffix is required so ordinary application
  // errors like `Cannot find module 'db'` do not masquerade as resolver output.
  /^(?:ResolveMessage:\s+)?(?:Cannot find package|Cannot find module)\s+["']([^"']+)["']\s+(?:imported\s+from\s+(?:file:|https?:|npm:|jsr:|\/|[A-Za-z]:|\\\\).+|from\s+["'](?:file:|https?:|npm:|jsr:|\/|[A-Za-z]:|\\\\)[^"']+["'])$/,
  // Deno's complete single-line form.
  /^Module not found\s+["']([^"']+)["']\.$/,
  // Deno, when the importer resolves out of the global npm cache.
  /^Could not find package\s+["']([^"']+)["']\s+from referrer\s+["'][^"']+["'](?:\s+\([^()]*\))?\.?$/,
  // Deno, for a specifier no import map or node_modules entry claims.
  /^Import\s+["']([^"']+)["']\s+not a dependency(?: and not in import map)?(?:\s+from\s+.+)?$/,
  /^Unable to resolve\s+["']([^"']+)["'](?:\s+from\s+.+)?$/,
  // Node CommonJS. Legitimately multi-line, so it is matched against the whole
  // message; the trailing lines are part of the pattern rather than noise after
  // it, which is why the first-line retry must not be what handles this form.
  /^Cannot find module\s+["']([^"']+)["']\nRequire stack:(?:\n- [^\r\n]+)+$/,
];

/**
 * Build the error for a config module that failed to load.
 *
 * Split from the throw sites so every path that loads a config module -- local
 * file, hosted source, hosted source selection -- classifies the same failure
 * the same way.
 */
function configLoadFailure(configFile: string, error: unknown): VeryfrontError {
  const dependency = unresolvedConfigDependency(error);
  if (dependency !== undefined) {
    return DEPENDENCY_MISSING.create({
      detail: `${configFile} imports "${dependency}", which is not installed`,
      cause: error,
      context: { configFile, packageName: dependency },
    });
  }
  return CONFIG_PARSE_ERROR.create({
    detail: configLoadFailureDetail(configFile, error),
    cause: error,
    context: { configFile },
  });
}

async function loadConfigFromTempFile(
  source: string,
  configPath: string,
  loadUrl: (tempFile: string) => string,
  rewriteSource: (source: string) => Promise<string> = rewriteBareVeryfrontConfigImports,
): Promise<unknown> {
  const fs = createFileSystem();
  const originalExt = extname(configPath) || ".mjs";

  // In compiled Deno binaries, we can't import TypeScript directly.
  // Convert .ts/.tsx to .mjs after running it through the bundler transform.
  const needsTranspile = isDenoCompiled && (originalExt === ".ts" || originalExt === ".tsx");
  const extension = needsTranspile ? ".mjs" : originalExt;
  const processedSource = needsTranspile
    ? await transpileConfigSourceForImport(source, configPath)
    : source;

  const tempDir = await fs.makeTempDir({ prefix: "vf-config-" });
  const tempFile = join(tempDir, `config${extension}`);

  try {
    await fs.writeTextFile(
      tempFile,
      await rewriteSource(processedSource),
    );
    const configModule = await import(loadUrl(tempFile));
    return selectConfigModuleValue(configModule);
  } finally {
    await fs.remove(tempDir, { recursive: true });
  }
}

/**
 * Inline stand-in for the bare `veryfront` specifier in user config files.
 *
 * Config modules loaded through {@link loadConfigFromTempFile} execute from a
 * temp file, where bare specifiers have no resolver: Node has no node_modules
 * relative to the temp dir, and compiled Deno binaries have no import map for
 * external dynamic imports. The data URL delegates to the same helper
 * implementations as the framework entrypoint, including its scoped
 * environment reader.
 */
type DefaultModuleLexerModule = {
  EsModuleLexer: new () => ModuleLexer;
};

interface ConfigParseOnlyParser {
  parse(options: { code: string; filePath?: string }): Promise<ASTNode>;
}

type DefaultConfigParserModule = {
  BabelParseOnlyParser: new () => ConfigParseOnlyParser;
};

let fallbackModuleLexerPromise: Promise<ModuleLexer> | undefined;
let fallbackConfigParserPromise: Promise<ConfigParseOnlyParser> | undefined;

async function getConfigModuleLexer(): Promise<ModuleLexer> {
  const registered = tryResolveContract<ModuleLexer>("ModuleLexer");
  if (registered) return registered;

  fallbackModuleLexerPromise ??= thenPromise(
    importFirstPartyExtensionModule<DefaultModuleLexerModule>(
      "ext-bundler-esbuild",
      "@veryfront/ext-bundler-esbuild",
    ),
    ({ EsModuleLexer }) => new EsModuleLexer(),
  );
  return await fallbackModuleLexerPromise;
}

async function getConfigParseOnlyParser(): Promise<ConfigParseOnlyParser> {
  fallbackConfigParserPromise ??= thenPromise(
    importFirstPartyExtensionModule<DefaultConfigParserModule>(
      "ext-parser-babel",
      "@veryfront/ext-parser-babel",
      { sourceEntry: "parser-only", packageSubpath: "parser-only" },
    ),
    ({ BabelParseOnlyParser }) => new BabelParseOnlyParser(),
  );
  return await fallbackConfigParserPromise;
}

function configAstNodeType(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const descriptor = getOwnPropertyDescriptor(value, "type");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function isConfigFunctionAstNode(type: string): boolean {
  return type === "FunctionDeclaration" || type === "FunctionExpression" ||
    type === "ArrowFunctionExpression" || type === "ObjectMethod" ||
    type === "ClassMethod" || type === "ClassPrivateMethod" ||
    type === "TSDeclareFunction";
}

function configAstHasTopLevelAwait(root: ASTNode): boolean { // NOSONAR: intrinsic AST scan is intentionally explicit and covered by loader tests.
  const queue: unknown[] = [root];
  const functionDepths = [0];
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const node = queue[queueIndex];
    const functionDepth = functionDepths[queueIndex] ?? 0;
    const type = configAstNodeType(node);
    if (type === undefined) continue;
    if (type === "AwaitExpression" && functionDepth === 0) return true;
    if (type === "ForOfStatement" && functionDepth === 0) {
      const awaitDescriptor = getOwnPropertyDescriptor(node as object, "await");
      if (awaitDescriptor && "value" in awaitDescriptor && awaitDescriptor.value === true) {
        return true;
      }
    }
    if (type === "VariableDeclaration" && functionDepth === 0) {
      const kindDescriptor = getOwnPropertyDescriptor(node as object, "kind");
      if (
        kindDescriptor && "value" in kindDescriptor && kindDescriptor.value === "await using"
      ) {
        return true;
      }
    }

    const functionNode = isConfigFunctionAstNode(type);
    const keys = ownKeys(node as object);
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) { // NOSONAR: ownKeys traversal must not invoke iterator hooks from project config.
      const key = keys[keyIndex];
      if (key === "type") continue;
      // Computed method keys and decorators run while the containing object or
      // class is initialized. Parameters and bodies run only when called.
      const childFunctionDepth = functionNode && key !== "key" && key !== "decorators"
        ? functionDepth + 1
        : functionDepth;
      const descriptor = getOwnPropertyDescriptor(node as object, key!);
      if (!descriptor || !("value" in descriptor)) continue;
      const child = descriptor.value;
      if (configAstNodeType(child) !== undefined) {
        queue[queue.length] = child;
        functionDepths[functionDepths.length] = childFunctionDepth;
      } else if (ArrayIsArray(child)) {
        for (let childIndex = 0; childIndex < child.length; childIndex++) { // NOSONAR: array traversal must stay index-based under poisoned primordials.
          const item = child[childIndex];
          if (configAstNodeType(item) !== undefined) {
            queue[queue.length] = item;
            functionDepths[functionDepths.length] = childFunctionDepth;
          }
        }
      }
    }
  }
  return false;
}

async function bunConfigHasTopLevelAwait(source: string, configPath: string): Promise<boolean> {
  if (!stringIncludes(source, "await")) return false;
  try {
    const ast = await (await getConfigParseOnlyParser()).parse({
      code: source,
      filePath: configPath,
    });
    const programDescriptor = getOwnPropertyDescriptor(ast, "program");
    const root = programDescriptor && "value" in programDescriptor &&
        configAstNodeType(programDescriptor.value) === "Program"
      ? programDescriptor.value as ASTNode
      : ast;
    return configAstHasTopLevelAwait(root);
  } catch {
    // If the pinned parser cannot classify an await-bearing config, avoid the
    // destructive require-then-import probe. The fallback will evaluate it at
    // most once and preserve the original syntax error if it is invalid.
    return true;
  }
}

/** @internal Test-only Bun async-module preflight seam. */
export function __bunConfigHasTopLevelAwaitForTests(
  source: string,
  configPath = "veryfront.config.ts",
): Promise<boolean> {
  return bunConfigHasTopLevelAwait(source, configPath);
}

/**
 * Rewrite bare `veryfront` import specifiers to the inline config shim so
 * temp-file config modules can load. Static imports only (`import ... from
 * "veryfront"` and side-effect `import "veryfront"`); subpaths like
 * `veryfront/head` are left untouched and will fail loudly, which is correct —
 * they have no meaning in a config file.
 *
 * @internal exported for tests
 */
export async function rewriteBareVeryfrontConfigImports(source: string): Promise<string> {
  const lexer = await getConfigModuleLexer();
  await lexer.init?.();

  const imports = lexer.parse(source);
  let rewritten = source;
  for (let index = imports.length - 1; index >= 0; index--) {
    const specifier = imports[index];
    if (!specifier || specifier.d !== -1 || specifier.n !== "veryfront") continue;
    rewritten = rewritten.slice(0, specifier.s) +
      VERYFRONT_CONFIG_SHIM_URL +
      rewritten.slice(specifier.e);
  }
  return rewritten;
}

type ProjectConfigImportResolver = (specifier: string) => string | Promise<string>;
type UnresolvedDynamicProjectConfigImportResolver = (
  specifier: string,
  error: unknown,
) => string;
type ResolvedProjectConfigImportObserver = (specifier: string) => void | Promise<void>;

const PROJECT_ESM_EXPORT_CONDITIONS: ReadonlySet<string> = new IntrinsicSet([
  "deno",
  "node",
  "import",
  "module-sync",
]);

type ProjectPackageManifest = Readonly<{
  directory: string;
  value: Record<PropertyKey, unknown>;
}>;

class InvalidProjectPackageTargetError extends TypeError {}

async function readProjectPackageManifest(
  directory: string,
): Promise<ProjectPackageManifest | undefined> {
  try {
    const parsed = ReflectApply(JSONParse, JSON, [
      await createFileSystem().readTextFile(join(directory, "package.json")),
    ]) as unknown;
    if (!isRecord(parsed)) {
      throw new TypeError("Package manifest must contain a JSON object");
    }
    return { directory, value: parsed };
  } catch (error) {
    if (isNotFoundError(error)) return undefined;
    throw error;
  }
}

async function findNearestProjectPackageManifest(
  configPath: string,
): Promise<ProjectPackageManifest | undefined> {
  let directory = dirname(configPath);
  while (true) {
    const manifest = await readProjectPackageManifest(directory);
    if (manifest) return manifest;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function ownDataValue(
  value: Record<PropertyKey, unknown>,
  key: PropertyKey,
): { present: boolean; value?: unknown } {
  const descriptor = getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) return { present: false };
  return { present: true, value: descriptor.value };
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !ArrayIsArray(value);
}

/** Matches Node's array-index check for conditional export and import keys. */
function isArrayIndexPropertyKey(key: string): boolean {
  const numeric = +key;
  return `${numeric}` === key && numeric >= 0 && numeric < 4_294_967_295;
}

/** Select a local package target using Deno's active ESM export conditions. */
function selectConditionalProjectExport( // NOSONAR: package export resolver mirrors Node branching and is test-locked.
  value: unknown,
  wildcard: string | undefined,
  allowExternal = false,
): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") {
    return wildcard === undefined
      ? value
      : ReflectApply(StringPrototypeReplaceAll, value, ["*", wildcard]) as string;
  }
  if (ArrayIsArray(value)) {
    for (let index = 0; index < value.length; index++) { // NOSONAR: config-owned arrays may have poisoned iterators.
      let selected: string | null | undefined;
      try {
        selected = selectConditionalProjectExport(value[index], wildcard, allowExternal);
      } catch (error) {
        if (error instanceof InvalidProjectPackageTargetError) continue;
        throw error;
      }
      if (typeof selected !== "string") continue;
      if (stringStartsWith(selected, "./")) {
        try {
          assertSafeProjectPackageTarget(selected, "array target");
          return selected;
        } catch (error) {
          if (error instanceof InvalidProjectPackageTargetError) continue;
          throw error;
        }
      }
      if (allowExternal && isExternalProjectPackageImportTarget(selected)) return selected;
    }
    return undefined;
  }
  if (!isRecord(value)) {
    throw new InvalidProjectPackageTargetError("Package export target is invalid");
  }

  const keys = ownKeys(value);
  // Node and Bun reject conditional maps whose keys are array indices before
  // matching any condition, so surface the invalid package configuration
  // instead of silently skipping the numeric key and selecting another branch.
  for (let index = 0; index < keys.length; index++) { // NOSONAR: ownKeys traversal must not invoke iterator hooks from package data.
    const key = keys[index];
    if (typeof key === "string" && isArrayIndexPropertyKey(key)) {
      throw new TypeError(
        "Package export conditions cannot contain numeric property keys",
      );
    }
  }
  for (let index = 0; index < keys.length; index++) { // NOSONAR: ownKeys traversal must not invoke iterator hooks from package data.
    const key = keys[index];
    if (typeof key !== "string") continue;
    if (
      key !== "default" &&
      ReflectApply(SetPrototypeHas, PROJECT_ESM_EXPORT_CONDITIONS, [key]) !== true
    ) continue;
    const candidate = ownDataValue(value, key);
    if (!candidate.present) continue;
    const selected = selectConditionalProjectExport(candidate.value, wildcard, allowExternal);
    if (selected !== undefined) return selected;
  }
  return undefined;
}

/** Match a root, exact subpath, or wildcard package export without evaluating it. */
function selectProjectPackageExport( // NOSONAR: native package-pattern selection is intentionally branch-explicit and covered.
  exportsValue: unknown,
  subpath: string,
): string | null | undefined {
  if (!isRecord(exportsValue)) {
    return subpath === "." ? selectConditionalProjectExport(exportsValue, undefined) : undefined;
  }

  const keys = ownKeys(exportsValue);
  let hasSubpathMap = false;
  let hasConditionKey = false;
  for (let index = 0; index < keys.length; index++) { // NOSONAR: ownKeys traversal must not invoke iterator hooks from package data.
    const key = keys[index];
    if (typeof key !== "string") continue;
    if (stringStartsWith(key, ".")) hasSubpathMap = true;
    else hasConditionKey = true;
  }
  if (!hasSubpathMap) {
    return subpath === "." ? selectConditionalProjectExport(exportsValue, undefined) : undefined;
  }
  if (hasConditionKey) {
    throw new TypeError("Package exports cannot mix conditions and subpaths");
  }

  const exact = ownDataValue(exportsValue, subpath);
  if (exact.present) return selectConditionalProjectExport(exact.value, undefined);

  let bestKey: string | undefined;
  let bestWildcard: string | undefined;
  let bestPrefixLength = -1;
  for (let index = 0; index < keys.length; index++) { // NOSONAR: native wildcard precedence uses reverse-free indexed scanning.
    const key = keys[index];
    if (typeof key !== "string") continue;
    const star = stringIndexOf(key, "*");
    if (star < 0 || stringIndexOf(key, "*", star + 1) >= 0) continue;
    const prefix = stringSlice(key, 0, star);
    const suffix = stringSlice(key, star + 1);
    if (!stringStartsWith(subpath, prefix) || !stringEndsWith(subpath, suffix)) continue;
    // Native pattern matching requires a nonempty capture: "./feature*" must
    // not match "./feature" itself.
    if (subpath.length <= prefix.length + suffix.length) continue;
    if (
      prefix.length > bestPrefixLength ||
      (prefix.length === bestPrefixLength && key.length > (bestKey?.length ?? -1))
    ) {
      bestKey = key;
      bestPrefixLength = prefix.length;
      bestWildcard = stringSlice(subpath, prefix.length, subpath.length - suffix.length);
    }
  }
  if (bestKey === undefined || bestWildcard === undefined) return undefined;
  assertSafeProjectPackageWildcard(bestWildcard, subpath);
  const pattern = ownDataValue(exportsValue, bestKey);
  return pattern.present ? selectConditionalProjectExport(pattern.value, bestWildcard) : undefined;
}

function selectProjectPackageImport( // NOSONAR: native package-import pattern selection is intentionally branch-explicit and covered.
  importsValue: unknown,
  specifier: string,
): string | null | undefined {
  if (!isRecord(importsValue)) return undefined;
  const exact = ownDataValue(importsValue, specifier);
  if (exact.present) return selectConditionalProjectExport(exact.value, undefined, true);

  const keys = ownKeys(importsValue);
  let bestKey: string | undefined;
  let bestWildcard: string | undefined;
  let bestPrefixLength = -1;
  for (let index = 0; index < keys.length; index++) { // NOSONAR: native wildcard precedence uses reverse-free indexed scanning.
    const key = keys[index];
    if (typeof key !== "string" || !stringStartsWith(key, "#")) continue;
    const star = stringIndexOf(key, "*");
    if (star < 0 || stringIndexOf(key, "*", star + 1) >= 0) continue;
    const prefix = stringSlice(key, 0, star);
    const suffix = stringSlice(key, star + 1);
    if (!stringStartsWith(specifier, prefix) || !stringEndsWith(specifier, suffix)) continue;
    // Native pattern matching requires a nonempty capture: "#feature*" must
    // not match "#feature" itself.
    if (specifier.length <= prefix.length + suffix.length) continue;
    if (
      prefix.length > bestPrefixLength ||
      (prefix.length === bestPrefixLength && key.length > (bestKey?.length ?? -1))
    ) {
      bestKey = key;
      bestPrefixLength = prefix.length;
      bestWildcard = stringSlice(specifier, prefix.length, specifier.length - suffix.length);
    }
  }
  if (bestKey === undefined || bestWildcard === undefined) return undefined;
  assertSafeProjectPackageWildcard(bestWildcard, specifier);
  const pattern = ownDataValue(importsValue, bestKey);
  return pattern.present
    ? selectConditionalProjectExport(pattern.value, bestWildcard, true)
    : undefined;
}

function isExternalProjectPackageImportTarget(target: string): boolean {
  if (stringStartsWith(target, "node:")) return true;
  if (stringStartsWith(target, "#")) return false;
  // Native package-imports resolution rejects a dot-relative target such as
  // "../outside.js" as an invalid target; parseBarePackageSpecifier would
  // otherwise classify it as package "..", and the fallback resolver would
  // load a file outside the package as if it were an external dependency.
  if (stringStartsWith(target, ".")) return false;
  const parsed = parseBarePackageSpecifier(target);
  return parsed?.version === null &&
    isValidProjectPackageSpecifier(parsed);
}

const ENCODED_PACKAGE_PATH_SEPARATOR = /%2f|%5c/i;

/**
 * Match Node's package-name and subpath validation: a dot-prefixed name, a
 * name containing "%" or "\\", and a subpath with an encoded separator are
 * rejected before any manifest lookup, so staging never loads a
 * `node_modules` entry the original project resolver would have refused.
 */
function isValidProjectPackageSpecifier(
  parsed: Readonly<{ packageName: string; subpath: string | null }>,
): boolean {
  if (
    stringStartsWith(parsed.packageName, ".") ||
    stringIncludes(parsed.packageName, "%") ||
    stringIncludes(parsed.packageName, "\\") ||
    stringIncludes(parsed.packageName, "?") ||
    stringIncludes(parsed.packageName, "#")
  ) {
    return false;
  }
  return parsed.subpath === null ||
    ReflectApply(RegExpPrototypeExec, ENCODED_PACKAGE_PATH_SEPARATOR, [parsed.subpath]) === null;
}

/**
 * Match native pattern-match validation: a wildcard capture whose decoded
 * segments are dot, dot-dot, or `node_modules` makes the specifier
 * invalid, so staging must refuse it instead of resolving a target native
 * package resolution would never load. A capture may span `/` -- each
 * segment is validated on its own.
 */
function assertSafeProjectPackageWildcard(capture: string, specifier: string): void {
  const portableCapture = ReflectApply(StringPrototypeReplaceAll, capture, [
    "\\",
    "/",
  ]) as string;
  const segments = ReflectApply(StringPrototypeSplit, portableCapture, ["/"]) as string[];
  for (let index = 0; index < segments.length; index++) { // NOSONAR: decoded path validation must avoid project-controlled iterators.
    const segment = segments[index];
    if (segment === undefined || segment === "") continue;
    let decoded: string;
    try {
      decoded = ReflectApply(DecodeURIComponent, undefined, [segment]) as string;
    } catch {
      throw new TypeError(`Package import "${specifier}" contains an invalid path segment`);
    }
    const normalized = ReflectApply(StringPrototypeToLowerCase, decoded, []) as string;
    if (
      normalized === "." || normalized === ".." || normalized === "node_modules" ||
      stringIncludes(decoded, "/") || stringIncludes(decoded, "\\")
    ) {
      throw new TypeError(`Package import "${specifier}" contains a forbidden path segment`);
    }
  }
}

function assertSafeProjectPackageTarget(target: string, specifier: string): void {
  const suffixStart = (() => {
    const query = stringIndexOf(target, "?");
    const fragment = stringIndexOf(target, "#");
    if (query < 0) return fragment;
    if (fragment < 0) return query;
    return Math.min(query, fragment);
  })();
  const path = suffixStart < 0 ? target : stringSlice(target, 0, suffixStart);
  const portablePath = ReflectApply(StringPrototypeReplaceAll, stringSlice(path, 2), [
    "\\",
    "/",
  ]) as string;
  const segments = ReflectApply(StringPrototypeSplit, portablePath, ["/"]) as string[];
  for (let index = 0; index < segments.length; index++) { // NOSONAR: decoded path validation must avoid project-controlled iterators.
    const segment = segments[index];
    if (segment === undefined) continue;
    let decoded: string;
    try {
      decoded = ReflectApply(DecodeURIComponent, undefined, [segment]) as string;
    } catch {
      throw new InvalidProjectPackageTargetError(
        `Package import "${specifier}" contains an invalid path segment`,
      );
    }
    const normalized = ReflectApply(StringPrototypeToLowerCase, decoded, []) as string;
    if (
      normalized === "." || normalized === ".." || normalized === "node_modules" ||
      stringIncludes(decoded, "/") || stringIncludes(decoded, "\\")
    ) {
      throw new InvalidProjectPackageTargetError(
        `Package import "${specifier}" contains a forbidden path segment`,
      );
    }
  }
}

function isAsciiLetter(value: string | undefined): boolean {
  return value !== undefined &&
    ((value >= "A" && value <= "Z") || (value >= "a" && value <= "z"));
}

/** Convert a captured native file URL without consulting mutable URL accessors. */
function pathFromCapturedFileUrl(url: URL): string {
  const protocol = ReflectApply(intrinsicUrlProtocolGetter, url, []) as string;
  if (protocol !== "file:") throw new TypeError("Must be a file URL");

  const windows = runtimeUsesWindowsPaths();
  const hostname = ReflectApply(intrinsicUrlHostnameGetter, url, []) as string;
  if (hostname && hostname !== "localhost" && !windows) {
    throw new TypeError("File URL host must be empty or localhost on non-Windows runtimes");
  }

  const encodedPath = ReflectApply(intrinsicUrlPathnameGetter, url, []) as string;
  if (
    ReflectApply(RegExpPrototypeExec, /%2f/i, [encodedPath]) !== null ||
    (windows && ReflectApply(RegExpPrototypeExec, /%5c/i, [encodedPath]) !== null)
  ) {
    throw new TypeError("File URL path must not include encoded path separators");
  }
  let path = ReflectApply(DecodeURIComponent, undefined, [encodedPath]) as string;
  if (hostname && hostname !== "localhost") {
    return `\\\\${hostname}${ReflectApply(StringPrototypeReplaceAll, path, ["/", "\\"]) as string}`;
  }
  if (!windows) return path;
  if (stringStartsWith(path, "/") && isAsciiLetter(path[1]) && path[2] === ":") {
    path = stringSlice(path, 1);
  }
  return ReflectApply(StringPrototypeReplaceAll, path, ["/", "\\"]) as string;
}

function resolveProjectPackageTarget(
  manifest: ProjectPackageManifest,
  specifier: string,
  target: string | null | undefined,
): string {
  if (typeof target !== "string" || !stringStartsWith(target, "./")) {
    throw new TypeError(`Package import "${specifier}" is not exported`);
  }
  assertSafeProjectPackageTarget(target, specifier);
  const resolvedUrl = new IntrinsicURL(
    target,
    toFileUrl(join(manifest.directory, "package.json")),
  );
  const resolved = pathFromCapturedFileUrl(resolvedUrl);
  const relativeTarget = relative(manifest.directory, resolved);
  if (
    relativeTarget === ".." || stringStartsWith(relativeTarget, "../") ||
    stringStartsWith(relativeTarget, "..\\") || isAbsolute(relativeTarget)
  ) {
    throw new TypeError(`Package import "${specifier}" resolves outside its package`);
  }
  return ReflectApply(intrinsicUrlHrefGetter, resolvedUrl, []) as string;
}

async function projectPackageDirectoryExists(packageDirectory: string): Promise<boolean> {
  try {
    return (await createFileSystem().stat(packageDirectory)).isDirectory;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

type ProjectPackageLookup = Readonly<
  | { kind: "manifest"; manifest: ProjectPackageManifest }
  | { kind: "legacy"; directory: string }
>;

/** Find the nearest installed copy of a package from the original config location. */
async function findProjectPackage(
  packageName: string,
  configPath: string,
): Promise<ProjectPackageLookup | undefined> {
  const scope = await findNearestProjectPackageManifest(configPath);
  const scopeName = scope && ownDataValue(scope.value, "name");
  if (scope && scopeName?.present && scopeName.value === packageName) {
    return { kind: "manifest", manifest: scope };
  }
  let directory = dirname(configPath);
  while (true) {
    const packageDirectory = join(directory, "node_modules", packageName);
    const manifest = await readProjectPackageManifest(packageDirectory);
    if (manifest) return { kind: "manifest", manifest };
    // The nearest installed directory wins even without a usable manifest:
    // project resolution stops there and uses its legacy entry point, so an
    // ancestor's exports map must not shadow it. Return the exact directory so
    // legacy resolution cannot skip an unusable nearest install and continue
    // searching ancestors.
    if (await projectPackageDirectoryExists(packageDirectory)) {
      return { kind: "legacy", directory: packageDirectory };
    }

    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/** Resolve a package export with ESM conditions, leaving non-package imports to the runtime. */
async function resolveProjectPackageImport( // NOSONAR: staged package resolution mirrors Node/Bun branches and is test-locked.
  specifier: string,
  configPath: string,
): Promise<ProjectPackageImportResolution | undefined> {
  if (stringStartsWith(specifier, "./") || stringStartsWith(specifier, "../")) {
    return undefined;
  }
  if (stringStartsWith(specifier, "#")) {
    if (specifier === "#" || stringStartsWith(specifier, "#/")) {
      throw new TypeError(`Package import "${specifier}" is not a valid internal import name`);
    }
    const manifest = await findNearestProjectPackageManifest(configPath);
    if (!manifest) return undefined;
    const importsProperty = ownDataValue(manifest.value, "imports");
    if (!importsProperty.present) return undefined;
    const target = selectProjectPackageImport(importsProperty.value, specifier);
    if (typeof target !== "string") {
      throw new TypeError(`Package import "${specifier}" is not exported`);
    }
    if (!stringStartsWith(target, "./")) {
      if (!isExternalProjectPackageImportTarget(target)) {
        throw new TypeError(`Package import "${specifier}" is not exported`);
      }
      // Native package-imports resolution resolves an external target from
      // the package scope that declares the `imports` map, not from the
      // importing file, so a nested node_modules copy under the config
      // directory must not shadow the declaring scope's installation.
      return { kind: "external", specifier: target, scopeDirectory: manifest.directory };
    }
    return {
      kind: "resolved",
      specifier: resolveProjectPackageTarget(manifest, specifier, target),
    };
  }
  if (
    ReflectApply(RegExpPrototypeExec, /^[a-zA-Z][a-zA-Z0-9+.-]*:/, [specifier]) !== null
  ) {
    throw new TypeError(`Config import "${specifier}" uses an unsupported URL scheme`);
  }
  const parsed = parseBarePackageSpecifier(specifier);
  if (parsed?.version !== null) {
    return undefined;
  }
  if (
    ReflectApply(SetPrototypeHas, NODE_BUILTIN_PACKAGE_NAMES, [parsed.packageName]) as boolean
  ) {
    return undefined;
  }
  // Reject before lookup rather than deferring to the fallback resolver:
  // CommonJS resolution would load the literal `node_modules/p%2Fq` directory
  // that native ESM package resolution refuses to consider.
  if (!isValidProjectPackageSpecifier(parsed)) {
    throw new TypeError(`Package import "${specifier}" is not a valid package specifier`);
  }
  const packageLookup = await findProjectPackage(parsed.packageName, configPath);
  if (!packageLookup) return undefined;
  if (packageLookup.kind === "legacy") {
    return {
      kind: "legacy",
      directory: packageLookup.directory,
      subpath: parsed.subpath,
    };
  }
  const manifest = packageLookup.manifest;

  const exportsProperty = ownDataValue(manifest.value, "exports");
  if (!exportsProperty.present) return undefined;
  const subpath = parsed.subpath === null ? "." : `.${parsed.subpath}`;
  const target = selectProjectPackageExport(exportsProperty.value, subpath);
  return {
    kind: "resolved",
    specifier: resolveProjectPackageTarget(manifest, specifier, target),
  };
}

type ProjectPackageImportResolution = Readonly<
  | { kind: "resolved"; specifier: string }
  | { kind: "external"; specifier: string; scopeDirectory: string }
  | { kind: "legacy"; directory: string; subpath: string | null }
>;

function asResolvedConfigSpecifier(resolved: string): string {
  return isAbsolute(resolved)
    ? ReflectApply(intrinsicUrlHrefGetter, toFileUrl(resolved), []) as string
    : resolved;
}

async function createProjectConfigImportResolver(
  configPath: string,
): Promise<ProjectConfigImportResolver> {
  if (isBun && CapturedBunResolveSync && CapturedBun) {
    const from = dirname(configPath);
    return (specifier) => {
      const resolved = ReflectApply(CapturedBunResolveSync, CapturedBun, [specifier, from]);
      if (typeof resolved !== "string") throw new TypeError("Config import resolution failed");
      return asResolvedConfigSpecifier(resolved);
    };
  }

  const { createRequire } = await import("node:module");
  const projectRequire = createRequire(configPath);
  const resolveFromProject = async (
    specifier: string,
    seenAliases: Set<string>,
    basePath: string,
    baseRequire: NodeJS.Require,
  ): Promise<string> => {
    if (
      (stringStartsWith(specifier, "./") || stringStartsWith(specifier, "../")) &&
      (stringIncludes(specifier, "?") || stringIncludes(specifier, "#"))
    ) {
      const baseUrl = toFileUrl(basePath);
      const resolvedUrl = new IntrinsicURL(
        specifier,
        ReflectApply(intrinsicUrlHrefGetter, baseUrl, []) as string,
      );
      return ReflectApply(intrinsicUrlHrefGetter, resolvedUrl, []) as string;
    }
    const esmResolution = await resolveProjectPackageImport(specifier, basePath);
    if (esmResolution?.kind === "resolved") return esmResolution.specifier;
    if (esmResolution?.kind === "legacy") {
      const legacyTarget = esmResolution.subpath === null
        ? esmResolution.directory
        : join(esmResolution.directory, stringSlice(esmResolution.subpath, 1));
      const resolved = ReflectApply(baseRequire.resolve, baseRequire, [legacyTarget]);
      if (typeof resolved !== "string") throw new TypeError("Config import resolution failed");
      return asResolvedConfigSpecifier(resolved);
    }
    if (esmResolution?.kind === "external") {
      if (ReflectApply(SetPrototypeHas, seenAliases, [specifier]) as boolean) {
        throw new TypeError(`Circular package import alias "${specifier}"`);
      }
      ReflectApply(SetPrototypeAdd, seenAliases, [specifier]);
      // Resolve the external target from the scope that declared it, the way
      // native package-imports resolution does, so the declaring package's
      // own dependencies win over copies nested nearer the config file.
      const scopePath = join(esmResolution.scopeDirectory, "package.json");
      const scopeRequire = scopePath === basePath ? baseRequire : createRequire(scopePath);
      return await resolveFromProject(
        esmResolution.specifier,
        seenAliases,
        scopePath,
        scopeRequire,
      );
    }
    const resolved = ReflectApply(baseRequire.resolve, baseRequire, [specifier]);
    if (typeof resolved !== "string") throw new TypeError("Config import resolution failed");
    return asResolvedConfigSpecifier(resolved);
  };
  return (specifier) =>
    resolveFromProject(specifier, new IntrinsicSet<string>(), configPath, projectRequire);
}

function keepsConfigImportSpecifier(specifier: string): boolean {
  return ReflectApply(StringPrototypeStartsWith, specifier, ["data:"]) as boolean ||
    ReflectApply(StringPrototypeStartsWith, specifier, ["file:"]) as boolean ||
    ReflectApply(StringPrototypeStartsWith, specifier, ["http:"]) as boolean ||
    ReflectApply(StringPrototypeStartsWith, specifier, ["https:"]) as boolean ||
    ReflectApply(StringPrototypeStartsWith, specifier, ["jsr:"]) as boolean ||
    ReflectApply(StringPrototypeStartsWith, specifier, ["node:"]) as boolean ||
    ReflectApply(StringPrototypeStartsWith, specifier, ["npm:"]) as boolean;
}

/** @internal Rewrite staged imports with a resolver bound to their original project. */
export async function rewriteProjectConfigImports( // NOSONAR: source rewrite control flow is lexer-driven and regression-covered.
  source: string,
  resolveSpecifier: ProjectConfigImportResolver,
  resolveUnresolvedDynamicSpecifier?: UnresolvedDynamicProjectConfigImportResolver,
  observeResolvedSpecifier?: ResolvedProjectConfigImportObserver,
): Promise<string> {
  const lexer = await getConfigModuleLexer();
  await lexer.init?.();

  const imports = lexer.parse(source);
  let rewritten = source;
  for (let index = imports.length - 1; index >= 0; index--) { // NOSONAR: reverse indexed rewrite preserves source offsets without iterator hooks.
    const imported = imports[index];
    const specifier = imported?.n;
    if (!imported || specifier === undefined || specifier === null) continue;
    let replacement: string;
    if (specifier === "veryfront") replacement = VERYFRONT_CONFIG_SHIM_URL;
    else if (keepsConfigImportSpecifier(specifier)) replacement = specifier;
    else {
      try {
        replacement = await resolveSpecifier(specifier);
      } catch (error) {
        if (imported.d >= 0 && resolveUnresolvedDynamicSpecifier !== undefined) {
          replacement = resolveUnresolvedDynamicSpecifier(specifier, error);
        } else if (imported.d >= 0) {
          continue;
        } else {
          throw error;
        }
      }
    }
    await observeResolvedSpecifier?.(replacement);
    if (replacement === specifier) continue;
    const before = ReflectApply(StringPrototypeSlice, rewritten, [0, imported.s]) as string;
    const after = ReflectApply(StringPrototypeSlice, rewritten, [imported.e]) as string;
    const serializedReplacement = imported.d >= 0
      ? ReflectApply(JSONStringify, JSON, [replacement]) as string
      : replacement;
    rewritten = before + serializedReplacement + after;
  }
  return rewritten;
}

/** A resolution failure an install could fix, as opposed to a present package rejecting the import. */
function isMissingProjectModuleResolutionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as RuntimeReflectionRecord;
  const code = readOwnDataString(record, "code");
  if (
    code === "MODULE_NOT_FOUND" || code === BUN_RESOLVE_MESSAGE_MODULE_NOT_FOUND_CODE
  ) {
    return true;
  }
  const message = readOwnDataString(record, "message");
  return message !== undefined &&
    (stringStartsWith(message, "Cannot find module") ||
      stringStartsWith(message, "Cannot find package"));
}

function unresolvedProjectConfigImportModuleUrl(
  specifier: string,
  error: unknown,
): string {
  let message: string;
  if (error === undefined || isMissingProjectModuleResolutionError(error)) {
    const dependency = missingPackageName(specifier);
    message = dependency === undefined
      ? "Unable to resolve dynamic project config import"
      : `Cannot find package "${dependency}" imported from file:///project/veryfront.config.ts`;
  } else {
    // A resolution failure that is not "module not found" -- an installed
    // package whose exports reject the active ESM conditions, an invalid
    // alias target -- must keep its precise reason. Fabricating a missing
    // dependency here would tell the reader to install a package that is
    // already present.
    const caught = typeof error === "string"
      ? error
      : readOwnDataString(error as RuntimeReflectionRecord, "message");
    message = caught === undefined || caught.length === 0
      ? "Unable to resolve dynamic project config import"
      : caught;
  }
  const moduleSource = `throw new Error(${ReflectApply(JSONStringify, JSON, [message])});\n`;
  return `data:text/javascript,${ReflectApply(EncodeURIComponent, undefined, [
    moduleSource,
  ]) as string}`;
}

/** @internal Resolve staged config imports from the original project module root. */
export async function rewriteProjectConfigImportsFromProject(
  source: string,
  configPath: string,
  observeResolvedSpecifier?: ResolvedProjectConfigImportObserver,
): Promise<string> {
  return await rewriteProjectConfigImports(
    source,
    await createProjectConfigImportResolver(configPath),
    unresolvedProjectConfigImportModuleUrl,
    observeResolvedSpecifier,
  );
}

async function rewriteDynamicProjectConfigImports(
  source: string,
  observerKey: string,
): Promise<string> {
  const lexer = await getConfigModuleLexer();
  await lexer.init?.();

  const imports = lexer.parse(source);
  const argumentOpeningCounts = new IntrinsicMap<number, number>();
  const argumentClosingCounts = new IntrinsicMap<number, number>();
  const importOpeningCounts = new IntrinsicMap<number, number>();
  const importClosingCounts = new IntrinsicMap<number, number>();
  let hasDynamicImport = false;
  for (let index = 0; index < imports.length; index++) { // NOSONAR: lexer result traversal must not invoke project-controlled iterators.
    const imported = imports[index];
    if (!imported || imported.d < 0) continue;
    hasDynamicImport = true;
    mapSet(
      argumentOpeningCounts,
      imported.s,
      (mapGet(argumentOpeningCounts, imported.s) ?? 0) + 1,
    );
    mapSet(
      argumentClosingCounts,
      imported.e,
      (mapGet(argumentClosingCounts, imported.e) ?? 0) + 1,
    );
    mapSet(
      importOpeningCounts,
      imported.ss,
      (mapGet(importOpeningCounts, imported.ss) ?? 0) + 1,
    );
    mapSet(
      importClosingCounts,
      imported.se,
      (mapGet(importClosingCounts, imported.se) ?? 0) + 1,
    );
  }
  if (!hasDynamicImport) return source;

  // Insert wrappers against offsets in the original source. Dynamic imports
  // can nest, so rewriting one expression first would invalidate the lexer's
  // range for its containing import even when records are visited in reverse.
  let rewritten = "";
  let sourceOffset = 0;
  for (let position = 0; position <= source.length; position++) {
    const argumentOpeningCount = mapGet(argumentOpeningCounts, position) ?? 0;
    const argumentClosingCount = mapGet(argumentClosingCounts, position) ?? 0;
    const importOpeningCount = mapGet(importOpeningCounts, position) ?? 0;
    const importClosingCount = mapGet(importClosingCounts, position) ?? 0;
    if (
      argumentOpeningCount === 0 && argumentClosingCount === 0 &&
      importOpeningCount === 0 && importClosingCount === 0
    ) continue;
    rewritten += stringSlice(source, sourceOffset, position);
    for (let index = 0; index < importClosingCount; index++) rewritten += ")";
    for (let index = 0; index < argumentClosingCount; index++) rewritten += ")";
    for (let index = 0; index < importOpeningCount; index++) {
      rewritten += `${observerKey}.settle(`;
    }
    for (let index = 0; index < argumentOpeningCount; index++) {
      rewritten += `${observerKey}.resolve(`;
    }
    sourceOffset = position;
  }
  rewritten += stringSlice(source, sourceOffset);

  // The generated import binding is chosen absent from the authored source,
  // and its data module reads the real host global in its own lexical scope.
  // Authored declarations named `globalThis`, `Function`, or `eval` therefore
  // cannot shadow the observer reference used by the rewritten config.
  const serializedObserverKey = ReflectApply(JSONStringify, JSON, [observerKey]) as string;
  const bridgeSource = `export default globalThis[${serializedObserverKey}];\n`;
  const bridgeUrl = `data:text/javascript,${ReflectApply(EncodeURIComponent, undefined, [
    bridgeSource,
  ]) as string}`;
  const bridgeImport = `import ${observerKey} from ${ReflectApply(JSONStringify, JSON, [
    bridgeUrl,
  ]) as string};\n`;
  if (!stringStartsWith(rewritten, "#!")) return bridgeImport + rewritten;
  const hashbangEnd = stringIndexOf(rewritten, "\n");
  if (hashbangEnd < 0) return `${rewritten}\n${bridgeImport}`;
  return stringSlice(rewritten, 0, hashbangEnd + 1) + bridgeImport +
    stringSlice(rewritten, hashbangEnd + 1);
}

/** @internal */
export async function transpileConfigSourceForImport(
  source: string,
  configPath: string,
): Promise<string> {
  const { transform } = await import("veryfront/extensions/bundler");
  const extension = extname(configPath);
  const loader = extension === ".tsx" ? "tsx" : "ts";
  const result = await transform(source, {
    format: "esm",
    loader,
    sourcemap: false,
  });
  return result.code;
}

/**
 * Load trusted executable config from a single-project virtual filesystem.
 *
 * Multi-tenant hosted callers never enter this path.
 */
function loadTrustedConfigFromVirtualFS(
  configPath: string,
  cacheKey: string,
  adapter: RuntimeAdapter,
  selectedContent?: string | Uint8Array,
): Promise<VeryfrontConfig> {
  return withSpan(
    SpanNames.CONFIG_LOAD_PROJECT,
    async () => {
      logger.debug("Loading config from virtual filesystem (API)", { configPath });
      const content = selectedContent ?? await adapter.fs.readFile(configPath);
      const source = decodeTrustedConfigSource(content);
      logger.debug("Got config source from API", {
        configPath,
        sourceLength: source.length,
      });

      const userConfig = await loadConfigFromTempFile(
        source,
        configPath,
        (tempFile) => {
          const url = toFileUrl(tempFile);
          url.searchParams.set("v", String(Date.now()));
          return url.href;
        },
      );

      logger.debug("Loaded config from virtual filesystem", {
        configPath,
        hasApp: !!(userConfig as Record<string, unknown>)?.app,
        hasLayout: !!(userConfig as Record<string, unknown>)?.layout,
        hasRouter: !!(userConfig as Record<string, unknown>)?.router,
        configKeys: userConfig !== null &&
            (typeof userConfig === "object" || typeof userConfig === "function")
          ? ownKeys(userConfig)
          : [],
      });

      return validateAndMergeConfig(userConfig);
    },
    { "config.path": configPath, "config.project_dir": cacheKey, "config.source": "virtual_fs" },
  );
}

function loadHostedConfigFromSource(
  configPath: string,
  configFile: DeclarativeConfigFileName,
  baseCacheKey: string,
  content: string | Uint8Array,
  preparedContext: PreparedDeclarativeConfigContext,
  signal: AbortSignal | undefined,
  usePersistentCache: boolean,
  revisionAtStart: number,
  validationBoundary?: (validate: () => VeryfrontConfig) => VeryfrontConfig,
): Promise<VeryfrontConfig> {
  return withSpan(
    SpanNames.CONFIG_LOAD_PROJECT,
    async () => {
      throwIfHostedConfigAborted(signal);
      logger.debug("Loading hosted config through declarative worker", { configPath });
      const source = decodeConfigSource(content);
      const payload = createPreparedDeclarativeConfigWorkerPayload(
        source,
        preparedContext,
        configFile,
      );
      const hostedCacheKey = await buildHostedConfigCacheKey(
        baseCacheKey,
        configPath,
        source,
        payload,
      );
      throwIfHostedConfigAborted(signal);

      const cached = usePersistentCache ? configCacheByProject.get(hostedCacheKey) : undefined;
      if (cached?.revision === revisionAtStart) {
        return cached.config;
      }

      const cachedFailure = usePersistentCache
        ? hostedConfigFailureCacheByProject.get(hostedCacheKey)
        : undefined;
      if (cachedFailure?.revision === revisionAtStart) {
        throw cachedFailure.error;
      }

      const flight = getOrCreateHostedConfigFlight(
        hostedCacheKey,
        payload,
        usePersistentCache,
        revisionAtStart,
        validationBoundary,
      );
      return await waitForHostedConfigFlight(flight, signal);
    },
    {
      "config.path": configPath,
      "config.project_dir": baseCacheKey,
      "config.source": "hosted_declarative",
    },
  );
}

function isBunAsyncModuleRequireError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const message = ObjectGetOwnPropertyDescriptor(error, "message");
  if (!message || !("value" in message) || typeof message.value !== "string") {
    return false;
  }
  return ReflectApply(
    StringPrototypeStartsWith,
    message.value,
    ['require() async module "'],
  ) as boolean &&
    ReflectApply(
      StringPrototypeEndsWith,
      message.value,
      ['" is unsupported. use "await import()" instead.'],
    ) as boolean;
}

interface BunAsyncConfigImportResult {
  readonly configModule: object;
  readonly observer: BunProjectDynamicImportObserver;
}

async function importFreshBunAsyncConfig(
  absolutePath: string,
  canonicalConfigPath: string,
  source: string,
  scope: BunProjectTrackingScope,
  recordDependencies: (dependencyKeys: ReadonlySet<string>) => void,
  discardDependencies: (dependencyKeys: ReadonlySet<string>) => void,
): Promise<BunAsyncConfigImportResult> {
  const fs = createFileSystem();
  const dependencyKeys = new IntrinsicSet<string>();
  const observedRuntimeSpecifiers = new IntrinsicSet<string>();
  const runtimeSpecifiers: string[] = [];
  const lexer = await getConfigModuleLexer();
  let observerKey: string;
  do {
    bunProjectConfigDynamicImportObserverSequence += 1;
    observerKey =
      `__veryfrontBunConfigImportObserver${bunProjectConfigDynamicImportObserverSequence}`;
  } while (
    getOwnPropertyDescriptor(globalThis, observerKey) !== undefined ||
    stringIncludes(source, observerKey)
  );
  let observerActive = true;
  const disposeObserver = (): void => {
    if (!observerActive) return;
    observerActive = false;
    ReflectApply(ReflectDeleteProperty, Reflect, [globalThis, observerKey]);
  };
  const trackPendingCollection = (collection: Promise<void>): void => {
    const finalize = (): void => {
      if (observerActive) {
        recordDependencies(dependencyKeys);
      } else {
        discardDependencies(dependencyKeys);
      }
    };
    const settled = thenPromise(collection, finalize, finalize);
    const previous = mapGet(
      bunProjectConfigPendingDependencyCollections,
      canonicalConfigPath,
    );
    const combined = previous === undefined
      ? settled
      : thenPromise(previous, () => settled, () => settled);
    mapSet(bunProjectConfigPendingDependencyCollections, canonicalConfigPath, combined);
    const release = (): void => {
      if (
        mapGet(bunProjectConfigPendingDependencyCollections, canonicalConfigPath) === combined
      ) {
        mapDelete(bunProjectConfigPendingDependencyCollections, canonicalConfigPath);
      }
    };
    void thenPromise(combined, release, release);
  };
  const baseUrl = ReflectApply(intrinsicUrlHrefGetter, toFileUrl(absolutePath), []) as string;
  const rejectDuringDynamicImport = (error: unknown): Record<PropertyKey, unknown> => {
    const rejectedSpecifier = ObjectCreate(null) as Record<PropertyKey, unknown>;
    ObjectDefineProperty(rejectedSpecifier, SymbolToPrimitive, {
      value: () => {
        throw error;
      },
    });
    return rejectedSpecifier;
  };
  const resolveObservedSpecifier = (specifier: unknown): unknown => { // NOSONAR: dynamic-import observer must preserve native coercion edge cases.
    let stringSpecifier: string;
    if (typeof specifier === "string") {
      stringSpecifier = specifier;
    } else {
      // Dynamic import applies ToString with the string hint. Resolve that
      // coerced value from the authored config rather than allowing Bun to
      // coerce it later relative to the temporary staged module. A Symbol
      // remains native so import() preserves its rejected-Promise behavior.
      if (typeof specifier === "symbol") return specifier;
      try {
        stringSpecifier = ReflectApply(IntrinsicString, undefined, [specifier]) as string;
      } catch (error) {
        // The wrapper runs while evaluating import()'s argument, whereas
        // native ToString failures reject the returned Promise. Hand Bun a
        // one-shot coercion object so it produces the same asynchronous
        // rejection without invoking authored coercion hooks twice.
        return rejectDuringDynamicImport(error);
      }
    }
    let resolvedSpecifier = stringSpecifier;
    if (stringStartsWith(stringSpecifier, "./") || stringStartsWith(stringSpecifier, "../")) {
      const resolvedUrl = new IntrinsicURL(stringSpecifier, baseUrl);
      resolvedSpecifier = ReflectApply(intrinsicUrlHrefGetter, resolvedUrl, []) as string;
    } else if (!keepsConfigImportSpecifier(stringSpecifier) && !isAbsolute(stringSpecifier)) {
      try {
        if (!CapturedBunResolveSync || !CapturedBun) {
          throw new TypeError("Bun project config resolver is unavailable");
        }
        const resolved = ReflectApply(CapturedBunResolveSync, CapturedBun, [
          stringSpecifier,
          dirname(absolutePath),
        ]);
        if (typeof resolved !== "string") {
          throw new TypeError("Bun project config import resolution failed");
        }
        resolvedSpecifier = asResolvedConfigSpecifier(resolved);
      } catch (error) {
        // Native import() reports resolution failures by rejecting its Promise.
        // The observer executes while evaluating import()'s argument, so hand
        // Bun a coercion object that rejects at the native asynchronous boundary.
        return rejectDuringDynamicImport(error);
      }
    }
    if (
      ReflectApply(SetPrototypeHas, observedRuntimeSpecifiers, [resolvedSpecifier]) !== true
    ) {
      ReflectApply(SetPrototypeAdd, observedRuntimeSpecifiers, [resolvedSpecifier]);
      runtimeSpecifiers[runtimeSpecifiers.length] = resolvedSpecifier;
      if (initialEvaluationComplete && observerActive) {
        const collection = collectBunProjectConfigDependencyKeys(
          resolvedSpecifier,
          scope,
          dependencyKeys,
          lexer,
          fs,
        );
        // The collector records the directly resolved path before its first
        // await. Publish that key synchronously so an immediate cache clear
        // after setup still owns the module; refresh again after transitive
        // discovery completes.
        if (observerActive) {
          recordDependencies(dependencyKeys);
        }
        trackPendingCollection(collection);
      }
    }
    return resolvedSpecifier;
  };
  const refreshObservedDependencies = (): void => {
    if (observerActive) recordDependencies(dependencyKeys);
    else discardDependencies(dependencyKeys);
  };
  const settleObservedImport = <T>(operation: Promise<T>): Promise<T> =>
    thenPromise(
      operation,
      (value) => {
        refreshObservedDependencies();
        return value;
      },
      (error) => {
        refreshObservedDependencies();
        throw error;
      },
    );
  ObjectDefineProperty(globalThis, observerKey, {
    configurable: true,
    value: { resolve: resolveObservedSpecifier, settle: settleObservedImport },
  });
  let initialEvaluationComplete = false;
  let configModule: object | undefined;
  let loadFailure: { error: unknown } | undefined;
  try {
    configModule = await loadConfigFromTempFile(
      source,
      absolutePath,
      (tempFile) => ReflectApply(intrinsicUrlHrefGetter, toFileUrl(tempFile), []) as string,
      async (processedSource) => {
        const rewritten = await rewriteProjectConfigImportsFromProject(
          processedSource,
          absolutePath,
          (specifier) =>
            collectBunProjectConfigDependencyKeys(
              specifier,
              scope,
              dependencyKeys,
              lexer,
              fs,
            ),
        );
        const observed = await rewriteDynamicProjectConfigImports(rewritten, observerKey);
        return observed;
      },
    ) as object;
  } catch (error) {
    loadFailure = { error };
  }

  let trackingFailure: { error: unknown } | undefined;
  try {
    for (let index = 0; index < runtimeSpecifiers.length; index++) { // NOSONAR: runtime specifier queue stays index-based for poisoned iterators.
      const specifier = runtimeSpecifiers[index];
      if (specifier === undefined) continue;
      await collectBunProjectConfigDependencyKeys(
        specifier,
        scope,
        dependencyKeys,
        lexer,
        fs,
      );
    }
    recordDependencies(dependencyKeys);
    initialEvaluationComplete = true;
  } catch (error) {
    trackingFailure = { error };
  }

  if (loadFailure !== undefined || trackingFailure !== undefined) {
    disposeObserver();
    throw trackingFailure?.error ?? loadFailure!.error;
  }
  return {
    configModule: configModule!,
    observer: { key: observerKey, dispose: disposeObserver },
  };
}

/** @internal Test-only dynamic import observer rewrite seam. */
export function __rewriteComputedDynamicProjectConfigImportsForTests(
  source: string,
  observerKey: string,
): Promise<string> {
  return rewriteDynamicProjectConfigImports(source, observerKey);
}

function isPathWithinDirectory(directory: string, candidate: string): boolean {
  const relativeCandidate = relative(directory, candidate);
  return relativeCandidate === "" ||
    (relativeCandidate !== ".." && !stringStartsWith(relativeCandidate, "../") &&
      !stringStartsWith(relativeCandidate, "..\\") && !isAbsolute(relativeCandidate));
}

type BunProjectTrackingScope = Readonly<{
  lexicalDirectory: string;
  canonicalDirectory: string;
  projectDirectories: readonly string[];
}>;

function isPathWithinBunProjectScope(
  scope: BunProjectTrackingScope,
  candidate: string,
): boolean {
  return isPathWithinDirectory(scope.lexicalDirectory, candidate) ||
    isPathWithinDirectory(scope.canonicalDirectory, candidate);
}

function bunProjectModuleCacheAliases(
  scope: BunProjectTrackingScope,
  candidate: string,
): string[] {
  const aliases: string[] = [];
  for (let sourceIndex = 0; sourceIndex < scope.projectDirectories.length; sourceIndex++) { // NOSONAR: project-directory aliases must avoid mutable iterator hooks.
    const sourceDirectory = scope.projectDirectories[sourceIndex];
    if (
      sourceDirectory === undefined ||
      !isPathWithinDirectory(sourceDirectory, candidate)
    ) continue;
    const projectRelative = relative(sourceDirectory, candidate);
    for (let targetIndex = 0; targetIndex < scope.projectDirectories.length; targetIndex++) { // NOSONAR: project-directory aliases must avoid mutable iterator hooks.
      const targetDirectory = scope.projectDirectories[targetIndex];
      if (targetDirectory === undefined || targetDirectory === sourceDirectory) continue;
      aliases[aliases.length] = resolve(targetDirectory, projectRelative);
    }
    break;
  }
  return aliases;
}

function projectConfigFilePathFromSpecifier(specifier: string): string | undefined {
  if (isAbsolute(specifier)) return resolve(specifier);
  if (!stringStartsWith(specifier, "file:")) return undefined;
  try {
    return resolve(pathFromCapturedFileUrl(new IntrinsicURL(specifier)));
  } catch {
    return undefined;
  }
}

async function collectBunProjectConfigDependencyKeys( // NOSONAR: bounded dependency scanner mirrors runtime loading and is test-locked.
  resolvedSpecifier: string,
  scope: BunProjectTrackingScope,
  dependencyKeys: Set<string>,
  lexer: ModuleLexer,
  fs: ReturnType<typeof createFileSystem>,
): Promise<void> {
  const dependencyPath = projectConfigFilePathFromSpecifier(resolvedSpecifier);
  if (
    dependencyPath === undefined ||
    !isPathWithinBunProjectScope(scope, dependencyPath) ||
    ReflectApply(SetPrototypeHas, dependencyKeys, [dependencyPath]) === true
  ) {
    return;
  }
  ReflectApply(SetPrototypeAdd, dependencyKeys, [dependencyPath]);
  try {
    const canonicalDependencyPath = await realPath(dependencyPath);
    ReflectApply(SetPrototypeAdd, dependencyKeys, [canonicalDependencyPath]);
  } catch {
    // Runtime loading remains authoritative for virtual and missing modules.
  }

  let source: string;
  let imports: ReturnType<ModuleLexer["parse"]>;
  try {
    source = await fs.readTextFile(dependencyPath);
    imports = lexer.parse(source);
  } catch {
    return;
  }
  const resolveSpecifier = await createProjectConfigImportResolver(dependencyPath);
  for (let index = 0; index < imports.length; index++) { // NOSONAR: lexer result traversal must not invoke project-controlled iterators.
    const imported = imports[index];
    const specifier = imported?.n;
    if (imported?.d !== undefined && imported.d >= 0 && specifier == null) {
      throw new UnsupportedBunProjectConfigDependencyImportError(
        "Computed dynamic imports inside project config dependencies cannot be reloaded safely in Bun",
      );
    }
    if (specifier === undefined || specifier === null) continue;
    if (specifier === "veryfront") continue;

    let resolved: string;
    if (stringStartsWith(specifier, "file:")) {
      resolved = specifier;
    } else if (keepsConfigImportSpecifier(specifier)) {
      continue;
    } else {
      try {
        resolved = await resolveSpecifier(specifier);
      } catch {
        continue;
      }
    }

    try {
      await collectBunProjectConfigDependencyKeys(
        resolved,
        scope,
        dependencyKeys,
        lexer,
        fs,
      );
    } catch (error) {
      if (error instanceof UnsupportedBunProjectConfigDependencyImportError) throw error;
      // Runtime loading remains authoritative for non-text and missing modules.
    }
  }
}

class UnsupportedBunProjectConfigDependencyImportError extends TypeError {}

type BunProjectCacheSnapshot = Readonly<{
  before: ReadonlySet<string>;
  scope: BunProjectTrackingScope;
  canonicalConfigPath: string;
}>;

/**
 * Delete this config load's tracked modules, keeping only the ones an
 * observable consumer still references.
 *
 * Retention follows `Module.children` edges from every module outside the
 * tracked graph -- application modules loaded before or after the config
 * alike. Bun records those edges only for CommonJS requires of CommonJS
 * modules; an ES module never appears in `children`, so a consumer whose only
 * reference is an ES-module dependency briefly keeps the old namespace while
 * the next load creates a fresh one; the alternative -- preserving the whole
 * graph whenever any project-local module appeared after config evaluation --
 * would make config-helper invalidation dead code on every normal startup,
 * where application modules always load after the config.
 */
/**
 * Read a module-graph property from Bun's require cache. Bun's CommonJS
 * `Module` exposes `children`, `filename`, and `id` through prototype
 * accessors rather than own data properties, and the cache object itself
 * reports `undefined` own-descriptor values for entries it serves through
 * gets, so own-data access alone would blind graph walks to every runtime
 * edge; the accessor fallback stays guarded because the cache can also hold
 * plain objects.
 */
function bunModuleGraphValue(moduleValue: Record<string, unknown>, key: PropertyKey): unknown {
  const own = ownDataValue(moduleValue as RuntimeReflectionRecord, key);
  if (own.present && own.value !== undefined) return own.value;
  try {
    return reflectGet(moduleValue as RuntimeReflectionRecord, key);
  } catch {
    return undefined;
  }
}

function evictBunProjectConfigModules(entry: BunProjectConfigModuleCacheEntry): void {
  if (entry.dynamicImportObserver !== undefined) {
    ReflectApply(entry.dynamicImportObserver.dispose, entry.dynamicImportObserver, []);
  }
  const ownedKeys = new IntrinsicSet<string>();
  for (let index = 0; index < entry.keys.length; index++) { // NOSONAR: cache key traversal must avoid project-controlled iterators.
    const key = entry.keys[index];
    if (key !== undefined) ReflectApply(SetPrototypeAdd, ownedKeys, [key]);
  }
  const retainedOwnedKeys = new IntrinsicSet<string>();
  const retainedQueue: string[] = [];
  const retainedOwners = new IntrinsicMap<string, Set<string>>();
  const transferredKeys = new IntrinsicMap<string, Set<string>>();
  const trackingOwnersForModule = (moduleKey: string): readonly string[] => {
    const owners: string[] = [];
    mapForEach(bunProjectConfigModuleTrackingEntries, (candidate, trackingKey) => {
      if (candidate.cache !== entry.cache) return;
      for (let index = 0; index < candidate.keys.length; index++) { // NOSONAR: tracked key traversal must avoid project-controlled iterators.
        if (candidate.keys[index] !== moduleKey) continue;
        owners[owners.length] = trackingKey;
        return;
      }
    });
    return owners;
  };
  const retainOwnedKey = (key: unknown, owners: readonly string[]): void => {
    if (
      typeof key !== "string" ||
      ReflectApply(SetPrototypeHas, ownedKeys, [key]) !== true
    ) return;
    if (ReflectApply(SetPrototypeHas, retainedOwnedKeys, [key]) !== true) {
      ReflectApply(SetPrototypeAdd, retainedOwnedKeys, [key]);
      retainedQueue[retainedQueue.length] = key;
    }
    let keyOwners = mapGet(retainedOwners, key);
    if (keyOwners === undefined) {
      keyOwners = new IntrinsicSet<string>();
      mapSet(retainedOwners, key, keyOwners);
    }
    for (let index = 0; index < owners.length; index++) { // NOSONAR: owner propagation must avoid project-controlled iterators.
      const owner = owners[index];
      if (owner === undefined) continue;
      ReflectApply(SetPrototypeAdd, keyOwners, [owner]);
      let keys = mapGet(transferredKeys, owner);
      if (keys === undefined) {
        keys = new IntrinsicSet<string>();
        mapSet(transferredKeys, owner, keys);
      }
      ReflectApply(SetPrototypeAdd, keys, [key]);
    }
  };
  const retainOwnedChildren = (moduleKey: string, owners: readonly string[]): void => {
    const moduleValue = bunModuleGraphValue(entry.cache, moduleKey);
    if (!isRecord(moduleValue)) return;
    const children = bunModuleGraphValue(moduleValue, "children");
    if (!ArrayIsArray(children)) return;
    for (let childIndex = 0; childIndex < children.length; childIndex++) { // NOSONAR: Bun module children may come from project-owned cache objects.
      const child: unknown = children[childIndex];
      if (!isRecord(child)) continue;
      retainOwnedKey(bunModuleGraphValue(child, "filename"), owners);
      retainOwnedKey(bunModuleGraphValue(child, "id"), owners);
    }
  };

  // Seed retention with owned modules referenced by any external consumer.
  // Then retain their owned descendants too: keeping a parent while deleting
  // its child would split one live require graph across module generations.
  const moduleKeys = ownKeys(entry.cache);
  for (let moduleIndex = 0; moduleIndex < moduleKeys.length; moduleIndex++) { // NOSONAR: ownKeys traversal must not invoke iterator hooks from require.cache.
    const moduleKey = moduleKeys[moduleIndex];
    if (
      typeof moduleKey === "string" &&
      ReflectApply(SetPrototypeHas, ownedKeys, [moduleKey]) !== true
    ) {
      retainOwnedChildren(moduleKey, trackingOwnersForModule(moduleKey));
    }
  }
  for (let queueIndex = 0; queueIndex < retainedQueue.length; queueIndex++) { // NOSONAR: retention queue intentionally grows during indexed traversal.
    const moduleKey = retainedQueue[queueIndex]!;
    const owners = mapGet(retainedOwners, moduleKey);
    const ownerList: string[] = [];
    if (owners !== undefined) {
      ReflectApply(SetPrototypeForEach, owners, [
        (owner: string) => {
          ownerList[ownerList.length] = owner;
        },
      ]);
    }
    retainOwnedChildren(moduleKey, ownerList);
  }

  // A tracked config that references another config's owned CommonJS module
  // becomes that module's next owner. Without this transfer, the first entry
  // retains the shared helper for the live peer but the peer cannot evict it
  // later, leaving an unowned stale cache entry after both records are gone.
  mapForEach(transferredKeys, (keys, trackingKey) => {
    const owner = mapGet(bunProjectConfigModuleTrackingEntries, trackingKey);
    if (owner?.cache !== entry.cache) return;
    const nextKeys: string[] = [];
    const seen = new IntrinsicSet<string>();
    for (let index = 0; index < owner.keys.length; index++) { // NOSONAR: tracked key traversal must avoid project-controlled iterators.
      const key = owner.keys[index];
      if (key === undefined) continue;
      nextKeys[nextKeys.length] = key;
      ReflectApply(SetPrototypeAdd, seen, [key]);
    }
    ReflectApply(SetPrototypeForEach, keys, [
      (key: string) => {
        if (ReflectApply(SetPrototypeHas, seen, [key]) === true) return;
        nextKeys[nextKeys.length] = key;
        ReflectApply(SetPrototypeAdd, seen, [key]);
      },
    ]);
    setBunProjectConfigModuleTracking(trackingKey, { ...owner, keys: nextKeys });
  });

  for (let index = 0; index < entry.keys.length; index++) { // NOSONAR: cache key traversal must avoid project-controlled iterators.
    const cacheKey = entry.keys[index];
    if (
      cacheKey !== undefined &&
      ReflectApply(SetPrototypeHas, retainedOwnedKeys, [cacheKey]) !== true
    ) {
      ReflectApply(ReflectDeleteProperty, Reflect, [entry.cache, cacheKey]);
    }
  }
}

function clearBunProjectConfigModuleTracking(): void {
  const unions = new IntrinsicMap<
    Record<string, unknown>,
    { keys: string[]; seen: Set<string>; projectDirectory: string }
  >();
  mapForEach(bunProjectConfigModuleTrackingEntries, (entry) => {
    if (entry.dynamicImportObserver !== undefined) {
      ReflectApply(entry.dynamicImportObserver.dispose, entry.dynamicImportObserver, []);
    }
    let union = mapGet(unions, entry.cache);
    if (union === undefined) {
      union = {
        keys: [],
        seen: new IntrinsicSet<string>(),
        projectDirectory: entry.projectDirectory,
      };
      mapSet(unions, entry.cache, union);
    }
    for (let index = 0; index < entry.keys.length; index++) { // NOSONAR: tracked key traversal must avoid project-controlled iterators.
      const key = entry.keys[index];
      if (
        key === undefined ||
        ReflectApply(SetPrototypeHas, union.seen, [key]) === true
      ) continue;
      union.keys[union.keys.length] = key;
      ReflectApply(SetPrototypeAdd, union.seen, [key]);
    }
  });

  // Remove every tracking record before graph eviction so tracked configs do
  // not falsely pin one another. Each require-cache union still retains keys
  // referenced by genuine application modules outside the tracked union.
  clearingBunProjectConfigModuleTracking = true;
  try {
    bunProjectConfigModuleCacheKeys.clear();
  } finally {
    clearingBunProjectConfigModuleTracking = false;
  }
  mapForEach(unions, (union, cache) => {
    evictBunProjectConfigModules({
      cache,
      keys: union.keys,
      projectDirectory: union.projectDirectory,
    });
  });
}

/** @internal Test-only Bun project-module eviction seam. */
export function __evictBunProjectConfigModulesForTests(
  entry: Readonly<{
    cache: Record<string, unknown>;
    keys: readonly string[];
    projectDirectory: string;
  }>,
): void {
  evictBunProjectConfigModules(entry);
}

function declaresBunWorkspaceMembers(value: unknown): boolean {
  if (ArrayIsArray(value)) return true;
  if (!isRecord(value)) return false;
  const packages = ownDataValue(value, "packages");
  return packages.present && ArrayIsArray(packages.value);
}

function bunWorkspaceMemberPatterns(value: unknown): readonly unknown[] {
  if (ArrayIsArray(value)) return value;
  if (isRecord(value)) {
    const packages = ownDataValue(value, "packages");
    if (packages.present && ArrayIsArray(packages.value)) return packages.value;
  }
  return [];
}

/**
 * End index (exclusive) of the single-character glob token starting at
 * `index`: a character class runs through its closing bracket, while every
 * other token -- including an unclosed `[`, kept literal -- is one character.
 */
function bunWorkspaceSegmentTokenEnd(pattern: string, index: number): number {
  if (pattern[index] !== "[") return index + 1;
  let cursor = index + 1;
  if (pattern[cursor] === "!" || pattern[cursor] === "^") cursor += 1;
  // A `]` immediately after the (possibly negated) opening bracket is a
  // literal class member, not the terminator.
  if (pattern[cursor] === "]") cursor += 1;
  while (cursor < pattern.length && pattern[cursor] !== "]") cursor += 1;
  return cursor < pattern.length ? cursor + 1 : index + 1;
}

/** Whether the glob token spanning `[start, end)` matches one character. */
function bunWorkspaceSegmentTokenMatches(
  pattern: string,
  start: number,
  end: number,
  char: string,
): boolean {
  const first = pattern[start];
  if (end === start + 1) return first === "?" || first === char;
  let cursor = start + 1;
  let negated = false;
  if (pattern[cursor] === "!" || pattern[cursor] === "^") {
    negated = true;
    cursor += 1;
  }
  const membersEnd = end - 1;
  let matched = false;
  while (cursor < membersEnd) {
    const from = pattern[cursor];
    if (pattern[cursor + 1] === "-" && cursor + 2 < membersEnd) {
      const to = pattern[cursor + 2];
      if (from !== undefined && to !== undefined && from <= char && char <= to) {
        matched = true;
      }
      cursor += 3;
    } else {
      if (from === char) matched = true;
      cursor += 1;
    }
  }
  return matched !== negated;
}

/**
 * Glob match for one path segment: `*` spans any run of characters, `?`
 * matches exactly one, and `[...]` matches one character from a class with
 * `[!...]`/`[^...]` negation and `a-z` ranges. Braces are expanded before
 * segment matching, so `{` and `}` are literal here.
 */
function matchesBunWorkspaceSegment(pattern: string, segment: string): boolean {
  let patternIndex = 0;
  let segmentIndex = 0;
  let starIndex = -1;
  let starSegmentIndex = 0;
  while (segmentIndex < segment.length) {
    const char = segment[segmentIndex];
    if (patternIndex < pattern.length && pattern[patternIndex] === "*") {
      starIndex = patternIndex;
      patternIndex += 1;
      starSegmentIndex = segmentIndex;
      continue;
    }
    if (patternIndex < pattern.length && char !== undefined) {
      const tokenEnd = bunWorkspaceSegmentTokenEnd(pattern, patternIndex);
      if (bunWorkspaceSegmentTokenMatches(pattern, patternIndex, tokenEnd, char)) {
        patternIndex = tokenEnd;
        segmentIndex += 1;
        continue;
      }
    }
    if (starIndex < 0) return false;
    patternIndex = starIndex + 1;
    starSegmentIndex += 1;
    segmentIndex = starSegmentIndex;
  }
  while (patternIndex < pattern.length && pattern[patternIndex] === "*") patternIndex += 1;
  return patternIndex === pattern.length;
}

/**
 * Cap on concrete patterns produced by brace expansion, guarding against
 * adversarial alternation blowup in a workspace manifest.
 */
const BUN_WORKSPACE_BRACE_EXPANSION_LIMIT = 64;

/**
 * Expand `{a,b}` alternations into concrete patterns, Bun-glob style. An
 * alternative may span `/`, so expansion happens before segment splitting.
 * Unmatched braces are kept literal, matching the segment matcher above.
 */
function expandBunWorkspaceBracePatterns(pattern: string, expanded: string[]): boolean { // NOSONAR: brace parser is bounded and test-locked.
  if (expanded.length >= BUN_WORKSPACE_BRACE_EXPANSION_LIMIT) return false;
  const open = stringIndexOf(pattern, "{");
  if (open < 0) {
    expanded[expanded.length] = pattern;
    return true;
  }
  let depth = 0;
  let close = -1;
  for (let index = open; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0) {
    expanded[expanded.length] = pattern;
    return true;
  }
  const prefix = stringSlice(pattern, 0, open);
  const suffix = stringSlice(pattern, close + 1);
  let alternativeStart = open + 1;
  depth = 0;
  for (let index = open + 1; index <= close; index++) {
    const char = pattern[index];
    if (char === "{") depth += 1;
    else if (char === "}" && index < close) depth -= 1;
    else if ((char === "," && depth === 0) || index === close) {
      const alternative = stringSlice(pattern, alternativeStart, index);
      if (!expandBunWorkspaceBracePatterns(prefix + alternative + suffix, expanded)) {
        return false;
      }
      alternativeStart = index + 1;
    }
  }
  return true;
}

function matchesBunWorkspacePathSegments(
  patternSegments: readonly string[],
  pathSegments: readonly string[],
  patternIndex: number,
  pathIndex: number,
  pathEnd: number,
  memo = new IntrinsicMap<number, boolean>(),
): boolean {
  const memoKey = patternIndex * (pathEnd + 1) + pathIndex;
  const memoized = mapGet(memo, memoKey);
  if (memoized !== undefined) return memoized;
  if (patternIndex >= patternSegments.length) {
    const matched = pathIndex === pathEnd;
    mapSet(memo, memoKey, matched);
    return matched;
  }
  const pattern = patternSegments[patternIndex];
  if (pattern === undefined) {
    mapSet(memo, memoKey, false);
    return false;
  }
  if (pattern === "**") {
    for (let skip = pathIndex; skip <= pathEnd; skip++) {
      if (
        matchesBunWorkspacePathSegments(
          patternSegments,
          pathSegments,
          patternIndex + 1,
          skip,
          pathEnd,
          memo,
        )
      ) {
        mapSet(memo, memoKey, true);
        return true;
      }
    }
    mapSet(memo, memoKey, false);
    return false;
  }
  const segment = pathSegments[pathIndex];
  if (
    pathIndex >= pathEnd || segment === undefined ||
    !matchesBunWorkspaceSegment(pattern, segment)
  ) {
    mapSet(memo, memoKey, false);
    return false;
  }
  const matched = matchesBunWorkspacePathSegments(
    patternSegments,
    pathSegments,
    patternIndex + 1,
    pathIndex + 1,
    pathEnd,
    memo,
  );
  mapSet(memo, memoKey, matched);
  return matched;
}

/**
 * Whether `projectDirectory` sits inside a declared workspace member of
 * `workspaceRoot`. A declaring ancestor is not enough on its own: a project
 * nested under an unrelated repository whose root declares workspaces it does
 * not belong to must not adopt that root's module-tracking scope. Negation
 * patterns are ignored, erring toward the narrower config-directory scope.
 */
function isBunWorkspaceMemberDirectory( // NOSONAR: Bun workspace glob matcher is bounded and regression-covered.
  workspaceRoot: string,
  projectDirectory: string,
  workspacesValue: unknown,
): boolean {
  const relativeProject = ReflectApply(
    StringPrototypeReplaceAll,
    relative(
      workspaceRoot,
      projectDirectory,
    ),
    ["\\", "/"],
  ) as string;
  if (
    relativeProject.length === 0 || relativeProject === ".." ||
    stringStartsWith(relativeProject, "../") || isAbsolute(relativeProject)
  ) return false;
  const pathSegments = ReflectApply(StringPrototypeSplit, relativeProject, ["/"]) as string[];
  const patterns = bunWorkspaceMemberPatterns(workspacesValue);
  for (let index = 0; index < patterns.length; index++) { // NOSONAR: workspace patterns may come from project package data.
    const pattern = patterns[index];
    if (typeof pattern !== "string" || pattern.length === 0) continue;
    if (stringStartsWith(pattern, "!")) continue;
    let normalized = ReflectApply(StringPrototypeReplaceAll, pattern, ["\\", "/"]) as string;
    if (stringStartsWith(normalized, "./")) normalized = stringSlice(normalized, 2);
    if (stringEndsWith(normalized, "/")) {
      normalized = stringSlice(normalized, 0, normalized.length - 1);
    }
    if (normalized.length === 0) continue;
    const bracePatterns: string[] = [];
    if (!expandBunWorkspaceBracePatterns(normalized, bracePatterns)) {
      // The pattern is valid but exceeds the defensive expansion budget.
      // Widening to the declaring workspace root is conservative for cache
      // invalidation and avoids silently excluding later alternatives.
      return true;
    }
    for (let braceIndex = 0; braceIndex < bracePatterns.length; braceIndex++) { // NOSONAR: expanded patterns stay indexed under poisoned primordials.
      const bracePattern = bracePatterns[braceIndex];
      if (bracePattern === undefined || bracePattern.length === 0) continue;
      const patternSegments = ReflectApply(StringPrototypeSplit, bracePattern, ["/"]) as string[];
      // The member directory may be the project directory itself or any of its
      // ancestors below the workspace root: a config nested inside a member
      // still belongs to that member.
      for (let pathEnd = 1; pathEnd <= pathSegments.length; pathEnd++) {
        if (
          matchesBunWorkspacePathSegments(
            patternSegments,
            pathSegments,
            0,
            0,
            pathEnd,
          )
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/** @internal Test-only Bun workspace-membership seam. */
export function __isBunWorkspaceMemberDirectoryForTests(
  workspaceRoot: string,
  projectDirectory: string,
  workspacesValue: unknown,
): boolean {
  return isBunWorkspaceMemberDirectory(workspaceRoot, projectDirectory, workspacesValue);
}

/**
 * Widen module ownership to the Bun workspace root when the project belongs to
 * one. Hoisted workspace dependencies resolve into an ancestor `node_modules`
 * or a sibling package directory, so tracking only descendants of the config
 * directory would leave them cached — and stale — across config reloads. The
 * The lexical and canonical ancestor chains are both inspected. A project
 * reached through an out-of-tree symlink has no lexical workspace ancestor,
 * while Bun resolves its modules through the physical workspace and its
 * hoisted dependencies. Within either chain, the nearest ancestor that
 * declares workspaces settles that chain's membership.
 */
async function findBunProjectWorkspaceScopeDirectory(
  ancestorDirectory: string,
  projectDirectory: string,
): Promise<string | undefined> {
  let directory = ancestorDirectory;
  while (true) {
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
    let manifest: ProjectPackageManifest | undefined;
    try {
      manifest = await readProjectPackageManifest(directory);
    } catch {
      continue;
    }
    if (!manifest) continue;
    const workspaces = ownDataValue(manifest.value, "workspaces");
    if (workspaces.present && declaresBunWorkspaceMembers(workspaces.value)) {
      return isBunWorkspaceMemberDirectory(directory, projectDirectory, workspaces.value)
        ? directory
        : undefined;
    }
  }
}

async function resolveBunProjectScopeDirectory(projectDirectory: string): Promise<string> {
  const lexicalScope = await findBunProjectWorkspaceScopeDirectory(
    projectDirectory,
    projectDirectory,
  );
  if (lexicalScope !== undefined) return lexicalScope;

  let canonicalProjectDirectory: string;
  try {
    canonicalProjectDirectory = await realPath(projectDirectory);
  } catch {
    return projectDirectory;
  }
  if (canonicalProjectDirectory === projectDirectory) return projectDirectory;
  return await findBunProjectWorkspaceScopeDirectory(
    canonicalProjectDirectory,
    canonicalProjectDirectory,
  ) ?? projectDirectory;
}

async function resolveBunProjectTrackingScope(
  projectDirectory: string,
): Promise<BunProjectTrackingScope> {
  const lexicalDirectory = await resolveBunProjectScopeDirectory(projectDirectory);
  const canonicalProjectDirectory = await realPath(projectDirectory);
  const canonicalDirectory = await resolveBunProjectScopeDirectory(canonicalProjectDirectory);
  const projectDirectories = [projectDirectory];
  const lexicalParentDirectory = dirname(projectDirectory);
  const canonicalParentDirectory = await realPath(lexicalParentDirectory);
  if (isPathWithinDirectory(canonicalParentDirectory, canonicalProjectDirectory)) {
    const lexicalTargetDirectory = resolve(
      lexicalParentDirectory,
      relative(canonicalParentDirectory, canonicalProjectDirectory),
    );
    if (lexicalTargetDirectory !== projectDirectory) {
      projectDirectories[projectDirectories.length] = lexicalTargetDirectory;
    }
  }
  if (
    canonicalProjectDirectory !== projectDirectory &&
    canonicalProjectDirectory !== projectDirectories[projectDirectories.length - 1] // NOSONAR: .at() would invoke mutable Array.prototype.
  ) {
    projectDirectories[projectDirectories.length] = canonicalProjectDirectory;
  }
  return {
    lexicalDirectory,
    canonicalDirectory,
    projectDirectories,
  };
}

function prepareBunProjectConfigModules(
  projectRequire: NodeJS.Require,
  configPath: string,
  canonicalConfigPath: string,
  scope: BunProjectTrackingScope,
): BunProjectCacheSnapshot {
  const resolvedConfigPath = projectRequire.resolve(configPath);
  // Deletion invokes the cache eviction hook, including when the tracking LRU
  // discarded the entry earlier because it reached capacity.
  bunProjectConfigModuleCacheKeys.delete(canonicalConfigPath);
  ReflectApply(ReflectDeleteProperty, Reflect, [projectRequire.cache, resolvedConfigPath]);

  const before = new IntrinsicSet<string>();
  const cacheKeys = ownKeys(projectRequire.cache);
  for (let index = 0; index < cacheKeys.length; index++) { // NOSONAR: ownKeys traversal must not invoke iterator hooks from require.cache.
    const cacheKey = cacheKeys[index];
    if (typeof cacheKey === "string") {
      ReflectApply(SetPrototypeAdd, before, [cacheKey]);
    }
  }
  return { before, scope, canonicalConfigPath };
}

/**
 * Widen the lexer-derived eligible set with runtime `Module.children` edges.
 * The module lexer only sees static ESM imports, so a CommonJS dependency of
 * an async config whose `require()` loads further project helpers leaves
 * those helpers out of the eligible set; Bun records the CommonJS require
 * edges in `children`, so walking them from every eligible module claims the
 * full graph this config load introduced. Only modules new to this load and
 * inside the tracking scope are added, keeping concurrent application loads
 * out of the tracked graph.
 */
function expandBunEligibleDependencyKeys(
  projectRequire: NodeJS.Require,
  snapshot: BunProjectCacheSnapshot,
  eligibleKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  const expanded = new IntrinsicSet<string>();
  const queue: string[] = [];
  const include = (cacheKey: unknown): void => {
    if (typeof cacheKey !== "string") return;
    const resolvedKey = resolve(cacheKey);
    if (
      ReflectApply(SetPrototypeHas, expanded, [resolvedKey]) === true ||
      ReflectApply(SetPrototypeHas, snapshot.before, [cacheKey]) === true ||
      !isPathWithinBunProjectScope(snapshot.scope, cacheKey)
    ) {
      return;
    }
    ReflectApply(SetPrototypeAdd, expanded, [resolvedKey]);
    queue[queue.length] = cacheKey;
  };
  const cacheKeys = ownKeys(projectRequire.cache);
  for (let index = 0; index < cacheKeys.length; index++) { // NOSONAR: ownKeys traversal must not invoke iterator hooks from require.cache.
    const cacheKey = cacheKeys[index];
    if (
      typeof cacheKey === "string" &&
      ReflectApply(SetPrototypeHas, eligibleKeys, [resolve(cacheKey)]) === true
    ) {
      include(cacheKey);
    }
  }
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) { // NOSONAR: dependency queue intentionally grows during indexed traversal.
    const moduleValue = bunModuleGraphValue(projectRequire.cache, queue[queueIndex]!);
    if (!isRecord(moduleValue)) continue;
    const children = bunModuleGraphValue(moduleValue, "children");
    if (!ArrayIsArray(children)) continue;
    for (let childIndex = 0; childIndex < children.length; childIndex++) { // NOSONAR: Bun module children may come from project-owned cache objects.
      const child: unknown = children[childIndex];
      if (!isRecord(child)) continue;
      include(bunModuleGraphValue(child, "filename"));
      include(bunModuleGraphValue(child, "id"));
    }
  }
  return expanded;
}

/** Collect only the project-local modules that this config load introduced. */
function collectBunProjectConfigModules( // NOSONAR: ownership collector is graph-shaped and guarded by regression tests.
  projectRequire: NodeJS.Require,
  snapshot: BunProjectCacheSnapshot,
  eligibleKeys?: ReadonlySet<string>,
  prior?: BunProjectConfigModuleCacheEntry,
  _includeAllNewModules = false,
): BunProjectConfigModuleCacheEntry {
  const loadedKeys: string[] = [];
  const loadedKeySet = new IntrinsicSet<string>();
  if (prior !== undefined) {
    for (let index = 0; index < prior.keys.length; index++) { // NOSONAR: prior key traversal must avoid project-controlled iterators.
      const cacheKey = prior.keys[index];
      if (cacheKey === undefined) continue;
      loadedKeys[loadedKeys.length] = cacheKey;
      ReflectApply(SetPrototypeAdd, loadedKeySet, [cacheKey]);
    }
  }
  const expandedEligibleKeys = eligibleKeys === undefined
    ? undefined
    : expandBunEligibleDependencyKeys(projectRequire, snapshot, eligibleKeys);
  const cacheKeys = ownKeys(projectRequire.cache);
  for (let index = 0; index < cacheKeys.length; index++) { // NOSONAR: ownKeys traversal must not invoke iterator hooks from require.cache.
    const cacheKey = cacheKeys[index];
    if (
      typeof cacheKey !== "string" ||
      ReflectApply(SetPrototypeHas, snapshot.before, [cacheKey]) === true ||
      !isPathWithinBunProjectScope(snapshot.scope, cacheKey) ||
      (expandedEligibleKeys !== undefined &&
        ReflectApply(SetPrototypeHas, expandedEligibleKeys, [resolve(cacheKey)]) !== true) ||
      ReflectApply(SetPrototypeHas, loadedKeySet, [cacheKey]) === true
    ) {
      continue;
    }
    loadedKeys[loadedKeys.length] = cacheKey;
    ReflectApply(SetPrototypeAdd, loadedKeySet, [cacheKey]);
    const aliases = bunProjectModuleCacheAliases(snapshot.scope, cacheKey);
    for (let aliasIndex = 0; aliasIndex < aliases.length; aliasIndex++) { // NOSONAR: alias traversal must avoid project-controlled iterators.
      const alias = aliases[aliasIndex];
      if (
        alias === undefined ||
        ReflectApply(SetPrototypeHas, snapshot.before, [alias]) === true ||
        ReflectApply(SetPrototypeHas, loadedKeySet, [alias]) === true
      ) continue;
      try {
        const moduleValue = ReflectApply(ReflectGet, Reflect, [projectRequire.cache, cacheKey]);
        const aliasValue = ReflectApply(ReflectGet, Reflect, [projectRequire.cache, alias]);
        if (moduleValue !== undefined && aliasValue === undefined) {
          ReflectApply(ReflectSet, Reflect, [projectRequire.cache, alias, moduleValue]);
        }
        if (
          moduleValue !== undefined &&
          ReflectApply(ReflectGet, Reflect, [projectRequire.cache, alias]) === moduleValue
        ) {
          loadedKeys[loadedKeys.length] = alias;
          ReflectApply(SetPrototypeAdd, loadedKeySet, [alias]);
        }
      } catch {
        // Bun's cache remains authoritative if it refuses an alias.
      }
    }
  }
  if (expandedEligibleKeys !== undefined) {
    ReflectApply(SetPrototypeForEach, expandedEligibleKeys, [
      (eligibleKey: string) => {
        const resolvedKey = resolve(eligibleKey);
        if (
          isPathWithinBunProjectScope(snapshot.scope, resolvedKey) &&
          ReflectApply(SetPrototypeHas, snapshot.before, [resolvedKey]) !== true &&
          ReflectApply(SetPrototypeHas, loadedKeySet, [resolvedKey]) !== true
        ) {
          loadedKeys[loadedKeys.length] = resolvedKey;
          ReflectApply(SetPrototypeAdd, loadedKeySet, [resolvedKey]);
        }
      },
    ]);
  }
  return {
    cache: projectRequire.cache,
    keys: loadedKeys,
    projectDirectory: snapshot.scope.lexicalDirectory,
    ...(prior?.dynamicImportObserver === undefined
      ? {}
      : { dynamicImportObserver: prior.dynamicImportObserver }),
  };
}

/** @internal Test-only Bun project-module collection seam. */
export function __collectBunProjectConfigModulesForTests(
  input: Readonly<{
    cache: Record<string, unknown>;
    before?: ReadonlySet<string>;
    eligibleKeys?: ReadonlySet<string>;
    projectDirectory: string;
    includeAllNewModules?: boolean;
  }>,
): BunProjectConfigModuleCacheEntry {
  const projectRequire = {
    cache: input.cache,
  } as NodeJS.Require;
  return collectBunProjectConfigModules(
    projectRequire,
    {
      before: input.before ?? new IntrinsicSet<string>(),
      scope: {
        lexicalDirectory: input.projectDirectory,
        canonicalDirectory: input.projectDirectory,
        projectDirectories: [input.projectDirectory],
      },
      canonicalConfigPath: `${input.projectDirectory}/veryfront.config.ts`,
    },
    input.eligibleKeys,
    undefined,
    input.includeAllNewModules,
  );
}

async function serializeBunProjectConfigLoad<T>(
  configPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = mapGet(bunProjectConfigLoadTurns, configPath);
  const turn = promiseWithResolvers<void>();
  mapSet(bunProjectConfigLoadTurns, configPath, turn.promise);
  try {
    if (previous) await previous;
    // A deferred computed import can finish runtime evaluation before its
    // source walk has found every transitive dependency. Cache clearing
    // disposes its observer; wait for that old walk (and its eviction) before
    // a new revision loads modules that the old walk would otherwise delete.
    while (true) {
      const pending = mapGet(bunProjectConfigPendingDependencyCollections, configPath);
      if (pending === undefined) break;
      await pending;
      if (mapGet(bunProjectConfigPendingDependencyCollections, configPath) === pending) {
        mapDelete(bunProjectConfigPendingDependencyCollections, configPath);
      }
    }
    return await operation();
  } finally {
    turn.resolve();
    if (mapGet(bunProjectConfigLoadTurns, configPath) === turn.promise) {
      mapDelete(bunProjectConfigLoadTurns, configPath);
    }
  }
}

async function loadAndMergeConfig(
  configPath: string,
  cacheKey: string,
  adapter: RuntimeAdapter,
  revisionAtStart: number,
  selectedVirtualContent?: string | Uint8Array,
): Promise<MergedConfigLoadResult> {
  const isVirtualFS = isVirtualFilesystem(adapter.fs);
  logger.debug("loadAndMergeConfig called", {
    configPath,
    cacheKey,
    isVirtualFS,
    isBun,
    isDenoCompiled,
  });

  if (isVirtualFS) {
    logger.debug("Using trusted single-project virtual filesystem for config", { configPath });
    return {
      config: await loadTrustedConfigFromVirtualFS(
        configPath,
        cacheKey,
        adapter,
        selectedVirtualContent,
      ),
    };
  }

  if (isBun) {
    logger.debug("Using project config import for Bun", { configPath });
    const absolutePath = resolve(configPath);
    const canonicalConfigPath = await realPath(absolutePath);
    return await serializeBunProjectConfigLoad(canonicalConfigPath, async () => { // NOSONAR: serialized Bun load owns several cleanup/failure branches.
      const source = await createFileSystem().readTextFile(absolutePath);
      const hasTopLevelAwait = await bunConfigHasTopLevelAwait(source, absolutePath);
      const { createRequire } = await import("node:module");
      const projectRequire = createRequire(absolutePath);
      // Bun ignores query strings when caching file modules, and its CommonJS
      // cache entries expose no parent-to-child dependency graph. Track the
      // project-local modules introduced by each config load so the next load
      // can invalidate that graph without evicting unrelated application state.
      // Ownership spans the Bun workspace root when the project is a workspace
      // member, so hoisted workspace dependencies reload alongside the config.
      const projectScope = await resolveBunProjectTrackingScope(dirname(absolutePath));
      const cacheSnapshot = prepareBunProjectConfigModules(
        projectRequire,
        absolutePath,
        canonicalConfigPath,
        projectScope,
      );
      let configModule: object | undefined;
      let trackingEntry: BunProjectConfigModuleCacheEntry | undefined;
      let dynamicImportObserver: BunProjectDynamicImportObserver | undefined;
      let trackingPublished = false;
      const discardTracking = (): void => {
        if (dynamicImportObserver !== undefined) {
          ReflectApply(dynamicImportObserver.dispose, dynamicImportObserver, []);
          dynamicImportObserver = undefined;
        }
        if (trackingEntry !== undefined) {
          evictBunProjectConfigModules(trackingEntry);
          trackingEntry = undefined;
        }
      };
      const publishTracking = (): void => {
        if (trackingEntry === undefined || trackingPublished) return;
        const ownedEntry: BunProjectConfigModuleCacheEntry = dynamicImportObserver === undefined
          ? trackingEntry
          : { ...trackingEntry, dynamicImportObserver };
        setBunProjectConfigModuleTracking(cacheSnapshot.canonicalConfigPath, ownedEntry);
        trackingEntry = ownedEntry;
        trackingPublished = true;
      };
      try {
        if (!hasTopLevelAwait) {
          try {
            configModule = projectRequire(absolutePath) as object;
          } catch (error) {
            if (!isBunAsyncModuleRequireError(error)) throw error;
          } finally {
            // The synchronous require can only add modules from this config's
            // graph. Stage those keys before awaiting the fallback so concurrent
            // application loads cannot be mistaken for config dependencies.
            trackingEntry = collectBunProjectConfigModules(
              projectRequire,
              cacheSnapshot,
              undefined,
              trackingEntry,
            );
          }
        }
        if (configModule === undefined) {
          const imported = await importFreshBunAsyncConfig(
            absolutePath,
            canonicalConfigPath,
            source,
            projectScope,
            (dependencyKeys) => {
              trackingEntry = collectBunProjectConfigModules(
                projectRequire,
                cacheSnapshot,
                dependencyKeys,
                trackingEntry,
              );
              if (trackingPublished) {
                const ownedEntry: BunProjectConfigModuleCacheEntry =
                  dynamicImportObserver === undefined
                    ? trackingEntry
                    : { ...trackingEntry, dynamicImportObserver };
                setBunProjectConfigModuleTracking(
                  cacheSnapshot.canonicalConfigPath,
                  ownedEntry,
                );
                trackingEntry = ownedEntry;
              }
            },
            (dependencyKeys) => {
              const discardedEntry = collectBunProjectConfigModules(
                projectRequire,
                cacheSnapshot,
                dependencyKeys,
                trackingEntry,
              );
              evictBunProjectConfigModules(discardedEntry);
              trackingEntry = undefined;
            },
          );
          configModule = imported.configModule;
          dynamicImportObserver = imported.observer;
        }
        const merged = validateAndMergeConfig(selectConfigModuleValue(configModule));
        if (cacheRevision !== revisionAtStart) {
          discardTracking();
          throw BUN_PROJECT_CONFIG_LOAD_INVALIDATED;
        }
        return {
          config: merged,
          bunTrackingPublication: {
            key: canonicalConfigPath,
            publish: publishTracking,
            discard: discardTracking,
          },
        };
      } catch (error) {
        discardTracking();
        throw error;
      }
    });
  }

  // Compiled Deno binaries can't dynamically import TypeScript files directly.
  // Read the source, transpile when needed, and import it from a temp file.
  if (isDenoCompiled) {
    logger.debug("Using temp file import for compiled Deno", {
      configPath,
      isDenoCompiled,
    });
    const fs = createFileSystem();
    const source = await fs.readTextFile(configPath);
    const absolutePath = resolve(configPath);

    const userConfig = await loadConfigFromTempFile(
      source,
      absolutePath,
      (tempFile) => ReflectApply(intrinsicUrlHrefGetter, toFileUrl(tempFile), []) as string,
      (processedSource) => rewriteProjectConfigImportsFromProject(processedSource, absolutePath),
    );
    logger.debug("Successfully loaded config via temp file", {
      configPath,
      hasApp: !!(userConfig as Record<string, unknown>)?.app,
      hasRouter: !!(userConfig as Record<string, unknown>)?.router,
    });
    return { config: validateAndMergeConfig(userConfig) };
  }

  const absolutePath = resolve(configPath);
  const configUrl = toFileUrl(absolutePath);
  configUrl.searchParams.set("t", `${Date.now()}-${crypto.randomUUID()}`);
  const configModule = await import(
    ReflectApply(intrinsicUrlHrefGetter, configUrl, []) as string
  );
  return { config: validateAndMergeConfig(selectConfigModuleValue(configModule)) };
}

/**
 * Options for getConfig
 */
export interface GetConfigOptions {
  /**
   * Cache key for virtual filesystem (API-backed) projects.
   * When provided, this is used instead of projectDir for caching.
   * This should be a unique project identifier (e.g., projectId or projectSlug).
   */
  cacheKey?: string;

  /**
   * Exact source selected by the trusted caller for a virtual filesystem read.
   * The source must match the active request context. Mutable branch sources
   * are never stored in the process-wide config cache.
   */
  sourceContext?: VirtualConfigSourceContext;
}

/**
 * Internal server contract for untrusted hosted project configuration.
 *
 * This type is intentionally not re-exported from the public configuration
 * barrels. Hosted callers must establish project, source, and environment
 * identity before invoking the loader.
 */
export interface HostedConfigOptions {
  readonly cacheKey: string;
  readonly sourceContext: VirtualConfigSourceContext;
  readonly preparedContext: PreparedDeclarativeConfigContext;
  readonly signal?: AbortSignal;
  readonly validationBoundary?: (validate: () => VeryfrontConfig) => VeryfrontConfig;
}

/**
 * Authenticated source and environment binding for one hosted evaluation.
 *
 * A composition root derives this once from control-plane state and threads it
 * to every consumer of that request's configuration. Nothing downstream may
 * re-derive source or environment identity for itself.
 *
 * @internal
 */
export type PreparedHostedConfigContext = Pick<
  HostedConfigOptions,
  "sourceContext" | "preparedContext"
>;

/** Exact declarative source selected by a trusted composition boundary. */
export type HostedConfigSource = Readonly<{
  source: string;
  fileName: DeclarativeConfigFileName;
}>;

/**
 * Explicit context for evaluating one hosted configuration source.
 *
 * Callers must derive both the source and environment from authenticated
 * control-plane state. Passing `null` selects immutable framework defaults.
 */
export interface EvaluateHostedConfigSourceOptions {
  /** Trusted immutable source identity, including project and release. */
  readonly cacheKey: string;
  readonly source: HostedConfigSource | null;
  readonly environmentName: string;
  readonly environment: unknown;
  readonly signal?: AbortSignal;
}

interface InternalGetConfigOptions extends GetConfigOptions {
  readonly hosted?: Readonly<{
    preparedContext: PreparedDeclarativeConfigContext;
    signal?: AbortSignal;
    validationBoundary?: (validate: () => VeryfrontConfig) => VeryfrontConfig;
  }>;
}

function getVirtualConfigSourceContext(): VirtualConfigSourceContext | undefined {
  const source = currentRequestContext();
  if (!source) return undefined;

  return {
    productionMode: source.productionMode,
    releaseId: source.releaseId,
    branch: source.branch,
    environmentName: source.environmentName,
  };
}

function describeVirtualConfigSource(context: VirtualConfigSourceContext): string {
  if (!context.productionMode) return `branch:${context.branch ?? "main"}`;
  if (context.environmentName) {
    return `environment:${context.environmentName}:${context.releaseId ?? "missing-release"}`;
  }
  return `release:${context.releaseId ?? "missing-release"}`;
}

type NormalizedVirtualConfigSource =
  | { productionMode: false; branch: string }
  | {
    productionMode: true;
    releaseId: string | null;
    environmentName: string | null;
  };

function normalizeVirtualConfigSource(
  context: VirtualConfigSourceContext,
): NormalizedVirtualConfigSource {
  if (!context.productionMode) {
    return { productionMode: false, branch: context.branch ?? "main" };
  }

  return {
    productionMode: true,
    releaseId: context.releaseId ?? null,
    environmentName: context.environmentName ?? null,
  };
}

function encodeVirtualConfigSourceIdentity(
  context: VirtualConfigSourceContext,
): string {
  if (!context.productionMode) {
    return `branch:${frameConfigIdentityString(context.branch ?? "main")}`;
  }

  return `production:${frameOptionalConfigIdentityString(context.releaseId)}${
    frameOptionalConfigIdentityString(context.environmentName)
  }`;
}

function virtualConfigSourcesMatch(
  expected: NormalizedVirtualConfigSource,
  actual: NormalizedVirtualConfigSource,
): boolean {
  if (expected.productionMode !== actual.productionMode) return false;
  if (!expected.productionMode && !actual.productionMode) {
    return expected.branch === actual.branch;
  }
  if (expected.productionMode && actual.productionMode) {
    return expected.releaseId === actual.releaseId &&
      expected.environmentName === actual.environmentName;
  }
  return false;
}

function assertMatchingVirtualConfigSource(
  expected: VirtualConfigSourceContext,
  actual: VirtualConfigSourceContext | undefined,
): void {
  if (!actual) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Explicit virtual config source requires an active request context",
    });
  }

  const expectedSource = normalizeVirtualConfigSource(expected);
  const actualSource = normalizeVirtualConfigSource(actual);
  if (virtualConfigSourcesMatch(expectedSource, actualSource)) return;

  throw CACHE_INVARIANT_VIOLATION.create({
    detail: `Explicit virtual config source "${
      describeVirtualConfigSource(expected)
    }" does not match the current request context "${describeVirtualConfigSource(actual)}"`,
  });
}

function assertMatchingHostedProjectIdentity(
  cacheKey: string,
  actual: ReturnType<typeof currentRequestContext>,
): void {
  if (!actual) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Hosted multi-project config requires an active request context",
    });
  }

  const canonicalProjectIdentity = actual.projectId ?? actual.projectSlug;
  if (cacheKey === canonicalProjectIdentity) return;

  throw CACHE_INVARIANT_VIOLATION.create({
    detail: "Hosted config cache identity does not match the active project context",
  });
}

function assertMatchingHostedEnvironmentIdentity(
  sourceContext: VirtualConfigSourceContext,
  payload: PreparedDeclarativeConfigWorkerPayload,
): void {
  const actualEnvironmentName = payload.evaluationOptions.environmentName;
  if (!sourceContext.productionMode) {
    if (actualEnvironmentName === "preview") return;
  } else if (sourceContext.environmentName) {
    if (actualEnvironmentName === sourceContext.environmentName) return;
  } else {
    const environment = payload.evaluationOptions.environment;
    if (
      actualEnvironmentName === "release" &&
      typeof environment === "object" &&
      environment !== null &&
      getPrototypeOf(environment) === null &&
      isFrozen(environment) &&
      ownKeys(environment).length === 0
    ) {
      return;
    }
  }

  throw CACHE_INVARIANT_VIOLATION.create({
    detail: "Hosted config environment identity does not match its selected source",
  });
}

function buildTrustedConfigIdentity(
  effectiveCacheKey: string,
  adapter: RuntimeAdapter,
  isVirtualFS: boolean,
  hasStableVirtualSourceIdentity: boolean,
  ambientSourceContext: VirtualConfigSourceContext | undefined,
): string {
  if (!isVirtualFS || hasStableVirtualSourceIdentity) return effectiveCacheKey;

  const filesystem = adapter.fs as object;
  let filesystemId = weakMapGet(trustedVirtualFilesystemIds, filesystem);
  if (filesystemId === undefined) {
    filesystemId = nextTrustedVirtualFilesystemId;
    nextTrustedVirtualFilesystemId += 1;
    weakMapSet(trustedVirtualFilesystemIds, filesystem, filesystemId);
  }
  const sourceIdentity = ambientSourceContext
    ? encodeVirtualConfigSourceIdentity(ambientSourceContext)
    : "contextless";
  return `unqualified-vfs-v2:${frameConfigIdentityString(decimalIdentityNumber(filesystemId))}${
    frameConfigIdentityString(sourceIdentity)
  }${frameConfigIdentityString(effectiveCacheKey)}`;
}

function getConfigInternal(
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: InternalGetConfigOptions,
): Promise<ConfigLoadResult> {
  const getConfigStartTime = performance.now();
  const cacheKeyForLog = options?.cacheKey || "unknown";

  logger.debug("getConfig START", { projectDir, cacheKey: cacheKeyForLog });

  return withSpan(
    SpanNames.CONFIG_LOAD,
    async () => {
      const revisionAtStart = cacheRevision;
      const isVirtualFS = isVirtualFilesystem(adapter.fs);
      const hosted = options?.hosted;
      const hostedMultiProjectFilesystem = isHostedMultiProjectFilesystem(adapter);
      if (hostedMultiProjectFilesystem && !hosted) {
        throw CACHE_INVARIANT_VIOLATION.create({
          detail:
            "Hosted multi-project config requires an authenticated declarative evaluation context",
        });
      }
      if (hosted && (!options?.cacheKey || !options.sourceContext)) {
        throw CACHE_INVARIANT_VIOLATION.create({
          detail: "Hosted config requires canonical project and source identity",
        });
      }
      if (hosted) {
        throwIfHostedConfigAborted(hosted.signal);
        // Validate the opaque token before any project filesystem access.
        const validationPayload = createPreparedDeclarativeConfigWorkerPayload(
          "",
          hosted.preparedContext,
        );
        assertMatchingHostedEnvironmentIdentity(options!.sourceContext!, validationPayload);
      }

      const hasQualifiedCacheIdentity = !!options?.cacheKey && (isVirtualFS || !!hosted);
      if (options?.sourceContext && !hasQualifiedCacheIdentity) {
        throw CACHE_INVARIANT_VIOLATION.create({
          detail: "Explicit config source requires a virtual filesystem and cacheKey",
        });
      }

      const ambientSourceContext = isVirtualFS ? getVirtualConfigSourceContext() : undefined;
      if (options?.sourceContext && isVirtualFS) {
        assertMatchingVirtualConfigSource(options.sourceContext, ambientSourceContext);
      }
      if (hostedMultiProjectFilesystem) {
        assertMatchingHostedProjectIdentity(options!.cacheKey!, currentRequestContext());
      }
      const sourceContext = hasQualifiedCacheIdentity
        ? options.sourceContext ?? ambientSourceContext
        : undefined;
      const usePersistentCache = hosted
        ? sourceContext?.productionMode === true
        : !isVirtualFS || sourceContext?.productionMode === true;
      const useVirtualCacheNamespace = !!hosted || (isVirtualFS && !!options?.cacheKey);
      const effectiveCacheKey = buildConfigCacheKey(
        useVirtualCacheNamespace ? options!.cacheKey! : projectDir,
        useVirtualCacheNamespace,
        sourceContext,
      );
      const trustedConfigIdentity = buildTrustedConfigIdentity(
        effectiveCacheKey,
        adapter,
        isVirtualFS,
        hasQualifiedCacheIdentity && sourceContext?.productionMode === true,
        ambientSourceContext,
      );

      logger.debug("Cache key built", {
        effectiveCacheKey,
        isVirtualFS,
        cacheKey: cacheKeyForLog,
        source: sourceContext ? describeVirtualConfigSource(sourceContext) : undefined,
        usePersistentCache,
      });

      // Hosted cache identity includes the exact source digest, so source must
      // be read before the final cache lookup.
      const cached = !hosted && usePersistentCache
        ? configCacheByProject.get(effectiveCacheKey)
        : undefined;
      if (cached?.revision === revisionAtStart) {
        if (!isVirtualFS) {
          touchBunProjectConfigModuleTracking(
            projectDir,
            cached.provenance,
            cached.bunTrackingKey,
          );
        }
        logger.debug("Cache HIT - using cached config", {
          cacheKey: effectiveCacheKey,
          isVirtualFS,
          hasApp: !!cached.config.app,
          hasLayout: !!(cached.config as Record<string, unknown>).layout,
          duration: `${(performance.now() - getConfigStartTime).toFixed(2)}ms`,
        });
        return createConfigLoadResult(cached.config, cached.provenance);
      }

      logger.debug("Cache MISS - loading config", {
        cacheKey: effectiveCacheKey,
        isVirtualFS,
      });

      const loadUncached = async (): Promise<ConfigLoadResult> => {
        // For virtual filesystem, config is at project root ("/"), not the local projectDir
        const configBaseDir = isVirtualFS ? "/" : projectDir;

        if (hosted) {
          let sourceReadLease: HostedConfigSourceReadLease;
          try {
            const sourceReadKey = buildHostedConfigSourceReadKey(
              effectiveCacheKey,
              configBaseDir,
              adapter,
              sourceContext!,
              revisionAtStart,
            );
            const sourceReadFlight = getOrCreateHostedConfigSourceReadFlight(
              sourceReadKey,
              () => readHostedConfigSource(adapter, configBaseDir),
            );
            sourceReadLease = await waitForHostedConfigSourceReadFlight(
              sourceReadFlight,
              hosted.signal,
            );
          } catch (error) {
            if (error instanceof DeclarativeConfigEvaluationError) {
              throw translateHostedConfigEvaluationError(error);
            }
            if (isPreservedConfigLoadError(error)) throw error;
            throw CONFIG_PARSE_ERROR.create({
              detail: "Failed to select hosted configuration source",
              cause: error,
            });
          }

          try {
            throwIfHostedConfigAborted(hosted.signal);
            const selectedSource = sourceReadLease.selection;
            if (selectedSource) {
              const { configPath, configFile, source } = selectedSource;
              try {
                const merged = await loadHostedConfigFromSource(
                  configPath,
                  configFile,
                  effectiveCacheKey,
                  source,
                  hosted.preparedContext,
                  hosted.signal,
                  usePersistentCache,
                  revisionAtStart,
                  hosted.validationBoundary,
                );
                const provenance = configFileProvenance(configFile);
                logger.debug("Successfully loaded config", {
                  configFile,
                  hasApp: !!merged.app,
                  hasLayout: !!(merged as Record<string, unknown>).layout,
                  configKeys: Object.keys(merged),
                });
                return createConfigLoadResult(merged, provenance);
              } catch (error) {
                if (error instanceof DeclarativeConfigEvaluationError) {
                  throw translateHostedConfigEvaluationError(error, configFile);
                }
                if (isPreservedConfigLoadError(error)) throw error;
                logger.warn("Failed to load config file", { configFile });
                throw configLoadFailure(configFile, error);
              }
            }

            logger.debug("No config file found, using defaults", {
              effectiveCacheKey,
              projectDir,
              isVirtualFS,
              duration: `${(performance.now() - getConfigStartTime).toFixed(2)}ms`,
            });
            throwIfHostedConfigAborted(hosted.signal);
            const config = deepFreezeHostedConfig(
              createFreshDefaults() as VeryfrontConfig,
            );
            return createConfigLoadResult(config, defaultConfigProvenance());
          } finally {
            sourceReadLease.release();
          }
        }

        for (const configFile of VERYFRONT_CONFIG_FILES) {
          const configPath = join(configBaseDir, configFile);
          let trustedVirtualContent: string | Uint8Array | undefined;
          if (isVirtualFS) {
            try {
              trustedVirtualContent = await adapter.fs.readFile(configPath);
            } catch (error) {
              if (isNotFoundError(error)) {
                logger.debug("Trusted virtual config candidate not found", {
                  configPath,
                });
                continue;
              }
              throw error;
            }
          } else {
            const exists = await adapter.fs.exists(configPath);
            logger.debug("Checking config file", { configPath, exists, isVirtualFS });
            if (!exists) continue;
          }

          try {
            const loaded = await loadAndMergeConfig(
              configPath,
              effectiveCacheKey,
              adapter,
              revisionAtStart,
              trustedVirtualContent,
            );
            const merged = loaded.config;
            const provenance = configFileProvenance(configFile);
            if (
              loaded.bunTrackingPublication !== undefined &&
              cacheRevision !== revisionAtStart
            ) {
              loaded.bunTrackingPublication.discard();
              return await getConfigInternal(projectDir, adapter, options);
            }
            if (usePersistentCache && cacheRevision === revisionAtStart) {
              setConfigCacheEntry(effectiveCacheKey, {
                revision: revisionAtStart,
                config: merged,
                provenance,
                bunTrackingKey: loaded.bunTrackingPublication?.key,
              });
              // Publish only after the config LRU owns this graph. Otherwise
              // more than one capacity of concurrently completing loads can
              // evict a graph in the await gap before its cache entry exists.
              loaded.bunTrackingPublication?.publish();
            } else {
              loaded.bunTrackingPublication?.discard();
            }
            logger.debug("Successfully loaded config", {
              configFile,
              hasApp: !!merged.app,
              hasLayout: !!(merged as Record<string, unknown>).layout,
              configKeys: Object.keys(merged),
            });
            return createConfigLoadResult(merged, provenance);
          } catch (error) {
            if (error === BUN_PROJECT_CONFIG_LOAD_INVALIDATED) {
              return await getConfigInternal(projectDir, adapter, options);
            }
            if (isPreservedConfigLoadError(error)) throw error;
            logger.warn("Failed to load config file", { configFile });
            throw configLoadFailure(configFile, error);
          }
        }

        logger.debug("No config file found, using defaults", {
          effectiveCacheKey,
          projectDir,
          isVirtualFS,
          duration: `${(performance.now() - getConfigStartTime).toFixed(2)}ms`,
        });

        const config = createFreshDefaults() as VeryfrontConfig;
        const provenance = defaultConfigProvenance();
        if (usePersistentCache && cacheRevision === revisionAtStart) {
          setConfigCacheEntry(effectiveCacheKey, {
            revision: revisionAtStart,
            config,
            provenance,
          });
        }
        return createConfigLoadResult(config, provenance);
      };

      if (hosted) return await loadUncached();
      return await getOrCreateTrustedConfigFlight(
        trustedConfigIdentity,
        revisionAtStart,
        loadUncached,
      );
    },
    { "config.project_dir": projectDir, "config.cache_key": options?.cacheKey || "default" },
  );
}

export function getConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: GetConfigOptions,
): Promise<VeryfrontConfig> {
  return thenPromise(
    getConfigInternal(projectDir, adapter, options),
    (result) => result.config,
  );
}

/**
 * Load trusted configuration together with the explicit source outcome.
 *
 * This is an internal composition boundary for callers that must distinguish
 * an absent config file from a present file whose values happen to match the
 * framework defaults.
 *
 * @internal
 */
export function getConfigWithProvenance(
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: GetConfigOptions,
): Promise<ConfigLoadResult> {
  return getConfigInternal(projectDir, adapter, options);
}

/**
 * Load an untrusted hosted project config through the bounded declarative
 * evaluator. Server composition code must prepare the environment context
 * from authenticated tenant data before calling this function.
 *
 * @internal
 */
export function getHostedConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
  options: HostedConfigOptions,
): Promise<VeryfrontConfig> {
  return thenPromise(
    getConfigInternal(projectDir, adapter, {
      cacheKey: options.cacheKey,
      sourceContext: options.sourceContext,
      hosted: {
        preparedContext: options.preparedContext,
        signal: options.signal,
        validationBoundary: options.validationBoundary,
      },
    }),
    (result) => result.config,
  );
}

/**
 * Evaluate an already-selected untrusted configuration source through the
 * bounded declarative worker and return the same validated, merged, deeply
 * frozen snapshot used by hosted request configuration.
 *
 * This seam exists for immutable-source jobs (for example release asset
 * builds) whose source bytes are selected outside the runtime filesystem. It
 * never imports or evaluates tenant JavaScript in the host realm.
 *
 * @internal
 */
export async function evaluateHostedConfigSource(
  options: EvaluateHostedConfigSourceOptions,
): Promise<VeryfrontConfig> {
  throwIfHostedConfigAborted(options.signal);
  if (options.source === null) {
    return deepFreezeHostedConfig(validateAndMergeConfig({}));
  }

  try {
    const preparedContext = await prepareDeclarativeConfigContext({
      environmentName: options.environmentName,
      environment: options.environment,
    });
    return await loadHostedConfigFromSource(
      options.source.fileName,
      options.source.fileName,
      options.cacheKey,
      options.source.source,
      preparedContext,
      options.signal,
      true,
      cacheRevision,
    );
  } catch (error) {
    if (error instanceof DeclarativeConfigEvaluationError) {
      throw translateHostedConfigEvaluationError(error, options.source.fileName);
    }
    if (isPreservedConfigLoadError(error)) throw error;
    throw configLoadFailure(options.source.fileName, error);
  }
}

/** @internal Test-only evaluator seam. Passing `undefined` restores production behavior. */
export function __setHostedConfigEvaluatorForTests(
  evaluator?: HostedConfigEvaluator,
): void {
  mapForEach(hostedConfigFlights, (flight) => {
    abortController(flight.controller);
  });
  mapClear(hostedConfigFlights);
  hostedConfigEvaluator = evaluator ?? evaluatePreparedDeclarativeConfigInWorker;
}

/**
 * @internal Test-only seam for the captured Promise observer. This keeps
 * adversarial constructor/species coverage independent of unrelated awaits in
 * tracing and filesystem dependencies.
 */
export function __observePromiseForTests<T>(promise: Promise<T>): Promise<T> {
  return thenPromise(promise, (value) => value);
}

/**
 * @internal Test-only aggregate source-read admission state. Active reads
 * remain counted after their final waiter aborts until the adapter settles.
 */
export function __getHostedConfigSourceReadStateForTests(): Readonly<{
  active: number;
  queued: number;
  flights: number;
  waiters: number;
  maxActive: number;
  maxQueued: number;
}> {
  let waiters = 0;
  mapForEach(hostedConfigSourceReadFlights, (flight) => {
    waiters += flight.waiterCount;
  });
  return freezeObject({
    active: activeHostedConfigSourceReads,
    queued: queuedHostedConfigSourceReads,
    flights: mapSize(hostedConfigSourceReadFlights),
    waiters,
    maxActive: MAX_ACTIVE_HOSTED_CONFIG_SOURCE_READS,
    maxQueued: MAX_QUEUED_HOSTED_CONFIG_SOURCE_READS,
  });
}

/** @internal Test-only aggregate state; does not expose project or source identities. */
export function __getHostedConfigFlightStateForTests(): Readonly<{
  flights: number;
  waiters: number;
}> {
  let waiters = 0;
  mapForEach(hostedConfigFlights, (flight) => {
    waiters += flight.waiterCount;
  });
  return freezeObject({
    flights: mapSize(hostedConfigFlights),
    waiters,
  });
}

/** @internal Test-only aggregate state; does not expose config identities. */
export function __getTrustedConfigFlightStateForTests(): Readonly<{
  flights: number;
  maxFlights: number;
}> {
  return freezeObject({
    flights: mapSize(trustedConfigFlights),
    maxFlights: MAX_TRUSTED_CONFIG_FLIGHTS,
  });
}

export function clearConfigCache(): void {
  configCacheByProject.clear();
  mapClear(bunProjectConfigTrackingOwnerCounts);
  hostedConfigFailureCacheByProject.clear();
  clearBunProjectConfigModuleTracking();
  cacheRevision++;
}

/**
 * Synchronous config cache lookup for hot paths.
 *
 * Returns cached config immediately without async overhead.
 * Use this for performance-critical paths when config is likely cached.
 *
 * @returns Cached config if valid, null if not cached or stale
 */
export function getCachedConfigSync(projectDir: string): VeryfrontConfig | null {
  const cached = configCacheByProject.get(buildConfigCacheKey(projectDir, false));
  if (!cached || cached.revision !== cacheRevision) return null;
  touchBunProjectConfigModuleTracking(projectDir, cached.provenance, cached.bunTrackingKey);
  return cached.config;
}
