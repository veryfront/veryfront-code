import {
  INITIALIZATION_ERROR,
  INVALID_ARGUMENT,
  REQUEST_ERROR,
  VeryfrontError,
} from "#veryfront/errors";
import type {
  BackgroundCommand,
  BackgroundCommandOutput,
  ExecOptions,
  ExecResult,
  ExecStreamEvent,
  SandboxListOptions,
  SandboxListResult,
  SandboxSession,
} from "./types.ts";

const MAX_URL_LENGTH = 4_096;
const MAX_AUTH_TOKEN_LENGTH = 16_384;
export const MAX_SANDBOX_IDENTIFIER_LENGTH = 512;
const MAX_STATUS_LENGTH = 64;
const MAX_PATH_LENGTH = 4_096;
export const MAX_SANDBOX_COMMAND_LENGTH = 1_048_576;
const MAX_ENV_ENTRIES = 256;
const MAX_ENV_KEY_LENGTH = 256;
const MAX_ENV_VALUE_LENGTH = 65_536;
const MAX_EXEC_TIMEOUT_SECONDS = 86_400;
const MAX_LIST_LIMIT = 1_000;
const MAX_LIST_CURSOR_LENGTH = 4_096;
const MAX_FILES_PER_WRITE = 1_000;
const MAX_FILE_CONTENT_BYTES = 64 * 1_048_576;
const MAX_JSON_RESPONSE_BYTES = 64 * 1_048_576;
const MAX_TEXT_RESPONSE_BYTES = 64 * 1_048_576;
const MAX_EXEC_EVENT_LINE_LENGTH = 16 * 1_048_576;
const MAX_BUFFERED_EXEC_OUTPUT_BYTES = 16 * 1_048_576;
const MAX_BACKGROUND_COMMANDS = 10_000;
export const DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS = 30_000;

const BACKGROUND_COMMAND_STATUSES = new Set([
  "running",
  "completed",
  "failed",
  "canceled",
]);
const BACKGROUND_HEARTBEAT_STATUSES = new Set(["disabled", "healthy", "degraded"]);

function invalidArgument(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function invalidResponse(detail: string): never {
  throw REQUEST_ERROR.create({ detail });
}

function containsUnsafeStringCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0 || (code >= 0xd800 && code <= 0xdbff)) {
      if (code === 0) return true;
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true;
      index++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function normalizeBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
  options: { trim?: boolean; allowEmpty?: boolean } = {},
): string {
  if (typeof value !== "string") {
    invalidArgument(`${label} must be a string`);
  }
  const normalized = options.trim ? value.trim() : value;
  if (
    (!options.allowEmpty && normalized.length === 0) || normalized.length > maxLength ||
    containsUnsafeStringCharacter(normalized)
  ) {
    invalidArgument(`${label} is outside the supported range`);
  }
  return normalized;
}

