import { INVALID_ARGUMENT, REQUEST_ERROR } from "#veryfront/errors";
import { MAX_SANDBOX_PROJECT_ID_BYTES } from "./config.ts";
import type { ExecOptions, ExecResult, ExecStreamEvent } from "./types.ts";

export const DEFAULT_SANDBOX_BUFFERED_OUTPUT_BYTES = 64 * 1024 * 1024;
export const MAX_SANDBOX_BUFFERED_OUTPUT_BYTES = 256 * 1024 * 1024;
export const MAX_SANDBOX_COMMAND_BYTES = 256 * 1024;
export const MAX_SANDBOX_WRITE_BYTES = 64 * 1024 * 1024;

const MAX_SANDBOX_PATH_BYTES = 16 * 1024;
const MAX_SANDBOX_ENV_BYTES = 1024 * 1024;
const MAX_SANDBOX_ENV_ENTRIES = 1024;
export const MAX_SANDBOX_WRITE_FILES = 1024;
const MAX_SANDBOX_TIMEOUT_SECONDS = 24 * 60 * 60;
const EXEC_OPTION_KEYS: ReadonlySet<string> = new Set([
  "cwd",
  "timeout_seconds",
  "env",
  "projectReference",
  "maxOutputBytes",
]);
const MISSING = Symbol("missing sandbox request property");
const encoder = new TextEncoder();
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ownKeys = Reflect.ownKeys;

class SandboxOutputLimitCause extends Error {
  constructor(readonly maxOutputBytes: number) {
    super(`Sandbox command output exceeded ${maxOutputBytes} bytes`);
    this.name = "SandboxOutputLimitCause";
  }
}

/** Whether buffered sandbox command collection exceeded its configured limit. */
export function isSandboxOutputLimitError(error: unknown): boolean {
  return error instanceof Error && error.cause instanceof SandboxOutputLimitCause;
}

export interface NormalizedSandboxExecRequest {
  payload: {
    command: string;
    cwd?: string;
    timeout_seconds?: number;
    env?: Record<string, string>;
    projectReference?: string;
  };
  maxOutputBytes: number;
}

function invalid(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function requireBoundedString(
  value: unknown,
  label: string,
  maxBytes: number,
  options: { allowEmpty?: boolean } = {},
): string {
  if (typeof value !== "string" || (!options.allowEmpty && value.length === 0)) {
    invalid(`${label} must be ${options.allowEmpty ? "a" : "a non-empty"} string`);
  }
  if (value.includes("\0")) invalid(`${label} must not contain NUL characters`);
  if (value.length > maxBytes) {
    invalid(`${label} exceeds the ${maxBytes}-byte limit`);
  }
  if (byteLength(value) > maxBytes) {
    invalid(`${label} exceeds the ${maxBytes}-byte limit`);
  }
  return value;
}

function asOptionsRecord(options: ExecOptions | undefined): Record<string, unknown> {
  if (options === undefined) return {};
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    invalid("Sandbox exec options must be an object");
  }
  return options as unknown as Record<string, unknown>;
}

function ownDataValue(record: Record<string, unknown>, key: string): unknown | typeof MISSING {
  const descriptor = getOwnPropertyDescriptor(record, key);
  if (!descriptor) return MISSING;
  if (!("value" in descriptor)) {
    invalid(`Sandbox exec option ${key} must be a data property`);
  }
  return descriptor.value;
}

function rejectUnknownOptions(record: Record<string, unknown>): void {
  for (const key of ownKeys(record)) {
    const descriptor = getOwnPropertyDescriptor(record, key);
    if (!descriptor?.enumerable) continue;
    if (typeof key !== "string" || !EXEC_OPTION_KEYS.has(key)) {
      invalid(`Unknown sandbox exec option: ${String(key)}`);
    }
  }
}

