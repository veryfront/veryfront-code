import { REQUEST_ERROR } from "#veryfront/errors";
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
  waitForSandboxReady,
} from "./sandbox.ts";

export interface LazySandboxOptions extends SandboxOptions {
  getProjectId?: () => string | null | undefined;
  startupTimeoutMs?: number;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatGraceMs?: number;
}

interface SandboxSessionRecord {
  id: string;
  endpoint: string;
  status: string;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_GRACE_MS = 5_000;

/** Lazily provisions sandbox sessions and keeps them alive while in use. */
export class LazySandbox {
  private readonly apiUrl: string;
  private readonly authToken: string;
  private readonly getProjectId: () => string | null | undefined;
  private readonly startupTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatGraceMs: number;

  private endpoint: string | null = null;
  private sessionId: string | null = null;
  private sessionProjectId: string | null = null;
  private ensurePromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private heartbeatPromise: Promise<void> | null = null;
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
  }

  async ensure(): Promise<void> {
    if (this.endpoint) return;
    if (this.ensurePromise) {
      await this.ensurePromise;
      return;
    }

    const promise = this.bootstrapSession();
    this.ensurePromise = promise;

    try {
      await promise;
    } finally {
      if (this.ensurePromise === promise) {
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

    const res = await fetch(`${this.requireEndpoint()}/exec`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ command, ...this.resolveExecOptions(options) }),
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

    const res = await fetch(`${this.requireEndpoint()}/file?path=${encodeURIComponent(path)}`, {
      headers: this.authHeaders(),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({ detail: `Read file failed: ${res.status} ${await res.text()}` });
    }

    return await res.text();
  }

  async writeFiles(files: Array<{ path: string; content: string }>): Promise<void> {
    await this.touchSession();

    const res = await fetch(`${this.requireEndpoint()}/files`, {
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
    const endpoint = this.requireEndpoint();

    const res = await fetch(`${endpoint}/exec/jobs`, {
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

    const res = await fetch(`${endpoint}/exec/jobs/${jobId}`, {
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

    const res = await fetch(`${endpoint}/exec/jobs/${jobId}/output`, {
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

    const res = await fetch(`${this.requireEndpoint()}/exec/jobs`, {
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

    const res = await fetch(`${endpoint}/exec/jobs/${jobId}/cancel`, {
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
      await this.heartbeatPromise;
      return;
    }

    if (
      !force && this.lastHeartbeatAt > 0 &&
      Date.now() - this.lastHeartbeatAt < this.heartbeatGraceMs
    ) {
      return;
    }

    const promise = (async () => {
      const res = await fetch(`${this.apiUrl}/sandbox-sessions/${currentSessionId}/heartbeat`, {
        method: "POST",
        headers: this.authHeaders(),
      });

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
    })();

    this.heartbeatPromise = promise;

    try {
      await promise;
    } finally {
      if (this.heartbeatPromise === promise) {
        this.heartbeatPromise = null;
      }
    }
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      await this.closePromise;
      return;
    }

    const promise = (async () => {
      if (this.ensurePromise) {
        try {
          await this.ensurePromise;
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
    })();

    this.closePromise = promise;

    try {
      await promise;
    } finally {
      if (this.closePromise === promise) {
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
    const res = await fetch(`${this.apiUrl}/sandbox-sessions`, {
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

    await waitForSandboxReady({
      apiUrl: this.apiUrl,
      id: session.id,
      authToken: this.authToken,
      maxWaitMs: this.startupTimeoutMs,
      pollIntervalMs: this.pollIntervalMs,
    });

    const res = await fetch(`${this.apiUrl}/sandbox-sessions/${session.id}`, {
      headers: this.authHeaders(),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Failed to get sandbox: ${res.status} ${await res.text()}`,
      });
    }

    const nextSession = await res.json();
    return nextSession.endpoint;
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
    await fetch(`${this.apiUrl}/sandbox-sessions/${sessionId}`, {
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
    return this.requireEndpoint();
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
