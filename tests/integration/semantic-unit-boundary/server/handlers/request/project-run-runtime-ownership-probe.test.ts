import {
  __resetProjectRunRuntimeOwnershipProbeFlightsForTests,
  createProjectRunRuntimeOwnershipProbe,
  createProjectRunRuntimeOwnershipProbeFromHostEnv,
  type RuntimeOwnershipProbeApiClient,
  type RuntimeOwnershipProbeReceipt,
} from "../../../../../../src/server/handlers/request/project-run-runtime-ownership-probe.ts";
import { assertEquals, assertExists, assertMatch } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import {
  clearEnvFileValueSource,
  deleteEnv,
  markEnvFileValue,
  setEnv,
} from "#veryfront/platform/compat/process/env.ts";

const NativeError = Error;
const nowMs = Date.parse("2026-10-11T05:45:00.000Z");
const runId = "11111111-1111-4111-8111-111111111111";
const activation = {
  probeId: "stage-probe",
  projectId: "proj-1",
  environmentId: "env-staging",
  expiresAtMs: nowMs + 60_000,
  operationTimeoutMs: 1_000,
};

interface RunPathParts {
  id: string;
  child?: "events" | "heartbeats";
}

function runPathParts(path: string): RunPathParts | undefined {
  const marker = "/runs/";
  const markerIndex = path.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const suffix = path.slice(markerIndex + marker.length);
  const segments = suffix.split("/");
  const id = segments[0];
  if (id === undefined || id === "" || segments.length > 2) return undefined;
  const child = segments[1];
  if (child === undefined) return { id };
  if (child === "events" || child === "heartbeats") return { id, child };
  return undefined;
}

function isRunEventsPath(path: string): boolean {
  return runPathParts(path)?.child === "events";
}

function isRunPath(path: string): boolean {
  const parts = runPathParts(path);
  return parts !== undefined && parts.child === undefined;
}

function isRunHeartbeatsPath(path: string): boolean {
  return runPathParts(path)?.child === "heartbeats";
}

function runIdFromPath(path: string): string {
  return runPathParts(path)?.id ?? runId;
}

function runEventsReadback<T>(): T {
  return { data: [], page_info: { next: null } } as T;
}

function runReadback<T>(id = runId): T {
  return {
    id,
    project_id: "proj-1",
    status: "running",
    updated_at: "2026-10-11T05:45:00.000Z",
  } as T;
}

function fileOrRunReadback<T>(path: string, content: string, versionId: string): T {
  if (isRunEventsPath(path)) return runEventsReadback<T>();
  if (isRunPath(path)) return runReadback<T>(runIdFromPath(path));
  return { content, version_id: versionId } as T;
}

function stagingCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/project",
    adapter: { env: { get: () => undefined }, fs: {} },
    securityConfig: null,
    projectId: "proj-1",
    environmentId: "env-staging",
    environmentName: "staging",
    resolvedEnvironment: "preview",
    ...overrides,
  } as HandlerContext;
}

function baseSessionInput(client: RuntimeOwnershipProbeApiClient, retainedEventToken = true) {
  return {
    request: { runId, canonicalRunId: runId, projectId: "proj-1" },
    ctx: stagingCtx(),
    nowMs,
    retainedEventToken,
    eventAuthorityCanonicalRunId: retainedEventToken ? runId : undefined,
    createCanonicalClient: () => client,
  };
}

class RecordingClient implements RuntimeOwnershipProbeApiClient {
  readonly writes: Array<{ path: string; body: unknown }> = [];
  readonly posts: Array<{ path: string; body: unknown }> = [];
  readonly reads: string[] = [];
  readonly store = new Map<string, unknown>();
  readonly versions = new Map<string, string>();
  readonly eventsByRun = new Map<string, unknown[]>();
  runVersion = 0;

