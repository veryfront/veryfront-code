import { REQUEST_ERROR } from "#veryfront/errors";
import type {
  BackgroundCommand,
  BackgroundCommandHeartbeatStatus,
  BackgroundCommandOutput,
  BackgroundCommandStatus,
  ExecStreamEvent,
  SandboxListResult,
} from "./types.ts";

export interface SandboxSessionRecord {
  id: string;
  endpoint: string | null;
  status: string;
}

const BACKGROUND_COMMAND_STATUSES: ReadonlySet<string> = new Set([
  "running",
  "completed",
  "failed",
  "canceled",
]);
const BACKGROUND_HEARTBEAT_STATUSES: ReadonlySet<string> = new Set([
  "disabled",
  "healthy",
  "degraded",
]);
const EXEC_EVENT_TYPES: ReadonlySet<string> = new Set([
  "stdout",
  "stderr",
  "exit",
  "error",
]);
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const arrayIsArray = Array.isArray;

function protocolError(operation: string, detail: string): never {
  throw REQUEST_ERROR.create({ detail: `${operation}: ${detail}` });
}

function asRecord(value: unknown, operation: string, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || arrayIsArray(value)) {
    protocolError(operation, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function arrayDataValue(
  array: unknown[],
  index: number,
  operation: string,
  label: string,
): unknown {
  const descriptor = getOwnPropertyDescriptor(array, String(index));
  if (!descriptor || !("value" in descriptor)) {
    protocolError(operation, `${label}[${index}] must be a data property`);
  }
  return descriptor.value;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  operation: string,
): string {
  const value = ownValue(record, key);
  if (typeof value !== "string" || value.length === 0) {
    protocolError(operation, `${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  operation: string,
): string | undefined {
  const value = ownValue(record, key);
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    protocolError(operation, `${key} must be a string when present`);
  }
  return value;
}

function nullableString(
  record: Record<string, unknown>,
  key: string,
  operation: string,
): string | null {
  const value = ownValue(record, key);
  if (value !== null && typeof value !== "string") {
    protocolError(operation, `${key} must be a string or null`);
  }
  return value;
}

function nullablePageLink(
  record: Record<string, unknown>,
  key: string,
  operation: string,
): string | null {
  const value = ownValue(record, key);
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    protocolError(operation, `page_info.${key} must be a string or null`);
  }
  return value;
}

function requiredBoolean(
  record: Record<string, unknown>,
  key: string,
  operation: string,
): boolean {
  const value = ownValue(record, key);
  if (typeof value !== "boolean") {
    protocolError(operation, `${key} must be a boolean`);
  }
  return value;
}

function nonNegativeSafeInteger(
  record: Record<string, unknown>,
  key: string,
  operation: string,
): number {
  const value = ownValue(record, key);
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    protocolError(operation, `${key} must be a non-negative safe integer`);
  }
  return value as number;
}

function nullableSafeInteger(
  record: Record<string, unknown>,
  key: string,
  operation: string,
): number | null {
  const value = ownValue(record, key);
  if (value === null) return null;
  if (!Number.isSafeInteger(value)) {
    protocolError(operation, `${key} must be a safe integer or null`);
  }
  return value as number;
}

function validateEndpoint(endpoint: string, operation: string): string {
  if (endpoint.trim() !== endpoint) {
    protocolError(operation, "endpoint must not contain surrounding whitespace");
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    protocolError(operation, "endpoint must be an absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    protocolError(operation, "endpoint must use http or https");
  }
  if (url.username || url.password) {
    protocolError(operation, "endpoint must not contain credentials");
  }
  if (url.search || url.hash) {
    protocolError(operation, "endpoint must not contain a query string or fragment");
  }
  return endpoint;
}

/** Parse a control-plane create or readiness response. */
export function parseSandboxSessionRecord(
  value: unknown,
  operation: string,
  options: { expectedId?: string; requireId?: boolean } = {},
): SandboxSessionRecord {
  const record = asRecord(value, operation, "response");
  const responseId = optionalString(record, "id", operation);
  if (options.requireId && responseId === undefined) {
    protocolError(operation, "id must be a non-empty string");
  }
  if (responseId !== undefined && responseId.length === 0) {
    protocolError(operation, "id must be a non-empty string");
  }
  if (
    options.expectedId !== undefined &&
    responseId !== undefined &&
    responseId !== options.expectedId
  ) {
    protocolError(operation, "response id does not match the requested sandbox");
  }

  const id = options.expectedId ?? responseId;
  if (!id) protocolError(operation, "id must be a non-empty string");

  const status = requiredString(record, "status", operation);
  const endpointValue = optionalString(record, "endpoint", operation);
  const endpoint = endpointValue === undefined ? null : validateEndpoint(endpointValue, operation);
  if (status === "running" && endpoint === null) {
    protocolError(operation, "running sandbox response is missing endpoint");
  }

  return { id, endpoint, status };
}

/** Parse the endpoint returned by a reconnect lookup. */
export function parseSandboxEndpointResponse(value: unknown, operation: string): string {
  const record = asRecord(value, operation, "response");
  return validateEndpoint(requiredString(record, "endpoint", operation), operation);
}

/** Parse the paginated sandbox-session list response. */
export function parseSandboxListResponse(value: unknown, operation: string): SandboxListResult {
  const record = asRecord(value, operation, "response");
  const data = ownValue(record, "data");
  if (!arrayIsArray(data)) protocolError(operation, "data must be an array");

  const sessions = [];
  for (let index = 0; index < data.length; index += 1) {
    const session = asRecord(
      arrayDataValue(data, index, operation, "data"),
      operation,
      `data[${index}]`,
    );
    sessions.push({
      id: requiredString(session, "id", operation),
      shortId: requiredString(session, "short_id", operation),
      endpoint: validateEndpoint(requiredString(session, "endpoint", operation), operation),
      status: requiredString(session, "status", operation),
      createdAt: requiredString(session, "created_at", operation),
    });
  }

  const pageInfo = asRecord(ownValue(record, "page_info"), operation, "page_info");
  return {
    data: sessions,
    pageInfo: {
      self: nullablePageLink(pageInfo, "self", operation),
      first: null,
      next: nullablePageLink(pageInfo, "next", operation),
      prev: nullablePageLink(pageInfo, "prev", operation),
    },
  };
}

/** Parse a background-command response. */
export function parseBackgroundCommand(value: unknown, operation: string): BackgroundCommand {
  const record = asRecord(value, operation, "response");
  const status = requiredString(record, "status", operation);
  if (!BACKGROUND_COMMAND_STATUSES.has(status)) {
    protocolError(operation, "status is not a recognized background command status");
  }
  const heartbeatStatus = requiredString(record, "heartbeat_status", operation);
  if (!BACKGROUND_HEARTBEAT_STATUSES.has(heartbeatStatus)) {
    protocolError(operation, "heartbeat_status is not recognized");
  }

  return {
    id: requiredString(record, "id", operation),
    status: status as BackgroundCommandStatus,
    exitCode: nullableSafeInteger(record, "exit_code", operation),
    signal: nullableString(record, "signal", operation),
    startedAt: requiredString(record, "started_at", operation),
    finishedAt: nullableString(record, "finished_at", operation),
    heartbeatStatus: heartbeatStatus as BackgroundCommandHeartbeatStatus,
    lastHeartbeatAt: nullableString(record, "last_heartbeat_at", operation),
    lastHeartbeatError: nullableString(record, "last_heartbeat_error", operation),
    heartbeatFailureCount: nonNegativeSafeInteger(record, "heartbeat_failure_count", operation),
  };
}

/** Parse a background-command output response. */
export function parseBackgroundCommandOutput(
  value: unknown,
  operation: string,
): BackgroundCommandOutput {
  const record = asRecord(value, operation, "response");
  return {
    ...parseBackgroundCommand(record, operation),
    stdout: requiredStringOrEmpty(record, "stdout", operation),
    stderr: requiredStringOrEmpty(record, "stderr", operation),
    stdoutTruncated: requiredBoolean(record, "stdout_truncated", operation),
    stderrTruncated: requiredBoolean(record, "stderr_truncated", operation),
  };
}

function requiredStringOrEmpty(
  record: Record<string, unknown>,
  key: string,
  operation: string,
): string {
  const value = ownValue(record, key);
  if (typeof value !== "string") protocolError(operation, `${key} must be a string`);
  return value;
}

/** Parse either supported background-command list envelope. */
export function parseBackgroundCommandList(
  value: unknown,
  operation: string,
): BackgroundCommand[] {
  let commands: unknown;
  if (arrayIsArray(value)) {
    commands = value;
  } else {
    const record = asRecord(value, operation, "response");
    commands = ownValue(record, "commands");
  }
  if (!arrayIsArray(commands)) protocolError(operation, "commands must be an array");

  const parsed: BackgroundCommand[] = [];
  for (let index = 0; index < commands.length; index += 1) {
    parsed.push(
      parseBackgroundCommand(
        arrayDataValue(commands, index, operation, "commands"),
        `${operation} command ${index}`,
      ),
    );
  }
  return parsed;
}

/** Parse and validate one command-stream event. */
export function parseExecStreamEvent(value: unknown, operation: string): ExecStreamEvent {
  const record = asRecord(value, operation, "event");
  const type = requiredString(record, "type", operation);
  if (!EXEC_EVENT_TYPES.has(type)) {
    protocolError(operation, "event type is not recognized");
  }

  const data = optionalString(record, "data", operation);
  const exitCodeValue = ownValue(record, "exitCode");
  if (type === "exit") {
    if (data !== undefined) {
      protocolError(operation, "data is not valid on exit events");
    }
    if (!Number.isSafeInteger(exitCodeValue) || (exitCodeValue as number) < 0) {
      protocolError(operation, "exit event must include a non-negative safe integer exitCode");
    }
    return { type: "exit", exitCode: exitCodeValue as number };
  }
  if (exitCodeValue !== undefined) {
    protocolError(operation, "exitCode is only valid on exit events");
  }
  return data === undefined
    ? { type: type as "stdout" | "stderr" | "error" }
    : { type: type as "stdout" | "stderr" | "error", data };
}
