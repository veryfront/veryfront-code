/**
 * Sandbox client SDK for ephemeral compute environments.
 *
 * Implements the bash-tool Sandbox interface for seamless integration
 * with AI agent tool loops.
 *
 * @module
 */

import { INITIALIZATION_ERROR, REQUEST_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import { LazySandbox, type LazySandboxOptions } from "./lazy-sandbox.ts";
import {
  MAX_SANDBOX_TIMER_MS,
  resolveSandboxApiUrl,
  resolveSandboxAuthToken,
  resolveSandboxControlRequestTimeoutMs,
  resolveSandboxPollIntervalMs,
  resolveSandboxProjectId,
  resolveSandboxStartupTimeoutMs,
} from "./config.ts";
import { decodeSandboxExecStream } from "./exec-stream.ts";
import {
  parseBackgroundCommand,
  parseBackgroundCommandList,
  parseBackgroundCommandOutput,
  parseSandboxEndpointResponse,
  parseSandboxListResponse,
  parseSandboxSessionRecord,
  type SandboxSessionRecord,
} from "./protocol.ts";
import { readSandboxFileContent, sandboxSessionRoute } from "./proxy-routes.ts";
import {
  collectSandboxExecResult,
  normalizeSandboxExecRequest,
  normalizeSandboxFiles,
  validateSandboxRouteValue,
} from "./request-payload.ts";
import {
  DEFAULT_SANDBOX_CONTROL_REQUEST_TIMEOUT_MS,
  getSandboxHttpErrorStatus,
  isSandboxRequestTimeout,
  isSandboxTransportError,
  requestSandboxJson,
  requestSandboxResponse,
  requestSandboxStream,
  requestSandboxVoid,
} from "./transport.ts";
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
  private closed = false;
  private closePromise: Promise<void> | null = null;

  private constructor(
    private endpoint: string,
    private sessionId: string,
    private authToken: string,
    private apiUrl: string,
    private controlRequestTimeoutMs: number,
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
    const controlRequestTimeoutMs = resolveSandboxControlRequestTimeoutMs(
      options,
      DEFAULT_SANDBOX_CONTROL_REQUEST_TIMEOUT_MS,
    );
    const projectId = resolveSandboxProjectId(options.projectId);
    const value = await requestSandboxJson({
      url: `${apiUrl}/sandbox-sessions`,
      timeoutMs: controlRequestTimeoutMs,
      operation: "Failed to create sandbox",
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(projectId ? { project_id: projectId } : {}),
      },
    });
    let session = parseSandboxSessionRecord(value, "Failed to create sandbox", {
      requireId: true,
    });

    if (session.status !== "running") {
      session = await Sandbox.waitForReady(apiUrl, session.id, authToken, options);
    }
    if (session.endpoint === null) {
      throw INITIALIZATION_ERROR.create({
        detail: "Sandbox became ready without an endpoint",
      });
    }

    return new Sandbox(
      session.endpoint,
      session.id,
      authToken,
      apiUrl,
      controlRequestTimeoutMs,
    );
  }

  /** Reconnect to an existing sandbox session. */
  static async get(id: string, options: SandboxOptions = {}): Promise<Sandbox> {
    const apiUrl = Sandbox.resolveApiUrl(options);
    const authToken = Sandbox.resolveAuthToken(options);
    const sessionId = validateSandboxRouteValue(id, "Sandbox session id");
    const controlRequestTimeoutMs = resolveSandboxControlRequestTimeoutMs(
      options,
      DEFAULT_SANDBOX_CONTROL_REQUEST_TIMEOUT_MS,
    );
    const value = await requestSandboxJson({
      url: `${apiUrl}/sandbox-sessions/${encodeURIComponent(sessionId)}`,
      timeoutMs: controlRequestTimeoutMs,
      operation: "Failed to get sandbox",
      init: { headers: { Authorization: `Bearer ${authToken}` } },
    });
    const endpoint = parseSandboxEndpointResponse(value, "Failed to get sandbox");
    return new Sandbox(endpoint, sessionId, authToken, apiUrl, controlRequestTimeoutMs);
  }

  /** Attach to an already-known sandbox session and endpoint without a reconnect lookup. */
  static attach(attachment: SandboxAttachment): Sandbox {
    const apiUrl = Sandbox.resolveApiUrl(attachment);
    const authToken = Sandbox.resolveAuthToken(attachment);
    const id = validateSandboxRouteValue(attachment.id, "Sandbox session id");
    const endpoint = parseSandboxEndpointResponse(
      { endpoint: attachment.endpoint },
      "Invalid sandbox attachment",
    );
    const controlRequestTimeoutMs = resolveSandboxControlRequestTimeoutMs(
      attachment,
      DEFAULT_SANDBOX_CONTROL_REQUEST_TIMEOUT_MS,
    );
    return new Sandbox(endpoint, id, authToken, apiUrl, controlRequestTimeoutMs);
  }

  /** List sandbox sessions with optional pagination. */
  static async list(options: SandboxListOptions = {}): Promise<SandboxListResult> {
    const apiUrl = Sandbox.resolveApiUrl(options);
    const authToken = Sandbox.resolveAuthToken(options);
    const controlRequestTimeoutMs = resolveSandboxControlRequestTimeoutMs(
      options,
      DEFAULT_SANDBOX_CONTROL_REQUEST_TIMEOUT_MS,
    );

    const params = new URLSearchParams();
    if (options.cursor !== undefined) {
      params.set("cursor", validateSandboxRouteValue(options.cursor, "Sandbox list cursor"));
    }
    if (options.limit !== undefined) {
      if (!Number.isSafeInteger(options.limit) || options.limit <= 0 || options.limit > 1_000) {
        throw new RangeError("Sandbox list limit must be an integer between 1 and 1000");
      }
      params.set("limit", String(options.limit));
    }

    const query = params.toString();
    const url = `${apiUrl}/sandbox-sessions${query ? `?${query}` : ""}`;
    const value = await requestSandboxJson({
      url,
      timeoutMs: controlRequestTimeoutMs,
      operation: "Failed to list sandboxes",
      init: { headers: { Authorization: `Bearer ${authToken}` } },
    });
    return parseSandboxListResponse(value, "Failed to list sandboxes");
  }

  private static async waitForReady(
    apiUrl: string,
    id: string,
    authToken: string,
    options: SandboxOptions,
  ): Promise<SandboxSessionRecord> {
    return await waitForSandboxReady({
      apiUrl,
      id,
      authToken,
      maxWaitMs: resolveSandboxStartupTimeoutMs(options),
      pollIntervalMs: resolveSandboxPollIntervalMs(options),
      controlRequestTimeoutMs: resolveSandboxControlRequestTimeoutMs(
        options,
        DEFAULT_SANDBOX_CONTROL_REQUEST_TIMEOUT_MS,
      ),
    });
  }

  /** Create a lazily-provisioned sandbox session with automatic heartbeats. */
  static createLazy(options: LazySandboxOptions = {}): LazySandbox {
    return new LazySandbox(options);
  }

  /** Execute a bash command in the sandbox and return buffered result. */
  async executeCommand(command: string, options?: ExecOptions): Promise<ExecResult> {
    const request = normalizeSandboxExecRequest(command, options);
    return await collectSandboxExecResult(
      this.executeNormalizedStream(request.payload),
      request.maxOutputBytes,
    );
  }

  /** Execute a bash command with streaming output (NDJSON). */
  async *executeStream(command: string, options?: ExecOptions): AsyncGenerator<ExecStreamEvent> {
    const request = normalizeSandboxExecRequest(command, options);
    yield* this.executeNormalizedStream(request.payload);
  }

  private async *executeNormalizedStream(
    payload: ReturnType<typeof normalizeSandboxExecRequest>["payload"],
  ): AsyncGenerator<ExecStreamEvent> {
    this.assertOpen();
    const res = await requestSandboxStream({
      url: sandboxSessionRoute(this.apiUrl, this.sessionId, "/commands/stream"),
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Exec failed",
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    });
    if (!res.body) {
      throw REQUEST_ERROR.create({ detail: "Exec failed: response has no body" });
    }
    yield* decodeSandboxExecStream(res.body);
  }

  /** Read a file from the sandbox workspace. */
  async readFile(path: string): Promise<string> {
    this.assertOpen();
    const normalizedPath = validateSandboxRouteValue(path, "Sandbox file path");
    return await requestSandboxResponse({
      url: sandboxSessionRoute(
        this.apiUrl,
        this.sessionId,
        `/file?path=${encodeURIComponent(normalizedPath)}`,
      ),
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Read file failed",
      init: { headers: { Authorization: `Bearer ${this.authToken}` } },
      consume: async (response, signal) =>
        await readSandboxFileContent(response, {
          operation: "Read file failed",
          signal,
        }),
    });
  }

  /** Write files to the sandbox workspace. */
  async writeFiles(
    files: Array<{ path: string; content: string }>,
  ): Promise<void> {
    this.assertOpen();
    const normalizedFiles = normalizeSandboxFiles(files);
    await requestSandboxVoid({
      url: sandboxSessionRoute(this.apiUrl, this.sessionId, "/files"),
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Write files failed",
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files: normalizedFiles }),
      },
    });
  }

  /** Start an async background command in the sandbox. */
  async startBackgroundCommand(command: string, options?: ExecOptions): Promise<BackgroundCommand> {
    this.assertOpen();
    const request = normalizeSandboxExecRequest(command, options);
    const value = await requestSandboxJson({
      url: sandboxSessionRoute(this.apiUrl, this.sessionId, "/commands"),
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Start background command failed",
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request.payload),
      },
    });
    return parseBackgroundCommand(value, "Start background command failed");
  }

  /** Get the status of an async background command. */
  async getBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    this.assertOpen();
    const id = validateSandboxRouteValue(commandId, "Sandbox command id");
    const value = await requestSandboxJson({
      url: sandboxSessionRoute(
        this.apiUrl,
        this.sessionId,
        `/commands/${encodeURIComponent(id)}`,
      ),
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Get background command failed",
      init: { headers: { Authorization: `Bearer ${this.authToken}` } },
    });
    return parseBackgroundCommand(value, "Get background command failed");
  }

  /** Get the output of an async background command. */
  async getBackgroundCommandOutput(commandId: string): Promise<BackgroundCommandOutput> {
    this.assertOpen();
    const id = validateSandboxRouteValue(commandId, "Sandbox command id");
    const value = await requestSandboxJson({
      url: sandboxSessionRoute(
        this.apiUrl,
        this.sessionId,
        `/commands/${encodeURIComponent(id)}/output`,
      ),
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Get background command output failed",
      init: { headers: { Authorization: `Bearer ${this.authToken}` } },
    });
    return parseBackgroundCommandOutput(value, "Get background command output failed");
  }

  /** List all background commands in the sandbox. */
  async listBackgroundCommands(): Promise<BackgroundCommand[]> {
    this.assertOpen();
    const value = await requestSandboxJson({
      url: sandboxSessionRoute(this.apiUrl, this.sessionId, "/commands"),
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "List background commands failed",
      init: { headers: { Authorization: `Bearer ${this.authToken}` } },
    });
    return parseBackgroundCommandList(value, "List background commands failed");
  }

  /** Cancel an async background command. */
  async cancelBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    this.assertOpen();
    const id = validateSandboxRouteValue(commandId, "Sandbox command id");
    const value = await requestSandboxJson({
      url: sandboxSessionRoute(
        this.apiUrl,
        this.sessionId,
        `/commands/${encodeURIComponent(id)}/cancel`,
      ),
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Cancel background command failed",
      init: {
        method: "POST",
        headers: { Authorization: `Bearer ${this.authToken}` },
      },
    });
    return parseBackgroundCommand(value, "Cancel background command failed");
  }

  /** Send a heartbeat to prevent idle timeout. */
  async heartbeat(): Promise<void> {
    this.assertOpen();
    await requestSandboxVoid({
      url: `${this.apiUrl}/sandbox-sessions/${encodeURIComponent(this.sessionId)}/heartbeat`,
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Sandbox heartbeat failed",
      init: {
        method: "POST",
        headers: { Authorization: `Bearer ${this.authToken}` },
      },
    });
  }

  /** Close the sandbox session and mark for deletion. */
  async close(): Promise<void> {
    if (this.closed) return;
    if (this.closePromise) {
      await this.closePromise;
      return;
    }

    const pending = (async () => {
      try {
        await requestSandboxVoid({
          url: `${this.apiUrl}/sandbox-sessions/${encodeURIComponent(this.sessionId)}`,
          timeoutMs: this.controlRequestTimeoutMs,
          operation: "Close sandbox failed",
          init: {
            method: "DELETE",
            headers: { Authorization: `Bearer ${this.authToken}` },
          },
        });
      } catch (error) {
        if (getSandboxHttpErrorStatus(error) !== 404) throw error;
      }
    })();
    this.closePromise = pending;

    try {
      await pending;
      this.closed = true;
    } finally {
      if (this.closePromise === pending) {
        this.closePromise = null;
      }
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

  private assertOpen(): void {
    if (this.closed || this.closePromise) {
      throw REQUEST_ERROR.create({ detail: "Sandbox session is closing or closed" });
    }
  }
}

export async function waitForSandboxReady(input: {
  apiUrl: string;
  id: string;
  authToken: string;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  controlRequestTimeoutMs?: number;
}): Promise<SandboxSessionRecord> {
  const maxWaitMs = input.maxWaitMs ?? resolveSandboxStartupTimeoutMs();
  const pollIntervalMs = input.pollIntervalMs ?? resolveSandboxPollIntervalMs();
  const controlRequestTimeoutMs = input.controlRequestTimeoutMs ??
    DEFAULT_SANDBOX_CONTROL_REQUEST_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(maxWaitMs) ||
    maxWaitMs <= 0 ||
    maxWaitMs > MAX_SANDBOX_TIMER_MS
  ) {
    throw new RangeError(
      `Sandbox maxWaitMs must be an integer between 1 and ${MAX_SANDBOX_TIMER_MS}`,
    );
  }
  if (
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs <= 0 ||
    pollIntervalMs > MAX_SANDBOX_TIMER_MS
  ) {
    throw new RangeError(
      `Sandbox pollIntervalMs must be an integer between 1 and ${MAX_SANDBOX_TIMER_MS}`,
    );
  }
  if (
    !Number.isSafeInteger(controlRequestTimeoutMs) ||
    controlRequestTimeoutMs < 0 ||
    controlRequestTimeoutMs > MAX_SANDBOX_TIMER_MS
  ) {
    throw new RangeError(
      `Sandbox controlRequestTimeoutMs must be an integer between 0 and ${MAX_SANDBOX_TIMER_MS}`,
    );
  }

  const sessionId = validateSandboxRouteValue(input.id, "Sandbox session id");
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    const requestTimeoutMs = controlRequestTimeoutMs === 0
      ? 0
      : Math.max(1, Math.min(controlRequestTimeoutMs, remainingMs));

    let session: SandboxSessionRecord;
    try {
      const value = await requestSandboxJson({
        url: `${input.apiUrl}/sandbox-sessions/${encodeURIComponent(sessionId)}`,
        timeoutMs: requestTimeoutMs,
        operation: "Failed to check sandbox readiness",
        init: { headers: { Authorization: `Bearer ${input.authToken}` } },
      });
      session = parseSandboxSessionRecord(value, "Failed to check sandbox readiness", {
        expectedId: sessionId,
      });
    } catch (error) {
      const status = getSandboxHttpErrorStatus(error);
      const retryableStatus = status !== undefined &&
        (status === 404 || status === 408 || status === 409 || status === 425 ||
          status === 429 || status === 500 || status === 502 || status === 503 ||
          status === 504);
      const retryableTransport = isSandboxRequestTimeout(error) ||
        isSandboxTransportError(error);
      if (!retryableStatus && !retryableTransport) throw error;

      const retryDelayMs = Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()));
      if (retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
      continue;
    }

    if (session.status === "running") return session;
    if (session.status === "error" || session.status === "deleting") {
      throw INITIALIZATION_ERROR.create({
        detail: `Sandbox failed to start: status=${session.status}`,
      });
    }

    const retryDelayMs = Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()));
    if (retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw TIMEOUT_ERROR.create({ detail: "Sandbox did not become ready within timeout" });
}
