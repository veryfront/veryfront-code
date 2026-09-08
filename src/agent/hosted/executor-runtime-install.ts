import type { ExecutorOperation, ExecutorOperationContext } from "../executor/channel.ts";
import { type ExecutorBinding, getExecutorBindingSchema } from "../executor/protocol.ts";
import { sameHostedExecutorOwner } from "./executor-session-schema.ts";
import { verifyHostedRuntimeSourceBinding } from "./runtime-source-binding.ts";
import {
  type ExecutorArtifactManifest,
  type ExecutorRuntimeInstall,
  getExecutorArtifactManifestSchema,
  getExecutorRuntimeInstallSchema,
  parseExecutorInstallation,
} from "./executor-runtime-install-schema.ts";

export interface InstalledExecutorRuntime {
  operations: ReadonlyMap<string, ExecutorOperation>;
  close(): Promise<void>;
  readonly settled: Promise<void>;
}

const operationModes = {
  "discovery.describe": "unary",
  "agent.describe": "unary",
  "runtime.prepare": "unary",
  "agent.stream": "stream",
} as const;

/**
 * Executor-only installation gate. Register its fixed map before starting the
 * authenticated bootstrap; project discovery belongs exclusively in install().
 * The broker remains authoritative for grants and operation phases.
 */
export function createExecutorRuntimeInstallation(options: {
  binding: ExecutorBinding;
  artifact: ExecutorArtifactManifest;
  signal?: AbortSignal;
  install(input: ExecutorRuntimeInstall, signal: AbortSignal): Promise<InstalledExecutorRuntime>;
}) {
  const binding = parseExecutorInstallation(getExecutorBindingSchema(), options.binding);
  const artifact = parseExecutorInstallation(getExecutorArtifactManifestSchema(), options.artifact);
  const lifetime = new AbortController();
  const settled = Promise.withResolvers<void>();
  void settled.promise.catch(() => {});
  let phase: "empty" | "installing" | "installed" | "closed" = "empty";
  let setup: Promise<InstalledExecutorRuntime> | undefined;
  let dispatch: ReadonlyMap<string, ExecutorOperation> | undefined;
  let closing: Promise<void> | undefined;
  const tasks = new Set<Promise<void>>();

  function retainOperation() {
    const task = Promise.withResolvers<void>();
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
    closing = Promise.resolve().then(async () => {
      let loaded: InstalledExecutorRuntime | undefined;
      try {
        loaded = await setup;
      } catch { /* Failed setup owns its partial resources. */ }
      if (loaded) {
        const results = await Promise.allSettled([
          Promise.resolve().then(() => loaded.close()),
          loaded.settled,
        ]);
        await Promise.allSettled([...tasks]);
        if (results.some((result) => result.status === "rejected")) {
          throw new Error("Executor installation cleanup failed");
        }
      }
    });
    lifetime.abort(new Error("Executor installation closed"));
    options.signal?.removeEventListener("abort", abort);
    void closing.then(settled.resolve, settled.reject);
    return closing;
  }
  function abort() {
    void close().catch(() => {});
  }
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();

  const operations = new Map<string, ExecutorOperation>();
  operations.set("runtime.install", {
    mode: "unary",
    async handle(value, context) {
      assertActive(context);
      if (phase !== "empty") throw new Error("Executor runtime already installed");
      const input = parseExecutorInstallation(getExecutorRuntimeInstallSchema(), value);
      if (
        !sameBinding(input.binding) || !sameHostedExecutorOwner(input.owner, artifact.owner) ||
        verifyHostedRuntimeSourceBinding(artifact.source, input.source) !== undefined ||
        input.root !== artifact.root
      ) throw new Error("Executor installation not granted");
      phase = "installing";
      context.signal.addEventListener("abort", abort, { once: true });
      setup = Promise.resolve().then(() => {
        assertActive(context);
        return options.install(input, lifetime.signal);
      });
      try {
        const loaded = await setup;
        assertActive(context);
        const registered = new Map(loaded.operations);
        for (const [name, mode] of Object.entries(operationModes)) {
          if (registered.get(name)?.mode !== mode) throw new Error("Incomplete executor runtime");
        }
        dispatch = registered;
        phase = "installed";
        return { installed: true };
      } catch {
        void close().catch(() => {});
        throw new Error("Executor installation failed");
      } finally {
        context.signal.removeEventListener("abort", abort);
      }
    },
  });
  for (const [name, mode] of Object.entries(operationModes)) {
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
