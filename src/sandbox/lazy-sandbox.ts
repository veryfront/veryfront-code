import { CONFIG_INVALID, REQUEST_ERROR } from "#veryfront/errors";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { logger, sleep } from "#veryfront/utils";
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
  /** Resolve project context once per operation; supersedes projectId when provided. */
  getProjectId?: () => string | null | undefined;
  /** Interval between automatic session heartbeats, in milliseconds. */
  heartbeatIntervalMs?: number;
  /** Minimum age of the last successful heartbeat before sending another. */
  heartbeatGraceMs?: number;
  /** Deadline for opening an exec response stream, in milliseconds. Zero disables it. */
  execStartTimeoutMs?: number;
  /** Maximum attempts to open an exec stream before the operation fails or reprovisions. */
  execStartMaxAttempts?: number;
  /** Delay between exec stream startup attempts, in milliseconds. */
  execStartRetryDelayMs?: number;
  /** Resolve an internal data-plane endpoint for hosted runtimes. */
  resolveRuntimeEndpoint?: (input: { endpoint: string; sessionId: string }) => string;
}

interface PendingOperation {
  promise: Promise<void>;
}

interface PendingEnsureOperation extends PendingOperation {
  projectId: string | null;
}

interface DataPlaneRoute {
  baseUrl: string;
  kind: "internal" | "proxy";
}

interface TrackedBackgroundCommand {
  commandsUrl: string;
  routeKind: DataPlaneRoute["kind"];
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_GRACE_MS = 5_000;
const DEFAULT_EXEC_START_TIMEOUT_MS = 30_000;
const DEFAULT_EXEC_START_MAX_ATTEMPTS = 3;
const DEFAULT_EXEC_START_RETRY_DELAY_MS = 1_000;
const CREATED_SESSION_BOOTSTRAP_MAX_ATTEMPTS = 2;
const RETRYABLE_DATA_PLANE_READINESS_STATUS_CODES = new Set([404, 502, 503, 504]);
const VERYFRONT_SANDBOX_PUBLIC_HOST_PATTERN =
  /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.sandbox\.veryfront\.[a-z0-9.-]+$/i;

class SandboxDataPlaneReadinessCause extends Error {
  constructor() {
    super("Sandbox data plane did not become ready");
    this.name = "SandboxDataPlaneReadinessCause";
  }
}

function resolveTimerOption(
  value: number | undefined,
  fallback: number,
  label: string,
  minimum: number,
  maximum = MAX_SANDBOX_TIMER_MS,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new RangeError(`${label} must be a safe integer between ${minimum} and ${maximum}`);
  }
  return resolved;
}

/** Resolves default sandbox runtime endpoint. */
export function resolveDefaultSandboxRuntimeEndpoint(input: { endpoint: string }): string {
  const endpoint = normalizeDataPlaneBaseUrl(input.endpoint);
  if (!getHostEnv("KUBERNETES_SERVICE_HOST")) {
    return endpoint;
  }

  const hostname = new URL(endpoint).hostname;

  const match = hostname.match(VERYFRONT_SANDBOX_PUBLIC_HOST_PATTERN);
  const shortId = match?.[1];
  if (!shortId) {
    return endpoint;
  }

  return `http://sandbox.veryfront-sandbox-${shortId}.svc.cluster.local`;
}

