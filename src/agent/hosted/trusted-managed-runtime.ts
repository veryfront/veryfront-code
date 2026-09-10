import type {
  TrustedManagedRuntime,
  TrustedManagedRuntimeOptions,
} from "./trusted-managed-runtime-contract.ts";
import {
  createExecutorChannel,
  type ExecutorChannel,
  type ExecutorOperation,
} from "../executor/channel.ts";
import type { ExecutorOperationGate } from "#veryfront/agent/executor/operation-gate.ts";
import { createExecutorProjectToolSource } from "./executor-project-tools.ts";
import { createExecutorRuntimeFacades } from "./executor-runtime-facades.ts";
import { createTrustedRuntimePreparation } from "./trusted-runtime-prepare.ts";
import { awaitExecutorCleanup } from "./executor-runtime-settlement.ts";
import { reserveExecutorToolMetadata } from "#veryfront/agent/hosted/executor-tool-schema.ts";

/** Broker-only channels preserve the existing capability gates without exposing them to project code. */
export async function createTrustedManagedRuntime(
  options: TrustedManagedRuntimeOptions,
): Promise<TrustedManagedRuntime> {
  options.signal.throwIfAborted();
  const lifetime = new AbortController();
  const signal = AbortSignal.any([options.signal, lifetime.signal]);
  let gate: ExecutorOperationGate | undefined;
  const setupFinished = Promise.withResolvers<void>();
  const retired = Promise.withResolvers<void>();
  void retired.promise.catch(() => {});
  let owner: ReturnType<typeof createTrustedRuntimePreparation> | undefined;
  let facades: Awaited<ReturnType<typeof createExecutorRuntimeFacades>> | undefined;
  let authority: ExecutorChannel | undefined;
  let runtime: ExecutorChannel | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = Promise.resolve().then(async () => {
      await setupFinished.promise;
      await awaitExecutorCleanup([
        Promise.resolve().then(() => owner?.close()),
        owner?.settled ?? Promise.resolve(),
        Promise.resolve().then(() => facades?.cleanup()),
        authority?.settled ?? Promise.resolve(),
        runtime?.settled ?? Promise.resolve(),
        gate?.settled ?? Promise.resolve(),
      ]);
    });
    gate?.revoke();
    lifetime.abort();
    authority?.close();
    runtime?.close();
    options.signal.removeEventListener("abort", abort);
    void closing.then(retired.resolve, retired.reject);
    return closing;
  };
  const abort = () => {
    void close().catch(() => {});
  };
  options.signal.addEventListener("abort", abort, { once: true });
  // This promise never awaits session.close/settled; it can safely retain pool admission.
  void options.runOwned(() => retired.promise).catch(() => {});
  try {
    const execution = options.installation.grant.execution;
    if (execution.kind !== "canonical" || execution.projectId === null) {
      throw new TypeError("Trusted runtime requires canonical project execution");
    }
    const projectTools = await createExecutorProjectToolSource({
      channel: options.projectChannel,
      signal,
      context: {
        agentId: options.installation.grant.agentId,
        projectId: execution.projectId,
        ...(execution.userId === undefined ? {} : { userId: execution.userId }),
        ...(execution.projectSlug === undefined ? {} : { projectSlug: execution.projectSlug }),
        execution: { kind: "canonical", runId: execution.runId },
      },
      allowedToolNames: new Set(options.projectToolNames),
      limits: options.toolLimits,
      assertActive: () => signal.throwIfAborted(),
    });
    signal.throwIfAborted();
    const combinedToolLimits = reserveExecutorToolMetadata(
      options.toolLimits,
      projectTools.aliasMetadataBytes,
    );
    gate = options.createGate(projectTools);
    const outward = new TransformStream<Uint8Array, Uint8Array>();
    const inward = new TransformStream<Uint8Array, Uint8Array>();
    const forwarded = new Map<string, ExecutorOperation>([
      ["runtime.prepare", {
        mode: "unary",
        handle(value, context) {
          const operation = owner?.operations.get("runtime.prepare");
          if (operation?.mode !== "unary") throw new Error("Trusted runtime is not ready");
          return operation.handle(value, context);
        },
      }],
      ["agent.stream", {
        mode: "stream",
        async *handle(value, context) {
          const operation = owner?.operations.get("agent.stream");
          if (operation?.mode !== "stream") throw new Error("Trusted runtime is not ready");
          yield* operation.handle(value, context);
        },
      }],
    ]);
    authority = createExecutorChannel({
      binding: options.binding,
      defaultTimeoutMs: options.defaultTimeoutMs,
      operations: gate.operations,
      transport: { readable: inward.readable, writable: outward.writable },
    });
    runtime = createExecutorChannel({
      binding: options.binding,
      defaultTimeoutMs: options.defaultTimeoutMs,
      operations: forwarded,
      transport: { readable: outward.readable, writable: inward.writable },
    });
    signal.throwIfAborted();
    facades = await createExecutorRuntimeFacades({
      input: options.installation,
      channel: runtime,
      signal,
      toolLimits: combinedToolLimits,
      projectContextSources: new Set([projectTools.id]),
    });
    signal.throwIfAborted();
    const projectFacade = facades.remoteToolSources.get(projectTools.id);
    if (!projectFacade) throw new TypeError("Gated project tools are unavailable");
    owner = createTrustedRuntimePreparation({
      binding: options.binding,
      source: options.installation.source,
      channel: options.projectChannel,
      projectTools: {
        id: projectTools.id,
        aliases: projectTools.aliases,
        aliasMetadataBytes: projectTools.aliasMetadataBytes,
        listTools: projectFacade.listTools.bind(projectFacade),
        executeTool: projectFacade.executeTool.bind(projectFacade),
      },
      facades,
      signal,
      sourceIntegrationPolicy: options.sourceIntegrationPolicy,
      grant: {
        ...options.installation.grant,
        models: new Map(options.installation.grant.models.map(({ id, ...policy }) => [id, policy])),
      },
      async closeProject() {
        options.requestSessionClose();
        await options.projectChannel.settled;
      },
    });
    setupFinished.resolve();
    return { channel: authority, gate, settled: retired.promise, close };
  } catch (error) {
    setupFinished.resolve();
    // Startup cancellation is bounded by the outer session notification. Original
    // cleanup stays tracked through retired, including noncooperative capability work.
    void close().catch(() => {});
    throw error;
  }
}
