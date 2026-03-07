/**
 * Sandbox client SDK for ephemeral compute environments.
 *
 * Implements the bash-tool Sandbox interface for seamless integration
 * with AI agent tool loops.
 *
 * @module
 */

import { INITIALIZATION_ERROR, REQUEST_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";

/** Options for creating a sandbox session. */
export interface SandboxOptions {
  /** Base URL of the Veryfront API. Defaults to VERYFRONT_API_URL env. */
  apiUrl?: string;
  /** User's JWT for authentication. */
  authToken: string;
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

/** Client for isolated ephemeral compute environments with command execution and file I/O. */
export class Sandbox {
  private constructor(
    private endpoint: string,
    private sessionId: string,
    private authToken: string,
    private apiUrl: string,
  ) {}

  private static resolveApiUrl(options: SandboxOptions): string {
    return options.apiUrl ||
      (typeof Deno !== "undefined"
        ? Deno.env.get("VERYFRONT_API_URL")
        : process.env.VERYFRONT_API_URL) ||
      "https://api.veryfront.com";
  }

  /** Create a new sandbox session. Claims a warm pod or creates a new one. */
  static async create(options: SandboxOptions): Promise<Sandbox> {
    const apiUrl = Sandbox.resolveApiUrl(options);

    const res = await fetch(`${apiUrl}/sandbox-sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.authToken}`,
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
      await Sandbox.waitForReady(apiUrl, id, options.authToken);
    }

    return new Sandbox(endpoint, id, options.authToken, apiUrl);
  }

  /** Reconnect to an existing sandbox session. */
  static async get(id: string, options: SandboxOptions): Promise<Sandbox> {
    const apiUrl = Sandbox.resolveApiUrl(options);

    const res = await fetch(`${apiUrl}/sandbox-sessions/${id}`, {
      headers: { Authorization: `Bearer ${options.authToken}` },
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Failed to get sandbox: ${res.status} ${await res.text()}`,
      });
    }

    const { endpoint } = await res.json();
    return new Sandbox(endpoint, id, options.authToken, apiUrl);
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
  async executeCommand(command: string): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 1;

    for await (const event of this.executeStream(command)) {
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
  async *executeStream(command: string): AsyncGenerator<ExecStreamEvent> {
    const res = await fetch(`${this.endpoint}/exec`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command }),
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
