import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { basename, relative } from "#veryfront/compat/path/index.ts";
import type { OnLoadArgs, OnResolveArgs, Plugin, PluginBuild } from "veryfront/extensions/bundler";
import { buildImportMapJson } from "#veryfront/html";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getDirectory, getEsbuildLoader, isWithinDirectory } from "#veryfront/utils/path-utils.ts";
import {
  createBareExternalPlugin,
  createHttpExternalPlugin,
  createRelativeFsPlugin,
} from "#veryfront/server/handlers/dev/files/esbuild-plugins.ts";
import {
  describeBrowserModuleBoundaryViolation,
  inspectBrowserModuleBoundary,
} from "./browser-module-boundary.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import type {
  DependencyPinningSource,
  DependencyPinningSourceInput,
} from "#veryfront/transforms/esm/package-registry.ts";
import { resolveRequestedDependencyPinningSnapshot } from "#veryfront/transforms/esm/package-registry.ts";
import { PermitSemaphore } from "#veryfront/utils/permit-semaphore.ts";
import { waitForSharedPromise } from "#veryfront/utils/singleflight.ts";
import { createAbortError, throwIfAborted } from "#veryfront/utils/abort.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import {
  captureFileSystemCapabilities,
  captureSnapshotReadCapability,
  copyFixedUint8ArrayWithinLimit,
  getFixedUint8ArrayByteLength,
} from "#veryfront/platform/adapters/file-system-capabilities.ts";
import {
  isNativeErrorWithoutHooks,
  readNativeErrorNameWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";
import {
  hasClientFileName,
  hasUseClientDirective,
  hasUseServerDirective,
} from "#veryfront/rendering/rsc/page-island.ts";

export interface BrowserModuleBundleLimits {
  maxDependencies: number;
  maxAggregateInputBytes: number;
  maxOutputBytes: number;
  maxResolutionProbes: number;
  maxDurationMs: number;
  maxConcurrentPerIdentity: number;
  maxQueuedPerIdentity: number;
}

export type BrowserModuleBundleLimitOverrides = Partial<
  Pick<
    BrowserModuleBundleLimits,
    | "maxDependencies"
    | "maxAggregateInputBytes"
    | "maxOutputBytes"
    | "maxResolutionProbes"
    | "maxDurationMs"
  >
>;

/** Hard production ceilings for request-triggered browser compilation. */
export const DEFAULT_BROWSER_MODULE_BUNDLE_LIMITS: Readonly<BrowserModuleBundleLimits> = Object
  .freeze({
    maxDependencies: 1_000,
    maxAggregateInputBytes: 16 * 1024 * 1024,
    maxOutputBytes: 16 * 1024 * 1024,
    maxResolutionProbes: 10_000,
    maxDurationMs: 10_000,
    maxConcurrentPerIdentity: 2,
    maxQueuedPerIdentity: 8,
  });

/** Isolate-wide ceiling that cannot be raised by a project or caller. */
export const MAX_CONCURRENT_BROWSER_MODULE_BUNDLES = 8;
/** Isolate-wide queue ceiling that cannot be raised by a project or caller. */
export const MAX_QUEUED_BROWSER_MODULE_BUNDLES = 32;

export type BrowserModuleBundleFailureKind = "capacity" | "deadline" | "limit";

export class BrowserModuleBundleError extends Error {
  constructor(
    readonly kind: BrowserModuleBundleFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "BrowserModuleBundleError";
  }
}

/** Server-only syntax found while validating an otherwise admitted browser entry. */
export class BrowserModuleBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserModuleBoundaryError";
  }
}

/** Browser endpoint entry rejection that is safe to surface as not-found. */
export class BrowserModuleEntryRejectedError extends Error {
  constructor(cause?: unknown) {
    super("Browser module entry is not an admitted client boundary", { cause });
    this.name = "BrowserModuleEntryRejectedError";
  }
}

/** Requested dependency snapshot rejection that callers surface as a conflict. */
export class BrowserModuleDependencySnapshotError extends Error {
  constructor() {
    super("Unknown dependency snapshot");
    this.name = "BrowserModuleDependencySnapshotError";
  }
}

