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
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/index.ts";
import { RedisBackend } from "./index.ts";
import type { RedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";
import type { PendingApproval, WorkflowRun } from "../../types.ts";
import { MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES } from "../../limits.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { WorkflowRunManager } from "../../worker/run-manager.ts";
import type {
  RunExecutionConfig,
  RunExecutionInfo,
  RunExecutor,
} from "../../worker/executors/types.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);
const jsonRawSupport = JSON as typeof JSON & {
  rawJSON(source: string): unknown;
};

class MockRedisAdapter implements RedisAdapter {
  store = new Map<string, string>();
  hashes = new Map<string, Map<string, string>>();
  lists = new Map<string, string[]>();
  sets = new Map<string, Set<string>>();
  expiries = new Map<string, number>();
  streams = new Map<string, Array<{ id: string; data: Record<string, string> }>>();
  groups = new Map<string, Set<string>>();
  nextStreamSequence = 1;

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
      if (this.streams.delete(key)) count++;
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

    if (script.includes("open-run-observation")) {
      const hash = this.hashes.get(key);
      if (!hash) return Promise.resolve(null);
      return Promise.resolve([
        hash.get("__runObservationRevision") ?? "0",
        JSON.stringify(Object.fromEntries(hash)),
      ]);
    }

    if (script.includes("observable-run-update")) {
      const hash = this.hashes.get(key);
      if (!hash) return Promise.resolve(0);
      const runId = args[0]!;
      const nextStatus = args[1]!;
      const statusPrefix = args[2]!;
      const streamKey = args[3]!;
      const maxLength = Number(args[4]);
      const oldStatus = hash.get("status") ?? "";
      if (nextStatus && nextStatus !== oldStatus) {
        hash.set("status", nextStatus);
        this.sets.get(statusPrefix + oldStatus)?.delete(runId);
        let nextSet = this.sets.get(statusPrefix + nextStatus);
        if (!nextSet) {
          nextSet = new Set();
          this.sets.set(statusPrefix + nextStatus, nextSet);
        }
        nextSet.add(runId);
      }
      for (let i = 5; i < args.length; i += 2) hash.set(args[i]!, args[i + 1]!);
      this.appendRunObservation(hash, streamKey, maxLength);
      return Promise.resolve(1);
    }

    if (script.includes("retained-list-append")) {
      let list = this.lists.get(key);
      if (!list) {
        list = [];
        this.lists.set(key, list);
      }
      list.push(args[0]!);
      const maxEntries = Number(args[1]);
      if (list.length > maxEntries) list.splice(0, list.length - maxEntries);
      return Promise.resolve(list.length);
    }

    if (script.includes("conditional-stalled-run-claim")) {
      const claimKey = keys[1]!;
      const observedActivity = args[0]!;
      const workerId = args[1]!;
      const claimDuration = Number(args[2]);
      const now = args[3]!;
      const streamKey = args[4]!;
      const maxLength = Number(args[5]);
      const hash = this.hashes.get(key);
      if (!hash || hash.get("status") !== "running") return Promise.resolve(0);
      const activity = hash.get("heartbeatAt") || hash.get("startedAt") || hash.get("createdAt");
      if (activity !== observedActivity || this.store.has(claimKey)) return Promise.resolve(0);

      this.store.set(claimKey, workerId);
      this.expiries.set(claimKey, claimDuration);
      hash.set("workerId", workerId);
      hash.set("heartbeatAt", now);
      if (!hash.get("startedAt")) hash.set("startedAt", now);
      this.appendRunObservation(hash, streamKey, maxLength);
      return Promise.resolve(1);
    }

    if (script.includes("conditional-owned-append")) {
      const expectedCount = Number(args[0]);
      const expectedStatuses = args.slice(1, expectedCount + 1);
      const expectedWorkerId = args[expectedCount + 1]!;
      const storageKey = args[expectedCount + 2]!;
      const value = args[expectedCount + 3]!;
      const hash = this.hashes.get(key);
      if (
        !hash || !expectedStatuses.includes(hash.get("status") ?? "") ||
        hash.get("workerId") !== expectedWorkerId
      ) {
        return Promise.resolve(0);
      }

      let list = this.lists.get(storageKey);
      if (!list) {
        list = [];
        this.lists.set(storageKey, list);
      }
      list.push(value);
      const maxEntries = Number(args[expectedCount + 4]);
      if (Number.isSafeInteger(maxEntries) && maxEntries > 0 && list.length > maxEntries) {
        list.splice(0, list.length - maxEntries);
      }
      return Promise.resolve(1);
    }

    if (script.includes("conditional-approval-patch")) {
      const approvalId = args[0]!;
      const patch = JSON.parse(args[1]!);
      const list = this.lists.get(key);
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const approval = JSON.parse(list[i]!);
          if (approval.id === approvalId) {
            list[i] = JSON.stringify({ ...approval, ...patch, id: approvalId });
            return Promise.resolve(1);
          }
        }
      }
      return Promise.resolve(0);
    }

    if (script.includes("conditional-approval-decision")) {
      const approvalId = args[0]!;
      const newStatus = args[1]!;
      const decidedBy = args[2]!;
      const decidedAt = args[3]!;
      const hasComment = args[4] === "1";
      const comment = args[5];
      const list = this.lists.get(key);
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const approval = JSON.parse(list[i]!);
          if (approval.id === approvalId) {
            if (approval.status !== "pending") return Promise.resolve(2);
            approval.status = newStatus;
            approval.decidedBy = decidedBy;
            approval.decidedAt = decidedAt;
            if (hasComment) approval.comment = comment;
            else delete approval.comment;
            list[i] = JSON.stringify(approval);
            return Promise.resolve(1);
          }
        }
      }
      return Promise.resolve(0);
    }

    if (script.includes("conditional-run-update")) {
      const expectedCount = Number(args[0]);
      const expectedStatuses = args.slice(1, expectedCount + 1);
      const nextStatus = args[expectedCount + 1]!;
      const statusPrefix = args[expectedCount + 2]!;
      const runId = args[expectedCount + 3]!;
      const expectedWorkerId = args[expectedCount + 4]!;
      const hash = this.hashes.get(key);
      const oldStatus = hash?.get("status");
      if (!hash || !oldStatus || !expectedStatuses.includes(oldStatus)) {
        return Promise.resolve(0);
      }
      if (expectedWorkerId && hash.get("workerId") !== expectedWorkerId) {
        return Promise.resolve(0);
      }

      if (nextStatus && oldStatus !== nextStatus) {
        hash.set("status", nextStatus);
        this.sets.get(statusPrefix + oldStatus)?.delete(runId);
        let nextSet = this.sets.get(statusPrefix + nextStatus);
        if (!nextSet) {
          nextSet = new Set();
          this.sets.set(statusPrefix + nextStatus, nextSet);
        }
        nextSet.add(runId);
      }

      const streamKey = args[expectedCount + 5]!;
      const maxLength = Number(args[expectedCount + 6]);
      for (let i = expectedCount + 7; i < args.length; i += 2) {
        hash.set(args[i]!, args[i + 1]!);
      }
      this.appendRunObservation(hash, streamKey, maxLength);
      return Promise.resolve(1);
    }

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

    const msgId = `${this.nextStreamSequence++}-0`;
    stream.push({ id: msgId, data: fields });
    return Promise.resolve(msgId);
  }

  xread(
    streams: Array<{ key: string; xid: string }>,
    options: { block?: number; count?: number } = {},
  ): Promise<
    Array<{ key: string; messages: Array<{ id: string; data: Record<string, string> }> }>
  > {
    const requested = streams[0];
    if (!requested) return Promise.resolve([]);
    const after = Number(requested.xid.split("-")[0]);
    const messages = (this.streams.get(requested.key) ?? []).filter((message) =>
      Number(message.id.split("-")[0]) > after
    ).slice(0, options.count);
    return Promise.resolve(messages.length > 0 ? [{ key: requested.key, messages }] : []);
  }

  private appendRunObservation(
    hash: Map<string, string>,
    streamKey: string,
    maxLength: number,
  ): number {
    const revision = Number(hash.get("__runObservationRevision") ?? "0") + 1;
    hash.set("__runObservationRevision", String(revision));
    const sourceNodes = JSON.parse(hash.get("nodeStates") ?? "{}") as Record<
      string,
      { status: string; attempt: number; error?: string }
    >;
    const nodes = Object.fromEntries(
      Object.entries(sourceNodes).map(([nodeId, node]) => [
        nodeId,
        {
          status: node.status,
          attempt: node.attempt,
          ...(node.error !== undefined ? { error: node.error } : {}),
        },
      ]),
    );
    const data: Record<string, string> = {
      revision: String(revision),
      status: hash.get("status") ?? "",
      nodes: JSON.stringify(nodes),
    };
    const rawError = hash.get("error");
    if (rawError) {
      const error = JSON.parse(rawError) as { message?: string };
      if (error.message !== undefined) data.runError = error.message;
    }
    let stream = this.streams.get(streamKey);
    if (!stream) {
      stream = [];
      this.streams.set(streamKey, stream);
    }
    stream.push({ id: `${this.nextStreamSequence++}-0`, data });
    if (stream.length > maxLength) stream.splice(0, stream.length - maxLength);
    return revision;
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
    it("observes cross-instance run transitions in exact revision order", async () => {
      const writer = new RedisBackend({ client: mockRedis, prefix: "test:" });
      const reader = new RedisBackend({ client: mockRedis, prefix: "test:" });
      const run = createTestRun("run-observed");
      await writer.createRun(run);

      const observation = await reader.openRunObservation(run.id);
      assertExists(observation);
      await writer.updateRun(run.id, { status: "waiting" });
      await writer.updateRun(run.id, { status: "running" });

      const iterator = observation.changes[Symbol.asyncIterator]();
      assertEquals((await iterator.next()).value, {
        revision: 1,
        status: "waiting",
        nodes: {},
      });
      assertEquals((await iterator.next()).value, {
        revision: 2,
        status: "running",
        nodes: {},
      });
      await observation.close();
    });

    it("does not lose an update racing observation setup", async () => {
      const run = createTestRun("run-open-race");
      await backend.createRun(run);

      const opening = backend.openRunObservation(run.id);
      await backend.updateRun(run.id, { status: "running" });
      const observation = await opening;
      assertExists(observation);

      assertEquals((await observation.changes[Symbol.asyncIterator]().next()).value, {
        revision: 1,
        status: "running",
        nodes: {},
      });
      await observation.close();
    });

    it("journals only successful conditional updates", async () => {
      const run = createTestRun("run-observed-conditional");
      await backend.createRun(run);
      const observation = await backend.openRunObservation(run.id);
      assertExists(observation);

      assertEquals(
        await backend.updateRunIfStatus(run.id, ["running"], { status: "failed" }),
        false,
      );
      assertEquals(
        await backend.updateRunIfStatus(run.id, ["pending"], { status: "running" }),
        true,
      );

      assertEquals((await observation.changes[Symbol.asyncIterator]().next()).value, {
        revision: 1,
        status: "running",
        nodes: {},
      });
      await observation.close();
    });

    it("stores and exposes only reduced observable state", async () => {
      const run = createTestRun("run-observed-reduced", {
        workerId: "private-worker",
        _tenant: {
          projectSlug: "private-project",
          token: "private-token",
          productionMode: false,
        },
      });
      await backend.createRun(run);
      const observation = await backend.openRunObservation(run.id);
      assertExists(observation);

      await backend.updateRun(run.id, {
        status: "failed",
        output: { secret: "private-output" },
        context: { input: { secret: "private-input" } },
        nodeStates: {
          step: {
            nodeId: "step",
            status: "failed",
            attempt: 2,
            input: { secret: "node-input" },
            output: { secret: "node-output" },
            error: "safe node failure",
          },
        },
        error: { message: "safe run failure", stack: "private stack" },
      });

      const iterator = observation.changes[Symbol.asyncIterator]();
      assertEquals((await iterator.next()).value, {
        revision: 1,
        status: "failed",
        nodes: { step: { status: "failed", attempt: 2, error: "safe node failure" } },
        runError: "safe run failure",
      });
      assertEquals(await iterator.next(), { value: undefined, done: true });

      const stream = mockRedis.streams.get(
        "test:schema-v1:run-observation:run-observed-reduced",
      );
      assertEquals(stream?.map((entry) => Object.keys(entry.data).sort()), [
        ["nodes", "revision", "status"],
        ["nodes", "revision", "runError", "status"],
      ]);
      assertEquals(JSON.stringify(stream).includes("private"), false);
    });

    it("fails with a sanitized error when the retained journal has a revision gap", async () => {
      const run = createTestRun("run-observed-gap");
      await backend.createRun(run);
      const observation = await backend.openRunObservation(run.id);
      assertExists(observation);
      mockRedis.streams.set("test:schema-v1:run-observation:run-observed-gap", [{
        id: "999-0",
        data: { revision: "2", status: "running", nodes: "{}" },
      }]);

      await assertRejects(
        () => observation.changes[Symbol.asyncIterator]().next(),
        Error,
        "Workflow run observation failed",
      );
    });

    it("sanitizes Redis read and record parse failures", async () => {
      const run = createTestRun("run-observed-read-failure");
      await backend.createRun(run);
      const readFailure = await backend.openRunObservation(run.id);
      assertExists(readFailure);
      mockRedis.xread = () => Promise.reject(new Error("redis://private-host raw failure"));
      await assertRejects(
        () => readFailure.changes[Symbol.asyncIterator]().next(),
        Error,
        "Workflow run observation failed",
      );

      const parseBackend = new RedisBackend({ client: mockRedis, prefix: "parse:" });
      const parseRun = createTestRun("run-observed-parse-failure");
      await parseBackend.createRun(parseRun);
      const parseFailure = await parseBackend.openRunObservation(parseRun.id);
      assertExists(parseFailure);
      mockRedis.xread = (_streams) =>
        Promise.resolve([{
          key: "parse:schema-v1:run-observation:run-observed-parse-failure",
          messages: [{
            id: "1000-0",
            data: { revision: "not-a-revision", status: "running", nodes: "private payload" },
          }],
        }]);
      await assertRejects(
        () => parseFailure.changes[Symbol.asyncIterator]().next(),
        Error,
        "Workflow run observation failed",
      );
    });

    it("closes observations on abort, destroy, and terminal states", async () => {
      const run = createTestRun("run-observed-close");
      await backend.createRun(run);
      const controller = new AbortController();
      const aborted = await backend.openRunObservation(run.id, { signal: controller.signal });
      const destroyed = await backend.openRunObservation(run.id);
      assertExists(aborted);
      assertExists(destroyed);
      controller.abort();
      assertEquals(await aborted.changes[Symbol.asyncIterator]().next(), {
        value: undefined,
        done: true,
      });
      await backend.destroy();
      assertEquals(await destroyed.changes[Symbol.asyncIterator]().next(), {
        value: undefined,
        done: true,
      });
    });

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

    it("reports an invalid duplicated input through the workflow serializer", async () => {
      const input = { total: 1n };
      const run = createTestRun("run-invalid-input", {
        input,
        context: { input },
      });

      await assertRejects(
        () => backend.createRun(run),
        Error,
        "context.input.total",
      );
      assertEquals(await backend.getRun(run.id), null);
    });

    it("does not warn about framework-owned node timestamps", async () => {
      const warnings: LogEntry[] = [];
      const unsubscribe = __subscribeLogRecordEmitter((entry) => {
        if (entry.level === "warn" && entry.component === "workflow-context") {
          warnings.push(entry);
        }
      });

      try {
        await backend.createRun(createTestRun("run-node-timestamps", {
          nodeStates: {
            step: {
              nodeId: "step",
              status: "completed",
              attempt: 1,
              startedAt: new Date("2025-01-01T00:00:00Z"),
              completedAt: new Date("2025-01-01T00:00:01Z"),
            },
          },
        }));
      } finally {
        unsubscribe();
      }

      assertEquals(warnings, []);
    });
  });

  describe("updateRun", () => {
    it("should update status and update index sets", async () => {
      await backend.createRun(createTestRun("run-u1"));
      await backend.updateRun("run-u1", { status: "running", startedAt: new Date() });

      const updated = await backend.getRun("run-u1");
      assertEquals(updated?.status, "running");
    });

    it("rejects an update for a missing run", async () => {
      await assertRejects(
        () => backend.updateRun("missing-run", { status: "running" }),
        Error,
        "Run not found",
      );
      assertEquals(await backend.getRun("missing-run"), null);
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

    it("reports an invalid duplicated output through the workflow serializer", async () => {
      const runId = "run-invalid-output";
      const output = { total: 1n };
      await backend.createRun(createTestRun(runId));

      await assertRejects(
        () =>
          backend.updateRun(runId, {
            output,
            context: { input: {}, step: output },
          }),
        Error,
        "context.step.total",
      );
      const stored = await backend.getRun(runId);
      assertEquals(stored?.output, undefined);
      assertEquals(stored?.context, { input: { topic: "test" } });
    });

    it("clears optional run fields when a patch explicitly sets undefined", async () => {
      const runId = "run-clear-optionals";
      const timestamp = new Date("2025-06-15T12:10:00.000Z");
      await backend.createRun(createTestRun(runId));
      await backend.updateRun(runId, {
        output: { value: 42 },
        error: { message: "failed", stack: "internal stack" },
        workerId: "worker-1",
        startedAt: timestamp,
        heartbeatAt: timestamp,
        completedAt: timestamp,
      });

      await backend.updateRun(runId, {
        output: undefined,
        error: undefined,
        workerId: undefined,
        startedAt: undefined,
        heartbeatAt: undefined,
        completedAt: undefined,
      });

      const updated = await backend.getRun(runId);
      assertEquals(updated?.output, undefined);
      assertEquals(updated?.error, undefined);
      assertEquals(updated?.workerId, undefined);
      assertEquals(updated?.startedAt, undefined);
      assertEquals(updated?.heartbeatAt, undefined);
      assertEquals(updated?.completedAt, undefined);
    });

    it("should atomically reject a patch when the current status is not expected", async () => {
      await backend.createRun(createTestRun("run-cas"));

      assertEquals(
        await backend.updateRunIfStatus("run-cas", ["running"], {
          status: "completed",
          output: { stale: true },
        }),
        false,
      );
      assertEquals((await backend.getRun("run-cas"))?.status, "pending");
      assertEquals((await backend.getRun("run-cas"))?.output, undefined);

      assertEquals(
        await backend.updateRunIfStatus("run-cas", ["pending"], {
          status: "running",
          workerId: "worker-cas",
        }),
        true,
      );
      const updated = await backend.getRun("run-cas");
      assertEquals(updated?.status, "running");
      assertEquals(updated?.workerId, "worker-cas");
      assertEquals(await backend.listRuns({ status: "pending" }), []);
      assertEquals(
        (await backend.listRuns({ status: "running" })).map((run) => run.id),
        ["run-cas"],
      );
      assertEquals(await backend.countRuns({ status: "pending" }), 0);
      assertEquals(await backend.countRuns({ status: "running" }), 1);
    });

    it("moves conditional status updates between current-schema index sets", async () => {
      const runId = "run-cas-index";
      await backend.createRun(createTestRun(runId));

      assertEquals(
        await backend.updateRunIfStatus(runId, ["pending"], { status: "running" }),
        true,
      );

      assertEquals(
        mockRedis.sets.get("test:schema-v1:index:status:pending")?.has(runId),
        false,
      );
      assertEquals(
        mockRedis.sets.get("test:schema-v1:index:status:running")?.has(runId),
        true,
      );
      assertEquals(mockRedis.sets.has("test:index:status:running"), false);
      assertEquals(await backend.listRuns({ status: "pending" }), []);
      assertEquals(
        (await backend.listRuns({ status: "running" })).map((run) => run.id),
        [runId],
      );
      assertEquals(await backend.countRuns({ status: "pending" }), 0);
      assertEquals(await backend.countRuns({ status: "running" }), 1);
    });

    it("should atomically reject a patch from a stale worker owner", async () => {
      await backend.createRun(createTestRun("run-owner-cas"));
      await backend.updateRun("run-owner-cas", {
        status: "running",
        workerId: "worker-new",
      });

      assertEquals(
        await backend.updateRunIfStatusAndWorker(
          "run-owner-cas",
          ["running"],
          "worker-old",
          { status: "failed" },
        ),
        false,
      );
      assertEquals((await backend.getRun("run-owner-cas"))?.status, "running");

      assertEquals(
        await backend.updateRunIfStatusAndWorker(
          "run-owner-cas",
          ["running"],
          "worker-new",
          { status: "failed" },
        ),
        true,
      );
      assertEquals((await backend.getRun("run-owner-cas"))?.status, "failed");
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

    it("rejects immutable tenant changes through conditional update methods", async () => {
      const tenant = {
        projectSlug: "original-project",
        token: "original-token",
        productionMode: false,
        releaseId: null,
      };
      const run = createTestRun("run-immutable-tenant", {
        status: "running",
        workerId: "worker-1",
        _tenant: tenant,
      });
      await backend.createRun(run);
      const replacementTenant = {
        ...tenant,
        projectSlug: "other-project",
        token: "other-token",
      };
      const unsafeConditionalUpdate = backend.updateRunIfStatus.bind(backend) as (
        runId: string,
        statuses: WorkflowRun["status"][],
        patch: Record<string, unknown>,
      ) => Promise<boolean>;
      const unsafeOwnedConditionalUpdate = backend.updateRunIfStatusAndWorker.bind(backend) as (
        runId: string,
        statuses: WorkflowRun["status"][],
        workerId: string,
        patch: Record<string, unknown>,
      ) => Promise<boolean>;

      await assertRejects(
        () => unsafeConditionalUpdate(run.id, ["running"], { _tenant: replacementTenant }),
        Error,
        "immutable",
      );
      await assertRejects(
        () =>
          unsafeOwnedConditionalUpdate(
            run.id,
            ["running"],
            "worker-1",
            { _tenant: replacementTenant },
          ),
        Error,
        "immutable",
      );

      assertEquals((await backend.getRun(run.id))?._tenant, tenant);
    });
  });

  describe("deleteRun", () => {
    it("should delete a run and its indexes", async () => {
      await backend.createRun(createTestRun("run-d1"));
      await backend.updateRun("run-d1", { status: "running" });
      assertEquals(
        mockRedis.streams.has("test:schema-v1:run-observation:run-d1"),
        true,
      );
      await backend.deleteRun("run-d1");
      assertEquals(await backend.getRun("run-d1"), null);
      assertEquals(
        mockRedis.streams.has("test:schema-v1:run-observation:run-d1"),
        false,
      );
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

    it("reports an invalid context before saving a checkpoint", async () => {
      const runId = "run-cp-invalid-context";

      await assertRejects(
        () =>
          backend.saveCheckpoint(runId, {
            id: "cp-invalid",
            nodeId: "step",
            timestamp: new Date(),
            context: { input: {}, step: { total: 1n } },
            nodeStates: {},
          }),
        Error,
        "checkpoint.context.step.total",
      );
      assertEquals(await backend.getCheckpoints(runId), []);
    });

    it("preserves raw JSON tokens in checkpoint context", async () => {
      const runId = "run-cp-raw-json";
      await backend.saveCheckpoint(runId, {
        id: "cp-raw-json",
        nodeId: "step",
        timestamp: new Date(),
        context: { input: {}, step: jsonRawSupport.rawJSON("-0") },
        nodeStates: {},
      });

      const checkpoint = await backend.getLatestCheckpoint(runId);
      assertEquals(Object.is(checkpoint?.context.step, -0), true);
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

    it("bounds unconditional checkpoint history at the shared limit", async () => {
      for (let index = 0; index <= MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES; index++) {
        await backend.saveCheckpoint("run-cp-bounded", {
          id: `cp-${index}`,
          nodeId: `step-${index}`,
          timestamp: new Date(index),
          context: { input: {} },
          nodeStates: {},
        });
      }

      const checkpoints = await backend.getCheckpoints("run-cp-bounded");
      assertEquals(checkpoints.length, MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES);
      assertEquals(checkpoints[0]?.id, "cp-1");
      assertEquals(checkpoints.at(-1)?.id, `cp-${MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES}`);
    });

    it("should condition checkpoint appends on the canonical run owner", async () => {
      await backend.createRun(createTestRun("run-cp-owned", {
        status: "running",
        workerId: "worker-new",
      }));
      const checkpoint = {
        id: "cp-owned",
        nodeId: "step-owned",
        timestamp: new Date(),
        context: { input: {} },
        nodeStates: {},
      };

      assertEquals(
        await backend.saveCheckpointIfStatusAndWorker(
          "synthetic-child-run",
          "run-cp-owned",
          ["running"],
          "worker-old",
          checkpoint,
        ),
        false,
      );
      assertEquals(
        await backend.saveCheckpointIfStatusAndWorker(
          "synthetic-child-run",
          "run-cp-owned",
          ["running"],
          "worker-new",
          checkpoint,
        ),
        true,
      );
      assertEquals((await backend.getCheckpoints("synthetic-child-run"))[0]?.id, "cp-owned");
    });

    it("reports an invalid context before saving an owner-fenced checkpoint", async () => {
      const runId = "run-cp-owned-invalid-context";
      await backend.createRun(createTestRun(runId, {
        status: "running",
        workerId: "worker-current",
      }));

      const operation = backend.saveCheckpointIfStatusAndWorker(
        runId,
        runId,
        ["running"],
        "worker-current",
        {
          id: "cp-owned-invalid",
          nodeId: "step",
          timestamp: new Date(),
          context: { input: {}, step: { total: 1n } },
          nodeStates: {},
        },
      );

      await assertRejects(
        () => operation,
        Error,
        "checkpoint.context.step.total",
      );
      assertEquals(await backend.getCheckpoints(runId), []);
    });

    it("bounds owned checkpoint history without mutating it after a failed fence", async () => {
      await backend.createRun(createTestRun("run-cp-owned-bounded", {
        status: "running",
        workerId: "worker-current",
      }));

      for (let index = 0; index <= MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES; index++) {
        assertEquals(
          await backend.saveCheckpointIfStatusAndWorker(
            "run-cp-owned-bounded",
            "run-cp-owned-bounded",
            ["running"],
            "worker-current",
            {
              id: `owned-${index}`,
              nodeId: `step-${index}`,
              timestamp: new Date(index),
              context: { input: {} },
              nodeStates: {},
            },
          ),
          true,
        );
      }

      const beforeFailedFence = await backend.getCheckpoints("run-cp-owned-bounded");
      assertEquals(beforeFailedFence.length, MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES);
      assertEquals(beforeFailedFence[0]?.id, "owned-1");

      assertEquals(
        await backend.saveCheckpointIfStatusAndWorker(
          "run-cp-owned-bounded",
          "run-cp-owned-bounded",
          ["running"],
          "worker-stale",
          {
            id: "must-not-append",
            nodeId: "step-stale",
            timestamp: new Date(),
            context: { input: {} },
            nodeStates: {},
          },
        ),
        false,
      );
      assertEquals(await backend.getCheckpoints("run-cp-owned-bounded"), beforeFailedFence);
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

    it("should condition approval appends on owner and patch notification metadata", async () => {
      await backend.createRun(createTestRun("run-ap-owned", {
        status: "waiting",
        workerId: "worker-new",
      }));
      const approval = makeApproval("ap-owned");

      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          "run-ap-owned",
          ["waiting"],
          "worker-old",
          approval,
        ),
        false,
      );
      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          "run-ap-owned",
          ["waiting"],
          "worker-new",
          approval,
        ),
        true,
      );
      await backend.updatePendingApproval("run-ap-owned", approval.id, {
        notificationError: "delivery failed",
      });
      assertEquals(
        (await backend.getPendingApproval("run-ap-owned", approval.id))?.notificationError,
        "delivery failed",
      );
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

    it("updateApproval returns true and records the decision when the approval is pending", async () => {
      await backend.createRun(createTestRun("run-ap-true"));
      await backend.savePendingApproval("run-ap-true", makeApproval("ap-true"));

      // Applied path: the pending precondition holds, so the decision lands.
      assertEquals(
        await backend.updateApproval("run-ap-true", "ap-true", {
          approved: true,
          approver: "admin",
          comment: "looks good",
        }),
        true,
      );

      // The approval left the pending set and recorded the decider verbatim.
      assertEquals(await backend.getPendingApprovals("run-ap-true"), []);
      const stored = JSON.parse(mockRedis.lists.get("test:schema-v1:approvals:run-ap-true")![0]!);
      assertEquals(stored.status, "approved");
      assertEquals(stored.decidedBy, "admin");
      assertEquals(stored.comment, "looks good");
    });

    it("updateApproval returns false (no-op) once the approval is already decided", async () => {
      await backend.createRun(createTestRun("run-ap-decided"));
      await backend.savePendingApproval("run-ap-decided", makeApproval("ap-decided"));

      // First decision wins the race and applies.
      assertEquals(
        await backend.updateApproval("run-ap-decided", "ap-decided", {
          approved: true,
          approver: "first",
        }),
        true,
      );

      // Second, concurrent decision arrives after the approval is no longer
      // pending: the precondition rejects it, so it is a no-op returning false
      // rather than overwriting the first decision (lost-race path).
      assertEquals(
        await backend.updateApproval("run-ap-decided", "ap-decided", {
          approved: false,
          approver: "second",
        }),
        false,
      );

      const stored = JSON.parse(
        mockRedis.lists.get("test:schema-v1:approvals:run-ap-decided")![0]!,
      );
      assertEquals(stored.status, "approved");
      assertEquals(stored.decidedBy, "first");
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

    it("stale token should not release or extend a lease reacquired by this backend", async () => {
      const lockKey = "test:schema-v1:lock:run-reacquired";
      const staleToken = await backend.acquireLock("run-reacquired", 5000);
      assertExists(staleToken);

      // Simulate expiry before the same backend instance acquires a new lease.
      mockRedis.store.delete(lockKey);
      const currentToken = await backend.acquireLock("run-reacquired", 5000);
      assertExists(currentToken);

      assertEquals(await backend.extendLock("run-reacquired", 5000, staleToken), false);
      await backend.releaseLock("run-reacquired", staleToken);
      assertEquals(mockRedis.store.get(lockKey), currentToken);

      assertEquals(await backend.extendLock("run-reacquired", 5000, currentToken), true);
      await backend.releaseLock("run-reacquired", currentToken);
      assertEquals(mockRedis.store.get(lockKey), undefined);
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
      const observation = await backend.openRunObservation("run-claim");
      assertExists(observation);

      assertEquals(await backend.claimStalledRun("run-claim", "worker-a", 60_000), true);
      assertEquals(await backend.claimStalledRun("run-claim", "worker-b", 60_000), false);

      const run = await backend.getRun("run-claim");
      assertEquals(run?.workerId, "worker-a");
      assertExists(run?.heartbeatAt);
      assertEquals((await observation.changes[Symbol.asyncIterator]().next()).value, {
        revision: 1,
        status: "running",
        nodes: {},
      });
      await observation.close();
    });

    it("does not claim after a concurrent heartbeat refresh", async () => {
      await backend.createRun(
        createTestRun("run-claim-refreshed", {
          status: "running",
          startedAt: new Date(Date.now() - 120_000),
        }),
      );
      const originalEval = mockRedis.eval.bind(mockRedis);
      mockRedis.eval = (script, keys, args) => {
        if (script.includes("conditional-stalled-run-claim")) {
          mockRedis.hashes.get(keys[0]!)?.set("heartbeatAt", new Date().toISOString());
        }
        return originalEval(script, keys, args);
      };

      assertEquals(
        await backend.claimStalledRun("run-claim-refreshed", "worker-a", 60_000),
        false,
      );
      const run = await backend.getRun("run-claim-refreshed");
      assertEquals(run?.workerId, undefined);
      assertEquals(mockRedis.store.has("test:schema-v1:claim:run-claim-refreshed"), false);
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
      assertEquals(
        mockRedis.expiries.get("ttl:schema-v1:run-observation:run-ttl"),
        3600,
      );
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
