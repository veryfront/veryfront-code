import type { DurableRunCanaryMessage, DurableRunCanaryRunSummary } from "./runner.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getStringProperty(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function getToolCallName(part: Record<string, unknown>): string | null {
  if (part.type === "tool_call") {
    return getStringProperty(part, "name");
  }

  if (part.type === "tool-call") {
    return getStringProperty(part, "toolName");
  }

  return null;
}

function hasCreateFileInput(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return getStringProperty(value, "path") !== null && getStringProperty(value, "content") !== null;
}

export function assertCompleted(run: DurableRunCanaryRunSummary): void {
  if (run.status !== "completed") {
    throw new Error(
      `Expected completed run, got ${run.status} (${run.terminalErrorCode ?? "no-code"}: ${
        run.terminalErrorMessage ?? "no message"
      })`,
    );
  }
}

export function findAssistantMessage(
  messages: DurableRunCanaryMessage[],
  messageId: string,
): DurableRunCanaryMessage {
  const message = messages.find((candidate) => candidate.id === messageId);
  if (!message) {
    throw new Error(`Assistant message ${messageId} was not persisted`);
  }
  if (message.role !== "assistant") {
    throw new Error(`Expected assistant message ${messageId}, got role ${message.role}`);
  }
  return message;
}

export function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function collectAssistantText(message: DurableRunCanaryMessage): string {
  return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export function assertNoMalformedCreateFileToolCalls(messages: DurableRunCanaryMessage[]): void {
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isRecord(part) || getToolCallName(part) !== "create_file") {
        continue;
      }

      if (!hasCreateFileInput(part.input)) {
        throw new Error("Expected create_file tool_call input to include a path and content");
      }
    }
  }
}
