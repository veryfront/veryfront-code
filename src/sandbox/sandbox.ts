/**
 * Sandbox client SDK for ephemeral compute environments.
 *
 * Implements the bash-tool Sandbox interface for seamless integration
 * with AI agent tool loops.
 *
 * @module
 */

import { INITIALIZATION_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import { LazySandbox, type LazySandboxOptions } from "./lazy-sandbox.ts";
import { resolveSandboxApiUrl, resolveSandboxAuthToken } from "./config.ts";
import {
  collectExecResult,
  DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS,
  discardSandboxResponse,
  fetchSandbox,
  normalizeExecRequest,
  normalizeSandboxAuthToken,
  normalizeSandboxBaseUrl,
  normalizeSandboxIdentifier,
  normalizeSandboxListOptions,
  normalizeSandboxNumber,
  normalizeSandboxProjectId,
  normalizeSandboxReadPath,
  normalizeSandboxWriteFiles,
  parseBackgroundCommand,
  parseBackgroundCommandList,
  parseBackgroundCommandOutput,
  parseExecStream,
  parseSandboxList,
  parseSandboxSession,
  parseSandboxSessionId,
  parseSandboxStatus,
  readSandboxJson,
  readSandboxText,
  sandboxClosedError,
  SandboxTransportError,
  throwSandboxResponseError,
} from "./protocol.ts";
import type {
  BackgroundCommand,
  BackgroundCommandOutput,
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
  private closePromise: Promise<void> | null = null;
  private closed = false;

  private constructor(
    private endpoint: string,
    private sessionId: string,
    private authToken: string,
    private apiUrl: string,
  ) {}

  /** Resolve and validate the control-plane base URL. */
  private static resolveApiUrl(options: SandboxOptions = {}): string {
    return resolveSandboxApiUrl(options);
  }

  /** Resolve and validate the control-plane credential. */
  private static resolveAuthToken(options: SandboxOptions = {}): string {
    return resolveSandboxAuthToken(options);
  }

  /** Create a new sandbox session. Claims a warm pod or creates a new one. */
  static async create(options: SandboxOptions = {}): Promise<Sandbox> {
    const apiUrl = Sandbox.resolveApiUrl(options);
    const authToken = Sandbox.resolveAuthToken(options);
    const projectId = normalizeSandboxProjectId(options.projectId);

    const res = await fetchSandbox(
      `${apiUrl}/sandbox-sessions`,
      DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(projectId ? { project_id: projectId } : {}),
      },
    );

    if (!res.ok) {
      await throwSandboxResponseError("Failed to create sandbox", res);
    }

    const createResponse = await readSandboxJson(res, "Sandbox create response");
    const id = parseSandboxSessionId(createResponse);
    try {
      const { endpoint, status } = parseSandboxSession(createResponse);
      let readyEndpoint = endpoint;
      if (status !== "running") {
        readyEndpoint = await Sandbox.waitForReady(apiUrl, id, endpoint, authToken);
      }

      return new Sandbox(readyEndpoint, id, authToken, apiUrl);
    } catch (startupError) {
      try {
        await Sandbox.deleteFailedSession(apiUrl, id, authToken);
      } catch (cleanupError) {
        throw new AggregateError(
          [startupError, cleanupError],
          "Sandbox startup and cleanup failed",
        );
      }
      throw startupError;
    }
  }

  /** Reconnect to an existing sandbox session. */
  static async get(id: string, options: SandboxOptions = {}): Promise<Sandbox> {
    const apiUrl = Sandbox.resolveApiUrl(options);
    const authToken = Sandbox.resolveAuthToken(options);
    const sessionId = normalizeSandboxIdentifier(id, "Sandbox session ID");

    const res = await fetchSandbox(
      `${apiUrl}/sandbox-sessions/${encodeURIComponent(sessionId)}`,
      DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      },
    );

    if (!res.ok) {
      await throwSandboxResponseError("Failed to get sandbox", res);
    }

    const session = parseSandboxSession(
      await readSandboxJson(res, "Sandbox get response"),
      { id: sessionId, status: "running" },
    );
    return new Sandbox(session.endpoint, sessionId, authToken, apiUrl);
  }

  /** Attach to an already-known sandbox session and endpoint without a reconnect lookup. */
  static attach(attachment: SandboxAttachment): Sandbox {
    const apiUrl = Sandbox.resolveApiUrl(attachment);
    const authToken = Sandbox.resolveAuthToken(attachment);
    const id = normalizeSandboxIdentifier(attachment.id, "Sandbox session ID");
    const endpoint = normalizeSandboxBaseUrl(attachment.endpoint, "Sandbox runtime endpoint");
    return new Sandbox(endpoint, id, authToken, apiUrl);
  }

  /** List sandbox sessions with optional pagination. */
  static async list(options: SandboxListOptions = {}): Promise<SandboxListResult> {
    const apiUrl = Sandbox.resolveApiUrl(options);
    const authToken = Sandbox.resolveAuthToken(options);
    const listOptions = normalizeSandboxListOptions(options);

    const params = new URLSearchParams();
    if (listOptions.cursor) params.set("cursor", listOptions.cursor);
    if (listOptions.limit !== undefined) params.set("limit", String(listOptions.limit));

    const query = params.toString();
    const url = `${apiUrl}/sandbox-sessions${query ? `?${query}` : ""}`;

    const res = await fetchSandbox(url, DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (!res.ok) {
      await throwSandboxResponseError("Failed to list sandboxes", res);
    }
    return parseSandboxList(await readSandboxJson(res, "Sandbox list response"));
  }

  /** Wait for a created session and return its latest runtime endpoint. */
  private static async waitForReady(
    apiUrl: string,
    id: string,
    endpoint: string,
    authToken: string,
    maxWaitMs = 60_000,
    pollIntervalMs = 2_000,
  ): Promise<string> {
    return (await pollForSandboxReady(
      { apiUrl, id, authToken, maxWaitMs, pollIntervalMs },
      endpoint,
    )) ?? endpoint;
  }

  /** Delete a session whose startup did not complete. */
  private static async deleteFailedSession(
    apiUrl: string,
    id: string,
    authToken: string,
  ): Promise<void> {
    const res = await fetchSandbox(
      `${apiUrl}/sandbox-sessions/${encodeURIComponent(id)}`,
      DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      },
    );
    if (!res.ok) await throwSandboxResponseError("Sandbox cleanup failed", res);
    await discardSandboxResponse(res);
  }

  /** Create a lazily-provisioned sandbox session with automatic heartbeats. */
  static createLazy(options: LazySandboxOptions = {}): LazySandbox {
    return new LazySandbox(options);
  }

  /** Execute a bash command in the sandbox and return buffered result. */
  async executeCommand(command: string, options?: ExecOptions): Promise<ExecResult> {
    return await collectExecResult(this.executeStream(command, options));
  }

  /** Execute a bash command with streaming output (NDJSON). */
  async *executeStream(command: string, options?: ExecOptions): AsyncGenerator<ExecStreamEvent> {
    this.assertOpen();
    const request = normalizeExecRequest(command, options);
    const res = await fetchSandbox(`${this.endpoint}/exec`, DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      await throwSandboxResponseError("Exec failed", res);
    }
    yield* parseExecStream(res);
  }

  /** Read a file from the sandbox workspace. */
  async readFile(path: string): Promise<string> {
    this.assertOpen();
    const normalizedPath = normalizeSandboxReadPath(path);
    const res = await fetchSandbox(
      `${this.endpoint}/file?path=${encodeURIComponent(normalizedPath)}`,
      DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS,
      {
        headers: { Authorization: `Bearer ${this.authToken}` },
      },
    );

    if (!res.ok) {
      await throwSandboxResponseError("Read file failed", res);
    }

    return await readSandboxText(res, "Sandbox file response");
  }

  /** Write files to the sandbox workspace. */
  async writeFiles(
    files: Array<{ path: string; content: string }>,
  ): Promise<void> {
    this.assertOpen();
    const normalizedFiles = normalizeSandboxWriteFiles(files);
    const res = await fetchSandbox(`${this.endpoint}/files`, DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ files: normalizedFiles }),
    });

    if (!res.ok) {
      await throwSandboxResponseError("Write files failed", res);
    }
    await discardSandboxResponse(res);
  }

  /** Start an async background command in the sandbox. */
  async startBackgroundCommand(command: string, options?: ExecOptions): Promise<BackgroundCommand> {
    this.assertOpen();
    const request = normalizeExecRequest(command, options);
    const res = await fetchSandbox(
      `${this.endpoint}/exec/commands`,
      DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      },
    );

    if (!res.ok) {
      await throwSandboxResponseError("Start background command failed", res);
    }

    return parseBackgroundCommand(
      await readSandboxJson(res, "Start background command response"),
    );
  }

  /** Get the status of an async background command. */
  async getBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    this.assertOpen();
    const id = normalizeSandboxIdentifier(commandId, "Background command ID");
    const res = await fetchSandbox(
      `${this.endpoint}/exec/commands/${encodeURIComponent(id)}`,
      DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS,
      { headers: { Authorization: `Bearer ${this.authToken}` } },
    );

    if (!res.ok) {
      await throwSandboxResponseError("Get background command failed", res);
    }

    return parseBackgroundCommand(
      await readSandboxJson(res, "Get background command response"),
    );
  }

  /** Get the output of an async background command. */
  async getBackgroundCommandOutput(commandId: string): Promise<BackgroundCommandOutput> {
    this.assertOpen();
    const id = normalizeSandboxIdentifier(commandId, "Background command ID");
    const res = await fetchSandbox(
      `${this.endpoint}/exec/commands/${encodeURIComponent(id)}/output`,
      DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS,
      {
        headers: { Authorization: `Bearer ${this.authToken}` },
      },
    );

    if (!res.ok) {
      await throwSandboxResponseError("Get background command output failed", res);
    }

    return parseBackgroundCommandOutput(
      await readSandboxJson(res, "Get background command output response"),
    );
  }

  /** List all background commands in the sandbox. */
  async listBackgroundCommands(): Promise<BackgroundCommand[]> {
    this.assertOpen();
    const res = await fetchSandbox(
      `${this.endpoint}/exec/commands`,
      DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS,
      { headers: { Authorization: `Bearer ${this.authToken}` } },
    );

    if (!res.ok) {
      await throwSandboxResponseError("List background commands failed", res);
    }

    return parseBackgroundCommandList(
      await readSandboxJson(res, "List background commands response"),
    );
  }

  /** Cancel an async background command. */
  async cancelBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    this.assertOpen();
    const id = normalizeSandboxIdentifier(commandId, "Background command ID");
    const res = await fetchSandbox(
      `${this.endpoint}/exec/commands/${encodeURIComponent(id)}/cancel`,
      DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.authToken}` },
      },
    );

    if (!res.ok) {
      await throwSandboxResponseError("Cancel background command failed", res);
    }

    return parseBackgroundCommand(
      await readSandboxJson(res, "Cancel background command response"),
    );
  }

  /** Send a heartbeat to prevent idle timeout. */
  async heartbeat(): Promise<void> {
    this.assertOpen();
    const res = await fetchSandbox(
      `${this.apiUrl}/sandbox-sessions/${encodeURIComponent(this.sessionId)}/heartbeat`,
      DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.authToken}` },
      },
    );

    if (!res.ok) {
      await throwSandboxResponseError("Sandbox heartbeat failed", res);
    }
    await discardSandboxResponse(res);
  }

  /** Close the sandbox session. A successfully closed client cannot be reused. */
  async close(): Promise<void> {
    if (this.closed) return;
    if (this.closePromise) return await this.closePromise;

    const pending = (async () => {
      const res = await fetchSandbox(
        `${this.apiUrl}/sandbox-sessions/${encodeURIComponent(this.sessionId)}`,
        DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${this.authToken}` },
        },
      );

      if (!res.ok) {
        await throwSandboxResponseError("Close sandbox failed", res);
      }
      await discardSandboxResponse(res);
      this.closed = true;
    })();
    this.closePromise = pending;
    try {
      await pending;
    } finally {
      if (!this.closed && this.closePromise === pending) this.closePromise = null;
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

  /** Reject operations after close begins. */
  private assertOpen(): void {
    if (this.closed || this.closePromise) throw sandboxClosedError();
  }
}

interface WaitForSandboxReadyInput {
  apiUrl: string;
  id: string;
  authToken: string;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}

async function pollForSandboxReady(
  input: WaitForSandboxReadyInput,
  fallbackEndpoint?: string,
): Promise<string | undefined> {
  const apiUrl = normalizeSandboxBaseUrl(input.apiUrl, "Sandbox API URL");
  const id = normalizeSandboxIdentifier(input.id, "Sandbox session ID");
  const authToken = normalizeSandboxAuthToken(input.authToken);
  const maxWaitMs = normalizeSandboxNumber(input.maxWaitMs, 60_000, "Sandbox startup timeout", {
    min: 1,
    max: 3_600_000,
  });
  const pollIntervalMs = normalizeSandboxNumber(
    input.pollIntervalMs,
    2_000,
    "Sandbox readiness poll interval",
    { min: 1, max: maxWaitMs },
  );
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    let remainingMs = maxWaitMs - (Date.now() - start);
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)));
    remainingMs = maxWaitMs - (Date.now() - start);
    if (remainingMs <= 0) break;

    let res: Response;
    try {
      res = await fetchSandbox(
        `${apiUrl}/sandbox-sessions/${encodeURIComponent(id)}`,
        Math.min(DEFAULT_SANDBOX_REQUEST_TIMEOUT_MS, Math.max(1, remainingMs)),
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
    } catch (error) {
      if (error instanceof SandboxTransportError) continue;
      throw error;
    }

    if (!res.ok) {
      await discardSandboxResponse(res);
      continue;
    }

    const response = await readSandboxJson(res, "Sandbox readiness response");
    const status = parseSandboxStatus(response);
    if (status === "running") {
      return fallbackEndpoint === undefined
        ? undefined
        : parseSandboxSession(response, { id, endpoint: fallbackEndpoint, status }).endpoint;
    }
    if (status === "error" || status === "deleting") {
      throw INITIALIZATION_ERROR.create({
        detail: `Sandbox failed to start: status=${status}`,
      });
    }
  }

  throw TIMEOUT_ERROR.create({ detail: "Sandbox did not become ready within timeout" });
}

export async function waitForSandboxReady(input: WaitForSandboxReadyInput): Promise<void> {
  await pollForSandboxReady(input);
}
