import { REQUEST_ERROR } from "#veryfront/errors";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  type CommandJob,
  type CommandJobOutput,
  type CommandJobStatus,
  type ExecOptions,
  type ExecResult,
  type ExecStreamEvent,
  resolveSandboxApiUrl,
  resolveSandboxAuthToken,
  type SandboxOptions,
} from "./sandbox.ts";

export interface LazySandboxOptions extends SandboxOptions {
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

const DEFAULT_STARTUP_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_GRACE_MS = 5_000;
const DEFAULT_CONTROL_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_EXEC_START_TIMEOUT_MS = 30_000;
const DEFAULT_EXEC_START_MAX_ATTEMPTS = 3;
const DEFAULT_EXEC_START_RETRY_DELAY_MS = 1_000;
const REPROVISIONABLE_EXEC_START_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EHOSTUNREACH",
]);
const VERYFRONT_SANDBOX_PUBLIC_HOST_PATTERN = /^([a-z0-9-]+)\.sandbox\.veryfront\.[a-z0-9.-]+$/i;

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

/** Lazily provisions sandbox sessions and keeps them alive while in use. */
export class LazySandbox {
  private readonly apiUrl: string;
  private readonly authToken: string;
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
  private readonly activeCommandJobEndpoints = new Map<string, string>();