function parseResponseString(
  value: unknown,
  label: string,
  maxLength = MAX_SANDBOX_IDENTIFIER_LENGTH,
  options: { nullable?: boolean; allowEmpty?: boolean } = {},
): string | null {
  if (value === null && options.nullable) return null;
  if (
    typeof value !== "string" || (!options.allowEmpty && value.length === 0) ||
    value.length > maxLength || containsUnsafeStringCharacter(value)
  ) {
    invalidResponse(`Sandbox API returned an invalid ${label}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) invalidResponse(`Sandbox API returned an invalid ${label}`);
  return value;
}

/** Normalize a credential-bearing HTTP base URL and remove trailing slashes. */
export function normalizeSandboxBaseUrl(value: unknown, label: string): string {
  const raw = normalizeBoundedString(value, label, MAX_URL_LENGTH, { trim: true });
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    invalidArgument(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    invalidArgument(`${label} must use HTTP or HTTPS`);
  }
  if (parsed.username || parsed.password) {
    invalidArgument(`${label} must not include credentials`);
  }
  if (parsed.search || parsed.hash) {
    invalidArgument(`${label} must not include a query string or fragment`);
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname === "/" ? "" : pathname}`;
}

/** Normalize a bearer token before placing it in an HTTP header. */
export function normalizeSandboxAuthToken(value: unknown): string {
  const token = normalizeBoundedString(value, "Sandbox auth token", MAX_AUTH_TOKEN_LENGTH, {
    trim: true,
  });
  if (/\r|\n/.test(token)) invalidArgument("Sandbox auth token must not contain line breaks");
  return token;
}

/** Normalize an optional project identity. */
export function normalizeSandboxProjectId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return normalizeBoundedString(value, "Sandbox project ID", MAX_SANDBOX_IDENTIFIER_LENGTH, {
    trim: true,
  });
}

/** Normalize a session or command identifier supplied by a caller. */
export function normalizeSandboxIdentifier(value: unknown, label: string): string {
  return normalizeBoundedString(value, label, MAX_SANDBOX_IDENTIFIER_LENGTH, { trim: true });
}

/** Validate one finite configuration number with explicit bounds. */
export function normalizeSandboxNumber(
  value: unknown,
  fallback: number,
  label: string,
  options: { min: number; max: number; integer?: boolean },
): number {
  const resolved = value ?? fallback;
  if (
    typeof resolved !== "number" || !Number.isFinite(resolved) || resolved < options.min ||
    resolved > options.max || (options.integer && !Number.isSafeInteger(resolved))
  ) {
    invalidArgument(`${label} must be within the supported range`);
  }
  return resolved;
}

/** Return a detached, validated command request payload. */
export function normalizeExecRequest(
  command: unknown,
  options?: ExecOptions,
): { command: string } & ExecOptions {
  const normalizedCommand = normalizeBoundedString(
    command,
    "Sandbox command",
    MAX_SANDBOX_COMMAND_LENGTH,
  );
  if (options === undefined) return { command: normalizedCommand };
  if (!isRecord(options)) invalidArgument("Sandbox exec options must be an object");

  const normalized: { command: string } & ExecOptions = { command: normalizedCommand };
  if (options.cwd !== undefined) {
    normalized.cwd = normalizeBoundedString(
      options.cwd,
      "Sandbox working directory",
      MAX_PATH_LENGTH,
    );
  }
  if (options.timeout_seconds !== undefined) {
    normalized.timeout_seconds = normalizeSandboxNumber(
      options.timeout_seconds,
      0,
      "Sandbox command timeout",
      { min: Number.MIN_VALUE, max: MAX_EXEC_TIMEOUT_SECONDS },
    );
  }
  if (options.projectReference !== undefined) {
    normalized.projectReference = normalizeBoundedString(
      options.projectReference,
      "Sandbox project reference",
      MAX_SANDBOX_IDENTIFIER_LENGTH,
      { trim: true },
    );
  }
  if (options.env !== undefined) {
    if (!isRecord(options.env)) invalidArgument("Sandbox environment must be an object");
    const entries = Object.entries(options.env);
    if (entries.length > MAX_ENV_ENTRIES) {
      invalidArgument("Sandbox environment exceeds the supported entry count");
    }
    const env: Record<string, string> = Object.create(null);
    for (const [key, value] of entries) {
      if (key.includes("=")) invalidArgument("Sandbox environment names must not contain equals");
      const normalizedKey = normalizeBoundedString(
        key,
        "Sandbox environment name",
        MAX_ENV_KEY_LENGTH,
      );
      env[normalizedKey] = normalizeBoundedString(
        value,
        `Sandbox environment value for ${normalizedKey}`,
        MAX_ENV_VALUE_LENGTH,
        { allowEmpty: true },
      );
    }
    normalized.env = env;
  }
  return normalized;
}

export function normalizeSandboxReadPath(path: unknown): string {
  return normalizeBoundedString(path, "Sandbox file path", MAX_PATH_LENGTH);
}

export function normalizeSandboxWriteFiles(
  files: unknown,
): Array<{ path: string; content: string }> {
  if (!Array.isArray(files) || files.length > MAX_FILES_PER_WRITE) {
    invalidArgument("Sandbox files exceed the supported entry count");
  }
  let totalBytes = 0;
  const encoder = new TextEncoder();
  return files.map((file) => {
    if (!isRecord(file)) invalidArgument("Sandbox file entry must be an object");
    const path = normalizeSandboxReadPath(file.path);
    const content = normalizeBoundedString(
      file.content,
      `Sandbox file content for ${path}`,
      MAX_FILE_CONTENT_BYTES,
      { allowEmpty: true },
    );
    totalBytes += encoder.encode(content).byteLength;
    if (totalBytes > MAX_FILE_CONTENT_BYTES) {
      invalidArgument("Sandbox file content exceeds the supported size");
    }
    return { path, content };
  });
}

export function normalizeSandboxListOptions(
  options: SandboxListOptions,
): { cursor?: string; limit?: number } {
  if (!isRecord(options)) invalidArgument("Sandbox list options must be an object");
  const result: { cursor?: string; limit?: number } = {};
  if (options.cursor !== undefined) {
    result.cursor = normalizeBoundedString(
      options.cursor,
      "Sandbox list cursor",
      MAX_LIST_CURSOR_LENGTH,
    );
  }
  if (options.limit !== undefined) {
    result.limit = normalizeSandboxNumber(options.limit, 0, "Sandbox list limit", {
      min: 1,
      max: MAX_LIST_LIMIT,
      integer: true,
    });
  }
  return result;
}

export function sandboxClosedError(): Error {
  return INITIALIZATION_ERROR.create({ detail: "Sandbox is closed" });
}

/** Best-effort response disposal that never masks the caller's authoritative result. */
export async function discardSandboxResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Response disposal is best effort and must not replace a validation or request error.
  }
}

