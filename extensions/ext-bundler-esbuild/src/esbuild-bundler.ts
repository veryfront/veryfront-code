/**
 * esbuild-backed implementation of the {@link Bundler} contract.
 *
 * Lazy-initializes the esbuild binary (including `deno compile` VFS
 * extraction) on first use. All options pass through to esbuild unchanged
 * because the {@link BundleOptions} shape was designed to be esbuild-compatible;
 * the only translation is converting {@link BundlerPlugin}s into esbuild
 * plugins via {@link toEsbuildPlugin}.
 *
 * @module extensions/ext-bundler-esbuild/esbuild-bundler
 */

import type {
  BuildContext,
  BundleOptions,
  BundleOutput,
  Bundler,
  BundleResult,
  BundlerMessage,
  Metafile,
  TransformOptions,
  TransformResult,
} from "veryfront/extensions/bundler";
import { rebuildContextWithSignal } from "./context-build-lifecycle.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";

import { ensureEsbuildBinary } from "./binary.ts";
import { toEsbuildPlugin } from "./plugin-adapter.ts";

// deno-lint-ignore no-explicit-any
type EsbuildModule = any;

const ESBUILD_STOP_TIMEOUT_MS = 5_000;
/**
 * Unexpected service-child deaths tolerated before the adapter gives up.
 *
 * The child can be killed by something outside the process (OOM-kill, a
 * container runtime signal). That is recoverable: esbuild respawns the
 * service once its module state is reset, so it must not poison the process
 * the way foreign ownership does. The budget keeps a crash-looping binary
 * from respawning forever.
 */
export const MAX_SERVICE_RESTARTS = 3;
const childProcess = createRequire(import.meta.url)("node:child_process") as {
  spawn: typeof import("node:child_process").spawn;
};

interface EsbuildService {
  child: ChildProcess;
  closed: Promise<void>;
  expectedClose: boolean;
  lossRecorded?: boolean;
}

interface OperationScope {
  activeCount: number;
}

interface MappedBundleOptions {
  options: Record<string, unknown>;
  activatePluginDisposals: () => void;
  disposePluginGeneration: () => Promise<void>;
}

let esbuildModule: EsbuildModule | null = null;
let esbuildService: EsbuildService | null = null;
let esbuildOwnershipError: Error | null = null;
let esbuildShutdownError: Error | null = null;
let pluginDisposalError: Error | null = null;
let esbuildStopPromise: Promise<void> | null = null;
let esbuildServiceLost = false;
let esbuildServiceLostDetail = "";
let remainingServiceRestarts = MAX_SERVICE_RESTARTS;
let esbuildServiceRecovery: Promise<void> | null = null;
let esbuildServiceGeneration = 0;
let serviceLossSpawnGuard: {
  guard: typeof childProcess.spawn;
  previous: typeof childProcess.spawn;
  foreignService: EsbuildService | null;
} | null = null;
let esbuildServiceForeignReplacement: EsbuildService | null = null;
let activeOperationCount = 0;
let activeOperationsIdle: Promise<void> = Promise.resolve();
let resolveActiveOperationsIdle: (() => void) | null = null;
let stopBarrierCount = 0;
let stopBarrierIdle: Promise<void> = Promise.resolve();
let resolveStopBarrierIdle: (() => void) | null = null;
const operationScopes = new AsyncLocalStorage<OperationScope>();

const OWNERSHIP_ERROR_MESSAGE =
  "[ext-bundler-esbuild] Cannot own an esbuild service started outside the module-wide adapter; restart the process and use only the Bundler contract";

