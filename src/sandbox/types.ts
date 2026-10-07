/** Options for command execution: working directory, timeout, environment variables. */
export interface CommandOptions {
  /** Working directory for the command. */
  cwd?: string;
  /** Timeout in seconds for the command. */
  timeoutSeconds?: number;
  /** Additional environment variables for the command. */
  env?: Record<string, string>;
}

/** Sandbox access, storage and lifetime policies. */
export type SandboxAccessScope = "project" | "private";
export type SandboxWorkspaceStorage = "ephemeral" | "persistent";
export type SandboxLifetimeMode = "default" | "duration" | "always_on";

export interface SandboxClientOptions {
  /** Base URL of the Veryfront API. Defaults to VERYFRONT_API_URL, then the Veryfront Cloud API. */
  apiUrl?: string;
  /** Explicit Veryfront auth token or API key override. */
  authToken?: string;
}

/** Options for creating a sandbox. */
export interface SandboxOptions extends SandboxClientOptions {
  /** Project UUID or slug used for billing. */
  projectReference?: string;
  /** Project access or creator-only access. Defaults to project. */
  accessScope?: SandboxAccessScope;
  /** Cleanup policy. Defaults to default. */
  ttlMode?: SandboxLifetimeMode;
  /** Required only for duration cleanup. */
  ttlHours?: number;
  /** Environment whose variables are copied once. */
  environmentId?: string;
}

/** Result of a command execution: stdout, stderr, and exit code. */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Streaming event emitted during command execution. */
export interface CommandStreamEvent {
  type: "stdout" | "stderr" | "exit" | "error";
  data?: string;
  exitCode?: number;
}

/** Status of an async background command. */
export type BackgroundCommandStatus = "pending" | "running" | "completed" | "failed" | "canceled";

/** Heartbeat health status for a background command. */
export type BackgroundCommandHeartbeatStatus = "disabled" | "healthy" | "degraded";

/** An async background command running in a sandbox. */
export interface BackgroundCommand {
  id: string;
  /** Shell command text. */
  command: string;
  status: BackgroundCommandStatus;
  exitCode: number | null;
  signal: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatStatus: BackgroundCommandHeartbeatStatus;
  lastHeartbeatAt: string | null;
  lastHeartbeatError: string | null;
  heartbeatFailureCount: number;
}

/** A background command with its captured output. */
export interface BackgroundCommandOutput extends BackgroundCommand {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

/** A sandbox summary returned by list. */
export interface SandboxDetails {
  id: string;
  shortId: string;
  endpoint: string;
  status: SandboxStatus;
  createdAt: string;
  projectId: string | null;
  accessScope: SandboxAccessScope;
  workspaceStorage: SandboxWorkspaceStorage;
  ttlMode: SandboxLifetimeMode;
  ttlHours: number | null;
  expiresAt: string | null;
  lastActivityAt: string | null;
}

/** Options for listing sandboxes. */
export interface SandboxListOptions extends SandboxClientOptions {
  /** Project UUID or slug. Omit to list your private sandboxes. */
  projectReference?: string;
  /** Limit results to project or private access. */
  accessScope?: SandboxAccessScope;
  cursor?: string;
  limit?: number;
  sortBy?: "created_at" | "status";
  sortOrder?: "asc" | "desc";
}

/** Paginated result of sandboxes. */
export interface SandboxListResult {
  data: SandboxDetails[];
  pageInfo: {
    self: string | null;
    first: null;
    next: string | null;
    prev: string | null;
  };
}

/** Known sandbox connection details used to attach without a lookup round-trip. */
export interface SandboxAttachment extends SandboxClientOptions {
  id: string;
  endpoint: string;
}

/** Observed sandbox runtime state. */
export type SandboxStatus = "pending" | "provisioning" | "running" | "error" | "deleting";

/** Runtime health or readiness result. A false check is a result, not a transport error. */
export interface SandboxRuntimeCheck {
  /** Whether the requested check passed. */
  ok: boolean;
  /** Observed runtime state. */
  status: SandboxStatus;
  /** Explanation when available. */
  reason: string | null;
}

/** Sandbox cleanup policy. Duration requires hours; other policies accept no duration. */
export type SandboxLifetimeInput =
  | { ttlMode: "duration"; ttlHours: number }
  | { ttlMode: "default" | "always_on"; ttlHours?: never };

/** Directory listing options. */
export interface SandboxFileListOptions {
  /** Directory path. Defaults to /workspace. */
  path?: string;
  /** Opaque continuation cursor from the previous page. */
  cursor?: string;
  /** Maximum entries per page. Defaults to the API default. */
  limit?: number;
}

/** Directory entry metadata, without file contents. */
export interface SandboxFileEntry {
  /** Entry path. */
  path: string;
  /** Filesystem entry kind. */
  type: "file" | "directory" | "symlink" | "other";
  /** File size, or null for directories. */
  sizeBytes: number | null;
}

/** One directory page. Follow pageInfo.next to request another page. */
export interface SandboxFileListResult {
  /** Entries in this page. */
  data: SandboxFileEntry[];
  /** Pagination cursors. */
  pageInfo: SandboxListResult["pageInfo"];
}

/** Snapshot of environment variable names with redacted values. */
export interface SandboxEnvironment {
  /** Values are redacted by the API. */
  env: Record<string, string>;
}

/** Sandbox creation capabilities, limits and defaults for the current caller. */
export interface SandboxCapabilities {
  /** Private sandboxes are enabled. */
  privateCreation: boolean;
  /** Private always-on workspaces are enabled. */
  privateAlwaysOn: boolean;
  /** Coding agents can use the sandbox terminal. */
  codingAgentTerminal: boolean;
  /** Enforced API limits. */
  limits: {
    /** Maximum duration in hours. */
    maxTtlHours: number;
    /** Maximum synchronous command timeout. */
    maxCommandTimeoutSeconds: number;
    /** Maximum background command timeout. */
    maxBackgroundTimeoutSeconds: number;
    /** Maximum captured command output size. */
    maxCommandOutputBytes: number;
    /** Maximum entries per page. */
    maxPageSize: number;
    /** Maximum UTF-8 file size. */
    maxFileBytes: number;
    /** Maximum files in a write batch. */
    maxWriteFiles: number;
  };
  /** API defaults when an option is omitted. */
  defaults: {
    /** Synchronous command timeout. */
    commandTimeoutSeconds: number;
    /** Background command timeout. */
    backgroundTimeoutSeconds: number;
    /** Entries per page. */
    pageSize: number;
  };
}
