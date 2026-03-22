/**
 * Sandbox client SDK for ephemeral compute environments.
 *
 * Implements the bash-tool Sandbox interface for seamless integration
 * with AI agent tool loops.
 *
 * @module
 */

import {
  createError,
  INITIALIZATION_ERROR,
  REQUEST_ERROR,
  TIMEOUT_ERROR,
  toError,
} from "#veryfront/errors";
import { getVeryfrontCloudAuthToken } from "#veryfront/platform/cloud/resolver.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

/** Options for command execution: working directory, timeout, and environment variables. */
export interface ExecOptions {
  /** Working directory for the command. */
  cwd?: string;
  /** Timeout in seconds for the command. */
  timeout_seconds?: number;
  /** Additional environment variables for the command. */
  env?: Record<string, string>;
}

/** Options for creating a sandbox session. */
export interface SandboxOptions {
  /** Base URL of the Veryfront API. Defaults to VERYFRONT_API_URL env. */
  apiUrl?: string;
  /** Explicit Veryfront auth token or API key override. */
  authToken?: string;
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

/** Client for isolated ephemeral compute environments with command execution and file I/O. */
export class Sandbox {
  private constructor(
    private endpoint: string,
    private sessionId: string,
    private authToken: string,
    private apiUrl: string,
  ) {}

  private static resolveApiUrl(options: SandboxOptions = {}): string {
    return options.apiUrl ||
      getHostEnv("VERYFRONT_API_URL") ||
      "https://api.veryfront.com";
  }

  private static resolveAuthToken(options: SandboxOptions = {}): string {
    const authToken = options.authToken?.trim() || getVeryfrontCloudAuthToken();
    if (authToken) return authToken;

    throw toError(
      createError({
        type: "config",
        message:
          "Sandbox auth not configured. Set VERYFRONT_API_TOKEN, provide request-scoped Veryfront credentials, or pass authToken explicitly.",
      }),
    );
  }

  /** Create a new sandbox session. Claims a warm pod or creates a new one. */
  static async create(options: SandboxOptions = {}): Promise<Sandbox> {
    const apiUrl = Sandbox.resolveApiUrl(options);
    const authToken = Sandbox.resolveAuthToken(options);

    const res = await fetch(`${apiUrl}/sandbox-sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Failed to create sandbox: ${res.status} ${await res.text()}`,
      });
    }

    const { id, endpoint, status } = await res.json();

    // If not yet running, poll until ready
    if (status !== "running") {
      await Sandbox.waitForReady(apiUrl, id, authToken);
    }

