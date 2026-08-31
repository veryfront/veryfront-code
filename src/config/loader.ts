import type { VeryfrontConfig } from "./schemas/index.ts";
import { validateVeryfrontConfig } from "./schemas/index.ts";
import {
  basename,
  dirname,
  extname,
  fromFileUrl,
  isAbsolute,
  join,
  relative,
  resolve,
  toFileUrl,
} from "#veryfront/compat/path/index.ts";
import { runtimeUsesWindowsPaths } from "#veryfront/platform/compat/path/portable.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isPathContainedBy } from "#veryfront/platform/adapters/path-containment.ts";
import {
  isExtendedFSAdapter,
  isVirtualFilesystem,
} from "#veryfront/platform/adapters/fs/wrapper.ts";
import { isBun, isDenoCompiled, isNode } from "#veryfront/platform/compat/runtime.ts";
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
import type { BundleOptions, BundleResult } from "#veryfront/extensions/bundler/bundler.ts";
import type { ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";
import type { ASTNode } from "#veryfront/extensions/parser/index.ts";
import { tryResolve as tryResolveContract } from "#veryfront/extensions/contracts.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import { parseBarePackageSpecifier } from "#veryfront/transforms/shared/package-specifier.ts";
import { NODE_BUILTINS } from "#veryfront/transforms/import-rewriter/node-builtins.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { VERYFRONT_CONFIG_SHIM_SOURCE, VERYFRONT_CONFIG_SHIM_URL } from "./config-shim.ts";
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
import {
  type ImportMetaResolveArgumentRewriter,
  type ImportMetaResolveCallRewriter,
  type ImportMetaResolveReferenceRewriter,
  type ImportMetaSpecifierResolver,
  rewriteImportMetaLocations,
  rewriteUnboundCommonJsDynamicRequire,
  usesUnboundCommonJsModule,
} from "#veryfront/routing/api/module-loader/source-capability-analyzer.ts";

// Capture the collection and reflection intrinsics before trusted executable
// project configuration can mutate the shared host realm. Hosted configuration
// crosses a tenant boundary later in the same process, so its cache identity,
// singleflight state, and immutable result must not depend on ambient methods.
const IntrinsicMap = Map;
const IntrinsicSet = Set;
const ArrayIsArray = Array.isArray;
const IntrinsicPromise = Promise;
const IntrinsicString = String;
const IntrinsicTypeError = TypeError;
const IntrinsicJSON = JSON;
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
const IntrinsicCrypto = crypto;
const CryptoRandomUUID = crypto.randomUUID;
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
const processDescriptor = isNode
  ? ObjectGetOwnPropertyDescriptor(globalThis, "process")
  : undefined;
const processValue = processDescriptor && "value" in processDescriptor
  ? processDescriptor.value
  : processDescriptor && typeof processDescriptor.get === "function"
  ? ReflectApply(processDescriptor.get, globalThis, [])
  : undefined;
const capturedProcess = typeof processValue === "object" && processValue !== null
  ? processValue as Record<PropertyKey, unknown>
  : undefined;
const execArgvDescriptor = capturedProcess
  ? ObjectGetOwnPropertyDescriptor(capturedProcess, "execArgv")
  : undefined;
const CapturedNodeExecArgv: readonly string[] = (() => {
  const value = execArgvDescriptor && "value" in execArgvDescriptor
    ? execArgvDescriptor.value
    : undefined;
  if (!ArrayIsArray(value)) return [];
  const copy: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const argument = value[index];
    if (typeof argument === "string") copy[copy.length] = argument;
  }
  return ReflectApply(ObjectFreeze, Object, [copy]) as readonly string[];
})();
const featuresDescriptor = capturedProcess
  ? ObjectGetOwnPropertyDescriptor(capturedProcess, "features")
  : undefined;
const featuresValue = featuresDescriptor && "value" in featuresDescriptor
  ? featuresDescriptor.value
  : featuresDescriptor && typeof featuresDescriptor.get === "function"
  ? ReflectApply(featuresDescriptor.get, capturedProcess, [])
  : undefined;
const requireModuleDescriptor = typeof featuresValue === "object" && featuresValue !== null
  ? ObjectGetOwnPropertyDescriptor(featuresValue, "require_module")
  : undefined;
const CapturedNodeRequireModule = requireModuleDescriptor && "value" in requireModuleDescriptor
  ? requireModuleDescriptor.value === true
  : requireModuleDescriptor && typeof requireModuleDescriptor.get === "function"
  ? ReflectApply(requireModuleDescriptor.get, featuresValue, []) === true
  : false;
const CapturedNodeOptions = isNode ? getHostEnv("NODE_OPTIONS") : undefined;
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
const CONFIG_BUNDLE_RESOLVE_PLUGIN_DATA = ObjectFreeze({});
const CONFIG_BUNDLE_ENTRY_NAMESPACE = "veryfront-config-entry";
const CONFIG_BUNDLE_ENTRY_SPECIFIER = "veryfront:project-config-entry";
const CONFIG_BUNDLE_SHIM_NAMESPACE = "veryfront-config-shim";
const CONFIG_BUNDLE_REQUIRE_NAMESPACE = "veryfront-config-require";

type RuntimeReflectionRecord = Record<PropertyKey, unknown>;

function isNodeBuiltinPackageName(specifier: string): boolean {
  return ReflectApply(SetPrototypeHas, NODE_BUILTIN_PACKAGE_NAMES, [specifier]) as boolean;
}

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

/**
 * Warn when an evaluated hosted snapshot carries extension declarations.
 *
 * The evaluator accepts a first-party declaration as an inert `{ name }`
 * marker (veryfront-issue-inbox#688); the hosted runtime provides the
 * capability itself and never activates the extension. Emitted here, on a
 * fresh evaluation only, because per-project hosted configs never reach
 * extension orchestration -- this is the one hosted-path boundary that sees
 * every accepted declaration.
 */
