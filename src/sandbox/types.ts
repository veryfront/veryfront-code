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
  /** Base URL of the Veryfront API. Defaults to VERYFRONT_API_URL and is otherwise required. */
  apiUrl?: string;
  /** Veryfront auth token or API key. Defaults to request-scoped or host credentials. */
  authToken?: string;
  /** Optional project context for project-billed / project-scoped sandbox sessions. */
  projectId?: string;
}

/** Result of a command execution: stdout, stderr, and exit code. */
export interface ExecResult {
  /** Text written to standard output. */
  stdout: string;
  /** Text written to standard error, including execution error events. */
  stderr: string;
  /** Process exit code, or 1 when the stream did not report one. */
  exitCode: number;
}

/** Streaming event emitted during command execution. */
export interface ExecStreamEvent {
  /** Event kind. */
  type: "stdout" | "stderr" | "exit" | "error";
  /** Text associated with an output or error event. */
  data?: string;
  /** Process exit code associated with an exit event. */
  exitCode?: number;
}

/** Status of an async background command. */
export type BackgroundCommandStatus = "running" | "completed" | "failed" | "canceled";

/** Heartbeat health status for a background command. */
export type BackgroundCommandHeartbeatStatus = "disabled" | "healthy" | "degraded";

/** An async background command running in a sandbox. */
export interface BackgroundCommand {
  /** Stable command identifier. */
  id: string;
  /** Current command lifecycle status. */
  status: BackgroundCommandStatus;
  /** Process exit code after completion, when available. */
  exitCode: number | null;
  /** Signal that terminated the process, when available. */
  signal: string | null;
  /** Command start timestamp. */
  startedAt: string;
  /** Command completion timestamp. */
  finishedAt: string | null;
  /** Health of the command-owned heartbeat. */
  heartbeatStatus: BackgroundCommandHeartbeatStatus;
  /** Most recent successful command heartbeat timestamp. */
  lastHeartbeatAt: string | null;
  /** Most recent command heartbeat error. */
  lastHeartbeatError: string | null;
  /** Number of consecutive command heartbeat failures. */
  heartbeatFailureCount: number;
}

/** A background command with its captured output. */
export interface BackgroundCommandOutput extends BackgroundCommand {
  /** Captured standard output. */
  stdout: string;
  /** Captured standard error. */
  stderr: string;
  /** Whether standard output exceeded server capture limits. */
  stdoutTruncated: boolean;
  /** Whether standard error exceeded server capture limits. */
  stderrTruncated: boolean;
}

/** A sandbox session summary returned by list. */
export interface SandboxSession {
  /** Stable session identifier. */
  id: string;
  /** Short session identifier used by runtime infrastructure. */
  shortId: string;
  /** Runtime endpoint URL. */
  endpoint: string;
  /** Current session lifecycle status. */
  status: string;
  /** Session creation timestamp. */
  createdAt: string;
}

/** Options for listing sandbox sessions. */
export interface SandboxListOptions extends SandboxOptions {
  /** Opaque pagination cursor. */
  cursor?: string;
  /** Maximum number of sessions to return. */
  limit?: number;
}

/** Paginated result of sandbox sessions. */
export interface SandboxListResult {
  /** Sessions in the current page. */
  data: SandboxSession[];
  /** Navigation links for the current page. */
  pageInfo: {
    self: string | null;
    first: null;
    next: string | null;
    prev: string | null;
  };
}

/** Known sandbox session connection details used to attach without a lookup round-trip. */
export interface SandboxAttachment extends SandboxOptions {
  /** Stable session identifier. */
  id: string;
  /** Known runtime endpoint URL. */
  endpoint: string;
}
