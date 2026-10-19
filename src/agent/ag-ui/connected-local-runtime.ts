import { createLocalToolStream } from "./local-tool-stream.ts";
import { createConnectedLocalPlatformTools } from "./connected-local-platform-tools.ts";
import {
  createHostedRunEventWriterCapability,
  refreshHostedRunEventWriterCapability,
} from "../hosted/child-run-event-writer-token.ts";
import type { AgentRunToolCallAdmissionReceipt } from "#veryfront/runtime/tool-call-admission-receipt.ts";
import {
  type LocalChildInvocation,
  withLocalChildExecution,
} from "../composition/local-child-execution.ts";
import {
  readInheritedLocalChildResult,
  runInheritedLocalAgent,
} from "../composition/inherited-local-agent.ts";
import {
  acceptWorkflowInheritedRunAdmission,
  hostedInheritedInferenceModelResolver,
  RUN_TERMINAL_TOKEN_HEADER,
} from "../hosted/terminal-credential.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { createVeryfrontApiOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { getNonEmptyStringSchema } from "#veryfront/schemas/index.ts";
import { buildRuntimeEventRecordedEvent } from "./native-run-events.ts";
import { normalizeText } from "#veryfront/utils/logger/core.ts";
import { createRenewingLocalModel } from "./connected-local-model.ts";
import { terminalRoute } from "../conversation/terminal-route.ts";
import { readExternalAgentWorkerRunAuthority } from "../service/external-worker-client.ts";
import { appendConversationRunEvents } from "../conversation/durable.ts";
import { createVeryfrontCloudInferenceModel } from "#veryfront/provider/veryfront-cloud/provider.ts";
import {
  loadVeryfrontCloudCatalog,
  withVeryfrontCloudCatalogScope,
} from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import {
  type AgentModelRuntimeResolver,
  registerModelRuntimeResolverCatalog,
} from "../runtime/model-transport.ts";
import { createEphemeralAgentWithRuntimeOptions } from "../factory.ts";
import { getAgentExecutionConfig } from "../runtime/execution-config.ts";
import { resolveRuntimeToolLoading } from "../runtime/runtime-tool-config.ts";
import type { Agent } from "../types.ts";
import { runWithMandatoryRunEventSink } from "#veryfront/runtime/run-event-sink-context.ts";
import type { AgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";
import {
  bindRuntimeObservationWriterCapability,
  createRuntimeObservationWriterCapability,
} from "#veryfront/runtime/runtime-observation-carrier.ts";
import {
  createExternalAgentWorkerClient,
  type ExternalAgentWorkerClient,
} from "../service/external-worker-client.ts";
import { createAgUiEncoderState, mapRuntimeStreamEventToAgUiEvents } from "./encoder.ts";
import { ConversationRunEventEncoder } from "../conversation/run-events.ts";
import { createConversationRunMirror } from "../conversation/run-mirror.ts";
import { streamDataStreamEvents } from "../streaming/data-stream.ts";
import type { ChatStreamEvent } from "#veryfront/chat/protocol.ts";
import { buildExplicitAgUiSourceTools } from "./tool-shared.ts";

/** @internal Trusted CLI setup, never read from a project's environment. */
export interface ConnectedLocalRuntimeOptions {
  apiBaseUrl: string;
  apiToken: string;
  projectId: string;
  projectSlug: string;
  environmentId?: string;
  environmentName?: string;
  studioUrl: string;
  workerDisplayName?: string;
}

/** @internal Safe setup errors returned to the local app and terminal. */
export class ConnectedLocalAdmissionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ConnectedLocalAdmissionError";
  }
}

type TerminalStatus = "completed" | "failed" | "cancelled";
export interface ConnectedLocalRun {
  runId: string;
  conversationId: string;
  context?: Record<string, unknown>;
  signal: AbortSignal;
  prepareAgent(agent: Agent): Promise<Agent>;
  execute<T>(operation: () => T | Promise<T>): Promise<T>;
  wrapStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array>;
  finish(status: TerminalStatus): Promise<void>;
}