function normalizeEnvironment(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("Sandbox exec env must be an object of string values");
  }

  const source = value as Record<string, unknown>;
  const env: Record<string, string> = Object.create(null);
  let entries = 0;
  let totalBytes = 0;

  for (const key of ownKeys(source)) {
    const descriptor = getOwnPropertyDescriptor(source, key);
    if (!descriptor?.enumerable) continue;
    if (typeof key !== "string") invalid("Sandbox exec env must not contain symbol keys");
    if (!("value" in descriptor)) {
      invalid(`Sandbox exec env ${key} must be a data property`);
    }
    if (typeof descriptor.value !== "string") {
      invalid(`Sandbox exec env ${key} must be a string`);
    }
    if (!key || key.includes("=") || key.includes("\0")) {
      invalid("Sandbox exec env names must be non-empty and must not contain '=' or NUL");
    }
    if (descriptor.value.includes("\0")) {
      invalid(`Sandbox exec env ${key} must not contain NUL characters`);
    }
    if (
      key.length > MAX_SANDBOX_ENV_BYTES ||
      descriptor.value.length > MAX_SANDBOX_ENV_BYTES
    ) {
      invalid(`Sandbox exec env exceeds ${MAX_SANDBOX_ENV_BYTES} bytes`);
    }

    entries += 1;
    if (entries > MAX_SANDBOX_ENV_ENTRIES) {
      invalid(`Sandbox exec env exceeds ${MAX_SANDBOX_ENV_ENTRIES} entries`);
    }
    totalBytes += byteLength(key) + byteLength(descriptor.value);
    if (totalBytes > MAX_SANDBOX_ENV_BYTES) {
      invalid(`Sandbox exec env exceeds ${MAX_SANDBOX_ENV_BYTES} bytes`);
    }
    Object.defineProperty(env, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }

  return env;
}

function normalizeOutputLimit(value: unknown | typeof MISSING): number {
  if (value === MISSING || value === undefined) return DEFAULT_SANDBOX_BUFFERED_OUTPUT_BYTES;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > MAX_SANDBOX_BUFFERED_OUTPUT_BYTES
  ) {
    invalid(
      `Sandbox maxOutputBytes must be a positive safe integer no greater than ${MAX_SANDBOX_BUFFERED_OUTPUT_BYTES}`,
    );
  }
  return value as number;
}

/** Validate and snapshot a command request without invoking caller-owned accessors. */
export function normalizeSandboxExecRequest(
  command: string,
  options?: ExecOptions,
  fallbackProjectReference?: string | null,
): NormalizedSandboxExecRequest {
  const normalizedCommand = requireBoundedString(
    command,
    "Sandbox command",
    MAX_SANDBOX_COMMAND_BYTES,
    { allowEmpty: true },
  );
  const record = asOptionsRecord(options);
  rejectUnknownOptions(record);

  const cwd = ownDataValue(record, "cwd");
  const timeoutSeconds = ownDataValue(record, "timeout_seconds");
  const env = ownDataValue(record, "env");
  const projectReference = ownDataValue(record, "projectReference");
  const maxOutputBytes = normalizeOutputLimit(ownDataValue(record, "maxOutputBytes"));

  const payload: NormalizedSandboxExecRequest["payload"] = { command: normalizedCommand };
  if (cwd !== MISSING && cwd !== undefined) {
    payload.cwd = requireBoundedString(cwd, "Sandbox exec cwd", MAX_SANDBOX_PATH_BYTES);
  }
  if (timeoutSeconds !== MISSING && timeoutSeconds !== undefined) {
    if (
      !Number.isSafeInteger(timeoutSeconds) ||
      (timeoutSeconds as number) < 0 ||
      (timeoutSeconds as number) > MAX_SANDBOX_TIMEOUT_SECONDS
    ) {
      invalid(
        `Sandbox timeout_seconds must be a non-negative safe integer no greater than ${MAX_SANDBOX_TIMEOUT_SECONDS}`,
      );
    }
    payload.timeout_seconds = timeoutSeconds as number;
  }
  if (env !== MISSING && env !== undefined) {
    payload.env = normalizeEnvironment(env);
  }

  const resolvedProjectReference = projectReference === MISSING ||
      projectReference === undefined
    ? fallbackProjectReference ?? undefined
    : projectReference;
  if (resolvedProjectReference !== undefined && resolvedProjectReference !== null) {
    if (typeof resolvedProjectReference !== "string") {
      invalid("Sandbox projectReference must be a string");
    }
    payload.projectReference = requireBoundedString(
      resolvedProjectReference.trim(),
      "Sandbox projectReference",
      MAX_SANDBOX_PROJECT_ID_BYTES,
    );
  }

  return { payload, maxOutputBytes };
}

