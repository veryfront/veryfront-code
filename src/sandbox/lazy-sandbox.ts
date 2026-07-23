import {
  INITIALIZATION_ERROR,
  INVALID_ARGUMENT,
  REQUEST_ERROR,
  TIMEOUT_ERROR,
} from "#veryfront/errors";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { logger } from "#veryfront/utils";
import { resolveSandboxApiUrl, resolveSandboxAuthToken } from "./config.ts";
import {
  collectExecResult,
  discardSandboxResponse,
  fetchSandbox,
  normalizeExecRequest,
  normalizeSandboxBaseUrl,
  normalizeSandboxIdentifier,
  normalizeSandboxNumber,
  normalizeSandboxProjectId,
  normalizeSandboxReadPath,
  normalizeSandboxWriteFiles,
  parseBackgroundCommand,
  parseBackgroundCommandList,
  parseBackgroundCommandOutput,
  parseExecStream,
  parseSandboxSession,
  parseSandboxSessionId,
  readSandboxJson,
  readSandboxText,
  sandboxClosedError,
  SandboxTransportError,
  throwSandboxResponseError,
} from "./protocol.ts";
import {
  type BackgroundCommand,
  type BackgroundCommandOutput,
  type ExecOptions,
  type ExecResult,
  type ExecStreamEvent,
  type SandboxOptions,
} from "./types.ts";

/** Options accepted by lazy sandbox. */
export interface LazySandboxOptions extends SandboxOptions {
  /**
   * Optional existing sandbox session to attach to instead of creating a new one.
   * Attached sessions are detached, not deleted, on close unless deleteOnClose is true.
   */
  sandboxId?: string;
  /** Optional known endpoint for sandboxId; avoids the initial control-plane lookup. */
  sandboxEndpoint?: string;
  /** Delete the sandbox when closing. Defaults to true for created sessions and false for sandboxId. */
  deleteOnClose?: boolean;
  /** Resolve the current project for project-scoped sessions and commands. */
  getProjectId?: () => string | null | undefined;
  /** Maximum session startup time in milliseconds. Defaults to 180000. */
  startupTimeoutMs?: number;
  /** Session readiness polling interval in milliseconds. Defaults to 2000. */
  pollIntervalMs?: number;
  /** Automatic heartbeat interval in milliseconds. Defaults to 30000. */
  heartbeatIntervalMs?: number;
  /** Minimum time between on-demand heartbeats in milliseconds. Defaults to 5000. */
  heartbeatGraceMs?: number;
  /** Control request and response timeout in milliseconds. Use 0 to disable. Defaults to 15000. */
  controlRequestTimeoutMs?: number;
  /** Command-start request timeout in milliseconds. Use 0 to disable. Defaults to 30000. */
  execStartTimeoutMs?: number;
  /** Maximum command-start attempts. Defaults to 3. */
  execStartMaxAttempts?: number;
  /** Delay between command-start attempts in milliseconds. Defaults to 1000. */
  execStartRetryDelayMs?: number;
  /** Resolve a public runtime endpoint to the endpoint reachable by this process. */
  resolveRuntimeEndpoint?: (input: { endpoint: string; sessionId: string }) => string;
}

interface SandboxSessionRecord {
  id: string;
  endpoint: string;
  status: string;
}

interface PendingOperation {
  promise: Promise<void>;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_GRACE_MS = 5_000;
const DEFAULT_CONTROL_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_EXEC_START_TIMEOUT_MS = 30_000;
const DEFAULT_EXEC_START_MAX_ATTEMPTS = 3;
const DEFAULT_EXEC_START_RETRY_DELAY_MS = 1_000;
const CREATED_SESSION_BOOTSTRAP_MAX_ATTEMPTS = 2;
const RETRYABLE_DATA_PLANE_READINESS_STATUS_CODES = new Set([404, 502, 503, 504]);
const REPROVISIONABLE_EXEC_START_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EHOSTUNREACH",
]);
const MAX_KUBERNETES_SANDBOX_SHORT_ID_LENGTH = 63 - "veryfront-sandbox-".length;
const VERYFRONT_SANDBOX_PUBLIC_HOST_PATTERN =
  /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.sandbox\.veryfront\.(?:com|org)$/i;
const DATA_PLANE_READINESS_ERRORS = new WeakSet<object>();
const MAX_LIFECYCLE_TIMEOUT_MS = 3_600_000;
const MAX_HEARTBEAT_INTERVAL_MS = 86_400_000;
const MAX_EXEC_START_ATTEMPTS = 10;

