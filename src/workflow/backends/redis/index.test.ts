import "#veryfront/schemas/_test-setup.ts";
/****
 * Redis Workflow Backend Tests
 *
 * Tests RedisBackend using a mock RedisAdapter to validate
 * serialization, deserialization, key management, and all
 * WorkflowBackend operations without a real Redis connection.
 *
 * @module ai/workflow/backends/redis/index.test
 */

import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { RedisBackend } from "./index.ts";
import type { RedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";
import type { PendingApproval, WorkflowRun } from "../../types.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { WorkflowRunManager } from "../../worker/run-manager.ts";
import type {
  RunExecutionConfig,
  RunExecutionInfo,
  RunExecutor,
} from "../../worker/executors/types.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

class MockRedisAdapter implements RedisAdapter {
  store = new Map<string, string>();
  hashes = new Map<string, Map<string, string>>();
  lists = new Map<string, string[]>();
  sets = new Map<string, Set<string>>();
  expiries = new Map<string, number>();
  streams = new Map<string, Array<{ id: string; data: Record<string, string> }>>();
  groups = new Map<string, Set<string>>();

  hset(key: string, fields: Record<string, string>): Promise<number> {
    let map = this.hashes.get(key);
    if (!map) {
      map = new Map();
      this.hashes.set(key, map);
    }

    let added = 0;
    for (const [k, v] of Object.entries(fields)) {
      if (!map.has(k)) added++;
      map.set(k, v);
    }
    return Promise.resolve(added);
  }

  hgetall(key: string): Promise<Record<string, string>> {
    const map = this.hashes.get(key);
    return Promise.resolve(map ? Object.fromEntries(map) : {});
  }

  hdel(key: string, ...fields: string[]): Promise<number> {
    const map = this.hashes.get(key);
    if (!map) return Promise.resolve(0);

    let removed = 0;
    for (const field of fields) {
      if (map.delete(field)) removed++;
    }
    if (map.size === 0) this.hashes.delete(key);

    return Promise.resolve(removed);
  }

  sadd(key: string, ...members: string[]): Promise<number> {
    let set = this.sets.get(key);
    if (!set) {
      set = new Set();
      this.sets.set(key, set);
    }

    let added = 0;
    for (const m of members) {
      if (!set.has(m)) added++;
      set.add(m);
    }
    return Promise.resolve(added);
  }

  srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return Promise.resolve(0);

    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) removed++;
    }
    return Promise.resolve(removed);
  }

  smembers(key: string): Promise<string[]> {
    return Promise.resolve([...(this.sets.get(key) ?? [])]);
  }

  del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
      if (this.hashes.delete(key)) count++;
      if (this.lists.delete(key)) count++;
      if (this.sets.delete(key)) count++;
    }
    return Promise.resolve(count);
  }

  expire(key: string, seconds: number): Promise<number> {
    this.expiries.set(key, seconds);
    return Promise.resolve(1);
  }

  exists(key: string): Promise<number> {
    const exists = this.store.has(key) || this.hashes.has(key) || this.lists.has(key);
    return Promise.resolve(exists ? 1 : 0);
  }

  set(
    key: string,
    value: string,
    options?: { ex?: number; px?: number; nx?: boolean },
  ): Promise<string | null> {
    if (options?.nx && this.store.has(key)) return Promise.resolve(null);
    this.store.set(key, value);
    return Promise.resolve("OK");
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  // Emulates the two Redlock Lua scripts used by the backend. Both are
  // compare-against-token guards on KEYS[1] / ARGV[1]: release deletes the key
  // and extend (P)EXPIREs it, atomically with respect to the JS event loop.
  eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    const key = keys[0]!;

    // Atomic status-move script: reads old status from the run hash, then moves
    // the run between status index sets and writes the new status.
    // KEYS[1]=runKey, ARGV[1]=runId, ARGV[2]=newStatus, ARGV[3]=statusIndexPrefix
    if (script.includes("hget") && script.includes("srem") && script.includes("sadd")) {
      const runId = args[0]!;
      const newStatus = args[1]!;
      const statusPrefix = args[2]!;
      const hash = this.hashes.get(key);
      const old = hash?.get("status");

      if (old === newStatus) return Promise.resolve(0);
      if (hash) hash.set("status", newStatus);

      if (old && old !== "") this.sets.get(statusPrefix + old)?.delete(runId);

      let newSet = this.sets.get(statusPrefix + newStatus);
      if (!newSet) {
        newSet = new Set();
        this.sets.set(statusPrefix + newStatus, newSet);
      }
      newSet.add(runId);
      return Promise.resolve(1);
    }

    const token = args[0];
    const owns = this.store.get(key) === token;

    if (script.includes("del")) {
      if (!owns) return Promise.resolve(0);
      this.store.delete(key);
      this.expiries.delete(key);
      return Promise.resolve(1);
    }

    if (script.includes("pexpire")) {
      if (!owns) return Promise.resolve(0);
      this.expiries.set(key, Number(args[1]));
      return Promise.resolve(1);
    }

    throw new Error(`MockRedisAdapter.eval: unsupported script: ${script}`);
  }

  rpush(key: string, ...values: string[]): Promise<number> {
    let list = this.lists.get(key);
    if (!list) {
      list = [];
      this.lists.set(key, list);
    }

    list.push(...values);
    return Promise.resolve(list.length);
  }

  lindex(key: string, index: number): Promise<string | null> {
    const list = this.lists.get(key);
    if (!list) return Promise.resolve(null);

    const i = index < 0 ? list.length + index : index;
    return Promise.resolve(list[i] ?? null);
  }

  lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key);
    if (!list) return Promise.resolve([]);

    const end = stop < 0 ? list.length + stop + 1 : stop + 1;
    return Promise.resolve(list.slice(start, end));
  }

  lset(key: string, index: number, value: string): Promise<string> {
    const list = this.lists.get(key)!;
    list[index] = value;
    return Promise.resolve("OK");
  }

  llen(key: string): Promise<number> {
    return Promise.resolve(this.lists.get(key)?.length ?? 0);
  }

  keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace("*", "");
    const all: string[] = [];

    for (const k of this.hashes.keys()) {
      if (k.startsWith(prefix)) all.push(k);
    }
    for (const k of this.lists.keys()) {
      if (k.startsWith(prefix)) all.push(k);
    }
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) all.push(k);
    }

    return Promise.resolve(all);
  }

  xadd(key: string, _id: string, fields: Record<string, string>): Promise<string> {
    let stream = this.streams.get(key);
    if (!stream) {
      stream = [];
      this.streams.set(key, stream);
    }

    const msgId = `${Date.now()}-0`;
    stream.push({ id: msgId, data: fields });
    return Promise.resolve(msgId);
  }

  xreadgroup(
    streams: Array<{ key: string; xid: string }>,
    _options: { group: string; consumer: string; block?: number; count?: number },
  ): Promise<
    Array<{ key: string; messages: Array<{ id: string; data: Record<string, string> }> }>
  > {
    const streamKey = streams[0]?.key;
    if (!streamKey) return Promise.resolve([]);

    const streamData = this.streams.get(streamKey);
    if (!streamData?.length) return Promise.resolve([]);

    const msg = streamData.shift()!;
    return Promise.resolve([{ key: streamKey, messages: [{ id: msg.id, data: msg.data }] }]);
  }

  xgroupCreate(key: string, group: string, _id: string, _mkstream?: boolean): Promise<string> {
    let groups = this.groups.get(key);
    if (!groups) {
      groups = new Set();
      this.groups.set(key, groups);
    }
    groups.add(group);
    return Promise.resolve("OK");
  }

  xack(_key: string, _group: string, ...ids: string[]): Promise<number> {
    return Promise.resolve(ids.length);
  }

  scan(
    _cursor: number,
    _options?: { MATCH?: string; COUNT?: number },
  ): Promise<{ cursor: number; keys: string[] }> {
    return Promise.resolve({ cursor: 0, keys: [] });
  }

  quit(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }
}

