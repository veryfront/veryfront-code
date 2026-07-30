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

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { RedisBackend } from "./workflow-backend.ts";
import type { RedisAdapter } from "./redis-adapter.ts";
import type {
  PendingApproval,
  WorkflowRun,
} from "veryfront/extensions/distributed/workflow-support";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { WorkflowRunManager } from "../../../src/workflow/worker/run-manager.ts";
import type {
  RunExecutionConfig,
  RunExecutionInfo,
  RunExecutor,
} from "../../../src/workflow/worker/executors/types.ts";
import { registerWorkflowBackendSnapshotContract } from "../../../src/workflow/backends/conformance.test-utils.ts";
import { compareRunIdsDescending } from "../../../src/workflow/backends/run-filter.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

class MockRedisAdapter implements RedisAdapter {
  store = new Map<string, string>();
  hashes = new Map<string, Map<string, string>>();
  lists = new Map<string, string[]>();
  sets = new Map<string, Set<string>>();
  sortedSets = new Map<string, Map<string, number>>();
  expiries = new Map<string, number>();
  streams = new Map<string, Array<{ id: string; data: Record<string, string> }>>();
  groups = new Map<string, Set<string>>();
  keysCalls = 0;
  smembersCalls = 0;
  snapshotEvalCalls = 0;
  cursorSnapshotEvalCalls = 0;
  beforeMissingRunCleanup?: () => void | Promise<void>;
  beforeRunSnapshotRead?: () => void | Promise<void>;
  beforeCursorRunSnapshotRead?: (cursorMember: string) => void | Promise<void>;
  afterConditionalRunUpdate?: () => void | Promise<void>;

  private sortedSet(key: string): Map<string, number> {
    let set = this.sortedSets.get(key);
    if (!set) {
      set = new Map();
      this.sortedSets.set(key, set);
    }
    return set;
  }

  private removeIndexedRun(
    runId: string,
    keys: string[],
    args: string[],
  ): void {
    const workflowId = this.hashes.get(keys[1]!)?.get(runId);
    const status = this.hashes.get(keys[2]!)?.get(runId);
    for (const prefix of args.slice(0, 5)) {
      const ownedKey = prefix + runId;
      this.store.delete(ownedKey);
      this.hashes.delete(ownedKey);
      this.lists.delete(ownedKey);
      this.sets.delete(ownedKey);
      this.sortedSets.delete(ownedKey);
      this.expiries.delete(ownedKey);
    }
    this.sortedSets.get(keys[3]!)?.delete(runId);
    if (workflowId) this.sortedSets.get(args[5]! + workflowId)?.delete(runId);
    if (status) this.sortedSets.get(args[6]! + status)?.delete(runId);
    if (workflowId && status) {
      this.sortedSets.get(args[7]! + workflowId + ":" + status)?.delete(runId);
    }
    this.hashes.get(keys[1]!)?.delete(runId);
    this.hashes.get(keys[2]!)?.delete(runId);
    this.sortedSets.get(keys[0]!)?.delete(runId);
  }

  private cleanupRetention(keys: string[], args: string[]): [number, boolean] {
    const limit = Number(args[8]);
    const nowMs = Date.now();
    const retention = this.sortedSets.get(keys[0]!);
    const due = [...(retention?.entries() ?? [])]
      .filter(([, expiresAt]) => expiresAt <= nowMs)
      .sort((left, right) => left[1] - right[1] || -compareRunIdsDescending(left[0], right[0]))
      .slice(0, limit);
    for (const [runId] of due) {
      const runKey = args[0]! + runId;
      if (this.hashes.has(runKey) && !this.expiries.has(runKey)) {
        retention?.delete(runId);
      } else if (this.hashes.has(runKey)) {
        retention?.set(runId, nowMs + 1_000);
      } else {
        this.removeIndexedRun(runId, keys, args);
      }
    }
    const hasMore = [...(retention?.values() ?? [])].some((expiresAt) => expiresAt <= nowMs);
    return [due.length, hasMore];
  }

  private orderedIndexRows(key: string, min: string, max: string): Array<[string, number]> {
    const minimum = min === "-inf" ? Number.NEGATIVE_INFINITY : Number(min);
    const maximum = max === "+inf" ? Number.POSITIVE_INFINITY : Number(max);
    return [...(this.sortedSets.get(key)?.entries() ?? [])]
      .filter(([, score]) => score >= minimum && score <= maximum)
      .sort((left, right) => right[1] - left[1] || compareRunIdsDescending(left[0], right[0]));
  }

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
    this.smembersCalls++;
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
  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    const key = keys[0]!;

    if (script.includes("read-workflow-run-snapshot")) {
      this.snapshotEvalCalls++;
      const hook = this.beforeRunSnapshotRead;
      this.beforeRunSnapshotRead = undefined;
      await hook?.();
      const hash = this.hashes.get(key);
      return [
        hash ? [...hash.entries()].flat() : [],
        [...(this.lists.get(keys[1]!) ?? [])],
      ];
    }

