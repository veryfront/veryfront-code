import { createCanonicalManagedBrokerHandler } from "./canonical-managed-broker.ts";
import { BrokerIngressError } from "./broker-ingress.ts";
import { createHostedRunControlHandler } from "./run-control-handler.ts";
import { createDetachedRunTracker } from "./detached-run-tracker.ts";
import {
  RunAlreadyExistsError,
  RunCancelledError,
  RunResumeSessionManager,
} from "../runtime/resume-session.ts";
import type { AgUiResumeValue } from "../ag-ui/tool-shared.ts";
import type { HostedServiceAuth } from "./auth.ts";
import type { ExecutorToolCapability } from "../hosted/executor-tool-bridge.ts";
import { createCanonicalApiToolSource } from "./canonical-api-tool-source.ts";
import {
  executorNodeClock,
  scheduleExecutorNodeDeadline,
} from "../hosted/executor-node-deadline.ts";
import type { HostedExecutorSessionClock } from "../hosted/executor-session.ts";

type CanonicalOptions<T> = Parameters<typeof createCanonicalManagedBrokerHandler<T>>[0];
type Prepare<T> = CanonicalOptions<T>["prepareExecutor"];

/** One canonical handler and its authenticated cancel/resume effects share one bounded run owner. */
export function createCanonicalManagedBrokerService<T>(
  options: Omit<CanonicalOptions<T>, "prepareExecutor" | "responseMode"> & {
    /** The API consumes a negotiated SSE stream and owns lifecycle transitions. */
    responseMode?: "sse";
    auth: Pick<
      HostedServiceAuth,
      "authenticateRequest" | "verifyRunCancellationToken" | "verifyRunResumeToken"
    >;
    maxActiveRuns?: number;
    /** Host UTC/elapsed clock shared with executor deadlines. */
    clock?: HostedExecutorSessionClock;
    prepareExecutor(
      input: Parameters<Prepare<T>>[0] & {
        /** Host-tool callback; never serialize or forward this function to project execution. */
        waitForToolResult(toolCallId: string, signal?: AbortSignal): Promise<AgUiResumeValue>;
        /** API result capability, not an automatic tool grant. Retained only by the broker. */
        apiTools: ExecutorToolCapability;
      },
    ): ReturnType<Prepare<T>>;
  },
) {
  const {
    auth,
    maxActiveRuns = 16,
    prepareExecutor,
    responseMode = "sse",
    clock = executorNodeClock,
    ...canonicalOptions
  } = options;
  if (responseMode !== "sse") throw new TypeError("Canonical API service requires SSE");
  if (!Number.isSafeInteger(maxActiveRuns) || maxActiveRuns < 1 || maxActiveRuns > 1024) {
    throw new TypeError("Invalid canonical run ownership limit");
  }
  const tracker = createDetachedRunTracker<AgUiResumeValue>({
    sessionManager: new RunResumeSessionManager({
      maxConcurrentSessions: maxActiveRuns,
      maxPendingWaitsPerRun: 32,
    }),
  });
  const control = createHostedRunControlHandler({
    tracker,
    authenticateRequest: auth.authenticateRequest.bind(auth),
    verifyRunCancellationToken: auth.verifyRunCancellationToken.bind(auth),
    verifyRunResumeToken: auth.verifyRunResumeToken.bind(auth),
  });
  let closed = false;
  let closing: Promise<void> | undefined;
  const handler = createCanonicalManagedBrokerHandler({
    ...canonicalOptions,
    responseMode,
    maxActiveRuns,
    async prepareExecutor(input) {
      if (closed) throw new BrokerIngressError(503, "BROKER_UNAVAILABLE");
      const negotiated = input.ingress.privateAuthority.projectEventPersistence;
      if (!negotiated) throw new BrokerIngressError(503, "BROKER_UNAVAILABLE");
      const run = input.ingress.executor.run;
      const deadline = run.effectiveDeadlineAt === undefined
        ? undefined
        : Date.parse(run.effectiveDeadlineAt);
      if (deadline !== undefined && (!Number.isFinite(deadline) || deadline <= clock.now())) {
        throw new BrokerIngressError(409, "BROKER_RUN_NOT_ACTIVE");
      }
      const cursor = negotiated;
      if (!cursor) throw new BrokerIngressError(503, "BROKER_UNAVAILABLE");
      let ownedSignal: AbortSignal;
      try {
        ownedSignal = tracker.sessionManager.startRun({
          runId: run.runId,
          threadId: run.conversationId,
          startedFromEventId: cursor.latestEventId,
        });
      } catch (error) {
        if (error instanceof RunCancelledError || error instanceof RunAlreadyExistsError) {
          throw new BrokerIngressError(409, "BROKER_RUN_NOT_ACTIVE");
        }
        throw new BrokerIngressError(503, "BROKER_UNAVAILABLE");
      }
      const settled = Promise.withResolvers<void>();
      tracker.registerExecution(run.runId, settled.promise);
      let retired = false;
      let stopDeadline: (() => void) | undefined;
      const apiToolLifetime = new AbortController();
      const cancellationSources = new Set<AbortSignal>();
      const cancelOwned = () => {
        if (!retired) tracker.sessionManager.cancelRun(run.runId, ownedSignal);
      };
      const followCancellation = (signal: AbortSignal) => {
        if (cancellationSources.has(signal)) return;
        cancellationSources.add(signal);
        signal.addEventListener("abort", cancelOwned, { once: true });
        if (signal.aborted) cancelOwned();
      };
      const retire = (failed: boolean, error?: unknown) => {
        if (retired) return;
        retired = true;
        stopDeadline?.();
        apiToolLifetime.abort(new RunCancelledError("Run-control ownership has ended"));
        for (const signal of cancellationSources) signal.removeEventListener("abort", cancelOwned);
        cancellationSources.clear();
        if (!failed) {
          tracker.sessionManager.completeRun(run.runId, ownedSignal);
          settled.resolve();
        } else {
          tracker.sessionManager.failRun(run.runId, ownedSignal);
          settled.reject(error);
        }
      };
      followCancellation(input.signal);
      try {
        if (deadline !== undefined) {
          const deadlineOwner = new AbortController();
          followCancellation(deadlineOwner.signal);
          // Observe forward UTC corrections without large-timer overflow or
          // letting a backward correction extend the elapsed run budget.
          stopDeadline = scheduleExecutorNodeDeadline(clock, deadline, () => {
            deadlineOwner.abort(new RunCancelledError("Canonical run deadline elapsed"));
          }, 1000);
        }
        const preparationSignal = AbortSignal.any([input.signal, ownedSignal]);
        const waitForToolResult = (toolCallId: string, signal?: AbortSignal) => {
          if (
            retired || ownedSignal.aborted ||
            tracker.sessionManager.isSupersededRun(run.runId, ownedSignal)
          ) {
            throw new RunCancelledError("Run-control ownership has ended");
          }
          if (
            typeof toolCallId !== "string" || toolCallId.length < 1 || toolCallId.length > 256
          ) {
            throw new TypeError("Invalid run-control wait key");
          }
          tracker.sessionManager.prepareForSignal(run.runId, toolCallId);
          return tracker.sessionManager.waitForSignal(run.runId, toolCallId, signal);
        };
        const prepared = await prepareExecutor({
          ...input,
          signal: preparationSignal,
          waitForToolResult,
          apiTools: createCanonicalApiToolSource({
            ingress: input.ingress,
            signal: AbortSignal.any([preparationSignal, apiToolLifetime.signal]),
            waitForToolResult,
          }),
        });
        const cleanup = prepared.cleanup?.bind(prepared);
        const cancelPrepared = prepared.cancelExecution?.bind(prepared);
        const executionSignal = AbortSignal.any([prepared.executionSignal, ownedSignal]);
        followCancellation(prepared.executionSignal);
        let cleanupPromise: Promise<void> | undefined;
        return {
          ...prepared,
          executionSignal,
          cancelExecution() {
            if (retired) return;
            cancelOwned();
            cancelPrepared?.();
          },
          cleanup() {
            return cleanupPromise ??= (async () => {
              try {
                await cleanup?.();
                retire(false);
              } catch (error) {
                retire(true, error);
                throw error;
              }
            })();
          },
        };
      } catch (error) {
        retire(true, error);
        throw error;
      }
    },
  });
  return {
    handle: handler.handle,
    cancel: {
      handle: (request: Request, input: { runId?: string }) =>
        closed
          ? Promise.resolve(Response.json({ errorCode: "BROKER_UNAVAILABLE" }, { status: 503 }))
          : control({ request, runId: input.runId }, "cancel"),
    },
    resume: {
      handle: (request: Request, input: { runId?: string }) =>
        closed
          ? Promise.resolve(Response.json({ errorCode: "BROKER_UNAVAILABLE" }, { status: 503 }))
          : control({ request, runId: input.runId }, "resume"),
    },
    get active() {
      return handler.active;
    },
    close() {
      return closing ??= (async () => {
        closed = true;
        tracker.cancelAllRuns();
        try {
          await handler.close();
        } finally {
          tracker.reset();
        }
      })();
    },
  };
}
