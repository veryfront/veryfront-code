/**
 * Sandbox client SDK for ephemeral compute environments.
 *
 * Implements the bash-tool Sandbox interface for seamless integration
 * with AI agent tool loops.
 *
 * @module
 */

import {
  INITIALIZATION_ERROR,
  REQUEST_ERROR,
  TIMEOUT_ERROR,
} from "#veryfront/errors/error-registry.ts";
import { LazySandbox, type LazySandboxOptions } from "./lazy-sandbox.ts";
import { resolveSandboxApiUrl, resolveSandboxAuthToken } from "./config.ts";
import type {
  BackgroundCommand,
  BackgroundCommandHeartbeatStatus,
  BackgroundCommandOutput,
  BackgroundCommandStatus,
  ExecOptions,
  ExecResult,
  ExecStreamEvent,
  SandboxAttachment,
  SandboxListOptions,
  SandboxListResult,
  SandboxOptions,
} from "./types.ts";
export { resolveSandboxApiUrl, resolveSandboxAuthToken } from "./config.ts";
export type {
  BackgroundCommand,
  BackgroundCommandHeartbeatStatus,
  BackgroundCommandOutput,
  BackgroundCommandStatus,
  ExecOptions,
  ExecResult,
  ExecStreamEvent,
  SandboxAttachment,
  SandboxListOptions,
  SandboxListResult,
  SandboxOptions,
  SandboxSession,
} from "./types.ts";

/** Client for isolated ephemeral compute environments with command execution and file I/O. */
export class Sandbox {
  private constructor(
    private endpoint: string,
    private sessionId: string,
    private authToken: string,
    private apiUrl: string,
  ) {}

  private static resolveApiUrl(options: SandboxOptions = {}): string {
    return resolveSandboxApiUrl(options);
  }

  private static resolveAuthToken(options: SandboxOptions = {}): string {
    return resolveSandboxAuthToken(options);
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
      body: JSON.stringify(options.projectId ? { project_id: options.projectId } : {}),
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

  /** Attach to an already-known sandbox session and endpoint without a reconnect lookup. */
  static attach(attachment: SandboxAttachment): Sandbox {
    const apiUrl = Sandbox.resolveApiUrl(attachment);
    const authToken = Sandbox.resolveAuthToken(attachment);
    return new Sandbox(attachment.endpoint, attachment.id, authToken, apiUrl);
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
    await waitForSandboxReady({ apiUrl, id, authToken, maxWaitMs, pollIntervalMs });
  }

  /** Create a lazily-provisioned sandbox session with automatic heartbeats. */
  static createLazy(options: LazySandboxOptions = {}): LazySandbox {
    return new LazySandbox(options);
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
          try {
            yield JSON.parse(line) as ExecStreamEvent;
          } catch {
            // Malformed NDJSON line (e.g. truncated network chunk); skip and
            // continue streaming so already-buffered output is not lost.
          }
        }
      }
    }

    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer) as ExecStreamEvent;
      } catch {
        // Malformed final chunk; discard rather than surfacing a SyntaxError.
      }
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

  /** Start an async background command in the sandbox. */
  async startBackgroundCommand(command: string, options?: ExecOptions): Promise<BackgroundCommand> {
    const res = await fetch(`${this.endpoint}/exec/commands`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, ...options }),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Start background command failed: ${res.status} ${await res.text()}`,
      });
    }

    return Sandbox.mapBackgroundCommand(await res.json());
  }

  /** Get the status of an async background command. */
  async getBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    const res = await fetch(`${this.endpoint}/exec/commands/${commandId}`, {
      headers: { Authorization: `Bearer ${this.authToken}` },
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Get background command failed: ${res.status} ${await res.text()}`,
      });
    }

    return Sandbox.mapBackgroundCommand(await res.json());
  }

  /** Get the output of an async background command. */
  async getBackgroundCommandOutput(commandId: string): Promise<BackgroundCommandOutput> {
    const res = await fetch(`${this.endpoint}/exec/commands/${commandId}/output`, {
      headers: { Authorization: `Bearer ${this.authToken}` },
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Get background command output failed: ${res.status} ${await res.text()}`,
      });
    }

    const json = await res.json();
    return {
      ...Sandbox.mapBackgroundCommand(json),
      stdout: json.stdout,
      stderr: json.stderr,
      stdoutTruncated: json.stdout_truncated,
      stderrTruncated: json.stderr_truncated,
    };
  }

  /** List all background commands in the sandbox. */
  async listBackgroundCommands(): Promise<BackgroundCommand[]> {
    const res = await fetch(`${this.endpoint}/exec/commands`, {
      headers: { Authorization: `Bearer ${this.authToken}` },
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `List background commands failed: ${res.status} ${await res.text()}`,
      });
    }

    const json = await res.json();
    const commands = Array.isArray(json) ? json : (json.commands ?? []);
    return commands.map((command: Record<string, unknown>) =>
      Sandbox.mapBackgroundCommand(command)
    );
  }

  /** Cancel an async background command. */
  async cancelBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    const res = await fetch(`${this.endpoint}/exec/commands/${commandId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.authToken}` },
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Cancel background command failed: ${res.status} ${await res.text()}`,
      });
    }

    return Sandbox.mapBackgroundCommand(await res.json());
  }

  private static mapBackgroundCommand(json: Record<string, unknown>): BackgroundCommand {
    return {
      id: json.id as string,
      status: json.status as BackgroundCommandStatus,
      exitCode: json.exit_code as number | null,
      signal: json.signal as string | null,
      startedAt: json.started_at as string,
      finishedAt: json.finished_at as string | null,
      heartbeatStatus: json.heartbeat_status as BackgroundCommandHeartbeatStatus,
      lastHeartbeatAt: json.last_heartbeat_at as string | null,
      lastHeartbeatError: json.last_heartbeat_error as string | null,
      heartbeatFailureCount: json.heartbeat_failure_count as number,
    };
  }

  /** Send a heartbeat to prevent idle timeout. */
  async heartbeat(): Promise<void> {
    const res = await fetch(`${this.apiUrl}/sandbox-sessions/${this.sessionId}/heartbeat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.authToken}` },
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Sandbox heartbeat failed: ${res.status} ${await res.text()}`,
      });
    }
  }

  /** Close the sandbox session and mark for deletion. */
  async close(): Promise<void> {
    const res = await fetch(`${this.apiUrl}/sandbox-sessions/${this.sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.authToken}` },
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Close sandbox failed: ${res.status} ${await res.text()}`,
      });
    }
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

export async function waitForSandboxReady(input: {
  apiUrl: string;
  id: string;
  authToken: string;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}): Promise<void> {
  const maxWaitMs = input.maxWaitMs ?? 60_000;
  const pollIntervalMs = input.pollIntervalMs ?? 2_000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    const res = await fetch(`${input.apiUrl}/sandbox-sessions/${input.id}`, {
      headers: { Authorization: `Bearer ${input.authToken}` },
    });

    if (!res.ok) {
      continue;
    }

    const data = await res.json();
    if (data.status === "running") return;
    if (data.status === "error" || data.status === "deleting") {
      throw INITIALIZATION_ERROR.create({
        detail: `Sandbox failed to start: status=${data.status}`,
      });
    }
  }

  throw TIMEOUT_ERROR.create({ detail: "Sandbox did not become ready within timeout" });
}