const MAX_CAUSE_DETAIL_LENGTH = 200;
/** Absolute POSIX and Windows paths, reduced to a basename below. */
const ABSOLUTE_PATH_PATTERN = /(?:[A-Za-z]:)?(?:\/|\\\\)[^\s"']*/g;

/**
 * Reduce a cause to a single redacted line.
 *
 * The message is logged, so it must not carry a machine's filesystem layout:
 * a compiled runtime resolves esbuild under a temp directory, and spawn errors
 * quote that path verbatim. Keeping only the basename preserves what the reader
 * needs -- which binary or module failed -- without the surrounding layout. The
 * first line only, so a stack never reaches the message, and bounded so a large
 * esbuild diagnostic cannot dominate the log line.
 */
function describeCause(cause: unknown): string {
  if (cause === undefined) return "";
  const raw = cause instanceof Error ? cause.message : String(cause);
  const firstLine = raw.split("\n", 1)[0] ?? "";
  const withoutPaths = firstLine.replace(ABSOLUTE_PATH_PATTERN, (match) => {
    const parts = match.split(/[\/\\]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1]! : match;
  });
  const detail = withoutPaths.trim().slice(0, MAX_CAUSE_DETAIL_LENGTH);
  return detail ? ` (underlying failure: ${detail})` : "";
}

/**
 * Latch the ownership failure, keeping whatever really went wrong.
 *
 * The latch is permanent, so the first call decides the error every later
 * operation sees. That call is often made before the operation settles, when no
 * cause is known yet; adopting the cause afterwards is what keeps the real
 * failure visible instead of reporting a lifecycle problem that may not be the
 * actual one. The cause is folded into the message because callers log
 * `error.message` and would otherwise never print the chain.
 */
function recordOwnershipError(cause?: unknown): Error {
  const existing = esbuildOwnershipError;
  if (!existing) {
    esbuildOwnershipError = new Error(
      `${OWNERSHIP_ERROR_MESSAGE}${describeCause(cause)}`,
      cause === undefined ? undefined : { cause },
    );
    return esbuildOwnershipError;
  }

  if (cause !== undefined && existing.cause === undefined) {
    existing.cause = cause;
    existing.message = `${OWNERSHIP_ERROR_MESSAGE}${describeCause(cause)}`;
  }
  return existing;
}

async function getEsbuild(): Promise<EsbuildModule> {
  await ensureEsbuildBinary();
  if (esbuildModule) return esbuildModule;
  esbuildModule = await import("esbuild");
  return esbuildModule;
}

function beginOperation(): void {
  if (activeOperationCount === 0) {
    activeOperationsIdle = new Promise<void>((resolve) => {
      resolveActiveOperationsIdle = resolve;
    });
  }
  activeOperationCount += 1;
}

function endOperation(): void {
  activeOperationCount -= 1;
  if (activeOperationCount !== 0) return;

  const resolve = resolveActiveOperationsIdle;
  resolveActiveOperationsIdle = null;
  activeOperationsIdle = Promise.resolve();
  resolve?.();
}

function enterStopBarrier(): void {
  if (stopBarrierCount === 0) {
    stopBarrierIdle = new Promise<void>((resolve) => {
      resolveStopBarrierIdle = resolve;
    });
  }
  stopBarrierCount += 1;
}

function leaveStopBarrier(): void {
  stopBarrierCount -= 1;
  if (stopBarrierCount !== 0) return;

  const resolve = resolveStopBarrierIdle;
  resolveStopBarrierIdle = null;
  stopBarrierIdle = Promise.resolve();
  resolve?.();
}

function createPluginDisposalBarrier(scope: OperationScope): {
  wrap: (callback: () => unknown) => () => void;
  activate: () => void;
  dispose: () => Promise<void>;
} {
  const callbacks: Array<{
    callback: () => unknown;
    started: boolean;
    settled: boolean;
    settledPromise: Promise<void>;
    resolveSettled: () => void;
  }> = [];
  let activated = false;
  let holdingOperation = false;

  const releaseIfSettled = (): void => {
    if (!holdingOperation || callbacks.some((callback) => !callback.settled)) return;
    holdingOperation = false;
    scope.activeCount -= 1;
    endOperation();
  };

  const settle = (callback: { settled: boolean; resolveSettled: () => void }): void => {
    if (callback.settled) return;
    callback.settled = true;
    callback.resolveSettled();
    releaseIfSettled();
  };

  const fail = (
    callback: { settled: boolean; resolveSettled: () => void },
    error: unknown,
  ): void => {
    if (!pluginDisposalError) {
      pluginDisposalError = new Error(
        "[ext-bundler-esbuild] Plugin disposal failed",
        { cause: error },
      );
    }
    settle(callback);
  };

  const start = (state: {
    callback: () => unknown;
    started: boolean;
    settled: boolean;
    resolveSettled: () => void;
  }): void => {
    if (state.started || state.settled) return;
    state.started = true;
    try {
      const result = state.callback();
      if (
        result !== null &&
        (typeof result === "object" || typeof result === "function") &&
        typeof (result as PromiseLike<unknown>).then === "function"
      ) {
        void Promise.resolve(result).then(
          () => settle(state),
          (error) => fail(state, error),
        );
      } else {
        settle(state);
      }
    } catch (error) {
      fail(state, error);
    }
  };

  return {
    wrap(callback) {
      let resolveSettled: () => void = () => {};
      const settledPromise = new Promise<void>((resolve) => {
        resolveSettled = resolve;
      });
      const state = {
        callback,
        started: false,
        settled: false,
        settledPromise,
        resolveSettled,
      };
      callbacks.push(state);

      return () => {
        start(state);
      };
    },
    activate() {
      if (activated) return;
      activated = true;
      if (callbacks.length === 0 || callbacks.every((callback) => callback.settled)) return;

      holdingOperation = true;
      beginOperation();
      scope.activeCount += 1;

      // esbuild 0.28 schedules disposal callbacks with zero-delay timers
      // before settling build/dispose. Queueing a sentinel after settlement
      // identifies callbacks that setup failures left unscheduled. Callbacks
      // that started async cleanup retain the operation until they settle.
      setTimeout(() => {
        for (const callback of callbacks) {
          if (!callback.started) settle(callback);
        }
        releaseIfSettled();
      }, 0);
    },
    async dispose() {
      const pending = callbacks.filter((callback) => !callback.settled);
      for (const callback of pending) start(callback);
      await Promise.all(pending.map((callback) => callback.settledPromise));
      if (pluginDisposalError) throw pluginDisposalError;
    },
  };
}

/**
 * Recover after the managed service child died unexpectedly (crash, OOM-kill).
 *
 * esbuild 0.28 keeps a dead service cached in its module state and rejects
 * every later call, so the reset must go through its `stop()`, which clears
 * that state and lets the next API call spawn a fresh child. This path only
 * runs for a child the adapter itself captured; a service started outside the
 * adapter is still latched permanently by {@link invokeEsbuild}. Recovery is
 * single-flight and waits for in-flight operations to drain: they fail with
 * esbuild's own error for the dead child and must not race the reset.
 */
function recoverLostService(): Promise<void> {
  esbuildServiceRecovery ??= (async () => {
    await activeOperationsIdle;
    if (!esbuildServiceLost) return;
    const foreignService = esbuildServiceForeignReplacement ??
      serviceLossSpawnGuard?.foreignService;
    if (foreignService) {
      const error = recordOwnershipError(
        new Error("esbuild service was replaced outside the module-wide adapter"),
      );
      uninstallServiceLossSpawnGuard();
      throw error;
    }
    uninstallServiceLossSpawnGuard();
    if (remainingServiceRestarts <= 0) {
      throw recordOwnershipError(
        new Error(
          `esbuild service exited unexpectedly ${
            MAX_SERVICE_RESTARTS + 1
          } times (last: ${esbuildServiceLostDetail})`,
        ),
      );
    }
    remainingServiceRestarts -= 1;
    const detail = esbuildServiceLostDetail;
    const m = esbuildModule;
    esbuildModule = null;
    esbuildService = null;
    esbuildServiceLost = false;
    try {
      await m?.stop();
    } catch {
      // Best effort: the child is already gone; stop() only resets state.
    }
    esbuildServiceGeneration += 1;
    console.warn(
      `[ext-bundler-esbuild] esbuild service exited unexpectedly (${detail}); restarting it (${remainingServiceRestarts} restart(s) left)`,
    );
  })().finally(() => {
    esbuildServiceRecovery = null;
  });
  return esbuildServiceRecovery;
}

async function runBundlerOperation<T>(
  operation: (scope: OperationScope) => Promise<T>,
  preferredScope?: OperationScope,
): Promise<T> {
  if (esbuildOwnershipError) throw esbuildOwnershipError;
  if (esbuildShutdownError) throw esbuildShutdownError;

  const inheritedScope = operationScopes.getStore();
  const isReentrant = inheritedScope !== undefined && inheritedScope.activeCount > 0;
  let stopBarrierEntered = false;
  if (!isReentrant) {
    while (esbuildStopPromise) await esbuildStopPromise;
    enterStopBarrier();
    stopBarrierEntered = true;
  }

  try {
    if (!isReentrant) {
      // A lost service is recovered before admission, so one child death costs
      // one restart instead of poisoning every later operation. The operation
      // already holds the stop barrier, so shutdown cannot complete in this
      // recovery gap and then leave the operation to spawn a new service.
      while (esbuildServiceLost) await recoverLostService();
    }

    // Admission is synchronous after the stop barrier check. This makes a stop
    // exclusive without serializing independent operations. Work re-entered by
    // an active plugin shares its live scope so shutdown cannot deadlock on it.
    const scope = preferredScope ?? (isReentrant ? inheritedScope : { activeCount: 0 });
    beginOperation();
    scope.activeCount += 1;
    try {
      return await operationScopes.run(scope, () => operation(scope));
    } finally {
      scope.activeCount -= 1;
      endOperation();
    }
  } finally {
    if (stopBarrierEntered) leaveStopBarrier();
  }
}

function isEsbuildServiceSpawn(spawnArgs: unknown[]): boolean {
  const args = spawnArgs[1];
  return Array.isArray(args) &&
    args.some((arg) => typeof arg === "string" && arg.startsWith("--service=")) &&
    args.includes("--ping");
}

function trackServiceChild(child: ChildProcess): EsbuildService {
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const service = { child, closed, expectedClose: false };
  const recordUnexpectedLoss = (exitCode: unknown, signalCode: unknown): void =>
    recordUnexpectedManagedServiceLoss(service, exitCode, signalCode);
  child.once("exit", recordUnexpectedLoss);
  child.once("close", (exitCode, signalCode) => {
    recordUnexpectedLoss(exitCode, signalCode);
    resolveClosed();
    if (esbuildService === service) esbuildService = null;
  });
  return service;
}

function recordUnexpectedManagedServiceLoss(
  service: EsbuildService,
  exitCode: unknown,
  signalCode: unknown,
): void {
  // An unexpected close of a child the adapter owns is a crash, not a
  // lifecycle violation; mark it recoverable instead of latching the
  // permanent ownership error.
  if (service.expectedClose || service.lossRecorded) return;
  service.lossRecorded = true;
  esbuildServiceLost = true;
  esbuildServiceLostDetail = `exit code ${exitCode}, signal ${signalCode}`;
  installServiceLossSpawnGuard();
}

function observeForeignServiceChild(child: ChildProcess): EsbuildService {
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const service = { child, closed, expectedClose: false };
  child.once("close", () => {
    resolveClosed();
  });
  return service;
}

function installServiceLossSpawnGuard(): void {
  if (serviceLossSpawnGuard) return;

  const previous = childProcess.spawn;
  const guard = ((...spawnArgs: unknown[]) => {
    const child = Reflect.apply(previous, childProcess, spawnArgs) as ChildProcess;
    if (isEsbuildServiceSpawn(spawnArgs)) {
      const foreignService = observeForeignServiceChild(child);
      esbuildServiceForeignReplacement = foreignService;
      serviceLossSpawnGuard!.foreignService = foreignService;
    }
    return child;
  }) as typeof childProcess.spawn;

  serviceLossSpawnGuard = { guard, previous, foreignService: null };
  childProcess.spawn = guard;
}

function uninstallServiceLossSpawnGuard(): void {
  const guard = serviceLossSpawnGuard;
  serviceLossSpawnGuard = null;
  if (guard && childProcess.spawn === guard.guard) childProcess.spawn = guard.previous;
}

/**
 * Keep lifecycle tracking tolerant of Node-compatible child-process shims.
 *
 * Native Node represents an active child with `null` exit fields. Some
 * compatible runtimes leave those fields undefined until the child exits.
 */
/** The ownership latch is module-wide; tests must clear it between cases. */
export function __resetOwnershipErrorForTests(): void {
  esbuildOwnershipError = null;
}

/** Crash-recovery state is module-wide; tests must reset it between cases. */
export function __resetServiceRecoveryForTests(): void {
  esbuildOwnershipError = null;
  esbuildServiceLost = false;
  esbuildServiceLostDetail = "";
  esbuildServiceForeignReplacement = null;
  esbuildServiceGeneration = 0;
  remainingServiceRestarts = MAX_SERVICE_RESTARTS;
  uninstallServiceLossSpawnGuard();
}

/** Exercise the latch without starting a real esbuild service. */
export function __recordOwnershipErrorForTests(cause?: unknown): Error {
  return recordOwnershipError(cause);
}

export function isLiveEsbuildServiceProcess(
  child: Pick<ChildProcess, "killed" | "exitCode" | "signalCode">,
): boolean {
  return !child.killed &&
    (child.exitCode === null || child.exitCode === undefined) &&
    (child.signalCode === null || child.signalCode === undefined);
}

function isLiveService(service: EsbuildService): boolean {
  return isLiveEsbuildServiceProcess(service.child);
}

function invokeEsbuild<T extends Promise<unknown>>(operation: () => T): T {
  const originalSpawn = childProcess.spawn;
  let capturedService: EsbuildService | null = null;
  let result: T;

  // esbuild does not expose its service child, and stop() resolves before that
  // child closes. esbuild 0.28 starts it synchronously with --service and
  // --ping, so keep interception to this operation and restore the shared
  // binding with compare-and-swap.
  const trackedSpawn = ((...spawnArgs: unknown[]) => {
    const child = Reflect.apply(originalSpawn, childProcess, spawnArgs) as ChildProcess;
    if (isEsbuildServiceSpawn(spawnArgs)) {
      const service = trackServiceChild(child);
      capturedService = service;
      esbuildService = service;
      if (childProcess.spawn === trackedSpawn) childProcess.spawn = originalSpawn;
    }
    return child;
  }) as typeof childProcess.spawn;
  childProcess.spawn = trackedSpawn;

  try {
    result = operation();
  } finally {
    if (childProcess.spawn === trackedSpawn) childProcess.spawn = originalSpawn;
  }

  const ownedService = capturedService ?? esbuildService;
  if (!ownedService || !isLiveService(ownedService)) {
    // A managed child that died out from under this operation is the
    // recoverable crash case handled by runBundlerOperation, not foreign
    // ownership; the operation surfaces esbuild's own error for the dead
    // child instead of latching the permanent one.
    if (esbuildServiceLost) return result;
    if (ownedService && ownedService === esbuildService) {
      recordUnexpectedManagedServiceLoss(
        ownedService,
        ownedService.child.exitCode,
        ownedService.child.signalCode,
      );
      return result;
    }
    // Latch synchronously so a concurrent operation cannot pass the admission
    // check in runBundlerOperation and drive esbuild while ownership is already
    // known to be invalid. The rejection handler still supplies the cause: the
    // latch is created without one here, and recordOwnershipError adopts the
    // first cause offered afterwards.
    recordOwnershipError();
    return result.then(
      () => {
        throw recordOwnershipError();
      },
      (cause) => {
        throw recordOwnershipError(cause);
      },
    ) as unknown as T;
  }

  return result;
}

async function waitForServiceClose(service: EsbuildService): Promise<void> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `[ext-bundler-esbuild] Timed out after ${ESBUILD_STOP_TIMEOUT_MS}ms waiting for the esbuild service to close`,
        ),
      );
    }, ESBUILD_STOP_TIMEOUT_MS);
  });

  try {
    await Promise.race([service.closed, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

// deno-lint-ignore no-explicit-any
function toMessage(m: any): BundlerMessage {
  return {
    text: m.text,
    location: m.location ?? null,
    notes: m.notes,
    pluginName: m.pluginName,
    detail: m.detail,
  };
}

// deno-lint-ignore no-explicit-any
function toMessages(ms: any[] | undefined): BundlerMessage[] {
  return (ms ?? []).map(toMessage);
}

// deno-lint-ignore no-explicit-any
function toOutput(f: any): BundleOutput {
  return {
    path: f.path,
    contents: f.contents,
    text: f.text,
    hash: f.hash,
  };
}

function mapOptions(options: BundleOptions, scope: OperationScope): MappedBundleOptions {
  // `signal` belongs to the framework contract, not esbuild's BuildOptions.
  const { plugins, signal: _signal, ...rest } = options;
  const mapped: Record<string, unknown> = { ...rest };
  const pluginDisposals = createPluginDisposalBarrier(scope);
  if (plugins && plugins.length > 0) {
    const runInOperationScope = <T>(callback: () => T): T => operationScopes.run(scope, callback);
    mapped.plugins = plugins.map((plugin) =>
      toEsbuildPlugin(plugin, runInOperationScope, pluginDisposals.wrap)
    );
  }
  return {
    options: mapped,
    activatePluginDisposals: pluginDisposals.activate,
    disposePluginGeneration: pluginDisposals.dispose,
  };
}

async function finalizePluginDisposals(mapped: MappedBundleOptions): Promise<void> {
  const service = esbuildService;
  if (
    esbuildServiceLost ||
    (service && !service.expectedClose && !isLiveService(service))
  ) {
    await mapped.disposePluginGeneration();
    return;
  }
  mapped.activatePluginDisposals();
}

/**
 * esbuild-backed {@link Bundler} implementation.
 *
 * Every instance coordinates through one module-wide service lifecycle. Raw
 * asynchronous esbuild calls must not share the same module in this process.
 */
export class EsbuildBundler implements Bundler {
  async bundle(options: BundleOptions): Promise<BundleResult> {
    return runBundlerOperation(async (scope) => {
      const esbuild = await getEsbuild();
      const mapped = mapOptions(options, scope);
      const signal = options.signal;
      try {
        signal?.throwIfAborted();

        let result: {
          outputFiles?: unknown[];
          warnings?: unknown[];
          errors?: unknown[];
          metafile?: unknown;
        };
        try {
          if (signal) {
            const buildContext = await invokeEsbuild(() => esbuild.context(mapped.options));
            result = await rebuildContextWithSignal(buildContext, signal);
          } else {
            result = await invokeEsbuild(() => esbuild.build(mapped.options));
          }
        } catch (error) {
          signal?.throwIfAborted();
          throw error;
        }
        signal?.throwIfAborted();
        return {
          outputFiles: (result.outputFiles ?? []).map(toOutput),
          warnings: toMessages(result.warnings),
          errors: toMessages(result.errors),
          metafile: result.metafile as Metafile | undefined,
        };
      } finally {
        await finalizePluginDisposals(mapped);
      }
    });
  }

  async transform(options: TransformOptions): Promise<TransformResult> {
    return runBundlerOperation(async () => {
      const esbuild = await getEsbuild();
      const { code, ...rest } = options;
      const result = await invokeEsbuild(() => esbuild.transform(code, rest));
      return {
        code: result.code,
        map: result.map,
        warnings: toMessages(result.warnings).map((m) => m.text),
      };
    });
  }

  async context(options: BundleOptions): Promise<BuildContext> {
    return runBundlerOperation(async (contextScope) => {
      const esbuild = await getEsbuild();
      const mapped = mapOptions(options, contextScope);
      let ctx = await invokeEsbuild(() => esbuild.context(mapped.options)).catch(
        async (error: unknown) => {
          await finalizePluginDisposals(mapped);
          throw error;
        },
      );
      let contextGeneration = esbuildServiceGeneration;
      let contextRefresh: Promise<void> | null = null;
      const currentContext = async () => {
        if (contextGeneration === esbuildServiceGeneration) return ctx;
        contextRefresh ??= (async () => {
          if (contextGeneration === esbuildServiceGeneration) return;
          await mapped.disposePluginGeneration();
          const currentEsbuild = await getEsbuild();
          ctx = await invokeEsbuild(() => currentEsbuild.context(mapped.options)).catch(
            async (error: unknown) => {
              await finalizePluginDisposals(mapped);
              throw error;
            },
          );
          contextGeneration = esbuildServiceGeneration;
        })().finally(() => {
          contextRefresh = null;
        });
        await contextRefresh;
        return ctx;
      };
      return {
        rebuild: () =>
          runBundlerOperation(async () => {
            const result = await (await currentContext()).rebuild();
            return {
              outputFiles: (result.outputFiles ?? []).map(toOutput),
              warnings: toMessages(result.warnings),
              errors: toMessages(result.errors),
              metafile: result.metafile as Metafile | undefined,
            };
          }, contextScope),
        cancel: () =>
          runBundlerOperation(async () => {
            await (await currentContext()).cancel();
          }, contextScope),
        dispose: () =>
          runBundlerOperation(async () => {
            try {
              if (contextGeneration === esbuildServiceGeneration) await ctx.dispose();
            } finally {
              if (contextGeneration === esbuildServiceGeneration) {
                mapped.activatePluginDisposals();
              } else {
                await mapped.disposePluginGeneration();
              }
            }
          }, contextScope),
      };
    });
  }

  async stop(): Promise<void> {
    if ((operationScopes.getStore()?.activeCount ?? 0) > 0) {
      throw new Error(
        "[ext-bundler-esbuild] Cannot stop the esbuild service from an active bundler operation",
      );
    }

    if (esbuildStopPromise) {
      await esbuildStopPromise;
      return;
    }

    const stopping = (async () => {
      await stopBarrierIdle;
      await activeOperationsIdle;

      if (
        esbuildServiceLost &&
        (esbuildServiceForeignReplacement ?? serviceLossSpawnGuard?.foreignService)
      ) {
        const error = recordOwnershipError(
          new Error("esbuild service was replaced outside the module-wide adapter"),
        );
        uninstallServiceLossSpawnGuard();
        throw error;
      }
      if (esbuildServiceLost && remainingServiceRestarts <= 0) {
        const error = recordOwnershipError(
          new Error(
            `esbuild service exited unexpectedly ${
              MAX_SERVICE_RESTARTS + 1
            } times (last: ${esbuildServiceLostDetail})`,
          ),
        );
        uninstallServiceLossSpawnGuard();
        throw error;
      }
      if (esbuildServiceLost) {
        remainingServiceRestarts -= 1;
        uninstallServiceLossSpawnGuard();
      }

      const m = esbuildModule;
      const trackedService = esbuildService;
      if (
        trackedService && !trackedService.expectedClose && !isLiveService(trackedService) &&
        remainingServiceRestarts <= 0
      ) {
        // A dead managed child within the restart budget is a crash, which a
        // stop resets anyway; only an exhausted budget still means giving up.
        recordOwnershipError();
      }
      const ownershipError = esbuildOwnershipError;
      const disposalError = pluginDisposalError;
      if (!m) {
        if (ownershipError) throw ownershipError;
        if (esbuildShutdownError) throw esbuildShutdownError;
        if (disposalError) {
          pluginDisposalError = null;
          throw disposalError;
        }
        return;
      }
      const service = esbuildService ?? trackedService;

      if (service) {
        service.expectedClose = true;
        service.child.ref();
      }
      try {
        await m.stop();
        if (service) await waitForServiceClose(service);
      } catch (error) {
        const shutdownError = error instanceof Error
          ? error
          : new Error("[ext-bundler-esbuild] Failed to stop the esbuild service", {
            cause: error,
          });
        esbuildShutdownError = shutdownError;
        if (service) {
          void service.closed.then(() => {
            if (esbuildShutdownError === shutdownError) esbuildShutdownError = null;
          });
        }
        throw shutdownError;
      } finally {
        service?.child.unref();
      }

      if (ownershipError) {
        throw new Error(
          "[ext-bundler-esbuild] Cannot verify closure of an externally owned esbuild service; restart the process",
          { cause: ownershipError },
        );
      }

      if (esbuildModule === m) esbuildModule = null;
      if (esbuildService === service) esbuildService = null;
      esbuildShutdownError = null;
      // A clean stop resets esbuild's module state, so a pending crash needs
      // no recovery pass anymore.
      esbuildServiceLost = false;

      if (disposalError) {
        if (pluginDisposalError === disposalError) pluginDisposalError = null;
        throw disposalError;
      }
    })();
    esbuildStopPromise = stopping;

    try {
      await stopping;
    } finally {
      if (Object.is(esbuildStopPromise, stopping)) esbuildStopPromise = null;
    }
  }
}
