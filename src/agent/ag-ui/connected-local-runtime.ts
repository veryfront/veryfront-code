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
  signal: AbortSignal;
  prepareAgent(agent: Agent): Promise<Agent>;
  execute<T>(operation: () => T): T;
  wrapStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array>;
  finish(status: TerminalStatus): Promise<void>;
}

const responseJson = Response.prototype.json;
const apply = Reflect.apply;
const timeoutSignal = AbortSignal.timeout.bind(AbortSignal);
const anySignal = AbortSignal.any.bind(AbortSignal);

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
  const log = dependencies.log ?? console.log;
  const workerKey = `local:${crypto.randomUUID()}`;
  const conversations = new Map<string, string>();
  const pendingAdmissions = new Map<string, { key: string; messagePersisted: boolean }>();
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
    if (!response.ok) {
      const problem = await (apply(responseJson, response, []) as Promise<Record<string, unknown>>)
        .catch((): Record<string, unknown> => ({}));
      const detail = typeof problem.detail === "string" ? problem.detail : "";
      const message = response.status === 401
        ? "Veryfront login expired. Run veryfront login, then npm run dev again."
        : response.status === 403
        ? "You do not have access to this Veryfront project or environment."
        : detail.includes("selected environment has no deployed release")
        ? "The selected environment has no deployed release. Connected local execution requires an API that supports local source with environment selection."
        : detail.includes("account ownership")
        ? "Project billing is not ready. Complete the project account setup in Studio."
        : `Veryfront local run admission failed (HTTP ${response.status}). Check your project, environment, and API version.`;
      log(message);
      throw new ConnectedLocalAdmissionError(
        response.status >= 400 && response.status < 500 ? response.status : 502,
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
      const requestKey = JSON.stringify([input.agentId, input.threadId, input.messages]);
      const admission = pendingAdmissions.get(requestKey) ?? {
        key: `local-admission:${crypto.randomUUID()}`,
        messagePersisted: false,
      };
      pendingAdmissions.set(requestKey, admission);
      let conversationId = conversations.get(input.threadId);
      if (!conversationId) {
        conversationId = (await api("/conversations", {
          project_reference: options.projectId,
          title: `Local ${input.agentId}`,
          idempotency_key: `${workerKey}:${input.threadId}`,
        })).id;
        conversations.set(input.threadId, conversationId);
        input.signal.throwIfAborted();
      }
      const lastUser = input.messages.findLast((message) => message.role === "user");
      if (lastUser && !admission.messagePersisted) {
        await api(`/conversations/${conversationId}/messages`, {
          role: "user",
          parts: lastUser.parts,
          idempotency_key: admission.key,
        });
        admission.messagePersisted = true;
      }
      input.signal.throwIfAborted();
      const accepted = await api("/runs", {
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
      }, { "Idempotency-Key": admission.key });
      pendingAdmissions.delete(requestKey);
      try {
        input.signal.throwIfAborted();
        const claim = await client.claimRun({
          workerId: registered.id,
          leaseDurationSeconds: 60,
          canonicalRunId: accepted.id,
        });
        input.signal.throwIfAborted();
        if (!claim || claim.conversation_id !== conversationId) {
          throw new Error("Veryfront did not return the admitted local run.");
        }
        if (!dependencies.client) {
          const authority = readExternalAgentWorkerRunAuthority(client, claim.run_id);
          if (terminalRoute(authority.run_terminal_token, claim.run_id).id !== accepted.id) {
            throw new Error("Veryfront returned a claim for a different local run.");
          }
        }
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
        let finalization: Promise<void> | undefined;
        let finishing = false;
        let output = "";
        let sequence = claim.latest_external_event_sequence;
        let latestEventId = claim.latest_event_id;
        let appendTail: Promise<unknown> = Promise.resolve();
        const append = (events: unknown[]) => {
          if (finishing) return Promise.reject(new Error("Local run event writer has ended."));
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
        const loggedModels = new Set<string>();
        const sink: AgentRunEventSink = async (event) => {
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
        const encoder = new ConversationRunEventEncoder();
        encoder.encode({ type: "start", messageId: claim.message_id });
        const streamState = createAgUiEncoderState();
        let leaseFailed = false;
        const failLease = (message: string) => {
          leaseFailed = true;
          controller.abort(new Error(message));
        };
        let renewal: Promise<void> | undefined;
        const renew = setInterval(() => {
          if (finishing || renewal) return;
          renewal = client.renewLease({
            workerId: registered.id,
            runId: claim.run_id,
            leaseDurationSeconds: 60,
          }).then((lease) => {
            if (!lease) failLease("Veryfront local run lease expired.");
          }).catch(() => failLease("Veryfront local run lease renewal failed.")).finally(() => {
            renewal = undefined;
          });
        }, 20_000);
        const abort = () => {
          controller.abort(input.signal.reason);
          void finish("cancelled").catch(() => {});
        };
        const finish = async (status: TerminalStatus) => {
          if (finalization) return await finalization;
          finishing = true;
          return await (finalization ??= (async () => {
            clearInterval(renew);
            input.signal.removeEventListener("abort", abort);
            if (status !== "completed") controller.abort();
            await renewal;
            let appendError: unknown;
            try {
              await appendTail;
            } catch (error) {
              appendError = error;
            }
            const terminalStatus = appendError || leaseFailed ? "failed" : status;
            try {
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
              active.delete(run);
            }
          })());
        };
        const run: ConnectedLocalRun = {
          runId: accepted.id,
          conversationId,
          signal: controller.signal,
          finish,
          execute: (operation) => runWithMandatoryRunEventSink(sink, operation),
          async prepareAgent(agent) {
            const assertActive = () => {
              controller.signal.throwIfAborted();
              if (finalization) throw new Error("Local run inference authority has ended.");
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
                (token) =>
                  createVeryfrontCloudInferenceModel(id, token, {
                    apiBaseUrl: options.apiBaseUrl,
                    assertInferenceCredentialActive: assertActive,
                  }),
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
                tools: buildExplicitAgUiSourceTools(agent),
                delegates: undefined,
              }, { resolveModelRuntime: resolver, preserveToolCatalog: true })
            );
          },
          wrapStream(body) {
            const iterator = streamDataStreamEvents(body, controller.signal);
            let finished = false;

            return new ReadableStream<Uint8Array>({
              async pull(streamController) {
                try {
                  controller.signal.throwIfAborted();
                  const next = await iterator.next();
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
                  const type = event.type === "step-start"
                    ? "start-step"
                    : event.type === "step-end"
                    ? "finish-step"
                    : event.type;
                  if (!["message-start", "message-finish", "data"].includes(type)) {
                    const events = encoder.encode({ ...event, type } as ChatStreamEvent).map(
                      (encoded) =>
                        encoded.type === "CUSTOM"
                          ? buildRuntimeEventRecordedEvent({
                            runtime: "veryfront",
                            kind: getNonEmptyStringSchema().parse(encoded.name),
                            value: encoded.value,
                          }).durable
                          : encoded,
                    );
                    if (events.length) {
                      await append(events);
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
        try {
          await api(`/runs/${encodeURIComponent(accepted.id)}/cancel`, {}, {
            "Idempotency-Key": `local-cancel:${accepted.id}`,
          });
        } catch {
          log(`Could not cancel local run ${accepted.id}. Check its status in Studio.`);
        }
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
      const results = await Promise.allSettled([...active].map((run) => run.finish("cancelled")));
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
    },
  };
}
