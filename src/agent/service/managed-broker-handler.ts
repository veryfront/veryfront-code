import { isResponseLike } from "./response-like.ts";
import type {
  HostedChatRuntimeFinishPart,
  HostedChatRuntimeStreamInput,
} from "../hosted/chat-runtime-contract.ts";
import {
  ExecutorAgentError,
  getExecutorAgentFailureCodeSchema,
} from "../hosted/executor-agent-schema.ts";
import { ExecutorRuntimePreparationError } from "../hosted/executor-runtime-prepare-schema.ts";
import { ExecutorDiscoveryError } from "../hosted/executor-discovery-schema.ts";
import { HostedServiceAuthError } from "./auth.ts";
import { createAgUiChatUiTrackedResponse } from "../ag-ui/chat-ui-chunk-encoder.ts";
import type { AgUiRuntimeRequest } from "../runtime/ag-ui-contract.ts";
import { buildChatStreamChunkMessageMetadata } from "../../chat/chat-ui-message-helpers.ts";
import type { HostedLifecycleTerminalState } from "../hosted/lifecycle.ts";
import type {
  ManagedExecutorRuntime,
  ManagedExecutorStartInput,
} from "../hosted/managed-executor-broker.ts";
import type { ManagedBrokerOutput } from "../hosted/managed-broker-persistence.ts";
import {
  BrokerIngressError,
  type BrokerRuntimeAgentIngress,
  type BrokerRuntimeAgentIngressOptions,
  parseBrokerRuntimeAgentIngress,
} from "./broker-ingress.ts";

import { parseBrokerSignedRunPath } from "./broker-run-route.ts";
import {
  type ManagedAgUiAgentIngressResult,
  type ManagedDurableAgentIngressResult,
  parseManagedAgUiAgentIngress,
  type ParseManagedAgUiAgentIngressOptions,
  parseManagedDurableAgentIngress,
} from "./managed-hosted-ingress.ts";
import type { ParseHostedChatRequestOptions } from "#veryfront/agent/hosted/chat-request-parser.ts";
import {
  getHostedExecutorOwnerSchema,
  type HostedExecutorOwner,
} from "#veryfront/agent/hosted/executor-session-schema.ts";

/** Trusted executor admission boundary with actual settlement notification. */
export interface ManagedExecutorStarter {
  start(
    input: ManagedExecutorStartInput,
    lifecycle?: { onAdmitted?(settled: Promise<void>): void },
  ): Promise<ManagedExecutorRuntime>;
}

/** Handle signed run invocations with configured detached or request-owned SSE responses. */
export function createManagedBrokerHandler<TAuthorization>(options: {
  broker: ManagedExecutorStarter;
  /** Trusted route configuration; never read from request data. */
  responseMode: "detached" | "sse";
  signal?: AbortSignal;
  resolveIngressOptions(input: {
    request: Request;
    runId: string;
  }): Omit<BrokerRuntimeAgentIngressOptions<TAuthorization>, "expectedRunId">;
  prepare(input: {
    ingress: BrokerRuntimeAgentIngress<TAuthorization>;
    signal: AbortSignal;
  }): Promise<{
    start: ManagedExecutorStartInput;
    messages: HostedChatRuntimeStreamInput["messages"];
    executionSignal: AbortSignal;
    output?: ManagedBrokerOutput;
    cleanup?: () => Promise<void>;
  }>;
  onExecutionError?: (error: unknown, runId: string) => void;
}) {
  return createManagedBrokerIngressHandler({
    ...options,
    async parse(request, signal) {
      const runId = parseBrokerSignedRunPath(new URL(request.url).pathname);
      if (request.method !== "POST" || runId === null) {
        return Response.json({ errorCode: "BROKER_INGRESS_TARGET_MISMATCH" }, { status: 400 });
      }
      const ingress = await parseBrokerRuntimeAgentIngress(request, {
        ...options.resolveIngressOptions({ request, runId }),
        expectedRunId: runId,
        signal,
      });
      return {
        ingress,
        runId,
        runKey: managedRunKey(ingress),
        stream: {
          threadId: ingress.executor.run.conversationId,
          agentId: ingress.executor.run.agentId,
          agUiInput: ingress.executor.input,
        },
      };
    },
  });
}