export async function throwSandboxResponseError(
  operation: string,
  response: Response,
): Promise<never> {
  await discardSandboxResponse(response);
  throw REQUEST_ERROR.create({ detail: `${operation}: HTTP ${response.status}` });
}

async function readResponseTextWithLimit(
  response: Response,
  label: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes) {
      await discardSandboxResponse(response);
      invalidResponse(`${label} exceeds the supported size`);
    }
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  const chunks: string[] = [];
  let completed = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = timeoutMs > 0
    ? new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new SandboxTransportError("timeout", undefined)),
        timeoutMs,
      );
    })
    : undefined;
  try {
    while (true) {
      const { done, value } =
        await (timeoutPromise ? Promise.race([reader.read(), timeoutPromise]) : reader.read());
      if (done) {
        completed = true;
        break;
      }
      received += value.byteLength;
      if (received > maxBytes) invalidResponse(`${label} exceeds the supported size`);
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    if (error instanceof VeryfrontError || error instanceof SandboxTransportError) throw error;
    return invalidResponse(`${label} could not be read`);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (!completed) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the authoritative parse or size error.
      }
    }
    reader.releaseLock();
  }
}

export async function readSandboxText(
  response: Response,
  label: string,
  timeoutMs = DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS,
): Promise<string> {
  return await readResponseTextWithLimit(response, label, MAX_TEXT_RESPONSE_BYTES, timeoutMs);
}

export async function readSandboxJson(
  response: Response,
  label: string,
  timeoutMs = DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const text = await readResponseTextWithLimit(response, label, MAX_JSON_RESPONSE_BYTES, timeoutMs);
  try {
    return JSON.parse(text);
  } catch {
    invalidResponse(`${label} returned invalid JSON`);
  }
}

function parseRuntimeEndpoint(value: unknown, label: string): string {
  try {
    return normalizeSandboxBaseUrl(value, label);
  } catch {
    invalidResponse(`Sandbox API returned an invalid ${label}`);
  }
}

