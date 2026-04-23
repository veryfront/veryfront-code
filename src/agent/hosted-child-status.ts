import { type ConversationRunProjection, getConversationRun } from "./durable.ts";

export interface HostedChildRunIdentifiers {
  childConversationId: string;
  childRunId: string;
  childMessageId: string;
  latestEventId: number;
  latestExternalEventSequence: number;
}

type HostedConversationRunStatus = ConversationRunProjection["status"];

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

export function resolveHostedChildTerminalErrorCode(status: HostedChildTerminalStatus): string {
  switch (status) {
    case "cancelled":
      return "DURABLE_CHILD_CANCELLED";
    case "failed":
      return "DURABLE_CHILD_FAILED";
    case "completed":
      return "DURABLE_CHILD_COMPLETED_EXTERNALLY";
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

export async function monitorHostedChildRunStatus(input: {
  authToken: string;
  apiUrl: string;
  identifiers: HostedChildRunIdentifiers;
  abortSignal?: AbortSignal;
  pollIntervalMs: number;
  onTerminal: (error: HostedChildTerminalStateError) => void;
}): Promise<void> {
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

      input.onTerminal(new HostedChildTerminalStateError(run.status, input.identifiers));
      return;
    } catch (error) {
      if (input.abortSignal?.aborted || isAbortError(error)) {
        return;
      }
    }
  }
}