    if (script.includes("create-workflow-run-if-absent")) {
      if (this.hashes.has(key)) return 0;

      const runId = args[0]!;
      const workflowId = args[1]!;
      const status = args[2]!;
      const ttl = Number(args[3]);
      const createdAtMs = Number(args[4]);
      const workflowPrefix = args[5]!;
      const statusPrefix = args[6]!;
      const workflowStatusPrefix = args[7]!;
      const workflowMetadata = this.hashes.get(keys[5]!);
      const statusMetadata = this.hashes.get(keys[6]!);
      const oldWorkflowId = workflowMetadata?.get(runId);
      const oldStatus = statusMetadata?.get(runId);
      this.sortedSets.get(keys[1]!)?.delete(runId);
      if (oldWorkflowId) this.sortedSets.get(workflowPrefix + oldWorkflowId)?.delete(runId);
      if (oldStatus) this.sortedSets.get(statusPrefix + oldStatus)?.delete(runId);
      if (oldWorkflowId && oldStatus) {
        this.sortedSets.get(workflowStatusPrefix + oldWorkflowId + ":" + oldStatus)?.delete(runId);
      }
      workflowMetadata?.delete(runId);
      statusMetadata?.delete(runId);
      this.sortedSets.get(keys[7]!)?.delete(runId);
      for (const staleKey of keys.slice(8)) {
        this.store.delete(staleKey);
        this.hashes.delete(staleKey);
        this.lists.delete(staleKey);
        this.sets.delete(staleKey);
        this.sortedSets.delete(staleKey);
        this.expiries.delete(staleKey);
      }

      const fieldCount = Number(args[8]);
      const hash = new Map<string, string>();
      for (let i = 0; i < fieldCount; i++) {
        const offset = 9 + (i * 2);
        hash.set(args[offset]!, args[offset + 1]!);
      }
      this.hashes.set(key, hash);
      for (const indexKey of keys.slice(1, 5)) {
        this.sortedSet(indexKey).set(runId, createdAtMs);
      }
      let nextWorkflowMetadata = this.hashes.get(keys[5]!);
      if (!nextWorkflowMetadata) {
        nextWorkflowMetadata = new Map();
        this.hashes.set(keys[5]!, nextWorkflowMetadata);
      }
      nextWorkflowMetadata.set(runId, workflowId);
      let nextStatusMetadata = this.hashes.get(keys[6]!);
      if (!nextStatusMetadata) {
        nextStatusMetadata = new Map();
        this.hashes.set(keys[6]!, nextStatusMetadata);
      }
      nextStatusMetadata.set(runId, status);
      if (ttl > 0) {
        this.expiries.set(key, ttl);
        this.sortedSet(keys[7]!).set(runId, Date.now() + (ttl * 1000));
      }
      return 1;
    }

    if (script.includes("cleanup-missing-workflow-run")) {
      const hook = this.beforeMissingRunCleanup;
      this.beforeMissingRunCleanup = undefined;
      await hook?.();
      if (this.hashes.has(key)) return 0;

      const runId = args[0]!;
      const workflowPrefix = args[1]!;
      const statusPrefix = args[2]!;
      const workflowStatusPrefix = args[3]!;
      const workflowMetadata = this.hashes.get(keys[6]!);
      const statusMetadata = this.hashes.get(keys[7]!);
      const workflowId = workflowMetadata?.get(runId);
      const status = statusMetadata?.get(runId);
      for (const ownedKey of keys.slice(1, 5)) {
        this.store.delete(ownedKey);
        this.hashes.delete(ownedKey);
        this.lists.delete(ownedKey);
        this.sets.delete(ownedKey);
        this.sortedSets.delete(ownedKey);
        this.expiries.delete(ownedKey);
      }
      this.sortedSets.get(keys[5]!)?.delete(runId);
      if (workflowId) this.sortedSets.get(workflowPrefix + workflowId)?.delete(runId);
      if (status) this.sortedSets.get(statusPrefix + status)?.delete(runId);
      if (workflowId && status) {
        this.sortedSets.get(workflowStatusPrefix + workflowId + ":" + status)?.delete(runId);
      }
      workflowMetadata?.delete(runId);
      statusMetadata?.delete(runId);
      this.sortedSets.get(keys[8]!)?.delete(runId);
      return 1;
    }

    if (script.includes("delete-workflow-run")) {
      const runId = args[0]!;
      const workflowPrefix = args[1]!;
      const statusPrefix = args[2]!;
      const workflowStatusPrefix = args[3]!;
      const workflowMetadata = this.hashes.get(keys[6]!);
      const statusMetadata = this.hashes.get(keys[7]!);
      const workflowId = this.hashes.get(key)?.get("workflowId") ??
        workflowMetadata?.get(runId);
      const status = this.hashes.get(key)?.get("status") ?? statusMetadata?.get(runId);
      for (const ownedKey of keys.slice(0, 5)) {
        this.store.delete(ownedKey);
        this.hashes.delete(ownedKey);
        this.lists.delete(ownedKey);
        this.sets.delete(ownedKey);
        this.sortedSets.delete(ownedKey);
        this.expiries.delete(ownedKey);
      }
      this.sortedSets.get(keys[5]!)?.delete(runId);
      if (workflowId) this.sortedSets.get(workflowPrefix + workflowId)?.delete(runId);
      if (status) this.sortedSets.get(statusPrefix + status)?.delete(runId);
      if (workflowId && status) {
        this.sortedSets.get(workflowStatusPrefix + workflowId + ":" + status)?.delete(runId);
      }
      workflowMetadata?.delete(runId);
      statusMetadata?.delete(runId);
      this.sortedSets.get(keys[8]!)?.delete(runId);
      return 1;
    }