export interface SandboxSessionRecord {
  id: string;
  endpoint: string;
  status: string;
}

/** Parse the resource identity from a sandbox creation response. */
export function parseSandboxSessionId(value: unknown): string {
  const record = asRecord(value, "sandbox session");
  return parseResponseString(record.id, "sandbox session ID")!;
}

export function parseSandboxSession(
  value: unknown,
  fallback: Partial<SandboxSessionRecord> = {},
): SandboxSessionRecord {
  const record = asRecord(value, "sandbox session");
  const id = parseResponseString(
    record.id === undefined ? fallback.id : record.id,
    "sandbox session ID",
  )!;
  if (fallback.id !== undefined && record.id !== undefined && id !== fallback.id) {
    invalidResponse("Sandbox API returned a mismatched sandbox session ID");
  }
  const endpoint = parseRuntimeEndpoint(
    record.endpoint === undefined ? fallback.endpoint : record.endpoint,
    "sandbox session endpoint",
  );
  const status = parseResponseString(
    record.status === undefined ? fallback.status : record.status,
    "sandbox session status",
    MAX_STATUS_LENGTH,
  )!;
  return { id, endpoint, status };
}

export function parseSandboxStatus(value: unknown): string {
  const record = asRecord(value, "sandbox session");
  return parseResponseString(record.status, "sandbox session status", MAX_STATUS_LENGTH)!;
}

function parseNullablePageLink(value: unknown, label: string): string | null {
  return parseResponseString(value, label, MAX_LIST_CURSOR_LENGTH, { nullable: true });
}

function parseSandboxSessionSummary(value: unknown): SandboxSession {
  const record = asRecord(value, "sandbox session summary");
  return {
    id: parseResponseString(record.id, "sandbox session ID")!,
    shortId: parseResponseString(record.short_id, "sandbox short ID")!,
    endpoint: parseRuntimeEndpoint(record.endpoint, "sandbox session endpoint"),
    status: parseResponseString(record.status, "sandbox session status", MAX_STATUS_LENGTH)!,
    createdAt: parseResponseString(record.created_at, "sandbox creation timestamp")!,
  };
}

export function parseSandboxList(value: unknown): SandboxListResult {
  const record = asRecord(value, "sandbox list response");
  if (!Array.isArray(record.data) || record.data.length > MAX_LIST_LIMIT) {
    invalidResponse("Sandbox API returned an invalid sandbox list");
  }
  const pageInfo = record.page_info === undefined
    ? {}
    : asRecord(record.page_info, "sandbox page information");
  return {
    data: record.data.map(parseSandboxSessionSummary),
    pageInfo: {
      self: parseNullablePageLink(pageInfo.self ?? null, "sandbox self page link"),
      first: null,
      next: parseNullablePageLink(pageInfo.next ?? null, "sandbox next page link"),
      prev: parseNullablePageLink(pageInfo.prev ?? null, "sandbox previous page link"),
    },
  };
}

function parseNullableInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    invalidResponse(`Sandbox API returned an invalid ${label}`);
  }
  return value;
}

function parseResponseBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalidResponse(`Sandbox API returned an invalid ${label}`);
  return value;
}

