import type { ExecutorOperation, ExecutorOperationContext } from "../executor/channel.ts";
import { copyPrivateMap, createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import {
  chainPrivatePromise,
  createPrivateDeferred,
  observePrivatePromise,
  resolvePrivatePromise,
} from "#veryfront/security/private-promise.ts";
import { type ExecutorBinding, getExecutorBindingSchema } from "../executor/protocol.ts";
import { sameHostedExecutorOwner } from "./executor-session-schema.ts";
import { verifyHostedRuntimeSourceBinding } from "./runtime-source-binding.ts";
import {
  type ExecutorArtifactManifest,
  type ExecutorProjectToolInstall,
  type ExecutorRuntimeInstall,
  getExecutorArtifactManifestSchema,
  getExecutorProjectToolInstallSchema,
  getExecutorRuntimeInstallSchema,
  parseExecutorInstallation,
} from "./executor-runtime-install-schema.ts";

export interface InstalledExecutorRuntime {
  operations: ReadonlyMap<string, ExecutorOperation>;
  close(): Promise<void>;
  readonly settled: Promise<void>;
}

const runtimeOperationModes = {
  "discovery.describe": "unary",
  "agent.describe": "unary",
  "runtime.prepare": "unary",
  "agent.stream": "stream",
} as const;
const apply = Reflect.apply;

const projectToolOperationModes = {
  "discovery.describe": "unary",
  "agent.describe": "unary",
  "project.tool-aliases": "unary",
  "tool.sources": "stream",
  "tool.list": "stream",
  "tool.execute": "stream",
} as const;

type InstallationIdentity = {
  binding: ExecutorBinding;
  artifact: ExecutorArtifactManifest;
  signal?: AbortSignal;
};
type InstallationOptions =
  & InstallationIdentity
  & ({
    mode?: "runtime";
    install(
      input: ExecutorRuntimeInstall,
      signal: AbortSignal,
      context: ExecutorOperationContext,
    ): Promise<InstalledExecutorRuntime>;
  } | {
    mode: "project-tools";
    install(
      input: ExecutorProjectToolInstall,
      signal: AbortSignal,
      context: ExecutorOperationContext,
    ): Promise<InstalledExecutorRuntime>;
  });

/**
 * Executor-only installation gate. Register its fixed map before starting the
 * authenticated bootstrap; project discovery belongs exclusively in install().
 * The broker remains authoritative for grants and operation phases.
 */
export function createExecutorRuntimeInstallation(options: InstallationOptions) {
  const operationModes = options.mode === "project-tools"
    ? projectToolOperationModes
    : runtimeOperationModes;
  const operationEntries = Object.entries(operationModes);
  const prepareInstallation = (() => {
    if (options.mode === "project-tools") {
      const install = options.install;
      return (value: unknown, context: ExecutorOperationContext) => {
        const input = parseExecutorInstallation(getExecutorProjectToolInstallSchema(), value);
        return {
          input,
          start: (signal: AbortSignal): Promise<InstalledExecutorRuntime> =>
            apply(install, options, [input, signal, context]),
        };
      };
    }
    if (options.mode !== undefined && options.mode !== "runtime") {
      throw new TypeError("Invalid executor installation profile");
    }
    const install = options.install;
    return (value: unknown, context: ExecutorOperationContext) => {
      const input = parseExecutorInstallation(getExecutorRuntimeInstallSchema(), value);
      return {
        input,
        start: (signal: AbortSignal): Promise<InstalledExecutorRuntime> =>
          apply(install, options, [input, signal, context]),
      };
    };
  })();
  const binding = parseExecutorInstallation(getExecutorBindingSchema(), options.binding);
  const artifact = parseExecutorInstallation(getExecutorArtifactManifestSchema(), options.artifact);
  const lifetime = new AbortController();
  const settled = createPrivateDeferred<void>();
  void chainPrivatePromise(settled.promise, () => {}, () => {});
  let phase: "empty" | "installing" | "installed" | "closed" = "empty";
  let setup: Promise<InstalledExecutorRuntime> | undefined;
  let dispatch: ReadonlyMap<string, ExecutorOperation> | undefined;
  let closing: Promise<void> | undefined;
  const tasks = createPrivateSet<Promise<void>>();

  function retainOperation() {
    const task = createPrivateDeferred<void>();
    tasks.add(task.promise);
    return () => {
      tasks.delete(task.promise);
      task.resolve();
    };
  }

  function sameBinding(value: ExecutorBinding) {
    return binding.allocationId === value.allocationId && binding.generation === value.generation &&
      binding.invocationId === value.invocationId;
  }
  function assertActive(context: ExecutorOperationContext) {
    if (
      phase === "closed" || context.signal.aborted || context.deadline <= Date.now() ||
      !sameBinding(context.binding)
    ) throw new Error("Executor installation unavailable");
  }
  function close(): Promise<void> {
    if (closing) return closing;
    phase = "closed";
    dispatch = undefined;
    // Memoize before abort listeners can reenter. Retain even non-cooperative
    // setup and runtime work until actual settlement, not cancellation notice.
    closing = chainPrivatePromise(resolvePrivatePromise(), async () => {
      let loaded: InstalledExecutorRuntime | undefined;
      try {
        loaded = await setup;
      } catch { /* Failed setup owns its partial resources. */ }
      if (loaded) {
        let failed = false;
        const cleanup = chainPrivatePromise(resolvePrivatePromise(), () => loaded!.close());
        const cleanupObserved = chainPrivatePromise(cleanup, () => {}, () => {
          failed = true;
        });
        const retirementObserved = chainPrivatePromise(loaded.settled, () => {}, () => {
          failed = true;
        });
        await cleanupObserved;
        await retirementObserved;
        for (const task of tasks) {
          try {
            await observePrivatePromise(task);
          } catch { /* Operation failure is reported to its caller. */ }
        }
        if (failed) {
          throw new Error("Executor installation cleanup failed");
        }
      }
    });
    lifetime.abort(new Error("Executor installation closed"));
    options.signal?.removeEventListener("abort", abort);
    void chainPrivatePromise(closing, settled.resolve, settled.reject);
    return closing;
  }
  function abort() {
    void chainPrivatePromise(close(), () => {}, () => {});
  }
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();

  const operations = createPrivateMap<string, ExecutorOperation>();
  operations.set("runtime.install", {
    mode: "unary",
    async handle(value, context) {
      assertActive(context);
      if (phase !== "empty") throw new Error("Executor runtime already installed");
      const { input, start } = prepareInstallation(value, context);
      if (
        !sameBinding(input.binding) || !sameHostedExecutorOwner(input.owner, artifact.owner) ||
        verifyHostedRuntimeSourceBinding(artifact.source, input.source) !== undefined ||
        input.root !== artifact.root
      ) throw new Error("Executor installation not granted");
      phase = "installing";
      context.signal.addEventListener("abort", abort, { once: true });
      setup = chainPrivatePromise(resolvePrivatePromise(), () => {
        assertActive(context);
        return start(lifetime.signal);
      });
      try {
        const loaded = await setup;
        assertActive(context);
        const registered = copyPrivateMap(loaded.operations);
        for (let index = 0; index < operationEntries.length; index++) {
          const name = operationEntries[index]![0], mode = operationEntries[index]![1];
          if (registered.get(name)?.mode !== mode) throw new Error("Incomplete executor runtime");
        }
        dispatch = registered;
        phase = "installed";
        return { installed: true };
      } catch {
        void chainPrivatePromise(close(), () => {}, () => {});
        throw new Error("Executor installation failed");
      } finally {
        context.signal.removeEventListener("abort", abort);
      }
    },
  });
  for (let index = 0; index < operationEntries.length; index++) {
    const name = operationEntries[index]![0], mode = operationEntries[index]![1];
    if (mode === "unary") {
      operations.set(name, {
        mode,
        async handle(value, context) {
          assertActive(context);
          const operation = dispatch?.get(name);
          if (phase !== "installed" || operation?.mode !== "unary") {
            throw new Error("Executor runtime not installed");
          }
          const release = retainOperation();
          try {
            return await operation.handle(value, {
              ...context,
              signal: AbortSignal.any([context.signal, lifetime.signal]),
            });
          } finally {
            release();
          }
        },
      });
    } else {operations.set(name, {
        mode,
        async *handle(value, context) {
          assertActive(context);
          const operation = dispatch?.get(name);
          if (phase !== "installed" || operation?.mode !== "stream") {
            throw new Error("Executor runtime not installed");
          }
          const release = retainOperation();
          try {
            yield* operation.handle(value, {
              ...context,
              signal: AbortSignal.any([context.signal, lifetime.signal]),
            });
          } finally {
            release();
          }
        },
      });}
  }
  return { operations, close, settled: settled.promise, signal: lifetime.signal };
}
