import { type ConversationRunProjection, getConversationRun } from "../conversation/durable.ts";
import { agentLogger } from "#veryfront/utils";

/** Public API contract for hosted child run identifiers. */
export interface HostedChildRunIdentifiers {
  childConversationId: string;
  childRunId: string;
  childMessageId: string;
  latestEventId: number;
  latestExternalEventSequence: number;
}

type HostedConversationRunStatus = ConversationRunProjection["status"];

/** Shared hosted child terminal error codes value. */
export const hostedChildTerminalErrorCodes = Object.freeze({
  cancelled: "DURABLE_CHILD_CANCELLED",
  failed: "DURABLE_CHILD_FAILED",
  completedExternally: "DURABLE_CHILD_COMPLETED_EXTERNALLY",
});

/** Public API contract for a code is a hosted child terminal error. */
export type HostedChildTerminalErrorCode =
  (typeof hostedChildTerminalErrorCodes)[keyof typeof hostedChildTerminalErrorCodes];

/** Check whether a code is a hosted child terminal error. */
export function isHostedChildTerminalErrorCode(
  value: unknown,
): value is HostedChildTerminalErrorCode {
  return (
    value === hostedChildTerminalErrorCodes.cancelled ||
    value === hostedChildTerminalErrorCodes.failed ||
    value === hostedChildTerminalErrorCodes.completedExternally
  );
}

/** Public API contract for hosted child same turn retry block signal. */
export interface HostedChildSameTurnRetryBlockSignal {
  terminalErrorCode?: string | null;
  terminalErrorMessage?: string | null;
}

function getOptionalStringProperty(value: object, property: string): string | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  return typeof descriptor?.value === "string" ? descriptor.value : null;
}

/** Should block hosted child same turn retry helper. */
export function shouldBlockHostedChildSameTurnRetry(
  result: unknown,
): result is HostedChildSameTurnRetryBlockSignal {
  if (typeof result !== "object" || result === null) {
    return false;
  }

  const terminalErrorCode = getOptionalStringProperty(result, "terminalErrorCode");

  // Rely only on the structured error code — message text is an unstable implementation detail.
  return (
    terminalErrorCode === "CANCELLED" ||
    terminalErrorCode === hostedChildTerminalErrorCodes.cancelled
  );
}

/** Public API contract for hosted child terminal status. */
export type HostedChildTerminalStatus = Extract<
  HostedConversationRunStatus,
  "completed" | "failed" | "cancelled"
>;

/** Error shape for hosted child terminal state. */
export class HostedChildTerminalStateError extends Error {
  constructor(
    readonly status: HostedChildTerminalStatus,
    readonly identifiers: HostedChildRunIdentifiers,
  ) {
    super(
      `Hosted child run ${identifiers.childRunId} became ${status} before local execution finished`,
    );
    this.name = "HostedChildTerminalStateError";
  }
}

function isActiveHostedChildStatus(
  status: HostedConversationRunStatus,
): status is "pending" | "running" | "waiting_for_tool" {
  return status === "pending" || status === "running" || status === "waiting_for_tool";
}

/** Resolves a code is a hosted child terminal error. */
export function resolveHostedChildTerminalErrorCode(
  status: HostedChildTerminalStatus,
): HostedChildTerminalErrorCode {
  switch (status) {
    case "cancelled":
      return hostedChildTerminalErrorCodes.cancelled;
    case "failed":
      return hostedChildTerminalErrorCodes.failed;
    case "completed":
      return hostedChildTerminalErrorCodes.completedExternally;
    default:
      return hostedChildTerminalErrorCodes.failed;
  }
}

async function waitForHostedChildStatusPoll(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (ms <= 0 || abortSignal?.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeoutId = setTimeout(() => {
      abortSignal?.removeEventListener("abort", resolveOnAbort);
      resolve();
    }, ms);

    const resolveOnAbort = () => {
      clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", resolveOnAbort);
      resolve();
    };

    abortSignal?.addEventListener("abort", resolveOnAbort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Maximum number of consecutive poll failures before the monitor aborts. */
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

/** Input payload for monitor hosted child run status. */
export interface MonitorHostedChildRunStatusInput {
  authToken: string;
  apiUrl: string;
  identifiers: HostedChildRunIdentifiers;
  abortSignal?: AbortSignal;
  pollIntervalMs: number;
  onTerminal: (error: HostedChildTerminalStateError) => void;
  /** Called when a poll attempt fails; receives the error and consecutive failure count. */
  onMonitoringError?: (error: unknown, consecutiveFailures: number) => void;
  /** Called when repeated poll failures stop the monitor without observing a terminal run. */
  onMonitoringExhausted?: (error: Error) => void;
}

/** Monitor hosted child run status helper. */
export async function monitorHostedChildRunStatus(
  input: MonitorHostedChildRunStatusInput,
): Promise<void> {
  let consecutiveFailures = 0;

  while (!input.abortSignal?.aborted) {
    await waitForHostedChildStatusPoll(input.pollIntervalMs, input.abortSignal);
    if (input.abortSignal?.aborted) {
      return;
    }

    try {
      const run = await getConversationRun({
        authToken: input.authToken,
        apiUrl: input.apiUrl,
        conversationId: input.identifiers.childConversationId,
        runId: input.identifiers.childRunId,
        abortSignal: input.abortSignal,
      });

      consecutiveFailures = 0;

      if (isActiveHostedChildStatus(run.status)) {
        continue;
      }

      input.onTerminal(
        new HostedChildTerminalStateError(
          run.status as never,
          input.identifiers,
        ),
      );
      return;
    } catch (error) {
      if (input.abortSignal?.aborted || isAbortError(error)) {
        return;
      }

      consecutiveFailures++;
      input.onMonitoringError?.(error, consecutiveFailures);

      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        agentLogger.error(
          `[monitorHostedChildRunStatus] Aborting status monitor after ${MAX_CONSECUTIVE_POLL_FAILURES} consecutive failures for run ${input.identifiers.childRunId}`,
          { error },
        );
        // A transport failure is not an observed remote terminal state. Abort
        // local execution through a separate channel so lifecycle code still
        // persists or reconciles the durable child failure.
        input.onMonitoringExhausted?.(
          new Error(
            `Stopped monitoring hosted child run ${input.identifiers.childRunId} after ${MAX_CONSECUTIVE_POLL_FAILURES} consecutive failures`,
            { cause: error },
          ),
        );
        return;
      }
    }
  }
}