    if (script.includes("cleanup-expired-workflow-runs")) {
      const [processed, hasMore] = this.cleanupRetention(keys, args);
      return [processed, hasMore ? 1 : 0];
    }

    if (script.includes("cursor-page-workflow-runs-exact")) {
      this.cursorSnapshotEvalCalls++;
      const cursorScore = args[9]!;
      const cursorMember = args[10]!;
      const snapshotHook = this.beforeRunSnapshotRead;
      this.beforeRunSnapshotRead = undefined;
      await snapshotHook?.();
      await this.beforeCursorRunSnapshotRead?.(cursorMember);
      const [processed, hasMore] = this.cleanupRetention(keys, args);
      if (hasMore) return [0, processed, "retention-backlog"];

      const rows = this.orderedIndexRows(keys[4]!, "-inf", "+inf");
      let start = 0;
      let reset = 0;
      if (cursorMember !== "") {
        const cursorIndex = rows.findIndex(([member, score]) =>
          member === cursorMember && score === Number(cursorScore)
        );
        if (cursorIndex === -1) {
          reset = 1;
        } else {
          start = cursorIndex + 1;
        }
      }
      const page = rows.slice(start, start + Number(args[11]));
      const snapshots: unknown[] = [];
      for (const [runId] of page) {
        const hash = this.hashes.get(args[0]! + runId);
        if (!hash) {
          this.removeIndexedRun(runId, keys, args);
          return [0, processed, "index-ghost"];
        }
        snapshots.push([
          [...hash.entries()].flat(),
          [...(this.lists.get(args[2]! + runId) ?? [])],
        ]);
      }
      const next = page.at(-1);
      return [1, processed, snapshots, next ? String(next[1]) : "", next?.[0] ?? "", reset];
    }

    if (script.includes("list-workflow-runs-exact")) {
      const hook = this.beforeRunSnapshotRead;
      this.beforeRunSnapshotRead = undefined;
      await hook?.();
      const [processed, hasMore] = this.cleanupRetention(keys, args);
      if (hasMore) return [0, processed, "retention-backlog"];
      const maxScore = args[9]!;
      const minScore = args[10]!;
      const offset = Number(args[11]);
      const limit = Number(args[12]);
      const selectedCount = Number(args[13]);
      const byId = new Map<string, number>();
      for (const indexKey of keys.slice(4, 4 + selectedCount)) {
        for (const [runId, score] of this.orderedIndexRows(indexKey, minScore, maxScore)) {
          byId.set(runId, score);
        }
      }
      const ordered = [...byId.entries()].sort((left, right) =>
        right[1] - left[1] || compareRunIdsDescending(left[0], right[0])
      ).slice(offset, offset + limit);
      const snapshots: unknown[] = [];
      for (const [runId] of ordered) {
        const hash = this.hashes.get(args[0]! + runId);
        if (!hash) {
          this.removeIndexedRun(runId, keys, args);
          return [0, processed, "index-ghost"];
        }
        snapshots.push([
          [...hash.entries()].flat(),
          [...(this.lists.get(args[2]! + runId) ?? [])],
        ]);
      }
      return [1, processed, snapshots];
    }

    if (script.includes("count-workflow-runs-exact")) {
      const [processed, hasMore] = this.cleanupRetention(keys, args);
      if (hasMore) return [0, processed, "retention-backlog"];
      const maxScore = args[9]!;
      const minScore = args[10]!;
      const selectedCount = Number(args[11]);
      let count = 0;
      for (const indexKey of keys.slice(4, 4 + selectedCount)) {
        count += this.orderedIndexRows(indexKey, minScore, maxScore).length;
      }
      return [1, processed, count];
    }

    if (script.includes("append-retained-workflow-run-state")) {
      if (!this.hashes.has(key)) return 0;
      const storageKey = keys[1]!;
      let list = this.lists.get(storageKey);
      if (!list) {
        list = [];
        this.lists.set(storageKey, list);
      }
      list.push(args[0]!);
      const remaining = this.expiries.get(key);
      if (remaining !== undefined) this.expiries.set(storageKey, remaining);
      return 1;
    }

    if (script.includes("conditional-stalled-run-claim")) {
      const claimKey = keys[1]!;
      const observedActivity = args[0]!;
      const workerId = args[1]!;
      const claimDuration = Number(args[2]);
      const now = args[3]!;
      const hash = this.hashes.get(key);
      if (!hash || hash.get("status") !== "running") return Promise.resolve(0);
      const activity = hash.get("heartbeatAt") || hash.get("startedAt") || hash.get("createdAt");
      if (activity !== observedActivity || this.store.has(claimKey)) return Promise.resolve(0);

      this.store.set(claimKey, workerId);
      this.expiries.set(claimKey, claimDuration);
      hash.set("workerId", workerId);
      hash.set("heartbeatAt", now);
      if (!hash.get("startedAt")) hash.set("startedAt", now);
      return Promise.resolve(1);
    }

