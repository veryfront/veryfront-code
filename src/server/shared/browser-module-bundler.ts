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
  inspectBrowserModulePath,
} from "#veryfront/server/handlers/dev/files/esbuild-plugins.ts";
import {
  describeBrowserModuleBoundaryViolation,
  inspectBrowserModuleBoundary,
} from "./browser-module-boundary.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";
import { PermitSemaphore } from "#veryfront/utils/permit-semaphore.ts";
import { waitForSharedPromise } from "#veryfront/utils/singleflight.ts";
import { createAbortError, throwIfAborted } from "#veryfront/utils/abort.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";

export interface BrowserModuleBundleLimits {
  maxDependencies: number;
  maxAggregateInputBytes: number;
  maxOutputBytes: number;
  maxResolutionProbes: number;
  maxDurationMs: number;
  maxConcurrentPerIdentity: number;
  maxQueuedPerIdentity: number;
}

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
  /** Caller cancellation is propagated into the bundler implementation. */
  signal?: AbortSignal;
  /** Stable request identity used to coalesce equivalent concurrent bundles. */
  singleflightKey?: string;
  /** Internal test/embedding override. Production callers use the hard defaults. */
  limits?: Partial<BrowserModuleBundleLimits>;
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
  dependencies: ReadonlyArray<{ path: string; contentHash: string }>;
  resolutionProbes: ReadonlyArray<{ path: string; state: ResolutionProbeState }>;
}

interface TrackingAdapterResult {
  adapter: RuntimeAdapter;
  contents: Map<string, string>;
  probes: Map<string, ResolutionProbeState>;
  chargeText(content: string): void;
  getFailure(): BrowserModuleBundleError | undefined;
}

function requirePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function resolveLimits(
  overrides: Partial<BrowserModuleBundleLimits> | undefined,
): BrowserModuleBundleLimits {
  const resolved = { ...DEFAULT_BROWSER_MODULE_BUNDLE_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(resolved)) {
    requirePositiveSafeInteger(value, `Browser module bundle limit ${name}`);
  }
  return resolved;
}

function createTrackingAdapter(
  adapter: RuntimeAdapter,
  limits: BrowserModuleBundleLimits,
  signal: AbortSignal,
): TrackingAdapterResult {
  const contents = new Map<string, string>();
  const probes = new Map<string, ResolutionProbeState>();
  const dependencyPaths = new Set<string>();
  const probePaths = new Set<string>();
  let failure: BrowserModuleBundleError | undefined;
  const fail = (message: string): never => {
    failure ??= new BrowserModuleBundleError("limit", message);
    throw failure;
  };
  let aggregateInputBytes = 0;
  const chargeText = (content: string): void => {
    const remaining = limits.maxAggregateInputBytes - aggregateInputBytes;
    const contentBytes = utf8ByteLength(content, remaining);
    if (contentBytes > remaining) {
      fail("Browser module bundle input exceeds the aggregate byte limit");
    }
    aggregateInputBytes += contentBytes;
  };
  const trackedFs = new Proxy(adapter.fs, {
    get(target, property, receiver) {
      if (property === "readFile") {
        return async (path: string) => {
          throwIfAborted(signal);
          if (!dependencyPaths.has(path)) {
            if (dependencyPaths.size >= limits.maxDependencies) {
              fail("Browser module bundle exceeds the dependency limit");
            }
            // Reserve synchronously before awaiting the adapter so concurrent
            // plugin loads cannot each pass the same remaining-capacity check.
            dependencyPaths.add(path);
          }
          const content = await target.readFile(path);
          throwIfAborted(signal);
          chargeText(content);
          contents.set(path, content);
          return content;
        };
      }
      if (property === "stat") {
        return async (path: string) => {
          throwIfAborted(signal);
          if (!probePaths.has(path)) {
            if (probePaths.size >= limits.maxResolutionProbes) {
              fail("Browser module bundle exceeds the resolution probe limit");
            }
            probePaths.add(path);
          }
          try {
            const info = await target.stat(path);
            throwIfAborted(signal);
            probes.set(
              path,
              info.isFile ? "file" : info.isDirectory ? "directory" : "other",
            );
            return info;
          } catch (error) {
            probes.set(path, "missing");
            throw error;
          }
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
    chargeText,
    getFailure: () => failure,
  };
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
  const key = [
    identity,
    limits.maxConcurrentPerIdentity,
    limits.maxQueuedPerIdentity,
  ].join("\0");
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
    let acquired = false;
    try {
      acquired = await lane.semaphore.tryAcquire(Number.POSITIVE_INFINITY, {
        signal: deadline.signal,
      });
      if (!acquired) {
        throw new BrowserModuleBundleError(
          "capacity",
          "Browser module bundle capacity is exhausted",
        );
      }
      return await operation(deadline.signal);
    } finally {
      if (acquired) lane.semaphore.release();
      deadline.dispose();
      releaseBundleLane(laneKey, lane);
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
  return runWithBundleAdmission(options, limits, absPath, (signal) =>
    withSpan(
      "server.browser-module.bundle",
      async () => {
        throwIfAborted(signal);
        const tracked = createTrackingAdapter(options.adapter, limits, signal);
        const entryPathStatus = await inspectBrowserModulePath(
          options.projectDir,
          absPath,
          tracked.adapter,
        );
        if (entryPathStatus !== "trusted") {
          throw new Error("Browser module entry path is not trusted");
        }

        const { build } = await import("veryfront/extensions/bundler");
        const src = await tracked.adapter.fs.readFile(absPath);
        const boundaryViolation = await inspectBrowserModuleBoundary(src, absPath);
        if (boundaryViolation) {
          throw new Error(describeBrowserModuleBoundaryViolation(boundaryViolation));
        }
        const importMapJson = options.importMapJson ?? await buildImportMapJson({
          projectDir: options.projectDir,
          config: options.config,
          moduleServerOrigin: options.moduleServerOrigin,
          dependencyPinningCacheKey: options.dependencyPinningCacheKey,
          dependencyPinningDependencies: options.dependencyPinningDependencies,
          dependencyPinningSource: options.dependencyPinningSource,
        });
        tracked.chargeText(importMapJson);
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
              }),
              createBareExternalPlugin({
                importMapImports: importMap.imports,
                projectDir: options.projectDir,
                projectId: options.projectId ?? options.projectSlug,
                dependencyPinningCacheKey: options.dependencyPinningCacheKey,
                dependencyPinningDependencies: options.dependencyPinningDependencies,
                dependencyPinningSource: options.dependencyPinningSource,
              }),
              createHttpExternalPlugin({
                moduleServerOrigin: options.moduleServerOrigin,
                dependencyPinningCacheKey: options.dependencyPinningCacheKey,
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
  options: Pick<BrowserModuleBundlerOptions, "adapter" | "projectDir">,
): Promise<boolean> {
  for (const dependency of bundle.dependencies) {
    if (!isWithinDirectory(options.projectDir, dependency.path)) return false;
    if (
      await inspectBrowserModulePath(options.projectDir, dependency.path, options.adapter) !==
        "trusted"
    ) return false;

    try {
      if (
        await computeHash(await options.adapter.fs.readFile(dependency.path)) !==
          dependency.contentHash
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }

  for (const probe of bundle.resolutionProbes) {
    if (!isWithinDirectory(options.projectDir, probe.path)) return false;
    let currentState: ResolutionProbeState;
    try {
      const info = await options.adapter.fs.stat(probe.path);
      currentState = info.isFile ? "file" : info.isDirectory ? "directory" : "other";
    } catch {
      currentState = "missing";
    }
    if (currentState !== probe.state) return false;
  }

  return true;
}