function createIgnoreCSSImportsPlugin(): Plugin {
  return {
    name: "veryfront-ignore-css-imports",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /\.css(?:\?.*)?$/ }, (args: OnResolveArgs) => ({
        path: args.path,
        namespace: "veryfront-empty-css",
      }));
      build.onLoad({ filter: /.*/, namespace: "veryfront-empty-css" }, (_args: OnLoadArgs) => ({
        contents: "",
        loader: "js",
      }));
    },
  };
}

export interface BrowserModuleBundlerOptions {
  adapter: RuntimeAdapter;
  projectDir: string;
  projectId?: string;
  config?: VeryfrontConfig;
  projectSlug?: string;
  importMapJson?: string;
  /** Absolute request origin used to identify same-origin module-map targets. */
  moduleServerOrigin?: string;
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  dependencyPinningSource?: DependencyPinningSourceInput;
  /** Resolve this request token only after browser-bundle admission is held. */
  requestedDependencyPinningCacheKey?: string;
  /** Caller cancellation is propagated into the bundler implementation. */
  signal?: AbortSignal;
  /** Stable request identity used to coalesce equivalent concurrent bundles. */
  singleflightKey?: string;
  /** Already-admitted entry snapshot. Avoids a second mutable filesystem read. */
  entrySource?: string;
  /** Content-derived identity required whenever entrySource is supplied. */
  entrySourceKey?: string;
  /** Require an explicit directive or `.client` filename on the entry source. */
  requireClientBoundary?: boolean;
  /** Optional tightening of the hard limits. Values above the defaults are rejected. */
  limits?: BrowserModuleBundleLimitOverrides;
}

export function getSafeBrowserModuleIdentity(absPath: string, projectDir: string): string {
  if (!isWithinDirectory(projectDir, absPath)) return `/${basename(absPath)}`;

  const projectRelativePath = relative(projectDir, absPath).replaceAll("\\", "/");
  return projectRelativePath === "." ? `/${basename(absPath)}` : `/${projectRelativePath}`;
}

type ResolutionProbeState = "file" | "directory" | "other" | "missing";

export interface BrowserModuleBundle {
  source: string;
  contentHash: string;
  importMapHash: string;
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  dependencies: ReadonlyArray<{ path: string; contentHash: string; byteLength: number }>;
  resolutionProbes: ReadonlyArray<{ path: string; state: ResolutionProbeState }>;
}

export type BrowserModuleImportMapValidationOptions = Pick<
  BrowserModuleBundlerOptions,
  | "config"
  | "moduleServerOrigin"
  | "dependencyPinningCacheKey"
  | "dependencyPinningDependencies"
  | "dependencyPinningSource"
>;

export interface BrowserModuleBundleValidationOptions extends
  Pick<
    BrowserModuleBundlerOptions,
    "adapter" | "projectDir" | "signal" | "limits"
  > {
  /** Rebuild and compare the effective import map through the same bounded reader. */
  importMap?: BrowserModuleImportMapValidationOptions;
}

interface TrackingAdapterResult {
  adapter: RuntimeAdapter;
  contents: Map<string, string>;
  probes: Map<string, ResolutionProbeState>;
  readSource(path: string): Promise<string>;
  readMetadataSource(path: string): Promise<string>;
  admitSource(path: string, content: string): void;
  chargeText(content: string): number;
  getFailure(): BrowserModuleBundleError | undefined;
}

interface AdmittedText {
  content: string;
  byteLength: number;
}

const apply = Reflect.apply;
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const decodeUtf8 = TextDecoder.prototype.decode;

function isNativeRangeError(value: unknown): boolean {
  return isNativeErrorWithoutHooks(value) &&
    readNativeErrorNameWithoutHooks(value) === "RangeError";
}

function isNativeTypeError(value: unknown): boolean {
  return isNativeErrorWithoutHooks(value) &&
    readNativeErrorNameWithoutHooks(value) === "TypeError";
}

function decodeBrowserModuleSource(bytes: Uint8Array): string {
  try {
    return apply(decodeUtf8, strictUtf8Decoder, [bytes]) as string;
  } catch (cause) {
    throw new TypeError("Browser module source must contain valid UTF-8", { cause });
  }
}

