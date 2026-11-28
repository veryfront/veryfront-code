import {
  getTrustedProjectEnvIdentity,
  isProjectEnvActive,
} from "#veryfront/server/project-env/storage.ts";
import { copyPrivateMap, createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import {
  chainPrivatePromise,
  createPrivateDeferred,
  resolvePrivatePromise,
} from "#veryfront/security/private-promise.ts";
import type { ExecutorOperation } from "../executor/channel.ts";
import type { ExecutorDiscovery } from "#veryfront/agent/hosted/executor-discovery.ts";
import {
  getProjectAgentRuntimeInlineTools,
  runWithProjectAgentRuntime,
} from "#veryfront/agent/project/agent-runtime.ts";
import {
  getExecutorAgentDescribeResultSchema,
  parseDiscoveryData,
} from "#veryfront/agent/hosted/executor-discovery-schema.ts";
import {
  createExecutorProjectToolOperations,
  type ExecutorProjectToolContext,
} from "#veryfront/agent/hosted/executor-project-tools.ts";
import {
  type ExecutorProjectToolInstall,
  getExecutorProjectToolInstallSchema,
  parseExecutorInstallation,
} from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import { executorToolLimits } from "#veryfront/agent/hosted/executor-tool-schema.ts";
import type { InstalledExecutorRuntime } from "#veryfront/agent/hosted/executor-runtime-install.ts";
import { verifyHostedRuntimeSourceBinding } from "#veryfront/agent/hosted/runtime-source-binding.ts";

const apply = Reflect.apply;
const Controller = AbortController;
const abortController = AbortController.prototype.abort;
const controllerSignal = Object.getOwnPropertyDescriptor(AbortController.prototype, "signal")!.get!;
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;
const signalReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason")!.get!;
const addListener = EventTarget.prototype.addEventListener;
const removeListener = EventTarget.prototype.removeEventListener;
const createObject = Object.create;

/** Called only after the authenticated project-only installation has matched the fixed image. */
export async function createExecutorProjectToolRuntime(options: {
  input: ExecutorProjectToolInstall;
  discovery: ExecutorDiscovery;
  signal: AbortSignal;
  deadline: number;
  /** Image-owned captured environment scope, never a protocol callback. */
  runWithProjectRuntime?: <T>(fn: () => T) => T;
}): Promise<InstalledExecutorRuntime> {
  const { discovery, deadline } = options;
  const runProject = options.runWithProjectRuntime ?? (<T>(fn: () => T): T => fn());
  const close = discovery.close;
  // Source-owned signals dispatch authored abort listeners inside the same environment as execution.
  function bindProjectSignal(original: AbortSignal) {
    const controller = new Controller();
    const signal = apply(controllerSignal, controller, []) as AbortSignal;
    const forward = () =>
      runProject(() => apply(abortController, controller, [apply(signalReason, original, [])]));
    const listenerOptions = createObject(null) as AddEventListenerOptions;
    listenerOptions.once = true;
    apply(addListener, original, ["abort", forward, listenerOptions]);
    if (apply(signalAborted, original, [])) forward();
    return {
      signal,
      dispose: () => {
        apply(removeListener, original, ["abort", forward]);
      },
    };
  }
  const lifetime = bindProjectSignal(AbortSignal.any([options.signal, discovery.signal]));
  const signal = lifetime.signal;
  try {
    // Capture all admitted authority before discovery evaluates project modules.
    const input = parseExecutorInstallation(getExecutorProjectToolInstallSchema(), options.input);
    if (input.projectExecutionConfiguration) {
      const reference = input.projectExecutionConfiguration.reference;
      const admitted = runProject(() => ({
        active: isProjectEnvActive(),
        identity: getTrustedProjectEnvIdentity(),
      }));
      if (
        !admitted.active || admitted.identity?.projectId !== reference.projectId ||
        admitted.identity.environmentId !== reference.environmentId
      ) throw new TypeError("Captured project execution overlay unavailable");
    }
    const binding = input.binding;
    const source = input.source;
    const context: ExecutorProjectToolContext = {
      agentId: input.context.agentId,
      projectId: input.context.projectId,
      ...(input.context.userId === undefined ? {} : { userId: input.context.userId }),
      ...(input.context.projectSlug === undefined
        ? {}
        : { projectSlug: input.context.projectSlug }),
      ...(input.context.branch === undefined ? {} : { branch: input.context.branch }),
      execution: { kind: "canonical", runId: input.context.runId },
    };
    const allowedToolNames = createPrivateSet(input.allowedToolNames);
    const maxCalls = input.maxCalls;
    const maxConcurrent = input.maxConcurrent;
    const limits = executorToolLimits(input.limits);
    const discoveryOperations = copyPrivateMap(discovery.operations);
    const getRuntime = discovery.getRuntime;
    const retainRuntimeTask = discovery.retainRuntimeTask;
    const settled = discovery.settled;
    const agentDescribeResultSchema = getExecutorAgentDescribeResultSchema();
    signal.throwIfAborted();
    const describe = discoveryOperations.get("agent.describe");
    if (describe?.mode !== "unary") throw new Error("Project discovery unavailable");
    const result = parseDiscoveryData(
      agentDescribeResultSchema,
      await chainPrivatePromise(resolvePrivatePromise(), () =>
        runProject(() =>
          describe.handle(
            { agentId: context.agentId },
            { binding, signal, deadline },
          )
        )),
      true,
    );
    signal.throwIfAborted();
    if (
      !result.ok || result.value.definition.id !== context.agentId ||
      verifyHostedRuntimeSourceBinding(source, result.value.source) !== undefined
    ) {
      throw new Error("Project discovery did not match installation");
    }
    const runtime: ReturnType<typeof getRuntime> = apply(getRuntime, discovery, []);
    const tools = runProject(() =>
      runWithProjectAgentRuntime(runtime, () => {
        const runtimeTools = copyPrivateMap(runtime.tools, limits.maxTotalTools);
        for (const [name, tool] of getProjectAgentRuntimeInlineTools(runtime, context.agentId)) {
          runtimeTools.set(name, tool);
        }
        return createExecutorProjectToolOperations({
          scope: { binding, signal, assertActive: () => signal.throwIfAborted() },
          context,
          tools: runtimeTools,
          runWithProjectRuntime: (fn) => runProject(() => runWithProjectAgentRuntime(runtime, fn)),
          allowedToolNames,
          maxCalls,
          maxConcurrent,
          limits,
        });
      })
    );
    const scoped = (operation: ExecutorOperation): ExecutorOperation =>
      operation.mode === "unary"
        ? {
          mode: "unary",
          async handle(value, context) {
            const call = bindProjectSignal(context.signal);
            try {
              return await runProject(() =>
                operation.handle(value, { ...context, signal: call.signal })
              );
            } finally {
              call.dispose();
            }
          },
        }
        : {
          mode: "stream",
          async *handle(value, context) {
            const call = bindProjectSignal(context.signal);
            try {
              const iterator = runProject(() =>
                operation.handle(value, { ...context, signal: call.signal })[Symbol.asyncIterator]()
              );
              try {
                while (true) {
                  const next = await runProject(() => iterator.next());
                  if (next.done) return;
                  yield next.value;
                }
              } finally {
                await runProject(() => iterator.return?.());
              }
            } finally {
              call.dispose();
            }
          },
        };
    const operations = createPrivateMap<string, ExecutorOperation>();
    for (const [name, operation] of discoveryOperations) operations.set(name, scoped(operation));
    for (const [name, rawOperation] of tools) {
      const operation = scoped(rawOperation);
      if (operation.mode === "unary") operations.set(name, operation);
      else {operations.set(name, {
          mode: "stream",
          async *handle(value, context) {
            const retained = createPrivateDeferred<void>();
            apply(retainRuntimeTask, discovery, [retained.promise]);
            try {
              yield* operation.handle(value, context);
            } finally {
              retained.resolve();
            }
          },
        });}
    }
    return {
      operations,
      close: async () => {
        try {
          await runProject(() => apply(close, discovery, []));
        } finally {
          lifetime.dispose();
        }
      },
      settled,
    };
  } catch (error) {
    try {
      await runProject(() => apply(close, discovery, []));
    } finally {
      lifetime.dispose();
    }
    throw error;
  }
}