export function parseBackgroundCommand(value: unknown): BackgroundCommand {
  const record = asRecord(value, "background command");
  const status = parseResponseString(
    record.status,
    "background command status",
    MAX_STATUS_LENGTH,
  )!;
  const heartbeatStatus = parseResponseString(
    record.heartbeat_status,
    "background command heartbeat status",
    MAX_STATUS_LENGTH,
  )!;
  if (!BACKGROUND_COMMAND_STATUSES.has(status)) {
    invalidResponse("Sandbox API returned an invalid background command status");
  }
  if (!BACKGROUND_HEARTBEAT_STATUSES.has(heartbeatStatus)) {
    invalidResponse("Sandbox API returned an invalid background command heartbeat status");
  }
  const heartbeatFailureCount = record.heartbeat_failure_count;
  if (
    typeof heartbeatFailureCount !== "number" || !Number.isSafeInteger(heartbeatFailureCount) ||
    heartbeatFailureCount < 0
  ) {
    invalidResponse("Sandbox API returned an invalid heartbeat failure count");
  }
  return {
    id: parseResponseString(record.id, "background command ID")!,
    status: status as BackgroundCommand["status"],
    exitCode: parseNullableInteger(record.exit_code, "background command exit code"),
    signal: parseResponseString(record.signal, "background command signal", MAX_STATUS_LENGTH, {
      nullable: true,
    }),
    startedAt: parseResponseString(record.started_at, "background command start timestamp")!,
    finishedAt: parseResponseString(
      record.finished_at,
      "background command finish timestamp",
      MAX_SANDBOX_IDENTIFIER_LENGTH,
      { nullable: true },
    ),
    heartbeatStatus: heartbeatStatus as BackgroundCommand["heartbeatStatus"],
    lastHeartbeatAt: parseResponseString(
      record.last_heartbeat_at,
      "background command heartbeat timestamp",
      MAX_SANDBOX_IDENTIFIER_LENGTH,
      { nullable: true },
    ),
    lastHeartbeatError: parseResponseString(
      record.last_heartbeat_error,
      "background command heartbeat error",
      MAX_ENV_VALUE_LENGTH,
      { nullable: true },
    ),
    heartbeatFailureCount,
  };
}

export function parseBackgroundCommandOutput(value: unknown): BackgroundCommandOutput {
  const record = asRecord(value, "background command output");
  return {
    ...parseBackgroundCommand(record),
    stdout: parseResponseString(
      record.stdout,
      "background command stdout",
      MAX_FILE_CONTENT_BYTES,
      {
        allowEmpty: true,
      },
    )!,
    stderr: parseResponseString(
      record.stderr,
      "background command stderr",
      MAX_FILE_CONTENT_BYTES,
      {
        allowEmpty: true,
      },
    )!,
    stdoutTruncated: parseResponseBoolean(record.stdout_truncated, "stdout truncation flag"),
    stderrTruncated: parseResponseBoolean(record.stderr_truncated, "stderr truncation flag"),
  };
}

export function parseBackgroundCommandList(value: unknown): BackgroundCommand[] {
  const commands = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.commands)
    ? value.commands
    : undefined;
  if (!commands || commands.length > MAX_BACKGROUND_COMMANDS) {
    invalidResponse("Sandbox API returned an invalid background command list");
  }
  return commands.map(parseBackgroundCommand);
}

function parseExecStreamEvent(value: unknown): ExecStreamEvent {
  if (!isRecord(value)) invalidResponse("Sandbox API returned an invalid execution event");
  const type = value.type;
  if (type !== "stdout" && type !== "stderr" && type !== "exit" && type !== "error") {
    invalidResponse("Sandbox API returned an invalid execution event type");
  }
  if (value.data !== undefined && typeof value.data !== "string") {
    invalidResponse("Sandbox API returned an invalid execution event data field");
  }
  if (
    value.exitCode !== undefined &&
    (typeof value.exitCode !== "number" || !Number.isSafeInteger(value.exitCode))
  ) {
    invalidResponse("Sandbox API returned an invalid execution event exit code");
  }
  return {
    type,
    data: value.data,
    exitCode: value.exitCode,
  };
}

function parseExecLine(line: string): ExecStreamEvent | undefined {
  if (!line.trim()) return undefined;
  if (line.length > MAX_EXEC_EVENT_LINE_LENGTH) {
    invalidResponse("Sandbox execution event exceeds the supported size");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    invalidResponse("Sandbox execution stream contains invalid NDJSON");
  }
  return parseExecStreamEvent(parsed);
}

interface ExecLineAccumulator {
  fragments: string[];
  length: number;
}