function invalidLazyOption(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function createDataPlaneReadinessError(): Error {
  const error = REQUEST_ERROR.create({ detail: "Sandbox data plane did not become ready" });
  DATA_PLANE_READINESS_ERRORS.add(error);
  return error;
}

/** Resolve a public Veryfront sandbox endpoint to its Kubernetes service when in-cluster. */
export function resolveDefaultSandboxRuntimeEndpoint(input: { endpoint: string }): string {
  if (!getHostEnv("KUBERNETES_SERVICE_HOST")) {
    return input.endpoint;
  }

  let hostname: string;
  try {
    hostname = new URL(input.endpoint).hostname;
  } catch {
    return input.endpoint;
  }

  const match = hostname.match(VERYFRONT_SANDBOX_PUBLIC_HOST_PATTERN);
  const shortId = match?.[1];
  if (!shortId || shortId.length > MAX_KUBERNETES_SANDBOX_SHORT_ID_LENGTH) {
    return input.endpoint;
  }

  return `http://sandbox.veryfront-sandbox-${shortId}.svc.cluster.local`;
}

/** Lazily provisions sandbox sessions and keeps them alive while in use. */
export class LazySandbox {
  private readonly apiUrl: string;
  private readonly authToken: string;
  private readonly sandboxId: string | undefined;
  private readonly sandboxEndpoint: string | undefined;
  private readonly deleteOnClose: boolean;
  private readonly getProjectId: () => string | null | undefined;
  private readonly startupTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatGraceMs: number;
  private readonly controlRequestTimeoutMs: number;
  private readonly execStartTimeoutMs: number;
  private readonly execStartMaxAttempts: number;
  private readonly execStartRetryDelayMs: number;
  private readonly resolveRuntimeEndpointOption:
    | ((input: {
      endpoint: string;
      sessionId: string;
    }) => string)
    | undefined;

  private endpoint: string | null = null;
  private sessionId: string | null = null;
  private sessionProjectId: string | null = null;
  private ensurePromise: PendingOperation | null = null;
  private sessionTransitionPromise: PendingOperation | null = null;
  private closePromise: PendingOperation | null = null;
  private heartbeatPromise: PendingOperation | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatAt = 0;
  private closing = false;
  private closed = false;
  private readonly activeBackgroundCommandEndpoints = new Map<string, string>();

  /** Create a lazy sandbox client without provisioning a session. */
  constructor(options: LazySandboxOptions = {}) {
    this.apiUrl = resolveSandboxApiUrl(options);
    this.authToken = resolveSandboxAuthToken(options);
    this.sandboxId = options.sandboxId === undefined
      ? undefined
      : normalizeSandboxIdentifier(options.sandboxId, "Sandbox session ID");
    this.sandboxEndpoint = options.sandboxEndpoint === undefined
      ? undefined
      : normalizeSandboxBaseUrl(options.sandboxEndpoint, "Sandbox runtime endpoint");
    if (this.sandboxEndpoint && !this.sandboxId) {
      invalidLazyOption("sandboxEndpoint requires sandboxId");
    }
    if (options.deleteOnClose !== undefined && typeof options.deleteOnClose !== "boolean") {
      invalidLazyOption("deleteOnClose must be a boolean");
    }
    this.deleteOnClose = options.deleteOnClose ?? !this.sandboxId;
    if (options.getProjectId !== undefined && typeof options.getProjectId !== "function") {
      invalidLazyOption("getProjectId must be a function");
    }
    this.getProjectId = options.getProjectId ?? (() => options.projectId);
    this.startupTimeoutMs = normalizeSandboxNumber(
      options.startupTimeoutMs,
      DEFAULT_STARTUP_TIMEOUT_MS,
      "Sandbox startup timeout",
      { min: 1, max: MAX_LIFECYCLE_TIMEOUT_MS },
    );
    this.pollIntervalMs = normalizeSandboxNumber(
      options.pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS,
      "Sandbox readiness poll interval",
      { min: 1, max: this.startupTimeoutMs },
    );
    this.heartbeatIntervalMs = normalizeSandboxNumber(
      options.heartbeatIntervalMs,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
      "Sandbox heartbeat interval",
      { min: 1, max: MAX_HEARTBEAT_INTERVAL_MS },
    );
    this.heartbeatGraceMs = normalizeSandboxNumber(
      options.heartbeatGraceMs,
      DEFAULT_HEARTBEAT_GRACE_MS,
      "Sandbox heartbeat grace period",
      { min: 0, max: MAX_HEARTBEAT_INTERVAL_MS },
    );
    this.controlRequestTimeoutMs = normalizeSandboxNumber(
      options.controlRequestTimeoutMs,
      DEFAULT_CONTROL_REQUEST_TIMEOUT_MS,
      "Sandbox control request timeout",
      { min: 0, max: MAX_LIFECYCLE_TIMEOUT_MS },
    );
    this.execStartTimeoutMs = normalizeSandboxNumber(
      options.execStartTimeoutMs,
      DEFAULT_EXEC_START_TIMEOUT_MS,
      "Sandbox exec start timeout",
      { min: 0, max: MAX_LIFECYCLE_TIMEOUT_MS },
    );
    this.execStartMaxAttempts = normalizeSandboxNumber(
      options.execStartMaxAttempts,
      DEFAULT_EXEC_START_MAX_ATTEMPTS,
      "Sandbox exec start attempts",
      { min: 1, max: MAX_EXEC_START_ATTEMPTS, integer: true },
    );
    this.execStartRetryDelayMs = normalizeSandboxNumber(
      options.execStartRetryDelayMs,
      DEFAULT_EXEC_START_RETRY_DELAY_MS,
      "Sandbox exec retry delay",
      { min: 0, max: MAX_LIFECYCLE_TIMEOUT_MS },
    );
    if (
      options.resolveRuntimeEndpoint !== undefined &&
      typeof options.resolveRuntimeEndpoint !== "function"
    ) {
      invalidLazyOption("resolveRuntimeEndpoint must be a function");
    }
    this.resolveRuntimeEndpointOption = options.resolveRuntimeEndpoint;
  }

  /** Provision or attach the session if the client does not have an active endpoint. */
  async ensure(): Promise<void> {
    this.assertOpen();
    if (this.endpoint) return;
    if (this.ensurePromise) {
      await this.ensurePromise.promise;
      return;
    }

    const pending = { promise: this.bootstrapSession() };
    this.ensurePromise = pending;

    try {
      await pending.promise;
    } finally {
      if (this.ensurePromise === pending) {
        this.ensurePromise = null;
      }
    }
  }

  /** Execute a command and return bounded buffered output. */
  async executeCommand(command: string, options?: ExecOptions): Promise<ExecResult> {
    return await collectExecResult(this.executeStream(command, options));
  }

  /** Execute a command and stream validated NDJSON events. */
  async *executeStream(command: string, options?: ExecOptions): AsyncGenerator<ExecStreamEvent> {
    this.assertOpen();
    const projectId = this.resolveProjectId();
    const request = this.resolveExecRequest(command, options, projectId);
    await this.touchSession(projectId);
    let res: Response;
    try {
      res = await this.startExec(request);
    } catch (error) {
      if (
        !shouldReprovisionAfterExecStartFailure(error) ||
        this.activeBackgroundCommandEndpoints.size > 0
      ) {
        throw error;
      }

      await this.reprovisionAfterExecStartFailure();
      await this.touchSession(projectId);
      res = await this.startExec(request);
    }

    yield* parseExecStream(res);
  }

  /** Read a UTF-8 text file from the sandbox workspace. */
  async readFile(path: string): Promise<string> {
    this.assertOpen();
    const normalizedPath = normalizeSandboxReadPath(path);
    await this.touchSession();

    const res = await this.fetchControl(
      `${this.requireEndpoint()}/file?path=${encodeURIComponent(normalizedPath)}`,
      {
        headers: this.authHeaders(),
      },
    );

    if (!res.ok) {
      await throwSandboxResponseError("Read file failed", res);
    }

    return await readSandboxText(res, "Sandbox file response", this.controlRequestTimeoutMs);
  }

  /** Write UTF-8 text files to the sandbox workspace. */
  async writeFiles(files: Array<{ path: string; content: string }>): Promise<void> {
    this.assertOpen();
    const normalizedFiles = normalizeSandboxWriteFiles(files);
    await this.touchSession();

    const res = await this.fetchControl(`${this.requireEndpoint()}/files`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ files: normalizedFiles }),
    });

    if (!res.ok) {
      await throwSandboxResponseError("Write files failed", res);
    }
    await discardSandboxResponse(res);
  }

  /** Start a background command and return its initial status. */
  async startBackgroundCommand(command: string, options?: ExecOptions): Promise<BackgroundCommand> {
    this.assertOpen();
    const projectId = this.resolveProjectId();
    const request = this.resolveExecRequest(command, options, projectId);
    await this.touchSession(projectId);
    const endpoint = this.resolveRuntimeEndpoint();

    const res = await this.fetchControl(`${endpoint}/exec/commands`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      await throwSandboxResponseError("Start background command failed", res);
    }

    const backgroundCommand = parseBackgroundCommand(
      await readSandboxJson(
        res,
        "Start background command response",
        this.controlRequestTimeoutMs,
      ),
    );
    this.updateTrackedBackgroundCommand(backgroundCommand, endpoint);
    return backgroundCommand;
  }

  /** Read the current status of a background command. */
  async getBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    this.assertOpen();
    const id = normalizeSandboxIdentifier(commandId, "Background command ID");
    const endpoint = await this.resolveBackgroundCommandEndpoint(id);

    const res = await this.fetchControl(
      `${endpoint}/exec/commands/${encodeURIComponent(id)}`,
      {
        headers: this.authHeaders(),
      },
    );

    if (!res.ok) {
      await throwSandboxResponseError("Get background command failed", res);
    }

    const backgroundCommand = parseBackgroundCommand(
      await readSandboxJson(res, "Get background command response", this.controlRequestTimeoutMs),
    );
    this.updateTrackedBackgroundCommand(backgroundCommand, endpoint);
    return backgroundCommand;
  }

  /** Read captured output and terminal metadata for a background command. */
  async getBackgroundCommandOutput(commandId: string): Promise<BackgroundCommandOutput> {
    this.assertOpen();
    const id = normalizeSandboxIdentifier(commandId, "Background command ID");
    const endpoint = await this.resolveBackgroundCommandEndpoint(id);

    const res = await this.fetchControl(
      `${endpoint}/exec/commands/${encodeURIComponent(id)}/output`,
      {
        headers: this.authHeaders(),
      },
    );

    if (!res.ok) {
      await throwSandboxResponseError("Get background command output failed", res);
    }

    const output = parseBackgroundCommandOutput(
      await readSandboxJson(
        res,
        "Get background command output response",
        this.controlRequestTimeoutMs,
      ),
    );
    this.updateTrackedBackgroundCommand(output, endpoint);
    return output;
  }

  /** List background commands in the current session. */
  async listBackgroundCommands(): Promise<BackgroundCommand[]> {
    this.assertOpen();
    await this.touchSession();
    const endpoint = this.resolveRuntimeEndpoint();

    const res = await this.fetchControl(`${endpoint}/exec/commands`, {
      headers: this.authHeaders(),
    });

    if (!res.ok) {
      await throwSandboxResponseError("List background commands failed", res);
    }

    const commands = parseBackgroundCommandList(
      await readSandboxJson(
        res,
        "List background commands response",
        this.controlRequestTimeoutMs,
      ),
    );
    this.reconcileTrackedBackgroundCommands(commands, endpoint);
    return commands;
  }

  /** Cancel a background command. */
  async cancelBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    this.assertOpen();
    const id = normalizeSandboxIdentifier(commandId, "Background command ID");
    const endpoint = await this.resolveBackgroundCommandEndpoint(id);

    const res = await this.fetchControl(
      `${endpoint}/exec/commands/${encodeURIComponent(id)}/cancel`,
      {
        method: "POST",
        headers: this.authHeaders(),
      },
    );

    if (!res.ok) {
      await throwSandboxResponseError("Cancel background command failed", res);
    }

    const backgroundCommand = parseBackgroundCommand(
      await readSandboxJson(
        res,
        "Cancel background command response",
        this.controlRequestTimeoutMs,
      ),
    );
    this.updateTrackedBackgroundCommand(backgroundCommand, endpoint);
    return backgroundCommand;
  }

  /** Send a session heartbeat, optionally bypassing the grace period. */
  async heartbeat(force = false): Promise<void> {
    this.assertOpen();
    await this.sendHeartbeat(force, true);
  }

  /** Send one deduplicated heartbeat and optionally recover a reclaimed session. */
  private async sendHeartbeat(force: boolean, recoverOnFailure: boolean): Promise<void> {
    const currentSessionId = this.sessionId;
    if (!currentSessionId) return;

    if (this.heartbeatPromise) {
      await this.heartbeatPromise.promise;
      return;
    }

    if (
      !force && this.lastHeartbeatAt > 0 &&
      Date.now() - this.lastHeartbeatAt < this.heartbeatGraceMs
    ) {
      return;
    }

    const pending = {
      promise: (async () => {
        const res = await this.fetchControl(
          `${this.apiUrl}/sandbox-sessions/${encodeURIComponent(currentSessionId)}/heartbeat`,
          {
            method: "POST",
            headers: this.authHeaders(),
          },
        );

        if (!res.ok) {
          let heartbeatError: unknown;
          try {
            await throwSandboxResponseError("Sandbox heartbeat failed", res);
          } catch (error) {
            heartbeatError = error;
          }
          if (
            recoverOnFailure && this.sessionId === currentSessionId &&
            this.activeBackgroundCommandEndpoints.size === 0
          ) {
            try {
              await this.cleanupFailedSession(currentSessionId);
            } catch (cleanupError) {
              throw new AggregateError(
                [heartbeatError, cleanupError],
                "Sandbox heartbeat and cleanup failed",
              );
            }
          }
          throw heartbeatError;
        }

        await discardSandboxResponse(res);
        if (this.sessionId === currentSessionId) this.lastHeartbeatAt = Date.now();
      })(),
    };

    this.heartbeatPromise = pending;

    try {
      await pending.promise;
    } finally {
      if (this.heartbeatPromise === pending) {
        this.heartbeatPromise = null;
      }
    }
  }

  /** Close or detach the session. A successfully closed lazy client cannot be reused. */
  async close(): Promise<void> {
    if (this.closed) return;
    if (this.closePromise) {
      await this.closePromise.promise;
      return;
    }

    this.closing = true;
    this.stopHeartbeatLoop();
    const pending = {
      promise: (async () => {
        if (this.ensurePromise) {
          try {
            await this.ensurePromise.promise;
          } catch (error) {
            // startup failure already handled by the caller path
            logger.debug("Lazy sandbox startup failed while closing; continuing cleanup", {
              error,
            });
          }
        }

        if (this.sessionTransitionPromise) {
          try {
            await this.sessionTransitionPromise.promise;
          } catch (error) {
            logger.debug("Lazy sandbox session transition failed while closing; retrying cleanup", {
              error,
            });
          }
        }

        if (this.heartbeatPromise) {
          try {
            await this.heartbeatPromise.promise;
          } catch (error) {
            logger.debug("Lazy sandbox heartbeat failed while closing; continuing cleanup", {
              error,
            });
          }
        }

        const currentSessionId = this.sessionId;
        if (!currentSessionId) {
          this.resetSessionState();
          this.closed = true;
          return;
        }

        if (this.deleteOnClose) {
          await this.deleteSession(currentSessionId, "Close sandbox failed");
        }
        this.resetSessionState(currentSessionId);
        this.closed = true;
      })(),
    };

    this.closePromise = pending;

    try {
      await pending.promise;
    } finally {
      if (this.closePromise === pending) {
        this.closePromise = null;
      }
      if (!this.closed) {
        this.closing = false;
        this.startHeartbeatLoop();
      }
    }
  }

  /** Current session identifier, when provisioned. */
  get id(): string | null {
    return this.sessionId;
  }

  /** Current public runtime endpoint, when provisioned. */
  get url(): string | null {
    return this.endpoint;
  }

  /** Whether the client currently owns an active runtime endpoint. */
  get isActive(): boolean {
    return !this.closing && !this.closed && this.endpoint !== null;
  }

  /** Attach, clean up an unresolved session, or provision a new session. */
  private async bootstrapSession(): Promise<void> {
    if (this.sandboxId) {
      await this.attachExistingSession(this.sandboxId);
      return;
    }

    if (this.sessionId && !this.endpoint) {
      const unresolvedSessionId = this.sessionId;
      if (this.deleteOnClose) {
        await this.cleanupFailedSession(unresolvedSessionId);
      } else {
        this.resetSessionState(unresolvedSessionId);
      }
    }

    for (let attempt = 1; attempt <= CREATED_SESSION_BOOTSTRAP_MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.bootstrapCreatedSession();
        return;
      } catch (error) {
        if (
          attempt >= CREATED_SESSION_BOOTSTRAP_MAX_ATTEMPTS ||
          !isDataPlaneReadinessFailure(error)
        ) {
          throw error;
        }
      }
    }
  }

  /** Create and initialize one SDK-owned session. */
  private async bootstrapCreatedSession(): Promise<void> {
    const projectId = this.resolveProjectId();
    const res = await this.fetchControl(`${this.apiUrl}/sandbox-sessions`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(projectId ? { project_id: projectId } : {}),
    });

    if (!res.ok) {
      await throwSandboxResponseError("Failed to create sandbox", res);
    }

    const createResponse = await readSandboxJson(
      res,
      "Sandbox create response",
      this.controlRequestTimeoutMs,
    );
    const createdSessionId = parseSandboxSessionId(createResponse);
    this.sessionId = createdSessionId;
    this.sessionProjectId = projectId;

    try {
      const session = parseSandboxSession(createResponse);
      const endpoint = await this.resolveReadyEndpoint(session);
      this.endpoint = endpoint;
      await this.sendHeartbeat(true, false);
      this.startHeartbeatLoop();
    } catch (error) {
      const currentSessionId = this.sessionId;
      if (currentSessionId && this.deleteOnClose) {
        try {
          await this.cleanupFailedSession(currentSessionId);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Sandbox startup and cleanup failed",
          );
        }
      } else {
        this.resetSessionState(currentSessionId ?? undefined);
      }
      throw error;
    }
  }

  /** Wait for control-plane and runtime readiness and return the public endpoint. */
  private async resolveReadyEndpoint(session: SandboxSessionRecord): Promise<string> {
    const readySession = session.status === "running"
      ? session
      : await this.waitForReadySession(session.id);

    await this.waitForRuntimeDataPlaneReady(readySession);
    return readySession.endpoint;
  }

  /** Resolve and initialize a configured existing session. */
  private async attachExistingSession(sessionId: string): Promise<void> {
    const projectId = this.resolveProjectId();
    this.sessionId = sessionId;
    this.sessionProjectId = projectId;

    try {
      const session = this.sandboxEndpoint
        ? { id: sessionId, endpoint: this.sandboxEndpoint, status: "running" }
        : await this.getSession(sessionId);
      this.endpoint = await this.resolveReadyEndpoint(session);
      await this.sendHeartbeat(true, false);
      this.startHeartbeatLoop();
    } catch (error) {
      this.resetSessionState(sessionId);
      throw error;
    }
  }

  /** Read and validate one session from the control plane. */
  private async getSession(sessionId: string): Promise<SandboxSessionRecord> {
    const res = await this.fetchControl(
      `${this.apiUrl}/sandbox-sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: this.authHeaders(),
      },
    );

    if (!res.ok) {
      await throwSandboxResponseError("Failed to get sandbox", res);
    }

    return parseSandboxSession(
      await readSandboxJson(res, "Sandbox get response", this.controlRequestTimeoutMs),
      { id: sessionId, status: "running" },
    );
  }

  /** Poll until the control plane reports a terminal startup state. */
  private async waitForReadySession(sessionId: string): Promise<SandboxSessionRecord> {
    const start = Date.now();

    while (Date.now() - start < this.startupTimeoutMs) {
      let remainingMs = this.startupTimeoutMs - (Date.now() - start);
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(this.pollIntervalMs, remainingMs))
      );
      remainingMs = this.startupTimeoutMs - (Date.now() - start);
      if (remainingMs <= 0) break;

      let res: Response;
      try {
        res = await this.fetchControl(
          `${this.apiUrl}/sandbox-sessions/${encodeURIComponent(sessionId)}`,
          {
            headers: this.authHeaders(),
          },
        );
      } catch (error) {
        if (error instanceof SandboxTransportError) continue;
        throw error;
      }

      if (!res.ok) {
        await discardSandboxResponse(res);
        continue;
      }

      const session = parseSandboxSession(
        await readSandboxJson(res, "Sandbox readiness response", this.controlRequestTimeoutMs),
        { id: sessionId },
      );
      if (session.status === "running") {
        return session;
      }
      if (session.status === "error" || session.status === "deleting") {
        throw INITIALIZATION_ERROR.create({
          detail: `Sandbox failed to start: status=${session.status}`,
        });
      }
    }

    throw TIMEOUT_ERROR.create({ detail: "Sandbox did not become ready within timeout" });
  }

  /** Verify an in-cluster runtime endpoint before using it. */
  private async waitForRuntimeDataPlaneReady(session: SandboxSessionRecord): Promise<void> {
    if (resolveDefaultSandboxRuntimeEndpoint({ endpoint: session.endpoint }) === session.endpoint) {
      return;
    }

    const runtimeEndpoint = this.resolveRuntimeEndpointFor(session.endpoint, session.id);
    const start = Date.now();

    while (Date.now() - start < this.startupTimeoutMs) {
      try {
        const res = await this.fetchControl(`${runtimeEndpoint}/readyz`);

        if (res.ok) {
          await discardSandboxResponse(res);
          return;
        }

        await discardSandboxResponse(res);
        if (!RETRYABLE_DATA_PLANE_READINESS_STATUS_CODES.has(res.status)) {
          break;
        }
      } catch (error) {
        if (!(error instanceof SandboxTransportError)) throw error;
      }

      const remainingMs = this.startupTimeoutMs - (Date.now() - start);
      if (remainingMs <= 0) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(this.pollIntervalMs, remainingMs))
      );
    }

    throw createDataPlaneReadinessError();
  }

  /** Reconcile project context, ensure a session, and refresh its heartbeat. */
  private async touchSession(projectId = this.resolveProjectId()): Promise<void> {
    this.assertOpen();
    await this.reconcileProjectSession(projectId);

    this.assertOpen();
    await this.ensure();
    await this.heartbeat();
  }

  private heartbeatFailureCount = 0;
  private static readonly HEARTBEAT_WARN_AFTER_FAILURES = 3;

  /** Start automatic heartbeats when the current session needs them. */
  private startHeartbeatLoop(): void {
    if (
      this.closing || this.closed || !this.sessionId || this.heartbeatTimer ||
      this.activeBackgroundCommandEndpoints.size > 0
    ) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat().then(() => {
        this.heartbeatFailureCount = 0;
      }).catch((error) => {
        this.heartbeatFailureCount++;
        if (this.heartbeatFailureCount >= LazySandbox.HEARTBEAT_WARN_AFTER_FAILURES) {
          logger.warn(
            `[sandbox] Heartbeat has failed ${this.heartbeatFailureCount} consecutive time(s); ` +
              "sandbox may have been reclaimed. Next operation will attempt to reprovision.",
            error,
          );
        }
      });
    }, this.heartbeatIntervalMs);
  }

  /** Stop automatic session heartbeats. */
  private stopHeartbeatLoop(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /** Delete one session and validate the control-plane response. */
  private async deleteSession(sessionId: string, operation: string): Promise<void> {
    const res = await this.fetchControl(
      `${this.apiUrl}/sandbox-sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
        headers: this.authHeaders(),
      },
    );
    if (!res.ok) await throwSandboxResponseError(operation, res);
    await discardSandboxResponse(res);
  }

  /** Serialize cleanup of a failed session. */
  private async cleanupFailedSession(sessionId: string): Promise<void> {
    await this.runSessionTransition(async () => {
      if (this.sessionId !== sessionId) return;
      await this.deleteSession(sessionId, "Sandbox cleanup failed");
      this.resetSessionState(sessionId);
    });
  }

  /** Replace an idle SDK-owned session when its project context changes. */
  private async reconcileProjectSession(projectId: string | null): Promise<void> {
    while (!this.sandboxId && this.endpoint && this.sessionProjectId !== projectId) {
      if (this.activeBackgroundCommandEndpoints.size > 0) {
        throw INITIALIZATION_ERROR.create({
          detail: "Sandbox project cannot change while background commands are running",
        });
      }
      await this.runSessionTransition(async () => {
        const currentSessionId = this.sessionId;
        if (!currentSessionId || !this.endpoint || this.sessionProjectId === projectId) return;
        if (this.activeBackgroundCommandEndpoints.size > 0) {
          throw INITIALIZATION_ERROR.create({
            detail: "Sandbox project cannot change while background commands are running",
          });
        }
        await this.deleteSession(currentSessionId, "Close stale sandbox failed");
        this.resetSessionState(currentSessionId);
      });
    }
  }

  /** Run one lifecycle transition after any earlier transition settles. */
  private async runSessionTransition(action: () => Promise<void>): Promise<void> {
    while (this.sessionTransitionPromise) {
      await this.sessionTransitionPromise.promise;
    }

    const pending = { promise: action() };
    this.sessionTransitionPromise = pending;
    try {
      await pending.promise;
    } finally {
      if (this.sessionTransitionPromise === pending) this.sessionTransitionPromise = null;
    }
  }

  /** Return the current endpoint or reject an invalid internal state. */
  private requireEndpoint(): string {
    if (!this.endpoint) {
      throw new Error("Sandbox endpoint unavailable");
    }
    return this.endpoint;
  }

  /** Resolve and validate the current project identity. */
  private resolveProjectId(): string | null {
    return normalizeSandboxProjectId(this.getProjectId()) ?? null;
  }

  /** Clear state only when it still belongs to the target session. */
  private resetSessionState(sessionId?: string): void {
    if (!sessionId || this.sessionId === sessionId) {
      this.stopHeartbeatLoop();
      this.activeBackgroundCommandEndpoints.clear();
      this.endpoint = null;
      this.sessionId = null;
      this.sessionProjectId = null;
      this.heartbeatPromise = null;
      this.lastHeartbeatAt = 0;
      this.heartbeatFailureCount = 0;
    }
  }

  /** Build a validated exec request with the current project reference. */
  private resolveExecRequest(
    command: string,
    options: ExecOptions | undefined,
    projectId: string | null,
  ): { command: string } & ExecOptions {
    const projectReference = options?.projectReference ?? projectId ?? undefined;
    return normalizeExecRequest(
      command,
      projectReference ? { ...options, projectReference } : options,
    );
  }

  /** Resolve the session endpoint that owns a background command. */
  private async resolveBackgroundCommandEndpoint(commandId: string): Promise<string> {
    const trackedEndpoint = this.activeBackgroundCommandEndpoints.get(commandId);
    if (trackedEndpoint) {
      return trackedEndpoint;
    }

    await this.ensure();
    return this.resolveRuntimeEndpoint();
  }

  /** Track running commands and resume session heartbeats after completion. */
  private updateTrackedBackgroundCommand(
    backgroundCommand: Pick<BackgroundCommand, "id" | "status">,
    endpoint: string,
  ): void {
    if (backgroundCommand.status === "running") {
      this.activeBackgroundCommandEndpoints.set(backgroundCommand.id, endpoint);
      this.stopHeartbeatLoop();
      return;
    }

    if (!this.activeBackgroundCommandEndpoints.delete(backgroundCommand.id)) {
      return;
    }

    if (this.activeBackgroundCommandEndpoints.size === 0 && this.endpoint) {
      this.startHeartbeatLoop();
    }
  }

  /** Reconcile local command tracking with a complete server list. */
  private reconcileTrackedBackgroundCommands(
    commands: BackgroundCommand[],
    endpoint: string,
  ): void {
    const returnedIds = new Set(commands.map((command) => command.id));
    for (const [commandId, trackedEndpoint] of this.activeBackgroundCommandEndpoints) {
      if (trackedEndpoint === endpoint && !returnedIds.has(commandId)) {
        this.activeBackgroundCommandEndpoints.delete(commandId);
      }
    }
    for (const command of commands) {
      if (command.status === "running") {
        this.activeBackgroundCommandEndpoints.set(command.id, endpoint);
      } else {
        this.activeBackgroundCommandEndpoints.delete(command.id);
      }
    }
    if (this.activeBackgroundCommandEndpoints.size === 0) this.startHeartbeatLoop();
    else this.stopHeartbeatLoop();
  }

  /** Start an exec request with bounded retry before response streaming begins. */
  private async startExec(request: { command: string } & ExecOptions): Promise<Response> {
    const endpoint = this.resolveRuntimeEndpoint();
    const body = JSON.stringify(request);

    for (let attempt = 1; attempt <= this.execStartMaxAttempts; attempt += 1) {
      try {
        const res = await this.fetchExecStart(`${endpoint}/exec`, {
          method: "POST",
          headers: this.jsonHeaders(),
          body,
        });

        if (res.ok) {
          return res;
        }

        if (isRetryableExecStartStatus(res.status) && attempt < this.execStartMaxAttempts) {
          await discardSandboxResponse(res);
          await this.waitForExecStartRetry();
          continue;
        }

        await throwSandboxResponseError("Exec failed", res);
      } catch (error) {
        if (!isRetryableExecStartError(error) || attempt >= this.execStartMaxAttempts) {
          throw error;
        }

        await this.waitForExecStartRetry();
      }
    }

    throw new Error("Sandbox exec failed before a request was made");
  }

  /** Send a command-start request with its dedicated timeout. */
  private async fetchExecStart(url: string, init: RequestInit): Promise<Response> {
    return await fetchSandbox(url, this.execStartTimeoutMs, init);
  }

  /** Send a control request with the configured timeout. */
  private async fetchControl(url: string, init: RequestInit = {}): Promise<Response> {
    return await fetchSandbox(url, this.controlRequestTimeoutMs, init);
  }

  /** Delay the next command-start attempt. */
  private waitForExecStartRetry(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.execStartRetryDelayMs));
  }

  /** Dispose an unreachable idle session before reprovisioning. */
  private async reprovisionAfterExecStartFailure(): Promise<void> {
    const sessionId = this.sessionId;
    if (!sessionId) return;

    await this.runSessionTransition(async () => {
      if (this.sessionId !== sessionId) return;
      if (this.deleteOnClose) {
        await this.deleteSession(sessionId, "Close unreachable sandbox failed");
      }
      this.resetSessionState(sessionId);
    });
  }

  /** Resolve the runtime endpoint for the current session. */
  private resolveRuntimeEndpoint(): string {
    const endpoint = this.requireEndpoint();
    const sessionId = this.requireSessionId();
    return this.resolveRuntimeEndpointFor(endpoint, sessionId);
  }

  /** Apply the endpoint resolver and validate its result. */
  private resolveRuntimeEndpointFor(endpoint: string, sessionId: string): string {
    const resolved = this.resolveRuntimeEndpointOption?.({ endpoint, sessionId }) ??
      resolveDefaultSandboxRuntimeEndpoint({ endpoint });
    return normalizeSandboxBaseUrl(resolved, "Sandbox runtime endpoint");
  }

  /** Return the current session ID or reject an invalid internal state. */
  private requireSessionId(): string {
    if (!this.sessionId) {
      throw new Error("Sandbox session unavailable");
    }

    return this.sessionId;
  }

  /** Build authentication headers for sandbox requests. */
  private authHeaders(): HeadersInit {
    return { Authorization: `Bearer ${this.authToken}` };
  }

  /** Build JSON request headers for sandbox requests. */
  private jsonHeaders(): HeadersInit {
    return {
      ...this.authHeaders(),
      "Content-Type": "application/json",
    };
  }

  /** Reject operations after close begins. */
  private assertOpen(): void {
    if (this.closing || this.closed) throw sandboxClosedError();
  }
}

function isRetryableExecStartStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function isRetryableExecStartError(error: unknown): boolean {
  return error instanceof SandboxTransportError;
}

function isDataPlaneReadinessFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && DATA_PLANE_READINESS_ERRORS.has(error);
}

function shouldReprovisionAfterExecStartFailure(error: unknown): boolean {
  return error instanceof SandboxTransportError && error.kind === "network" &&
    error.code !== undefined && REPROVISIONABLE_EXEC_START_ERROR_CODES.has(error.code);
}