/**
 * Capture stable filesystem authority once. Native filesystems must provide a
 * root-bound no-follow snapshot read. A virtual filesystem may instead make
 * an own, immutable-in-contract declaration that it cannot traverse links and
 * provide a genuine exact bounded reader.
 */
function createBrowserModuleSourceReader(
  adapter: RuntimeAdapter,
  projectDir: string,
): (path: string, maximumBytes: number) => Promise<AdmittedText> {
  const snapshot = captureSnapshotReadCapability(
    adapter.fs,
    "Browser module filesystem",
  );
  if (snapshot) {
    return async (path: string, maximumBytes: number): Promise<AdmittedText> => {
      const bytes = await snapshot.read(path, projectDir, maximumBytes);
      return {
        content: decodeBrowserModuleSource(bytes),
        byteLength: getFixedUint8ArrayByteLength(bytes, "Browser module source"),
      };
    };
  }

  const semantics = Object.getOwnPropertyDescriptor(adapter.fs, "symlinkSemantics");
  if (semantics && "value" in semantics && semantics.value === "none") {
    const bounded = captureFileSystemCapabilities(
      adapter.fs,
      "Browser module filesystem",
      "bounded-text",
    );
    if (!bounded.readFileBytesWithinLimit && !bounded.wholeFileReader) {
      throw new TypeError(
        "Link-free browser module filesystem requires an exact bounded reader",
      );
    }
    return async (path: string, maximumBytes: number): Promise<AdmittedText> => {
      const bytes = bounded.readFileBytesWithinLimit
        ? await bounded.readFileBytesWithinLimit(path, maximumBytes)
        : bounded.wholeFileReader && bounded.wholeFileReader.maximumBytes <= maximumBytes
        ? copyFixedUint8ArrayWithinLimit(
          await bounded.wholeFileReader.read(path),
          maximumBytes,
          "Browser module source",
        )
        : (() => {
          throw new TypeError("Browser module source requires an exact bounded reader");
        })();
      return {
        content: decodeBrowserModuleSource(bytes),
        byteLength: getFixedUint8ArrayByteLength(bytes, "Browser module source"),
      };
    };
  }

  throw new TypeError(
    "Browser module filesystem requires a stable bounded snapshot reader",
  );
}

function requirePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function resolveLimits(
  overrides: BrowserModuleBundleLimitOverrides | undefined,
): BrowserModuleBundleLimits {
  const resolved = { ...DEFAULT_BROWSER_MODULE_BUNDLE_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(resolved)) {
    requirePositiveSafeInteger(value, `Browser module bundle limit ${name}`);
    const hardMaximum = DEFAULT_BROWSER_MODULE_BUNDLE_LIMITS[
      name as keyof BrowserModuleBundleLimits
    ];
    if (value > hardMaximum) {
      throw new RangeError(
        `Browser module bundle limit ${name} cannot exceed the production ceiling`,
      );
    }
    if (
      (name === "maxConcurrentPerIdentity" || name === "maxQueuedPerIdentity") &&
      value !== hardMaximum
    ) {
      throw new RangeError(
        `Browser module bundle admission limit ${name} is process-owned and cannot be overridden`,
      );
    }
  }
  return resolved;
}

