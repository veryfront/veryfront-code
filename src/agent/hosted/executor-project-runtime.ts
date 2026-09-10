import { createPrivateMap } from "#veryfront/security/private-map.ts";
import {
  chainPrivatePromise,
  createPrivateDeferred,
  resolvePrivatePromise,
} from "#veryfront/security/private-promise.ts";
import type { ExecutorOperation } from "../executor/channel.ts";
import type { ExecutorDiscovery } from "./executor-discovery.ts";
import {
  getExecutorAgentDescribeResultSchema,
  parseDiscoveryData,
} from "./executor-discovery-schema.ts";
import { createExecutorProjectToolOperations } from "./executor-project-tools.ts";
import type { ExecutorProjectToolInstall } from "./executor-runtime-install-schema.ts";
import type { InstalledExecutorRuntime } from "./executor-runtime-install.ts";
import { verifyHostedRuntimeSourceBinding } from "./runtime-source-binding.ts";

/** Called only after the authenticated project-only installation has matched the fixed image. */
export async function createExecutorProjectToolRuntime(options: {
  input: ExecutorProjectToolInstall;
  discovery: ExecutorDiscovery;
  signal: AbortSignal;
  deadline: number;
}): Promise<InstalledExecutorRuntime> {
  const { input, discovery, deadline } = options;
  const signal = AbortSignal.any([options.signal, discovery.signal]);
  try {
    signal.throwIfAborted();
    const describe = discovery.operations.get("agent.describe");
    if (describe?.mode !== "unary") throw new Error("Project discovery unavailable");
    const result = parseDiscoveryData(
      getExecutorAgentDescribeResultSchema(),
      await chainPrivatePromise(resolvePrivatePromise(), () =>
        describe.handle(
          { agentId: input.context.agentId },
          { binding: input.binding, signal, deadline },
        )),
      true,
    );
    signal.throwIfAborted();
    if (
      !result.ok || result.value.definition.id !== input.context.agentId ||
      verifyHostedRuntimeSourceBinding(input.source, result.value.source) !== undefined
    ) {
      throw new Error("Project discovery did not match installation");
    }
    const tools = createExecutorProjectToolOperations({
      scope: { binding: input.binding, signal, assertActive: () => signal.throwIfAborted() },
      context: input.context,
      tools: discovery.getRuntime().tools,
      allowedToolNames: new Set(input.allowedToolNames),
      maxCalls: input.maxCalls,
      maxConcurrent: input.maxConcurrent,
    });
    const operations = createPrivateMap<string, ExecutorOperation>();
    for (const [name, operation] of discovery.operations) operations.set(name, operation);
    for (const [name, operation] of tools) {
      if (operation.mode === "unary") operations.set(name, operation);
      else {operations.set(name, {
          mode: "stream",
          async *handle(value, context) {
            const retained = createPrivateDeferred<void>();
            discovery.retainRuntimeTask(retained.promise);
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
      close: () => discovery.close(),
      settled: discovery.settled,
    };
  } catch (error) {
    await discovery.close();
    throw error;
  }
}