type ManagedBrokerPreparation = {
  start: ManagedExecutorStartInput;
  messages: HostedChatRuntimeStreamInput["messages"];
  executionSignal: AbortSignal;
  output?: ManagedBrokerOutput;
  cleanup?: () => Promise<void>;
};

/** Authenticate request-owned AG-UI in the broker before executor admission. */
export function createManagedAgUiBrokerHandler(options: {
  broker: ManagedExecutorStarter;
  owner: HostedExecutorOwner;
  defaultAgentId: string;
  signal?: AbortSignal;
  ingress: ParseManagedAgUiAgentIngressOptions;
  prepare(input: {
    ingress: ManagedAgUiAgentIngressResult;
    signal: AbortSignal;
  }): Promise<ManagedBrokerPreparation>;
  onExecutionError?: (error: unknown, runId: string) => void;
}) {
  const owner = getHostedExecutorOwnerSchema().parse(options.owner);
  if (!options.defaultAgentId.trim()) {
    throw new TypeError("Managed broker default agent is required");
  }
  return createManagedBrokerIngressHandler({
    ...options,
    responseMode: "sse",
    async parse(request, signal) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/api/ag-ui") {
        return Response.json({ errorCode: "BROKER_INGRESS_TARGET_MISMATCH" }, { status: 400 });
      }
      signal.throwIfAborted();
      // Preserve the streaming body explicitly: Bun otherwise leaves the cloned body unread.
      const ingress = await parseManagedAgUiAgentIngress(
        new Request(request, { signal, body: request.body, duplex: "half" } as RequestInit),
        options.ingress,
      );
      signal.throwIfAborted();
      if (isResponseLike(ingress)) return ingress;
      const parsed = ingress.broker.getParsedRequest();
      if (owner.scopeKind === "project" && parsed.projectId !== owner.projectId) {
        return Response.json({ errorCode: "BROKER_INGRESS_SCOPE_DENIED" }, { status: 403 });
      }
      const runId = parsed.agUiInput.runId;
      const ownerKey = owner.scopeKind === "project"
        ? `project:${owner.projectId}`
        : `global:${owner.serviceName}`;
      return {
        ingress,
        runId,
        runKey: `${ownerKey}:${parsed.projectId}:${runId}`,
        stream: {
          threadId: parsed.agUiInput.threadId,
          agentId: parsed.agentId ?? options.defaultAgentId,
          agUiInput: parsed.agUiInput,
        },
      };
    },
  });
}

/** Authenticate direct durable requests in the broker before executor admission. */
export function createManagedDurableBrokerHandler(options: {
  broker: ManagedExecutorStarter;
  owner: HostedExecutorOwner;
  signal?: AbortSignal;
  ingress: ParseHostedChatRequestOptions;
  prepare(input: {
    ingress: ManagedDurableAgentIngressResult;
    signal: AbortSignal;
  }): Promise<ManagedBrokerPreparation>;
  onExecutionError?: (error: unknown, runId: string) => void;
}) {
  const owner = getHostedExecutorOwnerSchema().parse(options.owner);
  if (typeof options.ingress.verifyRunEventAppendToken !== "function") {
    throw new TypeError("Managed durable broker requires run-event authorization");
  }
  return createManagedBrokerIngressHandler({
    ...options,
    responseMode: "detached",
    async parse(request, signal) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/api/runs") {
        return Response.json({ errorCode: "BROKER_INGRESS_TARGET_MISMATCH" }, { status: 400 });
      }
      if (!request.headers.get("x-veryfront-run-event-token")?.trim()) {
        return Response.json({ errorCode: "BROKER_INGRESS_AUTH_REQUIRED" }, { status: 401 });
      }
      signal.throwIfAborted();
      // Preserve the streaming body explicitly: Bun otherwise leaves the cloned body unread.
      const ingress = await parseManagedDurableAgentIngress(
        new Request(request, { signal, body: request.body, duplex: "half" } as RequestInit),
        options.ingress,
      );
      signal.throwIfAborted();
      if (isResponseLike(ingress)) return ingress;
      const parsed = ingress.broker.getParsedRequest();
      if (!parsed.durableRootRun || !parsed.conversationId) {
        return Response.json({ errorCode: "BROKER_INGRESS_INVALID_BODY" }, { status: 400 });
      }
      if (owner.scopeKind === "project" && parsed.projectId !== owner.projectId) {
        return Response.json({ errorCode: "BROKER_INGRESS_SCOPE_DENIED" }, { status: 403 });
      }
      const ownerKey = owner.scopeKind === "project"
        ? `project:${owner.projectId}`
        : `global:${owner.serviceName}`;
      return {
        ingress,
        runId: parsed.durableRootRun.runId,
        runKey: `${ownerKey}:${parsed.projectId}:${parsed.durableRootRun.runId}`,
      };
    },
  });
}

