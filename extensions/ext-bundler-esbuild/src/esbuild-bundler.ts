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
import { AsyncLocalStorage } from "node:async_hooks";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";

import { ensureEsbuildBinary } from "./binary.ts";
import { toEsbuildPlugin } from "./plugin-adapter.ts";

// deno-lint-ignore no-explicit-any
type EsbuildModule = any;

const ESBUILD_STOP_TIMEOUT_MS = 5_000;
const childProcess = createRequire(import.meta.url)("node:child_process") as {
  spawn: typeof import("node:child_process").spawn;
};

interface EsbuildService {
  child: ChildProcess;
  closed: Promise<void>;
  expectedClose: boolean;
}

interface OperationScope {
  activeCount: number;
}

interface MappedBundleOptions {
  options: Record<string, unknown>;
  activatePluginDisposals: () => void;
}

let esbuildModule: EsbuildModule | null = null;
let esbuildService: EsbuildService | null = null;
let esbuildOwnershipError: Error | null = null;
let esbuildShutdownError: Error | null = null;
let pluginDisposalError: Error | null = null;
let esbuildStopPromise: Promise<void> | null = null;
let activeOperationCount = 0;
let activeOperationsIdle: Promise<void> = Promise.resolve();
let resolveActiveOperationsIdle: (() => void) | null = null;
const operationScopes = new AsyncLocalStorage<OperationScope>();

function recordOwnershipError(cause?: unknown): Error {
  const message =
    "[ext-bundler-esbuild] Cannot own an esbuild service started outside the module-wide adapter; restart the process and use only the Bundler contract";
  esbuildOwnershipError ??= new Error(message, cause === undefined ? undefined : { cause });
  return esbuildOwnershipError;
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

function createPluginDisposalBarrier(scope: OperationScope): {
  wrap: (callback: () => unknown) => () => void;
  activate: () => void;
} {
  const callbacks: Array<{ started: boolean; settled: boolean }> = [];
  let activated = false;
  let holdingOperation = false;

  const releaseIfSettled = (): void => {
    if (!holdingOperation || callbacks.some((callback) => !callback.settled)) return;
    holdingOperation = false;
    scope.activeCount -= 1;
    endOperation();
  };

  const settle = (callback: { started: boolean; settled: boolean }): void => {
    if (callback.settled) return;
    callback.settled = true;
    releaseIfSettled();
  };

  const fail = (
    callback: { started: boolean; settled: boolean },
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

  return {
    wrap(callback) {
      const state = { started: false, settled: false };
      callbacks.push(state);

      return () => {
        if (state.settled) return;
        state.started = true;
        try {
          const result = callback();
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
  };
}

async function runBundlerOperation<T>(
  operation: (scope: OperationScope) => Promise<T>,
  preferredScope?: OperationScope,
): Promise<T> {
  if (esbuildOwnershipError) throw esbuildOwnershipError;
  if (esbuildShutdownError) throw esbuildShutdownError;

  const inheritedScope = operationScopes.getStore();
  const isReentrant = inheritedScope !== undefined && inheritedScope.activeCount > 0;
  if (!isReentrant) {
    while (esbuildStopPromise) await esbuildStopPromise;
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
}

function isEsbuildServiceSpawn(spawnArgs: unknown[]): boolean {
  const args = spawnArgs[1];
  return Array.isArray(args) &&
    args.some((arg) => typeof arg === "string" && arg.startsWith("--service=")) &&
    args.includes("--ping");
}

function isLiveService(service: EsbuildService): boolean {
  return !service.child.killed &&
    service.child.exitCode === null &&
    service.child.signalCode === null;
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
      let resolveClosed: () => void = () => {};
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });
      const service = { child, closed, expectedClose: false };
      child.once("close", () => {
        if (!service.expectedClose) recordOwnershipError();
        resolveClosed();
        if (esbuildService === service) esbuildService = null;
      });
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
    const ownershipError = recordOwnershipError();
    return result.then(
      () => {
        throw ownershipError;
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
  const { plugins, ...rest } = options;
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
  };
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
      try {
        const result = await invokeEsbuild(() => esbuild.build(mapped.options));
        return {
          outputFiles: (result.outputFiles ?? []).map(toOutput),
          warnings: toMessages(result.warnings),
          errors: toMessages(result.errors),
          metafile: result.metafile as Metafile | undefined,
        };
      } finally {
        mapped.activatePluginDisposals();
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
      const ctx = await invokeEsbuild(() => esbuild.context(mapped.options)).catch(
        (error: unknown) => {
          mapped.activatePluginDisposals();
          throw error;
        },
      );
      return {
        rebuild: () =>
          runBundlerOperation(async () => {
            const result = await ctx.rebuild();
            return {
              outputFiles: (result.outputFiles ?? []).map(toOutput),
              warnings: toMessages(result.warnings),
              errors: toMessages(result.errors),
              metafile: result.metafile as Metafile | undefined,
            };
          }, contextScope),
        dispose: () =>
          runBundlerOperation(async () => {
            try {
              await ctx.dispose();
            } finally {
              mapped.activatePluginDisposals();
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
      await activeOperationsIdle;

      const m = esbuildModule;
      const trackedService = esbuildService;
      if (trackedService && !trackedService.expectedClose && !isLiveService(trackedService)) {
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