/** Validate a path or API identifier before using it in a sandbox route. */
export function validateSandboxRouteValue(
  value: string,
  label: string,
  maxBytes = MAX_SANDBOX_PATH_BYTES,
): string {
  return requireBoundedString(value, label, maxBytes);
}

/** Validate and snapshot a write request without invoking caller-owned accessors. */
export function normalizeSandboxFiles(
  files: Array<{ path: string; content: string }>,
): Array<{ path: string; content: string }> {
  if (!Array.isArray(files)) invalid("Sandbox files must be an array");
  if (files.length > MAX_SANDBOX_WRITE_FILES) {
    invalid(`Sandbox write request exceeds ${MAX_SANDBOX_WRITE_FILES} files`);
  }

  const normalized: Array<{ path: string; content: string }> = [];
  let totalBytes = 0;
  for (let index = 0; index < files.length; index += 1) {
    const descriptor = getOwnPropertyDescriptor(files, String(index));
    if (!descriptor || !("value" in descriptor)) {
      invalid(`Sandbox file ${index} must be a data property`);
    }
    const file = descriptor.value;
    if (typeof file !== "object" || file === null || Array.isArray(file)) {
      invalid(`Sandbox file ${index} must be an object`);
    }
    const record = file as Record<string, unknown>;
    const path = ownDataValue(record, "path");
    const content = ownDataValue(record, "content");
    if (path === MISSING || content === MISSING) {
      invalid(`Sandbox file ${index} must include path and content`);
    }
    const normalizedPath = requireBoundedString(
      path,
      `Sandbox file ${index} path`,
      MAX_SANDBOX_PATH_BYTES,
    );
    if (typeof content !== "string") {
      invalid(`Sandbox file ${index} content must be a string`);
    }
    if (normalizedPath.length + content.length > MAX_SANDBOX_WRITE_BYTES - totalBytes) {
      invalid(`Sandbox write request exceeds ${MAX_SANDBOX_WRITE_BYTES} bytes`);
    }
    totalBytes += byteLength(normalizedPath) + byteLength(content);
    if (totalBytes > MAX_SANDBOX_WRITE_BYTES) {
      invalid(`Sandbox write request exceeds ${MAX_SANDBOX_WRITE_BYTES} bytes`);
    }
    normalized.push({ path: normalizedPath, content });
  }
  return normalized;
}

function addOutputChunk(
  chunks: string[],
  chunk: string | undefined,
  state: { bytes: number },
  maxOutputBytes: number,
): void {
  if (chunk === undefined || chunk.length === 0) return;
  state.bytes += byteLength(chunk);
  if (state.bytes > maxOutputBytes) {
    throw REQUEST_ERROR.create({
      detail:
        `Sandbox command output exceeded ${maxOutputBytes} bytes; use executeStream() or raise maxOutputBytes`,
      cause: new SandboxOutputLimitCause(maxOutputBytes),
    });
  }
  chunks.push(chunk);
}

/** Collect a validated command event stream into a bounded result. */
export async function collectSandboxExecResult(
  events: AsyncIterable<ExecStreamEvent>,
  maxOutputBytes: number,
): Promise<ExecResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const outputState = { bytes: 0 };
  let exitCode: number | undefined;

  for await (const event of events) {
    if (exitCode !== undefined) {
      throw REQUEST_ERROR.create({
        detail: "Sandbox exec stream emitted data after its exit event",
      });
    }

    switch (event.type) {
      case "stdout":
        addOutputChunk(stdout, event.data, outputState, maxOutputBytes);
        break;
      case "stderr":
        addOutputChunk(stderr, event.data, outputState, maxOutputBytes);
        break;
      case "error":
        throw REQUEST_ERROR.create({
          detail: event.data
            ? `Sandbox command failed: ${event.data.slice(0, 2_000)}`
            : "Sandbox command failed",
        });
      case "exit":
        exitCode = event.exitCode;
        break;
    }
  }

  if (exitCode === undefined) {
    throw REQUEST_ERROR.create({
      detail: "Sandbox exec stream ended without an exit event",
    });
  }

  return {
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    exitCode,
  };
}
