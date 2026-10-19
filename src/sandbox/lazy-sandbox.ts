import {
  assertSandboxFilesWritten,
  assertSandboxRuntimeFilesWritten,
  hasTemporarySandboxPolicy,
  parseSandboxBackgroundCommand,
  parseSandboxBackgroundCommandOutput,
  parseSandboxCommandResult,
  readSandboxCommandPages,
} from "./response.ts";
import {
  assertSandboxCreationOptions,
  assertSandboxSelector,
  buildSandboxCommandOptions,
  buildSandboxCreateInput,
} from "./create-input.ts";
import { CONFIG_INVALID, isVeryfrontError, REQUEST_ERROR } from "#veryfront/errors";
import { createSandboxHttpError } from "./http-error.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { logger, sleep } from "#veryfront/utils";
import { awaitAbortable, throwIfAborted } from "#veryfront/utils/abort.ts";
import { isRetriableConnectFailure } from "#veryfront/platform/compat/http/pinned-fetch.ts";
import {
  fetchSandboxRuntimeUrl,
  fetchSandboxUrl,
  resolveSandboxApiUrl,
  resolveSandboxAuthToken,
} from "./config.ts";
import {
  currentSandboxCleanupPolicy,
  readSandboxFileContent,
  sandboxCommandRequestTimeoutMs,
  sandboxSessionRoute,
  withSandboxRequestDeadline,
} from "./proxy-routes.ts";
import { readCommandStreamEvents } from "./exec-stream.ts";
import {
  type BackgroundCommand,
  type BackgroundCommandOutput,
  type CommandOptions,
  type CommandResult,
  type CommandStreamEvent,
  type SandboxOptions,
} from "./types.ts";

type CommandFetchAttempt<T> =
  | { kind: "result"; result: T }
  | { kind: "fetch-failure"; error: unknown };
const anyAbortSignal = AbortSignal.any.bind(AbortSignal);

/** Options accepted by lazy sandbox. */
export interface LazySandboxOptions extends SandboxOptions {
  /**
   * Optional existing sandbox session to attach to instead of creating a new one.
   * Attached sessions are detached, not deleted, on close unless deleteOnClose is true.
   */
  sandboxId?: string;
  /** Optional known endpoint for sandboxId; avoids the initial control-plane lookup. */
  sandboxEndpoint?: string;
  /** Delete the sandbox when closing. Defaults to false for persistent, always-on or attached workspaces, and true for temporary workspaces created by this client. */
  deleteOnClose?: boolean;
  getProjectId?: () => string | null | undefined;
  /** Read the current credential before each request when the host renews it. */
  getAuthToken?: () => string;
  startupTimeoutMs?: number;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatGraceMs?: number;
  controlRequestTimeoutMs?: number;
  execStartTimeoutMs?: number;
  execStartMaxAttempts?: number;
  execStartRetryDelayMs?: number;
  resolveRuntimeEndpoint?: (input: { endpoint: string; sandboxId: string }) => string;
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
  kind: "internal" | "runtime" | "proxy";
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
const VERYFRONT_SANDBOX_PUBLIC_HOST_PATTERN = /^([a-z0-9-]+)\.sandbox\.veryfront\.[a-z0-9.-]+$/i;
const applyIntrinsic = Reflect.apply;
const getOwnDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;
const failedSessionLookups = new WeakSet<object>();
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;
const NativeMap = Map;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapDelete = Map.prototype.delete;
const mapClear = Map.prototype.clear;
const mapForEach = Map.prototype.forEach;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const stringTrim = String.prototype.trim;
const stringReplace = String.prototype.replace;
const NativeURL = URL;
const urlHostnameGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "hostname")?.get;
const regExpExec = RegExp.prototype.exec;
interface LazySandboxPrivateState {
  authToken: string;
  getAuthToken?: () => string;
  apiUrl: string;
  allowsCustomRuntimeEndpoint: boolean;
}
const lazySandboxPrivateStates = new WeakMap<object, LazySandboxPrivateState>();
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;

function getLazySandboxPrivateState(sandbox: LazySandbox): LazySandboxPrivateState {
  const state = applyIntrinsic(weakMapGet, lazySandboxPrivateStates, [sandbox]) as
    | LazySandboxPrivateState
    | undefined;
  if (!state) throw new TypeError("Lazy sandbox private state is unavailable");
  return state;
}

function getLazySandboxAuthToken(sandbox: LazySandbox): string {
  const state = getLazySandboxPrivateState(sandbox);
  return state.getAuthToken
    ? applyIntrinsic(state.getAuthToken, undefined, []) as string
    : state.authToken;
}