function warnIgnoredExtensionDeclarations(
  snapshot: Record<string, unknown>,
  configFile: string,
): void {
  const extensions = snapshot.extensions;
  if (!ArrayIsArray(extensions)) return;
  // Indexed iteration and index assignment: an executable self-hosted config
  // shares this realm and can poison Array.prototype hooks before a hosted
  // tenant evaluation reaches this path.
  const declared: string[] = [];
  for (let index = 0; index < extensions.length; index++) { // NOSONAR: array traversal must stay index-based under poisoned primordials.
    const entry: unknown = extensions[index];
    if (
      typeof entry === "object" && entry !== null &&
      ownKeys(entry).length === 1 &&
      typeof (entry as { name?: unknown }).name === "string"
    ) {
      declared[declared.length] = (entry as { name: string }).name;
    }
  }
  if (declared.length === 0) return;
  logger.warn(
    "Extension declarations are ignored on the hosted runtime; the platform provides the capability itself",
    { configFile, extensions: declared },
  );
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
    warnIgnoredExtensionDeclarations(snapshot, payload.evaluationOptions.fileName);
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
// Strip complete CSI sequences before matching paths and URLs.
// deno-lint-ignore no-control-regex
const ANSI_CSI_SEQUENCE = /(?:\u001B\[|\u009B)[\u0030-\u003F]*[\u0020-\u002F]*[\u0040-\u007E]/g;
const CSI_SPLITTABLE_URL_SCHEMES = freezeObject([
  "http",
  "https",
  "ws",
  "wss",
  "ftp",
  "file",
]) as readonly string[];

interface CsiSchemeMatch {
  matched: string;
  inputIndex: number;
  inputEnd: number;
}

type CsiSchemeStates = Array<Array<readonly number[] | undefined>>;

interface CsiGenericSchemePath {
  matches: readonly number[];
  startIndex: number;
}

type CsiGenericSchemeStates = Array<CsiGenericSchemePath | undefined>;

interface CsiRestorationStates {
  special: CsiSchemeStates;
  generic: CsiGenericSchemeStates;
}

type CsiUrlPayloadKind = "generic" | "special" | "none";

const MAX_GENERIC_URL_SCHEME_LENGTH = 32;
const MAX_CSI_LITERAL_GAP = MAX_GENERIC_URL_SCHEME_LENGTH * 2;
const GENERIC_URL_SCHEME_FIRST_CHARACTER = /[A-Za-z]/;
const GENERIC_URL_SCHEME_CHARACTER = /[A-Za-z0-9+.-]/;
const CSI_URL_PAYLOAD_CHARACTER = /[^\s"'\\]/u;

function appendCsiSchemeMatch(path: readonly number[], matchIndex: number): readonly number[] {
  const appended: number[] = [];
  for (let index = 0; index < path.length; index++) {
    defineOwnArrayElement(appended, index, path[index]!);
  }
  defineOwnArrayElement(appended, path.length, matchIndex);
  return appended;
}

function defineOwnArrayElement<T>(target: T[], index: number, value: T): void {
  const descriptor = createNullPrototypeDescriptor();
  descriptor.value = value;
  descriptor.writable = true;
  descriptor.enumerable = true;
  descriptor.configurable = true;
  ReflectApply(ObjectDefineProperty, Object, [target, index, descriptor]);
}

function keepShorterCsiSchemePath(
  current: readonly number[] | undefined,
  candidate: readonly number[],
): readonly number[] {
  return current === undefined || candidate.length < current.length ? candidate : current;
}

function appendGenericCsiSchemeMatch(
  path: CsiGenericSchemePath,
  matchIndex: number,
): CsiGenericSchemePath {
  return {
    matches: appendCsiSchemeMatch(path.matches, matchIndex),
    startIndex: path.startIndex,
  };
}

function keepPreferredGenericCsiPath(
  current: CsiGenericSchemePath | undefined,
  candidate: CsiGenericSchemePath,
): CsiGenericSchemePath {
  if (current === undefined || candidate.startIndex < current.startIndex) return candidate;
  if (
    candidate.startIndex === current.startIndex &&
    candidate.matches.length < current.matches.length
  ) {
    return candidate;
  }
  return current;
}

function createDenseCsiPathStates(length: number): Array<readonly number[] | undefined> {
  const states: Array<readonly number[] | undefined> = [];
  for (let index = 0; index <= length; index++) {
    defineOwnArrayElement(states, index, undefined);
  }
  return states;
}

function createDenseGenericCsiStates(): CsiGenericSchemeStates {
  const states: CsiGenericSchemeStates = [];
  for (let index = 0; index <= MAX_GENERIC_URL_SCHEME_LENGTH; index++) {
    defineOwnArrayElement(states, index, undefined);
  }
  return states;
}

function createCsiSchemeStates(): CsiSchemeStates {
  const states: CsiSchemeStates = [];
  for (let index = 0; index < CSI_SPLITTABLE_URL_SCHEMES.length; index++) {
    defineOwnArrayElement(
      states,
      index,
      createDenseCsiPathStates(CSI_SPLITTABLE_URL_SCHEMES[index]!.length),
    );
  }
  return states;
}

function createCsiRestorationStates(): CsiRestorationStates {
  return {
    special: createCsiSchemeStates(),
    generic: createDenseGenericCsiStates(),
  };
}

function chooseCompletedSpecialCsiPath(states: CsiSchemeStates): readonly number[] | undefined {
  let selected: readonly number[] | undefined;
  for (let schemeIndex = 0; schemeIndex < CSI_SPLITTABLE_URL_SCHEMES.length; schemeIndex++) {
    const scheme = CSI_SPLITTABLE_URL_SCHEMES[schemeIndex]!;
    const path = states[schemeIndex]![scheme.length];
    if (path !== undefined) selected = keepShorterCsiSchemePath(selected, path);
  }
  return selected;
}

function chooseCompletedGenericCsiPath(
  states: CsiGenericSchemeStates,
): CsiGenericSchemePath | undefined {
  let selected: CsiGenericSchemePath | undefined;
  for (let length = 2; length <= MAX_GENERIC_URL_SCHEME_LENGTH; length++) {
    const path = states[length];
    if (path !== undefined) selected = keepPreferredGenericCsiPath(selected, path);
  }
  return selected;
}

function markCsiSchemePath(path: readonly number[] | undefined, restoreMatches: Set<number>): void {
  if (path === undefined) return;
  for (let pathIndex = 0; pathIndex < path.length; pathIndex++) { // NOSONAR: Avoid mutable iterator hooks.
    setAdd(restoreMatches, path[pathIndex]!);
  }
}

function hasCsiUrlPayloadCharacter(value: string, index: number): boolean {
  const character = stringSlice(value, index, index + 1);
  return character !== "" &&
    ReflectApply(RegExpPrototypeExec, CSI_URL_PAYLOAD_CHARACTER, [character]) !== null;
}

function classifyCsiUrlPayload(value: string, colonIndex: number): CsiUrlPayloadKind {
  if (stringSlice(value, colonIndex + 1, colonIndex + 2) !== "/") {
    return hasCsiUrlPayloadCharacter(value, colonIndex + 1) ? "special" : "none";
  }
  if (stringSlice(value, colonIndex + 2, colonIndex + 3) !== "/") {
    return hasCsiUrlPayloadCharacter(value, colonIndex + 2) ? "special" : "none";
  }
  return hasCsiUrlPayloadCharacter(value, colonIndex + 3) ? "generic" : "none";
}

function advanceGenericCsiLiteral(
  current: CsiGenericSchemeStates,
  value: string,
  inputIndex: number,
): CsiGenericSchemeStates {
  const advanced = createDenseGenericCsiStates();
  const isSchemeCharacter = ReflectApply(
    RegExpPrototypeExec,
    GENERIC_URL_SCHEME_CHARACTER,
    [value],
  ) !== null;
  if (isSchemeCharacter) {
    for (let length = 1; length < MAX_GENERIC_URL_SCHEME_LENGTH; length++) {
      const path = current[length];
      if (path !== undefined) {
        advanced[length + 1] = keepPreferredGenericCsiPath(advanced[length + 1], path);
      }
    }
  }
  if (ReflectApply(RegExpPrototypeExec, GENERIC_URL_SCHEME_FIRST_CHARACTER, [value]) !== null) {
    advanced[1] = keepPreferredGenericCsiPath(advanced[1], {
      matches: [],
      startIndex: inputIndex,
    });
  }
  return advanced;
}

function advanceCsiSchemeLiteral(
  states: CsiRestorationStates,
  value: string,
  input: string,
  inputIndex: number,
  restoreMatches: Set<number>,
): CsiRestorationStates {
  if (value === ":") {
    const payload = classifyCsiUrlPayload(input, inputIndex);
    if (payload === "generic") {
      const special = chooseCompletedSpecialCsiPath(states.special);
      const path = special ?? chooseCompletedGenericCsiPath(states.generic)?.matches;
      markCsiSchemePath(path, restoreMatches);
    } else if (payload === "special") {
      markCsiSchemePath(chooseCompletedSpecialCsiPath(states.special), restoreMatches);
    }
    return createCsiRestorationStates();
  }

  const next = createCsiSchemeStates();
  for (let schemeIndex = 0; schemeIndex < CSI_SPLITTABLE_URL_SCHEMES.length; schemeIndex++) {
    const scheme = CSI_SPLITTABLE_URL_SCHEMES[schemeIndex]!;
    const current = states.special[schemeIndex]!;
    const advanced = next[schemeIndex]!;
    for (let characterIndex = 1; characterIndex < scheme.length; characterIndex++) {
      const path = current[characterIndex];
      if (
        path !== undefined &&
        stringSlice(scheme, characterIndex, characterIndex + 1) === value
      ) {
        advanced[characterIndex + 1] = keepShorterCsiSchemePath(
          advanced[characterIndex + 1],
          path,
        );
      }
    }
    if (stringSlice(scheme, 0, 1) === value) {
      advanced[1] = keepShorterCsiSchemePath(advanced[1], []);
    }
  }
  return {
    special: next,
    generic: advanceGenericCsiLiteral(states.generic, value, inputIndex),
  };
}

function advanceSpecialCsiSequence(
  states: CsiSchemeStates,
  value: string,
  matchIndex: number,
): CsiSchemeStates {
  const next = createCsiSchemeStates();
  for (let schemeIndex = 0; schemeIndex < CSI_SPLITTABLE_URL_SCHEMES.length; schemeIndex++) {
    const scheme = CSI_SPLITTABLE_URL_SCHEMES[schemeIndex]!;
    const current = states[schemeIndex]!;
    const advanced = next[schemeIndex]!;
    for (let characterIndex = 1; characterIndex <= scheme.length; characterIndex++) {
      const path = current[characterIndex];
      if (path === undefined) continue;
      advanced[characterIndex] = keepShorterCsiSchemePath(advanced[characterIndex], path);
      if (
        characterIndex < scheme.length &&
        stringSlice(scheme, characterIndex, characterIndex + 1) === value
      ) {
        const restored = appendCsiSchemeMatch(path, matchIndex);
        advanced[characterIndex + 1] = keepShorterCsiSchemePath(
          advanced[characterIndex + 1],
          restored,
        );
      }
    }
    if (stringSlice(scheme, 0, 1) === value) {
      advanced[1] = keepShorterCsiSchemePath(advanced[1], [matchIndex]);
    }
  }
  return next;
}

function advanceCsiSchemeSequence(
  states: CsiRestorationStates,
  value: string,
  matchIndex: number,
  inputIndex: number,
): CsiRestorationStates {
  const special = advanceSpecialCsiSequence(states.special, value, matchIndex);
  const generic = createDenseGenericCsiStates();
  const isSchemeCharacter = ReflectApply(
    RegExpPrototypeExec,
    GENERIC_URL_SCHEME_CHARACTER,
    [value],
  ) !== null;
  for (let length = 1; length <= MAX_GENERIC_URL_SCHEME_LENGTH; length++) {
    const path = states.generic[length];
    if (path === undefined) continue;
    generic[length] = keepPreferredGenericCsiPath(generic[length], path);
    if (isSchemeCharacter && length < MAX_GENERIC_URL_SCHEME_LENGTH) {
      const restored = appendGenericCsiSchemeMatch(path, matchIndex);
      generic[length + 1] = keepPreferredGenericCsiPath(generic[length + 1], restored);
    }
  }
  if (ReflectApply(RegExpPrototypeExec, GENERIC_URL_SCHEME_FIRST_CHARACTER, [value]) !== null) {
    generic[1] = keepPreferredGenericCsiPath(generic[1], {
      matches: [matchIndex],
      startIndex: inputIndex,
    });
  }
  return { special, generic };
}

function advanceCsiLiteralRange(
  states: CsiRestorationStates,
  value: string,
  startIndex: number,
  endIndex: number,
  restoreMatches: Set<number>,
): CsiRestorationStates {
  for (let index = startIndex; index < endIndex; index++) {
    const literal = ReflectApply(
      StringPrototypeToLowerCase,
      stringSlice(value, index, index + 1),
      [],
    ) as string;
    states = advanceCsiSchemeLiteral(states, literal, value, index, restoreMatches);
  }
  return states;
}

/**
 * Restore a URL-scheme character consumed as a CSI final byte.
 *
 * In `h<ESC>[ttps:host/path`, `t` is both a legal CSI final byte and the
 * second character of `https`. Ordinary de-colorization therefore leaves the
 * unrecognized token `htps:host/path`. Restore the final byte only when the
 * bounded text immediately before and after the sequence completes a scheme
 * the URL redactor already recognizes. The normal redaction pass then removes
 * the whole URL.
 *
 * Keep the CSI grammar unchanged. Restricting its final byte would leave real
 * sequences behind, while matching arbitrary damaged schemes would erase
 * ordinary colon-delimited prose.
 */
function restoreCsiSplitUrlSchemes(value: string): string {
  ANSI_CSI_SEQUENCE.lastIndex = 0;
  try {
    let match = ReflectApply(RegExpPrototypeExec, ANSI_CSI_SEQUENCE, [value]) as
      | RegExpExecArray
      | null;
    if (match === null) return value;

    const matches: CsiSchemeMatch[] = [];
    const restoreMatches = new IntrinsicSet<number>();
    let states = createCsiRestorationStates();
    let inputOffset = 0;
    while (match !== null) {
      const matched = match[0];
      const gapLength = match.index - inputOffset;
      if (gapLength > MAX_CSI_LITERAL_GAP) {
        if (matches.length > 0) {
          states = advanceCsiLiteralRange(
            states,
            value,
            inputOffset,
            inputOffset + MAX_GENERIC_URL_SCHEME_LENGTH,
            restoreMatches,
          );
        }
        states = createCsiRestorationStates();
        states = advanceCsiLiteralRange(
          states,
          value,
          match.index - MAX_GENERIC_URL_SCHEME_LENGTH,
          match.index,
          restoreMatches,
        );
      } else {
        states = advanceCsiLiteralRange(
          states,
          value,
          inputOffset,
          match.index,
          restoreMatches,
        );
      }
      const finalByte = ReflectApply(
        StringPrototypeToLowerCase,
        stringSlice(matched, -1),
        [],
      ) as string;
      const matchIndex = matches.length;
      defineOwnArrayElement(matches, matchIndex, {
        matched,
        inputIndex: match.index,
        inputEnd: ANSI_CSI_SEQUENCE.lastIndex,
      });
      states = advanceCsiSchemeSequence(states, finalByte, matchIndex, match.index);
      inputOffset = ANSI_CSI_SEQUENCE.lastIndex;
      match = ReflectApply(RegExpPrototypeExec, ANSI_CSI_SEQUENCE, [value]) as
        | RegExpExecArray
        | null;
    }

    const tailWindowEnd = inputOffset + MAX_GENERIC_URL_SCHEME_LENGTH < value.length
      ? inputOffset + MAX_GENERIC_URL_SCHEME_LENGTH
      : value.length;
    advanceCsiLiteralRange(states, value, inputOffset, tailWindowEnd, restoreMatches);

    let output = "";
    let outputOffset = 0;
    for (let matchIndex = 0; matchIndex < matches.length; matchIndex++) {
      const match = matches[matchIndex]!;
      output += stringSlice(value, outputOffset, match.inputIndex);
      output += setHas(restoreMatches, matchIndex) ? stringSlice(match.matched, -1) : match.matched;
      outputOffset = match.inputEnd;
    }
    return output + stringSlice(value, outputOffset);
  } finally {
    ANSI_CSI_SEQUENCE.lastIndex = 0;
  }
}
// Remove a CSI prefix separately when its grammar could consume the first path
// byte. Preserve `/`, both UNC separators, and drive-letter starts for redaction.
const CSI_GLUED_PATH =
  // deno-lint-ignore no-control-regex
  /(?:\u001B\[|\u009B)[\u0030-\u003F]*[\u0020-\u002E]*[\u0040-\u007E]?(?=\\\\|\/|[A-Za-z]:[\\/])/g;
// Do the same for recognized schemes whose first letter is a CSI final byte.
// Keep this list aligned with the special-scheme and file-URL redactors.
const CSI_GLUED_URL =
  // deno-lint-ignore no-control-regex
  /(?:\u001B\[|\u009B)[\u0030-\u003F]*[\u0020-\u002E]*[\u0040-\u007E]?(?=(?:https?|wss?|ftp|file):)/gi;
// URI tails stay ASCII so glued Unicode prose remains visible. The parenthesis
// branches consume URL payloads without swallowing terminal prose punctuation;
// bounded interiors and punctuation lookahead keep failed scans linear.
// Apostrophes terminate the tail but remain valid in the userinfo prefix.
const URI_TOKEN_CHARACTER_SOURCE = String.raw`[A-Za-z0-9\-._~:/?#\[\]@!$&*+,;=%]`;
const URI_PAREN_INTERIOR_SOURCE = String.raw`[A-Za-z0-9\-._~:/?#\[\]@!$&()*+,;=%]`;
const URL_BALANCED_PAREN_SEGMENT_SOURCE = String.raw`\([^\s"']{0,512}\)`;
const URL_TOKEN_TAIL_SOURCE = String
  .raw`(?:${URI_TOKEN_CHARACTER_SOURCE}|${URL_BALANCED_PAREN_SEGMENT_SOURCE}|\((?=(?:${URI_PAREN_INTERIOR_SOURCE}|\P{ASCII}))|\)(?=${URI_PAREN_INTERIOR_SOURCE})(?![\p{P}\p{S}\p{M}\p{Cf}]{0,16}(?:[\s"']|$)))+`;
// Require a bounded, multi-character scheme so drive-letter paths remain paths.
const SCHEME_URL = new RegExp(
  String.raw`[A-Za-z][A-Za-z0-9+.-]{1,31}://(?:[^\s"/]{0,512}@)?${URL_TOKEN_TAIL_SOURCE}`,
  "gu",
);
// Redact raw IRI authorities after file URLs. Structured authorities fail closed;
// bare authorities retain terminal punctuation. Bounded probes keep scans linear.
// Keep the optional tail grouped: a direct `?` would make its final `+` lazy.
const NON_ASCII_HOST_CHARACTER_SOURCE = String
  .raw`[\p{L}\p{N}\p{M}\p{S}\p{Co}\p{Cs}\p{Cn}\u200D\u{E0020}-\u{E007E}.\-_$!&*+,;=%~]`;
const NON_ASCII_HOST_PUNCTUATION_SOURCE = String
  .raw`(?![\x00-\x7F\u200D\u{E0020}-\u{E007E}])[\p{P}\p{Cf}]`;
const NON_ASCII_HOST_PUNCTUATION_RUN_SOURCE = String
  .raw`(?:${NON_ASCII_HOST_PUNCTUATION_SOURCE}){1,16}(?![\p{P}\p{Cf}]{0,16}(?:[\s"']|$))`;
const NON_ASCII_STRICT_HOST_SOURCE =
  `(?:${NON_ASCII_HOST_CHARACTER_SOURCE}|${NON_ASCII_HOST_PUNCTUATION_RUN_SOURCE})+`;
const NON_ASCII_STRUCTURED_HOST_SOURCE = String.raw`[^\s"'\\/:?#@]+(?=[:/?#\\])`;
const NON_ASCII_HOST_BODY_SOURCE =
  `(?:${NON_ASCII_STRUCTURED_HOST_SOURCE}|${NON_ASCII_STRICT_HOST_SOURCE})`;
const NON_ASCII_HOST_SOURCE = String
  .raw`(?:(?=[^\s"/]{0,511}[\u0080-\u{10FFFF}])${NON_ASCII_HOST_BODY_SOURCE}|(?=[^\s"/]{513})${NON_ASCII_HOST_BODY_SOURCE})`;
// Keep glued punctuation in the candidate so validation can distinguish opaque
// host data from prose. Special schemes, including file, remain fail-closed.
const NON_ASCII_AUTHORITY_URL = new RegExp(
  String
    .raw`[A-Za-z][A-Za-z0-9+.-]{1,31}://(?:[^\s"/]{0,512}@)?${NON_ASCII_HOST_SOURCE}(?:${URL_TOKEN_TAIL_SOURCE})?`,
  "gu",
);
// At a slash boundary raw Unicode is IRI path data. The boundary leaves Unicode
// prose glued to a completed ASCII segment visible.
const NON_ASCII_URL_PATH = new RegExp(
  String
    .raw`[A-Za-z][A-Za-z0-9+.-]{1,31}://(?:[^\s"/]{0,512}@)?[^\s"/]{1,512}(?:/${URI_TOKEN_CHARACTER_SOURCE}{0,2048})?/(?=[^\x00-\x7F])[^\s"']*`,
  "gu",
);
// Avoid a second generic scheme scan for ordinary ASCII diagnostics.
const NON_ASCII_CHARACTER = /[\u0080-\u{10FFFF}]/u;
// After a component delimiter, raw Unicode is IRI path, query, or fragment data.
const RAW_IRI_REMAINDER = /\P{ASCII}[^\s"']*/uy;
// WHATWG accepts these raw path characters. Require a later slash or payload so
// a delimiter-only `>` in `<https://host/x>` remains visible.
const RAW_ACCEPTED_URL_REMAINDER = /[\\<>{}\x60^|][^\s"']*/uy;
const RAW_ACCEPTED_URL_PAYLOAD = /[\p{L}\p{N}\p{M}]/u;
const NON_ASCII_URL_HOST_BOUNDARY =
  /(?=\P{ASCII})(?!(?:\u200C|\u200D|[\u{E0020}-\u{E007E}]))[\p{P}\p{S}\p{Cf}]/uy;
const MAX_URL_HOST_BOUNDARY_ATTEMPTS = 16;

// Userinfo and parenthesized segments are bounded to keep failed scans linear.
// Userinfo stops at `/` but permits RFC sub-delimiters and parentheses before
// `@`; the URL tail still stops at quotes.
// Restrict malformed forms to WHATWG special schemes so drive-path prose is not
// claimed as a URL.
const ASCII_SPECIAL_SCHEME_SOURCE = "(?:[hH][tT][tT][pP][sS]?|[wW][sS][sS]?|[fF][tT][pP])";
const MALFORMED_SCHEME_URL = new RegExp(
  String.raw`${ASCII_SPECIAL_SCHEME_SOURCE}:/(?!/)(?:[^\s"/]{0,512}@)?${URL_TOKEN_TAIL_SOURCE}`,
  "gu",
);
// Spell ASCII casing explicitly: Unicode case folding maps `ſ` to `s`.
const ZERO_SLASH_SCHEME_URL = new RegExp(
  String.raw`${ASCII_SPECIAL_SCHEME_SOURCE}:(?![/\s])(?:[^\s"/]{0,512}@)?${URL_TOKEN_TAIL_SOURCE}`,
  "gu",
);
// Mirror the single-slash and zero-slash forms for raw IRI hosts and paths.
const NON_ASCII_MALFORMED_AUTHORITY_URL = new RegExp(
  String
    .raw`${ASCII_SPECIAL_SCHEME_SOURCE}:/(?!/)(?:[^\s"/]{0,512}@)?${NON_ASCII_HOST_SOURCE}(?:${URL_TOKEN_TAIL_SOURCE})?`,
  "gu",
);
const NON_ASCII_MALFORMED_URL_PATH = new RegExp(
  String
    .raw`${ASCII_SPECIAL_SCHEME_SOURCE}:/(?!/)(?:[^\s"/]{0,512}@)?[^\s"/]{1,512}(?:/${URI_TOKEN_CHARACTER_SOURCE}{0,2048})?/(?=[^\x00-\x7F])[^\s"']*`,
  "gu",
);
const NON_ASCII_ZERO_SLASH_AUTHORITY_URL = new RegExp(
  String
    .raw`${ASCII_SPECIAL_SCHEME_SOURCE}:(?![/\s])(?:[^\s"/]{0,512}@)?${NON_ASCII_HOST_SOURCE}(?:${URL_TOKEN_TAIL_SOURCE})?`,
  "gu",
);
const NON_ASCII_ZERO_SLASH_URL_PATH = new RegExp(
  String
    .raw`${ASCII_SPECIAL_SCHEME_SOURCE}:(?![/\s])(?:[^\s"/]{0,512}@)?[^\s"/]{1,512}(?:/${URI_TOKEN_CHARACTER_SOURCE}{0,2048})?/(?=[^\x00-\x7F])[^\s"']*`,
  "gu",
);
const QUOTED_WINDOWS_ABSOLUTE_PATH = /(?<=["'])(?:[A-Za-z]:[\\/]|\\\\)[^"'\r\n]+(?=["'])/g;
const QUOTED_POSIX_ABSOLUTE_PATH = /(?<=["'])\/[^"'\r\n]+(?=["'])/g;
// Match case-insensitively so uppercase file URLs remain paths, not remote URLs.
const FILE_URL_ABSOLUTE_PATH = new RegExp(
  `file:///${URL_TOKEN_TAIL_SOURCE}`,
  "giu",
);
// Run before the ASCII file-URL matcher so an IRI segment is redacted whole.
const NON_ASCII_FILE_URL_PATH = new RegExp(
  String.raw`file:///(?:${URI_TOKEN_CHARACTER_SOURCE}{0,2048}/)?(?=[^\x00-\x7F])[^\s"']*`,
  "giu",
);
// Stay unanchored so paths glued to preceding diagnostic text are still removed.
const WINDOWS_ABSOLUTE_PATH = /(?:[A-Za-z]:[\\/]|\\\\)[^\s"'()]+/g;
const POSIX_ABSOLUTE_PATH = /(?<![A-Za-z0-9:/.\\])\/[^\s"'()]+/g;

function stickyMatchEnd(pattern: RegExp, value: string, offset: number): number {
  pattern.lastIndex = offset;
  try {
    const remainder = ReflectApply(RegExpPrototypeExec, pattern, [value]) as
      | RegExpExecArray
      | null;
    return remainder === null ? offset : pattern.lastIndex;
  } finally {
    pattern.lastIndex = 0;
  }
}

function rawUrlMatchEnd(value: string, matched: string, offset: number): number {
  const insideQueryOrFragment =
    (ReflectApply(StringPrototypeIncludes, matched, ["?"]) as boolean) ||
    (ReflectApply(StringPrototypeIncludes, matched, ["#"]) as boolean);
  const lastCharacter = ReflectApply(StringPrototypeSlice, matched, [-1]) as string;
  // A lone opening parenthesis admitted by URL_TOKEN_TAIL_SOURCE is a
  // structural path delimiter. Treat it like `/` when raw IRI data follows so
  // an accepted `x(秘密` path cannot strand the Unicode segment.
  const atComponentBoundary = lastCharacter === "/" ||
    lastCharacter === "?" ||
    lastCharacter === "#" ||
    lastCharacter === "&" ||
    lastCharacter === "=" ||
    lastCharacter === "(";
  if (insideQueryOrFragment || atComponentBoundary) {
    const iriEnd = stickyMatchEnd(RAW_IRI_REMAINDER, value, offset);
    if (iriEnd !== offset) return iriEnd;
  }

  const acceptedEnd = stickyMatchEnd(RAW_ACCEPTED_URL_REMAINDER, value, offset);
  if (acceptedEnd === offset) return offset;
  const acceptedRemainder = ReflectApply(StringPrototypeSlice, value, [
    offset,
    acceptedEnd,
  ]) as string;
  const structurallyDelimited = atComponentBoundary || insideQueryOrFragment ||
    (ReflectApply(StringPrototypeIncludes, acceptedRemainder, ["/"]) as boolean) ||
    ReflectApply(RegExpPrototypeExec, RAW_ACCEPTED_URL_PAYLOAD, [acceptedRemainder]) !== null;
  return structurallyDelimited ? acceptedEnd : offset;
}

const URL_BOUNDARY_PROSE_REMAINDER = /^(?:[A-Za-z0-9!(),;-]|(?!\s)\P{ASCII})+$/u;
const URL_BOUNDARY_PROSE_SEPARATOR = /[!(),;]/g;

function acceptedUnicodeHostMatchEnd(matched: string, matchIndex: number): number {
  try {
    new IntrinsicURL(matched);
    return matchIndex + matched.length;
  } catch {
    // A rejected Unicode character can terminate an otherwise valid authority.
    // Work backward over bounded candidates to retain its suffix.
  }

  try {
    let attempts = MAX_URL_HOST_BOUNDARY_ATTEMPTS;
    for (let index = matched.length - 1; index >= 0 && attempts > 0; index--) {
      NON_ASCII_URL_HOST_BOUNDARY.lastIndex = index;
      const character = ReflectApply(RegExpPrototypeExec, NON_ASCII_URL_HOST_BOUNDARY, [matched]) as
        | RegExpExecArray
        | null;
      if (character?.index !== index) continue;
      attempts -= 1;
      // Never reinterpret userinfo as host data by cutting before its `@`.
      const followingAt = ReflectApply(StringPrototypeIndexOf, matched, ["@", index]) as number;
      if (followingAt !== -1) continue;
      const remainder = ReflectApply(StringPrototypeSlice, matched, [index]) as string;
      if (ReflectApply(RegExpPrototypeExec, URL_BOUNDARY_PROSE_REMAINDER, [remainder]) === null) {
        continue;
      }
      const prefix = ReflectApply(StringPrototypeSlice, matched, [0, index]) as string;
      try {
        new IntrinsicURL(prefix);
      } catch {
        continue;
      }
      try {
        new IntrinsicURL(prefix + character[0]);
        continue;
      } catch {
        URL_BOUNDARY_PROSE_SEPARATOR.lastIndex = index + character[0].length;
        const separator = ReflectApply(RegExpPrototypeExec, URL_BOUNDARY_PROSE_SEPARATOR, [
          matched,
        ]) as RegExpExecArray | null;
        if (separator !== null) {
          try {
            new IntrinsicURL(
              ReflectApply(StringPrototypeSlice, matched, [0, separator.index]) as string,
            );
            continue;
          } catch {
            // The rejected character remains invalid in its following label context.
          }
        }
        return matchIndex + index;
      }
    }
    return matchIndex + matched.length;
  } finally {
    NON_ASCII_URL_HOST_BOUNDARY.lastIndex = 0;
    URL_BOUNDARY_PROSE_SEPARATOR.lastIndex = 0;
  }
}

function replaceMatchesWithCapturedExec(
  value: string,
  pattern: RegExp,
  replacement: string,
  extendRawUrl = false,
  validateUnicodeHostBoundary = false,
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
      const acceptedMatchEnd = validateUnicodeHostBoundary
        ? acceptedUnicodeHostMatchEnd(matched, match.index)
        : pattern.lastIndex;
      pattern.lastIndex = acceptedMatchEnd === pattern.lastIndex && extendRawUrl
        ? rawUrlMatchEnd(value, matched, pattern.lastIndex)
        : acceptedMatchEnd;
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
 * Order is narrowest to broadest: quoted paths, file URLs, IRIs and URLs, then
 * Windows and POSIX paths. The caller strips CSI prefixes first so escape bytes
 * cannot hide a path or scheme start.
 */
function redactMachinePaths(value: string): string {
  let redacted = replaceMatchesWithCapturedExec(value, QUOTED_WINDOWS_ABSOLUTE_PATH, "[path]");
  redacted = replaceMatchesWithCapturedExec(redacted, QUOTED_POSIX_ABSOLUTE_PATH, "[path]");
  if (containsNonAscii(redacted)) {
    redacted = replaceMatchesWithCapturedExec(redacted, NON_ASCII_FILE_URL_PATH, "[path]");
  }
  redacted = replaceMatchesWithCapturedExec(redacted, FILE_URL_ABSOLUTE_PATH, "[path]", true);
  if (containsNonAscii(redacted)) {
    redacted = replaceMatchesWithCapturedExec(
      redacted,
      NON_ASCII_AUTHORITY_URL,
      "[url]",
      true,
      true,
    );
    redacted = replaceMatchesWithCapturedExec(redacted, NON_ASCII_URL_PATH, "[url]");
    redacted = replaceMatchesWithCapturedExec(
      redacted,
      NON_ASCII_MALFORMED_AUTHORITY_URL,
      "[url]",
      true,
      true,
    );
    redacted = replaceMatchesWithCapturedExec(redacted, NON_ASCII_MALFORMED_URL_PATH, "[url]");
    redacted = replaceMatchesWithCapturedExec(
      redacted,
      NON_ASCII_ZERO_SLASH_AUTHORITY_URL,
      "[url]",
      true,
      true,
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
 * Return one bounded, redacted line, or `undefined` when the error has no message.
 * Redaction precedes truncation so credentials cannot be split before matching.
 */
function summarizeConfigLoadCause(error: unknown): string | undefined {
  const message = typeof error === "string"
    ? error
    : isIntrinsicError(error)
    ? readOwnDataString(error, "message")
    : undefined;
  if (message === undefined) return undefined;
  // Sanitize on both sides because stripping CSI can join or consume credential bytes.
  const initiallyRedacted = sanitizeUrlCredentials(message);
  const restoredUrlSchemes = restoreCsiSplitUrlSchemes(initiallyRedacted);
  // Replacing a glued CSI introducer with space preserves the path or scheme start
  // without joining it to preceding prose. Machine paths are redacted afterward.
  const unglued = replaceMatchesWithCapturedExec(restoredUrlSchemes, CSI_GLUED_PATH, " ");
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

function configLoadFailureDetail(configFile: string, error: unknown): string {
  const summary = summarizeConfigLoadCause(error);
  return summary === undefined
    ? `Failed to load ${configFile}`
    : `Failed to load ${configFile}: ${summary}`;
}

/**
 * Return an installable package root from a resolution failure.
 * Files, aliases, URI schemes, built-ins, reserved names, and subpaths are not
 * actionable installation targets and return `undefined`.
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

  // Plain specifiers with versions are invalid Node and Bun import syntax.
  if (!hasRuntimePrefix && parsed.version !== null) return undefined;

  // A missing subpath does not prove that the package root is absent.
  if (parsed.subpath !== null) return undefined;
  if (
    !hasRuntimePrefix &&
    isNodeBuiltinPackageName(parsed.packageName)
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

/** Bound wrapped and cyclic cause traversal. */
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

function setAdd<T>(set: Set<T>, value: T): Set<T> {
  return ReflectApply(SetPrototypeAdd, set, [value]) as Set<T>;
}

function setHas<T>(set: Set<T>, value: T): boolean {
  return ReflectApply(SetPrototypeHas, set, [value]) as boolean;
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

/** @internal */
export async function loadConfigFromTempFile(
  source: string,
  configPath: string,
  loadUrl: (tempFile: string) => string,
  rewriteSource: (source: string) => Promise<string> = rewriteBareVeryfrontConfigImports,
  bundleProjectImports = false,
): Promise<unknown> {
  const fs = createFileSystem();
  const originalExt = extname(configPath) || ".mjs";

  // Compiled Deno binaries and the documented Node.js 22.3 minimum can't
  // import TypeScript directly. Convert .ts/.tsx to .mjs at this boundary
  // instead of depending on a runtime's optional native type stripping.
  // Compiled Deno also stages JavaScript away from its project, so bundle the
  // requested project graph before any staged import, regardless of extension.
  const needsTranspile = (isDenoCompiled || isNode) &&
    (originalExt === ".ts" || originalExt === ".tsx");
  const extension = needsTranspile || bundleProjectImports ? ".mjs" : originalExt;
  let processedSource = source;
  if (bundleProjectImports) {
    processedSource = await bundleProjectConfigSourceForImport(source, configPath);
  } else if (needsTranspile) {
    processedSource = await transpileConfigSourceForImport(source, configPath);
  }

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
 * temp-file config modules can load. Static and literal dynamic imports are
 * rewritten; subpaths like
 * `veryfront/head` are left untouched and will fail loudly, which is correct --
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
    if (!specifier || specifier.n !== "veryfront") continue;
    const replacement = specifier.d === -1
      ? VERYFRONT_CONFIG_SHIM_URL
      : ReflectApply(JSONStringify, IntrinsicJSON, [VERYFRONT_CONFIG_SHIM_URL]) as string;
    rewritten = rewritten.slice(0, specifier.s) +
      replacement +
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

const PROJECT_ESM_EXPORT_CONDITIONS: ReadonlySet<string> = (() => {
  const conditions = new IntrinsicSet(["deno", "node", "import"]);
  if (!isNode || CapturedNodeRequireModule) {
    ReflectApply(SetPrototypeAdd, conditions, ["module-sync"]);
  }
  return conditions;
})();

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
      directory: manifest.directory,
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
    directory: manifest.directory,
  };
}

type ProjectPackageImportResolution = Readonly<
  | { kind: "resolved"; specifier: string; directory: string }
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
    if (
      stringIncludes(specifier, "/") &&
      ReflectApply(SetPrototypeHas, NODE_BUILTIN_PACKAGE_NAMES, [specifier]) as boolean
    ) {
      return `node:${specifier}`;
    }
    const esmResolution = await resolveProjectPackageImport(specifier, basePath);
    if (esmResolution?.kind === "resolved") {
      const resolvedUrl = new IntrinsicURL(esmResolution.specifier);
      const resolvedPath = pathFromCapturedFileUrl(resolvedUrl);
      const { lstatSync, realpathSync } = await import("node:fs");
      const packageRoot = realpathSync(esmResolution.directory);
      const boundary = configPackageTargetBoundary(realpathSync, lstatSync, resolvedPath);
      if (!isPathContainedBy(boundary.path, packageRoot)) {
        throw configPackageResolutionError(specifier, "ERR_PACKAGE_PATH_NOT_EXPORTED");
      }
      const containedPath = boundary.targetExists ? boundary.path : resolvedPath;
      const query = stringIndexOf(esmResolution.specifier, "?");
      const fragment = stringIndexOf(esmResolution.specifier, "#");
      const suffixStart = query < 0 ? fragment : fragment < 0 ? query : Math.min(query, fragment);
      const suffix = suffixStart < 0 ? "" : stringSlice(esmResolution.specifier, suffixStart);
      return asResolvedConfigSpecifier(containedPath) + suffix;
    }
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
      ? ReflectApply(JSONStringify, IntrinsicJSON, [replacement]) as string
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

function isLocalProjectConfigSpecifier(specifier: string): boolean {
  return specifier === "." || specifier === ".." ||
    ReflectApply(StringPrototypeStartsWith, specifier, ["./"]) as boolean ||
    ReflectApply(StringPrototypeStartsWith, specifier, ["../"]) as boolean ||
    isAbsolute(specifier);
}

function isProjectConfigGraphSpecifier(
  specifier: string,
  packageImportTarget: string | undefined,
): boolean {
  if (isLocalProjectConfigSpecifier(specifier)) return true;
  return packageImportTarget !== undefined &&
    ReflectApply(StringPrototypeStartsWith, packageImportTarget, ["./"]) as boolean;
}

async function rejectComputedConfigDynamicImports(source: string): Promise<void> {
  const lexer = await getConfigModuleLexer();
  await lexer.init?.();
  const imports = lexer.parse(source);
  for (let index = 0; index < imports.length; index++) {
    const specifier = imports[index];
    if (specifier && specifier.d >= 0 && specifier.n === undefined) {
      throw new TypeError(
        "Computed dynamic imports in TypeScript configuration must use a static specifier for Node.js 22.3 compatibility",
      );
    }
  }
}

let stagedConfigDynamicImportBridgeKeyPromise: Promise<string> | undefined;

function getStagedConfigDynamicImportBridgeKey(): Promise<string> {
  stagedConfigDynamicImportBridgeKeyPromise ??= (async () => {
    try {
      const uuid = ReflectApply(CryptoRandomUUID, IntrinsicCrypto, []) as string;
      const bridgeKey = `__veryfrontConfigDynamicImportV1:${uuid}`;
      const resolvers = new IntrinsicMap<string, Promise<ProjectConfigImportResolver>>();
      const resolverFor = (moduleUrl: string): Promise<ProjectConfigImportResolver> => {
        const cached = mapGet(resolvers, moduleUrl);
        if (cached) return cached;
        const pending = createProjectConfigImportResolver(fromFileUrl(new IntrinsicURL(moduleUrl)));
        mapSet(resolvers, moduleUrl, pending);
        return pending;
      };
      const load = async (
        specifier: unknown,
        moduleUrl: string,
        options?: ImportCallOptions,
      ): Promise<unknown> => {
        if (typeof specifier === "symbol") {
          throw new IntrinsicTypeError("Cannot convert a Symbol value to a string");
        }
        const stringSpecifier = typeof specifier === "string"
          ? specifier
          : ReflectApply(IntrinsicString, undefined, [specifier]) as string;
        const resolver = await resolverFor(moduleUrl);
        const resolved = await resolver(stringSpecifier);
        return options === undefined ? await import(resolved) : await import(resolved, options);
      };
      ObjectDefineProperty(globalThis, bridgeKey, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: freezeObject({ load }),
      });
      return bridgeKey;
    } catch (error) {
      stagedConfigDynamicImportBridgeKeyPromise = undefined;
      throw error;
    }
  })();
  return stagedConfigDynamicImportBridgeKeyPromise;
}

async function rewriteComputedStagedConfigImports(
  source: string,
  moduleUrl: string,
): Promise<string> {
  const lexer = await getConfigModuleLexer();
  await lexer.init?.();
  const imports = lexer.parse(source);
  const replacements: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < imports.length; index++) {
    const imported = imports[index];
    if (!imported || imported.d < 0 || imported.n !== undefined) continue;
    replacements[replacements.length] = { start: imported.ss, end: imported.d };
  }
  if (replacements.length === 0) return source;

  const bridgeIdentifier = uniqueConfigHelperName(source, "dynamic_import");
  let rewritten = source;
  for (let index = replacements.length - 1; index >= 0; index--) {
    const replacement = replacements[index]!;
    rewritten = stringSlice(rewritten, 0, replacement.start) + `${bridgeIdentifier}.load` +
      stringSlice(rewritten, replacement.end);
  }

  const bridgeKey = await getStagedConfigDynamicImportBridgeKey();
  const bridgeSource = `const bridge = globalThis[${configCodeLiteral(bridgeKey)}];\n` +
    `export default { load(specifier, options) { return bridge.load(specifier, ${
      configCodeLiteral(moduleUrl)
    }, options); } };\n`;
  const bridgeUrl = `data:text/javascript,${ReflectApply(EncodeURIComponent, undefined, [
    bridgeSource,
  ]) as string}`;
  const bridgeImport = `import ${bridgeIdentifier} from ${configCodeLiteral(bridgeUrl)};\n`;
  if (!stringStartsWith(rewritten, "#!")) return bridgeImport + rewritten;
  const hashbangEnd = stringIndexOf(rewritten, "\n");
  if (hashbangEnd < 0) return `${rewritten}\n${bridgeImport}`;
  return stringSlice(rewritten, 0, hashbangEnd + 1) + bridgeImport +
    stringSlice(rewritten, hashbangEnd + 1);
}

type ConfigCodeLiteral = string | number | boolean | null;

function configCodeLiteral(value: ConfigCodeLiteral): string {
  let serialized = ReflectApply(JSONStringify, IntrinsicJSON, [value]) as string;
  serialized = ReflectApply(StringPrototypeReplaceAll, serialized, ["<", "\\u003c"]) as string;
  serialized = ReflectApply(StringPrototypeReplaceAll, serialized, [">", "\\u003e"]) as string;
  serialized = ReflectApply(StringPrototypeReplaceAll, serialized, ["/", "\\u002f"]) as string;
  serialized = ReflectApply(StringPrototypeReplaceAll, serialized, ["\u2028", "\\u2028"]) as string;
  return ReflectApply(StringPrototypeReplaceAll, serialized, ["\u2029", "\\u2029"]) as string;
}

async function rewriteProjectConfigModuleLocations(
  source: string,
  modulePath: string,
  resolveSpecifier?: ImportMetaSpecifierResolver,
  moduleSuffix = "",
): Promise<string> {
  const moduleUrl = `${toFileUrl(modulePath).href}${moduleSuffix}`;
  const rewriteResolveCall: ImportMetaResolveCallRewriter | undefined = resolveSpecifier
    ? async (specifier, moduleUrl) => {
      try {
        const resolved = await resolveSpecifier(specifier, moduleUrl);
        if (resolved === null) throw new TypeError("Config import metadata could not be resolved");
        return `(() => ${configCodeLiteral(resolved)})()`;
      } catch (error) {
        return deferredConfigResolveErrorExpression(error);
      }
    }
    : undefined;
  let usesRuntimeResolver = false;
  const runtimeResolverName = uniqueConfigHelperName(source, "resolve");
  const rewriteResolveArgument: ImportMetaResolveArgumentRewriter | undefined = resolveSpecifier
    ? (argumentSource) => {
      usesRuntimeResolver = true;
      return `${runtimeResolverName}(${argumentSource})`;
    }
    : undefined;
  const rewriteResolveReference: ImportMetaResolveReferenceRewriter | undefined = resolveSpecifier
    ? () => {
      usesRuntimeResolver = true;
      return runtimeResolverName;
    }
    : undefined;
  const rewritten = await rewriteImportMetaLocations(
    source,
    moduleUrl,
    resolveSpecifier,
    rewriteResolveCall,
    rewriteResolveArgument,
    rewriteResolveReference,
  );
  if (rewritten === null) {
    throw new TypeError("Config import metadata could not be bound to its source module");
  }
  if (!usesRuntimeResolver) return rewritten;
  return prependConfigRuntimeResolver(
    rewritten,
    source,
    moduleUrl,
    runtimeResolverName,
    await getConfigRuntimeResolverBridgeKey(),
  );
}

function uniqueConfigHelperName(source: string, role: string): string {
  let candidate = `__veryfront_config_${role}`;
  while (ReflectApply(StringPrototypeIncludes, source, [candidate]) as boolean) candidate += "_";
  return candidate;
}

function unsupportedComputedConfigPackageResolve(): TypeError {
  return new TypeError(
    "Computed package specifiers in import.meta.resolve() are unavailable in staged configuration on Node.js 22.3; use a string literal",
  );
}

function isInvalidConfigPackageBareTarget(target: string): boolean {
  const parsed = parseBarePackageSpecifier(target);
  return parsed === null || parsed.version !== null || parsed.packageName === ".";
}

let configRuntimeResolverBridgeKeyPromise: Promise<string> | undefined;

function getConfigRuntimeResolverBridgeKey(): Promise<string> {
  configRuntimeResolverBridgeKeyPromise ??= (async () => {
    try {
      const { isBuiltin } = await import("node:module");
      const uuid = ReflectApply(CryptoRandomUUID, IntrinsicCrypto, []) as string;
      const bridgeKey = `__veryfrontConfigRuntimeResolverV1:${uuid}`;
      const resolver = (specifier: unknown, moduleUrl: string): string => {
        const value = typeof specifier === "string" ? specifier : "" + specifier;
        if (isBuiltin(value)) {
          return ReflectApply(StringPrototypeStartsWith, value, ["node:"]) as boolean
            ? value
            : `node:${value}`;
        }
        const directUrl = resolveConfigImportMetaUrl(value, moduleUrl);
        if (directUrl !== null) return directUrl;
        throw unsupportedComputedConfigPackageResolve();
      };
      ObjectDefineProperty(globalThis, bridgeKey, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: resolver,
      });
      return bridgeKey;
    } catch (error) {
      configRuntimeResolverBridgeKeyPromise = undefined;
      throw error;
    }
  })();
  return configRuntimeResolverBridgeKeyPromise;
}

function prependConfigRuntimeResolver(
  rewritten: string,
  originalSource: string,
  moduleUrl: string,
  resolverName: string,
  bridgeKey: string,
): string {
  const bridgeName = uniqueConfigHelperName(originalSource, "resolver_bridge");
  const specifierName = uniqueConfigHelperName(originalSource, "specifier");
  const serializedModuleUrl = configCodeLiteral(moduleUrl);
  const prelude = [
    `const ${bridgeName} = globalThis[${configCodeLiteral(bridgeKey)}];`,
    `if (typeof ${bridgeName} !== "function") throw new Error("Veryfront config resolver bridge is unavailable");`,
    `const ${resolverName} = (${specifierName}) => ${bridgeName}(${specifierName}, ${serializedModuleUrl});`,
    "",
  ].join("\n");
  if (!originalSource.startsWith("#!")) return prelude + rewritten;
  const lineEnd = originalSource.indexOf("\n");
  if (lineEnd < 0) return `${originalSource}\n${prelude}`;
  return rewritten.slice(0, lineEnd + 1) + prelude + rewritten.slice(lineEnd + 1);
}

interface DeferredConfigResolveError {
  readonly constructorName: "Error" | "TypeError" | "RangeError" | "SyntaxError";
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly cause?: DeferredConfigResolveError | string | number | boolean | null;
}

function ownStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, Object, [value, key]) as
    | PropertyDescriptor
    | undefined;
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function serializeConfigResolveError(
  error: unknown,
  seen = new IntrinsicSet<object>(),
): DeferredConfigResolveError {
  const errorObject = typeof error === "object" && error !== null ? error : undefined;
  const constructorName = error instanceof TypeError
    ? "TypeError"
    : error instanceof RangeError
    ? "RangeError"
    : error instanceof SyntaxError
    ? "SyntaxError"
    : "Error";
  const name = error instanceof Error && error.name
    ? error.name
    : errorObject
    ? ownStringProperty(errorObject, "name") ?? constructorName
    : constructorName;
  const message = error instanceof Error
    ? error.message
    : errorObject
    ? ownStringProperty(errorObject, "message") ??
      "Config import.meta.resolve could not resolve the requested module"
    : "Config import.meta.resolve could not resolve the requested module";
  const code = errorObject ? ownStringProperty(errorObject, "code") : undefined;
  let cause: DeferredConfigResolveError | string | number | boolean | null | undefined;

  if (errorObject && !setHas(seen, errorObject)) {
    setAdd(seen, errorObject);
    const descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, Object, [
      errorObject,
      "cause",
    ]) as PropertyDescriptor | undefined;
    if (descriptor && "value" in descriptor) {
      const value = descriptor.value;
      if (typeof value === "object" && value !== null) {
        cause = serializeConfigResolveError(value, seen);
      } else if (
        value === null || typeof value === "string" || typeof value === "number" ||
        typeof value === "boolean"
      ) {
        cause = value;
      }
    }
  }

  return {
    constructorName,
    name,
    message,
    ...(code ? { code } : {}),
    ...(cause !== undefined ? { cause } : {}),
  };
}

/** @internal Test-only seam for deferred config resolver error serialization. */
export function __serializeConfigResolveErrorForTests(error: unknown) {
  return serializeConfigResolveError(error);
}

function deferredErrorConstructorExpression(error: DeferredConfigResolveError): string {
  const cause = error.cause === undefined
    ? ""
    : `, { cause: ${
      typeof error.cause === "object" && error.cause !== null && "constructorName" in error.cause
        ? deferredErrorConstructorExpression(error.cause)
        : configCodeLiteral(error.cause)
    } }`;
  const assignments = [
    error.name !== error.constructorName ? `failure.name = ${configCodeLiteral(error.name)};` : "",
    error.code ? `failure.code = ${configCodeLiteral(error.code)};` : "",
  ].filter(Boolean).join(" ");
  return `(() => { const failure = new ${error.constructorName}(${
    configCodeLiteral(error.message)
  }${cause}); ${assignments} return failure; })()`;
}

function deferredConfigResolveErrorExpression(error: unknown): string {
  const serialized = serializeConfigResolveError(error);
  return `(() => { throw ${deferredErrorConstructorExpression(serialized)}; })()`;
}

function configImportMetaResolveError(message: string): Error & { code?: string } {
  const error = new Error(message) as Error & { code?: string };
  if (ReflectApply(StringPrototypeIncludes, message, ["Could not resolve"]) as boolean) {
    error.code = "ERR_MODULE_NOT_FOUND";
  }
  return error;
}

type ConfigBundlerBuild = (options: BundleOptions) => Promise<BundleResult>;

const CONFIG_PACKAGE_TARGET_NO_MATCH = Symbol("config-package-target-no-match");
const CONFIG_PACKAGE_TARGET_INVALID = Symbol("config-package-target-invalid");
const CONFIG_PACKAGE_TARGET_INVALID_CONFIG = Symbol("config-package-target-invalid-config");
const CONFIG_PACKAGE_TARGET_URL_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/;
const CONFIG_PACKAGE_INTEGER_INDEX_KEY = /^(?:0|[1-9]\d{0,9})$/;
const CONFIG_PACKAGE_TARGET_ENCODED_SEPARATOR = /%2f|%5c/i;
const CONFIG_PACKAGE_TARGET_INVALID_SEGMENT =
  /(^|\\|\/)((\.|%2e)(\.|%2e)?|(n|%6e|%4e)(o|%6f|%4f)(d|%64|%44)(e|%65|%45)(_|%5f)(m|%6d|%4d)(o|%6f|%4f)(d|%64|%44)(u|%75|%55)(l|%6c|%4c)(e|%65|%45)(s|%73|%53))(\\|\/|$)/i;

type ConfigPackageTarget =
  | string
  | null
  | typeof CONFIG_PACKAGE_TARGET_NO_MATCH
  | typeof CONFIG_PACKAGE_TARGET_INVALID
  | typeof CONFIG_PACKAGE_TARGET_INVALID_CONFIG;

function isConfigPackageIntegerIndexKey(key: string): boolean {
  if (
    ReflectApply(RegExpPrototypeExec, CONFIG_PACKAGE_INTEGER_INDEX_KEY, [key]) === null
  ) return false;
  return key.length < 10 || (key.length === 10 && key < "4294967295");
}

function isValidConfigPackageTargetString(target: string): boolean {
  const queryIndex = ReflectApply(StringPrototypeIndexOf, target, ["?"]) as number;
  const fragmentIndex = ReflectApply(StringPrototypeIndexOf, target, ["#"]) as number;
  const suffixIndex = queryIndex < 0
    ? fragmentIndex
    : fragmentIndex < 0
    ? queryIndex
    : queryIndex < fragmentIndex
    ? queryIndex
    : fragmentIndex;
  const targetPath = suffixIndex < 0
    ? target
    : ReflectApply(StringPrototypeSlice, target, [0, suffixIndex]) as string;
  if (ReflectApply(RegExpPrototypeExec, CONFIG_PACKAGE_TARGET_ENCODED_SEPARATOR, [targetPath])) {
    return false;
  }
  if (ReflectApply(StringPrototypeStartsWith, target, ["./"]) as boolean) {
    return ReflectApply(RegExpPrototypeExec, CONFIG_PACKAGE_TARGET_INVALID_SEGMENT, [
      ReflectApply(StringPrototypeSlice, target, [2]) as string,
    ]) === null;
  }
  return !(ReflectApply(StringPrototypeStartsWith, target, ["../"]) as boolean) &&
    !(ReflectApply(StringPrototypeStartsWith, target, ["/"]) as boolean) &&
    ReflectApply(RegExpPrototypeExec, CONFIG_PACKAGE_TARGET_URL_SCHEME, [target]) === null;
}

function tokenizeNodeOptions(options: string | undefined): string[] {
  if (options === undefined || options.length === 0) return [];
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  let escaped = false;
  for (let index = 0; index < options.length; index++) {
    const character = options[index]!;
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote === '"') {
      escaped = true;
      continue;
    }
    if (quote !== "") {
      if (character === quote) quote = "";
      else token += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (
      character === " " || character === "\t" || character === "\r" || character === "\n"
    ) {
      if (token.length > 0) {
        tokens[tokens.length] = token;
        token = "";
      }
      continue;
    }
    token += character;
  }
  if (escaped) token += "\\";
  if (token.length > 0) tokens[tokens.length] = token;
  return tokens;
}

function matchesNodeBooleanOption(argument: string, option: string): boolean {
  return argument === option ||
    ReflectApply(StringPrototypeStartsWith, argument, [`${option}=`]) as boolean;
}

function nodeConfigPackageConditions(
  execArgv: readonly string[],
  nodeOptions: string | undefined,
  moduleCondition: "import" | "require" | null = "import",
  moduleSync = CapturedNodeRequireModule,
): string[] {
  const customConditions: string[] = [];
  let addons = true;
  const appendCustom = (condition: string): void => {
    if (condition.length === 0) return;
    for (let index = 0; index < customConditions.length; index++) {
      if (customConditions[index] === condition) return;
    }
    customConditions[customConditions.length] = condition;
  };
  const collect = (arguments_: readonly string[]): void => {
    for (let index = 0; index < arguments_.length; index++) {
      const argument = arguments_[index];
      if (argument === undefined) continue;
      if (matchesNodeBooleanOption(argument, "--no-addons")) {
        addons = false;
        continue;
      }
      if (matchesNodeBooleanOption(argument, "--addons")) {
        addons = true;
        continue;
      }
      if (
        argument === "-e" || argument === "--eval" || argument === "-p" ||
        argument === "--print"
      ) return;
      if (argument === "--conditions" || argument === "-C") {
        const condition = arguments_[index + 1];
        if (condition !== undefined) appendCustom(condition);
        index += 1;
        continue;
      }
      if (ReflectApply(StringPrototypeStartsWith, argument, ["--conditions="]) as boolean) {
        appendCustom(ReflectApply(StringPrototypeSlice, argument, [13]) as string);
        continue;
      }
    }
  };
  collect(tokenizeNodeOptions(nodeOptions));
  collect(execArgv);

  const conditions = ["node"];
  if (moduleCondition !== null) conditions[conditions.length] = moduleCondition;
  if (moduleSync) conditions[conditions.length] = "module-sync";
  if (addons) conditions[conditions.length] = "node-addons";
  for (let index = 0; index < customConditions.length; index++) {
    const condition = customConditions[index]!;
    let present = false;
    for (let conditionIndex = 0; conditionIndex < conditions.length; conditionIndex++) {
      if (conditions[conditionIndex] === condition) present = true;
    }
    if (!present) conditions[conditions.length] = condition;
  }
  return conditions;
}

const CONFIG_NODE_IMPORT_CONDITIONS = freezeObject(
  nodeConfigPackageConditions(CapturedNodeExecArgv, CapturedNodeOptions),
);
const CONFIG_NODE_REQUIRE_CONDITIONS = freezeObject(
  nodeConfigPackageConditions(CapturedNodeExecArgv, CapturedNodeOptions, "require"),
);
const CONFIG_NODE_BUNDLE_CONDITIONS = freezeObject(
  nodeConfigPackageConditions(CapturedNodeExecArgv, CapturedNodeOptions, null),
);

/** @internal */
export function __getNodeConfigPackageConditionsForTests(
  execArgv: readonly string[],
  nodeOptions: string | undefined,
  moduleCondition: "import" | "require" = "import",
  moduleSync = false,
): string[] {
  return nodeConfigPackageConditions(execArgv, nodeOptions, moduleCondition, moduleSync);
}

/** @internal */
export function __getNodeConfigBundleConditionsForTests(
  execArgv: readonly string[],
  nodeOptions: string | undefined,
  moduleSync = false,
): string[] {
  return nodeConfigPackageConditions(execArgv, nodeOptions, null, moduleSync);
}

function isConfigPackageConditionActive(
  condition: string,
  conditions: readonly string[],
): boolean {
  if (condition === "default") return true;
  for (let index = 0; index < conditions.length; index += 1) {
    if (conditions[index] === condition) return true;
  }
  return false;
}

function configPackageTarget(
  entry: unknown,
  conditions: readonly string[] = CONFIG_NODE_IMPORT_CONDITIONS,
): ConfigPackageTarget {
  if (typeof entry === "string") {
    return isValidConfigPackageTargetString(entry) ? entry : CONFIG_PACKAGE_TARGET_INVALID;
  }
  if (entry === null) return null;
  if (ArrayIsArray(entry)) {
    if (entry.length === 0) return null;
    let fallback: ConfigPackageTarget = CONFIG_PACKAGE_TARGET_NO_MATCH;
    for (let index = 0; index < entry.length; index += 1) {
      const target = configPackageTarget(entry[index], conditions);
      if (target === CONFIG_PACKAGE_TARGET_NO_MATCH) continue;
      if (target === CONFIG_PACKAGE_TARGET_INVALID_CONFIG) return target;
      if (target === CONFIG_PACKAGE_TARGET_INVALID || target === null) {
        fallback = target;
        continue;
      }
      return target;
    }
    return fallback;
  }
  if (typeof entry !== "object") return CONFIG_PACKAGE_TARGET_INVALID;
  const keys = ReflectOwnKeys(entry);
  for (const key of keys) {
    if (typeof key === "string" && isConfigPackageIntegerIndexKey(key)) {
      return CONFIG_PACKAGE_TARGET_INVALID_CONFIG;
    }
  }
  for (const key of keys) {
    if (typeof key !== "string" || !isConfigPackageConditionActive(key, conditions)) {
      continue;
    }
    const descriptor = ObjectGetOwnPropertyDescriptor(entry, key);
    if (!descriptor || !("value" in descriptor)) continue;
    const target = configPackageTarget(descriptor.value, conditions);
    if (target !== CONFIG_PACKAGE_TARGET_NO_MATCH) return target;
  }
  return CONFIG_PACKAGE_TARGET_NO_MATCH;
}

/** @internal */
export function __resolveNodeConfigPackageTargetForTests(
  entry: unknown,
  conditions: readonly string[],
): string | null {
  const target = configPackageTarget(entry, conditions);
  return typeof target === "string" ? target : null;
}

interface ConfigPackageScope {
  readonly directory: string;
  readonly manifest: RuntimeReflectionRecord;
}

type ConfigPackageReadFileSync = typeof import("node:fs").readFileSync;

function configPackageOwnValue(record: RuntimeReflectionRecord, key: string): unknown {
  const descriptor = ObjectGetOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function stripConfigPackageManifestBom(source: string): string {
  return source[0] === "\uFEFF"
    ? ReflectApply(StringPrototypeSlice, source, [1]) as string
    : source;
}

function findConfigPackageScope(
  modulePath: string,
  readFileSync: ConfigPackageReadFileSync,
): ConfigPackageScope | null {
  let current = dirname(modulePath);
  while (true) {
    try {
      const manifest = JSONParse(
        stripConfigPackageManifestBom(readFileSync(join(current, "package.json"), "utf8")),
      );
      if (typeof manifest !== "object" || manifest === null || ArrayIsArray(manifest)) {
        throw new TypeError("Config package manifest must contain a JSON object");
      }
      return { directory: current, manifest };
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function configPackageMapTarget(
  map: unknown,
  specifier: string,
  conditions: readonly string[],
): ConfigPackageTarget {
  if (typeof map !== "object" || map === null || ArrayIsArray(map)) {
    return CONFIG_PACKAGE_TARGET_NO_MATCH;
  }
  const exact = ObjectGetOwnPropertyDescriptor(map, specifier);
  if (exact && "value" in exact) return configPackageTarget(exact.value, conditions);

  let bestKey: string | undefined;
  let bestPrefixLength = -1;
  for (const key of ReflectOwnKeys(map)) {
    if (typeof key !== "string") continue;
    const star = ReflectApply(StringPrototypeIndexOf, key, ["*"]) as number;
    if (star < 0) continue;
    if ((ReflectApply(StringPrototypeIndexOf, key, ["*", star + 1]) as number) >= 0) continue;
    const prefix = ReflectApply(StringPrototypeSlice, key, [0, star]) as string;
    const suffix = ReflectApply(StringPrototypeSlice, key, [star + 1]) as string;
    if (!(ReflectApply(StringPrototypeStartsWith, specifier, [prefix]) as boolean)) continue;
    if (!(ReflectApply(StringPrototypeEndsWith, specifier, [suffix]) as boolean)) continue;
    if (
      specifier.length < key.length ||
      prefix.length < bestPrefixLength ||
      (prefix.length === bestPrefixLength && bestKey !== undefined && key.length <= bestKey.length)
    ) {
      continue;
    }
    bestKey = key;
    bestPrefixLength = prefix.length;
  }
  if (bestKey === undefined) return CONFIG_PACKAGE_TARGET_NO_MATCH;

  const star = ReflectApply(StringPrototypeIndexOf, bestKey, ["*"]) as number;
  const suffixLength = bestKey.length - star - 1;
  const captured = ReflectApply(StringPrototypeSlice, specifier, [
    star,
    suffixLength === 0 ? undefined : -suffixLength,
  ]) as string;
  const pattern = ObjectGetOwnPropertyDescriptor(map, bestKey);
  if (!pattern || !("value" in pattern)) return CONFIG_PACKAGE_TARGET_NO_MATCH;
  const target = configPackageTarget(pattern.value, conditions);
  if (typeof target !== "string") return target;
  const substituted = ReflectApply(StringPrototypeReplaceAll, target, ["*", captured]) as string;
  return isValidConfigPackageTargetString(substituted)
    ? substituted
    : CONFIG_PACKAGE_TARGET_INVALID;
}

function configPackageExportsTarget(
  exports: unknown,
  subpath: string,
  conditions: readonly string[],
): ConfigPackageTarget {
  if (exports !== null && typeof exports === "object" && !ArrayIsArray(exports)) {
    let hasSubpathKey = false;
    let hasConditionKey = false;
    for (const key of ReflectOwnKeys(exports)) {
      if (typeof key !== "string") continue;
      if (ReflectApply(StringPrototypeStartsWith, key, ["."]) as boolean) {
        hasSubpathKey = true;
      } else {
        hasConditionKey = true;
      }
    }
    if (hasSubpathKey && hasConditionKey) return CONFIG_PACKAGE_TARGET_INVALID_CONFIG;
    if (hasSubpathKey) return configPackageMapTarget(exports, subpath, conditions);
  }
  return subpath === "."
    ? configPackageTarget(exports, conditions)
    : CONFIG_PACKAGE_TARGET_NO_MATCH;
}

function configPackageResolutionError(
  specifier: string,
  code: "ERR_PACKAGE_IMPORT_NOT_DEFINED" | "ERR_PACKAGE_PATH_NOT_EXPORTED",
): Error & { code: string } {
  const error = new Error(`Config package resolution escaped its package for "${specifier}"`) as
    & Error
    & { code: string };
  error.code = code;
  return error;
}

function configPackageInvalidTarget(specifier: string): Error & { code: string } {
  const error = new Error(`Invalid ESM package import target for "${specifier}"`) as Error & {
    code: string;
  };
  error.code = "ERR_INVALID_PACKAGE_TARGET";
  return error;
}

function configPackageInvalidConfig(specifier: string): Error & { code: string } {
  const error = new Error(`Invalid ESM package configuration for "${specifier}"`) as Error & {
    code: string;
  };
  error.code = "ERR_INVALID_PACKAGE_CONFIG";
  return error;
}

function configPackageInvalidSpecifier(specifier: string): Error & { code: string } {
  const error = new TypeError(`Invalid package import specifier "${specifier}"`) as TypeError & {
    code: string;
  };
  error.code = "ERR_INVALID_MODULE_SPECIFIER";
  return error;
}

function isInvalidConfigPackageImportSpecifier(specifier: string): boolean {
  return specifier === "#" ||
    (ReflectApply(StringPrototypeStartsWith, specifier, ["#/"]) as boolean) ||
    (ReflectApply(StringPrototypeEndsWith, specifier, ["/"]) as boolean);
}

interface LiteralConfigPackageImportResolution {
  readonly specifier: string;
  readonly modulePath: string;
}

async function resolveLiteralConfigPackageImport(
  specifier: string,
  modulePath: string,
  depth = 0,
  containRelativeTarget = true,
  conditions: readonly string[] = CONFIG_NODE_IMPORT_CONDITIONS,
): Promise<LiteralConfigPackageImportResolution> {
  if (!(ReflectApply(StringPrototypeStartsWith, specifier, ["#"]) as boolean)) {
    return { specifier, modulePath };
  }
  if (isInvalidConfigPackageImportSpecifier(specifier)) {
    throw configPackageInvalidSpecifier(specifier);
  }
  if (depth > 16) throw new TypeError("Config package resolution exceeded its redirect limit");
  const { isBuiltin } = await import("node:module");
  const { readFileSync } = await import("node:fs");
  const moduleScope = findConfigPackageScope(modulePath, readFileSync);
  const imports = moduleScope ? configPackageOwnValue(moduleScope.manifest, "imports") : undefined;
  const target = configPackageMapTarget(
    imports,
    specifier,
    conditions,
  );
  if (target === CONFIG_PACKAGE_TARGET_INVALID_CONFIG) {
    throw configPackageInvalidConfig(specifier);
  }
  if (target === CONFIG_PACKAGE_TARGET_INVALID) throw configPackageInvalidTarget(specifier);
  if (moduleScope === null || target === null || target === CONFIG_PACKAGE_TARGET_NO_MATCH) {
    throw configPackageResolutionError(specifier, "ERR_PACKAGE_IMPORT_NOT_DEFINED");
  }
  if (ReflectApply(StringPrototypeStartsWith, target, ["./"]) as boolean) {
    if (!containRelativeTarget) {
      return {
        specifier: target,
        modulePath: join(moduleScope.directory, "package.json"),
      };
    }
    const resolvedPath = await resolveContainedBundlerConfigPackagePath(
      specifier,
      modulePath,
      resolve(moduleScope.directory, target),
      conditions,
    );
    return {
      specifier: toFileUrl(resolvedPath).href,
      modulePath: join(moduleScope.directory, "package.json"),
    };
  }
  if (
    ReflectApply(StringPrototypeStartsWith, target, ["../"]) as boolean ||
    ReflectApply(StringPrototypeStartsWith, target, ["/"]) as boolean ||
    ReflectApply(StringPrototypeStartsWith, target, ["node:"]) as boolean
  ) {
    throw configPackageInvalidTarget(specifier);
  }
  if (isBuiltin(target)) {
    return {
      specifier: `node:${target}`,
      modulePath: join(moduleScope.directory, "package.json"),
    };
  }
  if (isInvalidConfigPackageBareTarget(target)) {
    throw configPackageInvalidSpecifier(target);
  }
  return await resolveLiteralConfigPackageImport(
    target,
    join(moduleScope.directory, "package.json"),
    depth + 1,
    containRelativeTarget,
    conditions,
  );
}

async function configPackageResolutionRoot(
  specifier: string,
  modulePath: string,
  depth = 0,
  conditions: readonly string[] = CONFIG_NODE_IMPORT_CONDITIONS,
): Promise<
  {
    directory: string;
    errorCode: "ERR_PACKAGE_IMPORT_NOT_DEFINED" | "ERR_PACKAGE_PATH_NOT_EXPORTED";
  } | null
> {
  if (depth > 16) throw new TypeError("Config package resolution exceeded its redirect limit");
  const { createRequire, isBuiltin } = await import("node:module");
  const { existsSync, readFileSync } = await import("node:fs");
  if (isBuiltin(specifier)) return null;

  const moduleScope = findConfigPackageScope(modulePath, readFileSync);
  if (ReflectApply(StringPrototypeStartsWith, specifier, ["#"]) as boolean) {
    if (isInvalidConfigPackageImportSpecifier(specifier)) {
      throw configPackageInvalidSpecifier(specifier);
    }
    const imports = moduleScope
      ? configPackageOwnValue(moduleScope.manifest, "imports")
      : undefined;
    const target = configPackageMapTarget(
      imports,
      specifier,
      conditions,
    );
    if (target === CONFIG_PACKAGE_TARGET_INVALID_CONFIG) {
      throw configPackageInvalidConfig(specifier);
    }
    if (target === CONFIG_PACKAGE_TARGET_INVALID) throw configPackageInvalidTarget(specifier);
    if (moduleScope === null || target === null || target === CONFIG_PACKAGE_TARGET_NO_MATCH) {
      throw configPackageResolutionError(specifier, "ERR_PACKAGE_IMPORT_NOT_DEFINED");
    }
    if (ReflectApply(StringPrototypeStartsWith, target, ["./"]) as boolean) {
      return { directory: moduleScope.directory, errorCode: "ERR_PACKAGE_IMPORT_NOT_DEFINED" };
    }
    if (
      ReflectApply(StringPrototypeStartsWith, target, ["../"]) as boolean ||
      ReflectApply(StringPrototypeStartsWith, target, ["/"]) as boolean ||
      ReflectApply(StringPrototypeStartsWith, target, ["node:"]) as boolean
    ) {
      throw configPackageResolutionError(specifier, "ERR_PACKAGE_IMPORT_NOT_DEFINED");
    }
    if (isInvalidConfigPackageBareTarget(target)) {
      throw configPackageInvalidSpecifier(target);
    }
    return await configPackageResolutionRoot(
      target,
      join(moduleScope.directory, "package.json"),
      depth + 1,
      conditions,
    );
  }

  const parsed = parseBarePackageSpecifier(specifier);
  if (!parsed || parsed.version !== null) return null;
  const packageExports = moduleScope
    ? configPackageOwnValue(moduleScope.manifest, "exports")
    : undefined;
  if (
    moduleScope && configPackageOwnValue(moduleScope.manifest, "name") === parsed.packageName &&
    packageExports !== undefined && packageExports !== null
  ) {
    return { directory: moduleScope.directory, errorCode: "ERR_PACKAGE_PATH_NOT_EXPORTED" };
  }

  const projectRequire = createRequire(toFileUrl(modulePath).href);
  const searchPaths = projectRequire.resolve.paths(parsed.packageName);
  if (searchPaths) {
    for (let index = 0; index < searchPaths.length; index += 1) {
      const packageDir = join(searchPaths[index]!, parsed.packageName);
      if (existsSync(join(packageDir, "package.json"))) {
        return { directory: packageDir, errorCode: "ERR_PACKAGE_PATH_NOT_EXPORTED" };
      }
    }
  }
  return null;
}

async function resolveLiteralConfigPackageExport(
  specifier: string,
  modulePath: string,
  conditions: readonly string[] = CONFIG_NODE_IMPORT_CONDITIONS,
): Promise<string | null> {
  const parsed = parseBarePackageSpecifier(specifier);
  if (!parsed || parsed.version !== null) return null;

  const root = await configPackageResolutionRoot(specifier, modulePath, 0, conditions);
  if (root === null) return null;
  const { readFileSync } = await import("node:fs");
  const scope = findConfigPackageScope(join(root.directory, "package.json"), readFileSync);
  if (scope === null || scope.directory !== root.directory) return null;
  const exports = configPackageOwnValue(scope.manifest, "exports");
  if (exports === undefined || exports === null) {
    if (parsed.subpath === null) return null;
    const targetUrl = new URL(
      `.${parsed.subpath}`,
      toFileUrl(join(root.directory, "package.json")).href,
    );
    const containedPath = await resolveContainedBundlerConfigPackagePath(
      specifier,
      modulePath,
      fromFileUrl(targetUrl),
      conditions,
    );
    return `${toFileUrl(containedPath).href}${targetUrl.search}${targetUrl.hash}`;
  }

  const target = configPackageExportsTarget(
    exports,
    parsed.subpath === null ? "." : `.${parsed.subpath}`,
    conditions,
  );
  if (target === CONFIG_PACKAGE_TARGET_INVALID_CONFIG) {
    throw configPackageInvalidConfig(specifier);
  }
  if (target === CONFIG_PACKAGE_TARGET_INVALID) throw configPackageInvalidTarget(specifier);
  if (target === null || target === CONFIG_PACKAGE_TARGET_NO_MATCH) {
    throw configPackageResolutionError(specifier, "ERR_PACKAGE_PATH_NOT_EXPORTED");
  }
  if (!(ReflectApply(StringPrototypeStartsWith, target, ["./"]) as boolean)) {
    throw configPackageInvalidTarget(specifier);
  }

  const targetUrl = new URL(target, toFileUrl(join(root.directory, "package.json")).href);
  const containedPath = await resolveContainedBundlerConfigPackagePath(
    specifier,
    modulePath,
    fromFileUrl(targetUrl),
    conditions,
  );
  return `${toFileUrl(containedPath).href}${targetUrl.search}${targetUrl.hash}`;
}

type ConfigPackageRealpathSync = typeof import("node:fs").realpathSync;
type ConfigPackageLstatSync = typeof import("node:fs").lstatSync;

function configPackageTargetBoundary(
  realpathSync: ConfigPackageRealpathSync,
  lstatSync: ConfigPackageLstatSync,
  resolvedPath: string,
): { path: string; targetExists: boolean } {
  let current = resolvedPath;
  while (true) {
    try {
      return { path: realpathSync(current), targetExists: current === resolvedPath };
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      let candidateIsMissing = false;
      try {
        lstatSync(current);
      } catch (lstatError) {
        if (!isNotFoundError(lstatError)) throw lstatError;
        candidateIsMissing = true;
      }
      if (!candidateIsMissing) throw error;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new TypeError("Config package target has no existing filesystem boundary");
    }
    current = parent;
  }
}

async function resolveContainedBundlerConfigPackagePath(
  specifier: string,
  modulePath: string,
  resolvedPath: string,
  conditions: readonly string[] = CONFIG_NODE_IMPORT_CONDITIONS,
): Promise<string> {
  const root = await configPackageResolutionRoot(specifier, modulePath, 0, conditions);
  if (root === null) return resolvedPath;
  const { lstatSync, realpathSync } = await import("node:fs");
  const packageRoot = realpathSync(root.directory);
  const boundary = configPackageTargetBoundary(realpathSync, lstatSync, resolvedPath);
  if (!isPathContainedBy(boundary.path, packageRoot)) {
    throw configPackageResolutionError(specifier, root.errorCode);
  }
  return boundary.targetExists ? boundary.path : resolvedPath;
}

async function resolveBundlerConfigPackageImport(
  specifier: string,
  modulePath: string,
  resolvedPath: string,
  conditions: readonly string[] = CONFIG_NODE_IMPORT_CONDITIONS,
): Promise<{ readonly target: string; readonly path: string }> {
  try {
    const target =
      (await resolveLiteralConfigPackageImport(specifier, modulePath, 0, false, conditions))
        .specifier;
    const path = await resolveContainedBundlerConfigPackagePath(
      specifier,
      modulePath,
      resolvedPath,
      conditions,
    );
    return { target, path };
  } catch (error) {
    if (
      typeof error === "object" && error !== null &&
      ownStringProperty(error, "code") === "ERR_PACKAGE_IMPORT_NOT_DEFINED"
    ) {
      throw new TypeError("Config import resolves outside the project directory", {
        cause: error,
      });
    }
    throw error;
  }
}

async function resolveConfigImportMetaWithBundler(
  bundle: ConfigBundlerBuild,
  specifier: string,
  modulePath: string,
): Promise<string | null> {
  if (isNodeBuiltinPackageName(specifier)) return `node:${specifier}`;
  const directUrl = resolveConfigImportMetaUrl(specifier, toFileUrl(modulePath).href);
  if (directUrl !== null) return directUrl;

  const resolution = await resolveLiteralConfigPackageImport(specifier, modulePath);
  const resolutionSpecifier = resolution.specifier;
  if (ReflectApply(StringPrototypeStartsWith, resolutionSpecifier, ["node:"]) as boolean) {
    return resolutionSpecifier;
  }
  if (ReflectApply(StringPrototypeStartsWith, resolutionSpecifier, ["file:"]) as boolean) {
    return resolutionSpecifier;
  }
  const packageExport = await resolveLiteralConfigPackageExport(
    resolutionSpecifier,
    resolution.modulePath,
  );
  if (packageExport !== null) return packageExport;

  const resolveDir = dirname(resolution.modulePath);
  const sourcefile = "veryfront-config-import-meta-resolve.mjs";
  let resolvedPath: string | null = null;
  const result = await bundle({
    bundle: true,
    write: false,
    format: "esm",
    platform: isNode ? "node" : "neutral",
    conditions: CONFIG_NODE_BUNDLE_CONDITIONS,
    mainFields: ["main"],
    target: "es2022",
    logLevel: "silent",
    absWorkingDir: resolveDir,
    plugins: [{
      name: "veryfront-config-import-meta-resolve",
      setup(build) {
        build.onLoad({ filter: /.*/, namespace: "file" }, (args) => {
          resolvedPath ??= args.path;
          return { contents: "export {};", loader: "js" };
        });
      },
    }],
    stdin: {
      contents: `import ${ReflectApply(JSONStringify, IntrinsicJSON, [resolutionSpecifier])};`,
      resolveDir,
      sourcefile,
      loader: "js",
    },
  });
  const firstError = result.errors[0]?.text;
  if (firstError) throw configImportMetaResolveError(firstError);
  if (resolvedPath === null) return null;
  if (isNodeBuiltinPackageName(resolvedPath)) return `node:${resolvedPath}`;
  const absoluteResolvedPath = isAbsolute(resolvedPath)
    ? resolvedPath
    : resolve(resolveDir, resolvedPath);
  return toFileUrl(
    await resolveContainedBundlerConfigPackagePath(specifier, modulePath, absoluteResolvedPath),
  ).href;
}

function isConfigDependencyPath(modulePath: string, configDir: string): boolean {
  let current = dirname(modulePath);
  while (isPathContainedBy(current, configDir)) {
    if (isPathContainedBy(configDir, current)) return false;
    const name = ReflectApply(StringPrototypeToLowerCase, basename(current), []) as string;
    if (name === "node_modules") return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  return false;
}

type ConfigFileUrlResolution =
  | { readonly kind: "not-file-url" }
  | { readonly kind: "bundle"; readonly path: string; readonly suffix: string }
  | { readonly kind: "external"; readonly specifier: string };

async function resolveConfigFileUrl(
  specifier: string,
  configDir: string,
  lexicalConfigDir: string,
): Promise<ConfigFileUrlResolution> {
  if (!(ReflectApply(StringPrototypeStartsWith, specifier, ["file:"]) as boolean)) {
    return { kind: "not-file-url" };
  }
  try {
    const url = new URL(specifier);
    if (url.username || url.password) {
      throw new TypeError("Config file URL imports cannot include credentials");
    }
    const suffix = `${url.search}${url.hash}`;
    const lexicalPath = fromFileUrl(url);
    const modulePath = await realPath(lexicalPath);
    if (
      isPathContainedBy(lexicalPath, lexicalConfigDir) &&
      isConfigDependencyPath(lexicalPath, lexicalConfigDir)
    ) {
      return { kind: "external", specifier };
    }
    if (!isPathContainedBy(modulePath, configDir)) {
      throw new TypeError("Config import resolves outside the project directory");
    }
    if (isConfigDependencyPath(modulePath, configDir)) {
      return { kind: "external", specifier };
    }
    return { kind: "bundle", path: modulePath, suffix };
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Config file URL import could not be resolved", { cause: error });
  }
}

function resolveConfigImportMetaUrl(specifier: string, moduleUrl: string): string | null {
  const query = ReflectApply(StringPrototypeIndexOf, specifier, ["?"]) as number;
  const fragment = ReflectApply(StringPrototypeIndexOf, specifier, ["#"]) as number;
  const suffixStart = query < 0
    ? fragment
    : fragment < 0
    ? query
    : query < fragment
    ? query
    : fragment;
  const path = suffixStart < 0
    ? specifier
    : ReflectApply(StringPrototypeSlice, specifier, [0, suffixStart]) as string;
  if (isAbsolute(path)) {
    const suffix = suffixStart < 0
      ? ""
      : ReflectApply(StringPrototypeSlice, specifier, [suffixStart]) as string;
    const href = ReflectApply(StringPrototypeStartsWith, path, ["/"]) as boolean
      ? new URL(path, "file://").href
      : toFileUrl(path).href;
    return `${href}${suffix}`;
  }
  if (
    isLocalProjectConfigSpecifier(specifier) ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(specifier)
  ) {
    try {
      return new URL(specifier, moduleUrl).href;
    } catch {
      return null;
    }
  }
  return null;
}

function configSourceLoader(path: string): "js" | "jsx" | "ts" | "tsx" {
  switch (extname(path)) {
    case ".tsx":
      return "tsx";
    case ".ts":
    case ".mts":
    case ".cts":
      return "ts";
    case ".jsx":
      return "jsx";
    default:
      return "js";
  }
}

function configRequireModulePath(specifier: string, modulePath: string): string {
  return JSONStringify([specifier, toFileUrl(modulePath).href]);
}

function configRequireModuleSource(path: string): string {
  const binding = JSONParse(path);
  if (
    !ArrayIsArray(binding) || binding.length !== 2 ||
    typeof binding[0] !== "string" || typeof binding[1] !== "string"
  ) {
    throw new TypeError("Staged CommonJS require binding is invalid");
  }
  return [
    'import { createRequire as __veryfrontCreateRequire } from "node:module";',
    `module.exports = __veryfrontCreateRequire(${configCodeLiteral(binding[1])})(${
      configCodeLiteral(binding[0])
    });`,
  ].join("\n");
}

async function isCommonJsConfigModule(
  fs: ReturnType<typeof createFileSystem>,
  modulePath: string,
): Promise<boolean> {
  const extension = extname(modulePath);
  if (extension === ".cjs" || extension === ".cts") return true;
  if (extension !== ".js" && extension !== ".ts") return false;

  let current = dirname(modulePath);
  while (true) {
    try {
      const manifest = JSONParse(
        stripConfigPackageManifestBom(await fs.readTextFile(join(current, "package.json"))),
      ) as {
        type?: unknown;
      };
      return manifest.type !== "module";
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    const parent = dirname(current);
    if (parent === current) return true;
    current = parent;
  }
}

async function bindCommonJsConfigModuleLocations(
  fs: ReturnType<typeof createFileSystem>,
  source: string,
  modulePath: string,
  reachedFromCommonJs = false,
): Promise<string> {
  if (!reachedFromCommonJs && !(await isCommonJsConfigModule(fs, modulePath))) {
    return source;
  }

  const requireName = uniqueConfigHelperName(source, "require");
  const recordRequireName = uniqueConfigHelperName(
    `${source}\n${requireName}`,
    "record_require",
  );
  const rewrittenRequire = await rewriteUnboundCommonJsDynamicRequire(
    source,
    requireName,
    recordRequireName,
  );
  if (rewrittenRequire === null) {
    throw new TypeError("Computed CommonJS requires could not be bound to their source module");
  }
  const usesModule = await usesUnboundCommonJsModule(source);
  if (usesModule === null) {
    throw new TypeError("CommonJS module locations could not be bound to their source module");
  }
  const usesProjectRequire = ReflectApply(
    StringPrototypeIncludes,
    rewrittenRequire,
    [requireName],
  ) as boolean;
  let prelude = "";
  let modulePathsDeclaration = "";
  if (usesProjectRequire || usesModule) {
    const createRequireName = uniqueConfigHelperName(
      `${source}\n${requireName}\n${recordRequireName}`,
      "create_require",
    );
    const moduleConstructorName = uniqueConfigHelperName(
      `${source}\n${requireName}\n${recordRequireName}\n${createRequireName}`,
      "module_constructor",
    );
    const nativeRequireName = uniqueConfigHelperName(
      `${source}\n${requireName}\n${recordRequireName}\n${createRequireName}\n${moduleConstructorName}`,
      "native_require",
    );
    const nativeModuleName = uniqueConfigHelperName(
      `${source}\n${requireName}\n${recordRequireName}\n${createRequireName}\n${moduleConstructorName}\n${nativeRequireName}`,
      "native_module",
    );
    const requireCacheName = uniqueConfigHelperName(
      `${source}\n${requireName}\n${recordRequireName}\n${createRequireName}\n${moduleConstructorName}\n${nativeRequireName}\n${nativeModuleName}`,
      "require_cache",
    );
    const requireRegistryName = uniqueConfigHelperName(
      `${source}\n${requireName}\n${recordRequireName}\n${createRequireName}\n${nativeRequireName}\n${requireCacheName}`,
      "require_registry",
    );
    const resolveRequireName = uniqueConfigHelperName(
      `${source}\n${requireName}\n${recordRequireName}\n${createRequireName}\n${nativeRequireName}\n${requireCacheName}\n${requireRegistryName}`,
      "resolve_require",
    );
    prelude =
      `import { createRequire as ${createRequireName}, Module as ${moduleConstructorName} } from "node:module";\n` +
      `const ${nativeRequireName} = ${createRequireName}(${
        configCodeLiteral(toFileUrl(modulePath).href)
      });\n` +
      `const ${nativeModuleName} = new ${moduleConstructorName}(${
        configCodeLiteral(modulePath)
      });\n` +
      `${nativeModuleName}.filename = ${configCodeLiteral(modulePath)};\n` +
      `${nativeModuleName}.paths = ${moduleConstructorName}._nodeModulePaths(${
        configCodeLiteral(dirname(modulePath))
      });\n`;
    prelude += `let ${requireCacheName};\n` +
      `let ${requireRegistryName};\n` +
      `const ${resolveRequireName} = (specifier) => {\n` +
      (usesModule ? `  ${nativeModuleName}.paths = module.paths;\n` : "") +
      `  try { return ${moduleConstructorName}._resolveFilename(specifier, ${nativeModuleName}); } catch { return specifier; }\n` +
      `};\n` +
      `const ${requireName} = (specifier) => {\n` +
      `  const resolved = ${resolveRequireName}(specifier);\n` +
      `  let entry = ${requireCacheName};\n` +
      `  while (entry !== undefined) {\n` +
      `    if (entry.resolved === resolved) return entry.value;\n` +
      `    entry = entry.next;\n` +
      `  }\n` +
      `  entry = ${requireRegistryName};\n` +
      `  while (entry !== undefined) {\n` +
      `    if (entry.resolved === resolved) {\n` +
      `      const value = entry.load();\n` +
      `      ${requireCacheName} = { resolved, value, next: ${requireCacheName} };\n` +
      `      return value;\n` +
      `    }\n` +
      `    entry = entry.next;\n` +
      `  }\n` +
      (usesModule ? `  ${nativeModuleName}.paths = module.paths;\n` : "") +
      `  const value = ${nativeModuleName}.require(specifier);\n` +
      `  ${requireCacheName} = { resolved, value, next: ${requireCacheName} };\n` +
      `  return value;\n` +
      `};\n` +
      `${requireName}.resolve = ${resolveRequireName};\n` +
      `${requireName}.resolve.paths = ${nativeRequireName}.resolve.paths;\n` +
      `${requireName}.cache = ${nativeRequireName}.cache;\n` +
      `${requireName}.extensions = ${nativeRequireName}.extensions;\n` +
      `${requireName}.main = ${nativeRequireName}.main;\n` +
      `const ${recordRequireName} = (specifier, load) => {\n` +
      `  const resolved = ${resolveRequireName}(specifier);\n` +
      `  let entry = ${requireRegistryName};\n` +
      `  while (entry !== undefined) {\n` +
      `    if (entry.resolved === resolved) return;\n` +
      `    entry = entry.next;\n` +
      `  }\n` +
      `  ${requireRegistryName} = { resolved, load, next: ${requireRegistryName} };\n` +
      `};\n`;
    if (usesModule) modulePathsDeclaration = `module.paths = ${nativeModuleName}.paths;\n`;
  }

  const usesFilename = ReflectApply(StringPrototypeIncludes, source, ["__filename"]) as boolean;
  const usesDirname = ReflectApply(StringPrototypeIncludes, source, ["__dirname"]) as boolean;
  if (!usesFilename && !usesDirname && !usesModule) {
    if (!ReflectApply(StringPrototypeStartsWith, rewrittenRequire, ["#!"]) as boolean) {
      return prelude + rewrittenRequire;
    }
    const lineEnd = ReflectApply(StringPrototypeIndexOf, rewrittenRequire, ["\n"]) as number;
    return lineEnd < 0
      ? `${rewrittenRequire}\n${prelude}`
      : ReflectApply(StringPrototypeSlice, rewrittenRequire, [0, lineEnd + 1]) as string +
        prelude +
        (ReflectApply(StringPrototypeSlice, rewrittenRequire, [lineEnd + 1]) as string);
  }

  let declarations = usesModule
    ? `module.filename = ${configCodeLiteral(modulePath)};\n` +
      `module.path = ${configCodeLiteral(dirname(modulePath))};\n` +
      modulePathsDeclaration +
      `module.require = ${requireName};`
    : "";
  if (usesFilename) {
    if (declarations.length > 0) declarations += "\n";
    declarations += `var __filename = ${configCodeLiteral(modulePath)};`;
  }
  if (usesDirname) {
    if (declarations.length > 0) declarations += "\n";
    declarations += `var __dirname = ${configCodeLiteral(dirname(modulePath))};`;
  }
  if (!ReflectApply(StringPrototypeStartsWith, rewrittenRequire, ["#!"]) as boolean) {
    return `${prelude}${declarations}\n${rewrittenRequire}`;
  }
  const lineEnd = ReflectApply(StringPrototypeIndexOf, rewrittenRequire, ["\n"]) as number;
  if (lineEnd < 0) return `${rewrittenRequire}\n${prelude}${declarations}\n`;
  const before = ReflectApply(StringPrototypeSlice, rewrittenRequire, [0, lineEnd + 1]) as string;
  const after = ReflectApply(StringPrototypeSlice, rewrittenRequire, [lineEnd + 1]) as string;
  return `${before}${prelude}${declarations}\n${after}`;
}

function isConfigSourceModule(path: string): boolean {
  switch (extname(path)) {
    case ".cjs":
    case ".cts":
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".mts":
    case ".ts":
    case ".tsx":
      return true;
    default:
      return false;
  }
}

async function linkedWorkspaceConfigRoot(
  fs: ReturnType<typeof createFileSystem>,
  specifier: string,
  importer: string,
  resolvedPath: string,
): Promise<string | null> {
  if (!isConfigSourceModule(resolvedPath)) return null;
  const parsed = parseBarePackageSpecifier(specifier);
  if (!parsed || parsed.version !== null) return null;
  const lstat = fs.lstat?.bind(fs);
  if (!lstat) throw new TypeError("Config package link inspection is unavailable");

  let current = dirname(importer);
  while (true) {
    const packagePath = join(current, "node_modules", parsed.packageName);
    try {
      const stat = await lstat(packagePath);
      if (stat.isSymlink) {
        const packageTarget = await realPath(packagePath);
        return isPathContainedBy(resolvedPath, packageTarget) ? packageTarget : null;
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function containingConfigGraphRoot(
  roots: Map<string, true>,
  path: string,
): string | null {
  let containingRoot: string | null = null;
  mapForEach(roots, (_present, root) => {
    if (containingRoot === null && isPathContainedBy(path, root)) containingRoot = root;
  });
  return containingRoot;
}

function markCommonJsFallbackConfigModule(modules: Map<string, true>, path: string): void {
  const extension = extname(path);
  if (extension === ".jsx" || extension === ".ts" || extension === ".tsx") {
    mapSet(modules, path, true);
  }
}

/** @internal Bundle a trusted local TypeScript config module graph for staged import. */
export async function bundleProjectConfigSourceForImport(
  source: string,
  configPath: string,
): Promise<string> {
  const { build: bundle } = await import("veryfront/extensions/bundler");
  const fs = createFileSystem();
  const lexicalConfigPath = resolve(configPath);
  const lexicalConfigDir = dirname(lexicalConfigPath);
  let canonicalConfigPath = lexicalConfigPath;
  let configDir = await realPath(lexicalConfigDir);
  try {
    canonicalConfigPath = await realPath(lexicalConfigPath);
    configDir = dirname(canonicalConfigPath);
  } catch {
    // Tests and virtual callers may stage trusted source before the config file
    // exists on disk. Keep that existing path while still canonicalizing real
    // symlinked entries.
  }
  const entryLoader = configSourceLoader(canonicalConfigPath);
  if (entryLoader === "ts" || entryLoader === "tsx") {
    await rejectComputedConfigDynamicImports(source);
  }
  const result = await bundle({
    bundle: true,
    write: false,
    format: "esm",
    platform: isNode ? "node" : "neutral",
    conditions: CONFIG_NODE_BUNDLE_CONDITIONS,
    mainFields: ["main"],
    target: "es2022",
    plugins: [{
      name: "veryfront-project-config-externals",
      setup(build) {
        const linkedWorkspaceRoots = new IntrinsicMap<string, true>();
        const commonJsConfigModules = new IntrinsicMap<string, true>();
        const isCommonJsConfigGraphModule = async (modulePath: string) =>
          mapGet(commonJsConfigModules, modulePath) === true ||
          await isCommonJsConfigModule(fs, modulePath);
        const bindExternalCommonJsRequire = (specifier: string, importer: string) => ({
          path: configRequireModulePath(specifier, importer || canonicalConfigPath),
          namespace: CONFIG_BUNDLE_REQUIRE_NAMESPACE,
        });
        const resolveImportMetaSpecifier: ImportMetaSpecifierResolver = async (
          specifier,
          moduleUrl,
        ) => {
          const directUrl = resolveConfigImportMetaUrl(specifier, moduleUrl);
          if (directUrl !== null) return directUrl;
          if (isNodeBuiltinPackageName(specifier)) return `node:${specifier}`;
          const modulePath = fromFileUrl(moduleUrl);
          if (!build.resolve) {
            return await resolveConfigImportMetaWithBundler(bundle, specifier, modulePath);
          }
          const resolution = await resolveLiteralConfigPackageImport(
            specifier,
            modulePath,
          );
          const resolutionSpecifier = resolution.specifier;
          if (
            ReflectApply(StringPrototypeStartsWith, resolutionSpecifier, ["node:"]) as boolean ||
            ReflectApply(StringPrototypeStartsWith, resolutionSpecifier, ["file:"]) as boolean
          ) {
            return resolutionSpecifier;
          }
          const packageExport = await resolveLiteralConfigPackageExport(
            resolutionSpecifier,
            resolution.modulePath,
          );
          if (packageExport !== null) return packageExport;
          const resolved = await build.resolve(resolutionSpecifier, {
            importer: resolution.modulePath,
            kind: "import-statement",
            namespace: "file",
            resolveDir: dirname(resolution.modulePath),
            pluginData: CONFIG_BUNDLE_RESOLVE_PLUGIN_DATA,
          });
          const firstError = resolved.errors?.[0]?.text;
          if (firstError) throw configImportMetaResolveError(firstError);
          if (!resolved.path) return null;
          if (isNodeBuiltinPackageName(resolved.path)) return `node:${resolved.path}`;
          const absoluteResolvedPath = isAbsolute(resolved.path)
            ? resolved.path
            : resolve(dirname(resolution.modulePath), resolved.path);
          const containedPath = await resolveContainedBundlerConfigPackagePath(
            specifier,
            modulePath,
            absoluteResolvedPath,
          );
          return `${asResolvedConfigSpecifier(containedPath)}${resolved.suffix ?? ""}`;
        };

        build.onResolve({ filter: /^veryfront:project-config-entry$/ }, (args) => {
          if (args.path !== CONFIG_BUNDLE_ENTRY_SPECIFIER) return;
          return { path: canonicalConfigPath, namespace: CONFIG_BUNDLE_ENTRY_NAMESPACE };
        });
        build.onLoad(
          { filter: /.*/, namespace: CONFIG_BUNDLE_ENTRY_NAMESPACE },
          async () => {
            const boundSource = await bindCommonJsConfigModuleLocations(
              fs,
              source,
              canonicalConfigPath,
              false,
            );
            const locatedSource = await rewriteProjectConfigModuleLocations(
              boundSource,
              canonicalConfigPath,
              resolveImportMetaSpecifier,
            );
            const loader = configSourceLoader(canonicalConfigPath);
            if (loader === "ts" || loader === "tsx") {
              await rejectComputedConfigDynamicImports(locatedSource);
            }
            return {
              contents: loader === "ts" || loader === "tsx"
                ? locatedSource
                : await rewriteComputedStagedConfigImports(
                  locatedSource,
                  toFileUrl(canonicalConfigPath).href,
                ),
              loader,
              resolveDir: configDir,
            };
          },
        );
        build.onLoad(
          { filter: /.*/, namespace: CONFIG_BUNDLE_SHIM_NAMESPACE },
          () => ({ contents: VERYFRONT_CONFIG_SHIM_SOURCE, loader: "js" }),
        );
        build.onLoad(
          { filter: /.*/, namespace: CONFIG_BUNDLE_REQUIRE_NAMESPACE },
          (args) => ({ contents: configRequireModuleSource(args.path), loader: "js" }),
        );
        build.onLoad({ filter: /\.[cm]?[jt]sx?$/, namespace: "file" }, async (args) => {
          const moduleSource = await fs.readTextFile(args.path);
          const reachedFromCommonJs = mapGet(commonJsConfigModules, args.path) === true;
          const boundSource = await bindCommonJsConfigModuleLocations(
            fs,
            moduleSource,
            args.path,
            reachedFromCommonJs,
          );
          const contents = await rewriteProjectConfigModuleLocations(
            boundSource,
            args.path,
            resolveImportMetaSpecifier,
            args.suffix ?? "",
          );
          const loader = configSourceLoader(args.path);
          if (loader === "ts" || loader === "tsx") {
            await rejectComputedConfigDynamicImports(contents);
          }
          const preparedContents = loader === "ts" || loader === "tsx"
            ? contents
            : await rewriteComputedStagedConfigImports(
              contents,
              `${toFileUrl(args.path).href}${args.suffix ?? ""}`,
            );
          if (preparedContents === moduleSource) return;
          return {
            contents: preparedContents,
            loader,
            resolveDir: dirname(args.path),
          };
        });
        build.onResolve({ filter: /.*/ }, async (args) => {
          if (args.pluginData === CONFIG_BUNDLE_RESOLVE_PLUGIN_DATA) return;
          if (args.path === CONFIG_BUNDLE_ENTRY_SPECIFIER) return;
          if (args.path === "veryfront" && args.kind === "require-call") {
            return { path: args.path, namespace: CONFIG_BUNDLE_SHIM_NAMESPACE };
          }
          const commonJsRequire = args.kind === "require-call" &&
            await isCommonJsConfigGraphModule(args.importer || canonicalConfigPath);
          const useNativeCommonJsRequire = async (modulePath: string): Promise<boolean> => {
            const extension = extname(modulePath);
            return commonJsRequire && extension === ".node";
          };
          const fileUrl = await resolveConfigFileUrl(args.path, configDir, lexicalConfigDir);
          if (fileUrl.kind === "bundle") {
            if (await useNativeCommonJsRequire(fileUrl.path)) {
              return bindExternalCommonJsRequire(args.path, args.importer);
            }
            if (commonJsRequire) {
              markCommonJsFallbackConfigModule(commonJsConfigModules, fileUrl.path);
            }
            return { path: fileUrl.path, namespace: "file", suffix: fileUrl.suffix };
          }
          if (fileUrl.kind === "external") {
            return commonJsRequire
              ? bindExternalCommonJsRequire(args.path, args.importer)
              : { path: fileUrl.specifier, external: true };
          }
          if (args.path === "veryfront" || keepsConfigImportSpecifier(args.path)) {
            return commonJsRequire
              ? bindExternalCommonJsRequire(args.path, args.importer)
              : { path: args.path, external: true };
          }
          if (isNodeBuiltinPackageName(args.path)) {
            return commonJsRequire
              ? bindExternalCommonJsRequire(args.path, args.importer)
              : { path: `node:${args.path}`, external: true };
          }

          if (!build.resolve) return;
          const resolved = await build.resolve(args.path, {
            importer: args.importer,
            kind: args.kind,
            namespace: args.namespace === CONFIG_BUNDLE_ENTRY_NAMESPACE ? "file" : args.namespace,
            resolveDir: args.resolveDir,
            pluginData: CONFIG_BUNDLE_RESOLVE_PLUGIN_DATA,
          });
          const firstError = resolved.errors?.[0]?.text;
          if (firstError) throw new TypeError(firstError);
          if (!resolved.path) throw new TypeError("Config dependency resolution failed");
          let resolvedPath = isAbsolute(resolved.path)
            ? await realPath(resolved.path)
            : resolved.path;
          let packageImportTarget: string | undefined;
          if (
            isAbsolute(resolvedPath) &&
            ReflectApply(StringPrototypeStartsWith, args.path, ["#"]) as boolean
          ) {
            const packageImport = await resolveBundlerConfigPackageImport(
              args.path,
              args.importer || configPath,
              resolvedPath,
              commonJsRequire ? CONFIG_NODE_REQUIRE_CONDITIONS : CONFIG_NODE_IMPORT_CONDITIONS,
            );
            packageImportTarget = packageImport.target;
            resolvedPath = packageImport.path;
          }
          if (
            isAbsolute(resolvedPath) &&
            isPathContainedBy(resolvedPath, configDir) &&
            !isConfigDependencyPath(resolvedPath, configDir)
          ) {
            if (await useNativeCommonJsRequire(resolvedPath)) {
              return bindExternalCommonJsRequire(args.path, args.importer);
            }
            if (commonJsRequire && extname(resolvedPath) === ".node") {
              return bindExternalCommonJsRequire(args.path, args.importer);
            }
            if (commonJsRequire) {
              markCommonJsFallbackConfigModule(commonJsConfigModules, resolvedPath);
            }
            return {
              path: resolvedPath,
              namespace: resolved.namespace,
              suffix: resolved.suffix,
            };
          }
          if (isAbsolute(resolvedPath)) {
            const graphRoot = containingConfigGraphRoot(linkedWorkspaceRoots, resolvedPath);
            if (graphRoot !== null && !isConfigDependencyPath(resolvedPath, graphRoot)) {
              if (await useNativeCommonJsRequire(resolvedPath)) {
                return bindExternalCommonJsRequire(args.path, args.importer);
              }
              if (commonJsRequire && extname(resolvedPath) === ".node") {
                return bindExternalCommonJsRequire(args.path, args.importer);
              }
              if (commonJsRequire) {
                markCommonJsFallbackConfigModule(commonJsConfigModules, resolvedPath);
              }
              return {
                path: resolvedPath,
                namespace: resolved.namespace ?? "file",
                suffix: resolved.suffix,
              };
            }
          }
          const linkedRoot = isAbsolute(resolvedPath)
            ? await linkedWorkspaceConfigRoot(
              fs,
              args.path,
              args.importer || configPath,
              resolvedPath,
            )
            : null;
          if (linkedRoot !== null) {
            mapSet(linkedWorkspaceRoots, linkedRoot, true);
            if (await useNativeCommonJsRequire(resolvedPath)) {
              return bindExternalCommonJsRequire(args.path, args.importer);
            }
            if (commonJsRequire && extname(resolvedPath) === ".node") {
              return bindExternalCommonJsRequire(args.path, args.importer);
            }
            if (commonJsRequire) {
              markCommonJsFallbackConfigModule(commonJsConfigModules, resolvedPath);
            }
            return {
              path: resolvedPath,
              namespace: resolved.namespace ?? "file",
              suffix: resolved.suffix,
            };
          }
          if (
            isAbsolute(resolvedPath) &&
            isProjectConfigGraphSpecifier(args.path, packageImportTarget)
          ) {
            if (!isPathContainedBy(resolvedPath, configDir)) {
              throw new TypeError("Config import resolves outside the project directory");
            }
          }
          if (commonJsRequire) {
            return bindExternalCommonJsRequire(args.path, args.importer);
          }
          return {
            path: keepsConfigImportSpecifier(resolvedPath)
              ? resolvedPath
              : toFileUrl(resolvedPath).href,
            suffix: resolved.suffix,
            external: true,
          };
        });
      },
    }],
    entryPoints: [CONFIG_BUNDLE_ENTRY_SPECIFIER],
  });
  const firstError = result.errors[0]?.text;
  if (firstError) throw new TypeError(firstError);

  const output = result.outputFiles[0];
  if (!output) throw new TypeError("Config bundler did not produce JavaScript output");
  return output.text;
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
 * directory would leave them cached -- and stale -- across config reloads. The
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

  const needsStagedConfigImport = isDenoCompiled || isNode;

  // Compiled Deno binaries can't import project files, and Node.js 22.3 can't
  // import TypeScript anywhere in a JavaScript config's dependency graph. Read
  // the source, transpile when needed, and stage one temporary module with
  // imports resolved from the original project.
  if (needsStagedConfigImport) {
    logger.debug("Using staged config import", {
      configPath,
      isDenoCompiled,
      isNode,
    });
    const fs = createFileSystem();
    const source = await fs.readTextFile(configPath);
    const absolutePath = resolve(configPath);

    const userConfig = await loadConfigFromTempFile(
      source,
      absolutePath,
      (tempFile) => ReflectApply(intrinsicUrlHrefGetter, toFileUrl(tempFile), []) as string,
      (processedSource) => rewriteProjectConfigImportsFromProject(processedSource, absolutePath),
      true,
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
  configUrl.searchParams.set(
    "t",
    `${Date.now()}-${ReflectApply(CryptoRandomUUID, IntrinsicCrypto, []) as string}`,
  );
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
