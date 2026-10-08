import { REQUEST_ERROR } from "#veryfront/errors";
import type {
  BackgroundCommand,
  BackgroundCommandOutput,
  CommandResult,
  SandboxCapabilities,
  SandboxDetails,
  SandboxEnvironment,
  SandboxFileEntry,
  SandboxFileListResult,
  SandboxRuntimeCheck,
  SandboxStatus,
} from "./types.ts";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw REQUEST_ERROR.create({ detail: "Invalid sandbox response" });
  }
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") {
    throw REQUEST_ERROR.create({ detail: "Invalid sandbox string field" });
  }
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

/** @internal Decode control-plane metadata without exposing transport credentials. */
export function parseSandboxDetails(value: unknown): SandboxDetails {
  const input = record(value);
  const access = input.access_scope;
  const storage = input.workspace_storage;
  const lifetime = input.ttl_mode;
  if (
    (access !== "project" && access !== "private") ||
    (storage !== "ephemeral" && storage !== "persistent") ||
    (lifetime !== "default" && lifetime !== "duration" && lifetime !== "always_on")
  ) {
    throw REQUEST_ERROR.create({ detail: "Invalid sandbox policy metadata" });
  }
  const hours = input.ttl_hours;
  if (
    hours !== undefined && hours !== null &&
    (typeof hours !== "number" || !Number.isInteger(hours) || hours <= 0)
  ) {
    throw REQUEST_ERROR.create({ detail: "Invalid sandbox duration" });
  }
  return {
    id: text(input.id),
    shortId: text(input.short_id),
    endpoint: text(input.endpoint),
    status: sandboxStatus(input.status),
    createdAt: text(input.created_at),
    projectId: nullableText(input.project_id),
    accessScope: access,
    workspaceStorage: storage,
    ttlMode: lifetime,
    ttlHours: typeof hours === "number" ? hours : null,
    expiresAt: nullableText(input.expires_at),
    lastActivityAt: nullableText(input.last_activity_at),
  };
}

/** @internal Validate per-file outcomes so successful HTTP cannot hide failed writes. */
export function assertSandboxFilesWritten(value: unknown, expectedPaths: readonly string[]): void {
  const input = record(value);
  if (!Array.isArray(input.results)) {
    throw REQUEST_ERROR.create({ detail: "Invalid sandbox write response" });
  }
  if (input.results.length !== expectedPaths.length) {
    throw REQUEST_ERROR.create({ detail: "Incomplete sandbox write outcomes" });
  }
  const remaining = new Map<string, number>();
  for (const path of expectedPaths) remaining.set(path, (remaining.get(path) ?? 0) + 1);
  for (const item of input.results) {
    const result = record(item);
    const path = text(result.path);
    const count = remaining.get(path) ?? 0;
    if (count === 0) {
      throw REQUEST_ERROR.create({ detail: "Invalid sandbox write outcome path" });
    }
    if (count === 1) remaining.delete(path);
    else remaining.set(path, count - 1);
    if (result.status === "failed") {
      throw REQUEST_ERROR.create({ detail: `Sandbox file write failed: ${path}` });
    }
    if (result.status !== "written" || result.error !== null) {
      throw REQUEST_ERROR.create({ detail: "Invalid sandbox write outcome" });
    }
  }
}

/** @internal Read canonical command collections without silently dropping later pages. */
export async function readSandboxCommandPages(
  fetchPage: (cursor?: string) => Promise<unknown>,
): Promise<Record<string, unknown>[]> {
  const commands: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const value = await fetchPage(cursor);
    if (Array.isArray(value)) {
      throw REQUEST_ERROR.create({ detail: "Invalid sandbox command collection" });
    }
    const page = record(value);
    if (!Array.isArray(page.data)) {
      throw REQUEST_ERROR.create({ detail: "Invalid sandbox command collection" });
    }
    commands.push(...page.data.map(record));
    const info = record(page.page_info);
    if (info.next === null) return commands;
    const next = text(info.next);
    if (seen.has(next)) {
      throw REQUEST_ERROR.create({ detail: "Repeated sandbox pagination cursor" });
    }
    seen.add(next);
    cursor = next;
  }
}

function sandboxStatus(value: unknown): SandboxStatus {
  if (
    value === "pending" || value === "provisioning" || value === "running" || value === "error" ||
    value === "deleting"
  ) return value;
  throw REQUEST_ERROR.create({ detail: "Invalid sandbox status" });
}
function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw REQUEST_ERROR.create({ detail: "Invalid sandbox limit" });
  }
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw REQUEST_ERROR.create({ detail: "Invalid sandbox capability" });
  }
  return value;
}

/** @internal Decode a health or readiness result. */
export function parseSandboxRuntimeCheck(value: unknown): SandboxRuntimeCheck {
  const input = record(value);
  if (
    typeof input.ok !== "boolean" || !(input.reason === null || typeof input.reason === "string")
  ) throw REQUEST_ERROR.create({ detail: "Invalid sandbox runtime check" });
  return { ok: input.ok, status: sandboxStatus(input.status), reason: input.reason };
}

/** @internal Decode a redacted environment snapshot. */
export function parseSandboxEnvironment(value: unknown): SandboxEnvironment {
  const env = record(record(value).env);
  return {
    env: Object.fromEntries(Object.entries(env).map(([name, value]) => [name, text(value)])),
  };
}

