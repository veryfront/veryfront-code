import type { VeryfrontConfig } from "./schemas/index.ts";
import { validateVeryfrontConfig } from "./schemas/index.ts";
import { extname, join, resolve, toFileUrl } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  isExtendedFSAdapter,
  isVirtualFilesystem,
} from "#veryfront/platform/adapters/fs/wrapper.ts";
import { isBun, isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";
import { ESBUILD_WASM_URL } from "#veryfront/platform/compat/esbuild-shared.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { sanitizeUrlCredentials } from "#veryfront/utils/logger/redact.ts";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { DEFAULT_CACHE_DIR } from "#veryfront/utils/constants/server.ts";
import { buildConfigCacheKey, type VirtualConfigSourceContext } from "#veryfront/cache/keys.ts";
import { DEFAULT_PORT, DEFAULT_RENDER_CACHE_MAX_ENTRIES } from "./defaults.ts";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import {
  CACHE_INVARIANT_VIOLATION,
  CONFIG_PARSE_ERROR,
  CONFIG_VALIDATION_FAILED,
  INITIALIZATION_ERROR,
  SERVICE_OVERLOADED,
} from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache/registry.ts";
import { VERYFRONT_CONFIG_FILES } from "./config-files.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import type { ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";
import { tryResolve as tryResolveContract } from "#veryfront/extensions/contracts.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
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

// Capture the collection and reflection intrinsics before trusted executable
// project configuration can mutate the shared host realm. Hosted configuration
// crosses a tenant boundary later in the same process, so its cache identity,
// singleflight state, and immutable result must not depend on ambient methods.
const IntrinsicMap = Map;
const IntrinsicPromise = Promise;
const IntrinsicTextDecoder = TextDecoder;
const IntrinsicWeakMap = WeakMap;
const IntrinsicWeakSet = WeakSet;
const IntrinsicAbortController = AbortController;
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
const ReflectDeleteProperty = Reflect.deleteProperty;
const ReflectOwnKeys = Reflect.ownKeys;
const SymbolSpecies = Symbol.species;
const TextDecoderPrototypeDecode = TextDecoder.prototype.decode;
const WeakMapPrototypeGet = WeakMap.prototype.get;
const WeakMapPrototypeSet = WeakMap.prototype.set;
const WeakSetPrototypeAdd = WeakSet.prototype.add;
const WeakSetPrototypeHas = WeakSet.prototype.has;
const abortControllerSignalGetter = ObjectGetOwnPropertyDescriptor(
  AbortController.prototype,
  "signal",
)?.get;
const abortSignalAbortedGetter = ObjectGetOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const mapSizeGetter = ObjectGetOwnPropertyDescriptor(Map.prototype, "size")?.get;

if (
  typeof abortControllerSignalGetter !== "function" ||
  typeof abortSignalAbortedGetter !== "function" ||
  typeof mapSizeGetter !== "function"
) {
  throw new TypeError("Loader lifecycle intrinsics are unavailable");
}
const intrinsicAbortControllerSignalGetter = abortControllerSignalGetter as () => AbortSignal;
const intrinsicAbortSignalAbortedGetter = abortSignalAbortedGetter as () => boolean;
const intrinsicMapSizeGetter = mapSizeGetter as () => number;
const HOSTED_CONFIG_TEXT_DECODER_OPTIONS = createHostedConfigTextDecoderOptions();
const ABORT_LISTENER_OPTIONS = createAbortListenerOptions();
const SAFE_PROMISE_SPECIES_HOLDER = createSafePromiseSpeciesHolder();

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

interface ConfigCacheEntry {
  readonly revision: number;
  readonly config: VeryfrontConfig;
  readonly provenance: ConfigLoadProvenance;
}

const configCacheByProject = new LRUCache<string, ConfigCacheEntry>({
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

// Register cache for monitoring
registerLRUCache("config-cache", configCacheByProject);

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
  return null;
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
  const promise = thenPromise(start.promise, operation) as unknown as Promise<
    HostedConfigSourceSelection | null
  >;
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

function createHostedConfigFlight(
  flightKey: string,
  hostedCacheKey: string,
  payload: PreparedDeclarativeConfigWorkerPayload,
  usePersistentCache: boolean,
  revisionAtStart: number,
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
    const merged = deepFreezeHostedConfig(validateAndMergeConfig(snapshot));
    throwIfHostedConfigAborted(controllerSignal);
    if (usePersistentCache && cacheRevision === revisionAtStart) {
      configCacheByProject.set(hostedCacheKey, {
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

  return CONFIG_PARSE_ERROR.create({
    detail: `Hosted configuration rejected (${error.code}: ${error.reason})`,
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
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
    ? error
    : undefined;
  if (message === undefined) return undefined;
  const redacted = sanitizeUrlCredentials(message);
  const firstLine = redacted.split("\n", 1)[0]?.replace(CONTROL_CHARACTERS, " ").trim() ?? "";
  if (firstLine.length === 0) return undefined;
  return firstLine.length > MAX_CONFIG_LOAD_CAUSE_CHARACTERS
    ? `${firstLine.slice(0, MAX_CONFIG_LOAD_CAUSE_CHARACTERS - 1)}…`
    : firstLine;
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

async function loadConfigFromTempFile(
  source: string,
  configPath: string,
  loadUrl: (tempFile: string) => string,
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
      await rewriteBareVeryfrontConfigImports(processedSource),
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

let fallbackModuleLexerPromise: Promise<ModuleLexer> | undefined;

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

      const flight = getOrCreateHostedConfigFlight(
        hostedCacheKey,
        payload,
        usePersistentCache,
        revisionAtStart,
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

async function loadAndMergeConfig(
  configPath: string,
  cacheKey: string,
  adapter: RuntimeAdapter,
  selectedVirtualContent?: string | Uint8Array,
): Promise<VeryfrontConfig> {
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
    return loadTrustedConfigFromVirtualFS(
      configPath,
      cacheKey,
      adapter,
      selectedVirtualContent,
    );
  }

  // Bun and compiled Deno binaries can't dynamically import TypeScript files directly.
  // We need to read the source, write to a temp file, and import from there.
  if (isBun || isDenoCompiled) {
    logger.debug("Using temp file import for Bun/compiled Deno", {
      configPath,
      isBun,
      isDenoCompiled,
    });
    const fs = createFileSystem();
    const source = await fs.readTextFile(configPath);

    const userConfig = await loadConfigFromTempFile(
      source,
      configPath,
      (tempFile) => toFileUrl(tempFile).href,
    );
    logger.debug("Successfully loaded config via temp file", {
      configPath,
      hasApp: !!(userConfig as Record<string, unknown>)?.app,
      hasRouter: !!(userConfig as Record<string, unknown>)?.router,
    });
    return validateAndMergeConfig(userConfig);
  }

  const absolutePath = resolve(configPath);
  const configUrl = toFileUrl(absolutePath);
  configUrl.searchParams.set("t", `${Date.now()}-${crypto.randomUUID()}`);
  const configModule = await import(configUrl.href);
  return validateAndMergeConfig(selectConfigModuleValue(configModule));
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
  }>;
}

function getVirtualConfigSourceContext(): VirtualConfigSourceContext | undefined {
  const source = getCurrentRequestContext();
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
  actual: ReturnType<typeof getCurrentRequestContext>,
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
        assertMatchingHostedProjectIdentity(options!.cacheKey!, getCurrentRequestContext());
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
                throw CONFIG_PARSE_ERROR.create({
                  detail: configLoadFailureDetail(configFile, error),
                  cause: error,
                  context: { configFile },
                });
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
            const merged = await loadAndMergeConfig(
              configPath,
              effectiveCacheKey,
              adapter,
              trustedVirtualContent,
            );
            const provenance = configFileProvenance(configFile);
            if (usePersistentCache && cacheRevision === revisionAtStart) {
              configCacheByProject.set(effectiveCacheKey, {
                revision: revisionAtStart,
                config: merged,
                provenance,
              });
            }
            logger.debug("Successfully loaded config", {
              configFile,
              hasApp: !!merged.app,
              hasLayout: !!(merged as Record<string, unknown>).layout,
              configKeys: Object.keys(merged),
            });
            return createConfigLoadResult(merged, provenance);
          } catch (error) {
            if (isPreservedConfigLoadError(error)) throw error;
            logger.warn("Failed to load config file", { configFile });
            throw CONFIG_PARSE_ERROR.create({
              detail: configLoadFailureDetail(configFile, error),
              cause: error,
              context: { configFile },
            });
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
          configCacheByProject.set(effectiveCacheKey, {
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
    throw CONFIG_PARSE_ERROR.create({
      detail: configLoadFailureDetail(options.source.fileName, error),
      cause: error,
      context: { configFile: options.source.fileName },
    });
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
  return cached.config;
}
