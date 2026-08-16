import type {
  ClaudeCodeEventExtended,
  ClaudeCodeResult,
  ClientCommand,
  ClientCommandDisposition,
  ClientCommandType,
  FileChange,
} from "./types.ts";
import {
  MAX_CLAUDE_CODE_WIRE_ARRAY_ITEMS,
  MAX_CLAUDE_CODE_WIRE_FIELD_LENGTH,
  MAX_CLAUDE_CODE_WIRE_IDENTIFIER_LENGTH,
  MAX_CLAUDE_CODE_WIRE_JSON_DEPTH,
  MAX_CLAUDE_CODE_WIRE_JSON_NODES,
  MAX_CLAUDE_CODE_WIRE_KEY_LENGTH,
  MAX_CLAUDE_CODE_WIRE_MESSAGE_BYTES,
  MAX_CLAUDE_CODE_WIRE_OBJECT_FIELDS,
} from "./types.ts";

export const MAX_CLAUDE_CODE_MESSAGE_BYTES = MAX_CLAUDE_CODE_WIRE_MESSAGE_BYTES;
export const MAX_CLAUDE_CODE_FIELD_LENGTH = MAX_CLAUDE_CODE_WIRE_FIELD_LENGTH;
export const MAX_CLAUDE_CODE_ARRAY_ITEMS = MAX_CLAUDE_CODE_WIRE_ARRAY_ITEMS;

const BASE_EVENT_KEYS = ["type", "timestamp", "runId", "iteration"] as const;
const INVALID_WIRE_JSON = Symbol("invalid-wire-json");

export type ClaudeCodeEventAdmission<TEvent> =
  | { ok: true; event: TEvent }
  | { ok: false; reason: string };

export type ClaudeCodeWireEncoding =
  | { ok: true; data: string }
  | { ok: false; reason: string };

export interface RejectedClaudeCodeClientCommandContext {
  readonly commandId: string;
  readonly commandType: ClientCommandType;
  readonly requestId?: string;
}

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

function readDataProperty(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
}

function hasExactDataProperties(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set<string>(allowedKeys);
  return Reflect.ownKeys(record).every((key) => {
    if (typeof key !== "string" || !allowed.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor?.enumerable === true && "value" in descriptor;
  });
}

function hasExactEventProperties(
  record: Record<string, unknown>,
  eventKeys: readonly string[],
): boolean {
  return hasExactDataProperties(record, [...BASE_EVENT_KEYS, ...eventKeys]);
}

function hasImmediateWireByteOverflow(value: unknown): boolean {
  if (!isRecord(value)) return false;
  try {
    return Reflect.ownKeys(value).some((key) => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && "value" in descriptor &&
        typeof descriptor.value === "string" &&
        descriptor.value.length >= MAX_CLAUDE_CODE_MESSAGE_BYTES;
    });
  } catch {
    return false;
  }
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
    value.length > MAX_CLAUDE_CODE_WIRE_IDENTIFIER_LENGTH || value.trim() !== value
  ) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false;
  }
  return true;
}

/** Whether a value is an admitted Claude Code wire identity. */
export function isClaudeCodeWireIdentifier(value: unknown): value is string {
  return isCanonicalId(value);
}

/** Whether a value fits one non-identity Claude Code wire field. */
export function isClaudeCodeWireField(value: unknown): value is string {
  return isBoundedString(value);
}