function appendExecLineFragment(state: ExecLineAccumulator, fragment: string): void {
  state.length += fragment.length;
  if (state.length > MAX_EXEC_EVENT_LINE_LENGTH) {
    invalidResponse("Sandbox execution event exceeds the supported size");
  }
  if (fragment.length > 0) state.fragments.push(fragment);
}

function takeExecLine(state: ExecLineAccumulator): string {
  const line = state.fragments.length === 1 ? state.fragments[0]! : state.fragments.join("");
  state.fragments = [];
  state.length = 0;
  return line;
}

function* appendExecDecodedChunk(
  state: ExecLineAccumulator,
  chunk: string,
): Generator<string> {
  let start = 0;
  let newlineIndex: number;
  while ((newlineIndex = chunk.indexOf("\n", start)) !== -1) {
    appendExecLineFragment(state, chunk.slice(start, newlineIndex));
    yield takeExecLine(state);
    start = newlineIndex + 1;
  }
  appendExecLineFragment(state, chunk.slice(start));
}

/** Decode, validate, and resource-bound a sandbox NDJSON execution stream. */
export async function* parseExecStream(response: Response): AsyncGenerator<ExecStreamEvent> {
  if (!response.body) invalidResponse("Sandbox execution response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const lineState: ExecLineAccumulator = { fragments: [], length: 0 };
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      for (
        const line of appendExecDecodedChunk(
          lineState,
          decoder.decode(value, { stream: true }),
        )
      ) {
        const event = parseExecLine(line);
        if (event) yield event;
      }
    }
    for (const line of appendExecDecodedChunk(lineState, decoder.decode())) {
      const event = parseExecLine(line);
      if (event) yield event;
    }
    const finalEvent = parseExecLine(takeExecLine(lineState));
    if (finalEvent) yield finalEvent;
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    invalidResponse("Sandbox execution stream could not be decoded");
  } finally {
    if (!completed) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the authoritative stream validation error.
      }
    }
    reader.releaseLock();
  }
}

/** Collect a validated stream while bounding buffered stdout and stderr. */
export async function collectExecResult(
  events: AsyncIterable<ExecStreamEvent>,
): Promise<ExecResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = 1;
  let outputBytes = 0;
  const encoder = new TextEncoder();
  for await (const event of events) {
    if (event.type === "stdout" || event.type === "stderr" || event.type === "error") {
      const data = event.data ?? "";
      outputBytes += encoder.encode(data).byteLength;
      if (outputBytes > MAX_BUFFERED_EXEC_OUTPUT_BYTES) {
        invalidResponse("Sandbox command output exceeds the supported size");
      }
      if (event.type === "stdout") stdout.push(data);
      else stderr.push(data);
    }
    if (event.type === "exit") exitCode = event.exitCode ?? 1;
  }
  return { stdout: stdout.join(""), stderr: stderr.join(""), exitCode };
}

export class SandboxTransportError extends Error {
  readonly kind: "network" | "timeout";
  readonly code: string | undefined;

  constructor(kind: "network" | "timeout", cause: unknown) {
    super(kind === "timeout" ? "Sandbox request timed out" : "Sandbox request failed");
    this.name = "SandboxTransportError";
    this.kind = kind;
    const causeRecord = isRecord(cause) && isRecord(cause.cause) ? cause.cause : undefined;
    this.code = typeof causeRecord?.code === "string" ? causeRecord.code : undefined;
  }
}

/** Fetch with a bounded start/control timeout and stable transport classification. */
export async function fetchSandbox(
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  const controller = timeoutMs > 0 ? new AbortController() : undefined;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    return await fetch(url, controller ? { ...init, signal: controller.signal } : init);
  } catch (error) {
    if (controller?.signal.aborted) throw new SandboxTransportError("timeout", error);
    if (error instanceof TypeError) throw new SandboxTransportError("network", error);
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