  async get<T>(
    path: string,
    _params?: Record<string, string>,
    _options?: { signal?: AbortSignal },
  ): Promise<T> {
    this.reads.push(path);
    if (isRunEventsPath(path)) {
      return {
        data: this.eventsByRun.get(runIdFromPath(path)) ?? [],
        page_info: { next: null },
      } as T;
    }
    if (isRunPath(path)) {
      return {
        id: runIdFromPath(path),
        project_id: "proj-1",
        status: "running",
        updated_at: `2026-10-11T05:45:0${this.runVersion}.000Z`,
      } as T;
    }
    if (!this.store.has(path)) throw new Error("Veryfront API request failed: 404 Not Found");
    const content = this.store.get(path);
    return {
      id: "file-1",
      version_id: this.versions.get(path) ?? `version-${this.writes.length}`,
      path: decodeURIComponent(path.split("/files/")[1] ?? ""),
      content,
    } as T;
  }

  async post<T>(
    path: string,
    body?: unknown,
    _options?: { signal?: AbortSignal },
  ): Promise<T> {
    this.posts.push({ path, body });
    if (isRunEventsPath(path)) {
      const id = runIdFromPath(path);
      const storedEvents = this.eventsByRun.get(id) ?? [];
      const events = typeof body === "object" && body !== null &&
          Array.isArray((body as { events?: unknown }).events)
        ? (body as { events: unknown[] }).events
        : [];
      storedEvents.push(
        ...events.map((payload, index) => ({
          event_id: storedEvents.length + index + 1,
          event_type: typeof payload === "object" && payload !== null
            ? (payload as { type?: unknown }).type
            : "UNKNOWN",
          payload,
          created_at: "2026-10-11T05:45:00.000Z",
        })),
      );
      this.eventsByRun.set(id, storedEvents);
      return {
        appended_count: events.length,
        latest_event_id: storedEvents.length,
        run_id: id,
      } as T;
    }
    if (isRunHeartbeatsPath(path)) {
      this.runVersion++;
      return { run_id: runIdFromPath(path), expires_at: "2026-10-11T05:46:00.000Z" } as T;
    }
    throw new Error("unexpected post path");
  }

  async put<T>(
    path: string,
    body?: unknown,
    _options?: { signal?: AbortSignal },
  ): Promise<T> {
    if (typeof body !== "object" || body === null || !("content" in body)) {
      throw new Error("missing files-api content wrapper");
    }
    const content = (body as { content?: unknown }).content;
    if (typeof content !== "string") throw new Error("invalid files-api content wrapper");
    this.writes.push({ path, body });
    this.store.set(path, content);
    this.versions.set(path, `version-${this.writes.length}`);
    return { stored: true, version_id: `version-${this.writes.length}` } as T;
  }
}

