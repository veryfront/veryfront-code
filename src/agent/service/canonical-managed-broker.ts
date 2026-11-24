import { getStudioRuntimeEnvironmentContext } from "../hosted/chat-request.ts";
import { executorNodeClock } from "../hosted/executor-node-deadline.ts";
import type { HostedExecutorSessionClock } from "../hosted/executor-session.ts";
import { claimManagedBrokerAdmission } from "./managed-broker-admission.ts";
import { getCanonicalRunStatus } from "../conversation/durable.ts";
import {
  createManagedBrokerPersistence,
  type ManagedBrokerRunSnapshot,
} from "../hosted/managed-broker-persistence.ts";
import { createManagedBrokerProjectState } from "../hosted/managed-broker-project-state.ts";
import { sameHostedExecutorOwner } from "../hosted/executor-session-schema.ts";
import { verifyHostedRuntimeSourceBinding } from "../hosted/runtime-source-binding.ts";
import type { ManagedExecutorStartInput } from "../hosted/managed-executor-broker.ts";
import type { ExecutorInitialCheckpointState } from "../hosted/executor-checkpoint-state.ts";
import {
  getExecutorRuntimePrepareRequestSchema,
  parseRuntimePreparationData,
} from "../hosted/executor-runtime-prepare-schema.ts";
import { BrokerIngressError, type BrokerRuntimeAgentIngress } from "./broker-ingress.ts";
import { createManagedBrokerHandler } from "./managed-broker-handler.ts";

type Start = Omit<
  ManagedExecutorStartInput,
  "state" | "persistence" | "bindSessionOwnedWork"
>;
type HandlerOptions<T> = Parameters<typeof createManagedBrokerHandler<T>>[0];

/**
 * Signed canonical admission with API-owned lifecycle, append cursors and persistence.
 * The API consumes the live dispatch once before deployment preparation or allocation.
 * The deployment supplies executor/image/model/tool policy, never application callbacks.
 * This does not advertise a protocol or enable account-chat execution.
 */