function createTrackingAdapter(
  adapter: RuntimeAdapter,
  projectDir: string,
  limits: BrowserModuleBundleLimits,
  signal: AbortSignal,
): TrackingAdapterResult {
  const contents = new Map<string, string>();
  const probes = new Map<string, ResolutionProbeState>();
  const dependencyPaths = new Set<string>();
  const probePaths = new Set<string>();
  const sourceReads = new Map<string, Promise<string>>();
  const metadataReads = new Map<string, Promise<string>>();
  const statReads = new Map<string, Promise<Awaited<ReturnType<typeof adapter.fs.stat>>>>();
  const readBoundedSource = createBrowserModuleSourceReader(adapter, projectDir);
  let sourceReadTail = Promise.resolve();
  let failure: BrowserModuleBundleError | undefined;
  const fail = (message: string): never => {
    failure ??= new BrowserModuleBundleError("limit", message);
    throw failure;
  };
  let aggregateInputBytes = 0;
  const chargeText = (content: string): number => {
    const remaining = limits.maxAggregateInputBytes - aggregateInputBytes;
    const contentBytes = utf8ByteLength(content, remaining);
    if (contentBytes > remaining) {
      fail("Browser module bundle input exceeds the aggregate byte limit");
    }
    aggregateInputBytes += contentBytes;
    return contentBytes;
  };
  const reserveDependency = (path: string): void => {
    if (dependencyPaths.has(path)) return;
    if (dependencyPaths.size >= limits.maxDependencies) {
      fail("Browser module bundle exceeds the dependency limit");
    }
    dependencyPaths.add(path);
  };
  const admitSource = (path: string, content: string): void => {
    reserveDependency(path);
    if (contents.has(path)) return;
    chargeText(content);
    contents.set(path, content);
    sourceReads.set(path, Promise.resolve(content));
  };
  const readAccountedSource = (
    path: string,
    kind: "module" | "metadata",
  ): Promise<string> => {
    const reads = kind === "module" ? sourceReads : metadataReads;
    const existing = reads.get(path);
    if (existing) return existing;
    if (kind === "module") reserveDependency(path);
    const reading = sourceReadTail.then(async () => {
      throwIfAborted(signal);
      const remaining = limits.maxAggregateInputBytes - aggregateInputBytes;
      if (remaining <= 0) {
        fail("Browser module bundle input exceeds the aggregate byte limit");
      }
      let admitted: AdmittedText;
      try {
        admitted = await readBoundedSource(path, remaining);
      } catch (error) {
        if (isNativeRangeError(error)) {
          fail("Browser module bundle input exceeds the aggregate byte limit");
        }
        throw error;
      }
      throwIfAborted(signal);
      aggregateInputBytes += admitted.byteLength;
      if (kind === "module") contents.set(path, admitted.content);
      return admitted.content;
    });
    sourceReadTail = reading.then(
      () => undefined,
      () => undefined,
    );
    reads.set(path, reading);
    return reading;
  };
  const readSource = (path: string): Promise<string> => readAccountedSource(path, "module");
  const readMetadataSource = (path: string): Promise<string> =>
    readAccountedSource(path, "metadata");
  const trackedFs = new Proxy(adapter.fs, {
    get(target, property, receiver) {
      if (property === "readFile") {
        return readSource;
      }
      if (property === "stat") {
        return (path: string) => {
          const existing = statReads.get(path);
          if (existing) return existing;
          throwIfAborted(signal);
          if (!probePaths.has(path)) {
            if (probePaths.size >= limits.maxResolutionProbes) {
              fail("Browser module bundle exceeds the resolution probe limit");
            }
            probePaths.add(path);
          }
          const reading = (async () => {
            try {
              const info = await target.stat(path);
              throwIfAborted(signal);
              probes.set(
                path,
                info.isFile ? "file" : info.isDirectory ? "directory" : "other",
              );
              return info;
            } catch (error) {
              if (isCanonicalNotFoundError(error)) {
                probes.set(path, "missing");
              }
              throw error;
            }
          })();
          statReads.set(path, reading);
          return reading;
        };
      }

      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const trackedAdapter = new Proxy(adapter, {
    get(target, property, receiver) {
      if (property === "fs") return trackedFs;
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return {
    adapter: trackedAdapter,
    contents,
    probes,
    readSource,
    readMetadataSource,
    admitSource,
    chargeText,
    getFailure: () => failure,
  };
}

function createTrackedDependencyPinningSource(
  source: DependencyPinningSourceInput,
  projectDir: string,
  tracked: TrackingAdapterResult,
): DependencyPinningSource {
  const objectSource = typeof source === "object" && source !== null ? source : undefined;
  const sourceProjectDir = objectSource
    ? objectSource.projectDir
    : typeof source === "string"
    ? source
    : projectDir;
  const assertMetadataPath = (path: string): void => {
    if (!isWithinDirectory(projectDir, path)) {
      throw new TypeError("Browser module metadata path is not trusted");
    }
  };

  return Object.freeze({
    ...(objectSource ?? {}),
    projectDir: sourceProjectDir,
    fs: Object.freeze({
      stat: (path: string) => {
        assertMetadataPath(path);
        return tracked.adapter.fs.stat(path);
      },
      readFile: (path: string) => {
        assertMetadataPath(path);
        return tracked.readMetadataSource(path);
      },
    }),
  });
}

async function buildTrackedImportMapJson(
  options: Pick<
    BrowserModuleBundlerOptions,
    | "projectDir"
    | "config"
    | "moduleServerOrigin"
    | "dependencyPinningCacheKey"
    | "dependencyPinningDependencies"
    | "dependencyPinningSource"
  >,
  tracked: TrackingAdapterResult,
  signal: AbortSignal,
  trackedDependencyPinningSource?: DependencyPinningSource,
): Promise<string> {
  const dependencyPinningSource = trackedDependencyPinningSource ??
    createTrackedDependencyPinningSource(
      options.dependencyPinningSource,
      options.projectDir,
      tracked,
    );
  const importMapJson = await buildImportMapJson({
    projectDir: options.projectDir,
    config: options.config,
    moduleServerOrigin: options.moduleServerOrigin,
    dependencyPinningCacheKey: options.dependencyPinningCacheKey,
    dependencyPinningDependencies: options.dependencyPinningDependencies,
    dependencyPinningSource,
  });
  const trackedFailure = tracked.getFailure();
  if (trackedFailure) throw trackedFailure;
  throwIfAborted(signal);
  tracked.chargeText(importMapJson);
  return importMapJson;
}

interface BundleFlight {
  controller: AbortController;
  promise: Promise<BrowserModuleBundle>;
  waiters: number;
  settled: boolean;
}

interface BundleLane {
  semaphore: PermitSemaphore;
  flights: Map<string, BundleFlight>;
  participants: number;
}

const bundleLanes = new Map<string, BundleLane>();
// Reserve one host-owned participant slot before a request may wait in any
// project lane. This makes the advertised 8 active + 32 queued ceiling true
// across the whole isolate instead of allowing every project to accumulate a
// private queue outside the host bound.
const globalBundleParticipants = new PermitSemaphore(
  MAX_CONCURRENT_BROWSER_MODULE_BUNDLES + MAX_QUEUED_BROWSER_MODULE_BUNDLES,
  { maxQueueSize: 0 },
);
const globalBundleAdmission = new PermitSemaphore(MAX_CONCURRENT_BROWSER_MODULE_BUNDLES, {
  maxQueueSize: MAX_QUEUED_BROWSER_MODULE_BUNDLES,
});
const objectIdentities = new WeakMap<object, number>();
let nextObjectIdentity = 1;

function getObjectIdentity(value: object): number {
  let identity = objectIdentities.get(value);
  if (identity === undefined) {
    identity = nextObjectIdentity++;
    objectIdentities.set(value, identity);
  }
  return identity;
}

function getBundleLane(
  identity: string,
  limits: BrowserModuleBundleLimits,
): { key: string; lane: BundleLane } {
  const key = identity;
  let lane = bundleLanes.get(key);
  if (!lane) {
    lane = {
      semaphore: new PermitSemaphore(limits.maxConcurrentPerIdentity, {
        maxQueueSize: limits.maxQueuedPerIdentity,
      }),
      flights: new Map(),
      participants: 0,
    };
    bundleLanes.set(key, lane);
  }
  return { key, lane };
}

function releaseBundleLane(key: string, lane: BundleLane): void {
  if (
    lane.participants === 0 &&
    lane.flights.size === 0 &&
    lane.semaphore.available === lane.semaphore.capacity &&
    lane.semaphore.waiting === 0 &&
    bundleLanes.get(key) === lane
  ) {
    bundleLanes.delete(key);
  }
}

function createBundleDeadline(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const onParentAbort = (): void => controller.abort(createAbortError(parentSignal?.reason));
  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  const timeoutId = setTimeout(() => {
    controller.abort(
      new BrowserModuleBundleError("deadline", "Browser module bundle deadline exceeded"),
    );
  }, timeoutMs);

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

async function runWithBundleAdmission(
  options: BrowserModuleBundlerOptions,
  limits: BrowserModuleBundleLimits,
  operationIdentity: string,
  operation: (signal: AbortSignal) => Promise<BrowserModuleBundle>,
): Promise<BrowserModuleBundle> {
  throwIfAborted(options.signal);
  const identity = options.projectId ?? options.projectSlug ?? options.projectDir;
  const { key: laneKey, lane } = getBundleLane(identity, limits);
  lane.participants += 1;

  const execute = async (parentSignal: AbortSignal | undefined): Promise<BrowserModuleBundle> => {
    const deadline = createBundleDeadline(parentSignal, limits.maxDurationMs);
    let participantAcquired = false;
    let projectAcquired = false;
    let globalAcquired = false;
    let releaseWhenSettled = false;
    const releaseAdmission = (): void => {
      if (globalAcquired) {
        globalAcquired = false;
        globalBundleAdmission.release();
      }
      if (projectAcquired) {
        projectAcquired = false;
        lane.semaphore.release();
      }
      if (participantAcquired) {
        participantAcquired = false;
        globalBundleParticipants.release();
      }
      releaseBundleLane(laneKey, lane);
    };
    try {
      participantAcquired = await globalBundleParticipants.tryAcquire(0, {
        signal: deadline.signal,
      });
      if (!participantAcquired) {
        throw new BrowserModuleBundleError(
          "capacity",
          "Browser module bundle host capacity is exhausted",
        );
      }
      projectAcquired = await lane.semaphore.tryAcquire(Number.POSITIVE_INFINITY, {
        signal: deadline.signal,
      });
      if (!projectAcquired) {
        throw new BrowserModuleBundleError(
          "capacity",
          "Browser module bundle project capacity is exhausted",
        );
      }
      globalAcquired = await globalBundleAdmission.tryAcquire(Number.POSITIVE_INFINITY, {
        signal: deadline.signal,
      });
      if (!globalAcquired) {
        throw new BrowserModuleBundleError(
          "capacity",
          "Browser module bundle host capacity is exhausted",
        );
      }

      const running = operation(deadline.signal);
      // A client receives its deadline promptly, while the underlying permit is
      // retained until non-abortable adapter work actually settles. This keeps
      // legacy transports bounded instead of detaching unlimited background I/O.
      void running.then(releaseAdmission, releaseAdmission);
      releaseWhenSettled = true;
      return await waitForSharedPromise(running, deadline.signal);
    } finally {
      deadline.dispose();
      if (!releaseWhenSettled) releaseAdmission();
    }
  };

  try {
    if (!options.singleflightKey) return await execute(options.signal);

    const flightKey = [
      options.singleflightKey,
      operationIdentity,
      getObjectIdentity(options.adapter),
      options.projectDir,
      options.config ? getObjectIdentity(options.config) : "no-config",
      ...Object.values(limits),
    ].join("\0");
    let flight = lane.flights.get(flightKey);
    if (!flight) {
      const controller = new AbortController();
      const promise = execute(controller.signal);
      flight = {
        controller,
        promise,
        waiters: 0,
        settled: false,
      };
      lane.flights.set(flightKey, flight);
      const settleFlight = (): void => {
        flight!.settled = true;
        if (lane.flights.get(flightKey) === flight) lane.flights.delete(flightKey);
        releaseBundleLane(laneKey, lane);
      };
      void flight.promise.then(
        settleFlight,
        settleFlight,
      );
    }

    flight.waiters += 1;
    try {
      return await waitForSharedPromise(flight.promise, options.signal);
    } finally {
      flight.waiters -= 1;
      if (flight.waiters === 0 && !flight.settled) {
        flight.controller.abort(createAbortError(options.signal?.reason));
      }
    }
  } finally {
    lane.participants -= 1;
    releaseBundleLane(laneKey, lane);
  }
}

export function bundleBrowserModule(
  absPath: string,
  options: BrowserModuleBundlerOptions,
): Promise<string> {
  return bundleBrowserModuleWithMetadata(absPath, options).then((bundle) => bundle.source);
}

export function bundleBrowserModuleWithMetadata(
  absPath: string,
  options: BrowserModuleBundlerOptions,
): Promise<BrowserModuleBundle> {
  const limits = resolveLimits(options.limits);
  if (
    options.entrySource !== undefined &&
    (typeof options.entrySourceKey !== "string" || options.entrySourceKey.length === 0)
  ) {
    return Promise.reject(
      new TypeError("Browser module entrySource requires a content-derived entrySourceKey"),
    );
  }
  if (
    options.requestedDependencyPinningCacheKey !== undefined &&
    (options.dependencyPinningCacheKey !== undefined ||
      options.dependencyPinningDependencies !== undefined)
  ) {
    return Promise.reject(
      new TypeError(
        "Browser module requested dependency snapshot cannot be combined with resolved pins",
      ),
    );
  }
  const operationIdentity = options.entrySourceKey === undefined
    ? absPath
    : `${absPath}\0${options.entrySourceKey}`;
  return runWithBundleAdmission(options, limits, operationIdentity, (signal) =>
    withSpan(
      "server.browser-module.bundle",
      async () => {
        throwIfAborted(signal);
        if (!isWithinDirectory(options.projectDir, absPath)) {
          throw new Error("Browser module entry path is not trusted");
        }
        const tracked = createTrackingAdapter(
          options.adapter,
          options.projectDir,
          limits,
          signal,
        );
        const dependencyPinningSource = createTrackedDependencyPinningSource(
          options.dependencyPinningSource,
          options.projectDir,
          tracked,
        );
        const dependencySnapshot = options.requestedDependencyPinningCacheKey === undefined
          ? undefined
          : await resolveRequestedDependencyPinningSnapshot(
            dependencyPinningSource,
            options.requestedDependencyPinningCacheKey,
          );
        const dependencySnapshotReadFailure = tracked.getFailure();
        if (dependencySnapshotReadFailure) throw dependencySnapshotReadFailure;
        if (
          options.requestedDependencyPinningCacheKey !== undefined &&
          (!dependencySnapshot ||
            dependencySnapshot.cacheKey !== options.requestedDependencyPinningCacheKey)
        ) {
          throw new BrowserModuleDependencySnapshotError();
        }
        const dependencyPinningCacheKey = dependencySnapshot?.cacheKey ??
          options.dependencyPinningCacheKey;
        const dependencyPinningDependencies = dependencySnapshot?.dependencies ??
          options.dependencyPinningDependencies;
        const effectiveOptions: BrowserModuleBundlerOptions = {
          ...options,
          dependencyPinningCacheKey,
          dependencyPinningDependencies,
          dependencyPinningSource,
        };

        const { build } = await import("veryfront/extensions/bundler");
        if (options.entrySource !== undefined) {
          tracked.admitSource(absPath, options.entrySource);
        }
        let src: string;
        try {
          src = options.entrySource ?? await tracked.readSource(absPath);
        } catch (error) {
          if (
            options.requireClientBoundary &&
            (isCanonicalNotFoundError(error) || isNativeTypeError(error))
          ) {
            throw new BrowserModuleEntryRejectedError(error);
          }
          throw error;
        }
        if (
          options.requireClientBoundary &&
          (
            (!hasUseClientDirective(src, absPath) && !hasClientFileName(absPath)) ||
            hasUseServerDirective(src)
          )
        ) {
          throw new BrowserModuleEntryRejectedError();
        }
        const boundaryViolation = await inspectBrowserModuleBoundary(src, absPath);
        if (boundaryViolation) {
          throw new BrowserModuleBoundaryError(
            describeBrowserModuleBoundaryViolation(boundaryViolation),
          );
        }
        const importMapJson = options.importMapJson === undefined
          ? await buildTrackedImportMapJson(
            effectiveOptions,
            tracked,
            signal,
            dependencyPinningSource,
          )
          : options.importMapJson;
        if (options.importMapJson !== undefined) tracked.chargeText(importMapJson);
        const importMap = JSON.parse(importMapJson) as { imports?: Record<string, string> };

        let outputFiles;
        try {
          ({ outputFiles } = await build({
            bundle: true,
            write: false,
            format: "esm",
            platform: "browser",
            target: "es2022",
            jsx: "automatic",
            jsxImportSource: "react",
            external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
            stdin: {
              contents: src,
              loader: getEsbuildLoader(absPath),
              resolveDir: getDirectory(absPath),
              sourcefile: getSafeBrowserModuleIdentity(absPath, options.projectDir),
            },
            plugins: [
              createIgnoreCSSImportsPlugin(),
              createRelativeFsPlugin(options.projectDir, tracked.adapter, {
                enforceBrowserBoundaries: true,
                readBrowserModule: tracked.readSource,
              }),
              createBareExternalPlugin({
                importMapImports: importMap.imports,
                projectDir: options.projectDir,
                projectId: options.projectId ?? options.projectSlug,
                serverExternalPackages: options.config?.build?.serverExternalPackages,
                dependencyPinningCacheKey,
                dependencyPinningDependencies,
                dependencyPinningSource,
              }),
              createHttpExternalPlugin({
                moduleServerOrigin: options.moduleServerOrigin,
                dependencyPinningCacheKey,
              }),
            ],
            signal,
          }));
        } catch (error) {
          const trackedFailure = tracked.getFailure();
          if (trackedFailure) throw trackedFailure;
          throw error;
        }
        throwIfAborted(signal);

        const output = outputFiles?.[0];
        if (!output) {
          throw new Error("Browser module bundler produced no output");
        }
        let remainingOutputBytes = limits.maxOutputBytes;
        for (const file of outputFiles) {
          if (file.contents.byteLength > remainingOutputBytes) {
            throw new BrowserModuleBundleError(
              "limit",
              "Browser module bundle output exceeds the byte limit",
            );
          }
          remainingOutputBytes -= file.contents.byteLength;
        }
        const source = output.text;
        const dependencies = Object.freeze(
          await Promise.all(
            [...tracked.contents.entries()]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(async ([path, content]) =>
                Object.freeze({
                  path,
                  contentHash: await computeHash(content),
                  byteLength: utf8ByteLength(content),
                })
              ),
          ),
        );
        const resolutionProbes = Object.freeze(
          [...tracked.probes.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([path, state]) => Object.freeze({ path, state })),
        );
        throwIfAborted(signal);

        const contentHash = await computeHash(source);
        throwIfAborted(signal);
        const importMapHash = await computeHash(importMapJson);
        throwIfAborted(signal);
        return Object.freeze({
          source,
          contentHash,
          importMapHash,
          dependencyPinningCacheKey,
          dependencyPinningDependencies,
          dependencies,
          resolutionProbes,
        });
      },
      {
        "bundle.filePath": getSafeBrowserModuleIdentity(absPath, options.projectDir),
        "bundle.projectSlug": options.projectSlug ?? "unknown",
      },
    ));
}

export async function validateBrowserModuleBundle(
  bundle: BrowserModuleBundle,
  options: BrowserModuleBundleValidationOptions,
): Promise<boolean> {
  const limits = resolveLimits(options.limits);
  if (
    bundle.dependencies.length > limits.maxDependencies ||
    bundle.resolutionProbes.length > limits.maxResolutionProbes
  ) {
    return false;
  }
  let admittedBytes = 0;
  for (const dependency of bundle.dependencies) {
    if (!Number.isSafeInteger(dependency.byteLength) || dependency.byteLength < 0) return false;
    admittedBytes += dependency.byteLength;
    if (admittedBytes > limits.maxAggregateInputBytes) return false;
  }
  const signal = options.signal ?? new AbortController().signal;
  let tracked: TrackingAdapterResult;
  try {
    throwIfAborted(signal);
    tracked = createTrackingAdapter(options.adapter, options.projectDir, limits, signal);
    if (options.importMap) {
      const importMapJson = await buildTrackedImportMapJson(
        { projectDir: options.projectDir, ...options.importMap },
        tracked,
        signal,
      );
      if (await computeHash(importMapJson) !== bundle.importMapHash) return false;
    }
  } catch {
    throwIfAborted(signal);
    return false;
  }
  for (const dependency of bundle.dependencies) {
    if (!isWithinDirectory(options.projectDir, dependency.path)) return false;

    try {
      if (await computeHash(await tracked.readSource(dependency.path)) !== dependency.contentHash) {
        return false;
      }
    } catch {
      throwIfAborted(signal);
      return false;
    }
  }

  for (const probe of bundle.resolutionProbes) {
    if (!isWithinDirectory(options.projectDir, probe.path)) return false;
    let currentState: ResolutionProbeState;
    try {
      const info = await tracked.adapter.fs.stat(probe.path);
      currentState = info.isFile ? "file" : info.isDirectory ? "directory" : "other";
    } catch (error) {
      throwIfAborted(signal);
      if (!isCanonicalNotFoundError(error)) return false;
      currentState = "missing";
    }
    if (currentState !== probe.state) return false;
  }

  return true;
}
