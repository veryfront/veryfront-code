import {
  inheritHostedToolApprovalCapability,
  registerHostedToolApprovalCapability,
} from "../hosted/tool-approval-capability.ts";
import { bindHostedToolRunAuthorization } from "../hosted/terminal-credential.ts";
import { getHostedToolApprovalRunId } from "../hosted/tool-run-authorization.ts";
import {
  RUNTIME_EVENT_PERSISTENCE_HEADER,
  RUNTIME_EVENT_PERSISTENCE_MODE,
} from "../hosted/event-persistence-contract.ts";
import {
  inheritIngressCredentials,
  readIngressCredential,
} from "#veryfront/security/http/ingress-credentials.ts";
import {
  createHostedAgentManualPause,
  hasHostedAgentPauseStopped,
  inheritHostedAgentPauseCapability,
  registerHostedAgentPauseFactory,
} from "../hosted/manual-pause-credential.ts";
import {
  invalidateHostedAgentPauseSettlement,
  recordHostedAgentPauseCleanup,
  recordHostedAgentPauseFlush,
  settleHostedAgentPause,
} from "../hosted/manual-pause-settlement.ts";
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
import { resolveHostOwnedSourceApiBaseUrl } from "#veryfront/config/host-api-base.ts";
import { resolveVeryfrontInferenceApiBaseUrlFromHostEnv } from "#veryfront/platform/cloud/resolver.ts";
import { createVeryfrontCloudInferenceModelResolver } from "../hosted/inference-credential.ts";
import type { AgentModelRuntimeResolver } from "../runtime/model-transport.ts";
import { bindManagedBrokerInferenceAuthority } from "./managed-broker-inference.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { getRuntimeAgentResumeToolCallSchema } from "#veryfront/agent/runtime/agent-invocation-contract.ts";
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

/** Handles signed run invocations with configured detached or request-owned SSE responses. */
export function createManagedBrokerHandler<TAuthorization>(options: {
  broker: ManagedExecutorStarter;
  /** Trusted inference destination; omitted legacy callers retain host-environment routing. */
  inferenceApiBaseUrl?: string;
  /** Trusted source-knowledge destination; never selected by project code. */
  knowledgeApiBaseUrl?: string;
  /** Trusted route configuration; never read from request data. */
  responseMode: "detached" | "sse";
  /** Includes canceled executions until executor and persistence cleanup settle. */
  maxActiveRuns?: number;
  signal?: AbortSignal;
  resolveIngressOptions(input: {
    request: Request;
    runId: string;
  }): Omit<BrokerRuntimeAgentIngressOptions<TAuthorization>, "expectedRunId">;
  prepare(input: {
    ingress: BrokerRuntimeAgentIngress<TAuthorization>;
    signal: AbortSignal;
  }): Promise<ManagedBrokerPreparation>;
  /** Host-only approval transport; never populated from request/project data. */
  approvalApiBaseUrl?: string;
  approvalFetch?: typeof fetch;
  onExecutionError?: (error: unknown, runId: string) => void;
}) {
  const inferenceApiBaseUrl = options.inferenceApiBaseUrl;
  return createManagedBrokerIngressHandler({
    ...options,
    createInferenceResolver(ingress) {
      const credential = ingress.privateAuthority.inferenceAuthToken;
      return credential
        ? createVeryfrontCloudInferenceModelResolver(credential, {
          apiBaseUrl: inferenceApiBaseUrl ?? resolveVeryfrontInferenceApiBaseUrlFromHostEnv(),
          projectSlug: ingress.executor.run.project.projectSlug,
        })
        : undefined;
    },
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
          ...(ingress.executor.input.resumeToolCall ? { resumed: true as const } : {}),
        },
      };
    },
  });
}

type ManagedBrokerPreparation = {
  start: ManagedExecutorStartInput;
  messages: HostedChatRuntimeStreamInput["messages"];
  executionSignal: AbortSignal;
  cancelExecution?: () => void;
  output?: ManagedBrokerOutput;
  eventPersistence?: typeof RUNTIME_EVENT_PERSISTENCE_MODE;
  cleanup?: () => Promise<void>;
};