export function createCanonicalManagedBrokerHandler<T>(
  options: Omit<HandlerOptions<T>, "prepare"> & {
    apiUrl: string;
    /** Host UTC clock used before consuming the signed dispatch. */
    clock?: Pick<HostedExecutorSessionClock, "now">;
    resolveProvider(modelId: string): string;
    fetch?: typeof globalThis.fetch;
    toolCallAdmissions?: true;
    runtimeObservations?: true;
    prepareExecutor(input: {
      ingress: BrokerRuntimeAgentIngress<T>;
      signal: AbortSignal;
    }): Promise<{
      start: Start;
      messages: Awaited<ReturnType<HandlerOptions<T>["prepare"]>>["messages"];
      executionSignal: AbortSignal;
      /** Synchronously cancel pending host work before waiting for executor retirement. */
      cancelExecution?: () => void;
      /** Register an owned API result key before its input events can reach the control plane. */
      beforeApiToolInput?(input: { toolCallId: string; toolName: string }): void;
      initialCheckpoints?: ExecutorInitialCheckpointState;
      latestConversationUserText?: (signal: AbortSignal) => Promise<string | null>;
      cleanup?: () => Promise<void>;
    }>;
  },
) {
  // Capture host policy and transport before accepting requests.
  const { apiUrl, fetch: transport, prepareExecutor, resolveProvider } = options;
  const clock = options.clock ?? executorNodeClock;
  const now = clock.now.bind(clock);
  const onExecutionError = options.onExecutionError?.bind(options);
  const toolCallAdmissions = options.toolCallAdmissions === true;
  const runtimeObservations = options.runtimeObservations === true;
  const resolveIngressOptions = options.resolveIngressOptions;
  return createManagedBrokerHandler({
    broker: options.broker,
    responseMode: options.responseMode,
    maxActiveRuns: options.maxActiveRuns,
    signal: options.signal,
    inferenceApiBaseUrl: options.inferenceApiBaseUrl,
    knowledgeApiBaseUrl: apiUrl,
    resolveIngressOptions: (input) => ({
      ...resolveIngressOptions(input),
      pauseApiBaseUrl: apiUrl,
      pauseFetch: transport,
    }),
    onExecutionError,
    async prepare({ ingress, signal }) {
      const run = ingress.executor.run;
      const assertLiveDeadline = () => {
        if (run.effectiveDeadlineAt === undefined) return;
        const deadline = Date.parse(run.effectiveDeadlineAt);
        if (!Number.isFinite(deadline) || deadline <= now()) {
          throw new BrokerIngressError(409, "BROKER_RUN_NOT_ACTIVE");
        }
      };
      assertLiveDeadline();
      const authority = ingress.privateAuthority;
      const negotiated = authority.projectEventPersistence;
      const cursor = negotiated ?? run.eventCursor;
      if (negotiated && options.responseMode !== "sse") {
        throw new BrokerIngressError(503, "BROKER_UNAVAILABLE");
      }
      const sourceProject = ingress.executor.sourceProject ?? run.project;
      const source = ingress.executor.agentSource;
      // Old admissions cannot supply guessed zero cursors or borrow a legacy projection.
      if (!cursor || !authority.terminalAuthToken || source.type === "branch") {
        throw new BrokerIngressError(503, "BROKER_UNAVAILABLE");
      }
      const sourceToken = authority.sourceAuthToken ??
        (sourceProject.projectId === run.project.projectId ? authority.apiAuthToken : undefined);
      if (!sourceToken) throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
      // A shared source cannot borrow ambient model authority from its host.
      // The API supplies a separate inference credential for the consuming run.
      if (sourceProject.projectId !== run.project.projectId && !authority.inferenceAuthToken) {
        throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
      }
      const lifecycle = await getCanonicalRunStatus({
        apiUrl,
        authToken: authority.apiAuthToken,
        runId: run.runId,
        canonicalRunId: cursor.canonicalRunId,
        abortSignal: signal,
        fetch: transport,
      });
      signal.throwIfAborted();
      // The API claims and transitions a resumed run before signing its dispatch.
      // A durable wait therefore belongs to an already-paused segment, even if
      // an old signed request still carries its previous resume decision.
      if (!["pending", "running"].includes(lifecycle.status)) {
        throw new BrokerIngressError(409, "BROKER_RUN_NOT_ACTIVE");
      }
      assertLiveDeadline();
      try {
        await claimManagedBrokerAdmission({
          apiUrl,
          authToken: authority.apiAuthToken,
          terminalAuthToken: authority.terminalAuthToken,
          projectId: run.project.projectId,
          runId: run.runId,
          canonicalRunId: cursor.canonicalRunId,
          latestEventId: cursor.latestEventId,
          latestExternalEventSequence: cursor.latestExternalEventSequence,
          timeoutMs: run.effectiveDeadlineAt === undefined
            ? undefined
            : Math.max(0, Date.parse(run.effectiveDeadlineAt) - now()),
          signal,
          fetch: transport,
        });
        assertLiveDeadline();
      } catch (error) {
        assertLiveDeadline();
        try {
          onExecutionError?.(error, run.runId);
        } catch { /* Diagnostics cannot own admission. */ }
        throw error;
      }
      const snapshot: ManagedBrokerRunSnapshot = {
        ...cursor,
        runId: run.runId,
        conversationId: run.conversationId,
        messageId: run.messageId,
        status: lifecycle.status,
      };
      const prepared = await prepareExecutor({ ingress, signal });
      let persistence: ReturnType<typeof createManagedBrokerPersistence> | undefined;
      let cleanupPromise: Promise<void> | undefined;
      const cleanup = () =>
        cleanupPromise ??= (async () => {
          const errors: unknown[] = [];
          try {
            await persistence?.cleanup();
          } catch (error) {
            errors.push(error);
          }
          try {
            await prepared.cleanup?.();
          } catch (error) {
            errors.push(error);
          }
          if (errors.length) throw new AggregateError(errors, "Managed preparation cleanup failed");
        })();
      try {
        signal.throwIfAborted();
        prepared.executionSignal.throwIfAborted();
        const { start } = prepared;
        const execution = start.installation.grant.execution;
        if (
          !sameHostedExecutorOwner(start.installation.owner, ingress.executor.owner) ||
          verifyHostedRuntimeSourceBinding(
            start.installation.source,
            ingress.executor.agentSource,
          ) ||
          start.installation.owner.scopeKind !== "project" ||
          start.installation.owner.projectId !== sourceProject.projectId ||
          start.installation.grant.agentId !== run.agentId ||
          start.prepare.agentId !== run.agentId ||
          (ingress.executor.agentEntrypoint &&
            start.installation.agentEntrypoint?.path !== ingress.executor.agentEntrypoint.path) ||
          execution.kind !== "canonical" || execution.projectId !== run.project.projectId ||
          execution.runId !== run.runId || execution.conversationId !== run.conversationId ||
          execution.messageId !== run.messageId ||
          (execution.userId !== undefined && execution.userId !== run.requestedByUserId) ||
          (execution.projectSlug !== undefined && execution.projectSlug !== run.project.projectSlug)
        ) throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
        persistence = createManagedBrokerPersistence({
          apiUrl,
          runEventToken: authority.runEventToken,
          completionAuthToken: authority.apiAuthToken,
          terminalAuthToken: authority.terminalAuthToken,
          terminalOwner: negotiated ? "api" : "runtime",
          run: snapshot,
          modelId: start.prepare.modelId ?? start.installation.grant.defaultModelId,
          resolveProvider,
          fetch: transport,
          ...(toolCallAdmissions
            ? { toolCallAdmissions: { projectId: run.project.projectId } }
            : {}),
          ...(runtimeObservations
            ? { runtimeObservations: { projectId: run.project.projectId } }
            : {}),
        });
        const state = createManagedBrokerProjectState({
          apiUrl,
          authToken: sourceToken,
          projectId: sourceProject.projectId,
          releaseId: source.releaseId,
          agentId: run.agentId,
          fetch: transport,
          latestConversationUserText: prepared.latestConversationUserText,
          environmentContext: getStudioRuntimeEnvironmentContext(ingress.executor.input),
        });
        const { serverResolvedResumeToolCall: _adapterResume, ...prepare } = start.prepare;
        const resume = ingress.executor.input.resumeToolCall;
        return {
          messages: prepared.messages,
          executionSignal: prepared.executionSignal,
          cancelExecution: prepared.cancelExecution?.bind(prepared),
          start: {
            ...start,
            prepare: parseRuntimePreparationData(getExecutorRuntimePrepareRequestSchema(), {
              ...prepare,
              ...(resume ? { serverResolvedResumeToolCall: resume } : {}),
            }),
            installation: {
              ...start.installation,
              grant: {
                ...start.installation.grant,
                execution: {
                  ...execution,
                  userId: run.requestedByUserId,
                  projectSlug: run.project.projectSlug,
                },
              },
            },
            state,
            persistence: { ...prepared.initialCheckpoints, ...persistence },
            bindSessionOwnedWork: persistence.bindSessionOwnedWork,
            model: { ...start.model, runEventSink: persistence.modelRunEventSink },
            tools: { ...start.tools, admitToolCall: persistence.admitToolCall },
          },
          output: {
            write(chunk) {
              if (chunk.type === "tool-input-start" || chunk.type === "tool-input-available") {
                prepared.beforeApiToolInput?.({
                  toolCallId: chunk.toolCallId,
                  toolName: chunk.toolName,
                });
              }
              return persistence!.output.write(chunk);
            },
            finish: persistence.output.finish.bind(persistence.output),
          },
          ...(negotiated ? { eventPersistence: negotiated.mode } : {}),
          cleanup,
        };
      } catch (error) {
        try {
          await cleanup();
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Managed preparation failed during cleanup",
          );
        }
        throw error;
      }
    },
  });
}
