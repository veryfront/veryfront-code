import { type ConversationRunProjection, getConversationRun } from "../conversation/durable.ts";

export interface HostedChildRunIdentifiers {
  childConversationId: string;
  childRunId: string;
  childMessageId: string;
  latestEventId: number;
  latestExternalEventSequence: number;
}

type HostedConversationRunStatus = ConversationRunProjection["status"];

export const hostedChildTerminalErrorCodes = Object.freeze({
  cancelled: "DURABLE_CHILD_CANCELLED",
  failed: "DURABLE_CHILD_FAILED",
  completedExternally: "DURABLE_CHILD_COMPLETED_EXTERNALLY",
});

export type HostedChildTerminalErrorCode =
  (typeof hostedChildTerminalErrorCodes)[keyof typeof hostedChildTerminalErrorCodes];

export function isHostedChildTerminalErrorCode(
  value: unknown,
): value is HostedChildTerminalErrorCode {
  return (
    value === hostedChildTerminalErrorCodes.cancelled ||
    value === hostedChildTerminalErrorCodes.failed ||
    value === hostedChildTerminalErrorCodes.completedExternally
  );
}

export interface HostedChildSameTurnRetryBlockSignal {
  terminalErrorCode?: string | null;
  terminalErrorMessage?: string | null;
}

function getOptionalStringProperty(value: object, property: string): string | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  return typeof descriptor?.value === "string" ? descriptor.value : null;
}

export function shouldBlockHostedChildSameTurnRetry(
  result: unknown,
): result is HostedChildSameTurnRetryBlockSignal {
  if (typeof result !== "object" || result === null) {
    return false;
  }

  const terminalErrorCode = getOptionalStringProperty(result, "terminalErrorCode");
  const terminalErrorMessage = getOptionalStringProperty(result, "terminalErrorMessage");

  return (
    terminalErrorCode === "CANCELLED" ||
    terminalErrorCode === hostedChildTerminalErrorCodes.cancelled ||
    terminalErrorMessage === "Child run cancelled"
  );
}

export type HostedChildTerminalStatus = Extract<
  HostedConversationRunStatus,
  "completed" | "failed" | "cancelled"
>;

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

export interface MonitorHostedChildRunStatusInput {
  authToken: string;
  apiUrl: string;
  identifiers: HostedChildRunIdentifiers;
  abortSignal?: AbortSignal;
  pollIntervalMs: number;
  onTerminal: (error: HostedChildTerminalStateError) => void;
}

export async function monitorHostedChildRunStatus(
  input: MonitorHostedChildRunStatusInput,
): Promise<void> {
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
    }
  }
}