function createManagedBrokerIngressHandler<TIngress>(options: {
  broker: ManagedExecutorStarter;
  responseMode: "detached" | "sse";
  signal?: AbortSignal;
  parse(request: Request, signal: AbortSignal): Promise<
    Response | {
      ingress: TIngress;
      runId: string;
      runKey: string;
      stream?: { threadId: string; agentId: string; agUiInput: AgUiRuntimeRequest };
    }
  >;
  prepare(input: { ingress: TIngress; signal: AbortSignal }): Promise<ManagedBrokerPreparation>;
  onExecutionError?: (error: unknown, runId: string) => void;
}) {
  const active = new Map<string, { accepted: boolean; settled: Promise<void> }>();
  const lifetime = new AbortController();
  let closed = false;

  async function handle(request: Request): Promise<Response> {
    if (closed || options.signal?.aborted) {
      return Response.json({ errorCode: "BROKER_UNAVAILABLE" }, { status: 503 });
    }
    try {
      const signal = AbortSignal.any([
        request.signal,
        lifetime.signal,
        ...(options.signal ? [options.signal] : []),
      ]);
      const parsed = await options.parse(request, signal);
      if (isResponseLike(parsed)) return parsed;
      const { ingress, runId, runKey } = parsed;
      assertAvailable(closed, signal);
      const existing = active.get(runKey);
      if (existing) {
        if (!existing.accepted) {
          return Response.json({ errorCode: "BROKER_RUN_PENDING" }, { status: 409 });
        }
        return options.responseMode === "detached"
          ? Response.json({ accepted: true, duplicate: true }, { status: 202 })
          : Response.json({ errorCode: "BROKER_RUN_ALREADY_ACTIVE" }, { status: 409 });
      }
      const reservation = Promise.withResolvers<void>();
      const activeRun = { accepted: false, settled: reservation.promise };
      active.set(runKey, activeRun);
      let preparedCleanup: (() => Promise<void>) | undefined;
      let admissionSettled: Promise<void> | undefined;
      let retirement: Promise<void> | undefined;
      const release = () => {
        if (active.get(runKey) === activeRun) active.delete(runKey);
        reservation.resolve();
      };
      const retire = (settled: Promise<void> = Promise.resolve()) => {
        retirement ??= Promise.resolve().then(async () => {
          await settled.catch(() => {});
          await preparedCleanup?.();
        }).finally(release);
        return retirement;
      };
      try {
        const prepared = await options.prepare({ ingress, signal });
        preparedCleanup = prepared.cleanup;
        assertAvailable(closed, signal);
        if (
          options.responseMode === "detached" &&
          (typeof prepared.output?.write !== "function" ||
            typeof prepared.output?.finish !== "function")
        ) {
          throw new Error("Detached broker output persistence is required");
        }
        const runtime = await options.broker.start({
          ...prepared.start,
          session: { ...prepared.start.session, preparationSignal: signal },
        }, {
          onAdmitted(settled) {
            admissionSettled = settled;
          },
        });
        admissionSettled = runtime.settled;
        try {
          runtime.accept(
            options.responseMode === "detached"
              ? { kind: "execution", signal: prepared.executionSignal }
              : { kind: "request" },
          );
          activeRun.accepted = true;
        } catch (error) {
          await runtime.close("canceled").catch(() => {});
          void retire(runtime.settled).catch(() => {});
          throw error;
        }
        if (options.responseMode === "sse") {
          try {
            if (!parsed.stream) throw new TypeError("Managed broker stream context is required");
            return await createSseResponse({
              runtime,
              messages: prepared.messages,
              requestSignal: request.signal,
              runId,
              ...parsed.stream,
              onSettled: () => retire(runtime.settled),
            });
          } catch (error) {
            await runtime.close("canceled").catch(() => {});
            void retire(runtime.settled).catch(() => {});
            throw error;
          }
        }
        const execution = runDetached(
          runtime,
          prepared.messages,
          prepared.executionSignal,
          prepared.output!,
        )
          .catch((error) => {
            try {
              options.onExecutionError?.(error, runId);
            } catch { /* Observability cannot own execution settlement. */ }
          }).finally(() => {
            void retire(runtime.settled).catch(() => {});
          });
        void execution;
        return Response.json({ accepted: true, duplicate: false }, { status: 202 });
      } catch (error) {
        const retiring = retire(admissionSettled);
        if (!admissionSettled) await retiring.catch(() => {});
        else void retiring.catch(() => {});
        throw error;
      }
    } catch (error) {
      if (
        error instanceof BrokerHandlerUnavailableError || lifetime.signal.aborted ||
        options.signal?.aborted
      ) {
        return Response.json({ errorCode: "BROKER_UNAVAILABLE" }, { status: 503 });
      }
      if (error instanceof BrokerIngressError) {
        return Response.json({ errorCode: error.errorCode }, { status: error.status });
      }
      const aborted = request.signal.aborted || options.signal?.aborted;
      if (!aborted) {
        if (
          error instanceof ExecutorAgentError || error instanceof ExecutorRuntimePreparationError ||
          error instanceof ExecutorDiscoveryError
        ) {
          return Response.json({ errorCode: error.code }, { status: error.status });
        }
        if (error instanceof HostedServiceAuthError) {
          return Response.json({ errorCode: error.errorCode }, { status: error.statusCode });
        }
      }
      return Response.json(
        { errorCode: aborted ? "BROKER_INGRESS_ABORTED" : "BROKER_EXECUTION_SETUP_FAILED" },
        { status: aborted ? 499 : 500 },
      );
    }
  }

  async function close(): Promise<void> {
    closed = true;
    lifetime.abort();
    await Promise.allSettled([...active.values()].map((run) => run.settled));
  }

  return {
    handle,
    close,
    get active() {
      return active.size;
    },
  };
}