/** Resolves default sandbox runtime endpoint. */
export function resolveDefaultSandboxRuntimeEndpoint(input: { endpoint: string }): string {
  if (!getHostEnv("KUBERNETES_SERVICE_HOST")) {
    return input.endpoint;
  }

  let hostname: string;
  try {
    if (!urlHostnameGetter) return input.endpoint;
    const url = new NativeURL(input.endpoint);
    hostname = applyIntrinsic(urlHostnameGetter, url, []) as string;
  } catch {
    return input.endpoint;
  }

  const match = applyIntrinsic(regExpExec, VERYFRONT_SANDBOX_PUBLIC_HOST_PATTERN, [hostname]) as
    | RegExpExecArray
    | null;
  const shortId = match?.[1];
  if (!shortId) {
    return input.endpoint;
  }

  return `http://sandbox.veryfront-sandbox-${shortId}.svc.cluster.local`;
}

function normalizeDataPlaneBaseUrl(url: string): string {
  const trimmed = applyIntrinsic(stringTrim, url, []) as string;
  return applyIntrinsic(stringReplace, trimmed, [/(?<!\/)\/+$/, ""]) as string;
}

/** Provisions a sandbox when first used and records activity while the client is active. */
export class LazySandbox {
  private readonly creationPolicy: Pick<
    SandboxOptions,
    "accessScope" | "ttlMode" | "ttlHours" | "environmentId"
  >;
  private readonly sandboxId: string | undefined;
  private readonly sandboxEndpoint: string | undefined;
  private deleteOnClose: boolean;
  private readonly requestedDeleteOnClose: boolean | undefined;
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
      sandboxId: string;
    }) => string)
    | undefined;

  private endpoint: string | null = null;
  private sessionId: string | null = null;
  private readonly retainedSessions = new Map<string | null, string>();
  private readonly replaceableRetainedSessions = new Map<string | null, string>();
  private sessionProjectId: string | null = null;
  private sessionCanBeReplacedOnMissing = false;
  private ensurePromise: PendingOperation | null = null;
  private closePromise: PendingOperation | null = null;
  private heartbeatPromise: PendingOperation | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatAt = 0;
  readonly #activeBackgroundCommands = new NativeMap<string, TrackedBackgroundCommand>();

  constructor(options: LazySandboxOptions = {}) {
    assertSandboxCreationOptions(options);
    const explicitAuthToken = options.authToken === undefined
      ? ""
      : applyIntrinsic(stringTrim, options.authToken, []) as string;
    applyIntrinsic(weakMapSet, lazySandboxPrivateStates, [this, {
      apiUrl: resolveSandboxApiUrl(options),
      authToken: resolveSandboxAuthToken(options),
      getAuthToken: options.getAuthToken,
      allowsCustomRuntimeEndpoint: explicitAuthToken.length > 0,
    }]);
    this.creationPolicy = {
      accessScope: options.accessScope,
      ttlMode: options.ttlMode,
      ttlHours: options.ttlHours,
      environmentId: options.environmentId,
    };
    this.sandboxId = options.sandboxId?.trim() || undefined;
    this.sandboxEndpoint = options.sandboxEndpoint?.trim() || undefined;
    this.requestedDeleteOnClose = options.deleteOnClose;
    this.deleteOnClose = options.deleteOnClose ??
      (!this.sandboxId && options.ttlMode !== "always_on");
    this.getProjectId = options.getProjectId ??
      (() => options.projectReference);
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

  async runCommand(command: string, options?: CommandOptions): Promise<CommandResult> {
    await this.#touchSessionForCommand(options?.signal);
    const route = this.#resolveDataPlaneRoute();
    if (route.kind === "proxy") {
      for (let attempt = 1;; attempt += 1) {
        const outcome = await withSandboxRequestDeadline<CommandFetchAttempt<CommandResult>>(
          sandboxCommandRequestTimeoutMs(options),
          async (signal) => {
            const requestSignal = options?.signal && signal
              ? anyAbortSignal([options.signal, signal])
              : options?.signal ?? signal;
            const init: RequestInit = {
              method: "POST",
              headers: this.#jsonHeaders(),
              signal: requestSignal,
              body: JSON.stringify({ command, ...buildSandboxCommandOptions(options) }),
            };
            let response: Response;
            try {
              response = await fetchSandboxUrl(`${route.baseUrl}/commands/run`, init);
            } catch (error) {
              return { kind: "fetch-failure", error };
            }
            // A received response ends retry admission, including later body/decoder failures.
            if (!response.ok) {
              throw await createSandboxHttpError(response, "Sandbox command failed", signal);
            }
            return { kind: "result", result: parseSandboxCommandResult(await response.json()) };
          },
        );
        if (outcome.kind === "result") return outcome.result;
        if (attempt >= this.execStartMaxAttempts || !isPreDispatchExecStartFailure(outcome.error)) {
          throw outcome.error;
        }
        await awaitAbortable(this.waitForExecStartRetry(), options?.signal);
      }
    }
    let stdout = "";
    let stderr = "";
    let exitCode = 1;

    for await (const event of this.streamCommand(command, options)) {
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

  async *streamCommand(
    command: string,
    options?: CommandOptions,
  ): AsyncGenerator<CommandStreamEvent> {
    await this.#touchSessionForCommand(options?.signal);
    let outcome = await this.startExec(command, options);
    if (outcome.kind === "fetch-failure") {
      if (!isPreDispatchExecStartFailure(outcome.error)) throw outcome.error;
      await this.reprovisionAfterExecStartFailure();
      await this.#touchSessionForCommand(options?.signal);
      outcome = await this.startExec(command, options);
      if (outcome.kind === "fetch-failure") throw outcome.error;
    }
    const res = outcome.result;
    if (!res.ok) throw await createSandboxHttpError(res, "Exec failed");

    if (!res.body) {
      throw new Error("Exec response has no body");
    }

    yield* readCommandStreamEvents(res.body, options?.signal);
  }

  async readFile(path: string): Promise<string> {
    await this.touchSession();
    const route = this.#resolveDataPlaneRoute();

    const res = await this.#fetchControl(
      `${route.baseUrl}/file?path=${encodeURIComponent(path)}`,
      {
        headers: this.#authHeaders(),
      },
      route.kind,
    );

    if (!res.ok) {
      throw await createSandboxHttpError(res, "Read file failed");
    }

    return await readSandboxFileContent(res);
  }

  async writeFiles(files: Array<{ path: string; content: string }>): Promise<void> {
    await this.touchSession();
    const route = this.#resolveDataPlaneRoute();

    const res = await this.#fetchControl(
      `${route.baseUrl}/files`,
      {
        method: "POST",
        headers: this.#jsonHeaders(),
        body: JSON.stringify({ files }),
      },
      route.kind,
    );

    if (!res.ok) {
      throw await createSandboxHttpError(res, "Write files failed");
    }
    const result = await res.json();
    const paths = files.map((file) => file.path);
    if (route.kind === "proxy") assertSandboxFilesWritten(result, paths);
    else assertSandboxRuntimeFilesWritten(result, paths);
  }

  async startBackgroundCommand(
    command: string,
    options?: CommandOptions,
  ): Promise<BackgroundCommand> {
    await this.#touchSessionForCommand(options?.signal);
    const route = this.#resolveDataPlaneRoute();

    const commandsUrl = backgroundCommandsUrl(route);
    const res = await this.#fetchControl(
      commandsUrl,
      {
        method: "POST",
        headers: this.#jsonHeaders(),
        signal: options?.signal,
        body: JSON.stringify({ command, ...this.resolveCommandOptions(options, route.kind) }),
      },
      route.kind,
    );

    if (!res.ok) {
      throw await createSandboxHttpError(res, "Start background command failed");
    }

    const backgroundCommand = mapBackgroundCommand(await res.json(), route.kind);
    this.#updateTrackedBackgroundCommand(backgroundCommand, {
      commandsUrl,
      routeKind: route.kind,
    });
    return backgroundCommand;
  }

  async getBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    const route = await this.#resolveBackgroundCommandRoute(commandId);

    const res = await this.#fetchControl(
      `${route.commandsUrl}/${encodeURIComponent(commandId)}`,
      {
        headers: this.#authHeaders(),
      },
      route.routeKind,
    );

    if (!res.ok) {
      throw await createSandboxHttpError(res, "Get background command failed");
    }

    const backgroundCommand = mapBackgroundCommand(await res.json(), route.routeKind);
    this.#updateTrackedBackgroundCommand(backgroundCommand, route);
    return backgroundCommand;
  }

  async getBackgroundCommandOutput(commandId: string): Promise<BackgroundCommandOutput> {
    const route = await this.#resolveBackgroundCommandRoute(commandId);

    const res = await this.#fetchControl(
      `${route.commandsUrl}/${encodeURIComponent(commandId)}/output`,
      {
        headers: this.#authHeaders(),
      },
      route.routeKind,
    );

    if (!res.ok) {
      throw await createSandboxHttpError(res, "Get background command output failed");
    }

    const json = await res.json();
    const output = parseSandboxBackgroundCommandOutput({
      ...json,
      command_id: route.routeKind === "proxy" ? json.command_id : json.id ?? json.command_id,
      stdout_truncated: route.routeKind === "proxy"
        ? json.stdout_truncated
        : json.stdoutTruncated ?? json.stdout_truncated,
      stderr_truncated: route.routeKind === "proxy"
        ? json.stderr_truncated
        : json.stderrTruncated ?? json.stderr_truncated,
    });
    this.#updateTrackedBackgroundCommand(output, route);
    return output;
  }

  async listBackgroundCommands(): Promise<BackgroundCommand[]> {
    await this.ensure();
    const route = this.#resolveDataPlaneRoute();

    const fetchPage = async (cursor?: string) => {
      const url = `${backgroundCommandsUrl(route)}${
        cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
      }`;
      const res = await this.#fetchControl(url, { headers: this.#authHeaders() }, route.kind);
      if (!res.ok) {
        throw await createSandboxHttpError(res, "List background commands failed");
      }
      return res.json();
    };
    const commands = route.kind === "proxy"
      ? await readSandboxCommandPages(fetchPage)
      : (await fetchPage()).commands;
    if (!Array.isArray(commands)) {
      throw REQUEST_ERROR.create({ detail: "Invalid sandbox command collection" });
    }
    return commands.map((command: Record<string, unknown>) =>
      mapBackgroundCommand(command, route.kind)
    );
  }

  async cancelBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    const route = await this.#resolveBackgroundCommandRoute(commandId);

    const res = await this.#fetchControl(
      `${route.commandsUrl}/${encodeURIComponent(commandId)}/cancel`,
      {
        method: "POST",
        headers: this.#authHeaders(),
      },
      route.routeKind,
    );

    if (!res.ok) {
      throw await createSandboxHttpError(res, "Cancel background command failed");
    }

    const backgroundCommand = mapBackgroundCommand(await res.json(), route.routeKind);
    this.#updateTrackedBackgroundCommand(backgroundCommand, route);
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
        const res = await this.#fetchControl(
          `${getLazySandboxPrivateState(this).apiUrl}/sandboxes/${
            encodeURIComponent(currentSessionId)
          }/heartbeat`,
          {
            method: "POST",
            headers: this.#authHeaders(),
          },
        );

        if (!res.ok) {
          if (this.sessionId === currentSessionId) {
            if (
              this.deleteOnClose &&
              (applyIntrinsic(mapSize, this.#activeBackgroundCommands, []) as number) === 0
            ) {
              await this.deleteSession(currentSessionId);
              this.resetSessionState(currentSessionId);
            }
          }

          throw await createSandboxHttpError(res, "Sandbox heartbeat failed");
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
        if (!this.deleteOnClose) {
          this.retainSession(this.sessionProjectId, currentSessionId);
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
    return this.sessionId ?? this.retainedSessions.get(this.resolveProjectId()) ?? null;
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
    const projectId = this.resolveProjectId();
    const retained = this.retainedSessions.get(projectId);
    if (retained) {
      // Only workspaces protected from automatic deletion enter this map.
      this.deleteOnClose = false;
      try {
        await this.attachExistingSession(retained);
        return;
      } catch (error) {
        if (!this.shouldReplaceMissingRetainedSession(projectId, retained, error)) {
          throw error;
        }
        this.forgetRetainedSession(projectId, retained);
      }
    }

    // A failed cleanup must not be overwritten by the next provisioning attempt.
    const pendingCleanupId = this.sessionId;
    if (pendingCleanupId && this.deleteOnClose) {
      await this.deleteSession(pendingCleanupId);
      if (!this.deleteOnClose) {
        await this.attachExistingSession(pendingCleanupId);
        return;
      }
      this.resetSessionState(pendingCleanupId);
    }

    await this.bootstrapNewSession();
  }

  private async bootstrapNewSession(): Promise<void> {
    for (let attempt = 1; attempt <= CREATED_SESSION_BOOTSTRAP_MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.bootstrapCreatedSession();
        return;
      } catch (error) {
        if (
          !this.deleteOnClose ||
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
    const res = await this.#fetchControl(
      `${getLazySandboxPrivateState(this).apiUrl}/sandboxes`,
      {
        method: "POST",
        headers: this.#jsonHeaders(),
        body: JSON.stringify(buildSandboxCreateInput(this.creationPolicy, projectId ?? undefined)),
      },
    );

    if (!res.ok) {
      throw await createSandboxHttpError(res, "Failed to create sandbox");
    }

    const session = await res.json();
    this.sessionCanBeReplacedOnMissing = this.canReplaceMissingSession(session);
    this.deleteOnClose = this.requestedDeleteOnClose ??
      this.sessionCanBeReplacedOnMissing;
    this.sessionId = session.id;
    this.sessionProjectId = projectId;

    try {
      const endpoint = await this.resolveReadyEndpoint(session, (readySession) => {
        this.sessionCanBeReplacedOnMissing = this.canReplaceMissingSession(readySession);
        this.deleteOnClose = this.requestedDeleteOnClose ??
          this.sessionCanBeReplacedOnMissing;
      });
      this.endpoint = endpoint;
      await this.heartbeat(true);
      this.startHeartbeatLoop();
    } catch (error) {
      this.endpoint = null;
      const currentSessionId = this.sessionId;
      if (currentSessionId && this.deleteOnClose) {
        await this.deleteSession(currentSessionId);
      }
      if (currentSessionId && !this.deleteOnClose) {
        this.retainSession(this.sessionProjectId, currentSessionId);
      }
      this.resetSessionState(currentSessionId ?? undefined);
      throw error;
    }
  }

  private async resolveReadyEndpoint(
    session: SandboxSessionRecord,
    onSession?: (session: SandboxSessionRecord) => void,
  ): Promise<string> {
    const readySession = session.status === "running"
      ? session
      : await this.waitForReadySession(session.id, onSession);

    if (this.#shouldUseInternalDataPlane(readySession.endpoint, readySession.id)) {
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
      this.sessionCanBeReplacedOnMissing = this.canReplaceMissingSession(session);
      this.endpoint = await this.resolveReadyEndpoint(session);
      await this.heartbeat(true);
      this.startHeartbeatLoop();
    } catch (error) {
      this.resetSessionState(sessionId);
      throw error;
    }
  }

  private async getSession(sessionId: string): Promise<SandboxSessionRecord> {
    const res = await this.#fetchControl(
      `${getLazySandboxPrivateState(this).apiUrl}/sandboxes/${encodeURIComponent(sessionId)}`,
      {
        headers: this.#authHeaders(),
      },
    );

    if (!res.ok) {
      const error = await createSandboxHttpError(res, "Failed to get sandbox");
      applyIntrinsic(weakSetAdd, failedSessionLookups, [error]);
      throw error;
    }

    return await res.json() as SandboxSessionRecord;
  }

  private async waitForReadySession(
    sessionId: string,
    onSession?: (session: SandboxSessionRecord) => void,
  ): Promise<SandboxSessionRecord> {
    const start = Date.now();

    while (Date.now() - start < this.startupTimeoutMs) {
      await sleep(this.pollIntervalMs);

      const res = await this.#fetchControl(
        `${getLazySandboxPrivateState(this).apiUrl}/sandboxes/${encodeURIComponent(sessionId)}`,
        {
          headers: this.#authHeaders(),
        },
      );

      if (!res.ok) {
        continue;
      }

      const session = await res.json() as SandboxSessionRecord;
      onSession?.(session);
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

    const runtimeEndpoint = this.#resolveRuntimeEndpointFor(session.endpoint, session.id);
    const routeKind = this.#runtimeRouteKind(session.endpoint, runtimeEndpoint);
    const start = Date.now();
    let lastFailure = `sandbox status is ${session.status}`;

    while (Date.now() - start < this.startupTimeoutMs) {
      try {
        const res = await this.#fetchControl(`${runtimeEndpoint}/readyz`, {}, routeKind);

        if (res.ok) {
          return;
        }

        lastFailure = (await createSandboxHttpError(res, "Runtime readiness failed")).message;
        if (!RETRYABLE_DATA_PLANE_READINESS_STATUS_CODES.has(res.status)) {
          break;
        }
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
      }

      await sleep(this.pollIntervalMs);
    }

    throw REQUEST_ERROR.create({
      detail: `Sandbox data plane did not become ready: ${lastFailure}`,
    });
  }

  private async touchSession(): Promise<void> {
    const projectId = this.resolveProjectId();
    if (!this.sandboxId && this.endpoint && this.sessionProjectId !== projectId) {
      const currentSessionId = this.sessionId;
      if (currentSessionId && this.deleteOnClose) {
        await this.deleteSession(currentSessionId);
      }
      if (currentSessionId && !this.deleteOnClose) {
        this.retainSession(this.sessionProjectId, currentSessionId);
      }
      this.resetSessionState(currentSessionId ?? undefined);
    }

    await this.ensure();
    await this.heartbeat();
  }

  async #touchSessionForCommand(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await awaitAbortable(this.touchSession(), signal);
  }

  private heartbeatFailureCount = 0;
  private static readonly HEARTBEAT_WARN_AFTER_FAILURES = 3;

  private startHeartbeatLoop(): void {
    if (!this.sessionId || this.heartbeatTimer || this.#hasActiveInternalBackgroundCommand()) {
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

  private canReplaceMissingSession(session: Partial<SandboxSessionRecord>): boolean {
    return hasTemporarySandboxPolicy(session) && this.creationPolicy.ttlMode !== "always_on";
  }

  private retainSession(projectId: string | null, sessionId: string): void {
    this.retainedSessions.set(projectId, sessionId);
    if (this.sessionCanBeReplacedOnMissing) {
      this.replaceableRetainedSessions.set(projectId, sessionId);
      return;
    }
    applyIntrinsic(mapDelete, this.replaceableRetainedSessions, [projectId]);
  }

  private forgetRetainedSession(projectId: string | null, sessionId: string): void {
    if (this.retainedSessions.get(projectId) === sessionId) {
      applyIntrinsic(mapDelete, this.retainedSessions, [projectId]);
    }
    if (this.replaceableRetainedSessions.get(projectId) === sessionId) {
      applyIntrinsic(mapDelete, this.replaceableRetainedSessions, [projectId]);
    }
  }

  private shouldReplaceMissingRetainedSession(
    projectId: string | null,
    sessionId: string,
    error: unknown,
  ): boolean {
    return this.replaceableRetainedSessions.get(projectId) === sessionId &&
      isFailedSandboxLookupStatus(error, 404);
  }

  private stopHeartbeatLoop(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async deleteSession(sessionId: string): Promise<void> {
    if (this.requestedDeleteOnClose !== true) {
      const policy = await currentSandboxCleanupPolicy({
        apiUrl: getLazySandboxPrivateState(this).apiUrl,
        sessionId,
        authToken: getLazySandboxAuthToken(this),
        timeoutMs: this.controlRequestTimeoutMs,
      });
      if (policy === "unavailable") return;
      if (policy === "retain") {
        this.deleteOnClose = false;
        this.sessionCanBeReplacedOnMissing = false;
        this.retainSession(this.sessionProjectId, sessionId);
        return;
      }
    }
    const response = await this.#fetchControl(
      `${getLazySandboxPrivateState(this).apiUrl}/sandboxes/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
        headers: this.#authHeaders(),
      },
    );
    // A 404 means no sandbox is available to this client; cleanup is idempotent.
    // Other denials and server failures must preserve the handle for retry.
    if (!response.ok && response.status !== 404) {
      throw await createSandboxHttpError(response, "Delete sandbox failed");
    }
  }

  #requireEndpoint(): string {
    if (!this.endpoint) {
      throw new Error("Sandbox endpoint unavailable");
    }
    return this.endpoint;
  }

  private resolveProjectId(): string | null {
    const projectId = this.getProjectId();
    assertSandboxSelector(projectId ?? undefined, "projectReference");
    return projectId ?? null;
  }

  private resetSessionState(sessionId?: string): void {
    if (!sessionId || this.sessionId === sessionId) {
      this.stopHeartbeatLoop();
      applyIntrinsic(mapClear, this.#activeBackgroundCommands, []);
      this.endpoint = null;
      this.sessionId = null;
      this.sessionProjectId = null;
      this.heartbeatPromise = null;
      this.lastHeartbeatAt = 0;
      this.sessionCanBeReplacedOnMissing = false;
    }
  }

  private resolveCommandOptions(
    options: CommandOptions | undefined,
    routeKind: string,
  ) {
    if (routeKind === "proxy") return buildSandboxCommandOptions(options);
    const projectReference = this.resolveProjectId() ?? undefined;
    const commandOptions = buildSandboxCommandOptions(options);
    return projectReference ? { ...commandOptions, projectReference } : commandOptions;
  }

  async #resolveBackgroundCommandRoute(
    commandId: string,
  ): Promise<TrackedBackgroundCommand> {
    const trackedCommand = applyIntrinsic(mapGet, this.#activeBackgroundCommands, [commandId]) as
      | TrackedBackgroundCommand
      | undefined;
    if (trackedCommand) {
      return trackedCommand;
    }

    await this.ensure();
    const route = this.#resolveDataPlaneRoute();
    return {
      commandsUrl: backgroundCommandsUrl(route),
      routeKind: route.kind,
    };
  }

  #updateTrackedBackgroundCommand(
    backgroundCommand: Pick<BackgroundCommand, "id" | "status">,
    command: TrackedBackgroundCommand,
  ): void {
    if ((backgroundCommand.status === "running" || backgroundCommand.status === "pending")) {
      applyIntrinsic(mapSet, this.#activeBackgroundCommands, [backgroundCommand.id, command]);
      if (command.routeKind !== "proxy") {
        this.stopHeartbeatLoop();
      }
      return;
    }

    if (!applyIntrinsic(mapDelete, this.#activeBackgroundCommands, [backgroundCommand.id])) {
      return;
    }

    if (!this.#hasActiveInternalBackgroundCommand() && this.endpoint) {
      this.startHeartbeatLoop();
    }
  }

  #hasActiveInternalBackgroundCommand(): boolean {
    let active = false;
    applyIntrinsic(mapForEach, this.#activeBackgroundCommands, [
      (command: TrackedBackgroundCommand) => {
        if (command.routeKind !== "proxy") {
          active = true;
        }
      },
    ]);
    return active;
  }

  private async startExec(
    command: string,
    options?: CommandOptions,
  ): Promise<CommandFetchAttempt<Response>> {
    const route = this.#resolveDataPlaneRoute();
    const body = JSON.stringify({ command, ...this.resolveCommandOptions(options, route.kind) });
    const signal = options?.signal;
    for (let attempt = 1; attempt <= this.execStartMaxAttempts; attempt += 1) {
      const outcome = await this.#fetchExecStart(
        commandStreamUrl(route),
        { method: "POST", headers: this.#jsonHeaders(), body, signal },
        route.kind,
      );
      if (outcome.kind === "result") return outcome;
      if (!isPreDispatchExecStartFailure(outcome.error) || attempt >= this.execStartMaxAttempts) {
        return outcome;
      }
      await awaitAbortable(this.waitForExecStartRetry(), options?.signal);
    }
    throw new Error("Sandbox exec failed before a request was made");
  }

  async #fetchExecStart(
    url: string,
    init: RequestInit,
    routeKind: DataPlaneRoute["kind"],
  ): Promise<CommandFetchAttempt<Response>> {
    const fetchUrl = routeKind === "internal" ? fetchSandboxRuntimeUrl : fetchSandboxUrl;
    return await withSandboxRequestDeadline<CommandFetchAttempt<Response>>(
      this.execStartTimeoutMs,
      async (signal) => {
        try {
          const requestSignal = init.signal && signal
            ? anyAbortSignal([init.signal, signal])
            : init.signal ?? signal;
          const response = await fetchUrl(
            url,
            requestSignal ? { ...init, signal: requestSignal } : init,
          );
          return { kind: "result", result: response };
        } catch (error) {
          return { kind: "fetch-failure", error };
        }
      },
    );
  }

  async #fetchControl(
    url: string,
    init: RequestInit = {},
    routeKind: DataPlaneRoute["kind"] = "proxy",
  ): Promise<Response> {
    return fetchWithTimeout(
      url,
      this.controlRequestTimeoutMs,
      init,
      routeKind === "internal",
      true,
    );
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
    if (!this.deleteOnClose) {
      this.retainSession(this.sessionProjectId, sessionId);
    }
    this.resetSessionState(sessionId);
  }

  #resolveRuntimeEndpointFor(endpoint: string, sessionId: string): string {
    const defaultEndpoint = resolveDefaultSandboxRuntimeEndpoint({ endpoint });
    const resolved = this.resolveRuntimeEndpointOption?.({ endpoint, sandboxId: sessionId }) ??
      defaultEndpoint;
    if (
      normalizeDataPlaneBaseUrl(resolved) !== normalizeDataPlaneBaseUrl(defaultEndpoint) &&
      !getLazySandboxPrivateState(this).allowsCustomRuntimeEndpoint
    ) {
      throw CONFIG_INVALID.create({
        detail: "Custom sandbox runtime endpoints require an explicit authToken.",
      });
    }
    return resolved;
  }

  #shouldUseInternalDataPlane(endpoint: string, sessionId: string): boolean {
    if (!this.resolveRuntimeEndpointOption) {
      return false;
    }

    const runtimeEndpoint = this.#resolveRuntimeEndpointFor(endpoint, sessionId);
    return normalizeDataPlaneBaseUrl(runtimeEndpoint) !== normalizeDataPlaneBaseUrl(endpoint);
  }

  #runtimeRouteKind(
    endpoint: string,
    runtimeEndpoint: string,
  ): "internal" | "runtime" {
    const defaultEndpoint = resolveDefaultSandboxRuntimeEndpoint({ endpoint });
    return normalizeDataPlaneBaseUrl(defaultEndpoint) !== normalizeDataPlaneBaseUrl(endpoint) &&
        normalizeDataPlaneBaseUrl(runtimeEndpoint) === normalizeDataPlaneBaseUrl(defaultEndpoint)
      ? "internal"
      : "runtime";
  }

  #resolveDataPlaneRoute(): DataPlaneRoute {
    const endpoint = this.#requireEndpoint();
    const sessionId = this.#requireSessionId();
    if (!this.resolveRuntimeEndpointOption) {
      return {
        baseUrl: sandboxSessionRoute(getLazySandboxPrivateState(this).apiUrl, sessionId),
        kind: "proxy",
      };
    }

    const runtimeEndpoint = this.#resolveRuntimeEndpointFor(endpoint, sessionId);
    if (normalizeDataPlaneBaseUrl(runtimeEndpoint) !== normalizeDataPlaneBaseUrl(endpoint)) {
      return {
        baseUrl: normalizeDataPlaneBaseUrl(runtimeEndpoint),
        kind: this.#runtimeRouteKind(endpoint, runtimeEndpoint),
      };
    }

    return {
      baseUrl: sandboxSessionRoute(getLazySandboxPrivateState(this).apiUrl, sessionId),
      kind: "proxy",
    };
  }

  #requireSessionId(): string {
    if (!this.sessionId) {
      throw new Error("Sandbox session unavailable");
    }

    return this.sessionId;
  }

  #authHeaders(): HeadersInit {
    return { Authorization: `Bearer ${getLazySandboxAuthToken(this)}` };
  }

  #jsonHeaders(): HeadersInit {
    return {
      ...this.#authHeaders(),
      "Content-Type": "application/json",
    };
  }
}

function commandStreamUrl(route: DataPlaneRoute): string {
  return `${route.baseUrl}${route.kind === "proxy" ? "/commands/stream" : "/exec"}`;
}

function backgroundCommandsUrl(route: DataPlaneRoute): string {
  return `${route.baseUrl}${route.kind === "proxy" ? "/commands" : "/exec/commands"}`;
}

function isFailedSandboxLookupStatus(error: unknown, status: number): boolean {
  return isVeryfrontError(error) && error.slug === REQUEST_ERROR.slug && error.status === status &&
    applyIntrinsic(weakSetHas, failedSessionLookups, [error]);
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

function ownTransportData(value: unknown, key: string): unknown {
  const descriptor = getOwnDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!hasOwn(descriptor, "value")) throw new TypeError("Unsupported transport metadata");
  return descriptor.value;
}

/** Admit retries/replacement only when native data identifies failed connection setup. */
function isPreDispatchExecStartFailure(error: unknown): boolean {
  try {
    if (isVeryfrontError(error) && error.slug === REQUEST_ERROR.slug) return false;
    if (!(error instanceof Error)) return false;
    let code = ownTransportData(error, "code");
    let syscall = ownTransportData(error, "syscall");
    // Pinned Node/Bun transports preserve the native error directly. Native
    // fetch instead wraps it in cause. Direct metadata must not be overridden
    // by an inner cause that claims a different phase.
    if (code === undefined && syscall === undefined) {
      const cause = ownTransportData(error, "cause");
      if (typeof cause !== "object" || cause === null) return false;
      code = ownTransportData(cause, "code");
      syscall = ownTransportData(cause, "syscall");
    }
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return syscall === undefined || syscall === "getaddrinfo";
    }
    if (
      syscall !== undefined && syscall !== "connect" &&
      !(code === "EADDRNOTAVAIL" && syscall === "bind")
    ) return false;
    return isRetriableConnectFailure({ code, syscall });
  } catch {
    // Uninspectable metadata cannot authorize replay; callers retain the original failure.
    return false;
  }
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
  allowInternalRuntime = false,
  bufferResponseBody = false,
): Promise<Response> {
  const fetchUrl = allowInternalRuntime ? fetchSandboxRuntimeUrl : fetchSandboxUrl;
  return await withSandboxRequestDeadline(
    timeoutMs,
    async (signal) => {
      const requestSignal = init.signal && signal
        ? anyAbortSignal([init.signal, signal])
        : init.signal ?? signal;
      const response = await fetchUrl(
        url,
        requestSignal ? { ...init, signal: requestSignal } : init,
      );
      // Control responses are finite receipts/data; consume their bytes while the
      // request deadline can still abort a partial body. Exec streams stay streaming.
      if (!bufferResponseBody || !response.body) return response;
      const body = await response.arrayBuffer();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  );
}

function mapBackgroundCommand(
  json: Record<string, unknown>,
  routeKind: DataPlaneRoute["kind"],
): BackgroundCommand {
  return parseSandboxBackgroundCommand({
    ...json,
    command_id: routeKind === "proxy" ? json.command_id : json.id ?? json.command_id,
  });
}
