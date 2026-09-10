import { copyPrivateMap, createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import {
  chainPrivatePromise,
  createPrivateDeferred,
  resolvePrivatePromise,
} from "#veryfront/security/private-promise.ts";
import type { ExecutorOperation } from "../executor/channel.ts";
import { runWithProjectAgentRuntime } from "../project/agent-runtime.ts";
import type { ExecutorDiscovery } from "./executor-discovery.ts";
import {
  getExecutorAgentDescribeResultSchema,
  parseDiscoveryData,
} from "./executor-discovery-schema.ts";
import {
  createExecutorProjectToolOperations,
  type ExecutorProjectToolContext,
} from "./executor-project-tools.ts";
import {
  type ExecutorProjectToolInstall,
  getExecutorProjectToolInstallSchema,
  parseExecutorInstallation,
} from "./executor-runtime-install-schema.ts";
import { executorToolLimits } from "./executor-tool-schema.ts";
import type { InstalledExecutorRuntime } from "./executor-runtime-install.ts";
import { verifyHostedRuntimeSourceBinding } from "./runtime-source-binding.ts";

const apply = Reflect.apply;

/** Called only after the authenticated project-only installation has matched the fixed image. */
export async function createExecutorProjectToolRuntime(options: {
  input: ExecutorProjectToolInstall;
  discovery: ExecutorDiscovery;
  signal: AbortSignal;
  deadline: number;
}): Promise<InstalledExecutorRuntime> {
  const { discovery, deadline } = options;
  const close = discovery.close;
  const signal = AbortSignal.any([options.signal, discovery.signal]);
  try {
    // Capture all admitted authority before discovery evaluates project modules.
    const input = parseExecutorInstallation(getExecutorProjectToolInstallSchema(), options.input);
    const binding = input.binding;
    const source = input.source;
    const context: ExecutorProjectToolContext = {
      agentId: input.context.agentId,
      projectId: input.context.projectId,
      ...(input.context.userId === undefined ? {} : { userId: input.context.userId }),
      ...(input.context.projectSlug === undefined
        ? {}
        : { projectSlug: input.context.projectSlug }),
      execution: { kind: "canonical", runId: input.context.runId },
    };
    const allowedToolNames = createPrivateSet(input.allowedToolNames);
    const maxCalls = input.maxCalls;
    const maxConcurrent = input.maxConcurrent;
    const limits = executorToolLimits();
    const discoveryOperations = copyPrivateMap(discovery.operations);
    const getRuntime = discovery.getRuntime;
    const retainRuntimeTask = discovery.retainRuntimeTask;
    const settled = discovery.settled;
    signal.throwIfAborted();
    const describe = discoveryOperations.get("agent.describe");
    if (describe?.mode !== "unary") throw new Error("Project discovery unavailable");
    const result = parseDiscoveryData(
      getExecutorAgentDescribeResultSchema(),
      await chainPrivatePromise(resolvePrivatePromise(), () =>
        describe.handle(
          { agentId: context.agentId },
          { binding, signal, deadline },
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
    const tools = createExecutorProjectToolOperations({
      scope: { binding, signal, assertActive: () => signal.throwIfAborted() },
      context,
      tools: runtime.tools,
      runWithProjectRuntime: (fn) => runWithProjectAgentRuntime(runtime, fn),
      allowedToolNames,
      maxCalls,
      maxConcurrent,
      limits,
    });
    const operations = createPrivateMap<string, ExecutorOperation>();
    for (const [name, operation] of discoveryOperations) operations.set(name, operation);
    for (const [name, operation] of tools) {
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
      close: () => apply(close, discovery, []),
      settled,
    };
  } catch (error) {
    await apply(close, discovery, []);
    throw error;
  }
}