    if (script.includes("conditional-owned-append")) {
      const expectedCount = Number(args[0]);
      const expectedStatuses = args.slice(1, expectedCount + 1);
      const expectedWorkerId = args[expectedCount + 1]!;
      const storageKey = keys[1]!;
      const value = args[expectedCount + 2]!;
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
      const remaining = this.expiries.get(key);
      if (remaining !== undefined) this.expiries.set(storageKey, remaining);
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
      const workflowStatusPrefix = args[expectedCount + 3]!;
      const runId = args[expectedCount + 4]!;
      const expectedWorkerId = args[expectedCount + 5]!;
      const hash = this.hashes.get(key);
      const oldStatus = hash?.get("status");
      if (!hash || !oldStatus || !expectedStatuses.includes(oldStatus)) {
        return Promise.resolve(0);
      }
      if (expectedWorkerId && hash.get("workerId") !== expectedWorkerId) {
        return Promise.resolve(0);
      }

      if (nextStatus && oldStatus !== nextStatus) {
        const workflowId = hash.get("workflowId");
        const createdAtMs = Number(hash.get("createdAtMs"));
        if (!workflowId || !Number.isFinite(createdAtMs)) return Promise.resolve(-1);
        hash.set("status", nextStatus);
        this.sortedSets.get(statusPrefix + oldStatus)?.delete(runId);
        this.sortedSets.get(workflowStatusPrefix + workflowId + ":" + oldStatus)?.delete(runId);
        this.sortedSet(statusPrefix + nextStatus).set(runId, createdAtMs);
        this.sortedSet(workflowStatusPrefix + workflowId + ":" + nextStatus).set(
          runId,
          createdAtMs,
        );
        let statusMetadata = this.hashes.get(keys[2]!);
        if (!statusMetadata) {
          statusMetadata = new Map();
          this.hashes.set(keys[2]!, statusMetadata);
        }
        statusMetadata.set(runId, nextStatus);
      }

      for (let i = expectedCount + 6; i < args.length; i += 2) {
        hash.set(args[i]!, args[i + 1]!);
      }
      if (nextStatus && nextStatus !== "running") {
        this.store.delete(keys[1]!);
        this.expiries.delete(keys[1]!);
      }
      const hook = this.afterConditionalRunUpdate;
      this.afterConditionalRunUpdate = undefined;
      await hook?.();
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

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (key.includes(":approvals:")) {
      const hook = this.beforeRunSnapshotRead;
      this.beforeRunSnapshotRead = undefined;
      await hook?.();
    }
    const list = this.lists.get(key);
    if (!list) return [];

    const end = stop < 0 ? list.length + stop + 1 : stop + 1;
    return list.slice(start, end);
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
    this.keysCalls++;
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

  registerWorkflowBackendSnapshotContract("Redis", () => backend);

  describe("constructor defaults", () => {
    it("should set default config values", () => {
      const b = new RedisBackend({ client: mockRedis as unknown as RedisAdapter });
      assertExists(b);
    });

    it("rejects run TTL values that Redis cannot publish atomically", () => {
      for (
        const runTtl of [
          -1,
          0.5,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.MAX_SAFE_INTEGER,
        ]
      ) {
        assertThrows(
          () =>
            new RedisBackend({
              client: mockRedis as unknown as RedisAdapter,
              runTtl,
            }),
          Error,
          "runTtl must be a non-negative safe integer",
        );
      }
    });
  });

  describe("initialize", () => {
    it("should create consumer group", async () => {
      await backend.initialize();
      assertEquals(
        mockRedis.groups.get("test:stream:schema-v2"),
        new Set(["test:group:schema-v2"]),
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
        mockRedis.hashes.has("test:schema-v2:run:run-versioned-namespace"),
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

    it("never combines a deleted run incarnation with recreated approvals", async () => {
      const runId = "run-incarnation-snapshot";
      await backend.createRun(createTestRun(runId, { workflowId: "old-workflow" }));
      await backend.savePendingApproval(runId, {
        id: "old-approval",
        nodeId: "wait",
        status: "pending",
        message: "old",
        payload: {},
        requestedAt: new Date("2025-01-01T00:00:00.000Z"),
      });

      mockRedis.beforeRunSnapshotRead = async () => {
        await backend.deleteRun(runId);
        await backend.createRun(createTestRun(runId, { workflowId: "new-workflow" }));
        await backend.savePendingApproval(runId, {
          id: "new-approval",
          nodeId: "wait",
          status: "pending",
          message: "new",
          payload: {},
          requestedAt: new Date("2025-01-02T00:00:00.000Z"),
        });
      };

      const snapshot = await backend.getRun(runId);

      assertEquals(snapshot?.workflowId, "new-workflow");
      assertEquals(
        snapshot?.pendingApprovals.map((approval) => approval.id),
        ["new-approval"],
      );
    });

    it("rejects repeated creates without overwriting the original run or indexes", async () => {
      const original = createTestRun("run-duplicate", {
        workflowId: "workflow-original",
        status: "pending",
        input: { owner: "original" },
      });
      const replacement = createTestRun("run-duplicate", {
        workflowId: "workflow-replacement",
        status: "running",
        input: { owner: "replacement" },
      });

      await backend.createRun(original);
      const conflicts = await Promise.allSettled([
        backend.createRun(replacement),
        backend.createRun(replacement),
      ]);

      assertEquals(conflicts.map((result) => result.status), ["rejected", "rejected"]);
      for (const conflict of conflicts) {
        if (conflict.status !== "rejected") throw new Error("Expected create conflict");
        assertEquals(conflict.reason instanceof Error, true);
        assertEquals(conflict.reason.message, "Workflow run already exists: run-duplicate");
        assertEquals(conflict.reason.status, 409);
        assertEquals(conflict.reason.slug, "workflow-run-conflict");
      }

      const stored = await backend.getRun(original.id);
      assertEquals(stored?.workflowId, "workflow-original");
      assertEquals(stored?.status, "pending");
      assertEquals(stored?.input, { owner: "original" });
      assertEquals(
        (await backend.listRuns({ workflowId: "workflow-original", status: "pending" })).map(
          (run) => run.id,
        ),
        [original.id],
      );
      assertEquals(await backend.listRuns({ workflowId: "workflow-replacement" }), []);
      assertEquals(await backend.listRuns({ status: "running" }), []);
      assertEquals(await backend.countRuns({}), 1);
    });

    it("allows exactly one concurrent create to publish a run and its indexes", async () => {
      const first = createTestRun("run-concurrent-create", {
        workflowId: "workflow-first",
        status: "pending",
        input: { owner: "first" },
      });
      const second = createTestRun("run-concurrent-create", {
        workflowId: "workflow-second",
        status: "running",
        input: { owner: "second" },
      });

      const results = await Promise.allSettled([
        backend.createRun(first),
        backend.createRun(second),
      ]);

      assertEquals(results.filter((result) => result.status === "fulfilled").length, 1);
      assertEquals(results.filter((result) => result.status === "rejected").length, 1);
      const stored = await backend.getRun(first.id);
      assertExists(stored);
      assertEquals((await backend.listRuns({})).map((run) => run.id), [first.id]);
      assertEquals(await backend.countRuns({}), 1);
      assertEquals(
        await backend.countRuns({ workflowId: stored.workflowId, status: stored.status }),
        1,
      );
      const losingWorkflow = stored.workflowId === first.workflowId
        ? second.workflowId
        : first.workflowId;
      const losingStatus = stored.status === first.status ? second.status : first.status;
      assertEquals(await backend.countRuns({ workflowId: losingWorkflow }), 0);
      assertEquals(await backend.countRuns({ status: losingStatus }), 0);
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
        mockRedis.sortedSets.get("test:schema-v2:index:created:status:pending")?.has(runId),
        false,
      );
      assertEquals(
        mockRedis.sortedSets.get("test:schema-v2:index:created:status:running")?.has(runId),
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

    it("does not delete a stalled claim created by a replacement run incarnation", async () => {
      const runId = "run-recreated-claim";
      const claimKey = `test:schema-v2:claim:${runId}`;
      await backend.createRun(createTestRun(runId, {
        status: "running",
        workerId: "old-worker",
      }));
      mockRedis.store.set(claimKey, "old-worker");

      mockRedis.afterConditionalRunUpdate = async () => {
        await backend.deleteRun(runId);
        await backend.createRun(createTestRun(runId, {
          status: "running",
          workerId: "new-worker",
        }));
        mockRedis.store.set(claimKey, "new-worker");
      };

      assertEquals(
        await backend.updateRunIfStatusAndWorker(
          runId,
          ["running"],
          "old-worker",
          { status: "completed" },
        ),
        true,
      );
      assertEquals(mockRedis.store.get(claimKey), "new-worker");
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

    it("rejects checkpoints for a missing run", async () => {
      await assertRejects(
        () =>
          backend.saveCheckpoint("missing-run", {
            id: "cp-missing",
            nodeId: "step-missing",
            timestamp: new Date(),
            context: { input: {} },
            nodeStates: {},
          }),
        Error,
        "Run not found: missing-run",
      );
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

    it("rejects approvals for a missing run", async () => {
      await assertRejects(
        () => backend.savePendingApproval("missing-run", makeApproval("ap-missing")),
        Error,
        "Run not found: missing-run",
      );
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
      const stored = JSON.parse(mockRedis.lists.get("test:schema-v2:approvals:run-ap-true")![0]!);
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
        mockRedis.lists.get("test:schema-v2:approvals:run-ap-decided")![0]!,
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
      assertEquals(mockRedis.streams.has("test:stream:schema-v2"), true);
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
      const lockKey = "test:schema-v2:lock:run-own";

      // Simulate lock expiry + worker B acquiring it: overwrite the stored
      // value with worker B's token.
      mockRedis.store.set(lockKey, "worker-B-token");

      // Worker A tries to release -- it must NOT delete worker B's lock.
      await backend.releaseLock("run-own");

      assertEquals(mockRedis.store.get(lockKey), "worker-B-token");
    });

    it("stale token should not release or extend a lease reacquired by this backend", async () => {
      const lockKey = "test:schema-v2:lock:run-reacquired";
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
      const lockKey = "test:schema-v2:lock:run-own2";

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
      const key = "test:schema-v2:lock:cad";

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
      assertEquals(mockRedis.store.has("test:schema-v2:claim:run-claim-refreshed"), false);
    });

    it("uses stable bounded cursor pages when earlier running rows are deleted", async () => {
      for (let index = 0; index < 1_001; index++) {
        await backend.createRun(createTestRun(`run-stalled-page-${index}`, {
          status: "running",
          startedAt: new Date(Date.now() - 120_000),
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
        }));
      }
      mockRedis.beforeCursorRunSnapshotRead = async () => {
        if (mockRedis.cursorSnapshotEvalCalls === 2) {
          await backend.deleteRun("run-stalled-page-1000");
        }
      };

      const stalled = await backend.findStalledRuns(60_000);

      // Pages are individually atomic, not one global snapshot: the deleted
      // row was valid in page one, while the unchanged final row must not be
      // skipped after ranks ahead of the cursor shift.
      assertEquals(stalled.length, 1_001);
      assertEquals(new Set(stalled.map((run) => run.id)).size, 1_001);
      assertEquals(stalled.some((run) => run.id === "run-stalled-page-0"), true);
      assertEquals(mockRedis.cursorSnapshotEvalCalls, 2);
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
      mockRedis.hashes.set("test:schema-v2:run:bad1", new Map([["workflowId", "wf"]]));
      await assertRejects(() => backend.getRun("bad1"), Error, "missing 'id'");
    });

    it("should throw on missing workflowId field", async () => {
      mockRedis.hashes.set("test:schema-v2:run:bad2", new Map([["id", "bad2"]]));
      await assertRejects(() => backend.getRun("bad2"), Error, "missing 'workflowId'");
    });

    it("should throw on a missing source integration policy snapshot", async () => {
      mockRedis.hashes.set(
        "test:schema-v2:run:missing-source-policy",
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
        "test:schema-v2:run:corrupt-source-policy",
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
        "test:schema-v2:run:bad3",
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
        "test:schema-v2:run:bad4",
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
      assertEquals(ackCalls[0]!.key, "test:stream:schema-v2");
      assertEquals(ackCalls[0]!.group, "test:group:schema-v2");
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

      assertEquals(mockRedis.expiries.has("ttl:schema-v2:run:run-ttl"), true);
    });

    it("applies the run retention horizon to checkpoints, approvals, and cleanup metadata", async () => {
      const ttlBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "ttl:",
        runTtl: 3600,
      });
      const run = createTestRun("run-retained", { workflowId: "workflow-retained" });

      await ttlBackend.createRun(run);
      await ttlBackend.saveCheckpoint(run.id, {
        id: "checkpoint-retained",
        nodeId: "step-retained",
        timestamp: new Date("2025-01-01T01:00:00Z"),
        context: { input: {} },
        nodeStates: {},
      });
      await ttlBackend.savePendingApproval(run.id, {
        id: "approval-retained",
        nodeId: "step-retained",
        status: "pending",
        message: "Review",
        requestedAt: new Date("2025-01-01T01:00:00Z"),
      });

      assertEquals(mockRedis.expiries.has("ttl:schema-v2:run:run-retained"), true);
      assertEquals(mockRedis.expiries.has("ttl:schema-v2:checkpoints:run-retained"), true);
      assertEquals(mockRedis.expiries.has("ttl:schema-v2:approvals:run-retained"), true);
      assertEquals(
        mockRedis.hashes.get("ttl:schema-v2:index:run-workflow")?.get(run.id),
        run.workflowId,
      );
      assertEquals(
        mockRedis.hashes.get("ttl:schema-v2:index:run-status")?.get(run.id),
        run.status,
      );
      assertEquals(
        mockRedis.sortedSets.get("ttl:schema-v2:index:retention")?.has(run.id),
        true,
      );
    });

    it("does not list, count, or retain index ghosts after the run hash expires", async () => {
      const ttlBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "ttl:",
        runTtl: 3600,
      });
      const run = createTestRun("run-expired-index", {
        workflowId: "workflow-expired-index",
        status: "running",
      });
      await ttlBackend.createRun(run);

      mockRedis.hashes.delete("ttl:schema-v2:run:run-expired-index");
      mockRedis.expiries.delete("ttl:schema-v2:run:run-expired-index");
      mockRedis.sortedSets.get("ttl:schema-v2:index:retention")?.set(run.id, 0);

      assertEquals(await ttlBackend.countRuns({}), 0);
      assertEquals(await ttlBackend.countRuns({ workflowId: run.workflowId }), 0);
      assertEquals(await ttlBackend.countRuns({ status: run.status }), 0);
      assertEquals(await ttlBackend.listRuns({}), []);
      assertEquals(
        mockRedis.sortedSets.get("ttl:schema-v2:index:created")?.has(run.id) ?? false,
        false,
      );
      assertEquals(
        mockRedis.sortedSets.get(`ttl:schema-v2:index:created:workflow:${run.workflowId}`)?.has(
          run.id,
        ) ?? false,
        false,
      );
      assertEquals(
        mockRedis.sortedSets.get(`ttl:schema-v2:index:created:status:${run.status}`)?.has(run.id) ??
          false,
        false,
      );
    });

    it("cleans expired run-owned keys from get and delete even when the hash is gone", async () => {
      const ttlBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "ttl:",
        runTtl: 3600,
      });
      const run = createTestRun("run-expired-owned", { workflowId: "workflow-expired-owned" });
      await ttlBackend.createRun(run);
      await ttlBackend.saveCheckpoint(run.id, {
        id: "checkpoint-expired",
        nodeId: "step-expired",
        timestamp: new Date("2025-01-01T01:00:00Z"),
        context: { input: {} },
        nodeStates: {},
      });
      await ttlBackend.savePendingApproval(run.id, {
        id: "approval-expired",
        nodeId: "step-expired",
        status: "pending",
        message: "Review",
        requestedAt: new Date("2025-01-01T01:00:00Z"),
      });
      mockRedis.hashes.delete("ttl:schema-v2:run:run-expired-owned");

      assertEquals(await ttlBackend.getRun(run.id), null);
      await ttlBackend.deleteRun(run.id);

      assertEquals(mockRedis.lists.has("ttl:schema-v2:checkpoints:run-expired-owned"), false);
      assertEquals(mockRedis.lists.has("ttl:schema-v2:approvals:run-expired-owned"), false);
      assertEquals(
        mockRedis.hashes.get("ttl:schema-v2:index:run-workflow")?.has(run.id) ?? false,
        false,
      );
      assertEquals(
        mockRedis.hashes.get("ttl:schema-v2:index:run-status")?.has(run.id) ?? false,
        false,
      );
      assertEquals(
        mockRedis.sortedSets.get("ttl:schema-v2:index:retention")?.has(run.id) ?? false,
        false,
      );
    });

    it("rejects an update after expiry instead of resurrecting a partial run", async () => {
      const ttlBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "ttl:",
        runTtl: 3600,
      });
      const run = createTestRun("run-expired-update");
      await ttlBackend.createRun(run);
      mockRedis.hashes.delete("ttl:schema-v2:run:run-expired-update");

      await assertRejects(
        () => ttlBackend.updateRun(run.id, { status: "completed", output: "stale" }),
        Error,
        `Run not found: ${run.id}`,
      );
      assertEquals(mockRedis.hashes.has("ttl:schema-v2:run:run-expired-update"), false);
      assertEquals(await ttlBackend.countRuns({}), 0);
    });

    it("does not let stale missing-run cleanup delete a concurrently recreated run", async () => {
      const ttlBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "ttl:",
        runTtl: 3600,
      });
      const original = createTestRun("run-cleanup-race", {
        workflowId: "workflow-old",
        status: "pending",
      });
      const replacement = createTestRun("run-cleanup-race", {
        workflowId: "workflow-new",
        status: "running",
        input: { owner: "replacement" },
      });
      await ttlBackend.createRun(original);
      mockRedis.hashes.delete("ttl:schema-v2:run:run-cleanup-race");
      mockRedis.beforeMissingRunCleanup = () => ttlBackend.createRun(replacement);

      assertEquals(await ttlBackend.getRun(original.id), null);

      const stored = await ttlBackend.getRun(original.id);
      assertEquals(stored?.workflowId, replacement.workflowId);
      assertEquals(stored?.status, replacement.status);
      assertEquals(stored?.input, replacement.input);
      assertEquals(await ttlBackend.countRuns({ workflowId: original.workflowId }), 0);
      assertEquals(await ttlBackend.countRuns({ workflowId: replacement.workflowId }), 1);
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

    it("never attributes recreated approvals to the deleted incarnation's workflow", async () => {
      const runId = "approval-list-incarnation";
      await backend.createRun(createTestRun(runId, { workflowId: "old-workflow" }));
      await backend.savePendingApproval(runId, {
        id: "old-approval",
        nodeId: "wait",
        status: "pending",
        message: "old",
        payload: {},
        requestedAt: new Date("2025-01-01T00:00:00.000Z"),
      });
      mockRedis.beforeRunSnapshotRead = async () => {
        await backend.deleteRun(runId);
        await backend.createRun(createTestRun(runId, { workflowId: "new-workflow" }));
        await backend.savePendingApproval(runId, {
          id: "new-approval",
          nodeId: "wait",
          status: "pending",
          message: "new",
          payload: {},
          requestedAt: new Date("2025-01-02T00:00:00.000Z"),
        });
      };

      assertEquals(
        await backend.listPendingApprovals({ workflowId: "old-workflow" }),
        [],
      );
    });

    it("enumerates the run index without issuing a keyspace-wide KEYS command", async () => {
      await backend.createRun(createTestRun("run-lpa-indexed"));
      await backend.savePendingApproval("run-lpa-indexed", {
        id: "approval-indexed",
        nodeId: "node-indexed",
        status: "pending",
        message: "Review",
        requestedAt: new Date("2025-01-01T01:00:00Z"),
      });
      mockRedis.keys = () => {
        throw new Error("KEYS must not be used for workflow run discovery");
      };

      const results = await backend.listPendingApprovals({ status: "pending" });

      assertEquals(results.map(({ runId }) => runId), ["run-lpa-indexed"]);
      assertEquals(mockRedis.keysCalls, 0);
    });
  });

  describe("run indexes", () => {
    it("publishes each run to the schema-v2 ordered index family", async () => {
      const run = createTestRun("ordered-index-run", {
        workflowId: "ordered-workflow",
        status: "waiting",
        createdAt: new Date("2026-04-05T06:07:08.009Z"),
      });

      await backend.createRun(run);

      const score = run.createdAt.getTime();
      assertEquals(
        mockRedis.sortedSets.get("test:schema-v2:index:created")?.get(run.id),
        score,
      );
      assertEquals(
        mockRedis.sortedSets.get("test:schema-v2:index:created:workflow:ordered-workflow")?.get(
          run.id,
        ),
        score,
      );
      assertEquals(
        mockRedis.sortedSets.get("test:schema-v2:index:created:status:waiting")?.get(run.id),
        score,
      );
      assertEquals(
        mockRedis.sortedSets.get(
          "test:schema-v2:index:created:workflow-status:ordered-workflow:waiting",
        )?.get(run.id),
        score,
      );
      assertEquals(mockRedis.hashes.has("test:schema-v1:run:ordered-index-run"), false);
    });

    it("bounds list hydration and counts without SMEMBERS or run snapshots", async () => {
      for (let index = 0; index < 20; index++) {
        await backend.createRun(createTestRun(`bounded-query-${index}`, {
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
        }));
      }
      mockRedis.smembersCalls = 0;
      mockRedis.snapshotEvalCalls = 0;

      assertEquals((await backend.listRuns({ limit: 3 })).length, 3);
      assertEquals(mockRedis.smembersCalls, 0);
      assertEquals(mockRedis.snapshotEvalCalls, 0);

      mockRedis.smembersCalls = 0;
      mockRedis.snapshotEvalCalls = 0;
      assertEquals(await backend.countRuns({ status: "pending" }), 20);
      assertEquals(mockRedis.smembersCalls, 0);
      assertEquals(mockRedis.snapshotEvalCalls, 0);
    });

    it("fails closed while bounded retention cleanup has more due work", async () => {
      const ttlRedis = new MockRedisAdapter();
      const ttlBackend = new RedisBackend({
        client: ttlRedis,
        prefix: "maintenance:",
        runTtl: 1,
      });
      const runIds: string[] = [];
      for (let index = 0; index < 257; index++) {
        const runId = `expired-backlog-${String(index).padStart(3, "0")}`;
        runIds.push(runId);
        await ttlBackend.createRun(createTestRun(runId));
      }
      const retentionEntry = [...ttlRedis.sortedSets.entries()].find(([key]) =>
        key.endsWith(":index:retention")
      );
      assertExists(retentionEntry);
      const [retentionKey, retention] = retentionEntry;
      const runKey = [...ttlRedis.hashes.keys()].find((key) => key.endsWith(`:run:${runIds[0]}`));
      assertExists(runKey);
      const runPrefix = runKey.slice(0, -runIds[0]!.length);
      for (const runId of runIds) {
        ttlRedis.hashes.delete(runPrefix + runId);
        ttlRedis.expiries.delete(runPrefix + runId);
        retention.set(runId, 0);
      }

      const maintenanceError = await assertRejects(
        () => ttlBackend.countRuns({}),
        Error,
        "retention maintenance backlog",
      );
      assertEquals((maintenanceError as { status?: number }).status, 503);
      assertEquals(ttlRedis.sortedSets.get(retentionKey)?.size, 129);

      const listMaintenanceError = await assertRejects(
        () => ttlBackend.listRuns({}),
        Error,
        "retention maintenance backlog",
      );
      assertEquals((listMaintenanceError as { status?: number }).status, 503);
      assertEquals(ttlRedis.sortedSets.get(retentionKey)?.size, 1);

      assertEquals(await ttlBackend.drainExpiredRuns(), {
        processed: 1,
        hasMoreDue: false,
      });
      assertEquals(await ttlBackend.countRuns({}), 0);
      assertEquals(await ttlBackend.listRuns({}), []);
    });

    it("does not discover or backfill rows missing from the versioned index", async () => {
      await backend.createRun(createTestRun("orphaned-run"));
      mockRedis.sortedSets.delete("test:schema-v2:index:created");

      const runs = await backend.listRuns({});

      assertEquals(runs, []);
      assertEquals(mockRedis.sortedSets.has("test:schema-v2:index:created"), false);
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