function snapshotManagedResumeToolCall(
  value: ManagedDurableAgentIngressResult["executor"]["serverResolvedResumeToolCall"],
) {
  if (value === undefined) return undefined;
  const parsed = getRuntimeAgentResumeToolCallSchema().safeParse(value);
  if (!parsed.success) throw new TypeError("Invalid managed resume tool call");
  const snapshot = snapshotBoundedJsonValue(parsed.data);
  if (!snapshot.success) throw new TypeError("Invalid managed resume tool call");
  return snapshot.value as NonNullable<
    ManagedDurableAgentIngressResult["executor"]["serverResolvedResumeToolCall"]
  >;
}

function brokerOwnedApprovalCredential(
  ingress: unknown,
  runId: string,
): { authToken: string; approvalRunId: string } | undefined {
  if (ingress === null || typeof ingress !== "object") return undefined;
  const authority = Object.getOwnPropertyDescriptor(ingress, "privateAuthority")?.value;
  if (authority !== null && typeof authority === "object") {
    // Signed broker admission owns execution persistence; sourceAuthToken is never approval authority.
    const token = Object.getOwnPropertyDescriptor(authority, "apiAuthToken")?.value;
    return typeof token === "string" && token.length > 0
      ? { authToken: token, approvalRunId: runId }
      : undefined;
  }
  const broker = Object.getOwnPropertyDescriptor(ingress, "broker")?.value;
  if (!broker || typeof broker.getParsedRequest !== "function") return undefined;
  const parsed = broker.getParsedRequest();
  // A public durableRootRun/runId field is insufficient: require the private canonical ingress proof.
  const carrier = { projectId: parsed.projectId, runId };
  bindHostedToolRunAuthorization(carrier, parsed);
  const approvalRunId = getHostedToolApprovalRunId(carrier, carrier);
  if (approvalRunId === undefined) return undefined;
  return typeof parsed.authToken === "string" && parsed.authToken.length > 0
    ? { authToken: parsed.authToken, approvalRunId }
    : undefined;
}

