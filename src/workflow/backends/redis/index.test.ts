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

  xgroupCreate(_key: string, _group: string, _id: string, _mkstream?: boolean): Promise<string> {
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
    });

    it("should be idempotent", async () => {
      await backend.initialize();
      await backend.initialize();
    });
  });

  describe("createRun / getRun", () => {
    it("should create and retrieve a run", async () => {
      await backend.createRun(createTestRun("run-1"));

      const retrieved = await backend.getRun("run-1");
      assertExists(retrieved);
      assertEquals(retrieved.id, "run-1");
      assertEquals(retrieved.workflowId, "wf-1");
      assertEquals(retrieved.status, "pending");
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
    });

    it("should return null when queue is empty", async () => {
      assertEquals(await backend.dequeue(), null);
    });
  });

  describe("locking", () => {
    it("should acquire and release a lock", async () => {
      assertEquals(await backend.acquireLock("run-lock", 5000), true);
      assertEquals(await backend.isLocked("run-lock"), true);

      await backend.releaseLock("run-lock");
      assertEquals(await backend.isLocked("run-lock"), false);
    });

    it("should fail to acquire lock when already held", async () => {
      assertEquals(await backend.acquireLock("run-lock2", 5000), true);
      assertEquals(await backend.acquireLock("run-lock2", 5000), false);
    });

    it("should extend an existing lock", async () => {
      await backend.acquireLock("run-lock3", 5000);
      assertEquals(await backend.extendLock("run-lock3", 10000), true);
    });

    it("should fail to extend non-existent lock", async () => {
      assertEquals(await backend.extendLock("no-such-lock", 10000), false);
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
      mockRedis.hashes.set("test:run:bad1", new Map([["workflowId", "wf"]]));
      await assertRejects(() => backend.getRun("bad1"), Error, "missing 'id'");
    });

    it("should throw on missing workflowId field", async () => {
      mockRedis.hashes.set("test:run:bad2", new Map([["id", "bad2"]]));
      await assertRejects(() => backend.getRun("bad2"), Error, "missing 'workflowId'");
    });

    it("should throw on invalid status", async () => {
      mockRedis.hashes.set(
        "test:run:bad3",
        new Map([
          ["id", "bad3"],
          ["workflowId", "wf"],
          ["status", "invalidStatus"],
        ]),
      );
      await assertRejects(() => backend.getRun("bad3"), Error, "unknown status");
    });

    it("should throw on invalid JSON in fields", async () => {
      mockRedis.hashes.set(
        "test:run:bad4",
        new Map([
          ["id", "bad4"],
          ["workflowId", "wf"],
          ["status", "pending"],
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
    it("should resolve without error", async () => {
      await backend.acknowledge("run-ack");
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

      assertEquals(mockRedis.expiries.has("ttl:run:run-ttl"), true);
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
});