const responseJson = Response.prototype.json;
const responseOk = Object.getOwnPropertyDescriptor(Response.prototype, "ok")!.get!;
const responseStatus = Object.getOwnPropertyDescriptor(Response.prototype, "status")!.get!;
const apply = Reflect.apply;
const timeoutSignal = AbortSignal.timeout.bind(AbortSignal);
const anySignal = AbortSignal.any.bind(AbortSignal);

function admissionFailureMessage(status: number, detail: string): string {
  if (status === 401) {
    return "Veryfront login expired. Run veryfront login, then npm run dev again.";
  }
  if (status === 403) return "You do not have access to this Veryfront project or environment.";
  if (detail.includes("selected environment has no deployed release")) {
    return "The selected environment has no deployed release. Connected local execution requires an API that supports local source with environment selection.";
  }
  if (detail.includes("account ownership")) {
    return "Project billing is not ready. Complete the project account setup in Studio.";
  }
  return `Veryfront local run admission failed (HTTP ${status}). Check your project, environment, and API version.`;
}

function admittedChildAgentId(name: string, input: unknown): string | undefined {
  if (
    input && typeof input === "object" && "agent_id" in input && typeof input.agent_id === "string"
  ) {
    return input.agent_id.trim();
  }
  return name.startsWith("agent_") ? name.slice(6) : undefined;
}

function mirroredStreamEventType(type: string): string {
  if (type === "step-start") return "start-step";
  return type === "step-end" ? "finish-step" : type;
}

function encodeMirroredStreamEvents(
  event: Parameters<typeof mapRuntimeStreamEventToAgUiEvents>[1],
  encoder: ConversationRunEventEncoder,
  persistedToolStarts: Set<string>,
) {
  const type = mirroredStreamEventType(event.type);
  if (["message-start", "message-finish", "data"].includes(type)) return [];
  const duplicateStart = type === "tool-input-start" &&
    typeof event.toolCallId === "string" && persistedToolStarts.has(event.toolCallId);
  if (type === "tool-input-start" && typeof event.toolCallId === "string") {
    persistedToolStarts.add(event.toolCallId);
  }
  return (duplicateStart ? [] : encoder.encode({ ...event, type } as ChatStreamEvent)).map(
    (encoded) =>
      encoded.type === "CUSTOM"
        ? buildRuntimeEventRecordedEvent({
          runtime: "veryfront",
          kind: getNonEmptyStringSchema().parse(encoded.name),
          value: encoded.value,
        }).durable
        : encoded,
  );
}

function createInheritedLocalInvocationExecutor(
  invocation: LocalChildInvocation,
  delegated: Parameters<typeof runInheritedLocalAgent>[0],
): Parameters<typeof runInheritedLocalAgent>[2] {
  return async (signal, onEvent) => {
    const output = await invocation.execute({
      signal,
      runId: "terminalReceipt" in delegated ? undefined : delegated.runId,
      onEvent,
      resolveModelRuntime: "terminalReceipt" in delegated
        ? undefined
        : hostedInheritedInferenceModelResolver(delegated, {
          projectModels: true,
          signal,
        }),
    });
    return { success: output.status !== "error", output, executionTime: 0 };
  };
}

function createConnectedLocalModelFactory(
  id: string,
  options: ConnectedLocalRuntimeOptions,
  assertActive: () => void,
) {
  return (token: string) =>
    createVeryfrontCloudInferenceModel(id, token, {
      apiBaseUrl: options.apiBaseUrl,
      assertInferenceCredentialActive: assertActive,
    });
}

let installed: ReturnType<typeof createConnectedLocalRuntime> | undefined;

/** @internal Called by the CLI before importing local project code. */
export function installConnectedLocalRuntime(
  options: ConnectedLocalRuntimeOptions,
): () => Promise<void> {
  const runtime = createConnectedLocalRuntime(options);
  installed = runtime;
  return async () => {
    if (installed === runtime) installed = undefined;
    await runtime.dispose();
  };
}

/** @internal No public package export exposes the trusted connection. */
export function getConnectedLocalRuntime() {
  return installed;
}