function brokerOwnedKnowledgeAuthToken(ingress: unknown): string | undefined {
  if (ingress === null || typeof ingress !== "object") return undefined;
  const privateAuthorityDescriptor = Object.getOwnPropertyDescriptor(ingress, "privateAuthority");
  if (!privateAuthorityDescriptor || !Object.hasOwn(privateAuthorityDescriptor, "value")) {
    return undefined;
  }
  const privateAuthority = privateAuthorityDescriptor.value;
  if (privateAuthority === null || typeof privateAuthority !== "object") return undefined;
  // Shared agents read knowledge from their source release, independently of
  // the consuming project's run persistence and billing authority.
  const tokenDescriptor = Object.getOwnPropertyDescriptor(privateAuthority, "sourceAuthToken") ??
    Object.getOwnPropertyDescriptor(privateAuthority, "apiAuthToken");
  if (!tokenDescriptor || !Object.hasOwn(tokenDescriptor, "value")) return undefined;
  const token = tokenDescriptor.value;
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

function bindBrokerOwnedHostedKnowledgeCredential(
  start: ManagedExecutorStartInput,
  ingress: unknown,
  apiBaseUrl?: string,
): ManagedExecutorStartInput {
  const trustedRuntime = start.trustedRuntime;
  if (trustedRuntime === undefined) return start;
  const hostedKnowledgeAuthToken = brokerOwnedKnowledgeAuthToken(ingress);
  if (hostedKnowledgeAuthToken === undefined) return start;
  return {
    ...start,
    trustedRuntime: {
      ...trustedRuntime,
      hostedKnowledgeAuthToken,
      hostedKnowledgeApiUrl: apiBaseUrl ?? resolveHostOwnedSourceApiBaseUrl(),
    },
  };
}

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
  /** Host-only approval transport; never populated from request/project data. */
  approvalApiBaseUrl?: string;
  approvalFetch?: typeof fetch;
  onExecutionError?: (error: unknown, runId: string) => void;
}) {
  const owner = getHostedExecutorOwnerSchema().parse(options.owner);
  if (!options.defaultAgentId.trim()) {
    throw new TypeError("Managed broker default agent is required");
  }
  return createManagedBrokerIngressHandler({
    ...options,
    responseMode: "sse",
    createInferenceResolver: (ingress) =>
      ingress.broker.createInferenceModelResolver({
        apiBaseUrl: resolveVeryfrontInferenceApiBaseUrlFromHostEnv(),
      }),
    async parse(request, signal) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/api/ag-ui") {
        return Response.json({ errorCode: "BROKER_INGRESS_TARGET_MISMATCH" }, { status: 400 });
      }
      signal.throwIfAborted();
      // Preserve the streaming body explicitly: Bun otherwise leaves the cloned body unread.
      const ingress = await parseManagedAgUiAgentIngress(
        inheritIngressCredentials(
          request,
          new Request(request, { signal, body: request.body, duplex: "half" } as RequestInit),
        ),
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
  /** Host-only approval transport; never populated from request/project data. */
  approvalApiBaseUrl?: string;
  approvalFetch?: typeof fetch;
  onExecutionError?: (error: unknown, runId: string) => void;
}) {
  const owner = getHostedExecutorOwnerSchema().parse(options.owner);
  if (typeof options.ingress.verifyRunEventAppendToken !== "function") {
    throw new TypeError("Managed durable broker requires run-event authorization");
  }
  return createManagedBrokerIngressHandler<ManagedDurableAgentIngressResult>({
    ...options,
    responseMode: "detached",
    createInferenceResolver: (ingress) =>
      ingress.broker.createInferenceModelResolver({
        apiBaseUrl: resolveVeryfrontInferenceApiBaseUrlFromHostEnv(),
      }),
    async prepare(input) {
      const resumeToolCall = snapshotManagedResumeToolCall(
        input.ingress.executor.serverResolvedResumeToolCall,
      );
      const prepared = await options.prepare(input);
      const parsedRequest = input.ingress.broker.getParsedRequest();
      registerHostedAgentPauseFactory(
        prepared.start,
        (signal) =>
          createHostedAgentManualPause(
            parsedRequest,
            AbortSignal.any([signal, prepared.executionSignal]),
            prepared.executionSignal,
          ),
      );
      const toolExposureCheckpoint = parsedRequest.serverResolvedToolExposureCheckpoint;
      const persistence = toolExposureCheckpoint &&
          prepared.start.persistence.persistToolExposureCheckpoint
        ? {
          ...prepared.start.persistence,
          initialToolExposureCheckpoint: toolExposureCheckpoint,
        }
        : prepared.start.persistence;
      if (!prepared.start.prepare) {
        if (persistence === prepared.start.persistence) return prepared;
        const start = { ...prepared.start, persistence };
        inheritHostedAgentPauseCapability(start, prepared.start);
        inheritHostedToolApprovalCapability(start, prepared.start);
        return { ...prepared, start };
      }
      const {
        serverResolvedResumeToolCall: _untrustedAdapterResumeToolCall,
        ...basePrepare
      } = prepared.start.prepare;
      const start = {
        ...prepared.start,
        persistence,
        prepare: {
          ...basePrepare,
          ...(resumeToolCall ? { serverResolvedResumeToolCall: resumeToolCall } : {}),
        },
      };
      inheritHostedAgentPauseCapability(start, prepared.start);
      inheritHostedToolApprovalCapability(start, prepared.start);
      return { ...prepared, start };
    },
    async parse(request, signal) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/api/runs") {
        return Response.json({ errorCode: "BROKER_INGRESS_TARGET_MISMATCH" }, { status: 400 });
      }
      if (!readIngressCredential(request, "x-veryfront-run-event-token")?.trim()) {
        return Response.json({ errorCode: "BROKER_INGRESS_AUTH_REQUIRED" }, { status: 401 });
      }
      signal.throwIfAborted();
      // Preserve the streaming body explicitly: Bun otherwise leaves the cloned body unread.
      const ingress = await parseManagedDurableAgentIngress(
        inheritIngressCredentials(
          request,
          new Request(request, { signal, body: request.body, duplex: "half" } as RequestInit),
        ),
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
  maxActiveRuns?: number;
  knowledgeApiBaseUrl?: string;
  signal?: AbortSignal;
  parse(request: Request, signal: AbortSignal): Promise<
    Response | {
      ingress: TIngress;
      runId: string;
      runKey: string;
      stream?: { threadId: string; agentId: string; agUiInput: AgUiRuntimeRequest; resumed?: true };
    }
  >;
  prepare(input: { ingress: TIngress; signal: AbortSignal }): Promise<ManagedBrokerPreparation>;
  createInferenceResolver(ingress: TIngress): AgentModelRuntimeResolver | undefined;
  /** Host-only approval transport; never populated from request/project data. */
  approvalApiBaseUrl?: string;
  approvalFetch?: typeof fetch;
  onExecutionError?: (error: unknown, runId: string) => void;
}) {
  const knowledgeApiBaseUrl = options.knowledgeApiBaseUrl;
  const maxActiveRuns = options.maxActiveRuns;
  if (
    maxActiveRuns !== undefined &&
    (!Number.isSafeInteger(maxActiveRuns) || maxActiveRuns < 1 || maxActiveRuns > 1024)
  ) {
    throw new TypeError("Invalid managed run ownership limit");
  }
  const active = new Map<string, { accepted: boolean; settled: Promise<void> }>();
  const lifetime = new AbortController();
  const executions = new Set<Promise<void>>();
  // Includes authentication/body reads before a run reservation exists.
  const admissions = new Set<Promise<void>>();
  let draining = false;
  let closed = false;

  async function handle(request: Request): Promise<Response> {
    if (closed || draining || options.signal?.aborted) {
      return Response.json({ errorCode: "BROKER_UNAVAILABLE" }, { status: 503 });
    }
    const admission = Promise.withResolvers<void>();
    admissions.add(admission.promise);
    try {
      const signal = AbortSignal.any([
        request.signal,
        lifetime.signal,
        ...(options.signal ? [options.signal] : []),
      ]);
      const parsed = await options.parse(request, signal);
      if (isResponseLike(parsed)) return parsed;
      const { ingress, runId, runKey } = parsed;
      // A parse already in flight when draining began cannot acquire a late reservation.
      assertAvailable(closed || draining, signal);
      const existing = active.get(runKey);
      if (existing) {
        if (!existing.accepted) {
          return Response.json({ errorCode: "BROKER_RUN_PENDING" }, { status: 409 });
        }
        return options.responseMode === "detached"
          ? Response.json({ accepted: true, duplicate: true }, { status: 202 })
          : Response.json({ errorCode: "BROKER_RUN_ALREADY_ACTIVE" }, { status: 409 });
      }
      if (maxActiveRuns !== undefined && active.size >= maxActiveRuns) {
        return Response.json({ errorCode: "BROKER_UNAVAILABLE" }, { status: 503 });
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
        const executionCredential = brokerOwnedApprovalCredential(ingress, runId);
        if (executionCredential !== undefined) {
          registerHostedToolApprovalCapability(prepared.start, {
            runId,
            apiUrl: options.approvalApiBaseUrl ?? resolveHostOwnedSourceApiBaseUrl(),
            authToken: executionCredential.authToken,
            approvalRunId: executionCredential.approvalRunId,
            signal: AbortSignal.any([
              prepared.executionSignal,
              lifetime.signal,
              ...(options.signal ? [options.signal] : []),
            ]),
            ...(options.approvalFetch ? { fetch: options.approvalFetch } : {}),
          });
        }
        if (
          prepared.eventPersistence !== undefined && (
            prepared.eventPersistence !== RUNTIME_EVENT_PERSISTENCE_MODE ||
            options.responseMode !== "sse" ||
            typeof prepared.output?.write !== "function" ||
            typeof prepared.output?.finish !== "function"
          )
        ) throw new TypeError("Invalid negotiated event writer");

        const inference = bindManagedBrokerInferenceAuthority({
          start: prepared.start,
          createResolver: () => options.createInferenceResolver(ingress),
          signal: AbortSignal.any([
            prepared.executionSignal,
            lifetime.signal,
            ...(options.signal ? [options.signal] : []),
          ]),
          cleanup: prepared.cleanup,
        });
        preparedCleanup = inference.cleanup;
        assertAvailable(closed, signal);
        if (
          options.responseMode === "detached" &&
          (typeof prepared.output?.write !== "function" ||
            typeof prepared.output?.finish !== "function")
        ) {
          throw new Error("Detached broker output persistence is required");
        }
        inheritHostedAgentPauseCapability(
          prepared.start,
          ingress as object,
          prepared.executionSignal,
        );
        const start = bindBrokerOwnedHostedKnowledgeCredential(
          {
            ...inference.start,
            session: {
              ...prepared.start.session,
              preparationSignal: AbortSignal.any([signal, prepared.executionSignal]),
            },
          },
          ingress,
          knowledgeApiBaseUrl,
        );
        inheritHostedAgentPauseCapability(start, prepared.start);
        inheritHostedToolApprovalCapability(start, prepared.start);
        const runtime = await options.broker.start(start, {
          onAdmitted(settled) {
            admissionSettled = settled;
          },
        });
        admissionSettled = runtime.settled;
        const sseFinalization = options.responseMode === "sse" && prepared.output
          ? retainManagedBrokerOutputFinalization(runtime, prepared.output)
          : undefined;
        const refuseRuntime = async (error: unknown): Promise<never> => {
          let failure = error;
          try {
            await sseFinalization?.finish({ completed: false, error });
          } catch (terminalError) {
            failure = new AggregateError(
              [error, terminalError],
              "Managed SSE setup and finalization failed",
            );
          }
          try {
            await runtime.close("canceled");
          } catch (closeError) {
            failure = new AggregateError(
              [failure, closeError],
              "Managed runtime retirement failed",
            );
          }
          void retire(runtime.settled).catch(() => {});
          throw failure;
        };
        try {
          await sseFinalization?.ready;
          runtime.accept(
            options.responseMode === "detached"
              ? { kind: "execution", signal: prepared.executionSignal }
              : { kind: "request" },
          );
          activeRun.accepted = true;
        } catch (error) {
          return await refuseRuntime(error);
        }
        if (options.responseMode === "sse") {
          try {
            if (!parsed.stream) throw new TypeError("Managed broker stream context is required");
            const response = await createSseResponse({
              runtime,
              messages: prepared.messages,
              requestSignal: AbortSignal.any([request.signal, prepared.executionSignal]),
              cancelExecution: prepared.cancelExecution?.bind(prepared),
              output: prepared.output,
              onExecutionError: (error) => options.onExecutionError?.(error, runId),
              finishOutput: sseFinalization?.finish,
              runId,
              ...parsed.stream,
              onSettled: async () => {
                try {
                  await retire(runtime.settled);
                  await settleHostedAgentPause(runtime);
                } catch (error) {
                  invalidateHostedAgentPauseSettlement(runtime, error);
                  throw error;
                }
              },
              trackExecution: (execution) => {
                executions.add(execution);
                void execution.finally(() => executions.delete(execution)).catch(() => {});
              },
            });
            if (prepared.eventPersistence) {
              response.headers.set(RUNTIME_EVENT_PERSISTENCE_HEADER, prepared.eventPersistence);
            }
            return response;
          } catch (error) {
            return await refuseRuntime(error);
          }
        }
        const execution = runDetached(
          runtime,
          prepared.messages,
          prepared.executionSignal,
          prepared.output!,
        )
          .then(async () => {
            await retire(runtime.settled);
            await settleHostedAgentPause(runtime);
          })
          .catch((error) => {
            invalidateHostedAgentPauseSettlement(runtime, error);
            try {
              options.onExecutionError?.(error, runId);
            } catch { /* Observability cannot own execution settlement. */ }
          }).finally(() => {
            executions.delete(execution);
            void retire(runtime.settled).catch(() => {});
          });
        executions.add(execution);
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
    } finally {
      admissions.delete(admission.promise);
      admission.resolve();
    }
  }

  const pendingWork =
    () => [...admissions, ...[...active.values()].map((run) => run.settled), ...executions];
  const beginDrain = () => {
    draining = true;
  };
  /** Stop new starts, then await owned admissions/executions without cancelling them.
   * A false result leaves forced abort/close to the process owner's cleanup phase.
   */
  async function drain({ timeoutMs }: { timeoutMs: number }): Promise<boolean> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300_000) {
      throw new TypeError("Invalid managed broker drain timeout");
    }
    beginDrain();
    if (!pendingWork().length) return true;
    if (timeoutMs === 0) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      // Preparation can register execution after the first snapshot; reservation
      // retirement can precede its durable finalizer. Recheck all owners without
      // renewing the single total grace window.
      while (true) {
        const pending = pendingWork();
        if (!pending.length) return true;
        if (!await Promise.race([Promise.allSettled(pending).then(() => true), expired])) {
          return false;
        }
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async function close(): Promise<void> {
    closed = true;
    beginDrain();
    lifetime.abort();
    await Promise.allSettled(
      [...active.values()].map((run) => run.settled).concat([...executions]),
    );
  }

  return {
    handle,
    beginDrain,
    drain,
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

type ManagedOutputOutcome = Parameters<ManagedBrokerOutput["finish"]>[0];

/** Reserve terminal IO before request ownership can stop the executor session. */
function retainManagedBrokerOutputFinalization(
  runtime: ManagedExecutorRuntime,
  output: ManagedBrokerOutput,
) {
  const request = Promise.withResolvers<ManagedOutputOutcome>();
  const ready = Promise.withResolvers<void>();
  const owned = runtime.runOwned(async () => {
    ready.resolve();
    await output.finish(await request.promise);
  });
  void owned.catch(ready.reject);
  return {
    ready: ready.promise,
    finish(outcome: ManagedOutputOutcome) {
      request.resolve(outcome);
      return owned;
    },
  };
}

/** Project explicit runtime errors to known public codes and retain the original privately. */
function normalizeManagedErrorChunk(chunk: { errorText: string; code?: unknown }) {
  const schema = getExecutorAgentFailureCodeSchema();
  const explicit = schema.safeParse(chunk.code);
  // Older UI-message producers carry a known code only in errorText. Accept
  // exact registered codes, never a diagnostic prefix or arbitrary message.
  const code = explicit.success ? explicit : schema.safeParse(chunk.errorText);
  const failure = new ExecutorAgentError(code.success ? code.data : "EXECUTOR_AGENT_STREAM_FAILED");
  const diagnostic = new Error(chunk.errorText);
  Object.defineProperty(failure, "cause", { value: diagnostic });
  return {
    chunk: { type: "error" as const, errorText: failure.message, code: failure.code },
    failure,
    diagnostic,
  };
}

async function createSseResponse(input: {
  runtime: ManagedExecutorRuntime;
  messages: HostedChatRuntimeStreamInput["messages"];
  requestSignal: AbortSignal;
  cancelExecution?: () => void;
  output?: ManagedBrokerOutput;
  finishOutput?: (outcome: ManagedOutputOutcome) => Promise<void>;
  onExecutionError?: (error: unknown) => void;
  runId: string;
  threadId: string;
  agentId: string;
  agUiInput: AgUiRuntimeRequest;
  resumed?: true;
  onSettled(): Promise<void>;
  trackExecution(execution: Promise<void>): void;
}): Promise<Response> {
  const reportFailure = (error: unknown) => {
    try {
      input.onExecutionError?.(error);
    } catch { /* Observability cannot own settlement. */ }
  };
  const publicFailure = (error: unknown) =>
    new ExecutorAgentError(
      error instanceof ExecutorAgentError ? error.code : "EXECUTOR_AGENT_STREAM_FAILED",
    );
  const completion = Promise.withResolvers<void>();
  let natural = false;
  let failure: unknown;
  let errorChunkSeen = false;
  let terminalOutput: unknown;
  let terminalMetadata: HostedLifecycleTerminalState["metadata"];
  let cleanup: Promise<void> | undefined;
  let closingRuntime = false;
  let pendingWorkCanceled = false;
  const cancelPendingWork = () => {
    if (pendingWorkCanceled) return;
    pendingWorkCanceled = true;
    try {
      input.cancelExecution?.();
    } catch (error) {
      failure ??= error;
      reportFailure(error);
    }
  };
  const settlement = Promise.withResolvers<void>();
  const invalidateRequestAbort = () => {
    cancelPendingWork();
    invalidateHostedAgentPauseSettlement(input.runtime, new Error("SSE request aborted"));
  };
  const invalidateRuntimeAbort = () => {
    if (closingRuntime) return;
    cancelPendingWork();
    invalidateHostedAgentPauseSettlement(input.runtime, new Error("SSE executor stopped"));
  };
  input.requestSignal.addEventListener("abort", invalidateRequestAbort, { once: true });
  input.runtime.signal.addEventListener("abort", invalidateRuntimeAbort, { once: true });
  if (input.requestSignal.aborted) invalidateRequestAbort();
  if (input.runtime.signal.aborted) invalidateRuntimeAbort();
  input.trackExecution(
    settlement.promise.finally(() => {
      input.requestSignal.removeEventListener("abort", invalidateRequestAbort);
      input.runtime.signal.removeEventListener("abort", invalidateRuntimeAbort);
    }),
  );
  const finish = (reason: "completed" | "canceled") => {
    // Cancelling host work can abort the combined request/execution signal.
    // Retain a failure already observed before that cleanup side effect.
    const failedBeforeCleanup = failure !== undefined && !input.requestSignal.aborted;
    if (reason === "canceled") {
      cancelPendingWork();
      invalidateHostedAgentPauseSettlement(input.runtime, new Error("SSE execution canceled"));
    }
    if (!cleanup) {
      cleanup = Promise.resolve().then(async () => {
        let finalizationFailed = false;
        let finalizationError: unknown;
        try {
          const paused = hasHostedAgentPauseStopped(input.runtime);
          const sessionStopped = input.runtime.signal.aborted;
          const terminalFailure = failure ??
            (sessionStopped
              ? input.runtime.signal.reason ?? new Error("Executor session stopped")
              : undefined);
          if (input.finishOutput) {
            await input.finishOutput({
              completed: !paused && natural && reason === "completed" &&
                !input.requestSignal.aborted && !sessionStopped,
              ...(paused ? { paused: true as const } : {}),
              ...(!paused && terminalOutput !== undefined ? { output: terminalOutput } : {}),
              ...(paused || terminalFailure === undefined ||
                  (input.requestSignal.aborted && !failedBeforeCleanup)
                ? {}
                : { error: terminalFailure }),
              ...(terminalMetadata ? { metadata: terminalMetadata } : {}),
            });
          }
          // Persistence can outlive the lease or request. Recheck after its
          // acknowledgment before emitting success or retiring as completed.
          input.requestSignal.throwIfAborted();
          input.runtime.signal.throwIfAborted();
        } catch (error) {
          reportFailure(error);
          finalizationFailed = true;
          finalizationError = error;
          invalidateHostedAgentPauseSettlement(input.runtime, error);
        }
        recordHostedAgentPauseFlush(
          input.runtime,
          !finalizationFailed && natural && reason === "completed" && !input.requestSignal.aborted,
        );
        if (finalizationFailed) cancelPendingWork();
        closingRuntime = true;
        const closure = await input.runtime.close(finalizationFailed ? "canceled" : reason).catch(
          (error) => {
            invalidateHostedAgentPauseSettlement(input.runtime, error);
            return undefined;
          },
        );
        await input.runtime.settled;
        recordHostedAgentPauseCleanup(
          input.runtime,
          !finalizationFailed && reason === "completed" && closure?.reason === "completed" &&
            closure.release !== "reaper-required",
        );
        try {
          await input.onSettled();
        } catch (error) {
          reportFailure(error);
          if (finalizationFailed) {
            throw new AggregateError(
              [finalizationError, error],
              "SSE persistence and retirement failed",
            );
          }
          throw error;
        }
        if (finalizationFailed) throw finalizationError;
      });
      void cleanup.then(settlement.resolve, settlement.reject);
    }
    return cleanup;
  };
  const agentUIStream = (async function* () {
    try {
      const result = await input.runtime.agent.stream({
        messages: input.messages,
        abortSignal: input.requestSignal,
      });
      const source = result.toUIMessageStream({
        onFinish: ({ responseMessage }) => {
          terminalOutput = responseMessage;
        },
        messageMetadata: ({ part }) => {
          const metadata = buildManagedBrokerMessageMetadata(input.runtime, part);
          terminalMetadata = {
            modelId: metadata.modelId,
            ...(metadata.usage ? { usage: metadata.usage } : {}),
            ...(metadata.usageCaptureStatus
              ? { usageCaptureStatus: metadata.usageCaptureStatus }
              : {}),
          };
          return metadata;
        },
      });
      for await (const chunk of source) {
        const projected = chunk.type === "error" ? normalizeManagedErrorChunk(chunk) : undefined;
        const forwardedChunk = projected?.chunk ?? chunk;
        if (projected) reportFailure(projected.diagnostic);
        if (input.output) {
          const output = input.output;
          await input.runtime.runOwned(() => output.write(forwardedChunk));
        }
        if (chunk.type === "error" || (chunk.type === "finish" && chunk.finishReason === "error")) {
          if (chunk.type === "error") errorChunkSeen = true;
          if (failure === undefined) {
            failure = projected?.failure ?? new Error("Agent stream failed");
          }
          invalidateHostedAgentPauseSettlement(
            input.runtime,
            new Error("Agent stream failed after pause acknowledgement"),
          );
        }
        yield forwardedChunk;
      }
      // A finish-error chunk carries metadata, not an AG-UI failed terminal.
      // Without projection the encoder could finalize partial output as success.
      // An explicit error chunk has already projected that terminal exactly once.
      if (failure !== undefined && !errorChunkSeen) throw failure;
      natural = failure === undefined;
    } catch (error) {
      failure ??= error;
      reportFailure(error);
      invalidateHostedAgentPauseSettlement(input.runtime, error);
      throw publicFailure(error);
    } finally {
      completion.resolve();
    }
  })();
  const response = createAgUiChatUiTrackedResponse({
    agUiInput: input.agUiInput,
    ...(input.resumed ? { resumed: true } : {}),
    defaults: { runId: input.runId, threadId: input.threadId },
    agentId: input.agentId,
    modelId: input.runtime.modelId,
    execution: {
      agentUIStream,
      formatError(error) {
        const failure = publicFailure(error);
        return { code: failure.code, message: failure.message };
      },
      async fail() {
        await finish("canceled");
      },
      async waitForFinish() {
        try {
          await completion.promise;
          await finish(natural && !input.requestSignal.aborted ? "completed" : "canceled");
        } catch (error) {
          throw publicFailure(error);
        }
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
      let terminalOutput: unknown;
      try {
        const result = await runtime.agent.stream({ messages, abortSignal: signal });
        for await (
          const chunk of result.toUIMessageStream({
            onFinish: ({ responseMessage }) => {
              terminalOutput = responseMessage;
            },
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
        invalidateHostedAgentPauseSettlement(runtime, error);
        throw error;
      } finally {
        const paused = hasHostedAgentPauseStopped(runtime);
        await output.finish({
          completed: paused ? false : streamCompleted,
          ...(paused ? { paused: true as const } : {}),
          ...(!paused && terminalOutput !== undefined ? { output: terminalOutput } : {}),
          ...(paused || failure === undefined || signal.aborted ? {} : { error: failure }),
          ...(terminalMetadata ? { metadata: terminalMetadata } : {}),
        });
        recordHostedAgentPauseFlush(runtime, streamCompleted && !signal.aborted);
      }
    });
    completed = true;
  } finally {
    const closure = await runtime.close(completed ? "completed" : "canceled").catch((error) => {
      invalidateHostedAgentPauseSettlement(runtime, error);
      return undefined;
    });
    await runtime.settled;
    recordHostedAgentPauseCleanup(
      runtime,
      completed && closure?.reason === "completed" && closure.release !== "reaper-required",
    );
  }
}