/** @internal Decode filesystem metadata and pagination. */
export function parseSandboxFileList(value: unknown): SandboxFileListResult {
  const input = record(value);
  if (!Array.isArray(input.data)) {
    throw REQUEST_ERROR.create({ detail: "Invalid sandbox directory listing" });
  }
  const data = input.data.map((value): SandboxFileEntry => {
    const entry = record(value);
    const type = entry.type;
    if (type !== "file" && type !== "directory" && type !== "symlink" && type !== "other") {
      throw REQUEST_ERROR.create({ detail: "Invalid sandbox file type" });
    }
    const size = entry.size_bytes;
    if (size !== null && (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)) {
      throw REQUEST_ERROR.create({ detail: "Invalid sandbox file size" });
    }
    return { path: text(entry.path), type, sizeBytes: size };
  });
  const info = record(input.page_info);
  if (info.first !== null) throw REQUEST_ERROR.create({ detail: "Invalid sandbox pagination" });
  return {
    data,
    pageInfo: {
      self: nullableText(info.self),
      first: null,
      next: nullableText(info.next),
      prev: nullableText(info.prev),
    },
  };
}

/** @internal Decode caller capabilities using SDK field names. */
export function parseSandboxCapabilities(value: unknown): SandboxCapabilities {
  const input = record(value);
  const limits = record(input.limits);
  const defaults = record(input.defaults);
  return {
    privateCreation: boolean(input.private_creation),
    privateAlwaysOn: boolean(input.private_always_on),
    codingAgentTerminal: boolean(input.coding_agent_terminal),
    limits: {
      maxTtlHours: positiveInteger(limits.max_ttl_hours),
      maxCommandTimeoutSeconds: positiveInteger(limits.max_command_timeout_seconds),
      maxBackgroundTimeoutSeconds: positiveInteger(limits.max_background_timeout_seconds),
      maxCommandOutputBytes: positiveInteger(limits.max_command_output_bytes),
      maxPageSize: positiveInteger(limits.max_page_size),
      maxFileBytes: positiveInteger(limits.max_file_bytes),
      maxWriteFiles: positiveInteger(limits.max_write_files),
    },
    defaults: {
      commandTimeoutSeconds: positiveInteger(defaults.command_timeout_seconds),
      backgroundTimeoutSeconds: positiveInteger(defaults.background_timeout_seconds),
      pageSize: positiveInteger(defaults.page_size),
    },
  };
}

/** @internal Decode one canonical command snapshot for both client implementations. */
export function parseSandboxBackgroundCommand(value: unknown): BackgroundCommand {
  const input = record(value);
  const status = input.status;
  if (
    status !== "pending" && status !== "running" && status !== "completed" && status !== "failed" &&
    status !== "canceled"
  ) throw REQUEST_ERROR.create({ detail: "Invalid sandbox command status" });
  const heartbeat = input.heartbeat_status;
  if (heartbeat !== "disabled" && heartbeat !== "healthy" && heartbeat !== "degraded") {
    throw REQUEST_ERROR.create({ detail: "Invalid sandbox command heartbeat status" });
  }
  const exit = input.exit_code;
  if (exit !== null && (typeof exit !== "number" || !Number.isSafeInteger(exit))) {
    throw REQUEST_ERROR.create({ detail: "Invalid sandbox command exit code" });
  }
  const failures = input.heartbeat_failure_count;
  if (typeof failures !== "number" || !Number.isSafeInteger(failures) || failures < 0) {
    throw REQUEST_ERROR.create({ detail: "Invalid sandbox heartbeat failure count" });
  }
  return {
    id: text(input.command_id),
    command: text(input.command),
    status,
    exitCode: exit,
    signal: nullableText(input.signal),
    startedAt: nullableText(input.started_at),
    finishedAt: nullableText(input.finished_at),
    heartbeatStatus: heartbeat,
    lastHeartbeatAt: nullableText(input.last_heartbeat_at),
    lastHeartbeatError: nullableText(input.last_heartbeat_error),
    heartbeatFailureCount: failures,
  };
}

/** @internal Translate the direct runtime protocol before applying the shared write checks. */
export function assertSandboxRuntimeFilesWritten(
  value: unknown,
  expectedPaths: readonly string[],
): void {
  const input = record(value);
  if (!Array.isArray(input.results)) {
    throw REQUEST_ERROR.create({ detail: "Invalid sandbox write response" });
  }
  const results = input.results.map((value) => {
    const result = record(value);
    if (typeof result.ok !== "boolean") {
      throw REQUEST_ERROR.create({ detail: "Invalid runtime write outcome" });
    }
    return {
      path: result.path,
      status: result.ok ? "written" : "failed",
      error: result.ok ? null : result.error,
    };
  });
  assertSandboxFilesWritten({ results }, expectedPaths);
}

/** @internal Decode a synchronous command result without guessing its exit code. */
export function parseSandboxCommandResult(value: unknown): CommandResult {
  const input = record(value);
  if (typeof input.exit_code !== "number" || !Number.isSafeInteger(input.exit_code)) {
    throw REQUEST_ERROR.create({ detail: "Invalid sandbox command result" });
  }
  return { stdout: text(input.stdout), stderr: text(input.stderr), exitCode: input.exit_code };
}

/** @internal Decode output without losing truncation reported by a runtime. */
export function parseSandboxBackgroundCommandOutput(value: unknown): BackgroundCommandOutput {
  const input = record(value);
  for (const flag of [input.stdout_truncated, input.stderr_truncated]) {
    if (flag !== undefined && typeof flag !== "boolean") {
      throw REQUEST_ERROR.create({ detail: "Invalid sandbox truncation flag" });
    }
  }
  return {
    ...parseSandboxBackgroundCommand(input),
    stdout: text(input.stdout),
    stderr: text(input.stderr),
    stdoutTruncated: input.stdout_truncated === true,
    stderrTruncated: input.stderr_truncated === true,
  };
}
