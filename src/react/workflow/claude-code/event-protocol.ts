import type {
  ClaudeCodeEventExtended,
  ClaudeCodeResult,
  FileChange,
} from "#veryfront/workflow/claude-code/types.ts";

export const MAX_CLAUDE_CODE_MESSAGE_BYTES = 64 * 1024;
export const MAX_CLAUDE_CODE_FIELD_LENGTH = 32 * 1024;
export const MAX_CLAUDE_CODE_ARRAY_ITEMS = 256;
export const MAX_CLAUDE_CODE_EVENT_HISTORY = 1_000;

const MAX_CLAUDE_CODE_JSON_DEPTH = 16;
const MAX_CLAUDE_CODE_JSON_NODES = 4_096;
const MAX_CLAUDE_CODE_OBJECT_FIELDS = 128;
const MAX_CLAUDE_CODE_KEY_LENGTH = 256;

export type ClaudeCodeEventAdmission<TEvent> =
  | { ok: true; event: TEvent }
  | { ok: false; reason: string };

type EventBase = {
  timestamp: number;
  runId?: string;
  iteration?: number;
};

function reject<TEvent>(reason: string): ClaudeCodeEventAdmission<TEvent> {
  return { ok: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_CLAUDE_CODE_FIELD_LENGTH;
}

function isCanonicalId(value: unknown): value is string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_CLAUDE_CODE_FIELD_LENGTH || value.trim() !== value
  ) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false;
  }
  return true;
}

function isBoundedJson(
  value: unknown,
  budget: { remaining: number },
  depth = 0,
): boolean {
  budget.remaining -= 1;
  if (budget.remaining < 0 || depth > MAX_CLAUDE_CODE_JSON_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return isBoundedString(value);

  if (Array.isArray(value)) {
    if (value.length > MAX_CLAUDE_CODE_ARRAY_ITEMS) return false;
    return value.every((entry) => isBoundedJson(entry, budget, depth + 1));
  }

  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > MAX_CLAUDE_CODE_OBJECT_FIELDS) return false;
  return entries.every(([key, entry]) =>
    key.length <= MAX_CLAUDE_CODE_KEY_LENGTH && isBoundedJson(entry, budget, depth + 1)
  );
}

function readBase(record: Record<string, unknown>): EventBase | null {
  const timestamp = record.timestamp;
  if (!isFiniteDuration(timestamp)) return null;

  const runId = record.runId;
  if (runId !== undefined && !isBoundedString(runId)) return null;

  const iteration = record.iteration;
  if (iteration !== undefined && !isSafeCount(iteration)) return null;

  return {
    timestamp,
    ...(runId === undefined ? {} : { runId }),
    ...(iteration === undefined ? {} : { iteration }),
  };
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_CLAUDE_CODE_ARRAY_ITEMS) return null;
  if (!value.every(isBoundedString)) return null;
  return value.slice();
}

function readFileChange(value: unknown): FileChange | null {
  if (!isRecord(value)) return null;
  const path = value.path;
  const type = value.type;
  const originalChecksum = value.originalChecksum;
  const newChecksum = value.newChecksum;
  if (!isBoundedString(path)) return null;
  if (type !== "created" && type !== "modified" && type !== "deleted") return null;
  if (originalChecksum !== undefined && !isBoundedString(originalChecksum)) return null;
  if (newChecksum !== undefined && !isBoundedString(newChecksum)) return null;
  return {
    path,
    type,
    ...(originalChecksum === undefined ? {} : { originalChecksum }),
    ...(newChecksum === undefined ? {} : { newChecksum }),
  };
}

function readFileChanges(value: unknown): FileChange[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_CLAUDE_CODE_ARRAY_ITEMS) return null;
  const changes: FileChange[] = [];
  for (const entry of value) {
    const change = readFileChange(entry);
    if (!change) return null;
    changes.push(change);
  }
  return changes;
}