describe("project-run runtime ownership probe", () => {
  afterEach(() => __resetProjectRunRuntimeOwnershipProbeFlightsForTests());

  it("does not activate from project env-file values", () => {
    const values = new Map<string, string>([
      ["VERYFRONT_RUNTIME_OWNERSHIP_PROBE_STAGE", "1"],
      ["VERYFRONT_RUNTIME_OWNERSHIP_PROBE_ID", "stage-probe"],
      ["VERYFRONT_RUNTIME_OWNERSHIP_PROBE_PROJECT_ID", "proj-1"],
      ["VERYFRONT_RUNTIME_OWNERSHIP_PROBE_ENVIRONMENT_ID", "env-staging"],
      ["VERYFRONT_RUNTIME_OWNERSHIP_PROBE_EXPIRES_AT", String(nowMs + 60_000)],
    ]);
    try {
      for (const [key, value] of values) {
        setEnv(key, value);
        markEnvFileValue(key);
      }
      assertEquals(createProjectRunRuntimeOwnershipProbeFromHostEnv(nowMs), undefined);
    } finally {
      for (const key of values.keys()) {
        clearEnvFileValueSource(key);
        deleteEnv(key);
      }
    }
  });

  it("activates only for exact staging scope and a signed canonical run UUID", () => {
    const env = new Map<string, string>([
      ["VERYFRONT_RUNTIME_OWNERSHIP_PROBE_STAGE", "1"],
      ["VERYFRONT_RUNTIME_OWNERSHIP_PROBE_ID", "stage-probe"],
      ["VERYFRONT_RUNTIME_OWNERSHIP_PROBE_PROJECT_ID", "proj-1"],
      ["VERYFRONT_RUNTIME_OWNERSHIP_PROBE_ENVIRONMENT_ID", "env-staging"],
      ["VERYFRONT_RUNTIME_OWNERSHIP_PROBE_EXPIRES_AT", String(nowMs + 60_000)],
    ]);
    assertEquals(
      createProjectRunRuntimeOwnershipProbeFromHostEnv(
        nowMs,
        (key) => key === "VERYFRONT_RUNTIME_OWNERSHIP_PROBE_STAGE" ? undefined : env.get(key),
      ),
      undefined,
    );
    assertEquals(
      createProjectRunRuntimeOwnershipProbeFromHostEnv(
        nowMs,
        (key) =>
          key === "VERYFRONT_RUNTIME_OWNERSHIP_PROBE_EXPIRES_AT" ? String(nowMs) : env.get(key),
      ),
      undefined,
    );
    const probe = createProjectRunRuntimeOwnershipProbeFromHostEnv(nowMs, (key) => env.get(key));
    assertExists(probe);
    assertExists(probe.createSession(baseSessionInput(new RecordingClient())));
    assertEquals(
      probe.createSession({
        ...baseSessionInput(new RecordingClient()),
        request: {
          runId: "dispatcher-run",
          canonicalRunId: undefined,
          projectId: "proj-1",
        },
      }),
      undefined,
    );

    assertEquals(
      probe.createSession({
        ...baseSessionInput(new RecordingClient()),
        request: { runId: "dispatcher-run", canonicalRunId: "not-a-uuid", projectId: "proj-1" },
      }),
      undefined,
    );
    assertEquals(
      probe.createSession({
        ...baseSessionInput(new RecordingClient()),
        request: { runId, canonicalRunId: runId, projectId: "other-project" },
      }),
      undefined,
    );
    assertEquals(
      probe.createSession({
        ...baseSessionInput(new RecordingClient()),
        ctx: stagingCtx({ environmentId: "other-env" }),
      }),
      undefined,
    );
    assertEquals(
      probe.createSession({
        ...baseSessionInput(new RecordingClient()),
        ctx: stagingCtx({ resolvedEnvironment: "production" }),
      }),
      undefined,
    );
  });

  it("skips phases when retained event-writer authority names a different canonical run", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    ).createSession({
      ...baseSessionInput(new RecordingClient()),
      eventAuthorityCanonicalRunId: "22222222-2222-4222-8222-222222222222",
    });
    assertExists(session);

    await session.beforeExecute();

    assertEquals(receipts.map((receipt) => [receipt.phase, receipt.status, receipt.reason]), [
      ["current", "skipped", "event-writer-authority-mismatch"],
    ]);
  });

  it("reports an accepted stale canonical write as an ownership violation", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const client = new RecordingClient();
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession(baseSessionInput(client));
    assertExists(session);

    await session.beforeExecute();
    await session.afterStopAcknowledged();

    assertEquals(client.writes.length, 2);
    assertMatch(
      client.writes[0]!.path,
      /knowledge%2Fcontext-runtime-host-owned-stage-probe-20261011/,
    );
    const firstBody = client.writes[0]!.body;
    assertEquals(
      typeof firstBody === "object" && firstBody !== null && "content" in firstBody,
      true,
    );
    assertMatch((firstBody as { content: string }).content, /current/);
    assertEquals(receipts.map((receipt) => [receipt.phase, receipt.status, receipt.reason]), [
      ["current", "ok", undefined],
      ["stale-after-cancel", "error", "stale-write-accepted-after-cancel"],
    ]);
    assertExists(receipts[0]!.sourceHash);
    assertExists(receipts[0]!.afterHash);
    assertEquals(JSON.stringify(receipts).includes("opaque-token-value"), false);
  });

  it("proves stale write denial against the same owned source path with readback", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const client = new RecordingClient();
    let denyWrites = false;
    const denyingClient: RuntimeOwnershipProbeApiClient = {
      get: <T>(path: string, params?: Record<string, string>, options?: { signal?: AbortSignal }) =>
        client.get<T>(path, params, options),
      post: (path, body, options) => client.post(path, body, options),
      put: async <T>(path: string, body?: unknown, options?: { signal?: AbortSignal }) => {
        if (denyWrites) throw new Error("Veryfront API request failed: 403 Forbidden");
        return await client.put<T>(path, body, options);
      },
    };
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession({
        ...baseSessionInput(denyingClient),
        createEventAppendClient: () => ({
          get: (path, params, options) => client.get(path, params, options),
          post: async (path, body, options) => {
            if (denyWrites) throw new Error("Veryfront API request failed: 403 Forbidden");
            return await client.post(path, body, options);
          },
          put: (path, body, options) => client.put(path, body, options),
        }),
        createHeartbeatClient: () => ({
          get: (path, params, options) => client.get(path, params, options),
          post: async (path, body, options) => {
            if (denyWrites) throw new Error("Veryfront API request failed: 409 Conflict");
            return await client.post(path, body, options);
          },
          put: (path, body, options) => client.put(path, body, options),
        }),
      });
    assertExists(session);

    await session.beforeExecute();
    denyWrites = true;
    await session.afterStopAcknowledged();

    assertEquals(client.writes.length, 1);
    assertEquals(receipts[0]!.sourcePath, receipts[1]!.sourcePath);
    assertEquals(receipts[1]!.status, "ok");
    assertEquals(receipts[1]!.reason, "stale-current-surfaces-preserved");
    assertEquals(receipts[1]!.afterHash, receipts[0]!.afterHash);
    assertEquals(receipts[1]!.versionHash, receipts[0]!.versionHash);
  });

  it("isolates concurrent probe verification files by admitted canonical run", async () => {
    const firstReceipts: RuntimeOwnershipProbeReceipt[] = [];
    const secondReceipts: RuntimeOwnershipProbeReceipt[] = [];
    const client = new RecordingClient();
    const secondRunId = "22222222-2222-4222-8222-222222222222";
    let denyWrites = false;
    const controlledClient: RuntimeOwnershipProbeApiClient = {
      get: (path, params, options) => client.get(path, params, options),
      post: async (path, body, options) => {
        if (denyWrites) throw new Error("Veryfront API request failed: 403 Forbidden");
        return await client.post(path, body, options);
      },
      put: async <T>(path: string, body?: unknown, options?: { signal?: AbortSignal }) => {
        if (denyWrites) throw new Error("Veryfront API request failed: 403 Forbidden");
        return await client.put<T>(path, body, options);
      },
    };
    const firstSession = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => firstReceipts.push(receipt),
    )
      .createSession({
        ...baseSessionInput(controlledClient),
        createEventAppendClient: () => controlledClient,
        createHeartbeatClient: () => ({
          get: (path, params, options) => client.get(path, params, options),
          post: async (path, body, options) => {
            if (denyWrites) throw new Error("Veryfront API request failed: 409 Conflict");
            return await client.post(path, body, options);
          },
          put: (path, body, options) => client.put(path, body, options),
        }),
      });
    const secondSession = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => secondReceipts.push(receipt),
    )
      .createSession({
        ...baseSessionInput(controlledClient),
        request: { runId: secondRunId, canonicalRunId: secondRunId, projectId: "proj-1" },
        eventAuthorityCanonicalRunId: secondRunId,
      });
    assertExists(firstSession);
    assertExists(secondSession);

    await firstSession.beforeExecute();
    await secondSession.beforeExecute();
    denyWrites = true;
    await firstSession.afterStopAcknowledged();

    assertEquals(client.writes.length, 2);
    assertEquals(firstReceipts[0]!.status, "ok");
    assertEquals(secondReceipts[0]!.status, "ok");
    assertEquals(
      firstReceipts[0]!.sourcePath === secondReceipts[0]!.sourcePath,
      false,
      "each canonical run must own its own verification file",
    );
    assertEquals(
      client.writes[0]!.path === client.writes[1]!.path,
      false,
      "canonical PUT paths must be isolated per run",
    );
    assertEquals(firstReceipts[1]!.status, "ok");
    assertEquals(firstReceipts[1]!.reason, "stale-current-surfaces-preserved");
    assertEquals(firstReceipts[1]!.afterHash, firstReceipts[0]!.afterHash);
    assertEquals(firstReceipts[1]!.versionHash, firstReceipts[0]!.versionHash);
  });

  it("keeps stale authorization classification independent of replaced Error and RegExp exec", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const client = new RecordingClient();
    let stale = false;
    const staleClient: RuntimeOwnershipProbeApiClient = {
      get: (path, params, options) => client.get(path, params, options),
      post: async (path, body, options) => {
        if (stale) throw new NativeError("Veryfront API request failed: 409 Conflict");
        return await client.post(path, body, options);
      },
      put: async <T>(path: string, body?: unknown, options?: { signal?: AbortSignal }) => {
        if (stale) throw new NativeError("Veryfront API request failed: 403 Forbidden");
        return await client.put<T>(path, body, options);
      },
    };
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession(baseSessionInput(staleClient));
    assertExists(session);

    await session.beforeExecute();
    stale = true;
    const originalError = globalThis.Error;
    const originalExec = RegExp.prototype.exec;
    globalThis.Error = class ProjectError extends originalError {} as ErrorConstructor;
    RegExp.prototype.exec = () => {
      throw new NativeError("project regexp replacement invoked");
    };
    try {
      await session.afterStopAcknowledged();
    } finally {
      globalThis.Error = originalError;
      RegExp.prototype.exec = originalExec;
    }

    assertEquals(receipts[1]!.status, "ok");
    assertEquals(receipts[1]!.reason, "stale-current-surfaces-preserved");
  });

  it("does not prove stale denial when the preserved content has a changed version", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const currentClient = new RecordingClient();
    let stale = false;
    const staleCanonicalClient: RuntimeOwnershipProbeApiClient = {
      get: (path, params, options) => currentClient.get(path, params, options),
      post: (path, body, options) => currentClient.post(path, body, options),
      put: async () => {
        throw new Error("Veryfront API request failed: 403 Forbidden");
      },
    };
    const staleReadbackClient: RuntimeOwnershipProbeApiClient = {
      get: async <T>(
        path: string,
        params?: Record<string, string>,
        options?: { signal?: AbortSignal },
      ) => {
        const response = await currentClient.get<Record<string, unknown>>(path, params, options);
        return { ...response, version_id: "changed-version-after-denial" } as T;
      },
      put: (path, body, options) => currentClient.put(path, body, options),
    };
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession({
        ...baseSessionInput(currentClient),
        createCanonicalClient: () => stale ? staleCanonicalClient : currentClient,
        createReadbackClient: () => stale ? staleReadbackClient : currentClient,
      });
    assertExists(session);

    await session.beforeExecute();
    stale = true;
    await session.afterStopAcknowledged();

    assertEquals(receipts[1]!.status, "error");
    assertEquals(receipts[1]!.reason, "stale-write-denied-readback-version-mismatch");
    assertEquals(receipts[1]!.afterHash, receipts[0]!.afterHash);
  });

  it("does not prove stale preservation after an accepted write changes version identity", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const currentClient = new RecordingClient();
    let stale = false;
    const staleCanonicalClient: RuntimeOwnershipProbeApiClient = {
      get: (path, params, options) => currentClient.get(path, params, options),
      post: (path, body, options) => currentClient.post(path, body, options),
      put: async <T>() => ({ stored: false }) as T,
    };
    const staleReadbackClient: RuntimeOwnershipProbeApiClient = {
      get: async <T>(
        path: string,
        params?: Record<string, string>,
        options?: { signal?: AbortSignal },
      ) => {
        const response = await currentClient.get<Record<string, unknown>>(path, params, options);
        return path.includes("/files/")
          ? { ...response, version_id: "changed-version-after-accepted-write" } as T
          : response as T;
      },
      post: (path, body, options) => currentClient.post(path, body, options),
      put: (path, body, options) => currentClient.put(path, body, options),
    };
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession({
        ...baseSessionInput(currentClient),
        createCanonicalClient: () => stale ? staleCanonicalClient : currentClient,
        createReadbackClient: () => stale ? staleReadbackClient : currentClient,
      });
    assertExists(session);

    await session.beforeExecute();
    stale = true;
    await session.afterStopAcknowledged();

    assertEquals(receipts[1]!.status, "error");
    assertEquals(receipts[1]!.reason, "stale-write-readback-version-mismatch");
    assertEquals(receipts[1]!.afterHash, receipts[0]!.afterHash);
  });

  it("does not treat non-authorization stale write failures as denial proof", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const currentClient = new RecordingClient();
    const staleClient: RuntimeOwnershipProbeApiClient = {
      get: (path, params, options) => currentClient.get(path, params, options),
      post: (path, body, options) => currentClient.post(path, body, options),
      put: async () => {
        throw new Error("Veryfront API request failed: 500 Internal Server Error");
      },
    };
    let stale = false;
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession({
        ...baseSessionInput(currentClient),
        createCanonicalClient: () => stale ? staleClient : currentClient,
        createReadbackClient: () => currentClient,
      });
    assertExists(session);

    await session.beforeExecute();
    stale = true;
    await session.afterStopAcknowledged();

    assertEquals(receipts[1]!.status, "error");
    assertEquals(receipts[1]!.reason, "stale-write-failed-without-authorization-rejection");
  });

  it("does not report stale denial proof when readback is unavailable", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const currentClient = new RecordingClient();
    const staleClient: RuntimeOwnershipProbeApiClient = {
      get: async () => {
        throw new Error("Veryfront API request failed: 500 Internal Server Error");
      },
      put: async () => {
        throw new Error("Veryfront API request failed: 403 Forbidden");
      },
    };
    let stale = false;
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession({
        ...baseSessionInput(currentClient),
        createCanonicalClient: () => stale ? staleClient : currentClient,
        createReadbackClient: () => stale ? staleClient : currentClient,
      });
    assertExists(session);

    await session.beforeExecute();
    stale = true;
    await session.afterStopAcknowledged();

    assertEquals(receipts[1]!.status, "error");
    assertEquals(receipts[1]!.reason, "canonical-readback-before-failed");
  });

  it("does not report proof when canonical readback lacks version identity", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const client: RuntimeOwnershipProbeApiClient = {
      get: async <T>() => ({ content: "readback-without-version" }) as T,
      put: async <T>() => ({ stored: true }) as T,
    };
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession(baseSessionInput(client));
    assertExists(session);

    await session.beforeExecute();

    assertEquals(receipts[0]!.status, "error");
    assertEquals(receipts[0]!.reason, "canonical-readback-before-failed");
    assertEquals(receipts[0]!.errorType, "InvalidCanonicalReadback");
  });

  it("does not report current proof when canonical readback differs from written bytes", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const client: RuntimeOwnershipProbeApiClient = {
      get: async <T>(path: string) => fileOrRunReadback<T>(path, "different", "different-version"),
      put: async <T>() => ({ stored: true }) as T,
    };
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession(baseSessionInput(client));
    assertExists(session);

    await session.beforeExecute();

    assertEquals(receipts[0]!.status, "error");
    assertEquals(receipts[0]!.reason, "canonical-readback-content-mismatch");
  });

  it("keeps stale serialization independent of project-replaced array sort", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const client = new RecordingClient();
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession(baseSessionInput(client));
    assertExists(session);

    const originalSort = Array.prototype.sort;
    Array.prototype.sort = () => {
      throw new Error("project replacement invoked");
    };
    try {
      await session.afterStopAcknowledged();
    } finally {
      Array.prototype.sort = originalSort;
    }

    assertEquals(client.writes.length, 1);
    assertEquals(receipts[0]!.phase, "stale-after-cancel");
    assertEquals(receipts[0]!.status, "error");
    assertEquals(receipts[0]!.reason, "stale-write-accepted-after-cancel");
  });

  it("keeps stale content construction independent of project-replaced array join", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const client = new RecordingClient();
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession(baseSessionInput(client));
    assertExists(session);

    const originalJoin = Array.prototype.join;
    Array.prototype.join = () => {
      throw new Error("project join replacement invoked");
    };
    try {
      await session.afterStopAcknowledged();
    } finally {
      Array.prototype.join = originalJoin;
    }

    assertEquals(client.writes.length, 1);
    assertEquals(receipts[0]!.phase, "stale-after-cancel");
    assertEquals(receipts[0]!.status, "error");
    assertEquals(receipts[0]!.reason, "stale-write-accepted-after-cancel");
  });

  it("keeps stale serialization independent of project-replaced array species", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const client = new RecordingClient();
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession(baseSessionInput(client));
    assertExists(session);

    const originalSpecies = Object.getOwnPropertyDescriptor(Array, Symbol.species);
    Object.defineProperty(Array, Symbol.species, {
      configurable: true,
      get() {
        throw new Error("project species replacement invoked");
      },
    });
    try {
      await session.afterStopAcknowledged();
    } finally {
      if (originalSpecies === undefined) {
        delete (Array as unknown as Record<symbol, unknown>)[Symbol.species];
      } else {
        Object.defineProperty(Array, Symbol.species, originalSpecies);
      }
    }

    assertEquals(client.writes.length, 1);
    assertEquals(receipts[0]!.phase, "stale-after-cancel");
    assertEquals(receipts[0]!.status, "error");
    assertEquals(receipts[0]!.reason, "stale-write-accepted-after-cancel");
  });

  it("keeps stale canonical PUT payload independent of inherited toJSON", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    let storedContent = "before";
    const client: RuntimeOwnershipProbeApiClient = {
      get: async <T>(path: string) => fileOrRunReadback<T>(path, storedContent, "version-readback"),
      put: async <T>(_path: string, body?: unknown) => {
        storedContent = (body as { content: string }).content;
        return { stored: true } as T;
      },
    };
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession(baseSessionInput(client));
    assertExists(session);

    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value() {
        return { content: "project-replacement" };
      },
    });
    try {
      await session.afterStopAcknowledged();
    } finally {
      delete (Object.prototype as { toJSON?: unknown }).toJSON;
    }

    assertMatch(storedContent, /context-runtime-host-owned-stage-probe/);
    assertEquals(storedContent.includes("project-replacement"), false);
    assertEquals(receipts[0]!.status, "error");
    assertEquals(receipts[0]!.reason, "stale-write-accepted-after-cancel");
  });

  it("keeps stale canonical PUT payload independent of project-replaced Object.create", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    let serializedBody = "";
    const stringify = JSON.stringify.bind(JSON);
    let storedContent = "before";
    const client: RuntimeOwnershipProbeApiClient = {
      get: async <T>(path: string) => fileOrRunReadback<T>(path, storedContent, "version-readback"),
      put: async <T>(_path: string, body?: unknown) => {
        serializedBody = stringify(body);
        storedContent = (body as { content: string }).content;
        return { stored: true } as T;
      },
    };
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession(baseSessionInput(client));
    assertExists(session);

    const originalCreate = Object.create;
    Object.create = () => ({
      toJSON: () => ({ content: "project-replacement" }),
    });
    try {
      await session.afterStopAcknowledged();
    } finally {
      Object.create = originalCreate;
    }

    assertMatch(serializedBody, /context-runtime-host-owned-stage-probe/);
    assertEquals(serializedBody.includes("project-replacement"), false);
    assertEquals(receipts[0]!.status, "error");
    assertEquals(receipts[0]!.reason, "stale-write-accepted-after-cancel");
  });

  it("keeps stale canonical path independent of project-replaced URI encoder", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const client = new RecordingClient();
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession(baseSessionInput(client));
    assertExists(session);

    const originalEncodeURIComponent = globalThis.encodeURIComponent;
    globalThis.encodeURIComponent = ((value: string | number | boolean) => {
      const raw = String(value);
      if (raw.startsWith("knowledge/")) return "knowledge%2Freplaced.json";
      return originalEncodeURIComponent(raw);
    }) as typeof encodeURIComponent;
    try {
      await session.afterStopAcknowledged();
    } finally {
      globalThis.encodeURIComponent = originalEncodeURIComponent;
    }

    assertEquals(
      client.writes[0]!.path.includes("context-runtime-host-owned-stage-probe-20261011"),
      true,
    );
    assertEquals(client.writes[0]!.path.includes("replaced.json"), false);
    assertEquals(receipts[0]!.status, "error");
    assertEquals(receipts[0]!.reason, "stale-write-accepted-after-cancel");
  });

  it("keeps stale phase execution independent of project-replaced Set methods", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const client = new RecordingClient();
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession(baseSessionInput(client));
    assertExists(session);

    const originalHas = Set.prototype.has;
    Set.prototype.has = () => true;
    try {
      await session.afterStopAcknowledged();
    } finally {
      Set.prototype.has = originalHas;
    }

    assertEquals(client.writes.length, 1);
    assertEquals(receipts[0]!.phase, "stale-after-cancel");
    assertEquals(receipts[0]!.status, "error");
    assertEquals(receipts[0]!.reason, "stale-write-accepted-after-cancel");
  });

  it("rechecks activation expiry before each phase", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const client = new RecordingClient();
    let clockMs = nowMs;
    const session = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession({
        ...baseSessionInput(client),
        readNowMs: () => clockMs,
      });
    assertExists(session);

    await session.beforeExecute();
    clockMs = activation.expiresAtMs;
    await session.afterStopAcknowledged();

    assertEquals(client.writes.length, 1);
    assertEquals(receipts.map((receipt) => [receipt.phase, receipt.status, receipt.reason]), [
      ["current", "ok", undefined],
      ["stale-after-cancel", "skipped", "activation-expired"],
    ]);
  });

  it("skips without retained event-writer authority and redacts raw error text", async () => {
    const receipts: RuntimeOwnershipProbeReceipt[] = [];
    const skipped = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession(baseSessionInput(new RecordingClient(), false));
    assertExists(skipped);
    await skipped.beforeExecute();
    assertEquals(receipts[0]!.status, "skipped");
    assertEquals(receipts[0]!.reason, "missing-event-writer-authority");

    const namedSecretClient: RuntimeOwnershipProbeApiClient = {
      get: async <T>(path: string) => fileOrRunReadback<T>(path, "before", "version-before"),
      put: async () => {
        const error = new Error("raw-secret-token should not be logged");
        error.name = "Bearer secret should not be logged";
        throw error;
      },
    };
    const namedSecret = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession(baseSessionInput(namedSecretClient));
    assertExists(namedSecret);
    await namedSecret.beforeExecute();
    assertEquals(receipts[1]!.status, "error");
    assertEquals(receipts[1]!.errorType, "Error");

    const throwingNameClient: RuntimeOwnershipProbeApiClient = {
      get: async <T>(path: string) => fileOrRunReadback<T>(path, "before", "version-before"),
      put: async () => {
        const error = new Error("another-raw-secret-token should not be logged");
        Object.defineProperty(error, "name", {
          configurable: true,
          get() {
            throw new Error("name-getter-secret should not be logged");
          },
        });
        throw error;
      },
    };
    const throwingName = createProjectRunRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    )
      .createSession(baseSessionInput(throwingNameClient));
    assertExists(throwingName);
    await throwingName.beforeExecute();
    assertEquals(receipts[2]!.status, "error");
    assertEquals(receipts[2]!.errorType, "Error");
    const serializedReceipts = JSON.stringify(receipts);
    assertEquals(serializedReceipts.includes("raw-secret-token"), false);
    assertEquals(serializedReceipts.includes("another-raw-secret-token"), false);
    assertEquals(serializedReceipts.includes("Bearer secret"), false);
    assertEquals(serializedReceipts.includes("name-getter-secret"), false);
  });
});
