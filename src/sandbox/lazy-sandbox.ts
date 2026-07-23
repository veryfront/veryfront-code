import { REQUEST_ERROR } from "#veryfront/errors";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { logger } from "#veryfront/utils";
import { resolveSandboxApiUrl, resolveSandboxAuthToken } from "./config.ts";
import { readSandboxFileContent, sandboxSessionRoute } from "./proxy-routes.ts";
import {
  type BackgroundCommand,
  type BackgroundCommandOutput,
  type BackgroundCommandStatus,
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
  getProjectId?: () => string | null | undefined;
  startupTimeoutMs?: number;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatGraceMs?: number;
  controlRequestTimeoutMs?: number;
  execStartTimeoutMs?: number;
  execStartMaxAttempts?: number;
  execStartRetryDelayMs?: number;
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

interface DataPlaneRoute {
  baseUrl: string;
  kind: "internal" | "proxy";
}

interface TrackedBackgroundCommand {
  commandsUrl: string;
  routeKind: DataPlaneRoute["kind"];
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
const DATA_PLANE_READINESS_FAILURE_PREFIX = "Sandbox data plane did not become ready:";
const RETRYABLE_DATA_PLANE_READINESS_STATUS_CODES = new Set([404, 502, 503, 504]);
const REPROVISIONABLE_EXEC_START_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EHOSTUNREACH",
]);
const VERYFRONT_SANDBOX_PUBLIC_HOST_PATTERN = /^([a-z0-9-]+)\.sandbox\.veryfront\.[a-z0-9.-]+$/i;

/** Resolves default sandbox runtime endpoint. */
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
  if (!shortId) {
    return input.endpoint;
  }

  return `http://sandbox.veryfront-sandbox-${shortId}.svc.cluster.local`;
}

function normalizeDataPlaneBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
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
  private closePromise: PendingOperation | null = null;
  private heartbeatPromise: PendingOperation | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatAt = 0;
  private readonly activeBackgroundCommands = new Map<string, TrackedBackgroundCommand>();

  constructor(options: LazySandboxOptions = {}) {
    this.apiUrl = resolveSandboxApiUrl(options);
    this.authToken = resolveSandboxAuthToken(options);
    this.sandboxId = options.sandboxId?.trim() || undefined;
    this.sandboxEndpoint = options.sandboxEndpoint?.trim() || undefined;
    this.deleteOnClose = options.deleteOnClose ?? !this.sandboxId;
    this.getProjectId = options.getProjectId ?? (() => options.projectId);
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.heartbeatGraceMs = options.heartbeatGraceMs ?? DEFAULT_HEARTBEAT_GRACE_MS;
    this.controlRequestTimeoutMs = options.controlRequestTimeoutMs ??
      DEFAULT_CONTROL_REQUEST_TIMEOUT_MS;
    this.execStartTimeoutMs = options.execStartTimeoutMs ?? DEFAULT_EXEC_START_TIMEOUT_MS;
    this.execStartMaxAttempts = options.execStartMaxAttempts ?? DEFAULT_EXEC_START_MAX_ATTEMPTS;
    this.execStartRetryDelayMs = options.execStartRetryDelayMs ??
      DEFAULT_EXEC_START_RETRY_DELAY_MS;
    this.resolveRuntimeEndpointOption = options.resolveRuntimeEndpoint;
  }

  async ensure(): Promise<void> {
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

  async *executeStream(command: string, options?: ExecOptions): AsyncGenerator<ExecStreamEvent> {
    await this.touchSession();
    let res: Response;
    try {
      res = await this.startExec(command, options);
    } catch (error) {
      if (!shouldReprovisionAfterExecStartFailure(error)) {
        throw error;
      }

      await this.reprovisionAfterExecStartFailure();
      await this.touchSession();
      res = await this.startExec(command, options);
    }

    if (!res.body) {
      throw new Error("Exec response has no body");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          completed = true;
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          yield JSON.parse(line) as ExecStreamEvent;
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        yield JSON.parse(buffer) as ExecStreamEvent;
      }
    } finally {
      if (!completed) {
        await reader.cancel().catch(() => {});
      }
      reader.releaseLock();
    }
  }

  async readFile(path: string): Promise<string> {
    await this.touchSession();

    const res = await this.fetchControl(
      `${this.resolveDataPlaneRoute().baseUrl}/file?path=${encodeURIComponent(path)}`,
      {
        headers: this.authHeaders(),
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({ detail: `Read file failed: ${res.status} ${await res.text()}` });
    }

    return await readSandboxFileContent(res);
  }

  async writeFiles(files: Array<{ path: string; content: string }>): Promise<void> {
    await this.touchSession();

    const res = await this.fetchControl(`${this.resolveDataPlaneRoute().baseUrl}/files`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ files }),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Write files failed: ${res.status} ${await res.text()}`,
      });
    }
  }

  async startBackgroundCommand(command: string, options?: ExecOptions): Promise<BackgroundCommand> {
    await this.touchSession();
    const route = this.resolveDataPlaneRoute();

    const commandsUrl = backgroundCommandsUrl(route);
    const res = await this.fetchControl(commandsUrl, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ command, ...this.resolveExecOptions(options) }),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Start background command failed: ${res.status} ${await res.text()}`,
      });
    }

    const backgroundCommand = mapBackgroundCommand(await res.json());
    this.updateTrackedBackgroundCommand(backgroundCommand, {
      commandsUrl,
      routeKind: route.kind,
    });
    return backgroundCommand;
  }

  async getBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    const route = await this.resolveBackgroundCommandRoute(commandId);

    const res = await this.fetchControl(
      `${route.commandsUrl}/${encodeURIComponent(commandId)}`,
      {
        headers: this.authHeaders(),
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Get background command failed: ${res.status} ${await res.text()}`,
      });
    }

    const backgroundCommand = mapBackgroundCommand(await res.json());
    this.updateTrackedBackgroundCommand(backgroundCommand, route);
    return backgroundCommand;
  }

  async getBackgroundCommandOutput(commandId: string): Promise<BackgroundCommandOutput> {
    const route = await this.resolveBackgroundCommandRoute(commandId);

    const res = await this.fetchControl(
      `${route.commandsUrl}/${encodeURIComponent(commandId)}/output`,
      {
        headers: this.authHeaders(),
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Get background command output failed: ${res.status} ${await res.text()}`,
      });
    }

    const json = await res.json();
    const output = {
      ...mapBackgroundCommand(json),
      stdout: json.stdout,
      stderr: json.stderr,
      stdoutTruncated: json.stdout_truncated,
      stderrTruncated: json.stderr_truncated,
    };
    this.updateTrackedBackgroundCommand(output, route);
    return output;
  }

  async listBackgroundCommands(): Promise<BackgroundCommand[]> {
    await this.ensure();

    const res = await this.fetchControl(backgroundCommandsUrl(this.resolveDataPlaneRoute()), {
      headers: this.authHeaders(),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `List background commands failed: ${res.status} ${await res.text()}`,
      });
    }

    const json = await res.json();
    const commands = Array.isArray(json) ? json : (json.commands ?? []);
    return commands.map((command: Record<string, unknown>) => mapBackgroundCommand(command));
  }

  async cancelBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    const route = await this.resolveBackgroundCommandRoute(commandId);

    const res = await this.fetchControl(
      `${route.commandsUrl}/${encodeURIComponent(commandId)}/cancel`,
      {
        method: "POST",
        headers: this.authHeaders(),
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Cancel background command failed: ${res.status} ${await res.text()}`,
      });
    }

    const backgroundCommand = mapBackgroundCommand(await res.json());
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
        const res = await this.fetchControl(
          `${this.apiUrl}/sandbox-sessions/${encodeURIComponent(currentSessionId)}/heartbeat`,
          {
            method: "POST",
            headers: this.authHeaders(),
          },
        );

        if (!res.ok) {
          if (this.sessionId === currentSessionId) {
            if (this.activeBackgroundCommands.size === 0) {
              await this.deleteSession(currentSessionId);
              this.resetSessionState(currentSessionId);
            }
          }

          throw new Error(`Sandbox heartbeat failed: ${res.status} ${await res.text()}`);
        }

        this.lastHeartbeatAt = Date.now();
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

  private async bootstrapSession(): Promise<void> {
    if (this.sandboxId) {
      await this.attachExistingSession(this.sandboxId);
      return;
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

  private async bootstrapCreatedSession(): Promise<void> {
    const projectId = this.resolveProjectId();
    const res = await this.fetchControl(`${this.apiUrl}/sandbox-sessions`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(projectId ? { project_id: projectId } : {}),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Failed to create sandbox: ${res.status} ${await res.text()}`,
      });
    }

    const session = await res.json();
    this.sessionId = session.id;
    this.sessionProjectId = projectId;

    try {
      const endpoint = await this.resolveReadyEndpoint(session);
      this.endpoint = endpoint;
      await this.heartbeat(true);
      this.startHeartbeatLoop();
    } catch (error) {
      const currentSessionId = this.sessionId;
      if (currentSessionId && this.deleteOnClose) {
        await this.deleteSession(currentSessionId);
      }
      this.resetSessionState(currentSessionId ?? undefined);
      throw error;
    }
  }

  private async resolveReadyEndpoint(session: SandboxSessionRecord): Promise<string> {
    const readySession = session.status === "running"
      ? session
      : await this.waitForReadySession(session.id);

    if (this.shouldUseInternalDataPlane(readySession.endpoint, readySession.id)) {
      await this.waitForRuntimeDataPlaneReady(readySession);
    }
    return readySession.endpoint;
  }

  private async attachExistingSession(sessionId: string): Promise<void> {
    const projectId = this.resolveProjectId();
    this.sessionId = sessionId;
    this.sessionProjectId = projectId;

    try {
      const session = this.sandboxEndpoint
        ? { id: sessionId, endpoint: this.sandboxEndpoint, status: "running" }
        : await this.getSession(sessionId);
      this.endpoint = await this.resolveReadyEndpoint(session);
      await this.heartbeat(true);
      this.startHeartbeatLoop();
    } catch (error) {
      this.resetSessionState(sessionId);
      throw error;
    }
  }

  private async getSession(sessionId: string): Promise<SandboxSessionRecord> {
    const res = await this.fetchControl(
      `${this.apiUrl}/sandbox-sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: this.authHeaders(),
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Failed to get sandbox: ${res.status} ${await res.text()}`,
      });
    }

    return await res.json() as SandboxSessionRecord;
  }

  private async waitForReadySession(sessionId: string): Promise<SandboxSessionRecord> {
    const start = Date.now();

    while (Date.now() - start < this.startupTimeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));

      const res = await this.fetchControl(
        `${this.apiUrl}/sandbox-sessions/${encodeURIComponent(sessionId)}`,
        {
          headers: this.authHeaders(),
        },
      );

      if (!res.ok) {
        continue;
      }

      const session = await res.json() as SandboxSessionRecord;
      if (session.status === "running") {
        return session;
      }
      if (session.status === "error" || session.status === "deleting") {
        throw REQUEST_ERROR.create({
          detail: `Sandbox failed to start: status=${session.status}`,
        });
      }
    }

    throw REQUEST_ERROR.create({ detail: "Sandbox did not become ready within timeout" });
  }

  private async waitForRuntimeDataPlaneReady(session: SandboxSessionRecord): Promise<void> {
    if (resolveDefaultSandboxRuntimeEndpoint({ endpoint: session.endpoint }) === session.endpoint) {
      return;
    }

    const runtimeEndpoint = this.resolveRuntimeEndpointFor(session.endpoint, session.id);
    const start = Date.now();
    let lastFailure = `sandbox status is ${session.status}`;

    while (Date.now() - start < this.startupTimeoutMs) {
      try {
        const res = await this.fetchControl(`${runtimeEndpoint}/readyz`);

        if (res.ok) {
          return;
        }

        lastFailure = `${res.status} ${await res.text()}`;
        if (!RETRYABLE_DATA_PLANE_READINESS_STATUS_CODES.has(res.status)) {
          break;
        }
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }

    throw REQUEST_ERROR.create({
      detail: `Sandbox data plane did not become ready: ${lastFailure}`,
    });
  }

  private async touchSession(): Promise<void> {
    const projectId = this.resolveProjectId();
    if (!this.sandboxId && this.endpoint && this.sessionProjectId !== projectId) {
      const currentSessionId = this.sessionId;
      if (currentSessionId) {
        await this.deleteSession(currentSessionId);
      }
      this.resetSessionState(currentSessionId ?? undefined);
    }

    await this.ensure();
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
    await this.fetchControl(
      `${this.apiUrl}/sandbox-sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
        headers: this.authHeaders(),
      },
    );
  }

  private requireEndpoint(): string {
    if (!this.endpoint) {
      throw new Error("Sandbox endpoint unavailable");
    }
    return this.endpoint;
  }

  private resolveProjectId(): string | null {
    return this.getProjectId() ?? null;
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
    }
  }

  private resolveExecOptions(options?: ExecOptions): ExecOptions | undefined {
    const projectReference = options?.projectReference ?? this.resolveProjectId() ?? undefined;
    return projectReference ? { ...options, projectReference } : options;
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

  private async startExec(command: string, options?: ExecOptions): Promise<Response> {
    const route = this.resolveDataPlaneRoute();
    const body = JSON.stringify({ command, ...this.resolveExecOptions(options) });

    for (let attempt = 1; attempt <= this.execStartMaxAttempts; attempt += 1) {
      try {
        const res = await this.fetchExecStart(commandStreamUrl(route), {
          method: "POST",
          headers: this.jsonHeaders(),
          body,
        });

        if (res.ok) {
          return res;
        }

        if (isRetryableExecStartStatus(res.status) && attempt < this.execStartMaxAttempts) {
          await this.waitForExecStartRetry();
          continue;
        }

        throw REQUEST_ERROR.create({ detail: `Exec failed: ${res.status} ${await res.text()}` });
      } catch (error) {
        if (!isRetryableExecStartError(error) || attempt >= this.execStartMaxAttempts) {
          throw error;
        }

        await this.waitForExecStartRetry();
      }
    }

    throw new Error("Sandbox exec failed before a request was made");
  }

  private async fetchExecStart(url: string, init: RequestInit): Promise<Response> {
    return fetchWithTimeout(url, this.execStartTimeoutMs, init);
  }

  private async fetchControl(url: string, init: RequestInit = {}): Promise<Response> {
    return fetchWithTimeout(url, this.controlRequestTimeoutMs, init);
  }

  private waitForExecStartRetry(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.execStartRetryDelayMs));
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
    return this.resolveRuntimeEndpointOption?.({ endpoint, sessionId }) ??
      resolveDefaultSandboxRuntimeEndpoint({ endpoint });
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

function isRetryableExecStartStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function commandStreamUrl(route: DataPlaneRoute): string {
  return `${route.baseUrl}${route.kind === "internal" ? "/exec" : "/commands/stream"}`;
}

function backgroundCommandsUrl(route: DataPlaneRoute): string {
  return `${route.baseUrl}${route.kind === "internal" ? "/exec/commands" : "/commands"}`;
}

/**
 * Heuristic: Deno's fetch throws an `Error` with message "fetch failed" (case-
 * insensitive) when the TCP connection is refused or the host is unreachable.
 * If Deno changes this wording the check stops matching, causing exec failures
 * to be treated as non-retryable — fail-safe (agent surfaces an error) but
 * requires a code update to restore automatic retry.
 */
function isRetryableExecStartError(error: unknown): boolean {
  return error instanceof Error && /fetch failed/i.test(error.message);
}

/**
 * Heuristic: data-plane readiness failures are identified by a known message
 * prefix ({@link DATA_PLANE_READINESS_FAILURE_PREFIX}) set by this codebase.
 * The prefix is stable as long as the caller site is not changed.
 */
function isDataPlaneReadinessFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const detail = "detail" in error && typeof error.detail === "string" ? error.detail : undefined;
  return error.message.startsWith(DATA_PLANE_READINESS_FAILURE_PREFIX) ||
    detail?.startsWith(DATA_PLANE_READINESS_FAILURE_PREFIX) === true;
}

/**
 * Heuristic: reprovisioning is triggered by known Node.js/Deno error codes on
 * the error's `cause` (ECONNREFUSED, ECONNRESET, ENOTFOUND, EHOSTUNREACH).
 * These codes are stable across Deno versions and represent network-layer
 * failures where the sandbox pod is no longer reachable.
 */
function shouldReprovisionAfterExecStartFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const cause = error.cause;
  if (typeof cause !== "object" || cause === null || !("code" in cause)) {
    return false;
  }

  return typeof cause.code === "string" &&
    REPROVISIONABLE_EXEC_START_ERROR_CODES.has(cause.code);
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  if (timeoutMs <= 0) {
    return await fetch(url, init);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function mapBackgroundCommand(json: Record<string, unknown>): BackgroundCommand {
  return {
    id: json.id as string,
    status: json.status as BackgroundCommandStatus,
    exitCode: json.exit_code as number | null,
    signal: json.signal as string | null,
    startedAt: json.started_at as string,
    finishedAt: json.finished_at as string | null,
    heartbeatStatus: json.heartbeat_status as "disabled" | "healthy" | "degraded",
    lastHeartbeatAt: json.last_heartbeat_at as string | null,
    lastHeartbeatError: json.last_heartbeat_error as string | null,
    heartbeatFailureCount: json.heartbeat_failure_count as number,
  };
}