/** @internal Dependencies keep protocol tests independent of a live API. */
export function createConnectedLocalRuntime(options: ConnectedLocalRuntimeOptions, dependencies: {
  client?: ExternalAgentWorkerClient;
  createPlatformTools?: typeof createConnectedLocalPlatformTools;
  fetch?: typeof fetch;
  log?: (message: string) => void;
  append?: (
    events: unknown[],
    sequence: number,
  ) => Promise<
    {
      latestExternalEventSequence: number;
      modelCallCaptures?:
        import("#veryfront/runtime/model-call-capture-receipt.ts").AgentRunModelCallCaptureReceipt[];
    }
  >;
} = {}) {
  const hostFetch = createVeryfrontApiOriginBoundOutboundFetch(options.apiBaseUrl);
  const transport: typeof fetch = dependencies.fetch ?? ((input, init) => {
    const signal = (init as RequestInit | undefined)?.signal;
    return hostFetch(input, {
      ...init,
      signal: signal ? anySignal([signal, timeoutSignal(15_000)]) : timeoutSignal(15_000),
    });
  });
  const client = dependencies.client ??
    createExternalAgentWorkerClient({
      apiUrl: options.apiBaseUrl,
      authToken: options.apiToken,
      fetch: transport,
    });
  const platformTools = dependencies.client
    ? undefined
    : (dependencies.createPlatformTools ?? createConnectedLocalPlatformTools)(
      options.apiBaseUrl,
      transport,
    );
  const log = dependencies.log ?? console.log;
  const workerKey = `local:${crypto.randomUUID()}`;
  const conversations = new Map<string, string>();
  const pendingAdmissions = new Map<
    string,
    { key: string; messageMayHaveCommitted: boolean; ambiguous: boolean }
  >();
  const active = new Set<ConnectedLocalRun>();
  let worker: Promise<{ id: string }> | undefined;
  let admissionTail: Promise<unknown> = Promise.resolve();
  let closed = false;
  async function api(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ id: string }> {
    const response = await transport(`${options.apiBaseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: timeoutSignal(15_000),
    });
    if (!apply(responseOk, response, [])) {
      const status = apply(responseStatus, response, []) as number;
      const problem = await (apply(responseJson, response, []) as Promise<Record<string, unknown>>)
        .catch((): Record<string, unknown> => ({}));
      const detail = typeof problem.detail === "string" ? problem.detail : "";
      const message = admissionFailureMessage(status, detail);
      log(message);
      throw new ConnectedLocalAdmissionError(
        status >= 400 && status < 500 ? status : 502,
        message,
      );
    }
    return await apply(responseJson, response, []) as { id: string };
  }
  async function admit(
    input: {
      agentId: string;
      agentName?: string;
      threadId: string;
      messages: Array<{ role: string; parts: unknown[] }>;
      signal: AbortSignal;
    },
  ): Promise<ConnectedLocalRun> {
    if (closed) throw new Error("Veryfront local runtime is closed.");
    const operation = admissionTail.then(async () => {
      if (closed) throw new Error("Veryfront local runtime is closed.");
      input.signal.throwIfAborted();
      worker ??= client.registerWorker({
        projectReference: options.projectId,
        implementationKind: "veryfront-local",
        implementationDisplayName: "Veryfront local",
        workerKey,
        displayName: options.workerDisplayName ?? "Local development",
      }).catch((error) => {
        worker = undefined;
        throw error;
      });
      const registered = await worker;
      input.signal.throwIfAborted();
      await client.heartbeatWorker(registered.id);
      input.signal.throwIfAborted();
      // A failed response does not tell us whether admission committed. Keep the
      // write identity until its run receipt arrives, including across cloned retries.
      // Retain only the digest, never the serialized conversation history.
      const requestIdentity = await computeHash(JSON.stringify([
        input.threadId,
        input.agentId,
        input.agentName,
        input.messages,
      ]));
      input.signal.throwIfAborted();
      let pending = pendingAdmissions.get(requestIdentity);
      if (!pending) {
        pending = {
          key: `local:${crypto.randomUUID()}`,
          messageMayHaveCommitted: false,
          ambiguous: false,
        };
        pendingAdmissions.set(requestIdentity, pending);
      }
      const admissionKey = pending.key;
      const write = async (path: string, body: unknown, headers?: Record<string, string>) => {
        try {
          const result = await api(path, body, headers);
          pending.ambiguous = false;
          if (path.endsWith("/messages")) pending.messageMayHaveCommitted = true;
          return result;
        } catch (error) {
          if (
            error instanceof ConnectedLocalAdmissionError && error.status >= 400 &&
            error.status < 500
          ) {
            // The cached conversation can be reused, but a prior user message
            // must retain its key even when the later run admission is rejected.
            if (!pending.messageMayHaveCommitted && !pending.ambiguous) {
              pendingAdmissions.delete(requestIdentity);
            }
          } else pending.ambiguous = true;
          throw error;
        }
      };
      let conversationId = conversations.get(input.threadId);
      if (!conversationId) {
        conversationId = (await write("/conversations", {
          project_reference: options.projectId,
          title: `Local ${input.agentId}`,
          idempotency_key: `${admissionKey}:conversation`,
        })).id;
        conversations.set(input.threadId, conversationId);
        input.signal.throwIfAborted();
      }
      const lastUser = input.messages.findLast((message) => message.role === "user");
      if (lastUser && !pending.messageMayHaveCommitted) {
        await write(`/conversations/${conversationId}/messages`, {
          role: "user",
          parts: lastUser.parts,
          idempotency_key: `${admissionKey}:message`,
        });
      }
      input.signal.throwIfAborted();
      const accepted = await write("/runs", {
        project_id: options.projectId,
        conversation_id: conversationId,
        target: { type: "agent", id: input.agentId },
        input: lastUser?.parts.filter((part): part is { type: "text"; text: string } =>
          typeof part === "object" && part !== null && "type" in part && part.type === "text" &&
          "text" in part && typeof part.text === "string"
        ).map((part) =>
          part.text
        ).join("\n") ?? "",
        ...(options.environmentId
          ? { execution: { runtime: { type: "environment", id: options.environmentId } } }
          : {}),
        config: {
          agent_admission: {
            mode: "worker",
            agent_identity: { name: input.agentName ?? input.agentId },
            implementation_kind: "veryfront-local",
            source_target_kind: "project",
            worker_key: workerKey,
          },
        },
      }, { "Idempotency-Key": `${admissionKey}:run` });
      pendingAdmissions.delete(requestIdentity);
      const platformOwner = { runId: accepted.id };
      try {
        input.signal.throwIfAborted();
        const claim = await client.claimRun({
          workerId: registered.id,
          leaseDurationSeconds: 60,
          canonicalRunId: accepted.id,
        });
        input.signal.throwIfAborted();
        if (claim?.conversation_id !== conversationId) {
          throw new Error("Veryfront did not return the admitted local run.");
        }
        if (!dependencies.client) {
          const authority = readExternalAgentWorkerRunAuthority(client, claim.run_id);
          if (terminalRoute(authority.run_terminal_token, claim.run_id).id !== accepted.id) {
            throw new Error("Veryfront returned a claim for a different local run.");
          }
        }
        platformOwner.runId = claim.run_id;
        const rootScope = {
          projectId: options.projectId,
          runId: claim.run_id,
          agentId: input.agentId,
        };
        const rootAuthority = platformTools
          ? readExternalAgentWorkerRunAuthority(client, claim.run_id)
          : undefined;
        if (platformTools && rootAuthority) {
          await platformTools.register(
            platformOwner,
            rootScope,
            rootAuthority.run_event_token,
            rootAuthority.auth_token,
            () => readExternalAgentWorkerRunAuthority(client, claim!.run_id),
          );
        }
        const rootWriter = rootAuthority
          ? createHostedRunEventWriterCapability({
            apiUrl: options.apiBaseUrl,
            runId: claim.run_id,
            canonicalRunId: accepted.id,
            runEventAppendToken: rootAuthority.run_event_token,
            fetch: transport,
          })
          : undefined;
        const url = new URL(
          `/projects/${encodeURIComponent(options.projectSlug)}`,
          options.studioUrl,
        );
        url.searchParams.set("panels", "runs");
        url.searchParams.set("runs", `edit:${accepted.id}`);
        const startedAt = Date.now();
        const timestamp = () => `${new Date().toISOString().slice(11, 19)}Z`;
        const agentLabel = normalizeText(input.agentId).slice(0, 128);
        const controller = new AbortController();
        const childScope = new AbortController();
        let finalization: Promise<void> | undefined;
        let finishing = false;
        let output = "";
        let sequence = claim.latest_external_event_sequence;
        let latestEventId = claim.latest_event_id;
        let appendTail: Promise<unknown> = Promise.resolve();
        const append = (
          events: unknown[],
          draining = false,
          toolCallStarts?: { occurrenceId: string; eventIndex: number }[],
        ) => {
          if (finishing && !draining) {
            return Promise.reject(new Error("Local run event writer has ended."));
          }
          const operation = appendTail.then(async () => {
            if (dependencies.append) {
              const result = await dependencies.append(events, sequence);
              sequence = result.latestExternalEventSequence;
              return result;
            }
            const authority = readExternalAgentWorkerRunAuthority(client, claim!.run_id);
            const result = await appendConversationRunEvents({
              apiUrl: options.apiBaseUrl,
              authToken: authority.run_event_token,
              conversationId: conversationId!,
              runId: claim!.run_id,
              canonicalRunId: accepted.id,
              events,
              toolCallStarts,
              fetch: transport,
              expectedPreviousExternalEventSequence: sequence,
              expectedPreviousEventId: latestEventId,
            });
            sequence = result.latestExternalEventSequence;
            latestEventId = result.latestEventId;
            return result;
          });
          appendTail = operation;
          void operation.catch(() => {});
          return operation;
        };
        const pendingStreamEvents: unknown[] = [];
        const streamQueueSnapshot = () => ({
          latestEventId: latestEventId ?? 0,
          latestExternalEventSequence: sequence,
          pendingEventCount: pendingStreamEvents.length,
          consecutiveFailures: 0,
          disabled: false,
        });
        const streamMirror = createConversationRunMirror({
          immediateFlushEventCount: 32,
          flushDelayMs: 50,
          queueController: {
            enqueue(events) {
              pendingStreamEvents.push(...events);
            },
            async flush() {
              const events = pendingStreamEvents.splice(0);
              try {
                if (events.length) await append(events, true);
              } catch (error) {
                pendingStreamEvents.unshift(...events);
                controller.abort(error);
                throw error;
              }
              return { outcome: "flushed", ...streamQueueSnapshot() };
            },
            getSnapshot: streamQueueSnapshot,
          },
        });
        const loggedModels = new Set<string>();
        const sink: AgentRunEventSink = async (event) => {
          if (finishing) throw new Error("Local run event writer has ended.");
          await streamMirror.flush();
          const result = await append([event]);
          if (event.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED" && event.model?.id) {
            const model = normalizeText(event.model.id).slice(0, 256);
            if (!loggedModels.has(model)) {
              loggedModels.add(model);
              log(`${timestamp()} ${agentLabel} model ${model} ${accepted.id}`);
            }
          }
          return event.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED"
            ? result.modelCallCaptures?.find((receipt) => receipt.modelCallId === event.modelCallId)
            : undefined;
        };
        const admittedTools = new Map<string, { name: string; agentId?: string }>();
        const persistedToolStarts = new Set<string>();
        const toolStream = platformTools ? createLocalToolStream() : undefined;
        const childExecutions = new Map<
          string,
          Promise<import("../composition/local-child-execution.ts").LocalChildResult>
        >();
        const encoder = new ConversationRunEventEncoder();
        encoder.encode({ type: "start", messageId: claim.message_id });
        const streamState = createAgUiEncoderState();
        let leaseFailed = false;
        const failLease = (message: string) => {
          leaseFailed = true;
          controller.abort(new Error(message));
        };
        let renewal: Promise<void> | undefined;
        const renewAuthority = () => {
          if (finishing) return Promise.resolve();
          if (renewal !== undefined) return renewal;
          renewal = client.renewLease({
            workerId: registered.id,
            runId: claim.run_id,
            leaseDurationSeconds: 60,
          }).then((lease) => {
            if (!lease) failLease("Veryfront local run lease expired.");
            else if (rootWriter) {
              refreshHostedRunEventWriterCapability(rootWriter, {
                runId: claim!.run_id,
                runEventAppendToken:
                  readExternalAgentWorkerRunAuthority(client, claim!.run_id).run_event_token,
              });
            }
          }).catch(() => failLease("Veryfront local run lease renewal failed.")).finally(() => {
            renewal = undefined;
          });
          return renewal;
        };
        const renew = setInterval(() => {
          void renewAuthority();
        }, 20_000);
        const abort = () => {
          controller.abort(input.signal.reason);
          void finish("cancelled").catch(() => {});
        };
        const finish = async (status: TerminalStatus) => {
          if (finalization !== undefined) return await finalization;
          finishing = true;
          childScope.abort();
          finalization ??= (async () => {
            clearInterval(renew);
            input.signal.removeEventListener("abort", abort);
            if (status !== "completed") controller.abort();
            await renewal;
            await Promise.allSettled(childExecutions.values());
            let appendError: unknown;
            try {
              streamMirror.enqueue(toolStream?.finish() ?? []);
              await streamMirror.flush();
              await appendTail;
            } catch (error) {
              appendError = error;
            } finally {
              streamMirror.dispose();
            }
            const terminalStatus = appendError || leaseFailed ? "failed" : status;
            try {
              // Sandbox cleanup still needs the credentials released by completeRun.
              await platformTools?.revoke(platformOwner);
              await client.completeRun({
                runId: claim!.run_id,
                status: terminalStatus,
                output: streamState.finishObject !== undefined
                  ? streamState.finishObject.value
                  : output,
                ...(terminalStatus === "failed"
                  ? {
                    terminalErrorCode: "LOCAL_EXECUTION_FAILED",
                    terminalErrorMessage:
                      "Local execution failed. See the local terminal for details.",
                  }
                  : {}),
              });
              log(
                `${timestamp()} ${agentLabel} ${terminalStatus} ${accepted.id} (${
                  ((Date.now() - startedAt) / 1000).toFixed(1)
                }s)`,
              );
              if (appendError) throw appendError;
            } catch (error) {
              log(
                `${timestamp()} ${agentLabel} run persistence failed ${accepted.id}. Check the API connection.`,
              );
              throw error;
            } finally {
              await platformTools?.revoke(platformOwner);
              active.delete(run);
            }
          })();
          return await finalization;
        };
        const executeAdmittedLocalChild: Parameters<typeof withLocalChildExecution>[0] = async (
          invocation,
        ) => {
          controller.signal.throwIfAborted();
          if (finishing) throw new Error("Local child authority has ended.");
          const toolCallId = invocation.context?.toolCallId;
          const admitted = toolCallId ? admittedTools.get(toolCallId) : undefined;
          if (
            !toolCallId || !admitted || admitted.name !== invocation.toolName ||
            admitted.agentId !== invocation.agentId
          ) {
            throw new Error("Local child has no matching admitted tool invocation.");
          }
          const previous = childExecutions.get(toolCallId);
          if (previous !== undefined) return await previous;
          let admissionAccepted = false;
          const execute = (async () => {
            await streamMirror.flush();
            // A child's credentials are clipped to this parent capability's expiry.
            await renewAuthority();
            controller.signal.throwIfAborted();
            const authority = readExternalAgentWorkerRunAuthority(client, claim!.run_id);
            const response = await transport(`${options.apiBaseUrl}/runs`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${authority.auth_token}`,
                "Content-Type": "application/json",
                Accept: "application/vnd.veryfront.inherited-run+json",
                "Idempotency-Key": `inherited:${await computeHash(
                  `${accepted.id}:${toolCallId}`,
                )}`,
                "X-Veryfront-Run-Execution-Mode": "inherited",
                [RUN_TERMINAL_TOKEN_HEADER]: authority.run_terminal_token,
              },
              body: JSON.stringify({
                project_id: options.projectId,
                target: { type: "agent", id: invocation.agentId },
                parent_run_id: accepted.id,
                tool_call_id: toolCallId,
                input: { prompt: invocation.input },
              }),
              signal: AbortSignal.any([controller.signal, timeoutSignal(15_000)]),
            });
            const delegated = await acceptWorkflowInheritedRunAdmission(response, {
              projectId: options.projectId,
              parentRunId: accepted.id,
              agentId: invocation.agentId,
              apiUrl: options.apiBaseUrl,
              fetch: transport,
              verifyRunEventAppendToken: platformTools?.verify,
            }, platformTools ? platformOwner : undefined);
            admissionAccepted = true;
            const result = await runInheritedLocalAgent(
              delegated,
              {
                projectId: options.projectId,
                apiUrl: options.apiBaseUrl,
                fetch: transport,
              },
              createInheritedLocalInvocationExecutor(invocation, delegated),
              controller.signal,
              true,
              Boolean(platformTools),
              platformTools ? { tools: platformTools, agentId: invocation.agentId } : undefined,
            );
            if (!result.success) throw new Error(result.error ?? "Local child failed.");
            return readInheritedLocalChildResult(result.output);
          })().finally(() => {
            if (!admissionAccepted && childExecutions.get(toolCallId) === execute) {
              childExecutions.delete(toolCallId);
            }
          });
          childExecutions.set(toolCallId, execute);
          return await execute;
        };
        const executeWithLocalChildScope = <T>(operation: () => T | Promise<T>): Promise<T> =>
          withLocalChildExecution(
            executeAdmittedLocalChild,
            async () => await operation(),
            // wrapStream persists the parent stream; this scope only admits child tool calls.
            async () => {},
            async (id, name, input) => {
              const agentId = admittedChildAgentId(name, input);
              admittedTools.set(id, { name, agentId });
              if (!platformTools && !persistedToolStarts.has(id)) {
                persistedToolStarts.add(id);
                streamMirror.enqueue(
                  encoder.encode({ type: "tool-input-start", toolCallId: id, toolName: name }),
                );
              }
              await streamMirror.flush();
            },
            undefined,
            childScope.signal,
          );
        const executeInRunScope: ConnectedLocalRun["execute"] = (operation) =>
          runWithMandatoryRunEventSink(
            sink,
            () =>
              platformTools && rootWriter
                ? platformTools.run({
                  owner: platformOwner,
                  scope: rootScope,
                  canonicalRunId: accepted.id,
                  writer: rootWriter,
                  signal: controller.signal,
                  admit: async (call, name) => {
                    await streamMirror.flush();
                    const result = await append(
                      [{
                        type: "TOOL_CALL_START",
                        toolCallId: call.toolCallId,
                        toolCallName: name,
                      }],
                      false,
                      [{ occurrenceId: call.occurrenceId, eventIndex: 0 }],
                    );
                    persistedToolStarts.add(call.toolCallId);
                    streamMirror.enqueue(toolStream?.admit(call.toolCallId) ?? []);
                    const receipts = "toolCallAdmissions" in result
                      ? result.toolCallAdmissions as AgentRunToolCallAdmissionReceipt[]
                      : [];
                    const receipt = receipts?.find((row) => row.occurrenceId === call.occurrenceId);
                    if (!receipt) throw new Error("Connected tool admission receipt missing");
                    await streamMirror.flush();
                    return receipt;
                  },
                }, () => executeWithLocalChildScope(operation))
                : executeWithLocalChildScope(operation),
          );
        const run: ConnectedLocalRun = {
          runId: claim.run_id,
          conversationId,
          context: {
            projectId: options.projectId,
            projectSlug: options.projectSlug,
            agentId: input.agentId,
          },
          signal: controller.signal,
          finish,
          execute: executeInRunScope,

          async prepareAgent(agent) {
            const assertActive = () => {
              controller.signal.throwIfAborted();
              if (finalization !== undefined) {
                throw new Error("Local run inference authority has ended.");
              }
            };
            const credential = () => {
              assertActive();
              const token =
                readExternalAgentWorkerRunAuthority(client, claim!.run_id).inference_token;
              if (!token) {
                throw new Error(
                  "Veryfront API does not provide run-scoped inference authority. Update the API before using connected local development.",
                );
              }
              return token;
            };
            const scope = () => ({
              apiBaseUrl: options.apiBaseUrl,
              apiToken: credential(),
              projectSlug: options.projectSlug,
            });
            const resolver: AgentModelRuntimeResolver = (model) => {
              const id = model.startsWith("veryfront-cloud/")
                ? model.slice("veryfront-cloud/".length)
                : model;
              return createRenewingLocalModel(
                credential,
                createConnectedLocalModelFactory(id, options, assertActive),
              );
            };
            const catalog = {
              load: async () => {
                await loadVeryfrontCloudCatalog({
                  ...scope(),
                  fresh: true,
                  maxWaitMs: 3000,
                  assertCredentialActive: assertActive,
                });
              },
              read: <T>(fn: () => T) => withVeryfrontCloudCatalogScope(scope(), fn),
            };
            registerModelRuntimeResolverCatalog(resolver, catalog);
            await catalog.load();
            const writer = createRuntimeObservationWriterCapability({
              scope: {
                runId: claim!.run_id,
                canonicalRunId: accepted.id,
                projectId: options.projectId,
              },
              assertActive,
            });
            bindRuntimeObservationWriterCapability(sink, writer);
            return catalog.read(() =>
              createEphemeralAgentWithRuntimeOptions({
                ...getAgentExecutionConfig(agent.config),
                id: agent.id,
                tools: agent.config.tools === true ? true : buildExplicitAgUiSourceTools(agent),
                toolLoading: resolveRuntimeToolLoading(agent.config).mode,
                ...(agent.config.tools === true ? {} : { delegates: undefined }),
              }, {
                resolveModelRuntime: resolver,
                preserveToolCatalog: agent.config.tools !== true,
              })
            );
          },
          wrapStream(body) {
            const iterator = streamDataStreamEvents(body, controller.signal);
            let finished = false;

            return new ReadableStream<Uint8Array>({
              async pull(streamController) {
                try {
                  const next = await executeInRunScope(async () => {
                    controller.signal.throwIfAborted();
                    return await iterator.next();
                  });
                  if (next.done) {
                    if (
                      !finished ||
                      (!streamState.sawVisibleOutput && streamState.finishObject === undefined)
                    ) {
                      throw new Error(
                        "Local model stream ended before producing completed output.",
                      );
                    }
                    await finish("completed");
                    streamController.close();
                    return;
                  }
                  const event = next.value;
                  if (event.type === "error") throw new Error("Local model execution failed.");
                  if (event.type === "text-delta" && typeof event.delta === "string") {
                    output += event.delta;
                  }
                  mapRuntimeStreamEventToAgUiEvents(streamState, event);
                  if (event.type === "message-finish") finished = true;
                  const encoded = encodeMirroredStreamEvents(event, encoder, persistedToolStarts);
                  const events = toolStream ? toolStream.encode(encoded) : encoded;
                  if (events.length) {
                    streamMirror.enqueue(events);
                    // Bound backlog while allowing ordinary deltas to reach the browser
                    // independently of the Cloud append round-trip.
                    if (streamMirror.getSnapshot().pendingEventCount >= 64) {
                      await streamMirror.flush();
                    }
                  }
                  streamController.enqueue(
                    new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
                  );
                } catch (error) {
                  try {
                    await finish(controller.signal.aborted ? "cancelled" : "failed");
                    streamController.error(error);
                  } finally {
                    await iterator.return(undefined);
                  }
                }
              },
              async cancel() {
                controller.abort();
                try {
                  await iterator.return(undefined);
                } finally {
                  await finish("cancelled");
                }
              },
            });
          },
        };
        active.add(run);
        input.signal.addEventListener("abort", abort, { once: true });
        if (input.signal.aborted) abort();
        log(
          `${timestamp()} ${agentLabel} started ${accepted.id} (runtime ${workerKey}, environment ${
            options.environmentName ?? options.environmentId ?? "main"
          })\nStudio: ${url.href}`,
        );
        return run;
      } catch (error) {
        await Promise.allSettled([
          api(`/runs/${encodeURIComponent(accepted.id)}/cancel`, {}, {
            "Idempotency-Key": `local-cancel:${accepted.id}`,
          }).catch(() => {
            log(`Could not cancel local run ${accepted.id}. Check its status in Studio.`);
          }),
          platformTools?.revoke(platformOwner),
        ]);
        throw error;
      }
    });
    admissionTail = operation.catch(() => {});
    return await operation;
  }
  return {
    runtimeId: workerKey,
    admit,
    async dispose() {
      closed = true;
      await admissionTail;
      pendingAdmissions.clear();
      const results = await Promise.allSettled([...active].map((run) => run.finish("cancelled")));
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
    },
  };
}