function normalizeDataPlaneBaseUrl(url: string): string {
  const normalized = url.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TypeError("Sandbox runtime endpoint must be an absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("Sandbox runtime endpoint must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new TypeError("Sandbox runtime endpoint must not contain credentials");
  }
  if (parsed.search || parsed.hash) {
    throw new TypeError("Sandbox runtime endpoint must not contain a query string or fragment");
  }
  return normalized;
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
  private ensurePromise: PendingEnsureOperation | null = null;
  private closePromise: PendingOperation | null = null;
  private heartbeatPromise: PendingOperation | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatAt = 0;
  private readonly activeBackgroundCommands = new Map<string, TrackedBackgroundCommand>();

  constructor(options: LazySandboxOptions = {}) {
    this.apiUrl = resolveSandboxApiUrl(options);
    this.authToken = resolveSandboxAuthToken(options);
    if (
      options.sandboxId !== undefined &&
      (typeof options.sandboxId !== "string" || !options.sandboxId.trim())
    ) {
      throw CONFIG_INVALID.create({
        detail: "Sandbox sandboxId must be a non-empty string when provided",
      });
    }
    if (
      options.sandboxEndpoint !== undefined &&
      (typeof options.sandboxEndpoint !== "string" || !options.sandboxEndpoint.trim())
    ) {
      throw CONFIG_INVALID.create({
        detail: "Sandbox sandboxEndpoint must be a non-empty string when provided",
      });
    }
    if (options.sandboxEndpoint !== undefined && options.sandboxId === undefined) {
      throw CONFIG_INVALID.create({
        detail: "Sandbox sandboxEndpoint requires sandboxId",
      });
    }
    if (options.deleteOnClose !== undefined && typeof options.deleteOnClose !== "boolean") {
      throw CONFIG_INVALID.create({ detail: "Sandbox deleteOnClose must be a boolean" });
    }
    if (options.getProjectId !== undefined && typeof options.getProjectId !== "function") {
      throw CONFIG_INVALID.create({ detail: "Sandbox getProjectId must be a function" });
    }
    if (
      options.resolveRuntimeEndpoint !== undefined &&
      typeof options.resolveRuntimeEndpoint !== "function"
    ) {
      throw CONFIG_INVALID.create({
        detail: "Sandbox resolveRuntimeEndpoint must be a function",
      });
    }

    this.sandboxId = options.sandboxId === undefined
      ? undefined
      : validateSandboxRouteValue(options.sandboxId.trim(), "Sandbox session id");
    this.sandboxEndpoint = options.sandboxEndpoint === undefined
      ? undefined
      : normalizeDataPlaneBaseUrl(options.sandboxEndpoint);
    this.deleteOnClose = options.deleteOnClose ?? !this.sandboxId;
    this.getProjectId = options.getProjectId ?? (() => options.projectId);
    this.startupTimeoutMs = resolveSandboxStartupTimeoutMs(options);
    this.pollIntervalMs = resolveSandboxPollIntervalMs(options);
    this.heartbeatIntervalMs = resolveTimerOption(
      options.heartbeatIntervalMs,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
      "Sandbox heartbeatIntervalMs",
      1,
    );
    this.heartbeatGraceMs = resolveTimerOption(
      options.heartbeatGraceMs,
      DEFAULT_HEARTBEAT_GRACE_MS,
      "Sandbox heartbeatGraceMs",
      0,
    );
    this.controlRequestTimeoutMs = resolveSandboxControlRequestTimeoutMs(
      options,
      DEFAULT_SANDBOX_CONTROL_REQUEST_TIMEOUT_MS,
    );
    this.execStartTimeoutMs = resolveTimerOption(
      options.execStartTimeoutMs,
      DEFAULT_EXEC_START_TIMEOUT_MS,
      "Sandbox execStartTimeoutMs",
      0,
    );
    this.execStartMaxAttempts = resolveTimerOption(
      options.execStartMaxAttempts,
      DEFAULT_EXEC_START_MAX_ATTEMPTS,
      "Sandbox execStartMaxAttempts",
      1,
      100,
    );
    this.execStartRetryDelayMs = resolveTimerOption(
      options.execStartRetryDelayMs,
      DEFAULT_EXEC_START_RETRY_DELAY_MS,
      "Sandbox execStartRetryDelayMs",
      0,
    );
    this.resolveRuntimeEndpointOption = options.resolveRuntimeEndpoint;
  }

  async ensure(): Promise<void> {
    await this.ensureForProject(this.resolveProjectId());
  }

  private async ensureForProject(projectId: string | null): Promise<void> {
    if (this.endpoint) return;
    if (this.ensurePromise) {
      if (this.ensurePromise.projectId !== projectId) {
        throw REQUEST_ERROR.create({
          detail: "Sandbox project context changed while the session was being provisioned",
        });
      }
      await this.ensurePromise.promise;
      return;
    }

    const pending = {
      projectId,
      promise: this.bootstrapSession(projectId),
    };
    this.ensurePromise = pending;

    try {
      await pending.promise;
    } finally {
      if (this.ensurePromise === pending) {
        this.ensurePromise = null;
      }
    }
  }

  async executeCommand(command: string, options?: ExecOptions): Promise<ExecResult> {
    const projectId = this.resolveProjectId();
    const request = normalizeSandboxExecRequest(command, options, projectId);
    return await collectSandboxExecResult(
      this.executeNormalizedStream(request.payload, projectId),
      request.maxOutputBytes,
    );
  }

  async *executeStream(command: string, options?: ExecOptions): AsyncGenerator<ExecStreamEvent> {
    const projectId = this.resolveProjectId();
    const request = normalizeSandboxExecRequest(command, options, projectId);
    yield* this.executeNormalizedStream(request.payload, projectId);
  }

  private async *executeNormalizedStream(
    payload: ReturnType<typeof normalizeSandboxExecRequest>["payload"],
    projectId: string | null,
  ): AsyncGenerator<ExecStreamEvent> {
    await this.touchSession(projectId);
    let res: Response;
    try {
      res = await this.startExec(payload);
    } catch (error) {
      if (
        this.activeBackgroundCommands.size > 0 ||
        !shouldReprovisionAfterExecStartFailure(error)
      ) {
        throw error;
      }

      await this.reprovisionAfterExecStartFailure();
      await this.touchSession(projectId);
      res = await this.startExec(payload);
    }

    if (!res.body) {
      throw REQUEST_ERROR.create({ detail: "Exec failed: response has no body" });
    }
    yield* decodeSandboxExecStream(res.body);
  }

  async readFile(path: string): Promise<string> {
    const normalizedPath = validateSandboxRouteValue(path, "Sandbox file path");
    await this.touchSession();
    return await requestSandboxResponse({
      url: `${this.resolveDataPlaneRoute().baseUrl}/file?path=${
        encodeURIComponent(normalizedPath)
      }`,
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Read file failed",
      init: { headers: this.authHeaders() },
      consume: async (response, signal) =>
        await readSandboxFileContent(response, {
          operation: "Read file failed",
          signal,
        }),
    });
  }

  async writeFiles(files: Array<{ path: string; content: string }>): Promise<void> {
    const normalizedFiles = normalizeSandboxFiles(files);
    await this.touchSession();
    await requestSandboxVoid({
      url: `${this.resolveDataPlaneRoute().baseUrl}/files`,
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Write files failed",
      init: {
        method: "POST",
        headers: this.jsonHeaders(),
        body: JSON.stringify({ files: normalizedFiles }),
      },
    });
  }

  async startBackgroundCommand(command: string, options?: ExecOptions): Promise<BackgroundCommand> {
    const projectId = this.resolveProjectId();
    const request = normalizeSandboxExecRequest(command, options, projectId);
    await this.touchSession(projectId);
    const route = this.resolveDataPlaneRoute();

    const commandsUrl = backgroundCommandsUrl(route);
    const value = await requestSandboxJson({
      url: commandsUrl,
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Start background command failed",
      init: {
        method: "POST",
        headers: this.jsonHeaders(),
        body: JSON.stringify(request.payload),
      },
    });
    const backgroundCommand = parseBackgroundCommand(value, "Start background command failed");
    this.updateTrackedBackgroundCommand(backgroundCommand, {
      commandsUrl,
      routeKind: route.kind,
    });
    return backgroundCommand;
  }

  async getBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    const id = validateSandboxRouteValue(commandId, "Sandbox command id");
    const route = await this.resolveBackgroundCommandRoute(id);
    const value = await requestSandboxJson({
      url: `${route.commandsUrl}/${encodeURIComponent(id)}`,
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Get background command failed",
      init: { headers: this.authHeaders() },
    });
    const backgroundCommand = parseBackgroundCommand(value, "Get background command failed");
    this.updateTrackedBackgroundCommand(backgroundCommand, route);
    return backgroundCommand;
  }

  async getBackgroundCommandOutput(commandId: string): Promise<BackgroundCommandOutput> {
    const id = validateSandboxRouteValue(commandId, "Sandbox command id");
    const route = await this.resolveBackgroundCommandRoute(id);
    const value = await requestSandboxJson({
      url: `${route.commandsUrl}/${encodeURIComponent(id)}/output`,
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Get background command output failed",
      init: { headers: this.authHeaders() },
    });
    const output = parseBackgroundCommandOutput(
      value,
      "Get background command output failed",
    );
    this.updateTrackedBackgroundCommand(output, route);
    return output;
  }

  async listBackgroundCommands(): Promise<BackgroundCommand[]> {
    await this.ensure();
    const value = await requestSandboxJson({
      url: backgroundCommandsUrl(this.resolveDataPlaneRoute()),
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "List background commands failed",
      init: { headers: this.authHeaders() },
    });
    return parseBackgroundCommandList(value, "List background commands failed");
  }

  async cancelBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    const id = validateSandboxRouteValue(commandId, "Sandbox command id");
    const route = await this.resolveBackgroundCommandRoute(id);
    const value = await requestSandboxJson({
      url: `${route.commandsUrl}/${encodeURIComponent(id)}/cancel`,
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Cancel background command failed",
      init: {
        method: "POST",
        headers: this.authHeaders(),
      },
    });
    const backgroundCommand = parseBackgroundCommand(value, "Cancel background command failed");
    this.updateTrackedBackgroundCommand(backgroundCommand, route);
    return backgroundCommand;
  }

  async heartbeat(force = false): Promise<void> {
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
        try {
          await requestSandboxVoid({
            url: `${this.apiUrl}/sandbox-sessions/${
              encodeURIComponent(currentSessionId)
            }/heartbeat`,
            timeoutMs: this.controlRequestTimeoutMs,
            operation: "Sandbox heartbeat failed",
            init: {
              method: "POST",
              headers: this.authHeaders(),
            },
          });
        } catch (error) {
          if (
            this.sessionId === currentSessionId &&
            this.activeBackgroundCommands.size === 0
          ) {
            try {
              await this.deleteSession(currentSessionId);
            } catch (cleanupError) {
              logger.warn("[sandbox] Failed to clean up a session after heartbeat failure", {
                cleanupError,
                sessionId: currentSessionId,
              });
            }
            this.resetSessionState(currentSessionId);
          }
          throw error;
        }

        if (this.sessionId === currentSessionId) {
          this.lastHeartbeatAt = Date.now();
        }
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

  async close(): Promise<void> {
    if (this.closePromise) {
      await this.closePromise.promise;
      return;
    }

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

        const currentSessionId = this.sessionId;
        if (!currentSessionId) {
          this.resetSessionState();
          return;
        }

        if (this.deleteOnClose) {
          await this.deleteSession(currentSessionId);
        }
        this.resetSessionState(currentSessionId);
      })(),
    };

    this.closePromise = pending;

    try {
      await pending.promise;
    } finally {
      if (this.closePromise === pending) {
        this.closePromise = null;
      }
    }
  }

  get id(): string | null {
    return this.sessionId;
  }

  get url(): string | null {
    return this.endpoint;
  }

  get isActive(): boolean {
    return this.endpoint !== null;
  }

  private async bootstrapSession(projectId: string | null): Promise<void> {
    if (this.sandboxId) {
      await this.attachExistingSession(this.sandboxId, projectId);
      return;
    }

    for (let attempt = 1; attempt <= CREATED_SESSION_BOOTSTRAP_MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.bootstrapCreatedSession(projectId);
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

  private async bootstrapCreatedSession(projectId: string | null): Promise<void> {
    const value = await requestSandboxJson({
      url: `${this.apiUrl}/sandbox-sessions`,
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Failed to create sandbox",
      init: {
        method: "POST",
        headers: this.jsonHeaders(),
        body: JSON.stringify(projectId ? { project_id: projectId } : {}),
      },
    });
    const session = parseSandboxSessionRecord(value, "Failed to create sandbox", {
      requireId: true,
    });
    this.sessionId = session.id;
    this.sessionProjectId = projectId;

    try {
      const endpoint = await this.resolveReadyEndpoint(
        session,
        Date.now() + this.startupTimeoutMs,
      );
      this.endpoint = endpoint;
      await this.heartbeat(true);
      this.startHeartbeatLoop();
    } catch (error) {
      const currentSessionId = this.sessionId;
      if (currentSessionId && this.deleteOnClose) {
        try {
          await this.deleteSession(currentSessionId);
        } catch (cleanupError) {
          logger.warn("[sandbox] Failed to clean up a session after startup failure", {
            cleanupError,
            sessionId: currentSessionId,
          });
        }
      }
      this.resetSessionState(currentSessionId ?? undefined);
      throw error;
    }
  }

  private async resolveReadyEndpoint(
    session: SandboxSessionRecord,
    deadline: number,
  ): Promise<string> {
    const readySession = session.status === "running"
      ? session
      : await this.waitForReadySession(session.id, deadline);

    if (readySession.endpoint === null) {
      throw REQUEST_ERROR.create({
        detail: "Sandbox became ready without an endpoint",
      });
    }
    if (this.shouldUseInternalDataPlane(readySession.endpoint, readySession.id)) {
      await this.waitForRuntimeDataPlaneReady(readySession, deadline);
    }
    return readySession.endpoint;
  }

  private async attachExistingSession(
    sessionId: string,
    projectId: string | null,
  ): Promise<void> {
    this.sessionId = sessionId;
    this.sessionProjectId = projectId;

    try {
      const session = this.sandboxEndpoint
        ? { id: sessionId, endpoint: this.sandboxEndpoint, status: "running" }
        : await this.getSession(sessionId);
      this.endpoint = await this.resolveReadyEndpoint(
        session,
        Date.now() + this.startupTimeoutMs,
      );
      await this.heartbeat(true);
      this.startHeartbeatLoop();
    } catch (error) {
      this.resetSessionState(sessionId);
      throw error;
    }
  }

  private async getSession(sessionId: string): Promise<SandboxSessionRecord> {
    const value = await requestSandboxJson({
      url: `${this.apiUrl}/sandbox-sessions/${encodeURIComponent(sessionId)}`,
      timeoutMs: this.controlRequestTimeoutMs,
      operation: "Failed to get sandbox",
      init: { headers: this.authHeaders() },
    });
    return parseSandboxSessionRecord(value, "Failed to get sandbox", {
      expectedId: sessionId,
    });
  }

  private async waitForReadySession(
    sessionId: string,
    deadline: number,
  ): Promise<SandboxSessionRecord> {
    while (Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      const requestTimeoutMs = this.controlRequestTimeoutMs === 0
        ? 0
        : Math.max(1, Math.min(this.controlRequestTimeoutMs, remainingMs));
      let session: SandboxSessionRecord;
      try {
        const value = await requestSandboxJson({
          url: `${this.apiUrl}/sandbox-sessions/${encodeURIComponent(sessionId)}`,
          timeoutMs: requestTimeoutMs,
          operation: "Failed to check sandbox readiness",
          init: { headers: this.authHeaders() },
        });
        session = parseSandboxSessionRecord(value, "Failed to check sandbox readiness", {
          expectedId: sessionId,
        });
      } catch (error) {
        if (!isRetryableReadinessError(error)) throw error;
        await this.waitForPoll(deadline);
        continue;
      }

      if (session.status === "running") {
        return session;
      }
      if (session.status === "error" || session.status === "deleting") {
        throw REQUEST_ERROR.create({
          detail: `Sandbox failed to start: status=${session.status}`,
        });
      }
      await this.waitForPoll(deadline);
    }

    throw REQUEST_ERROR.create({ detail: "Sandbox did not become ready within timeout" });
  }

  private async waitForRuntimeDataPlaneReady(
    session: SandboxSessionRecord,
    deadline: number,
  ): Promise<void> {
    if (session.endpoint === null) {
      throw REQUEST_ERROR.create({ detail: "Sandbox became ready without an endpoint" });
    }
    const runtimeEndpoint = this.resolveRuntimeEndpointFor(session.endpoint, session.id);
    let lastFailure = `sandbox status is ${session.status}`;

    while (Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      const requestTimeoutMs = this.controlRequestTimeoutMs === 0
        ? 0
        : Math.max(1, Math.min(this.controlRequestTimeoutMs, remainingMs));
      try {
        await requestSandboxVoid({
          url: `${runtimeEndpoint}/readyz`,
          timeoutMs: requestTimeoutMs,
          operation: "Sandbox data-plane readiness check failed",
        });
        return;
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
        const status = getSandboxHttpErrorStatus(error);
        if (
          status !== undefined &&
          !RETRYABLE_DATA_PLANE_READINESS_STATUS_CODES.has(status)
        ) {
          throw error;
        }
        if (
          status === undefined &&
          !isSandboxRequestTimeout(error) &&
          !isSandboxTransportError(error)
        ) {
          throw error;
        }
      }

      await this.waitForPoll(deadline);
    }

    throw REQUEST_ERROR.create({
      detail: `Sandbox data plane did not become ready: ${lastFailure}`,
      cause: new SandboxDataPlaneReadinessCause(),
    });
  }

  private async waitForPoll(deadline: number): Promise<void> {
    const waitMs = Math.min(this.pollIntervalMs, Math.max(0, deadline - Date.now()));
    if (waitMs > 0) await sleep(waitMs);
  }

  private async touchSession(projectId = this.resolveProjectId()): Promise<void> {
    if (!this.sandboxId && this.endpoint && this.sessionProjectId !== projectId) {
      if (this.activeBackgroundCommands.size > 0) {
        throw REQUEST_ERROR.create({
          detail:
            "Sandbox project context cannot change while background commands are still running",
        });
      }
      const currentSessionId = this.sessionId;
      if (currentSessionId) {
        await this.deleteSession(currentSessionId);
      }
      this.resetSessionState(currentSessionId ?? undefined);
    }

    await this.ensureForProject(projectId);
    await this.heartbeat();
  }

  private heartbeatFailureCount = 0;
  private static readonly HEARTBEAT_WARN_AFTER_FAILURES = 3;

  private startHeartbeatLoop(): void {
    if (!this.sessionId || this.heartbeatTimer || this.hasActiveInternalBackgroundCommand()) {
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

  private stopHeartbeatLoop(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async deleteSession(sessionId: string): Promise<void> {
    try {
      await requestSandboxVoid({
        url: `${this.apiUrl}/sandbox-sessions/${encodeURIComponent(sessionId)}`,
        timeoutMs: this.controlRequestTimeoutMs,
        operation: "Close sandbox failed",
        init: {
          method: "DELETE",
          headers: this.authHeaders(),
        },
      });
    } catch (error) {
      if (getSandboxHttpErrorStatus(error) === 404) return;
      throw error;
    }
  }

  private requireEndpoint(): string {
    if (!this.endpoint) {
      throw new Error("Sandbox endpoint unavailable");
    }
    return this.endpoint;
  }

  private resolveProjectId(): string | null {
    return resolveSandboxProjectId(this.getProjectId()) ?? null;
  }

  private resetSessionState(sessionId?: string): void {
    if (!sessionId || this.sessionId === sessionId) {
      this.stopHeartbeatLoop();
      this.activeBackgroundCommands.clear();
      this.endpoint = null;
      this.sessionId = null;
      this.sessionProjectId = null;
      this.heartbeatPromise = null;
      this.lastHeartbeatAt = 0;
      this.heartbeatFailureCount = 0;
    }
  }

  private async resolveBackgroundCommandRoute(
    commandId: string,
  ): Promise<TrackedBackgroundCommand> {
    const trackedCommand = this.activeBackgroundCommands.get(commandId);
    if (trackedCommand) {
      return trackedCommand;
    }

    await this.ensure();
    const route = this.resolveDataPlaneRoute();
    return {
      commandsUrl: backgroundCommandsUrl(route),
      routeKind: route.kind,
    };
  }

  private updateTrackedBackgroundCommand(
    backgroundCommand: Pick<BackgroundCommand, "id" | "status">,
    command: TrackedBackgroundCommand,
  ): void {
    if (backgroundCommand.status === "running") {
      this.activeBackgroundCommands.set(backgroundCommand.id, command);
      if (command.routeKind === "internal") {
        this.stopHeartbeatLoop();
      }
      return;
    }

    if (!this.activeBackgroundCommands.delete(backgroundCommand.id)) {
      return;
    }

    if (!this.hasActiveInternalBackgroundCommand() && this.endpoint) {
      this.startHeartbeatLoop();
    }
  }

  private hasActiveInternalBackgroundCommand(): boolean {
    for (const command of this.activeBackgroundCommands.values()) {
      if (command.routeKind === "internal") {
        return true;
      }
    }
    return false;
  }

  private async startExec(
    payload: ReturnType<typeof normalizeSandboxExecRequest>["payload"],
  ): Promise<Response> {
    const route = this.resolveDataPlaneRoute();
    const body = JSON.stringify(payload);

    for (let attempt = 1; attempt <= this.execStartMaxAttempts; attempt += 1) {
      try {
        return await requestSandboxStream({
          url: commandStreamUrl(route),
          timeoutMs: this.execStartTimeoutMs,
          operation: "Exec failed",
          init: {
            method: "POST",
            headers: this.jsonHeaders(),
            body,
          },
        });
      } catch (error) {
        if (!isRetryableExecStartError(error) || attempt >= this.execStartMaxAttempts) {
          throw error;
        }

        await this.waitForExecStartRetry();
      }
    }

    throw new Error("Sandbox exec failed before a request was made");
  }

  private waitForExecStartRetry(): Promise<void> {
    return sleep(this.execStartRetryDelayMs);
  }

  private async reprovisionAfterExecStartFailure(): Promise<void> {
    const sessionId = this.sessionId;
    if (!sessionId) return;

    if (this.deleteOnClose) {
      await this.deleteSession(sessionId);
    }
    this.resetSessionState(sessionId);
  }

  private resolveRuntimeEndpointFor(endpoint: string, sessionId: string): string {
    return normalizeDataPlaneBaseUrl(
      this.resolveRuntimeEndpointOption?.({ endpoint, sessionId }) ??
        resolveDefaultSandboxRuntimeEndpoint({ endpoint }),
    );
  }

  private shouldUseInternalDataPlane(endpoint: string, sessionId: string): boolean {
    if (!this.resolveRuntimeEndpointOption) {
      return false;
    }

    const runtimeEndpoint = this.resolveRuntimeEndpointFor(endpoint, sessionId);
    return normalizeDataPlaneBaseUrl(runtimeEndpoint) !== normalizeDataPlaneBaseUrl(endpoint);
  }

  private resolveDataPlaneRoute(): DataPlaneRoute {
    const endpoint = this.requireEndpoint();
    const sessionId = this.requireSessionId();
    if (!this.resolveRuntimeEndpointOption) {
      return {
        baseUrl: sandboxSessionRoute(this.apiUrl, sessionId),
        kind: "proxy",
      };
    }

    const runtimeEndpoint = this.resolveRuntimeEndpointFor(endpoint, sessionId);
    if (normalizeDataPlaneBaseUrl(runtimeEndpoint) !== normalizeDataPlaneBaseUrl(endpoint)) {
      return {
        baseUrl: normalizeDataPlaneBaseUrl(runtimeEndpoint),
        kind: "internal",
      };
    }

    return {
      baseUrl: sandboxSessionRoute(this.apiUrl, sessionId),
      kind: "proxy",
    };
  }

  private requireSessionId(): string {
    if (!this.sessionId) {
      throw new Error("Sandbox session unavailable");
    }

    return this.sessionId;
  }

  private authHeaders(): HeadersInit {
    return { Authorization: `Bearer ${this.authToken}` };
  }

  private jsonHeaders(): HeadersInit {
    return {
      ...this.authHeaders(),
      "Content-Type": "application/json",
    };
  }
}

function commandStreamUrl(route: DataPlaneRoute): string {
  return `${route.baseUrl}${route.kind === "internal" ? "/exec" : "/commands/stream"}`;
}

function backgroundCommandsUrl(route: DataPlaneRoute): string {
  return `${route.baseUrl}${route.kind === "internal" ? "/exec/commands" : "/commands"}`;
}

function isRetryableExecStartError(error: unknown): boolean {
  const status = getSandboxHttpErrorStatus(error);
  return status === 502 || status === 503 || status === 504 ||
    isSandboxRequestTimeout(error) ||
    isSandboxTransportError(error);
}

function isRetryableReadinessError(error: unknown): boolean {
  const status = getSandboxHttpErrorStatus(error);
  if (status !== undefined) {
    return status === 404 || status === 408 || status === 409 || status === 425 ||
      status === 429 || status === 500 || status === 502 || status === 503 ||
      status === 504;
  }
  return isSandboxRequestTimeout(error) ||
    isSandboxTransportError(error);
}

function isDataPlaneReadinessFailure(error: unknown): boolean {
  return error instanceof Error && error.cause instanceof SandboxDataPlaneReadinessCause;
}

function shouldReprovisionAfterExecStartFailure(error: unknown): boolean {
  return isRetryableExecStartError(error);
}