/** Private lifecycle sentinel mapped locally to a fixed HTTP error without serializing diagnostics. */
class BrokerHandlerUnavailableError extends Error {}

function assertAvailable(closed: boolean, signal: AbortSignal): void {
  if (closed) throw new BrokerHandlerUnavailableError();
  signal.throwIfAborted();
}

function managedRunKey<TAuthorization>(ingress: BrokerRuntimeAgentIngress<TAuthorization>): string {
  const owner = ingress.executor.owner;
  const ownerKey = owner.scopeKind === "project"
    ? `project:${owner.projectId}`
    : `global:${owner.serviceName}`;
  return `${ownerKey}:${ingress.executor.run.project.projectId}:${ingress.executor.run.runId}`;
}

function buildManagedBrokerMessageMetadata(
  runtime: ManagedExecutorRuntime,
  part: HostedChatRuntimeFinishPart,
) {
  return buildChatStreamChunkMessageMetadata({
    agentId: runtime.definition.id,
    agentName: runtime.definition.name,
    agentAvatarUrl: runtime.definition.avatarUrl,
    modelId: runtime.modelId,
    part: { type: part.type, totalUsage: part.totalUsage },
  });
}

async function createSseResponse(input: {
  runtime: ManagedExecutorRuntime;
  messages: HostedChatRuntimeStreamInput["messages"];
  requestSignal: AbortSignal;
  runId: string;
  threadId: string;
  agentId: string;
  agUiInput: AgUiRuntimeRequest;
  onSettled(): Promise<void>;
}): Promise<Response> {
  const result = await input.runtime.agent.stream({
    messages: input.messages,
    abortSignal: input.requestSignal,
  });
  const source = result.toUIMessageStream({
    messageMetadata: ({ part }) => buildManagedBrokerMessageMetadata(input.runtime, part),
  });
  const completion = Promise.withResolvers<void>();
  let natural = false;
  let cleanup: Promise<void> | undefined;
  const finish = (reason: "completed" | "canceled") => {
    cleanup ??= Promise.resolve().then(async () => {
      await input.runtime.close(reason).catch(() => {});
      await input.runtime.settled;
      await input.onSettled();
    });
    return cleanup;
  };
  const agentUIStream = (async function* () {
    try {
      for await (const chunk of source) yield chunk;
      natural = true;
    } finally {
      completion.resolve();
    }
  })();
  const response = createAgUiChatUiTrackedResponse({
    agUiInput: input.agUiInput,
    defaults: { runId: input.runId, threadId: input.threadId },
    agentId: input.agentId,
    modelId: input.runtime.modelId,
    execution: {
      agentUIStream,
      async fail() {
        await finish("canceled");
      },
      async waitForFinish() {
        await completion.promise;
        await finish(natural && !input.requestSignal.aborted ? "completed" : "canceled");
      },
    },
  });
  return withResponseBodyCancellation(response, () => finish("canceled"));
}