function snapshotBoundedJson(
  value: unknown,
  budget: { remaining: number },
  seen: WeakSet<object>,
  depth = 0,
): unknown | typeof INVALID_WIRE_JSON {
  budget.remaining -= 1;
  if (budget.remaining < 0 || depth > MAX_CLAUDE_CODE_WIRE_JSON_DEPTH) {
    return INVALID_WIRE_JSON;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : INVALID_WIRE_JSON;
  if (typeof value === "string") return isBoundedString(value) ? value : INVALID_WIRE_JSON;
  if (typeof value !== "object") return INVALID_WIRE_JSON;
  if (seen.has(value)) return INVALID_WIRE_JSON;
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_CLAUDE_CODE_WIRE_ARRAY_ITEMS) return INVALID_WIRE_JSON;
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || !keys.includes("length")) {
        return INVALID_WIRE_JSON;
      }
      const snapshot: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
          return INVALID_WIRE_JSON;
        }
        const entry = snapshotBoundedJson(descriptor.value, budget, seen, depth + 1);
        if (entry === INVALID_WIRE_JSON) return INVALID_WIRE_JSON;
        snapshot.push(entry);
      }
      return Object.freeze(snapshot);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return INVALID_WIRE_JSON;
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_CLAUDE_CODE_WIRE_OBJECT_FIELDS) return INVALID_WIRE_JSON;
    const snapshot: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string" || key.length > MAX_CLAUDE_CODE_WIRE_KEY_LENGTH) {
        return INVALID_WIRE_JSON;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
        return INVALID_WIRE_JSON;
      }
      const entry = snapshotBoundedJson(descriptor.value, budget, seen, depth + 1);
      if (entry === INVALID_WIRE_JSON) return INVALID_WIRE_JSON;
      Object.defineProperty(snapshot, key, {
        configurable: false,
        enumerable: true,
        value: entry,
        writable: false,
      });
    }
    return Object.freeze(snapshot);
  } catch {
    return INVALID_WIRE_JSON;
  } finally {
    seen.delete(value);
  }
}

function readBase(record: Record<string, unknown>): EventBase | null {
  const timestamp = readDataProperty(record, "timestamp");
  if (!isFiniteDuration(timestamp)) return null;

  const runId = readDataProperty(record, "runId");
  if (runId !== undefined && !isCanonicalId(runId)) return null;

  const iteration = readDataProperty(record, "iteration");
  if (iteration !== undefined && !isSafeCount(iteration)) return null;

  return {
    timestamp,
    ...(runId === undefined ? {} : { runId }),
    ...(iteration === undefined ? {} : { iteration }),
  };
}

/** Snapshot a plain record as bounded, own-data-only wire JSON. */
export function snapshotClaudeCodeWireRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  const snapshot = snapshotBoundedJson(
    value,
    { remaining: MAX_CLAUDE_CODE_WIRE_JSON_NODES },
    new WeakSet(),
  );
  return isRecord(snapshot) ? snapshot : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_CLAUDE_CODE_ARRAY_ITEMS) return null;
  if (!value.every(isBoundedString)) return null;
  return value.slice();
}

