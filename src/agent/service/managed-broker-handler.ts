import type { HostedChatRuntimeStreamInput } from "../hosted/chat-runtime-contract.ts";
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

const runPath = /^\/api\/control-plane\/runs\/([A-Za-z0-9_-]{1,128})\/stream$/u;

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
  const active = new Map<string, { accepted: boolean; settled: Promise<void> }>();
  const lifetime = new AbortController();
  let closed = false;

  async function handle(request: Request): Promise<Response> {
    const match = runPath.exec(new URL(request.url).pathname);
    if (request.method !== "POST" || !match) {
      return Response.json({ errorCode: "BROKER_INGRESS_TARGET_MISMATCH" }, { status: 400 });
    }
    if (closed || options.signal?.aborted) {
      return Response.json({ errorCode: "BROKER_UNAVAILABLE" }, { status: 503 });
    }
    const runId = match[1]!;
    try {
      const signal = AbortSignal.any([
        request.signal,
        lifetime.signal,
        ...(options.signal ? [options.signal] : []),
      ]);
      const ingress = await parseBrokerRuntimeAgentIngress(request, {
        ...options.resolveIngressOptions({ request, runId }),
        expectedRunId: runId,
        signal,
      });
      assertAvailable(closed, signal);
      const runKey = managedRunKey(ingress);
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
            return await createSseResponse({
              runtime,
              messages: prepared.messages,
              requestSignal: request.signal,
              runId,
              threadId: ingress.executor.run.conversationId,
              agentId: ingress.executor.run.agentId,
              agUiInput: ingress.executor.input,
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
      if (error instanceof BrokerIngressError) {
        return Response.json({ errorCode: error.errorCode }, { status: error.status });
      }
      if (error instanceof BrokerHandlerUnavailableError) {
        return Response.json({ errorCode: "BROKER_UNAVAILABLE" }, { status: 503 });
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
  const source = result.toUIMessageStream();
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
              const metadata = buildChatStreamChunkMessageMetadata({
                agentId: runtime.definition.id,
                agentName: runtime.definition.name,
                agentAvatarUrl: runtime.definition.avatarUrl,
                modelId: runtime.modelId,
                part: { type: part.type, totalUsage: part.totalUsage },
              });
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