    return new Sandbox(endpoint, id, authToken, apiUrl);
  }

  /** Reconnect to an existing sandbox session. */
  static async get(id: string, options: SandboxOptions = {}): Promise<Sandbox> {
    const apiUrl = Sandbox.resolveApiUrl(options);
    const authToken = Sandbox.resolveAuthToken(options);

    const res = await fetch(`${apiUrl}/sandbox-sessions/${id}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Failed to get sandbox: ${res.status} ${await res.text()}`,
      });
    }

    const { endpoint } = await res.json();
    return new Sandbox(endpoint, id, authToken, apiUrl);
  }

  /** List sandbox sessions with optional pagination. */
  static async list(options: SandboxListOptions = {}): Promise<SandboxListResult> {
    const apiUrl = Sandbox.resolveApiUrl(options);
    const authToken = Sandbox.resolveAuthToken(options);

    const params = new URLSearchParams();
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));

    const query = params.toString();
    const url = `${apiUrl}/sandbox-sessions${query ? `?${query}` : ""}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Failed to list sandboxes: ${res.status} ${await res.text()}`,
      });
    }

    const json = await res.json();

    return {
      data: json.data.map((s: Record<string, unknown>) => ({
        id: s.id,
        shortId: s.short_id,
        endpoint: s.endpoint,
        status: s.status,
        createdAt: s.created_at,
      })),
      pageInfo: {
        self: json.page_info?.self ?? null,
        first: null,
        next: json.page_info?.next ?? null,
        prev: json.page_info?.prev ?? null,
      },
    };
  }

  private static async waitForReady(
    apiUrl: string,
    id: string,
    authToken: string,
    maxWaitMs = 60_000,
    pollIntervalMs = 2_000,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      // no cleanup needed: one-shot
      await new Promise((r) => setTimeout(r, pollIntervalMs));

      const res = await fetch(`${apiUrl}/sandbox-sessions/${id}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.status === "running") return;
        if (data.status === "error" || data.status === "deleting") {
          throw INITIALIZATION_ERROR.create({
            detail: `Sandbox failed to start: status=${data.status}`,
          });
        }
      }
    }
    throw TIMEOUT_ERROR.create({ detail: "Sandbox did not become ready within timeout" });
  }

  /** Execute a bash command in the sandbox and return buffered result. */
  async executeCommand(command: string, options?: ExecOptions): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 1;

    for await (const event of this.executeStream(command, options)) {
      switch (event.type) {
        case "stdout":
          stdout += event.data ?? "";
          break;
        case "stderr":
          stderr += event.data ?? "";
          break;
        case "exit":
          exitCode = event.exitCode ?? 1;
          break;
      }
    }

    return { stdout, stderr, exitCode };
  }

  /** Execute a bash command with streaming output (NDJSON). */
  async *executeStream(command: string, options?: ExecOptions): AsyncGenerator<ExecStreamEvent> {
    const res = await fetch(`${this.endpoint}/exec`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, ...options }),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({ detail: `Exec failed: ${res.status} ${await res.text()}` });
    }

    if (!res.body) {
      throw new Error("Exec response has no body");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        if (line.trim()) {
          yield JSON.parse(line) as ExecStreamEvent;
        }
      }
    }

    if (buffer.trim()) {
      yield JSON.parse(buffer) as ExecStreamEvent;
    }
  }

  /** Read a file from the sandbox workspace. */
  async readFile(path: string): Promise<string> {
    const res = await fetch(
      `${this.endpoint}/file?path=${encodeURIComponent(path)}`,
      {
        headers: { Authorization: `Bearer ${this.authToken}` },
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({ detail: `Read file failed: ${res.status} ${await res.text()}` });
    }

    return res.text();
  }

  /** Write files to the sandbox workspace. */
  async writeFiles(
    files: Array<{ path: string; content: string }>,
  ): Promise<void> {
    const res = await fetch(`${this.endpoint}/files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ files }),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Write files failed: ${res.status} ${await res.text()}`,
      });
    }
  }

  /** Start an async command job in the sandbox. */
  async startCommandJob(command: string, options?: ExecOptions): Promise<CommandJob> {
    const res = await fetch(`${this.endpoint}/exec/jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, ...options }),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Start command job failed: ${res.status} ${await res.text()}`,
      });
    }

    return Sandbox.mapCommandJob(await res.json());
  }

  /** Get the status of an async command job. */
  async getCommandJob(jobId: string): Promise<CommandJob> {
    const res = await fetch(`${this.endpoint}/exec/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${this.authToken}` },
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Get command job failed: ${res.status} ${await res.text()}`,
      });
    }

    return Sandbox.mapCommandJob(await res.json());
  }

  /** Get the output of an async command job. */
  async getCommandJobOutput(jobId: string): Promise<CommandJobOutput> {
    const res = await fetch(`${this.endpoint}/exec/jobs/${jobId}/output`, {
      headers: { Authorization: `Bearer ${this.authToken}` },
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Get command job output failed: ${res.status} ${await res.text()}`,
      });
    }

    const json = await res.json();
    return {
      ...Sandbox.mapCommandJob(json),
      stdout: json.stdout,
      stderr: json.stderr,
      stdoutTruncated: json.stdout_truncated,
      stderrTruncated: json.stderr_truncated,
    };
  }

  /** Cancel an async command job. */
  async cancelCommandJob(jobId: string): Promise<CommandJob> {
    const res = await fetch(`${this.endpoint}/exec/jobs/${jobId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.authToken}` },
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Cancel command job failed: ${res.status} ${await res.text()}`,
      });
    }

    return Sandbox.mapCommandJob(await res.json());
  }

  private static mapCommandJob(json: Record<string, unknown>): CommandJob {
    return {
      id: json.id as string,
      status: json.status as CommandJobStatus,
      exitCode: json.exit_code as number | null,
      signal: json.signal as string | null,
      startedAt: json.started_at as string,
      finishedAt: json.finished_at as string | null,
      heartbeatStatus: json.heartbeat_status as CommandJobHeartbeatStatus,
      lastHeartbeatAt: json.last_heartbeat_at as string | null,
      lastHeartbeatError: json.last_heartbeat_error as string | null,
      heartbeatFailureCount: json.heartbeat_failure_count as number,
    };
  }

  /** Send a heartbeat to prevent idle timeout. */
  async heartbeat(): Promise<void> {
    await fetch(`${this.apiUrl}/sandbox-sessions/${this.sessionId}/heartbeat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.authToken}` },
    });
  }

  /** Close the sandbox session and mark for deletion. */
  async close(): Promise<void> {
    await fetch(`${this.apiUrl}/sandbox-sessions/${this.sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.authToken}` },
    });
  }

  /** Get the session ID. */
  get id(): string {
    return this.sessionId;
  }

  /** Get the sandbox endpoint URL. */
  get url(): string {
    return this.endpoint;
  }
}