function readResult(value: unknown): ClaudeCodeResult | null {
  if (!isRecord(value)) return null;
  const success = value.success;
  const iterations = value.iterations;
  const response = value.response;
  const error = value.error;
  const executionTime = value.executionTime;
  const filesModified = readStringArray(value.filesModified);
  const commandsExecuted = readStringArray(value.commandsExecuted);
  const changes = readFileChanges(value.changes);

  if (typeof success !== "boolean") return null;
  if (!isSafeCount(iterations)) return null;
  if (response !== undefined && !isBoundedString(response)) return null;
  if (error !== undefined && !isBoundedString(error)) return null;
  if (!isFiniteDuration(executionTime)) return null;
  if (!filesModified || !commandsExecuted || changes === null) return null;

  return {
    success,
    iterations,
    ...(response === undefined ? {} : { response }),
    filesModified,
    commandsExecuted,
    ...(changes === undefined ? {} : { changes }),
    ...(error === undefined ? {} : { error }),
    executionTime,
  };
}

function admitRecord(
  value: unknown,
  allowExtended: boolean,
): ClaudeCodeEventAdmission<ClaudeCodeEventExtended> {
  if (!isRecord(value)) return reject("event must be an object");
  if (!isBoundedJson(value, { remaining: MAX_CLAUDE_CODE_JSON_NODES })) {
    return reject("event fields exceed protocol limits");
  }

  const base = readBase(value);
  if (!base) return reject("event base fields are invalid");
  const type = value.type;
  if (typeof type !== "string") return reject("event type must be a string");

  switch (type) {
    case "iteration_start": {
      const iteration = value.iteration;
      const maxIterations = value.maxIterations;
      if (!isSafeCount(iteration) || !isSafeCount(maxIterations)) {
        return reject("iteration_start fields are invalid");
      }
      return { ok: true, event: { ...base, type, iteration, maxIterations } };
    }
    case "text_delta":
    case "text_complete":
    case "thinking_delta":
    case "thinking_complete": {
      const content = value.content;
      if (!isBoundedString(content)) return reject(`${type} content is invalid`);
      return { ok: true, event: { ...base, type, content } };
    }
    case "tool_call_start": {
      const toolCallId = value.toolCallId;
      const toolName = value.toolName;
      if (!isBoundedString(toolCallId) || !isBoundedString(toolName)) {
        return reject("tool_call_start fields are invalid");
      }
      return { ok: true, event: { ...base, type, toolCallId, toolName } };
    }
    case "tool_call_input": {
      const toolCallId = value.toolCallId;
      const inputDelta = value.inputDelta;
      if (!isBoundedString(toolCallId) || !isBoundedString(inputDelta)) {
        return reject("tool_call_input fields are invalid");
      }
      return { ok: true, event: { ...base, type, toolCallId, inputDelta } };
    }
    case "tool_call_complete": {
      const toolCallId = value.toolCallId;
      const toolName = value.toolName;
      const input = value.input;
      if (!isBoundedString(toolCallId) || !isBoundedString(toolName) || !isRecord(input)) {
        return reject("tool_call_complete fields are invalid");
      }
      return { ok: true, event: { ...base, type, toolCallId, toolName, input } };
    }
    case "tool_result": {
      const toolCallId = value.toolCallId;
      const toolName = value.toolName;
      const output = value.output;
      const isError = value.isError;
      if (
        !isBoundedString(toolCallId) || !isBoundedString(toolName) ||
        !isBoundedString(output) || typeof isError !== "boolean"
      ) {
        return reject("tool_result fields are invalid");
      }
      return { ok: true, event: { ...base, type, toolCallId, toolName, output, isError } };
    }
    case "iteration_complete": {
      const iteration = value.iteration;
      const toolCallCount = value.toolCallCount;
      const hasMoreWork = value.hasMoreWork;
      if (
        !isSafeCount(iteration) || !isSafeCount(toolCallCount) ||
        typeof hasMoreWork !== "boolean"
      ) {
        return reject("iteration_complete fields are invalid");
      }
      return {
        ok: true,
        event: { ...base, type, iteration, toolCallCount, hasMoreWork },
      };
    }
    case "thinking_start":
      return { ok: true, event: { ...base, type } };
    case "complete": {
      const result = readResult(value.result);
      if (!result) return reject("complete result is invalid");
      return { ok: true, event: { ...base, type, result } };
    }
    case "error": {
      const message = value.message;
      const code = value.code;
      const recoverable = value.recoverable;
      if (
        !isBoundedString(message) ||
        (code !== undefined && !isBoundedString(code)) ||
        typeof recoverable !== "boolean"
      ) {
        return reject("error fields are invalid");
      }
      return {
        ok: true,
        event: {
          ...base,
          type,
          message,
          ...(code === undefined ? {} : { code }),
          recoverable,
        },
      };
    }
    case "approval_request": {
      if (!allowExtended) return reject("event type is not allowed on this transport");
      const toolCallId = value.toolCallId;
      const toolName = value.toolName;
      const input = value.input;
      const reason = value.reason;
      const timeout = value.timeout;
      if (
        !isBoundedString(toolCallId) || !isBoundedString(toolName) || !isRecord(input) ||
        !isBoundedString(reason) ||
        (timeout !== undefined && !isFiniteDuration(timeout))
      ) {
        return reject("approval_request fields are invalid");
      }
      return {
        ok: true,
        event: {
          ...base,
          type,
          toolCallId,
          toolName,
          input,
          reason,
          ...(timeout === undefined ? {} : { timeout }),
        },
      };
    }
    case "input_request": {
      if (!allowExtended) return reject("event type is not allowed on this transport");
      const requestId = value.requestId;
      const prompt = value.prompt;
      const defaultValue = value.defaultValue;
      const timeout = value.timeout;
      if (
        (requestId !== undefined && !isCanonicalId(requestId)) ||
        !isBoundedString(prompt) ||
        (defaultValue !== undefined && !isBoundedString(defaultValue)) ||
        (timeout !== undefined && !isFiniteDuration(timeout))
      ) {
        return reject("input_request fields are invalid");
      }
      return {
        ok: true,
        event: {
          ...base,
          type,
          ...(requestId === undefined ? {} : { requestId }),
          prompt,
          ...(defaultValue === undefined ? {} : { defaultValue }),
          ...(timeout === undefined ? {} : { timeout }),
        },
      };
    }
    case "pong":
      if (!allowExtended) return reject("event type is not allowed on this transport");
      return { ok: true, event: { ...base, type } };
    case "cancelled": {
      if (!allowExtended) return reject("event type is not allowed on this transport");
      const reason = value.reason;
      if (reason !== undefined && !isBoundedString(reason)) {
        return reject("cancelled reason is invalid");
      }
      return {
        ok: true,
        event: { ...base, type, ...(reason === undefined ? {} : { reason }) },
      };
    }
    case "command_ack": {
      if (!allowExtended) return reject("event type is not allowed on this transport");
      const commandId = value.commandId;
      const commandType = value.commandType;
      const status = value.status;
      const requestId = value.requestId;
      const reason = value.reason;
      if (
        !isCanonicalId(base.runId) || !isCanonicalId(commandId) ||
        (commandType !== "cancel" && commandType !== "approve" &&
          commandType !== "reject" && commandType !== "input") ||
        (status !== "accepted" && status !== "rejected") ||
        (requestId !== undefined && !isCanonicalId(requestId)) ||
        (reason !== undefined && !isBoundedString(reason))
      ) return reject("command_ack fields are invalid");
      return {
        ok: true,
        event: {
          ...base,
          type,
          commandId,
          commandType,
          status,
          ...(requestId === undefined ? {} : { requestId }),
          ...(reason === undefined ? {} : { reason }),
        },
      };
    }
    default:
      return reject("event type is not supported");
  }
}

/** Parse, bound, validate, and snapshot a Claude Code wire event. */
export function admitClaudeCodeEventMessage(
  data: unknown,
  allowExtended = false,
): ClaudeCodeEventAdmission<ClaudeCodeEventExtended> {
  if (typeof data !== "string") return reject("event payload must be text");
  if (new TextEncoder().encode(data).byteLength > MAX_CLAUDE_CODE_MESSAGE_BYTES) {
    return reject("event payload exceeds the byte limit");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return reject("event payload is not valid JSON");
  }

  const admission = admitRecord(parsed, allowExtended);
  if (!admission.ok) return admission;
  return admission;
}