function readFileChange(value: unknown): FileChange | null {
  if (
    !isRecord(value) ||
    !hasExactDataProperties(value, ["path", "type", "originalChecksum", "newChecksum"])
  ) return null;
  const path = readDataProperty(value, "path");
  const type = readDataProperty(value, "type");
  const originalChecksum = readDataProperty(value, "originalChecksum");
  const newChecksum = readDataProperty(value, "newChecksum");
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
  if (
    !hasExactDataProperties(value, [
      "success",
      "iterations",
      "response",
      "filesModified",
      "commandsExecuted",
      "changes",
      "error",
      "executionTime",
    ])
  ) return null;
  const success = readDataProperty(value, "success");
  const iterations = readDataProperty(value, "iterations");
  const response = readDataProperty(value, "response");
  const error = readDataProperty(value, "error");
  const executionTime = readDataProperty(value, "executionTime");
  const filesModified = readStringArray(readDataProperty(value, "filesModified"));
  const commandsExecuted = readStringArray(readDataProperty(value, "commandsExecuted"));
  const changes = readFileChanges(readDataProperty(value, "changes"));

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
  const snapshot = snapshotBoundedJson(
    value,
    { remaining: MAX_CLAUDE_CODE_WIRE_JSON_NODES },
    new WeakSet(),
  );
  if (!isRecord(snapshot)) {
    const type = isRecord(value) ? readDataProperty(value, "type") : undefined;
    return reject(
      typeof type === "string"
        ? `${type} fields exceed protocol limits`
        : "event fields exceed protocol limits",
    );
  }
  const record = snapshot;
  const base = readBase(record);
  if (!base) return reject("event base fields are invalid");
  const type = readDataProperty(record, "type");
  if (typeof type !== "string") return reject("event type must be a string");

  switch (type) {
    case "iteration_start": {
      if (!hasExactEventProperties(record, ["maxIterations"])) {
        return reject("iteration_start fields are invalid");
      }
      const iteration = readDataProperty(record, "iteration");
      const maxIterations = readDataProperty(record, "maxIterations");
      if (!isSafeCount(iteration) || !isSafeCount(maxIterations)) {
        return reject("iteration_start fields are invalid");
      }
      return { ok: true, event: { ...base, type, iteration, maxIterations } };
    }
    case "text_delta":
    case "text_complete":
    case "thinking_delta":
    case "thinking_complete": {
      if (!hasExactEventProperties(record, ["content"])) {
        return reject(`${type} fields are invalid`);
      }
      const content = readDataProperty(record, "content");
      if (!isBoundedString(content)) return reject(`${type} content is invalid`);
      return { ok: true, event: { ...base, type, content } };
    }
    case "tool_call_start": {
      if (!hasExactEventProperties(record, ["toolCallId", "toolName"])) {
        return reject("tool_call_start fields are invalid");
      }
      const toolCallId = readDataProperty(record, "toolCallId");
      const toolName = readDataProperty(record, "toolName");
      if (!isCanonicalId(toolCallId) || !isBoundedString(toolName)) {
        return reject("tool_call_start fields are invalid");
      }
      return { ok: true, event: { ...base, type, toolCallId, toolName } };
    }
    case "tool_call_input": {
      if (!hasExactEventProperties(record, ["toolCallId", "inputDelta"])) {
        return reject("tool_call_input fields are invalid");
      }
      const toolCallId = readDataProperty(record, "toolCallId");
      const inputDelta = readDataProperty(record, "inputDelta");
      if (!isCanonicalId(toolCallId) || !isBoundedString(inputDelta)) {
        return reject("tool_call_input fields are invalid");
      }
      return { ok: true, event: { ...base, type, toolCallId, inputDelta } };
    }
    case "tool_call_complete": {
      if (!hasExactEventProperties(record, ["toolCallId", "toolName", "input"])) {
        return reject("tool_call_complete fields are invalid");
      }
      const toolCallId = readDataProperty(record, "toolCallId");
      const toolName = readDataProperty(record, "toolName");
      const input = readDataProperty(record, "input");
      if (!isCanonicalId(toolCallId) || !isBoundedString(toolName) || !isRecord(input)) {
        return reject("tool_call_complete fields are invalid");
      }
      return { ok: true, event: { ...base, type, toolCallId, toolName, input } };
    }
    case "tool_result": {
      if (!hasExactEventProperties(record, ["toolCallId", "toolName", "output", "isError"])) {
        return reject("tool_result fields are invalid");
      }
      const toolCallId = readDataProperty(record, "toolCallId");
      const toolName = readDataProperty(record, "toolName");
      const output = readDataProperty(record, "output");
      const isError = readDataProperty(record, "isError");
      if (
        !isCanonicalId(toolCallId) || !isBoundedString(toolName) ||
        !isBoundedString(output) || typeof isError !== "boolean"
      ) {
        return reject("tool_result fields are invalid");
      }
      return { ok: true, event: { ...base, type, toolCallId, toolName, output, isError } };
    }
    case "iteration_complete": {
      if (!hasExactEventProperties(record, ["toolCallCount", "hasMoreWork"])) {
        return reject("iteration_complete fields are invalid");
      }
      const iteration = readDataProperty(record, "iteration");
      const toolCallCount = readDataProperty(record, "toolCallCount");
      const hasMoreWork = readDataProperty(record, "hasMoreWork");
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
      if (!hasExactEventProperties(record, [])) {
        return reject("thinking_start fields are invalid");
      }
      return { ok: true, event: { ...base, type } };
    case "complete": {
      if (!hasExactEventProperties(record, ["result"])) {
        return reject("complete result is invalid");
      }
      const result = readResult(readDataProperty(record, "result"));
      if (!result) return reject("complete result is invalid");
      return { ok: true, event: { ...base, type, result } };
    }
    case "error": {
      if (!hasExactEventProperties(record, ["message", "code", "recoverable"])) {
        return reject("error fields are invalid");
      }
      const message = readDataProperty(record, "message");
      const code = readDataProperty(record, "code");
      const recoverable = readDataProperty(record, "recoverable");
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
      if (
        !hasExactEventProperties(record, [
          "requestId",
          "toolCallId",
          "toolName",
          "input",
          "reason",
          "timeout",
        ])
      ) return reject("approval_request fields are invalid");
      const requestId = readDataProperty(record, "requestId");
      const toolCallId = readDataProperty(record, "toolCallId");
      const toolName = readDataProperty(record, "toolName");
      const input = readDataProperty(record, "input");
      const reason = readDataProperty(record, "reason");
      const timeout = readDataProperty(record, "timeout");
      const runId = base.runId;
      if (
        !isCanonicalId(runId) || !isCanonicalId(requestId) ||
        !isCanonicalId(toolCallId) || !isBoundedString(toolName) || !isRecord(input) ||
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
          runId,
          requestId,
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
      if (!hasExactEventProperties(record, ["requestId", "prompt", "defaultValue", "timeout"])) {
        return reject("input_request fields are invalid");
      }
      const requestId = readDataProperty(record, "requestId");
      const prompt = readDataProperty(record, "prompt");
      const defaultValue = readDataProperty(record, "defaultValue");
      const timeout = readDataProperty(record, "timeout");
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
      if (!hasExactEventProperties(record, [])) return reject("pong fields are invalid");
      return { ok: true, event: { ...base, type } };
    case "cancelled": {
      if (!allowExtended) return reject("event type is not allowed on this transport");
      if (!hasExactEventProperties(record, ["reason"])) {
        return reject("cancelled reason is invalid");
      }
      const reason = readDataProperty(record, "reason");
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
      if (
        !hasExactEventProperties(record, [
          "commandId",
          "commandType",
          "status",
          "requestId",
          "reason",
        ])
      ) return reject("command_ack fields are invalid");
      const commandId = readDataProperty(record, "commandId");
      const commandType = readDataProperty(record, "commandType");
      const status = readDataProperty(record, "status");
      const requestId = readDataProperty(record, "requestId");
      const reason = readDataProperty(record, "reason");
      const runId = base.runId;
      const approvalAcknowledgement = commandType === "approve" || commandType === "reject";
      const inputAcknowledgement = commandType === "input";
      if (
        !isCanonicalId(runId) || !isCanonicalId(commandId) ||
        (commandType !== "cancel" && commandType !== "approve" &&
          commandType !== "reject" && commandType !== "input" && commandType !== "ping") ||
        (status !== "accepted" && status !== "rejected") ||
        (approvalAcknowledgement
          ? !isCanonicalId(requestId)
          : inputAcknowledgement
          ? (requestId !== undefined && !isCanonicalId(requestId))
          : requestId !== undefined) ||
        (reason !== undefined && !isBoundedString(reason))
      ) return reject("command_ack fields are invalid");
      const admittedRequestId = typeof requestId === "string" ? requestId : undefined;
      const acknowledgementBase = {
        ...base,
        type,
        runId,
        commandId,
        status,
        ...(reason === undefined ? {} : { reason }),
      } as const;
      if (commandType === "approve" || commandType === "reject") {
        if (!isCanonicalId(admittedRequestId)) {
          return reject("command_ack fields are invalid");
        }
        return {
          ok: true,
          event: {
            ...acknowledgementBase,
            commandType,
            requestId: admittedRequestId,
          },
        };
      }
      if (commandType === "input") {
        return {
          ok: true,
          event: {
            ...acknowledgementBase,
            commandType,
            ...(admittedRequestId === undefined ? {} : { requestId: admittedRequestId }),
          },
        };
      }
      return {
        ok: true,
        event: {
          ...acknowledgementBase,
          commandType,
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
  if (data.length > MAX_CLAUDE_CODE_MESSAGE_BYTES) {
    return reject("event payload exceeds the byte limit");
  }
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

function encodeWireValue(value: unknown, kind: string): ClaudeCodeWireEncoding {
  let data: string;
  try {
    data = JSON.stringify(value);
  } catch {
    return { ok: false, reason: `${kind} is not serializable` };
  }
  if (
    data.length > MAX_CLAUDE_CODE_MESSAGE_BYTES ||
    new TextEncoder().encode(data).byteLength > MAX_CLAUDE_CODE_MESSAGE_BYTES
  ) {
    return { ok: false, reason: `${kind} exceeds the wire byte limit` };
  }
  return { ok: true, data };
}

/** Validate, snapshot, and encode one outgoing Claude Code event. */
export function encodeClaudeCodeEventMessage(
  event: unknown,
  allowExtended = false,
): ClaudeCodeWireEncoding {
  if (hasImmediateWireByteOverflow(event)) {
    return { ok: false, reason: "Claude Code event exceeds the wire byte limit" };
  }
  const admission = admitRecord(event, allowExtended);
  if (!admission.ok) return admission;
  return encodeWireValue(admission.event, "Claude Code event");
}

function admitClientCommandRecord(
  value: unknown,
  expectedRunId: string,
): ClaudeCodeEventAdmission<ClientCommand> {
  const snapshot = snapshotBoundedJson(
    value,
    { remaining: MAX_CLAUDE_CODE_WIRE_JSON_NODES },
    new WeakSet(),
  );
  if (!isRecord(snapshot)) return reject("command fields exceed protocol limits");

  const type = readDataProperty(snapshot, "type");
  const timestamp = readDataProperty(snapshot, "timestamp");
  const runId = readDataProperty(snapshot, "runId");
  const commandId = readDataProperty(snapshot, "commandId");
  if (
    typeof type !== "string" || !isSafeCount(timestamp) || runId !== expectedRunId ||
    (commandId !== undefined && !isCanonicalId(commandId))
  ) return reject("command base fields are invalid");

  const baseKeys = ["type", "timestamp", "runId", "commandId"] as const;
  const commandBase = {
    timestamp,
    runId: expectedRunId,
    ...(commandId === undefined ? {} : { commandId }),
  };
  switch (type) {
    case "cancel": {
      if (!hasExactDataProperties(snapshot, [...baseKeys, "reason"])) {
        return reject("cancel command fields are invalid");
      }
      const reason = readDataProperty(snapshot, "reason");
      if (reason !== undefined && !isBoundedString(reason)) {
        return reject("cancel command fields are invalid");
      }
      return {
        ok: true,
        event: { type, ...commandBase, ...(reason === undefined ? {} : { reason }) },
      };
    }
    case "approve": {
      if (!hasExactDataProperties(snapshot, [...baseKeys, "requestId", "toolCallId"])) {
        return reject("approve command fields are invalid");
      }
      const requestId = readDataProperty(snapshot, "requestId");
      const toolCallId = readDataProperty(snapshot, "toolCallId");
      if (
        !isCanonicalId(commandId) || !isCanonicalId(requestId) ||
        !isCanonicalId(toolCallId)
      ) return reject("approve command fields are invalid");
      return {
        ok: true,
        event: { type, ...commandBase, commandId, requestId, toolCallId },
      };
    }
    case "reject": {
      if (
        !hasExactDataProperties(snapshot, [
          ...baseKeys,
          "requestId",
          "toolCallId",
          "reason",
        ])
      ) return reject("reject command fields are invalid");
      const requestId = readDataProperty(snapshot, "requestId");
      const toolCallId = readDataProperty(snapshot, "toolCallId");
      const reason = readDataProperty(snapshot, "reason");
      if (
        !isCanonicalId(commandId) || !isCanonicalId(requestId) ||
        !isCanonicalId(toolCallId) ||
        (reason !== undefined && !isBoundedString(reason))
      ) return reject("reject command fields are invalid");
      return {
        ok: true,
        event: {
          type,
          ...commandBase,
          commandId,
          requestId,
          toolCallId,
          ...(reason === undefined ? {} : { reason }),
        },
      };
    }
    case "input": {
      if (!hasExactDataProperties(snapshot, [...baseKeys, "content", "requestId"])) {
        return reject("input command fields are invalid");
      }
      const content = readDataProperty(snapshot, "content");
      const requestId = readDataProperty(snapshot, "requestId");
      if (
        !isBoundedString(content) ||
        (requestId !== undefined && !isCanonicalId(requestId))
      ) return reject("input command fields are invalid");
      return {
        ok: true,
        event: {
          type,
          ...commandBase,
          content,
          ...(requestId === undefined ? {} : { requestId }),
        },
      };
    }
    case "ping":
      return hasExactDataProperties(snapshot, baseKeys)
        ? { ok: true, event: { type, ...commandBase } }
        : reject("ping command fields are invalid");
    default:
      return reject("command type is not supported");
  }
}

/** Parse and admit one bounded client command for an exact run. */
export function admitClaudeCodeClientCommandMessage(
  data: unknown,
  expectedRunId: string,
): ClaudeCodeEventAdmission<ClientCommand> {
  if (typeof data !== "string") return reject("command payload must be text");
  if (
    data.length > MAX_CLAUDE_CODE_MESSAGE_BYTES ||
    new TextEncoder().encode(data).byteLength > MAX_CLAUDE_CODE_MESSAGE_BYTES
  ) return reject("command payload exceeds the wire byte limit");

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return reject("command payload is not valid JSON");
  }
  return admitClientCommandRecord(parsed, expectedRunId);
}

/** Validate, snapshot, and encode one outgoing client command for an exact run. */
export function encodeClaudeCodeClientCommandMessage(
  command: unknown,
  expectedRunId: string,
): ClaudeCodeWireEncoding {
  if (hasImmediateWireByteOverflow(command)) {
    return { ok: false, reason: "Claude Code command exceeds the wire byte limit" };
  }
  const admission = admitClientCommandRecord(command, expectedRunId);
  if (!admission.ok) return admission;
  return encodeWireValue(admission.event, "Claude Code command");
}

const CLIENT_COMMAND_TYPES = new Set<ClientCommandType>([
  "cancel",
  "approve",
  "reject",
  "input",
  "ping",
]);

/** Recover safe acknowledgement correlation from a rejected command message. */
export function readRejectedClaudeCodeClientCommandContext(
  data: unknown,
): RejectedClaudeCodeClientCommandContext | null {
  if (typeof data !== "string") return null;
  if (
    data.length > MAX_CLAUDE_CODE_MESSAGE_BYTES ||
    new TextEncoder().encode(data).byteLength > MAX_CLAUDE_CODE_MESSAGE_BYTES
  ) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const commandId = readDataProperty(parsed, "commandId");
  const commandType = readDataProperty(parsed, "type");
  if (
    !isCanonicalId(commandId) || typeof commandType !== "string" ||
    !CLIENT_COMMAND_TYPES.has(commandType as ClientCommandType)
  ) return null;
  const requestId = commandType === "approve" || commandType === "reject" ||
      commandType === "input"
    ? readDataProperty(parsed, "requestId")
    : undefined;
  if (requestId !== undefined && !isCanonicalId(requestId)) return null;
  return {
    commandId,
    commandType: commandType as ClientCommandType,
    ...(requestId === undefined ? {} : { requestId }),
  };
}

/** Admit an own-data-only authoritative command disposition. */
export function admitClaudeCodeClientCommandDisposition(
  value: unknown,
): ClientCommandDisposition | null {
  try {
    if (!isRecord(value)) return null;
    const status = readDataProperty(value, "status");
    if (status === "accepted") {
      return hasExactDataProperties(value, ["status"]) ? { status } : null;
    }
    if (status !== "rejected" || !hasExactDataProperties(value, ["status", "reason"])) {
      return null;
    }
    const reason = readDataProperty(value, "reason");
    if (reason !== undefined && !isBoundedString(reason)) return null;
    return { status, ...(reason === undefined ? {} : { reason }) };
  } catch {
    return null;
  }
}