  constructor(options: LazySandboxOptions = {}) {
    this.apiUrl = resolveSandboxApiUrl(options);
    this.authToken = resolveSandboxAuthToken(options);
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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        yield JSON.parse(line) as ExecStreamEvent;
      }
    }

    if (buffer.trim()) {
      yield JSON.parse(buffer) as ExecStreamEvent;
    }
  }

  async readFile(path: string): Promise<string> {
    await this.touchSession();

    const res = await this.fetchControl(
      `${this.requireEndpoint()}/file?path=${encodeURIComponent(path)}`,
      {
        headers: this.authHeaders(),
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({ detail: `Read file failed: ${res.status} ${await res.text()}` });
    }

    return await res.text();
  }

  async writeFiles(files: Array<{ path: string; content: string }>): Promise<void> {
    await this.touchSession();

    const res = await this.fetchControl(`${this.requireEndpoint()}/files`, {
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

  async startCommandJob(command: string, options?: ExecOptions): Promise<CommandJob> {
    await this.touchSession();
    const endpoint = this.resolveRuntimeEndpoint();

    const res = await this.fetchControl(`${endpoint}/exec/jobs`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ command, ...this.resolveExecOptions(options) }),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Start command job failed: ${res.status} ${await res.text()}`,
      });
    }

    const job = mapCommandJob(await res.json());
    this.updateTrackedCommandJob(job, endpoint);
    return job;
  }

  async getCommandJob(jobId: string): Promise<CommandJob> {
    const endpoint = await this.resolveCommandJobEndpoint(jobId);

    const res = await this.fetchControl(`${endpoint}/exec/jobs/${jobId}`, {
      headers: this.authHeaders(),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Get command job failed: ${res.status} ${await res.text()}`,
      });
    }

    const job = mapCommandJob(await res.json());
    this.updateTrackedCommandJob(job, endpoint);
    return job;
  }

  async getCommandJobOutput(jobId: string): Promise<CommandJobOutput> {
    const endpoint = await this.resolveCommandJobEndpoint(jobId);

    const res = await this.fetchControl(`${endpoint}/exec/jobs/${jobId}/output`, {
      headers: this.authHeaders(),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Get command job output failed: ${res.status} ${await res.text()}`,
      });
    }

    const json = await res.json();
    const output = {
      ...mapCommandJob(json),
      stdout: json.stdout,
      stderr: json.stderr,
      stdoutTruncated: json.stdout_truncated,
      stderrTruncated: json.stderr_truncated,
    };
    this.updateTrackedCommandJob(output, endpoint);
    return output;
  }

  async listCommandJobs(): Promise<CommandJob[]> {
    await this.ensure();

    const res = await this.fetchControl(`${this.requireEndpoint()}/exec/jobs`, {
      headers: this.authHeaders(),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `List command jobs failed: ${res.status} ${await res.text()}`,
      });
    }

    const json = await res.json();
    const jobs = Array.isArray(json) ? json : (json.jobs ?? []);
    return jobs.map((job: Record<string, unknown>) => mapCommandJob(job));
  }

  async cancelCommandJob(jobId: string): Promise<CommandJob> {
    const endpoint = await this.resolveCommandJobEndpoint(jobId);

    const res = await this.fetchControl(`${endpoint}/exec/jobs/${jobId}/cancel`, {
      method: "POST",
      headers: this.authHeaders(),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Cancel command job failed: ${res.status} ${await res.text()}`,
      });
    }

    const job = mapCommandJob(await res.json());
    this.updateTrackedCommandJob(job, endpoint);
    return job;
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
          `${this.apiUrl}/sandbox-sessions/${currentSessionId}/heartbeat`,
          {
            method: "POST",
            headers: this.authHeaders(),
          },
        );

        if (!res.ok) {
          if (this.sessionId === currentSessionId) {
            if (this.activeCommandJobEndpoints.size === 0) {
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
          } catch {
            // startup failure already handled by the caller path
          }
        }

        const currentSessionId = this.sessionId;
        if (!currentSessionId) {
          this.resetSessionState();
          return;
        }

        await this.deleteSession(currentSessionId);
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
      if (currentSessionId) {
        await this.deleteSession(currentSessionId);
      }
      this.resetSessionState(currentSessionId ?? undefined);
      throw error;
    }
  }

  private async resolveReadyEndpoint(session: SandboxSessionRecord): Promise<string> {
    if (session.status === "running") {
      return session.endpoint;
    }

    return (await this.waitForReadySession(session.id)).endpoint;
  }

  private async waitForReadySession(sessionId: string): Promise<SandboxSessionRecord> {
    const start = Date.now();

    while (Date.now() - start < this.startupTimeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));

      const res = await this.fetchControl(`${this.apiUrl}/sandbox-sessions/${sessionId}`, {
        headers: this.authHeaders(),
      });

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

  private async touchSession(): Promise<void> {
    const projectId = this.resolveProjectId();
    if (this.endpoint && this.sessionProjectId !== projectId) {
      const currentSessionId = this.sessionId;
      if (currentSessionId) {
        await this.deleteSession(currentSessionId);
      }
      this.resetSessionState(currentSessionId ?? undefined);
    }

    await this.ensure();
    await this.heartbeat();
  }

  private startHeartbeatLoop(): void {
    if (!this.sessionId || this.heartbeatTimer || this.activeCommandJobEndpoints.size > 0) return;

    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat().catch(() => {
        // next operation will reprovision
      });
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeatLoop(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async deleteSession(sessionId: string): Promise<void> {
    await this.fetchControl(`${this.apiUrl}/sandbox-sessions/${sessionId}`, {
      method: "DELETE",
      headers: this.authHeaders(),
    });
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
      this.activeCommandJobEndpoints.clear();
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

  private async resolveCommandJobEndpoint(jobId: string): Promise<string> {
    const trackedEndpoint = this.activeCommandJobEndpoints.get(jobId);
    if (trackedEndpoint) {
      return trackedEndpoint;
    }

    await this.ensure();
    return this.resolveRuntimeEndpoint();
  }

  private updateTrackedCommandJob(job: Pick<CommandJob, "id" | "status">, endpoint: string): void {
    if (job.status === "running") {
      this.activeCommandJobEndpoints.set(job.id, endpoint);
      this.stopHeartbeatLoop();
      return;
    }

    if (!this.activeCommandJobEndpoints.delete(job.id)) {
      return;
    }

    if (this.activeCommandJobEndpoints.size === 0 && this.endpoint) {
      this.startHeartbeatLoop();
    }
  }

  private async startExec(command: string, options?: ExecOptions): Promise<Response> {
    const endpoint = this.resolveRuntimeEndpoint();
    const body = JSON.stringify({ command, ...this.resolveExecOptions(options) });

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

    await this.deleteSession(sessionId);
    this.resetSessionState(sessionId);
  }

  private resolveRuntimeEndpoint(): string {
    const endpoint = this.requireEndpoint();
    const sessionId = this.requireSessionId();
    return this.resolveRuntimeEndpointOption?.({ endpoint, sessionId }) ??
      resolveDefaultSandboxRuntimeEndpoint({ endpoint });
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

function isRetryableExecStartError(error: unknown): boolean {
  return error instanceof Error && /fetch failed/i.test(error.message);
}

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

function mapCommandJob(json: Record<string, unknown>): CommandJob {
  return {
    id: json.id as string,
    status: json.status as CommandJobStatus,
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
