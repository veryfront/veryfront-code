/** Options for command execution: working directory, timeout, environment variables, and optional project reference. */
export interface ExecOptions {
  /** Working directory for the command. */
  cwd?: string;
  /** Timeout in seconds for the command. */
  timeout_seconds?: number;
  /** Additional environment variables for the command. */
  env?: Record<string, string>;
  /** Optional project reference forwarded to sandbox command surfaces that support project-scoped execution. */
  projectReference?: string;
}

/** Options for creating a sandbox session. */
export interface SandboxOptions {
  /** Base URL of the Veryfront API. Defaults to VERYFRONT_API_URL, then the Veryfront Cloud API. */
  apiUrl?: string;
  /** Explicit Veryfront auth token or API key override. */
  authToken?: string;
  /** Optional project context for project-billed / project-scoped sandbox sessions. */
  projectId?: string;
}

/** Result of a command execution: stdout, stderr, and exit code. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Streaming event emitted during command execution. */
export interface ExecStreamEvent {
  type: "stdout" | "stderr" | "exit" | "error";
  data?: string;
  exitCode?: number;
}

/** Status of an async command job. */
export type CommandJobStatus = "running" | "completed" | "failed" | "canceled";

/** Heartbeat health status for a command job. */
export type CommandJobHeartbeatStatus = "disabled" | "healthy" | "degraded";

/** An async command job running in a sandbox. */
export interface CommandJob {
  id: string;
  status: CommandJobStatus;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  finishedAt: string | null;
  heartbeatStatus: CommandJobHeartbeatStatus;
  lastHeartbeatAt: string | null;
  lastHeartbeatError: string | null;
  heartbeatFailureCount: number;
}

/** A command job with its captured output. */
export interface CommandJobOutput extends CommandJob {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

/** A sandbox session summary returned by list. */
export interface SandboxSession {
  id: string;
  shortId: string;
  endpoint: string;
  status: string;
  createdAt: string;
}

/** Options for listing sandbox sessions. */
export interface SandboxListOptions extends SandboxOptions {
  cursor?: string;
  limit?: number;
}

/** Paginated result of sandbox sessions. */
export interface SandboxListResult {
  data: SandboxSession[];
  pageInfo: {
    self: string | null;
    first: null;
    next: string | null;
    prev: string | null;
  };
}

/** Known sandbox session connection details used to attach without a lookup round-trip. */
export interface SandboxAttachment extends SandboxOptions {
  id: string;
  endpoint: string;
}