class RecordingRunExecutor implements RunExecutor {
  readonly createdRunIds: string[] = [];

  createRunExecution(config: RunExecutionConfig): Promise<string> {
    this.createdRunIds.push(config.run.id);
    return Promise.resolve(config.executionId);
  }

  getRunExecutionStatus(_executionId: string): Promise<RunExecutionInfo | null> {
    return Promise.resolve(null);
  }

  listRunExecutions(_managerId: string): Promise<RunExecutionInfo[]> {
    return Promise.resolve([]);
  }

  deleteRunExecution(_executionId: string): Promise<void> {
    return Promise.resolve();
  }
}

function createTestRun(id: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id,
    workflowId: "wf-1",
    status: "pending",
    input: { topic: "test" },
    nodeStates: {},
    currentNodes: [],
    context: { input: { topic: "test" } },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
    sourceIntegrationPolicy: overrides.sourceIntegrationPolicy ??
      UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
  };
}

describe("RedisBackend", () => {
  let backend: RedisBackend;
  let mockRedis: MockRedisAdapter;

  beforeEach(() => {
    mockRedis = new MockRedisAdapter();
    backend = new RedisBackend({
      client: mockRedis as unknown as RedisAdapter,
      prefix: "test:",
      streamKey: "test:stream",
      groupName: "test:group",
      consumerName: "worker-test",
    });
  });

  describe("constructor defaults", () => {
    it("should set default config values", () => {
      const b = new RedisBackend({ client: mockRedis as unknown as RedisAdapter });
      assertExists(b);
    });
  });

  describe("initialize", () => {
    it("should create consumer group", async () => {
      await backend.initialize();
      assertEquals(
        mockRedis.groups.get("test:stream:schema-v1"),
        new Set(["test:group:schema-v1"]),
      );
    });

    it("should be idempotent", async () => {
      await backend.initialize();
      await backend.initialize();
    });
  });

  describe("createRun / getRun", () => {
    it("stores new runs in a schema-versioned custom-prefix namespace", async () => {
      await backend.createRun(createTestRun("run-versioned-namespace"));

      assertEquals(
        mockRedis.hashes.has("test:schema-v1:run:run-versioned-namespace"),
        true,
      );
      assertEquals(mockRedis.hashes.has("test:run:run-versioned-namespace"), false);
    });

    it("should create and retrieve a run", async () => {
      await backend.createRun(createTestRun("run-1"));

      const retrieved = await backend.getRun("run-1");
      assertExists(retrieved);
      assertEquals(retrieved.id, "run-1");
      assertEquals(retrieved.workflowId, "wf-1");
      assertEquals(retrieved.status, "pending");
    });

    it("should persist the source integration policy snapshot", async () => {
      const sourceIntegrationPolicy = normalizeSourceIntegrationPolicy({
        allow: { confluence: { allowedTools: ["get_page"] } },
      });
      await backend.createRun(createTestRun("run-source-policy", { sourceIntegrationPolicy }));

      const retrieved = await backend.getRun("run-source-policy");
      assertExists(retrieved);
      assertEquals(retrieved.sourceIntegrationPolicy, sourceIntegrationPolicy);
    });

    it("rejects a malformed source policy before persisting a run", async () => {
      const run = createTestRun("run-malformed-source-policy", {
        sourceIntegrationPolicy: {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: {
            confluence: { allowedToolIds: ["get_page", "get_page"] },
          },
        },
      });

      await assertRejects(
        () => backend.createRun(run),
        Error,
        "invalid source integration policy snapshot",
      );
      assertEquals(await backend.getRun(run.id), null);
    });

    it("should return null for non-existent run", async () => {
      assertEquals(await backend.getRun("missing"), null);
    });

    it("should serialize and deserialize dates correctly", async () => {
      await backend.createRun(
        createTestRun("run-dates", {
          startedAt: new Date("2025-06-15T12:00:00Z"),
          completedAt: new Date("2025-06-15T12:30:00Z"),
        }),
      );

      const retrieved = await backend.getRun("run-dates");
      assertExists(retrieved);
      assertEquals(retrieved.startedAt?.toISOString(), "2025-06-15T12:00:00.000Z");
      assertEquals(retrieved.completedAt?.toISOString(), "2025-06-15T12:30:00.000Z");
    });

    it("should serialize output and error as JSON", async () => {
      await backend.createRun(
        createTestRun("run-output", {
          output: { result: "hello" },
          error: { message: "boom" },
        }),
      );

      const retrieved = await backend.getRun("run-output");
      assertExists(retrieved);
      assertEquals(retrieved.output, { result: "hello" });
      assertEquals(retrieved.error, { message: "boom" });
    });

    it("should persist workerId and tenant context", async () => {
      await backend.createRun(
        createTestRun("run-tenant", {
          workerId: "worker-1",
          heartbeatAt: new Date("2025-06-15T12:10:00Z"),
          _tenant: {
            projectSlug: "acme",
            token: "vf_token",
            projectId: "project-123",
            productionMode: false,
            releaseId: null,
          },
        }),
      );

      const retrieved = await backend.getRun("run-tenant");
      assertEquals(retrieved?.workerId, "worker-1");
      assertEquals(retrieved?.heartbeatAt?.toISOString(), "2025-06-15T12:10:00.000Z");
      assertEquals(retrieved?._tenant?.projectSlug, "acme");
      assertEquals(retrieved?._tenant?.token, "vf_token");
    });
  });

  describe("updateRun", () => {
    it("should update status and update index sets", async () => {
      await backend.createRun(createTestRun("run-u1"));
      await backend.updateRun("run-u1", { status: "running", startedAt: new Date() });

      const updated = await backend.getRun("run-u1");
      assertEquals(updated?.status, "running");
    });

    it("should update output and context", async () => {
      await backend.createRun(createTestRun("run-u2"));
      await backend.updateRun("run-u2", {
        output: { value: 42 },
        context: { input: {}, step1: "done" },
      });

      const updated = await backend.getRun("run-u2");
      assertEquals(updated?.output, { value: 42 });
    });

    it("rejects attempts to mutate immutable run identity and policy fields", async () => {
      const run = createTestRun("run-immutable-fields");
      await backend.createRun(run);
      const unsafeUpdateRun = backend.updateRun.bind(backend) as (
        runId: string,
        patch: Record<string, unknown>,
      ) => Promise<void>;

      await assertRejects(
        () =>
          unsafeUpdateRun(run.id, {
            workflowId: "other-workflow",
            sourceIntegrationPolicy: normalizeSourceIntegrationPolicy({ allow: {} }),
          }),
        Error,
        "immutable",
      );

      const stored = await backend.getRun(run.id);
      assertEquals(stored?.workflowId, run.workflowId);
      assertEquals(stored?.sourceIntegrationPolicy, run.sourceIntegrationPolicy);
    });
  });

  describe("deleteRun", () => {
    it("should delete a run and its indexes", async () => {
      await backend.createRun(createTestRun("run-d1"));
      await backend.deleteRun("run-d1");
      assertEquals(await backend.getRun("run-d1"), null);
    });

    it("should no-op for non-existent run", async () => {
      await backend.deleteRun("missing");
    });
  });

  describe("listRuns", () => {
    it("never reads legacy rows or indexes when querying the current schema", async () => {
      mockRedis.hashes.set(
        "test:run:legacy-run",
        new Map([
          ["id", "legacy-run"],
          ["workflowId", "wf-1"],
          ["status", "pending"],
        ]),
      );
      mockRedis.sets.set("test:index:runs", new Set(["legacy-run"]));
      mockRedis.sets.set("test:index:status:pending", new Set(["legacy-run"]));
      mockRedis.sets.set("test:index:workflow:wf-1", new Set(["legacy-run"]));
      await backend.createRun(createTestRun("current-run"));

      assertEquals(await backend.getRun("legacy-run"), null);
      assertEquals((await backend.listRuns({})).map((run) => run.id), ["current-run"]);
      assertEquals(
        (await backend.listRuns({ status: "pending" })).map((run) => run.id),
        ["current-run"],
      );
      assertEquals(
        (await backend.listRuns({ workflowId: "wf-1" })).map((run) => run.id),
        ["current-run"],
      );
      assertEquals(await backend.countRuns({}), 1);
      assertEquals(await backend.countRuns({ status: "pending" }), 1);
      assertEquals(await backend.countRuns({ workflowId: "wf-1" }), 1);
    });

    it("does not let a legacy pending row poison run-manager polling", async () => {
      mockRedis.hashes.set(
        "test:run:legacy-pending",
        new Map([
          ["id", "legacy-pending"],
          ["workflowId", "wf-1"],
          ["status", "pending"],
        ]),
      );
      mockRedis.sets.set("test:index:status:pending", new Set(["legacy-pending"]));
      await backend.createRun(createTestRun("current-pending"));
      const executor = new RecordingRunExecutor();
      const manager = new WorkflowRunManager({
        backend,
        executor,
        pollInterval: 1_000_000,
      });

      await manager.start();
      try {
        await (manager as unknown as { poll(): Promise<void> }).poll();
      } finally {
        await manager.stop();
      }

      assertEquals(executor.createdRunIds, ["current-pending"]);
    });

    it("should list all runs", async () => {
      await backend.createRun(createTestRun("run-a"));
      await backend.createRun(createTestRun("run-b"));

      const runs = await backend.listRuns({});
      assertEquals(runs.length, 2);
    });

    it("should filter by workflowId", async () => {
      await backend.createRun(createTestRun("run-a"));
      await backend.createRun(createTestRun("run-b", { workflowId: "other" }));

      const runs = await backend.listRuns({ workflowId: "wf-1" });
      assertEquals(runs.length, 1);
      assertEquals(runs[0]!.id, "run-a");
    });

    it("should filter by status", async () => {
      await backend.createRun(createTestRun("run-a"));
      await backend.createRun(createTestRun("run-b", { status: "running" }));

      const runs = await backend.listRuns({ status: "running" });
      assertEquals(runs.length, 1);
    });

    it("should apply limit and offset", async () => {
      await backend.createRun(createTestRun("run-1"));
      await backend.createRun(createTestRun("run-2"));
      await backend.createRun(createTestRun("run-3"));

      const runs = await backend.listRuns({ limit: 1, offset: 1 });
      assertEquals(runs.length, 1);
    });
  });

  describe("countRuns", () => {
    it("should count runs matching filter", async () => {
      await backend.createRun(createTestRun("run-a"));
      await backend.createRun(createTestRun("run-b"));
      assertEquals(await backend.countRuns({}), 2);
    });
  });

  describe("checkpoints", () => {
    it("should save and retrieve checkpoints", async () => {
      await backend.createRun(createTestRun("run-cp"));
      await backend.saveCheckpoint("run-cp", {
        id: "cp-1",
        nodeId: "step1",
        timestamp: new Date("2025-01-01T01:00:00Z"),
        context: { input: {} },
        nodeStates: {},
      });

      const latest = await backend.getLatestCheckpoint("run-cp");
      assertExists(latest);
      assertEquals(latest.id, "cp-1");
      assertEquals(latest.nodeId, "step1");
    });

    it("should return null when no checkpoints", async () => {
      assertEquals(await backend.getLatestCheckpoint("no-such"), null);
    });

    it("should list all checkpoints", async () => {
      await backend.createRun(createTestRun("run-cp2"));
      await backend.saveCheckpoint("run-cp2", {
        id: "cp-a",
        nodeId: "n1",
        timestamp: new Date(),
        context: { input: {} },
        nodeStates: {},
      });
      await backend.saveCheckpoint("run-cp2", {
        id: "cp-b",
        nodeId: "n2",
        timestamp: new Date(),
        context: { input: {} },
        nodeStates: {},
      });

      const all = await backend.getCheckpoints("run-cp2");
      assertEquals(all.length, 2);
    });
  });

  describe("approvals", () => {
    function makeApproval(id: string): PendingApproval {
      return {
        id,
        nodeId: "wait-node",
        status: "pending",
        message: "Approve this?",
        payload: { reason: "test" },
        requestedAt: new Date("2025-01-01T00:00:00Z"),
      };
    }

    it("should save and retrieve pending approvals", async () => {
      await backend.createRun(createTestRun("run-ap"));
      await backend.savePendingApproval("run-ap", makeApproval("ap-1"));

      const pending = await backend.getPendingApprovals("run-ap");
      assertEquals(pending.length, 1);
      assertEquals(pending[0]!.id, "ap-1");
      assertEquals(pending[0]!.status, "pending");
    });

    it("should get a specific pending approval", async () => {
      await backend.createRun(createTestRun("run-ap2"));
      await backend.savePendingApproval("run-ap2", makeApproval("ap-2"));

      const found = await backend.getPendingApproval("run-ap2", "ap-2");
      assertExists(found);
      assertEquals(found.id, "ap-2");
    });

    it("should return null for non-existent approval", async () => {
      await backend.createRun(createTestRun("run-ap3"));
      assertEquals(await backend.getPendingApproval("run-ap3", "nope"), null);
    });

    it("should update approval decision", async () => {
      await backend.createRun(createTestRun("run-ap4"));
      await backend.savePendingApproval("run-ap4", makeApproval("ap-4"));

      await backend.updateApproval("run-ap4", "ap-4", {
        approved: true,
        approver: "admin",
        comment: "OK",
      });

      const pending = await backend.getPendingApprovals("run-ap4");
      assertEquals(pending.length, 0);
    });

    it("should throw when updating non-existent approval", async () => {
      await backend.createRun(createTestRun("run-ap5"));
      await assertRejects(
        () => backend.updateApproval("run-ap5", "no-such", { approved: false, approver: "admin" }),
        Error,
        "Approval not found",
      );
    });
  });

  describe("enqueue / dequeue", () => {
    it("never consumes entries from the legacy unversioned stream", async () => {
      mockRedis.streams.set("test:stream", [{
        id: "legacy-1",
        data: {
          runId: "legacy-run",
          workflowId: "wf-legacy",
          createdAt: new Date().toISOString(),
        },
      }]);

      assertEquals(await backend.dequeue(), null);
      assertEquals(mockRedis.streams.get("test:stream")?.length, 1);
    });

    it("should enqueue and dequeue a job", async () => {
      await backend.enqueue({
        runId: "run-q1",
        workflowId: "wf-1",
        input: { data: 1 },
        createdAt: new Date(),
      });

      const job = await backend.dequeue();
      assertExists(job);
      assertEquals(job.runId, "run-q1");
      assertEquals(job.workflowId, "wf-1");
      assertEquals(mockRedis.streams.has("test:stream"), false);
      assertEquals(mockRedis.streams.has("test:stream:schema-v1"), true);
    });

    it("should return null when queue is empty", async () => {
      assertEquals(await backend.dequeue(), null);
    });
  });

  describe("locking", () => {
    it("should acquire and release a lock", async () => {
      assertExists(await backend.acquireLock("run-lock", 5000));
      assertEquals(await backend.isLocked("run-lock"), true);

      await backend.releaseLock("run-lock");
      assertEquals(await backend.isLocked("run-lock"), false);
    });

    it("should fail to acquire lock when already held", async () => {
      assertExists(await backend.acquireLock("run-lock2", 5000));
      assertEquals(await backend.acquireLock("run-lock2", 5000), null);
    });

    it("should extend an existing lock", async () => {
      await backend.acquireLock("run-lock3", 5000);
      assertEquals(await backend.extendLock("run-lock3", 10000), true);
    });

    it("should fail to extend non-existent lock", async () => {
      assertEquals(await backend.extendLock("no-such-lock", 10000), false);
    });

    it("releaseLock should not delete a lock owned by another worker", async () => {
      // Worker A acquires the lock.
      assertExists(await backend.acquireLock("run-own", 5000));
      const lockKey = "test:schema-v1:lock:run-own";

      // Simulate lock expiry + worker B acquiring it: overwrite the stored
      // value with worker B's token.
      mockRedis.store.set(lockKey, "worker-B-token");

      // Worker A tries to release -- it must NOT delete worker B's lock.
      await backend.releaseLock("run-own");

      assertEquals(mockRedis.store.get(lockKey), "worker-B-token");
    });

    it("extendLock should not extend a lock owned by another worker", async () => {
      // Worker A acquires the lock.
      assertExists(await backend.acquireLock("run-own2", 5000));
      const lockKey = "test:schema-v1:lock:run-own2";

      // Simulate worker B taking over the lock.
      mockRedis.store.set(lockKey, "worker-B-token");

      // Worker A tries to extend -- it must NOT succeed.
      assertEquals(await backend.extendLock("run-own2", 10000), false);
    });

    it("releaseLock runs an atomic compare-and-delete script (no GET+DEL race)", async () => {
      // Spy on eval to prove release goes through a single atomic Lua call and
      // never falls back to a separate GET then DEL.
      const evalCalls: Array<{ script: string; keys: string[]; args: string[] }> = [];
      const realEval = mockRedis.eval.bind(mockRedis);
      let getCalls = 0;
      let delCalls = 0;
      mockRedis.eval = (script: string, keys: string[], args: string[]) => {
        evalCalls.push({ script, keys, args });
        return realEval(script, keys, args);
      };
      const realGet = mockRedis.get.bind(mockRedis);
      mockRedis.get = (key: string) => {
        getCalls++;
        return realGet(key);
      };
      const realDel = mockRedis.del.bind(mockRedis);
      mockRedis.del = (...keys: string[]) => {
        delCalls++;
        return realDel(...keys);
      };

      assertExists(await backend.acquireLock("run-atomic", 5000));
      await backend.releaseLock("run-atomic");

      // One atomic eval, and no separate get/del round-trips for the release.
      assertEquals(evalCalls.length, 1);
      assertEquals(evalCalls[0]!.script.includes("del"), true);
      assertEquals(getCalls, 0);
      assertEquals(delCalls, 0);
      assertEquals(await backend.isLocked("run-atomic"), false);
    });

    it("compare-and-delete deletes only on a matching token", async () => {
      const key = "test:schema-v1:lock:cad";

      // Mismatched token -> script must be a no-op and return 0.
      mockRedis.store.set(key, "owner-token");
      const noop = await mockRedis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        [key],
        ["other-token"],
      );
      assertEquals(noop, 0);
      assertEquals(mockRedis.store.get(key), "owner-token");

      // Matching token -> script deletes and returns 1.
      const deleted = await mockRedis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        [key],
        ["owner-token"],
      );
      assertEquals(deleted, 1);
      assertEquals(mockRedis.store.get(key), undefined);
    });
  });

  describe("stalled run recovery", () => {
    it("should find stalled runs", async () => {
      await backend.createRun(
        createTestRun("run-fresh", {
          status: "running",
          startedAt: new Date(Date.now() - 120_000),
          heartbeatAt: new Date(),
        }),
      );
      await backend.createRun(
        createTestRun("run-stalled", {
          status: "running",
          startedAt: new Date(Date.now() - 120_000),
        }),
      );

      const stalled = await backend.findStalledRuns(60_000);
      assertEquals(stalled.map((run) => run.id), ["run-stalled"]);
    });

    it("should claim a stalled run once and set workerId", async () => {
      await backend.createRun(
        createTestRun("run-claim", {
          status: "running",
          startedAt: new Date(Date.now() - 120_000),
        }),
      );

      assertEquals(await backend.claimStalledRun("run-claim", "worker-a", 60_000), true);
      assertEquals(await backend.claimStalledRun("run-claim", "worker-b", 60_000), false);

      const run = await backend.getRun("run-claim");
      assertEquals(run?.workerId, "worker-a");
      assertExists(run?.heartbeatAt);
    });
  });

  describe("healthCheck", () => {
    it("should return true for healthy connection", async () => {
      assertEquals(await backend.healthCheck(), true);
    });
  });

  describe("destroy", () => {
    it("should clean up resources", async () => {
      await backend.destroy();
      assertExists(backend);
    });
  });

  describe("deserialization errors", () => {
    it("should throw on missing id field", async () => {
      mockRedis.hashes.set("test:schema-v1:run:bad1", new Map([["workflowId", "wf"]]));
      await assertRejects(() => backend.getRun("bad1"), Error, "missing 'id'");
    });

    it("should throw on missing workflowId field", async () => {
      mockRedis.hashes.set("test:schema-v1:run:bad2", new Map([["id", "bad2"]]));
      await assertRejects(() => backend.getRun("bad2"), Error, "missing 'workflowId'");
    });

    it("should throw on a missing source integration policy snapshot", async () => {
      mockRedis.hashes.set(
        "test:schema-v1:run:missing-source-policy",
        new Map([
          ["id", "missing-source-policy"],
          ["workflowId", "wf"],
        ]),
      );
      await assertRejects(
        () => backend.getRun("missing-source-policy"),
        Error,
        "missing 'sourceIntegrationPolicy'",
      );
    });

    it("should throw on a corrupt source integration policy snapshot", async () => {
      mockRedis.hashes.set(
        "test:schema-v1:run:corrupt-source-policy",
        new Map([
          ["id", "corrupt-source-policy"],
          ["workflowId", "wf"],
          [
            "sourceIntegrationPolicy",
            JSON.stringify({
              schemaVersion: 1,
              mode: "allowlist",
              integrations: {
                confluence: { allowedToolIds: ["get_page", "get_page"] },
              },
            }),
          ],
        ]),
      );

      await assertRejects(
        () => backend.getRun("corrupt-source-policy"),
        Error,
        "invalid source integration policy snapshot",
      );
    });

    it("should throw on invalid status", async () => {
      mockRedis.hashes.set(
        "test:schema-v1:run:bad3",
        new Map([
          ["id", "bad3"],
          ["workflowId", "wf"],
          ["status", "invalidStatus"],
          [
            "sourceIntegrationPolicy",
            JSON.stringify(UNRESTRICTED_SOURCE_INTEGRATION_POLICY),
          ],
        ]),
      );
      await assertRejects(() => backend.getRun("bad3"), Error, "unknown status");
    });

    it("should throw on invalid JSON in fields", async () => {
      mockRedis.hashes.set(
        "test:schema-v1:run:bad4",
        new Map([
          ["id", "bad4"],
          ["workflowId", "wf"],
          ["status", "pending"],
          [
            "sourceIntegrationPolicy",
            JSON.stringify(UNRESTRICTED_SOURCE_INTEGRATION_POLICY),
          ],
          ["input", "{invalid-json"],
        ]),
      );
      await assertRejects(() => backend.getRun("bad4"), Error, "failed to parse");
    });
  });

  describe("nack", () => {
    it("should re-enqueue a failed run", async () => {
      await backend.createRun(createTestRun("run-nack"));
      await backend.nack("run-nack");

      const job = await backend.dequeue();
      assertExists(job);
      assertEquals(job.runId, "run-nack");
    });

    it("should no-op for non-existent run", async () => {
      await backend.nack("missing");
    });
  });

  describe("acknowledge", () => {
    it("should resolve without error when nothing was dequeued", async () => {
      await backend.acknowledge("run-ack");
    });

    it("should XACK the exact stream message read by dequeue", async () => {
      const ackCalls: Array<{ key: string; group: string; ids: string[] }> = [];
      const realXack = mockRedis.xack.bind(mockRedis);
      mockRedis.xack = (key: string, group: string, ...ids: string[]) => {
        ackCalls.push({ key, group, ids });
        return realXack(key, group, ...ids);
      };

      await backend.enqueue({
        runId: "run-ackx",
        workflowId: "wf-1",
        input: {},
        createdAt: new Date(),
      });

      const job = await backend.dequeue();
      assertExists(job);
      assertEquals(job.runId, "run-ackx");

      await backend.acknowledge("run-ackx");

      assertEquals(ackCalls.length, 1);
      assertEquals(ackCalls[0]!.key, "test:stream:schema-v1");
      assertEquals(ackCalls[0]!.group, "test:group:schema-v1");
      assertEquals(ackCalls[0]!.ids.length, 1);

      // Second acknowledge is a no-op (already acked, nothing tracked).
      await backend.acknowledge("run-ackx");
      assertEquals(ackCalls.length, 1);
    });

    it("nack XACKs the consumed message before re-enqueueing", async () => {
      const ackCalls: string[][] = [];
      const realXack = mockRedis.xack.bind(mockRedis);
      mockRedis.xack = (key: string, group: string, ...ids: string[]) => {
        ackCalls.push(ids);
        return realXack(key, group, ...ids);
      };

      await backend.createRun(createTestRun("run-nack-ack"));
      await backend.enqueue({
        runId: "run-nack-ack",
        workflowId: "wf-1",
        input: {},
        createdAt: new Date(),
      });

      await backend.dequeue();
      await backend.nack("run-nack-ack");

      // Old PEL entry acked exactly once, and a fresh job is queued.
      assertEquals(ackCalls.length, 1);
      const requeued = await backend.dequeue();
      assertExists(requeued);
      assertEquals(requeued.runId, "run-nack-ack");
    });
  });

  describe("runTtl config", () => {
    it("should set expire when runTtl is configured", async () => {
      const ttlBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "ttl:",
        runTtl: 3600,
      });
      await ttlBackend.createRun(createTestRun("run-ttl"));

      assertEquals(mockRedis.expiries.has("ttl:schema-v1:run:run-ttl"), true);
    });
  });

  describe("listPendingApprovals", () => {
    it("should list approvals across runs", async () => {
      await backend.createRun(createTestRun("run-lpa1"));
      await backend.savePendingApproval("run-lpa1", {
        id: "ap-x",
        nodeId: "n",
        status: "pending",
        message: "yes?",
        payload: { reason: "test" },
        requestedAt: new Date(),
      });

      const results = await backend.listPendingApprovals({ status: "pending" });
      assertEquals(results.length, 1);
      assertEquals(results[0]!.approval.id, "ap-x");
    });
  });

  describe("run indexes", () => {
    it("does not discover or backfill rows missing from the versioned index", async () => {
      await backend.createRun(createTestRun("orphaned-run"));
      mockRedis.sets.delete("test:schema-v1:index:runs");

      const runs = await backend.listRuns({});

      assertEquals(runs, []);
      assertEquals(mockRedis.sets.has("test:schema-v1:index:runs"), false);
    });

    it("counts the intersection of workflow and status indexes", async () => {
      await backend.createRun(createTestRun("pending-x", { workflowId: "wf-x" }));
      await backend.createRun(
        createTestRun("running-x", { workflowId: "wf-x", status: "running" }),
      );
      await backend.createRun(createTestRun("pending-y", { workflowId: "wf-y" }));

      assertEquals(await backend.countRuns({ workflowId: "wf-x", status: "pending" }), 1);
      assertEquals(await backend.countRuns({ workflowId: "wf-x" }), 2);
      assertEquals(await backend.countRuns({ status: ["pending", "running"] }), 3);
      assertEquals(await backend.countRuns({ createdAfter: new Date("2026-01-01") }), 0);
      assertEquals(await backend.countRuns({ createdBefore: new Date("2024-01-01") }), 0);
    });
  });
});