function withResponseBodyCancellation(
  response: Response,
  cancel: () => Promise<void>,
): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          reader.releaseLock();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        await cancel().catch(() => {});
        controller.error(error);
      }
    },
    async cancel(reason) {
      await Promise.allSettled([
        reader.cancel(reason),
        cancel(),
      ]);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function runDetached(
  runtime: ManagedExecutorRuntime,
  messages: HostedChatRuntimeStreamInput["messages"],
  signal: AbortSignal,
  output: ManagedBrokerOutput,
): Promise<void> {
  let completed = false;
  try {
    await runtime.runOwned(async () => {
      let streamCompleted = false;
      let failure: unknown;
      let terminalMetadata: HostedLifecycleTerminalState["metadata"];
      try {
        const result = await runtime.agent.stream({ messages, abortSignal: signal });
        for await (
          const chunk of result.toUIMessageStream({
            messageMetadata({ part }) {
              const metadata = buildManagedBrokerMessageMetadata(runtime, part);
              terminalMetadata = {
                modelId: metadata.modelId,
                ...(metadata.usage ? { usage: metadata.usage } : {}),
                ...(metadata.usageCaptureStatus
                  ? { usageCaptureStatus: metadata.usageCaptureStatus }
                  : {}),
              };
              return metadata;
            },
          })
        ) {
          await output.write(chunk);
          if (chunk.type === "error" && failure === undefined) {
            const code = getExecutorAgentFailureCodeSchema().safeParse(chunk.code);
            failure = code.success
              ? new ExecutorAgentError(code.data)
              : new Error(chunk.errorText || "Agent stream failed");
          } else if (
            chunk.type === "finish" && chunk.finishReason === "error" && failure === undefined
          ) {
            failure = new Error("Agent stream finished with an error");
          }
        }
        signal.throwIfAborted();
        if (failure !== undefined) throw failure;
        streamCompleted = true;
      } catch (error) {
        failure ??= error;
        throw error;
      } finally {
        await output.finish({
          completed: streamCompleted,
          ...(failure === undefined || signal.aborted ? {} : { error: failure }),
          ...(terminalMetadata ? { metadata: terminalMetadata } : {}),
        });
      }
    });
    completed = true;
  } finally {
    await runtime.close(completed ? "completed" : "canceled").catch(() => {});
    await runtime.settled;
  }
}
