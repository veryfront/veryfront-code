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
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import { RedisBackend } from "./index.ts";
import { deriveWorkflowRunEventObservation } from "../../events.ts";
import {
  MAX_TRAVERSAL_DEPTH,
  serializeWorkflowJson,
} from "#veryfront/workflow/context-serialization.ts";
import type { RedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";
import type { CheckpointResumeEnvelope, PendingApproval, WorkflowRun } from "../../types.ts";
import {
  MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES,
  MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES,
} from "../../limits.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { WorkflowRunManager } from "../../worker/run-manager.ts";
import type { PersistedPendingApproval, TerminalRunRetentionCandidate } from "../types.ts";
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
  sortedSets = new Map<string, Map<string, number>>();
  expiries = new Map<string, number>();
  streams = new Map<string, Array<{ id: string; data: Record<string, string> }>>();
  lastScript = "";
  lastKeys: string[] = [];
  lastArgs: string[] = [];
  scriptCalls: Array<{ script: string; keys: string[]; args: string[] }> = [];
  groups = new Map<string, Set<string>>();
  nextStreamSequence = 1;
  hgetallCallCount = 0;
  keysCallCount = 0;
  queueCleanupAcks: string[] = [];
  queueConsumerGroupMissing = false;
  queueConsumerGroupMissingAckAttempts = 0;
  scanPageSize?: number;
  scanGate?: Promise<void>;
  onScan?: () => void;
  scanCalls: Array<{
    cursor: number;
    options?: { MATCH?: string; COUNT?: number };
  }> = [];

  private applyRunPatchField(
    hash: Map<string, string>,
    field: string,
    value: string,
    replaceMaps = false,
  ): void {
    if (field === "nodeStateDeletes") {
      const nodeStates = JSON.parse(hash.get("nodeStates") ?? "{}") as Record<string, unknown>;
      for (const key of JSON.parse(value) as string[]) delete nodeStates[key];
      hash.set("nodeStates", JSON.stringify(nodeStates));
      return;
    }
    if (field === "contextDeletes") {
      const context = JSON.parse(hash.get("context") ?? "{}") as Record<string, unknown>;
      for (const key of JSON.parse(value) as string[]) delete context[key];
      hash.set("context", JSON.stringify(context));
      return;
    }
    if (!replaceMaps && (field === "nodeStates" || field === "context")) {
      hash.set(
        field,
        JSON.stringify({
          ...JSON.parse(hash.get(field) ?? "{}"),
          ...JSON.parse(value),
        }),
      );
      return;
    }
    hash.set(field, value);
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
    this.hgetallCallCount += 1;
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
      if (this.sortedSets.delete(key)) count++;
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
    // The mock re-implements each Lua script in TypeScript, so it cannot prove the
    // Lua itself still carries its guards. Record what the backend actually sent so
    // tests can assert against the script source and its ARGV layout.
    this.lastScript = script;
    this.lastKeys = [...keys];
    this.lastArgs = [...args];
    this.scriptCalls.push({ script, keys: [...keys], args: [...args] });

    if (script.includes("indexed-run-create")) {
      const runId = args[0]!;
      const hash = new Map<string, string>();
      for (let index = 3; index < args.length; index += 2) {
        hash.set(args[index]!, args[index + 1]!);
      }
      this.hashes.set(key, hash);
      for (let index = 1; index <= 3; index++) {
        let members = this.sets.get(keys[index]!);
        if (!members) {
          members = new Set();
          this.sets.set(keys[index]!, members);
        }
        members.add(runId);
      }
      let observations = this.streams.get(keys[4]!);
      if (!observations) {
        observations = [];
        this.streams.set(keys[4]!, observations);
      }
      observations.push({
        id: `${this.nextStreamSequence++}-0`,
        data: JSON.parse(args[2]!) as Record<string, string>,
      });
      if (args[1]) hash.set("__terminalCompletedAtMs", args[1]!);
      this.refreshTerminalRetentionIndexFromHash(runId, hash, keys[5]!, keys[6]!);
      return Promise.resolve(1);
    }

    if (script.includes("indexed-workflow-enqueue")) {
      let stream = this.streams.get(key);
      if (!stream) {
        stream = [];
        this.streams.set(key, stream);
      }
      const id = `${this.nextStreamSequence++}-0`;
      stream.push({
        id,
        data: {
          runId: args[0]!,
          workflowId: args[1]!,
          input: args[2]!,
          priority: args[3]!,
          createdAt: args[4]!,
        },
      });
      let messageIds = this.sets.get(keys[1]!);
      if (!messageIds) {
        messageIds = new Set();
        this.sets.set(keys[1]!, messageIds);
      }
      messageIds.add(id);
      this.advanceRunRetentionRevision(keys[2]!, keys[3]!, args[0]!);
      return Promise.resolve(id);
    }

    if (script.includes("remove-acknowledged-queue-messages")) {
      const ids = new Set(args);
      const stream = this.streams.get(key);
      if (stream) this.streams.set(key, stream.filter(({ id }) => !ids.has(id)));
      const messageIds = this.sets.get(keys[1]!);
      for (const id of args) messageIds?.delete(id);
      if (messageIds?.size === 0) this.sets.delete(keys[1]!);
      return Promise.resolve(args.length);
    }

    if (script.includes("clear-run-queue-messages")) {
      if (this.queueConsumerGroupMissing && script.includes("'xack'")) {
        this.queueConsumerGroupMissingAckAttempts++;
        if (!script.includes("redis.pcall('xack'")) {
          throw new Error("NOGROUP No such key or consumer group");
        }
      }
      const messageIds = [...(this.sets.get(keys[1]!) ?? [])];
      this.queueCleanupAcks.push(...messageIds);
      const ids = new Set(messageIds);
      const stream = this.streams.get(key);
      if (stream) this.streams.set(key, stream.filter(({ id }) => !ids.has(id)));
      this.sets.delete(keys[1]!);
      return Promise.resolve(messageIds.length);
    }

    if (script.includes("backfill-workflow-queue-message-index")) {
      const start = args[0]!;
      const limit = Number(args[1]);
      const highWater = args[3]!;
      const startSequence = start === "-" ? -1 : Number(start.replace("(", "").split("-")[0]);
      const highWaterSequence = Number(highWater.split("-")[0]);
      const entries = (this.streams.get(key) ?? [])
        .filter(({ id }) => {
          const sequence = Number(id.split("-")[0]);
          return sequence > startSequence && sequence <= highWaterSequence;
        })
        .slice(0, limit);
      for (const entry of entries) {
        if (!entry.data.runId) continue;
        const indexKey = `${args[2]}${entry.data.runId}`;
        let messageIds = this.sets.get(indexKey);
        if (!messageIds) {
          messageIds = new Set();
          this.sets.set(indexKey, messageIds);
        }
        messageIds.add(entry.id);
      }
      return Promise.resolve([
        entries.length < limit || entries.at(-1)?.id === highWater ? "1" : "0",
        entries.at(-1)?.id ?? "",
      ]);
    }

    if (script.includes("read-workflow-queue-high-water")) {
      return Promise.resolve(this.streams.get(key)?.at(-1)?.id ?? "0-0");
    }

    if (script.includes("refresh-terminal-retention-index")) {
      const hash = this.hashes.get(key);
      if (!hash) return Promise.resolve(0);
      const status = hash.get("status") ?? "";
      const completedAt = hash.get("completedAt") ?? "";
      if (args[1] && status !== args[1]) return Promise.resolve(0);
      if (args[2] === "-" ? completedAt !== "" : args[2] && completedAt !== args[2]) {
        return Promise.resolve(0);
      }
      if (args[3]) {
        hash.set("__terminalCompletedAtMs", args[3]);
      }
      return Promise.resolve(
        this.refreshTerminalRetentionIndexFromHash(args[0]!, hash, keys[1]!, keys[2]!) ? 1 : 0,
      );
    }

    if (script.includes("remove-terminal-retention-index")) {
      const members = this.hashes.get(keys[1]!);
      const metadata = members?.get(args[0]!);
      if (!metadata) return Promise.resolve(0);
      this.sortedSets.get(key)?.delete((JSON.parse(metadata) as { member: string }).member);
      members!.delete(args[0]!);
      return Promise.resolve(1);
    }

    if (script.includes("scan-terminal-retention-run-keys")) {
      return this.scan(Number(args[0]), {
        MATCH: args[1],
        COUNT: Number(args[2]),
      }).then((page) => [String(page.cursor), page.keys]);
    }

    if (script.includes("read-terminal-retention-fields")) {
      const hash = this.hashes.get(key);
      return Promise.resolve([
        hash?.get("id") ?? null,
        hash?.get("workflowId") ?? null,
        hash?.get("createdAt") ?? null,
        hash?.get("status") ?? null,
        hash?.get("completedAt") ?? null,
        hash?.get("__runRetentionRevision") ?? null,
      ]);
    }

    if (script.includes("list-terminal-retention-candidates")) {
      const members = this.hashes.get(keys[1]!);
      const ordered = [...(this.sortedSets.get(key)?.entries() ?? [])]
        .filter(([, score]) => score < Number(args[0]))
        .sort(([leftMember, leftScore], [rightMember, rightScore]) =>
          leftScore - rightScore ||
          (leftMember === rightMember ? 0 : leftMember < rightMember ? -1 : 1)
        )
        .map(([member]) => member)
        .slice(0, Number(args[1]));
      const result: unknown[] = ["0"];
      for (const member of ordered) {
        const decoded = JSON.parse(member) as [string, string];
        const [completedAt, runId] = decoded;
        const metadata = members?.get(runId);
        const mapped = metadata
          ? JSON.parse(metadata) as {
            member: string;
            workflowId: string;
            createdAt: string;
            status: string;
            completedAt: string;
            revision: number;
          }
          : undefined;
        const hash = this.hashes.get(`${args[2]}${runId}`);
        const status = hash?.get("status");
        const terminal = status === "completed" || status === "failed" || status === "cancelled";
        if (
          mapped?.member === member && hash?.get("workflowId") &&
          hash.get("createdAt") && terminal && hash.get("completedAt") === completedAt &&
          hash.get("__runRetentionRevision")
        ) {
          result.push([
            runId,
            hash.get("workflowId"),
            hash.get("createdAt"),
            status,
            completedAt,
            hash.get("__runRetentionRevision"),
          ]);
        } else if (
          mapped?.member === member && !hash && mapped.workflowId && mapped.createdAt &&
          (mapped.status === "completed" || mapped.status === "failed" ||
            mapped.status === "cancelled") &&
          mapped.completedAt === completedAt
        ) {
          result.push([
            runId,
            mapped.workflowId,
            mapped.createdAt,
            mapped.status,
            mapped.completedAt,
            String(mapped.revision),
          ]);
        } else {
          this.sortedSets.get(key)?.delete(member);
          if (mapped?.member === member) members!.delete(runId);
          result[0] = "1";
        }
      }
      return Promise.resolve(result);
    }

    if (script.includes("conditional-terminal-run-delete")) {
      if (this.queueConsumerGroupMissing && script.includes("'xack'")) {
        this.queueConsumerGroupMissingAckAttempts++;
        if (!script.includes("redis.pcall('xack'")) {
          throw new Error("NOGROUP No such key or consumer group");
        }
      }
      const hash = this.hashes.get(key);
      const retentionMembers = this.hashes.get(keys[16]!);
      const retentionRaw = retentionMembers?.get(args[5]!);
      const retentionMetadata = retentionRaw
        ? JSON.parse(retentionRaw) as {
          member: string;
          workflowId: string;
          createdAt: string;
          status: string;
          completedAt: string;
          revision: number;
        }
        : undefined;
      if (
        hash !== undefined &&
        (hash.get("status") !== args[0] || hash.get("workflowId") !== args[1] ||
          hash.get("createdAt") !== args[2] || hash.get("completedAt") !== args[3] ||
          (hash.get("__runRetentionRevision") ?? "0") !== args[4])
      ) {
        return Promise.resolve(0);
      }
      if (hash === undefined) {
        if (!retentionMetadata) return Promise.resolve(2);
        if (
          retentionMetadata.workflowId !== args[1] || retentionMetadata.createdAt !== args[2] ||
          retentionMetadata.status !== args[0] || retentionMetadata.completedAt !== args[3] ||
          String(retentionMetadata.revision) !== args[4]
        ) return Promise.resolve(0);
      }

      let removed = 0;
      for (const dataKey of keys.slice(0, 7)) {
        if (this.store.delete(dataKey)) removed += 1;
        if (this.hashes.delete(dataKey)) removed += 1;
        if (this.lists.delete(dataKey)) removed += 1;
        if (this.streams.delete(dataKey)) removed += 1;
        this.expiries.delete(dataKey);
      }
      for (const indexKey of keys.slice(7, 15)) {
        if (this.sets.get(indexKey)?.delete(args[5]!)) removed += 1;
      }
      if (retentionMetadata) {
        if (this.sortedSets.get(keys[15]!)?.delete(retentionMetadata.member)) removed += 1;
        if (retentionMembers!.delete(args[5]!)) removed += 1;
      }
      const queueMessageIds = [...(this.sets.get(keys[17]!) ?? [])];
      this.queueCleanupAcks.push(...queueMessageIds);
      const queuedIds = new Set(queueMessageIds);
      const queueStream = this.streams.get(keys[18]!);
      if (queueStream) {
        this.streams.set(
          keys[18]!,
          queueStream.filter(({ id }) => !queuedIds.has(id)),
        );
      }
      if (this.sets.delete(keys[17]!)) removed += 1;
      if (removed > 0) return Promise.resolve(1);
      return Promise.resolve(hash === undefined ? 2 : 0);
    }

    if (script.includes("clear-legacy-run-ttl")) {
      return Promise.resolve(this.expiries.delete(key) ? 1 : 0);
    }

    if (script.includes("open-run-observation")) {
      const hash = this.hashes.get(key);
      if (!hash) return Promise.resolve(null);
      return Promise.resolve([
        hash.get("__runObservationRevision") ?? "0",
        JSON.stringify(Object.fromEntries(hash)),
      ]);
    }

    if (script.includes("read-run-observations")) {
      const after = Number(args[0]!.split("-")[0]);
      const messages = (this.streams.get(keys[0]!) ?? []).filter((message) =>
        Number(message.id.split("-")[0]) > after
      ).slice(0, Number(args[1]));
      const journal = this.hashes.get(keys[1]!);
      return Promise.resolve(JSON.stringify(messages.map((message) => {
        const approvals = journal?.get(message.data.revision!);
        return {
          id: message.id,
          data: message.data,
          ...(approvals !== undefined ? { approvals } : {}),
        };
      })));
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
      for (let i = 5; i < args.length; i += 2) {
        this.applyRunPatchField(hash, args[i]!, args[i + 1]!);
      }
      this.appendRunObservation(hash, streamKey, maxLength);
      this.refreshTerminalRetentionIndexFromHash(runId, hash, keys[1]!, keys[2]!);
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
      this.advanceRunRetentionRevision(keys[1]!, keys[2]!, args[2]!);
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
      this.advanceRunRetentionRevision(
        keys[1]!,
        keys[2]!,
        args[expectedCount + 5]!,
      );
      return Promise.resolve(1);
    }

    if (script.includes("conditional-run-precondition-check")) {
      const expectedCount = Number(args[0]);
      const expectedStatuses = args.slice(1, expectedCount + 1);
      const expectedWorkerId = args[expectedCount + 1]!;
      const checkWorker = args[expectedCount + 2] === "1";
      const hash = this.hashes.get(key);
      return Promise.resolve(
        hash && expectedStatuses.includes(hash.get("status") ?? "") &&
          (!checkWorker || hash.get("workerId") === expectedWorkerId)
          ? 1
          : 0,
      );
    }

    if (script.includes("observable-approval-append")) {
      const approvalsKey = keys[1]!;
      let list = this.lists.get(approvalsKey);
      if (!list) {
        list = [];
        this.lists.set(approvalsKey, list);
      }
      const approval = JSON.parse(args[0]!);
      if (
        args[4] === "1" &&
        list.some((raw) => {
          const candidate = JSON.parse(raw);
          return (candidate.status === "pending" || candidate.reconciliationPending === true) &&
            candidate.nodeId === approval.nodeId &&
            (candidate.waitInstanceId === undefined || approval.waitInstanceId === undefined ||
              candidate.waitInstanceId === approval.waitInstanceId);
        })
      ) return Promise.resolve(3);
      if (!this.retainApprovals(list, Number(args[1]))) return Promise.resolve(2);
      list.push(args[0]!);
      const hash = this.hashes.get(key);
      if (!hash) {
        this.advanceRunRetentionRevision(key, keys[3]!, args[5]!);
        return Promise.resolve(0);
      }
      const revision = this.appendRunObservation(
        hash,
        args[2]!,
        Number(args[3]),
      );
      this.synchronizeRunRetentionMetadata(
        args[5]!,
        keys[3]!,
        Number(hash.get("__runRetentionRevision")),
      );
      this.appendApprovalProjection(
        keys[2]!,
        revision,
        this.pendingApprovalProjection(list),
        Number(args[3]),
      );
      return Promise.resolve(1);
    }

    if (script.includes("conditional-owned-approval-append")) {
      const expectedCount = Number(args[0]);
      const expectedStatuses = args.slice(1, expectedCount + 1);
      const expectedWorkerId = args[expectedCount + 1]!;
      const value = args[expectedCount + 2]!;
      const maxEntries = Number(args[expectedCount + 3]);
      const streamKey = args[expectedCount + 4]!;
      const maxLength = Number(args[expectedCount + 5]);
      const hash = this.hashes.get(key);
      if (
        !hash || !expectedStatuses.includes(hash.get("status") ?? "") ||
        hash.get("workerId") !== expectedWorkerId
      ) {
        return Promise.resolve(0);
      }
      const approvalsKey = keys[1]!;
      let list = this.lists.get(approvalsKey);
      if (!list) {
        list = [];
        this.lists.set(approvalsKey, list);
      }
      const approval = JSON.parse(value);
      if (
        list.some((raw) => {
          const candidate = JSON.parse(raw);
          return (candidate.status === "pending" || candidate.reconciliationPending === true) &&
            candidate.nodeId === approval.nodeId &&
            (candidate.waitInstanceId === undefined || approval.waitInstanceId === undefined ||
              candidate.waitInstanceId === approval.waitInstanceId);
        })
      ) return Promise.resolve(3);
      if (!this.retainApprovals(list, maxEntries)) return Promise.resolve(2);
      list.push(value);
      const revision = this.appendRunObservation(
        hash,
        streamKey,
        maxLength,
      );
      this.synchronizeRunRetentionMetadata(
        args[expectedCount + 6]!,
        keys[3]!,
        Number(hash.get("__runRetentionRevision")),
      );
      this.appendApprovalProjection(
        keys[2]!,
        revision,
        this.pendingApprovalProjection(list),
        maxLength,
      );
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
            list[i] = serializeWorkflowJson(
              { ...approval, ...patch, id: approvalId },
              "approval",
            );
            this.advanceRunRetentionRevision(keys[1]!, keys[2]!, args[2]!);
            return Promise.resolve(1);
          }
        }
      }
      return Promise.resolve(0);
    }

    if (script.includes("conditional-approval-decision")) {
      const approvalId = args[0]!;
      const patch = JSON.parse(args[1]!);
      const deletedFields = JSON.parse(args[2]!) as string[];
      const list = this.lists.get(key);
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const approval = JSON.parse(list[i]!);
          if (approval.id === approvalId) {
            if (approval.status !== "pending") return Promise.resolve(2);
            Object.assign(approval, patch);
            for (const field of deletedFields) delete approval[field];
            list[i] = serializeWorkflowJson(approval, "approval");
            this.advanceRunRetentionRevision(keys[1]!, keys[2]!, args[3]!);
            return Promise.resolve(1);
          }
        }
      }
      return Promise.resolve(0);
    }

    if (script.includes("reserve-approval-decision")) {
      const approvalId = args[0]!;
      const recoveryClaimId = args[1]!;
      const staleBefore = args[2]!;
      const patch = JSON.parse(args[3]!);
      const list = this.lists.get(key);
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const approval = JSON.parse(list[i]!);
          if (approval.id !== approvalId) continue;
          if (approval.reconciliationPending !== true) return Promise.resolve(0);
          if (
            approval.recoveryClaimId !== undefined &&
            (approval.recoveryClaimedAt === undefined ||
              approval.recoveryClaimedAt > staleBefore)
          ) return Promise.resolve(2);
          Object.assign(approval, patch, { recoveryClaimId });
          list[i] = serializeWorkflowJson(approval, "approval");
          this.advanceRunRetentionRevision(keys[1]!, keys[2]!, args[4]!);
          return Promise.resolve(1);
        }
      }
      return Promise.resolve(0);
    }

    if (script.includes("release-approval-decision-claim")) {
      const approvalId = args[0]!;
      const recoveryClaimId = args[1]!;
      const list = this.lists.get(key);
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const approval = JSON.parse(list[i]!);
          if (approval.id !== approvalId) continue;
          if (approval.recoveryClaimId !== recoveryClaimId) return Promise.resolve(2);
          delete approval.recoveryClaimId;
          delete approval.recoveryClaimedAt;
          list[i] = serializeWorkflowJson(approval, "approval");
          this.advanceRunRetentionRevision(keys[1]!, keys[2]!, args[2]!);
          return Promise.resolve(1);
        }
      }
      return Promise.resolve(0);
    }

    if (script.includes("finalize-approval-decision")) {
      const approvalId = args[0]!;
      const recoveryClaimId = args[1]!;
      const list = this.lists.get(key);
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const approval = JSON.parse(list[i]!);
          if (approval.id === approvalId) {
            if (
              recoveryClaimId === ""
                ? approval.recoveryClaimId !== undefined
                : approval.recoveryClaimId !== recoveryClaimId
            ) return Promise.resolve(2);
            delete approval.reconciliationPending;
            delete approval.recoveryClaimId;
            delete approval.recoveryClaimedAt;
            list[i] = serializeWorkflowJson(approval, "approval");
            this.advanceRunRetentionRevision(keys[1]!, keys[2]!, args[2]!);
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
      const replaceMaps = args[expectedCount + 7] === "1";
      for (let i = expectedCount + 8; i < args.length; i += 2) {
        this.applyRunPatchField(hash, args[i]!, args[i + 1]!, replaceMaps);
      }
      this.appendRunObservation(hash, streamKey, maxLength);
      this.refreshTerminalRetentionIndexFromHash(runId, hash, keys[1]!, keys[2]!);
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
    this.keysCallCount++;
    return Promise.resolve(this.matchingKeys(pattern));
  }

  private matchingKeys(pattern: string): string[] {
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

    return all;
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

  /** Mirrors the retainApprovals routine in the approval append Lua scripts. */
  private retainApprovals(list: string[], maxEntries: number): boolean {
    const evictionsRequired = list.length - maxEntries + 1;
    if (evictionsRequired <= 0) return true;
    const decidedIndexes: number[] = [];
    for (let index = 0; index < list.length; index++) {
      const approval = JSON.parse(list[index]!);
      if (approval.status !== "pending" && approval.reconciliationPending !== true) {
        decidedIndexes.push(index);
        if (decidedIndexes.length === evictionsRequired) break;
      }
    }
    if (decidedIndexes.length < evictionsRequired) return false;
    for (let index = decidedIndexes.length - 1; index >= 0; index--) {
      list.splice(decidedIndexes[index]!, 1);
    }
    return true;
  }

  private pendingApprovalProjection(
    list: string[],
  ): Array<{ id: string; nodeId: string; message?: string }> {
    const pending: Array<{ id: string; nodeId: string; message?: string }> = [];
    for (const raw of list) {
      const approval = JSON.parse(raw) as {
        id: string;
        nodeId: string;
        message?: string;
        status: string;
      };
      if (approval.status !== "pending") continue;
      pending.push({
        id: approval.id,
        nodeId: approval.nodeId,
        ...(approval.message !== undefined ? { message: approval.message } : {}),
      });
    }
    return pending;
  }

  private synchronizeRunRetentionMetadata(
    runId: string,
    membersKey: string,
    revision: number,
  ): void {
    const members = this.hashes.get(membersKey);
    const metadataRaw = members?.get(runId);
    if (!metadataRaw) return;
    const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
    metadata.revision = revision;
    members!.set(runId, JSON.stringify(metadata));
  }

  private advanceRunRetentionRevision(
    runKey: string,
    membersKey: string,
    runId: string,
  ): number | undefined {
    const hash = this.hashes.get(runKey);
    const members = this.hashes.get(membersKey);
    const metadataRaw = members?.get(runId);
    let revision: number | undefined;
    if (hash) {
      revision = Number(hash.get("__runRetentionRevision") ?? "0") + 1;
      hash.set("__runRetentionRevision", String(revision));
    } else if (metadataRaw) {
      const metadata = JSON.parse(metadataRaw) as { revision?: number };
      revision = Number(metadata.revision ?? 0) + 1;
    }
    if (revision !== undefined) {
      this.synchronizeRunRetentionMetadata(runId, membersKey, revision);
    }
    return revision;
  }

  private refreshTerminalRetentionIndexFromHash(
    runId: string,
    hash: Map<string, string>,
    indexKey: string,
    membersKey: string,
  ): boolean {
    let members = this.hashes.get(membersKey);
    if (!members) {
      members = new Map();
      this.hashes.set(membersKey, members);
    }
    let index = this.sortedSets.get(indexKey);
    if (!index) {
      index = new Map();
      this.sortedSets.set(indexKey, index);
    }
    const oldMetadata = members.get(runId);
    const oldMember = oldMetadata
      ? (JSON.parse(oldMetadata) as { member: string }).member
      : undefined;
    const status = hash.get("status") ?? "";
    const completedAt = hash.get("completedAt") ?? "";
    const terminal = status === "completed" || status === "failed" || status === "cancelled";
    if (!terminal || completedAt === "") {
      if (oldMember) index.delete(oldMember);
      members.delete(runId);
      return true;
    }
    const rawCompletedAtMs = hash.get("__terminalCompletedAtMs");
    if (!rawCompletedAtMs) return false;
    const completedAtMs = Number(rawCompletedAtMs);
    if (!Number.isFinite(completedAtMs)) return false;
    const workflowId = hash.get("workflowId");
    const createdAt = hash.get("createdAt");
    if (!workflowId || !createdAt) return false;
    let revisionValue = hash.get("__runRetentionRevision");
    if (revisionValue === undefined) {
      revisionValue = "0";
      hash.set("__runRetentionRevision", revisionValue);
    }
    const revision = Number(revisionValue);
    if (!Number.isFinite(revision)) return false;
    const member = JSON.stringify([completedAt, runId]);
    if (oldMember && oldMember !== member) index.delete(oldMember);
    index.set(member, completedAtMs);
    members.set(
      runId,
      JSON.stringify({
        member,
        workflowId,
        createdAt,
        status,
        completedAt,
        revision,
      }),
    );
    return true;
  }

  private appendRunObservation(
    hash: Map<string, string>,
    streamKey: string,
    maxLength: number,
  ): number {
    const revision = Number(hash.get("__runObservationRevision") ?? "0") + 1;
    hash.set("__runObservationRevision", String(revision));
    const retentionRevision = Number(hash.get("__runRetentionRevision") ?? "0") + 1;
    hash.set("__runRetentionRevision", String(retentionRevision));
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

  private appendApprovalProjection(
    key: string,
    revision: number,
    approvals: Array<{ id: string; nodeId: string; message?: string }>,
    maxLength: number,
  ): void {
    let journal = this.hashes.get(key);
    if (!journal) {
      journal = new Map();
      this.hashes.set(key, journal);
    }
    journal.set(String(revision), JSON.stringify(approvals));
    const oldestRetainedRevision = revision - maxLength;
    for (const storedRevision of journal.keys()) {
      if (Number(storedRevision) <= oldestRetainedRevision) journal.delete(storedRevision);
    }
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

  async scan(
    cursor: number,
    options?: { MATCH?: string; COUNT?: number },
  ): Promise<{ cursor: number; keys: string[] }> {
    this.scanCalls.push({ cursor, options });
    this.onScan?.();
    await this.scanGate;
    const keys = this.matchingKeys(options?.MATCH ?? "*");
    const pageSize = Math.max(1, this.scanPageSize ?? options?.COUNT ?? keys.length);
    const nextCursor = cursor + pageSize < keys.length ? cursor + pageSize : 0;
    return { cursor: nextCursor, keys: keys.slice(cursor, cursor + pageSize) };
  }

  quit(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Forces the observation-setup interleaving: `openRunObservation` captures the
 * revision baseline in one atomic script, then hydrates the initial approvals
 * in a separate read. This adapter runs a caller-supplied write between those
 * two steps, landing state that is newer than the captured baseline revision.
 */
class ApprovalRaceRedisAdapter extends MockRedisAdapter {
  beforeApprovalsRead?: () => Promise<void>;

  override async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (this.beforeApprovalsRead && key.includes(":approvals:")) {
      const hook = this.beforeApprovalsRead;
      this.beforeApprovalsRead = undefined;
      await hook();
    }
    return await super.lrange(key, start, stop);
  }
}

class ApprovalJournalPruneRaceRedisAdapter extends MockRedisAdapter {
  afterObservationRead?: () => Promise<void>;

  override async xread(
    streams: Array<{ key: string; xid: string }>,
    options: { block?: number; count?: number } = {},
  ): Promise<
    Array<{ key: string; messages: Array<{ id: string; data: Record<string, string> }> }>
  > {
    const result = await super.xread(streams, options);
    if (result[0]?.messages.length && this.afterObservationRead) {
      const hook = this.afterObservationRead;
      this.afterObservationRead = undefined;
      await hook();
    }
    return result;
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
    it("should set default config values", async () => {
      const b = new RedisBackend({ client: mockRedis as unknown as RedisAdapter });
      assertExists(b);

      await b.initialize();
      assertEquals(
        mockRedis.groups.get("vf:workflow:stream:schema-v1"),
        new Set(["vf:workflow:workers:schema-v1"]),
        "default stream and consumer group keys are a compatibility contract with running workers",
      );

      await b.createRun(createTestRun("run-default"));
      assertEquals(
        mockRedis.hashes.has("vf:workflow:schema-v1:run:run-default"),
        true,
        "the default key prefix must place run hashes where existing deployments read them",
      );
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
    it("creates a terminal run and its indexes in one retention-aware script", async () => {
      const scriptCallsBefore = mockRedis.scriptCalls.length;
      await backend.createRun({
        ...createTestRun("run-terminal-atomic-create"),
        status: "completed",
        completedAt: new Date(2),
      });

      assertEquals(mockRedis.scriptCalls.length, scriptCallsBefore + 1);
      assertStringIncludes(mockRedis.lastScript, "indexed-run-create");
      assertStringIncludes(mockRedis.lastScript, "redis.call('hset', KEYS[1]");
      assertStringIncludes(mockRedis.lastScript, "redis.call('sadd', KEYS[4]");
      assertStringIncludes(mockRedis.lastScript, "redis.call('xadd', KEYS[5]");
      assertStringIncludes(mockRedis.lastScript, "updateTerminalRetentionIndex");
    });

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

    it("journals an approval append as its own contiguous revision across instances", async () => {
      const writer = new RedisBackend({ client: mockRedis, prefix: "test:" });
      const reader = new RedisBackend({ client: mockRedis, prefix: "test:" });
      const run = createTestRun("run-approval-observed");
      await writer.createRun(run);
      const observation = await reader.openRunObservation(run.id);
      assertExists(observation);

      await writer.updateRun(run.id, { status: "waiting" });
      await writer.savePendingApproval(run.id, {
        id: "apr-1",
        nodeId: "review",
        message: "Please review",
        payload: { secret: "approval-payload" },
        requestedAt: new Date("2025-01-02T00:00:00Z"),
        status: "pending",
      });
      assertEquals(
        mockRedis.lastScript.includes("'MAXLEN', '~'"),
        false,
        "approval projections may be trimmed only with the exact stream bound",
      );
      await writer.updateRun(run.id, { status: "running" });

      // The approval save must keep the schema-v1 observation record readable
      // by older processes. The reduced projection belongs in its separately
      // versioned companion journal, never in the legacy stream record.
      const stream = mockRedis.streams.get(
        "test:schema-v1:run-observation:run-approval-observed",
      );
      assertExists(stream);
      assertEquals(stream.length, 4);
      const approvalRecord = stream[2]!.data;
      assertEquals(approvalRecord.revision, "2");
      assertEquals(Object.keys(approvalRecord).sort(), ["nodes", "revision", "status"]);

      const approvalJournal = mockRedis.hashes.get(
        "test:schema-v1:run-observation-approvals-v1:run-approval-observed",
      );
      assertExists(approvalJournal);
      assertEquals(JSON.parse(approvalJournal.get("2") ?? "null"), [
        { id: "apr-1", nodeId: "review", message: "Please review" },
      ]);
      assertEquals(approvalJournal.get("2")?.includes("approval-payload"), false);

      const iterator = observation.changes[Symbol.asyncIterator]();
      assertEquals((await iterator.next()).value, {
        revision: 1,
        status: "waiting",
        nodes: {},
      });
      assertEquals((await iterator.next()).value, {
        revision: 2,
        status: "waiting",
        nodes: {},
        approvals: [{ id: "apr-1", nodeId: "review", message: "Please review" }],
      });
      assertEquals((await iterator.next()).value, {
        revision: 3,
        status: "running",
        nodes: {},
      });
      await observation.close();
    });

    it("reads an approval projection atomically with its stream revision", async () => {
      const racingRedis = new ApprovalJournalPruneRaceRedisAdapter();
      const writer = new RedisBackend({ client: racingRedis, prefix: "test:" });
      const reader = new RedisBackend({ client: racingRedis, prefix: "test:" });
      const run = createTestRun("run-approval-journal-race", { status: "waiting" });
      await writer.createRun(run);
      const observation = await reader.openRunObservation(run.id);
      assertExists(observation);

      const approval = (id: string): PendingApproval => ({
        id,
        nodeId: "review",
        message: `Review ${id}`,
        payload: undefined,
        requestedAt: new Date("2025-01-02T00:00:00Z"),
        status: "pending",
      });
      await writer.savePendingApproval(run.id, approval("apr-target"));

      // Force the exact inter-command race: the reader has revision 1 from
      // XREAD, then 64 later approval writes prune revision 1 from the
      // companion journal before the old separate HGETALL can read it.
      racingRedis.afterObservationRead = async () => {
        for (let index = 0; index < 64; index++) {
          await writer.savePendingApproval(run.id, approval(`apr-later-${index}`));
        }
      };

      assertEquals((await observation.changes[Symbol.asyncIterator]().next()).value, {
        revision: 1,
        status: "waiting",
        nodes: {},
        approvals: [{ id: "apr-target", nodeId: "review", message: "Review apr-target" }],
      });
      await observation.close();
    });

    it("delivers an approval appended during observation setup exactly once", async () => {
      // Observation setup captures the revision baseline atomically, then
      // hydrates initial approvals in a separate read. An approval landing in
      // between is newer than the baseline revision AND already present in the
      // initial snapshot. The subscriber must still learn the approval exactly
      // once: from the snapshot, with its journaled revision consumed
      // contiguously and suppressed as already-baselined, never re-reported
      // and never dropped.
      const racingRedis = new ApprovalRaceRedisAdapter();
      const racingBackend = new RedisBackend({
        client: racingRedis as unknown as RedisAdapter,
        prefix: "test:",
      });
      const run = createTestRun("run-open-approval-race", { status: "waiting" });
      await racingBackend.createRun(run);

      racingRedis.beforeApprovalsRead = () =>
        racingBackend.savePendingApproval(run.id, {
          id: "apr-race",
          nodeId: "review",
          message: "Please review",
          payload: undefined,
          requestedAt: new Date("2025-01-02T00:00:00Z"),
          status: "pending",
        });

      const observation = await racingBackend.openRunObservation(run.id);
      assertExists(observation);

      // The initial snapshot is the delivery channel for this approval.
      assertEquals(
        observation.initial.pendingApprovals.map((approval) => approval.id),
        ["apr-race"],
      );

      // The approval's own revision record (1, above the captured baseline 0)
      // must be consumed without a contiguity failure, and the derived stream
      // must not repeat what the snapshot already delivered.
      await racingBackend.updateRun(run.id, { status: "completed" });
      const events = [];
      for await (const event of deriveWorkflowRunEventObservation(observation).events) {
        events.push(event);
      }
      assertEquals(events, [
        { type: "run.status", runId: run.id, status: "completed" },
      ]);
    });

    it("observes approvals appended by an older worker without a stream record", async () => {
      const reader = new RedisBackend({ client: mockRedis, prefix: "test:" });
      const run = createTestRun("run-legacy-approval-observed", { status: "waiting" });
      await backend.createRun(run);
      const controller = new AbortController();
      const observation = await reader.openRunObservation(run.id, {
        signal: controller.signal,
      });
      assertExists(observation);

      // Simulate the pre-journal writer used during a rolling deployment. It
      // appends the approval list but cannot bump the observation revision or
      // add a stream record that a newer reader would otherwise consume.
      await mockRedis.rpush(
        "test:schema-v1:approvals:run-legacy-approval-observed",
        JSON.stringify({
          id: "apr-legacy",
          nodeId: "review",
          message: "Please review",
          requestedAt: "2025-01-02T00:00:00.000Z",
          status: "pending",
        }),
      );

      const events = deriveWorkflowRunEventObservation(observation).events[
        Symbol
          .asyncIterator
      ]();
      const timeout = setTimeout(() => controller.abort(), 200);
      try {
        assertEquals(await events.next(), {
          value: {
            type: "approval.pending",
            runId: run.id,
            approvalId: "apr-legacy",
            nodeId: "review",
            message: "Please review",
          },
          done: false,
        });
      } finally {
        clearTimeout(timeout);
        await observation.close();
      }
    });

    it("preserves a decided legacy approval ahead of queued terminal transitions", async () => {
      const reader = new RedisBackend({ client: mockRedis, prefix: "test:" });
      const run = createTestRun("run-legacy-approval-queued", { status: "waiting" });
      await backend.createRun(run);
      const observation = await reader.openRunObservation(run.id);
      assertExists(observation);

      await mockRedis.rpush(
        "test:schema-v1:approvals:run-legacy-approval-queued",
        JSON.stringify({
          id: "apr-legacy-queued",
          nodeId: "review",
          message: "Please review",
          requestedAt: "2025-01-02T00:00:00.000Z",
          status: "approved",
          decidedBy: "reviewer",
          decidedAt: "2025-01-02T00:01:00.000Z",
        }),
      );
      await backend.updateRun(run.id, { status: "running" });
      await backend.updateRun(run.id, { status: "completed" });

      const events = [];
      for await (const event of deriveWorkflowRunEventObservation(observation).events) {
        events.push(event);
      }
      assertEquals(events, [
        {
          type: "approval.pending",
          runId: run.id,
          approvalId: "apr-legacy-queued",
          nodeId: "review",
          message: "Please review",
        },
        { type: "run.status", runId: run.id, status: "running" },
        { type: "run.status", runId: run.id, status: "completed" },
      ]);
    });

    it("preserves a newly decided legacy approval ahead of a queued journaled transition", async () => {
      const reader = new RedisBackend({ client: mockRedis, prefix: "test:" });
      const run = createTestRun("run-legacy-approval-journaled", { status: "waiting" });
      await backend.createRun(run);
      const observation = await reader.openRunObservation(run.id);
      assertExists(observation);

      await mockRedis.rpush(
        "test:schema-v1:approvals:run-legacy-approval-journaled",
        JSON.stringify({
          id: "apr-legacy-journaled",
          nodeId: "review",
          message: "Please review",
          requestedAt: "2025-01-02T00:00:00.000Z",
          status: "pending",
        }),
      );
      await backend.updateRun(run.id, { status: "running" });

      // A rolling worker can leave a pending-only projection attached to the
      // queued transition before the legacy writer records the decision.
      mockRedis.hashes.set(
        "test:schema-v1:run-observation-approvals-v1:run-legacy-approval-journaled",
        new Map([[
          "1",
          JSON.stringify([{
            id: "apr-legacy-journaled",
            nodeId: "review",
            message: "Please review",
          }]),
        ]]),
      );
      assertEquals(
        await backend.updateApproval(run.id, "apr-legacy-journaled", {
          approved: true,
          approver: "reviewer",
        }),
        true,
      );
      await backend.updateRun(run.id, { status: "completed" });

      const events = [];
      for await (const event of deriveWorkflowRunEventObservation(observation).events) {
        events.push(event);
      }
      assertEquals(events, [
        {
          type: "approval.pending",
          runId: run.id,
          approvalId: "apr-legacy-journaled",
          nodeId: "review",
          message: "Please review",
        },
        { type: "run.status", runId: run.id, status: "running" },
        { type: "run.status", runId: run.id, status: "completed" },
      ]);
    });

    it("does not pre-emit pending approvals represented by queued journal records", async () => {
      const reader = new RedisBackend({ client: mockRedis, prefix: "test:" });
      const run = createTestRun("run-legacy-approval-journaled-pending", { status: "waiting" });
      await backend.createRun(run);
      const observation = await reader.openRunObservation(run.id);
      assertExists(observation);

      await mockRedis.rpush(
        "test:schema-v1:approvals:run-legacy-approval-journaled-pending",
        JSON.stringify({
          id: "apr-decided",
          nodeId: "first-review",
          message: "First review",
          requestedAt: "2025-01-02T00:00:00.000Z",
          status: "approved",
          decidedBy: "reviewer",
          decidedAt: "2025-01-02T00:01:00.000Z",
        }),
        JSON.stringify({
          id: "apr-pending",
          nodeId: "second-review",
          message: "Second review",
          requestedAt: "2025-01-02T00:02:00.000Z",
          status: "pending",
        }),
      );
      await backend.updateRun(run.id, { status: "running" });

      mockRedis.hashes.set(
        "test:schema-v1:run-observation-approvals-v1:run-legacy-approval-journaled-pending",
        new Map([[
          "1",
          JSON.stringify([{
            id: "apr-pending",
            nodeId: "second-review",
            message: "Second review",
          }]),
        ]]),
      );
      await backend.updateRun(run.id, { status: "completed" });

      const events = [];
      for await (const event of deriveWorkflowRunEventObservation(observation).events) {
        events.push(event);
      }
      assertEquals(events, [
        {
          type: "approval.pending",
          runId: run.id,
          approvalId: "apr-decided",
          nodeId: "first-review",
          message: "First review",
        },
        { type: "run.status", runId: run.id, status: "running" },
        {
          type: "approval.pending",
          runId: run.id,
          approvalId: "apr-pending",
          nodeId: "second-review",
          message: "Second review",
        },
        { type: "run.status", runId: run.id, status: "completed" },
      ]);
    });

    it("preserves persisted order when a legacy approval follows a queued journal approval", async () => {
      const reader = new RedisBackend({ client: mockRedis, prefix: "test:" });
      const run = createTestRun("run-legacy-after-journal", { status: "waiting" });
      await backend.createRun(run);
      const observation = await reader.openRunObservation(run.id);
      assertExists(observation);

      await backend.savePendingApproval(run.id, {
        id: "apr-journaled-first",
        nodeId: "first-review",
        message: "First review",
        payload: undefined,
        requestedAt: new Date("2025-01-02T00:00:00.000Z"),
        status: "pending",
      });
      await mockRedis.rpush(
        "test:schema-v1:approvals:run-legacy-after-journal",
        JSON.stringify({
          id: "apr-legacy-second",
          nodeId: "second-review",
          message: "Second review",
          requestedAt: "2025-01-02T00:01:00.000Z",
          status: "pending",
        }),
      );
      await backend.updateRun(run.id, { status: "completed" });

      const events = [];
      for await (const event of deriveWorkflowRunEventObservation(observation).events) {
        events.push(event);
      }
      assertEquals(events, [
        {
          type: "approval.pending",
          runId: run.id,
          approvalId: "apr-journaled-first",
          nodeId: "first-review",
          message: "First review",
        },
        {
          type: "approval.pending",
          runId: run.id,
          approvalId: "apr-legacy-second",
          nodeId: "second-review",
          message: "Second review",
        },
        { type: "run.status", runId: run.id, status: "completed" },
      ]);
    });

    it("polls legacy approvals when a queued batch enters waiting after earlier revisions", async () => {
      const reader = new RedisBackend({ client: mockRedis, prefix: "test:" });
      const run = createTestRun("run-legacy-approval-first-waiting", { status: "running" });
      await backend.createRun(run);
      const observation = await reader.openRunObservation(run.id);
      assertExists(observation);

      await mockRedis.rpush(
        "test:schema-v1:approvals:run-legacy-approval-first-waiting",
        JSON.stringify({
          id: "apr-first-waiting",
          nodeId: "review",
          message: "Review before resume",
          requestedAt: "2025-01-02T00:00:00.000Z",
          status: "pending",
        }),
      );
      await backend.updateRun(run.id, { status: "running" });
      await backend.updateRun(run.id, { status: "waiting" });
      await backend.updateRun(run.id, { status: "running" });
      await backend.updateRun(run.id, { status: "completed" });

      const events = [];
      for await (const event of deriveWorkflowRunEventObservation(observation).events) {
        events.push(event);
      }
      assertEquals(events, [
        { type: "run.status", runId: run.id, status: "waiting" },
        {
          type: "approval.pending",
          runId: run.id,
          approvalId: "apr-first-waiting",
          nodeId: "review",
          message: "Review before resume",
        },
        { type: "run.status", runId: run.id, status: "running" },
        { type: "run.status", runId: run.id, status: "completed" },
      ]);
    });

    it("keeps baseline approvals when queued journal records mention them", async () => {
      const reader = new RedisBackend({ client: mockRedis, prefix: "test:" });
      const run = createTestRun("run-legacy-approval-baseline-journaled", {
        status: "waiting",
      });
      await backend.createRun(run);
      await mockRedis.rpush(
        "test:schema-v1:approvals:run-legacy-approval-baseline-journaled",
        JSON.stringify({
          id: "apr-baseline",
          nodeId: "baseline-review",
          message: "Baseline review",
          requestedAt: "2025-01-02T00:00:00.000Z",
          status: "pending",
        }),
      );

      const observation = await reader.openRunObservation(run.id);
      assertExists(observation);
      assertEquals(
        observation.initial.pendingApprovals.map((approval) => approval.id),
        ["apr-baseline"],
      );

      await mockRedis.rpush(
        "test:schema-v1:approvals:run-legacy-approval-baseline-journaled",
        JSON.stringify({
          id: "apr-decided",
          nodeId: "decided-review",
          message: "Decided review",
          requestedAt: "2025-01-02T00:01:00.000Z",
          status: "approved",
          decidedBy: "reviewer",
          decidedAt: "2025-01-02T00:02:00.000Z",
        }),
      );
      await backend.updateRun(run.id, { status: "running" });
      mockRedis.hashes.set(
        "test:schema-v1:run-observation-approvals-v1:run-legacy-approval-baseline-journaled",
        new Map([[
          "1",
          JSON.stringify([{
            id: "apr-baseline",
            nodeId: "baseline-review",
            message: "Baseline review",
          }]),
        ]]),
      );
      await backend.updateRun(run.id, { status: "completed" });

      const events = [];
      for await (const event of deriveWorkflowRunEventObservation(observation).events) {
        events.push(event);
      }
      assertEquals(events, [
        {
          type: "approval.pending",
          runId: run.id,
          approvalId: "apr-decided",
          nodeId: "decided-review",
          message: "Decided review",
        },
        { type: "run.status", runId: run.id, status: "running" },
        { type: "run.status", runId: run.id, status: "completed" },
      ]);
    });

    it("does not re-emit approvals decided before legacy observation began", async () => {
      const reader = new RedisBackend({ client: mockRedis, prefix: "test:" });
      const run = createTestRun("run-legacy-decided-baseline", { status: "waiting" });
      await backend.createRun(run);
      await mockRedis.rpush(
        "test:schema-v1:approvals:run-legacy-decided-baseline",
        JSON.stringify({
          id: "apr-historical",
          nodeId: "first-review",
          message: "Historical review",
          requestedAt: "2025-01-01T00:00:00.000Z",
          status: "approved",
          decidedAt: "2025-01-01T00:00:01.000Z",
          decidedBy: "admin",
        }),
        JSON.stringify({
          id: "apr-current",
          nodeId: "second-review",
          message: "Current review",
          requestedAt: "2025-01-02T00:00:00.000Z",
          status: "pending",
        }),
      );

      const observation = await reader.openRunObservation(run.id);
      assertExists(observation);
      assertEquals(
        observation.initial.pendingApprovals.map((approval) => approval.id),
        ["apr-current"],
      );
      await backend.updateRun(run.id, { status: "completed" });

      const events = deriveWorkflowRunEventObservation(observation).events[
        Symbol.asyncIterator
      ]();
      try {
        assertEquals(await events.next(), {
          value: { type: "run.status", runId: run.id, status: "completed" },
          done: false,
        });
      } finally {
        await observation.close();
      }
    });

    it("journals owned approval appends only when ownership holds", async () => {
      const run = createTestRun("run-owned-approval", { status: "waiting", workerId: "w1" });
      await backend.createRun(run);
      const observation = await backend.openRunObservation(run.id);
      assertExists(observation);

      const approval = (id: string): PendingApproval => ({
        id,
        nodeId: "review",
        message: "Please review",
        payload: undefined,
        requestedAt: new Date("2025-01-02T00:00:00Z"),
        status: "pending",
      });

      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          run.id,
          ["waiting"],
          "other-worker",
          approval("apr-denied"),
        ),
        false,
      );
      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          run.id,
          ["waiting"],
          "w1",
          approval("apr-owned"),
        ),
        true,
      );
      assertEquals(
        mockRedis.lastScript.includes("'MAXLEN', '~'"),
        false,
        "owned approval projections may be trimmed only with the exact stream bound",
      );

      // Only the owned append may journal: a denied save that still bumped the
      // revision would leave readers waiting on a record that never comes.
      const stream = mockRedis.streams.get(
        "test:schema-v1:run-observation:run-owned-approval",
      );
      assertExists(stream);
      assertEquals(stream.length, 2);

      const iterator = observation.changes[Symbol.asyncIterator]();
      assertEquals((await iterator.next()).value, {
        revision: 1,
        status: "waiting",
        nodes: {},
        approvals: [{ id: "apr-owned", nodeId: "review", message: "Please review" }],
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
      const evalScript = mockRedis.eval.bind(mockRedis);
      mockRedis.eval = (script, keys, args) =>
        script.includes("read-run-observations")
          ? Promise.reject(new Error("redis://private-host raw failure"))
          : evalScript(script, keys, args);
      const readError = await assertRejects(
        () => readFailure.changes[Symbol.asyncIterator]().next(),
        Error,
      );
      assertInstanceOf(
        readError,
        Error,
        "the sanitized rejection must still be an Error",
      );
      assertEquals(
        readError.message,
        "Workflow run observation failed",
        "the raw Redis failure must not reach the caller",
      );
      assertEquals(
        readError.cause,
        undefined,
        "no cause chain may carry the Redis connection string",
      );
      mockRedis.eval = evalScript;

      const parseBackend = new RedisBackend({ client: mockRedis, prefix: "parse:" });
      const parseRun = createTestRun("run-observed-parse-failure");
      await parseBackend.createRun(parseRun);
      const parseFailure = await parseBackend.openRunObservation(parseRun.id);
      assertExists(parseFailure);
      mockRedis.eval = (script, keys, args) =>
        script.includes("read-run-observations")
          ? Promise.resolve(JSON.stringify([{
            id: "1000-0",
            data: { revision: "not-a-revision", status: "running", nodes: "private payload" },
          }]))
          : evalScript(script, keys, args);
      const parseError = await assertRejects(
        () => parseFailure.changes[Symbol.asyncIterator]().next(),
        Error,
      );
      assertInstanceOf(
        parseError,
        Error,
        "the sanitized rejection must still be an Error",
      );
      assertEquals(
        parseError.message,
        "Workflow run observation failed",
        "the unparsable record must not reach the caller",
      );
      assertEquals(
        parseError.cause,
        undefined,
        "no cause chain may carry the raw stream payload",
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

    it("fails an observation when another backend deletes the run", async () => {
      const run = createTestRun("run-observed-delete");
      await backend.createRun(run);
      const controller = new AbortController();
      const observation = await backend.openRunObservation(run.id, {
        signal: controller.signal,
      });
      assertExists(observation);
      const writer = new RedisBackend({ client: mockRedis, prefix: "test:" });
      await writer.deleteRun(run.id);

      const timeoutId = setTimeout(() => controller.abort(), 100);
      let error: unknown;
      try {
        await observation.changes[Symbol.asyncIterator]().next();
      } catch (cause) {
        error = cause;
      } finally {
        clearTimeout(timeoutId);
      }

      assertExists(error);
      assertEquals((error as Error).message, "Workflow run observation failed");
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
        "context.input.<redacted>",
      );
      assertEquals(await backend.getRun(run.id), null);
    });

    it("names the run when a patch persists a lossy value", async () => {
      // Creation usually writes only `input`. Patches write the accumulated
      // node outputs, so a patch is where a warning actually fires, and it
      // used to arrive with no run to attribute it to.
      const runId = "run-patch-warning";
      await backend.createRun(createTestRun(runId));

      const warnings: LogEntry[] = [];
      const unsubscribe = __subscribeLogRecordEmitter((entry) => {
        if (entry.level === "warn" && entry.component === "workflow-context") {
          warnings.push(entry);
        }
      });

      try {
        await backend.updateRun(runId, {
          context: { input: {}, step: { when: new Date("2026-01-01T00:00:00Z") } },
        });
      } finally {
        unsubscribe();
      }

      assertEquals(warnings.length, 1);
      // The logger promotes the run id to its own field rather than leaving it
      // in the free-form context, so that is where it has to be asserted.
      assertEquals(warnings[0]?.run_id, runId);
    });

    it("rejects lossy context values when strictContext is enabled", async () => {
      const strictBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "strict:",
        strictContext: true,
      });
      const rows: unknown[] = [{ id: 1 }];
      Object.defineProperty(rows, "meta", {
        value: "required",
        enumerable: true,
      });
      let deep: unknown = { when: new Date(0) };
      for (let index = 0; index < MAX_TRAVERSAL_DEPTH + 25; index++) deep = { n: deep };

      for (
        const testCase of [
          {
            id: "run-strict-date-context",
            context: { input: {}, when: new Date(0) },
            message: "strictContext",
          },
          {
            id: "run-strict-array-context",
            context: { input: {}, rows },
            message: "array property",
          },
          {
            id: "run-strict-deep-context",
            context: { input: {}, deep },
            message: "uninspected value",
          },
        ]
      ) {
        await assertRejects(
          () =>
            strictBackend.createRun(createTestRun(testCase.id, {
              context: testCase.context,
            })),
          Error,
          testCase.message,
        );
        assertEquals(await strictBackend.getRun(testCase.id), null);
      }
    });
  });

  describe("updateRun", () => {
    it("should update status and update index sets", async () => {
      await backend.createRun(createTestRun("run-u1"));
      await backend.updateRun("run-u1", { status: "running", startedAt: new Date() });

      const updated = await backend.getRun("run-u1");
      assertEquals(updated?.status, "running");
    });

    it("does not add an existence round trip to successful updates", async () => {
      const runId = "run-update-without-exists";
      await backend.createRun(createTestRun(runId));
      let existenceChecks = 0;
      const exists = mockRedis.exists.bind(mockRedis);
      mockRedis.exists = (...keys) => {
        existenceChecks++;
        return exists(...keys);
      };

      await backend.updateRun(runId, { heartbeatAt: new Date(1) });

      assertEquals(existenceChecks, 0);
      assertEquals((await backend.getRun(runId))?.heartbeatAt, new Date(1));
    });

    it("rejects an update for a missing run", async () => {
      await assertRejects(
        () => backend.updateRun("missing-run", { status: "running" }),
        Error,
        "Run not found",
      );
      assertEquals(await backend.getRun("missing-run"), null);
    });

    it("preserves missing-run precedence after strict patch validation fails", async () => {
      const strictBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "strict-missing-run:",
        strictContext: true,
      });

      const error = await assertRejects(
        () =>
          strictBackend.updateRun("missing-run-strict", {
            context: { input: {}, step: { when: new Date(0) } },
          }),
        Error,
        "Run not found: missing-run-strict",
      );
      assertInstanceOf(error, Error);
      assertInstanceOf(error.cause, Error);
      assertStringIncludes(error.cause.message, "strictContext");
    });

    it("preserves missing-run semantics when a run disappears before strict validation fails", async () => {
      const strictBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "strict-deleted-run:",
        strictContext: true,
      });
      const runId = "run-strict-concurrent-delete";
      await strictBackend.createRun(createTestRun(runId));
      const runKey = [...mockRedis.hashes.keys()].find((key) => key.endsWith(`:${runId}`));
      assertExists(runKey);

      const exists = mockRedis.exists.bind(mockRedis);
      let deleteAfterLookup = true;
      mockRedis.exists = async (key) => {
        if (key === runKey && deleteAfterLookup) {
          deleteAfterLookup = false;
          mockRedis.hashes.delete(key);
        }
        return await exists(key);
      };

      const error = await assertRejects(
        () =>
          strictBackend.updateRun(runId, {
            context: { input: {}, step: { when: new Date(0) } },
          }),
        Error,
        `Run not found: ${runId}`,
      );
      assertInstanceOf(error, Error);
      assertInstanceOf(error.cause, Error);
      assertStringIncludes(error.cause.message, "strictContext");
    });

    it("should update output and context", async () => {
      await backend.createRun(createTestRun("run-u2"));
      await backend.updateRun("run-u2", {
        context: { input: { topic: "test" }, first: "keep" },
      });
      await backend.updateRun("run-u2", {
        output: { value: 42 },
        context: { input: {}, step1: "done" },
      });

      const updated = await backend.getRun("run-u2");
      assertEquals(updated?.output, { value: 42 });
      assertEquals(updated?.context, { input: {}, first: "keep", step1: "done" });
      assertStringIncludes(
        mockRedis.lastScript,
        "redis.call('hset', KEYS[1], 'context', mergeJsonObjects(current, value, true))",
        "context patches must keep serialized values opaque in Lua",
      );
      assertStringIncludes(
        mockRedis.lastScript,
        "containsAmbiguousEmptyArray",
        "node-state patches still use the ambiguous empty-array raw-slice fallback",
      );
      assertEquals(
        mockRedis.lastScript.includes("cannot preserve empty arrays"),
        false,
        "standard Redis must accept user-bearing empty arrays",
      );
    });

    it("deletes context keys omitted by JSON persistence", async () => {
      const runId = "run-context-omitted-values";
      await backend.createRun(createTestRun(runId, {
        context: {
          input: {},
          removedUndefined: "stale",
          removedFunction: "stale",
          removedSymbol: "stale",
          preserved: "kept",
        },
      }));

      await backend.updateRun(runId, {
        context: {
          removedUndefined: undefined,
          removedFunction: () => "omitted",
          added: "stored",
        },
      });
      assertEquals((await backend.getRun(runId))?.context, {
        input: {},
        removedSymbol: "stale",
        preserved: "kept",
        added: "stored",
      });

      assertEquals(
        await backend.updateRunIfStatus(runId, ["pending"], {
          context: { removedSymbol: Symbol("omitted") },
        }),
        true,
      );
      assertEquals((await backend.getRun(runId))?.context, {
        input: {},
        preserved: "kept",
        added: "stored",
      });
    });

    it("derives omitted context keys from the pre-serialization key snapshot", async () => {
      const runId = "run-context-key-snapshot";
      await backend.createRun(createTestRun(runId, {
        context: { input: {}, preserve: "existing" },
      }));
      const contextPatch: Record<string, unknown> = {};
      Object.defineProperty(contextPatch, "trigger", {
        configurable: true,
        enumerable: true,
        get() {
          contextPatch.preserve = undefined;
          return "stored";
        },
      });

      await backend.updateRun(runId, { context: contextPatch });

      assertEquals((await backend.getRun(runId))?.context, {
        input: {},
        preserve: "existing",
        trigger: "stored",
      });
    });

    it("keeps context merge and deletion values opaque in Redis Lua", async () => {
      const runId = "run-deep-context-lua-opaque";
      let deep: unknown = { leaf: true };
      for (let index = 0; index < MAX_TRAVERSAL_DEPTH + 25; index++) {
        deep = { nested: deep };
      }
      await backend.createRun(createTestRun(runId));

      await backend.updateRun(runId, {
        context: { input: {}, removed: "stale", deep },
        contextDeletes: ["removed"],
      });

      assertEquals((await backend.getRun(runId))?.context.removed, undefined);
      assertStringIncludes(
        mockRedis.lastScript,
        "redis.call('hset', KEYS[1], 'context', deleteJsonObjectFields(current, value, true))",
        "context deletion must not cjson-decode the stored context document",
      );
      assertStringIncludes(
        mockRedis.lastScript,
        "redis.call('hset', KEYS[1], 'context', mergeJsonObjects(current, value, true))",
        "context merge must not cjson-decode the stored context document",
      );

      await backend.updateRunIfStatus(runId, ["pending"], {
        context: { input: {}, kept: true },
        contextDeletes: ["deep"],
      });

      assertStringIncludes(
        mockRedis.lastScript,
        "redis.call('hset', KEYS[1], 'context', deleteJsonObjectFields(current, value, true))",
        "conditional context deletion must not cjson-decode the stored context document",
      );
      assertStringIncludes(
        mockRedis.lastScript,
        "redis.call('hset', KEYS[1], 'context', mergeJsonObjects(current, value, true))",
        "conditional context merge must not cjson-decode the stored context document",
      );
      assertStringIncludes(
        mockRedis.lastScript,
        "redis.call('hset', KEYS[1], 'nodeStates', deleteJsonObjectFields(current, value, true))",
        "node-state deletion must not cjson-reencode retained numeric outputs",
      );
      assertStringIncludes(
        mockRedis.lastScript,
        "redis.call('hset', KEYS[1], field, mergeJsonObjects(current, value, true))",
        "node-state merge must not cjson-reencode numeric outputs",
      );
    });

    it("preserves strict context key order when patching top-level context", async () => {
      const strictBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "strict-order-patch:",
        strictContext: true,
      });
      const runId = "run-strict-context-order-patch";
      await strictBackend.createRun(createTestRun(runId, {
        context: { input: {}, alpha: 1, beta: 2, gamma: 3 },
      }));

      await strictBackend.updateRun(runId, {
        context: { beta: "patched", delta: 4 },
      });

      const storedContext = mockRedis.hashes
        .get(`strict-order-patch:schema-v1:run:${runId}`)
        ?.get("context");
      assertEquals(
        storedContext,
        '{"input":{},"alpha":1,"beta":"patched","gamma":3,"delta":4}',
      );
      assertStringIncludes(
        mockRedis.lastScript,
        "fields.entries",
        "raw Lua context merges must preserve parsed object entry order",
      );
      assertEquals(
        mockRedis.lastScript.includes("for key, value in pairs(fields) do"),
        false,
        "raw Lua context encoding must not depend on unordered pairs iteration",
      );
    });

    it("preserves strict context key order when deleting top-level context keys", async () => {
      const strictBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "strict-order-delete:",
        strictContext: true,
      });
      const runId = "run-strict-context-order-delete";
      await strictBackend.createRun(createTestRun(runId, {
        context: { input: {}, alpha: 1, beta: 2, gamma: 3, delta: 4 },
      }));

      await strictBackend.updateRun(runId, {
        contextDeletes: ["beta"],
        context: { epsilon: 5 },
      });

      const storedContext = mockRedis.hashes
        .get(`strict-order-delete:schema-v1:run:${runId}`)
        ?.get("context");
      assertEquals(
        storedContext,
        '{"input":{},"alpha":1,"gamma":3,"delta":4,"epsilon":5}',
      );
      assertStringIncludes(
        mockRedis.lastScript,
        "deleteJsonObjectField",
        "raw Lua context deletions must remove entries without reordering survivors",
      );
    });

    it("preserves empty arrays in context and node-state merge patches", async () => {
      await backend.createRun(createTestRun("run-empty-array-patches"));

      await backend.updateRun("run-empty-array-patches", {
        context: { input: { tags: [] }, result: [] },
        nodeStates: {
          step: {
            nodeId: "step",
            status: "completed",
            attempt: 1,
            output: [],
          },
        },
      });

      const updated = await backend.getRun("run-empty-array-patches");
      assertEquals(updated?.context, { input: { tags: [] }, result: [] });
      assertEquals(updated?.nodeStates.step?.output, []);
      assertStringIncludes(mockRedis.lastScript, "parseJsonObject");
      assertEquals(mockRedis.lastScript.includes("decode_array_with_array_mt"), false);
    });

    it("applies explicit context deletions without replacing concurrent keys", async () => {
      await backend.createRun(createTestRun("run-context-delete"));
      await backend.updateRun("run-context-delete", {
        context: { input: { topic: "test" }, removed: "stale", concurrent: "preserve" },
      });

      await backend.updateRun(
        "run-context-delete",
        {
          context: { input: { topic: "test" }, kept: "updated" },
          contextDeletes: ["removed"],
        } as Parameters<typeof backend.updateRun>[1],
      );

      assertEquals((await backend.getRun("run-context-delete"))?.context, {
        input: { topic: "test" },
        concurrent: "preserve",
        kept: "updated",
      });
      assertStringIncludes(
        mockRedis.lastScript,
        "field == 'contextDeletes'",
        "the Lua patch must apply deletions atomically with context key merges",
      );
    });

    it("applies explicit node-state deletions without replacing concurrent keys", async () => {
      await backend.createRun(createTestRun("run-node-state-delete"));
      await backend.updateRun("run-node-state-delete", {
        nodeStates: {
          removed: { nodeId: "removed", status: "completed", attempt: 1 },
          concurrent: { nodeId: "concurrent", status: "completed", attempt: 1 },
        },
      });

      await backend.updateRun("run-node-state-delete", {
        nodeStates: {
          kept: { nodeId: "kept", status: "completed", attempt: 1 },
        },
        nodeStateDeletes: ["removed"],
      });

      assertEquals((await backend.getRun("run-node-state-delete"))?.nodeStates, {
        concurrent: { nodeId: "concurrent", status: "completed", attempt: 1 },
        kept: { nodeId: "kept", status: "completed", attempt: 1 },
      });
      assertStringIncludes(
        mockRedis.lastScript,
        "field == 'nodeStateDeletes'",
        "the Lua patch must apply deletions atomically with node-state key merges",
      );
    });

    it("omits empty deletion patches and decodes non-empty deletion lists on Redis 7", async () => {
      await backend.createRun(createTestRun("run-empty-deletes"));

      await backend.updateRun("run-empty-deletes", {
        nodeStateDeletes: [],
        contextDeletes: [],
      });

      assertEquals(mockRedis.lastArgs.includes("nodeStateDeletes"), false);
      assertEquals(mockRedis.lastArgs.includes("contextDeletes"), false);
      assertStringIncludes(
        mockRedis.lastScript,
        "local deleted = cjson.decode(deletedJson)",
        "known string-list deletion fields must not require Redis 8.4 array metadata",
      );
    });

    it("replaces context and node states wholesale on a snapshot restore", async () => {
      const runId = "run-snapshot-restore";
      await backend.createRun(createTestRun(runId));
      // State accumulated AFTER the checkpoint being restored: the merge path
      // would retain these keys and let the completed later node be skipped.
      await backend.updateRun(runId, {
        status: "waiting",
        context: { input: { topic: "test" }, early: "kept", late: "post-checkpoint" },
        nodeStates: {
          early: { nodeId: "early", status: "completed", attempt: 1 },
          late: { nodeId: "late", status: "completed", attempt: 1 },
        },
      });

      assertEquals(
        await backend.restoreRunStateIfStatus(runId, ["waiting"], {
          status: "running",
          context: { input: { topic: "test" }, early: "kept" },
          nodeStates: { early: { nodeId: "early", status: "completed", attempt: 1 } },
        }),
        true,
      );

      const restored = await backend.getRun(runId);
      assertEquals(restored?.status, "running");
      assertEquals(
        restored?.context,
        { input: { topic: "test" }, early: "kept" },
        "a snapshot restore must drop context keys written after the checkpoint",
      );
      assertEquals(
        restored?.nodeStates,
        { early: { nodeId: "early", status: "completed", attempt: 1 } },
        "a node completed after the checkpoint must not survive the restore, " +
          "or replay skips it instead of re-running it",
      );

      // The replace flag must sit at the fixed ARGV slot the Lua reads, and
      // the script must branch on it rather than always merging.
      const restoreCall = mockRedis.scriptCalls.findLast(({ script }) =>
        script.includes("conditional-run-update")
      )!;
      assertStringIncludes(
        restoreCall.script,
        "local replaceMaps = ARGV[expectedCount + 8] == '1'",
        "the replacement flag must live in the Lua the backend executes, not only in the mock",
      );
      const restoreArgvCount = Number(restoreCall.args[0]);
      assertEquals(
        restoreCall.args[restoreArgvCount + 7],
        "1",
        "the snapshot restore must set the replace-maps flag at the ARGV index the Lua reads",
      );

      // The plain conditional patch keeps the merge flag off.
      await backend.updateRunIfStatus(runId, ["running"], {
        nodeStates: { late: { nodeId: "late", status: "running", attempt: 1 } },
      });
      const patchArgvCount = Number(mockRedis.lastArgs[0]);
      assertEquals(mockRedis.lastArgs[patchArgvCount + 7], "0");
      assertEquals(
        (await backend.getRun(runId))?.nodeStates.early?.status,
        "completed",
        "a plain conditional patch must keep merging by key",
      );
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
        "context.step.<redacted>",
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

      assertStringIncludes(
        mockRedis.lastScript,
        "redis.call('hget', KEYS[1], 'workerId') ~= expectedWorkerId",
        "the owner fence must live in the Lua the backend executes, not only in the mock",
      );
      const ownerFenceArgvCount = Number(mockRedis.lastArgs[0]);
      assertEquals(
        mockRedis.lastArgs[ownerFenceArgvCount + 4],
        "worker-old",
        "the expected workerId must sit at the ARGV index the Lua fence reads",
      );

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

    it("checks stale conditional preconditions before surfacing strict serialization errors", async () => {
      const strictBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "strict-cas:",
        strictContext: true,
      });
      const runId = "run-strict-stale-cas";
      await strictBackend.createRun(createTestRun(runId, {
        status: "running",
        workerId: "worker-new",
      }));
      const lossyPatch = {
        context: { input: {}, step: { when: new Date(0) } },
      };

      assertEquals(
        await strictBackend.updateRunIfStatus(runId, ["pending"], lossyPatch),
        false,
      );
      assertEquals(
        await strictBackend.updateRunIfStatusAndWorker(
          runId,
          ["running"],
          "worker-old",
          lossyPatch,
        ),
        false,
      );
      assertEquals(
        await strictBackend.restoreRunStateIfStatus(
          runId,
          ["pending"],
          { ...lossyPatch, nodeStates: {} },
          "worker-new",
        ),
        false,
      );
      await assertRejects(
        () => strictBackend.updateRunIfStatus(runId, ["running"], lossyPatch),
        Error,
        "strictContext",
      );
      assertEquals((await strictBackend.getRun(runId))?.context.step, undefined);
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

    it("fences terminal retention against a reactivated failed run", async () => {
      const completedAt = new Date("2026-01-01T00:00:00Z");
      const retained = {
        ...createTestRun("run-retention-race"),
        status: "failed",
        completedAt,
      } as const;
      await backend.createRun(retained);
      await backend.updateRun("run-retention-race", {
        status: "pending",
        completedAt: undefined,
      });

      assertEquals(
        await backend.deleteTerminalRunIfUnchanged({
          runId: "run-retention-race",
          workflowId: "wf-1",
          createdAt: retained.createdAt,
          status: "failed",
          completedAt,
          revision: 0,
        }),
        false,
      );
      assertStringIncludes(mockRedis.lastScript, "createdAt ~= ARGV[3]");
      assertStringIncludes(mockRedis.lastScript, "completedAt ~= ARGV[4]");
      assertEquals(mockRedis.lastArgs, [
        "failed",
        "wf-1",
        retained.createdAt.toISOString(),
        completedAt.toISOString(),
        "0",
        "run-retention-race",
        "test:group:schema-v1",
      ]);
      assertEquals((await backend.getRun("run-retention-race"))?.status, "pending");
    });

    it("atomically removes terminal state, locks, and every shared index membership", async () => {
      const runId = "run-retention-delete";
      const completedAt = new Date("2026-01-01T00:00:00Z");
      await backend.createRun({ ...createTestRun(runId), status: "failed", completedAt });
      await backend.saveCheckpoint(runId, {
        id: "checkpoint",
        nodeId: "gate",
        timestamp: completedAt,
        context: { input: {} },
        nodeStates: {},
      });
      await backend.savePendingApproval(runId, {
        id: "approval",
        nodeId: "gate",
        status: "pending",
        message: "Continue?",
        requestedAt: completedAt,
      });
      await backend.enqueue({
        runId,
        workflowId: "wf-1",
        input: {},
        createdAt: completedAt,
      });
      await backend.dequeue();
      await backend.enqueue({
        runId,
        workflowId: "wf-1",
        input: { retry: true },
        createdAt: completedAt,
      });
      await backend.acquireLock(runId, 60_000);
      mockRedis.store.set(`test:schema-v1:claim:${runId}`, "worker");

      const candidate = {
        runId,
        workflowId: "wf-1",
        createdAt: (await backend.getRun(runId))!.createdAt,
        status: "failed" as const,
        completedAt,
        revision: Number(
          mockRedis.hashes.get(`test:schema-v1:run:${runId}`)?.get(
            "__runRetentionRevision",
          ) ?? "0",
        ),
      };
      assertEquals(await backend.deleteTerminalRunIfUnchanged(candidate), true);
      assertEquals(mockRedis.lastKeys, [
        `test:schema-v1:run:${runId}`,
        `test:schema-v1:checkpoints:${runId}`,
        `test:schema-v1:approvals:${runId}`,
        `test:schema-v1:claim:${runId}`,
        `test:schema-v1:run-observation:${runId}`,
        `test:schema-v1:run-observation-approvals-v1:${runId}`,
        `test:schema-v1:lock:${runId}`,
        "test:schema-v1:index:runs",
        "test:schema-v1:index:workflow:wf-1",
        "test:schema-v1:index:status:pending",
        "test:schema-v1:index:status:running",
        "test:schema-v1:index:status:waiting",
        "test:schema-v1:index:status:completed",
        "test:schema-v1:index:status:failed",
        "test:schema-v1:index:status:cancelled",
        "test:schema-v1:index:terminal-completed-at",
        "test:schema-v1:index:terminal-completed-at-members",
        `test:schema-v1:queue-messages:${runId}`,
        "test:stream:schema-v1",
      ]);
      assertStringIncludes(mockRedis.lastScript, "for index = 1, 7");
      assertStringIncludes(mockRedis.lastScript, "for index = 8, 15");
      assertStringIncludes(mockRedis.lastScript, "redis.call('zrem', KEYS[16]");
      assertStringIncludes(mockRedis.lastScript, "redis.pcall('xack', KEYS[19]");
      assertStringIncludes(mockRedis.lastScript, "redis.call('xdel', KEYS[19]");
      assertEquals(await backend.deleteTerminalRunIfUnchanged(candidate), false);
      assertEquals(await backend.getRun(runId), null);
      assertEquals(await backend.getCheckpoints(runId), []);
      assertEquals(await backend.getPendingApprovals(runId), []);
      assertEquals(mockRedis.store.has(`test:schema-v1:lock:${runId}`), false);
      assertEquals(mockRedis.store.has(`test:schema-v1:claim:${runId}`), false);
      assertEquals(mockRedis.streams.has(`test:schema-v1:run-observation:${runId}`), false);
      assertEquals(mockRedis.sets.has(`test:schema-v1:queue-messages:${runId}`), false);
      assertEquals(mockRedis.streams.get("test:stream:schema-v1"), []);
      assertEquals(mockRedis.queueCleanupAcks.length, 2);
      assertEquals(
        mockRedis.hashes.has(`test:schema-v1:run-observation-approvals-v1:${runId}`),
        false,
      );
      assertEquals(
        [...mockRedis.sets.values()].some((members) => members.has(runId)),
        false,
      );
    });

    it("backfills and removes queue entries written before the side index existed", async () => {
      const runId = "run-retention-legacy-queue";
      const completedAt = new Date(2);
      await backend.createRun({
        ...createTestRun(runId),
        status: "cancelled",
        completedAt,
      });
      await mockRedis.xadd("test:stream:schema-v1", "*", {
        runId,
        workflowId: "wf-1",
        input: "{}",
        priority: "0",
        createdAt: completedAt.toISOString(),
      });
      assertEquals(mockRedis.sets.has(`test:schema-v1:queue-messages:${runId}`), false);

      let candidate: TerminalRunRetentionCandidate | undefined;
      for (let page = 0; page < 10 && candidate === undefined; page++) {
        candidate = (await backend.listTerminalRunRetentionCandidates(new Date(10), 2))
          .candidates[0];
      }
      assertEquals(candidate?.runId, runId);
      assertEquals(await backend.deleteTerminalRunIfUnchanged(candidate!), true);
      assertEquals(mockRedis.streams.get("test:stream:schema-v1"), []);
      assertEquals(mockRedis.sets.has(`test:schema-v1:queue-messages:${runId}`), false);
    });

    it("cleans queued terminal state before its consumer group exists", async () => {
      const runId = "run-retention-no-consumer-group";
      await backend.createRun({
        ...createTestRun(runId),
        status: "cancelled",
        completedAt: new Date(2),
      });
      await backend.enqueue({
        runId,
        workflowId: "wf-1",
        input: {},
        createdAt: new Date(1),
      });
      mockRedis.queueConsumerGroupMissing = true;
      const candidate = (await backend.listTerminalRunRetentionCandidates(new Date(10), 2))
        .candidates[0]!;

      assertEquals(await backend.deleteTerminalRunIfUnchanged(candidate), true);
      assertEquals(mockRedis.queueConsumerGroupMissingAckAttempts, 1);
      assertEquals(mockRedis.streams.get("test:stream:schema-v1"), []);
      assertEquals(mockRedis.sets.has(`test:schema-v1:queue-messages:${runId}`), false);
    });

    it("finishes cleanup if the old TTL removed the run hash first", async () => {
      const runId = "run-retention-partial";
      const completedAt = new Date("2026-01-01T00:00:00Z");
      const retained = { ...createTestRun(runId), status: "completed", completedAt } as const;
      await backend.createRun(retained);
      await backend.saveCheckpoint(runId, {
        id: "checkpoint",
        nodeId: "done",
        timestamp: completedAt,
        context: { input: {} },
        nodeStates: {},
      });
      mockRedis.hashes.delete(`test:schema-v1:run:${runId}`);

      const candidate = (await backend.listTerminalRunRetentionCandidates(
        new Date("2027-01-01T00:00:00Z"),
        1,
      )).candidates[0];
      assertEquals(candidate?.runId, runId);
      assertEquals(
        await backend.deleteTerminalRunIfUnchanged(candidate!),
        true,
      );
      assertEquals(mockRedis.lists.has(`test:schema-v1:checkpoints:${runId}`), false);
      assertEquals(
        [...mockRedis.sets.values()].some((members) => members.has(runId)),
        false,
      );
    });

    it("does not delete a later run that reused a retained run id", async () => {
      const runId = "run-retention-reused-id";
      const completedAt = new Date("2026-01-01T00:00:00Z");
      const original = {
        ...createTestRun(runId),
        status: "completed",
        completedAt,
      } as const;
      await backend.createRun(original);
      await backend.deleteRun(runId);
      const replacement = {
        ...createTestRun(runId),
        createdAt: new Date(original.createdAt.getTime() + 1),
        status: "completed",
        completedAt,
      } as const;
      await backend.createRun(replacement);

      assertEquals(
        await backend.deleteTerminalRunIfUnchanged({
          runId,
          workflowId: "wf-1",
          createdAt: original.createdAt,
          status: "completed",
          completedAt,
          revision: 0,
        }),
        false,
      );
      assertEquals((await backend.getRun(runId))?.createdAt, replacement.createdAt);
    });

    it("returns false for an invalid terminal deletion timestamp", async () => {
      const runId = "run-retention-invalid-date";
      const retained = {
        ...createTestRun(runId),
        status: "completed",
        completedAt: new Date(2),
      } as const;
      await backend.createRun(retained);

      assertEquals(
        await backend.deleteTerminalRunIfUnchanged({
          runId,
          workflowId: retained.workflowId,
          createdAt: undefined as unknown as Date,
          status: "completed",
          completedAt: retained.completedAt,
          revision: 0,
        }),
        false,
      );
      assertEquals((await backend.getRun(runId))?.status, "completed");
    });

    it("returns a bounded oldest-first terminal retention batch", async () => {
      for (
        const [runId, status, completedAt] of [
          ["retention-oldest", "completed", new Date(1)],
          ["retention-middle", "failed", new Date(2)],
          ["retention-newest", "cancelled", new Date(3)],
          ["retention-active", "waiting", undefined],
        ] as const
      ) {
        await backend.createRun({
          ...createTestRun(runId),
          status,
          completedAt,
        });
      }

      const readsBefore = mockRedis.hgetallCallCount;
      let batch = await backend.listTerminalRunRetentionCandidates(new Date(10), 2);
      for (let page = 0; page < 10 && batch.candidates.length === 0; page++) {
        batch = await backend.listTerminalRunRetentionCandidates(new Date(10), 2);
      }

      assertEquals(batch.hasMore, true);
      assertEquals(batch.candidates.map(({ runId }) => runId), [
        "retention-oldest",
        "retention-middle",
      ]);
      assertEquals(
        batch.candidates.every((candidate) => Object.keys(candidate).length === 6),
        true,
      );
      assertEquals(mockRedis.hgetallCallCount, readsBefore);
      assertStringIncludes(mockRedis.lastScript, "zrangebyscore");
      assertEquals(mockRedis.lastArgs[1], "3");
    });

    it("orders retention candidates by timestamp across extended ISO years", async () => {
      await backend.createRun({
        ...createTestRun("retention-normal-year"),
        status: "completed",
        completedAt: new Date("2026-01-01T00:00:00Z"),
      });
      await backend.createRun({
        ...createTestRun("retention-extended-year"),
        status: "completed",
        completedAt: new Date(Date.UTC(10_000, 0, 1)),
      });

      const batch = await backend.listTerminalRunRetentionCandidates(
        new Date("2027-01-01T00:00:00Z"),
        2,
      );

      assertEquals(batch.candidates.map((candidate) => candidate.runId), [
        "retention-normal-year",
      ]);
    });

    it("persists a retention revision while backfilling a pre-existing terminal run", async () => {
      const runId = "retention-legacy-missing-revision";
      await backend.createRun({
        ...createTestRun(runId),
        status: "completed",
        completedAt: new Date(2),
      });
      const hash = mockRedis.hashes.get(`test:schema-v1:run:${runId}`)!;
      hash.delete("__runRetentionRevision");
      mockRedis.sortedSets.delete("test:schema-v1:index:terminal-completed-at");
      mockRedis.hashes.delete("test:schema-v1:index:terminal-completed-at-members");

      let batch = await backend.listTerminalRunRetentionCandidates(new Date(10), 1);
      for (let page = 0; page < 10 && batch.candidates.length === 0; page++) {
        batch = await backend.listTerminalRunRetentionCandidates(new Date(10), 1);
      }

      assertEquals(batch.candidates.map((candidate) => candidate.runId), [runId]);
      assertEquals(hash.get("__runRetentionRevision"), "0");
    });

    it("repairs a completion score changed by a rolling-upgrade writer", async () => {
      const runId = "retention-legacy-retry-score";
      await backend.createRun({
        ...createTestRun(runId),
        status: "failed",
        completedAt: new Date(2),
      });
      const hash = mockRedis.hashes.get(`test:schema-v1:run:${runId}`)!;
      hash.set("completedAt", new Date(20).toISOString());
      hash.set("__runObservationRevision", "1");
      hash.set("__runRetentionRevision", "1");

      const batch = await backend.listTerminalRunRetentionCandidates(new Date(10), 1);

      assertEquals(batch.candidates, []);
      assertEquals(hash.get("__terminalCompletedAtMs"), "20");
    });

    it("fences retention against a same-status patch after discovery", async () => {
      const runId = "retention-late-patch";
      await backend.createRun({
        ...createTestRun(runId),
        status: "failed",
        completedAt: new Date(2),
      });
      const candidate = (await backend.listTerminalRunRetentionCandidates(
        new Date(10),
        1,
      )).candidates[0]!;

      await backend.updateRun(runId, { error: { message: "Late diagnostic" } });

      assertEquals(await backend.deleteTerminalRunIfUnchanged(candidate), false);
      assertEquals((await backend.getRun(runId))?.error?.message, "Late diagnostic");
    });

    it("fences retention against an approval decision after discovery", async () => {
      const runId = "retention-approval-decision";
      await backend.createRun({
        ...createTestRun(runId),
        status: "failed",
        completedAt: new Date(2),
      });
      await backend.savePendingApproval(runId, {
        id: "approval",
        nodeId: "gate",
        status: "pending",
        message: "Continue?",
        requestedAt: new Date(1),
      });
      const candidate = (await backend.listTerminalRunRetentionCandidates(new Date(10), 1))
        .candidates[0]!;

      assertEquals(
        await backend.updateApproval(runId, "approval", {
          approved: true,
          approver: "operator",
        }),
        true,
      );

      assertEquals(await backend.deleteTerminalRunIfUnchanged(candidate), false);
      assertEquals((await backend.getRun(runId))?.status, "failed");
      assertEquals((await backend.getPendingApprovals(runId)).length, 0);
    });

    it("keeps orphan metadata fenced after an approval decision", async () => {
      const runId = "retention-orphan-approval-decision";
      await backend.createRun({
        ...createTestRun(runId),
        status: "failed",
        completedAt: new Date(2),
      });
      await backend.savePendingApproval(runId, {
        id: "approval",
        nodeId: "gate",
        status: "pending",
        message: "Continue?",
        requestedAt: new Date(1),
      });
      const candidate = (await backend.listTerminalRunRetentionCandidates(new Date(10), 1))
        .candidates[0]!;

      assertEquals(
        await backend.updateApproval(runId, "approval", {
          approved: true,
          approver: "operator",
        }),
        true,
      );
      mockRedis.hashes.delete(`test:schema-v1:run:${runId}`);

      assertEquals(await backend.deleteTerminalRunIfUnchanged(candidate), false);
      assertEquals(mockRedis.lists.has(`test:schema-v1:approvals:${runId}`), true);
    });

    it("keeps orphan metadata fenced after an approval metadata patch", async () => {
      const runId = "retention-orphan-approval-patch";
      await backend.createRun({
        ...createTestRun(runId),
        status: "failed",
        completedAt: new Date(2),
      });
      await backend.savePendingApproval(runId, {
        id: "approval",
        nodeId: "gate",
        status: "pending",
        message: "Continue?",
        requestedAt: new Date(1),
      });
      const candidate = (await backend.listTerminalRunRetentionCandidates(new Date(10), 1))
        .candidates[0]!;

      await backend.updatePendingApproval(runId, "approval", {
        notificationError: "late delivery failure",
      });
      mockRedis.hashes.delete(`test:schema-v1:run:${runId}`);

      assertEquals(await backend.deleteTerminalRunIfUnchanged(candidate), false);
      assertEquals(mockRedis.lists.has(`test:schema-v1:approvals:${runId}`), true);
    });

    it("fences retention against a checkpoint appended after discovery", async () => {
      const runId = "retention-late-checkpoint";
      await backend.createRun({
        ...createTestRun(runId),
        status: "failed",
        completedAt: new Date(2),
      });
      const candidate = (await backend.listTerminalRunRetentionCandidates(new Date(10), 1))
        .candidates[0]!;

      await backend.saveCheckpoint(runId, {
        id: "late-checkpoint",
        nodeId: "retry",
        timestamp: new Date(3),
        context: { input: {} },
        nodeStates: {},
      });

      assertEquals(await backend.deleteTerminalRunIfUnchanged(candidate), false);
      assertEquals((await backend.getLatestCheckpoint(runId))?.id, "late-checkpoint");
    });

    it("fences retention against a retry enqueued after discovery", async () => {
      const runId = "retention-late-retry";
      await backend.createRun({
        ...createTestRun(runId),
        status: "failed",
        completedAt: new Date(2),
      });
      const candidate = (await backend.listTerminalRunRetentionCandidates(new Date(10), 1))
        .candidates[0]!;

      await backend.enqueue({
        runId,
        workflowId: "wf-1",
        input: {},
        createdAt: new Date(3),
      });

      assertEquals(await backend.deleteTerminalRunIfUnchanged(candidate), false);
      assertEquals(mockRedis.streams.get("test:stream:schema-v1")?.length, 1);
    });

    it("indexes terminal transitions and removes a retried run", async () => {
      const runId = "retention-transition";
      const completedAt = new Date(2);
      await backend.createRun(createTestRun(runId));
      const scriptCallsBefore = mockRedis.scriptCalls.length;
      await backend.updateRun(runId, { status: "failed", completedAt });
      assertEquals(mockRedis.scriptCalls.length, scriptCallsBefore + 1);
      assertStringIncludes(mockRedis.lastScript, "observable-run-update");
      assertStringIncludes(mockRedis.lastScript, "updateTerminalRetentionIndex");
      assertStringIncludes(mockRedis.lastScript, "redis.call('zadd', indexKey");

      assertEquals(
        (await backend.listTerminalRunRetentionCandidates(new Date(10), 1)).candidates.map(
          (candidate) => candidate.runId,
        ),
        [runId],
      );

      await backend.updateRun(runId, { status: "pending", completedAt: undefined });
      assertStringIncludes(mockRedis.lastScript, "redis.call('zrem', indexKey");
      assertEquals(
        (await backend.listTerminalRunRetentionCandidates(new Date(10), 1)).candidates,
        [],
      );
    });

    it("updates the retention index inside a conditional run mutation", async () => {
      const runId = "retention-conditional-transition";
      await backend.createRun(createTestRun(runId));
      const scriptCallsBefore = mockRedis.scriptCalls.length;

      assertEquals(
        await backend.updateRunIfStatus(runId, ["pending"], {
          status: "failed",
          completedAt: new Date(2),
        }),
        true,
      );

      assertEquals(mockRedis.scriptCalls.length, scriptCallsBefore + 1);
      assertStringIncludes(mockRedis.lastScript, "conditional-run-update");
      assertStringIncludes(mockRedis.lastScript, "redis.call('zadd', indexKey");
    });

    it("indexes a terminal status patched after its completion time", async () => {
      const runId = "retention-split-terminal-patch";
      const completedAt = new Date(2);
      await backend.createRun(createTestRun(runId));

      await backend.updateRun(runId, { completedAt });
      await backend.updateRun(runId, { status: "failed" });
      assertStringIncludes(mockRedis.lastScript, "redis.call('zadd', indexKey");

      assertEquals(
        (await backend.listTerminalRunRetentionCandidates(new Date(10), 1)).candidates.map(
          (candidate) => candidate.runId,
        ),
        [runId],
      );
    });

    it("finishes bounded backfill before returning globally oldest candidates", async () => {
      const newerRunId = "retention-backfill-newer";
      const olderRunId = "retention-backfill-older";
      await backend.createRun({
        ...createTestRun(newerRunId),
        status: "completed",
        completedAt: new Date(3),
      });
      await backend.createRun({
        ...createTestRun(olderRunId),
        status: "completed",
        completedAt: new Date(2),
      });
      mockRedis.sortedSets.clear();
      mockRedis.hashes.delete("test:schema-v1:index:terminal-completed-at-members");
      mockRedis.store.delete("test:schema-v1:index:terminal-completed-at-backfill-v1");
      mockRedis.scanPageSize = 1;
      const reader = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "test:",
      });

      const partial = await reader.listTerminalRunRetentionCandidates(new Date(10), 1);
      assertEquals(partial, { candidates: [], hasMore: true });

      const complete = await reader.listTerminalRunRetentionCandidates(new Date(10), 1);
      assertEquals(complete.candidates.map((candidate) => candidate.runId), [olderRunId]);
      assertEquals(complete.hasMore, true);
    });

    it("continues bounded backfill for terminal writes from rolling-upgrade workers", async () => {
      const initialRunId = "retention-backfill-initial";
      await backend.createRun({
        ...createTestRun(initialRunId),
        status: "completed",
        completedAt: new Date(3),
      });
      mockRedis.sortedSets.clear();
      mockRedis.hashes.delete("test:schema-v1:index:terminal-completed-at-members");
      mockRedis.scanPageSize = 1;
      const reader = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "test:",
      });
      await reader.listTerminalRunRetentionCandidates(new Date(10), 1);

      const legacyRunId = "retention-backfill-legacy-writer";
      await backend.createRun({
        ...createTestRun(legacyRunId),
        status: "completed",
        completedAt: new Date(2),
      });
      const retentionMembers = mockRedis.hashes.get(
        "test:schema-v1:index:terminal-completed-at-members",
      )!;
      const legacyMetadata = JSON.parse(retentionMembers.get(legacyRunId)!) as {
        member: string;
      };
      retentionMembers.delete(legacyRunId);
      mockRedis.sortedSets.get("test:schema-v1:index:terminal-completed-at")?.delete(
        legacyMetadata.member,
      );

      let found = false;
      for (let page = 0; page < 20 && !found; page++) {
        const batch = await reader.listTerminalRunRetentionCandidates(new Date(10), 1);
        found = batch.candidates.some((candidate) => candidate.runId === legacyRunId);
      }
      assertEquals(found, true);
    });

    it("bounds queue repair at a fixed stream high-water mark", async () => {
      const runId = "retention-busy-queue";
      await backend.createRun({
        ...createTestRun(runId),
        status: "completed",
        completedAt: new Date(2),
      });
      await mockRedis.xadd("test:stream:schema-v1", "*", {
        runId: "legacy-unrelated",
        workflowId: "wf-1",
        input: "{}",
        priority: "0",
        createdAt: new Date(1).toISOString(),
      });

      let candidate: TerminalRunRetentionCandidate | undefined;
      for (let attempt = 0; attempt < 10 && candidate === undefined; attempt++) {
        candidate = (await backend.listTerminalRunRetentionCandidates(new Date(10), 1))
          .candidates[0];
        await mockRedis.xadd("test:stream:schema-v1", "*", {
          runId: `current-${attempt}`,
          workflowId: "wf-1",
          input: "{}",
          priority: "0",
          createdAt: new Date(1).toISOString(),
        });
      }

      assertEquals(candidate?.runId, runId);
    });

    it("coalesces concurrent retention repair on one backend instance", async () => {
      let releaseScan!: () => void;
      mockRedis.scanGate = new Promise<void>((resolve) => {
        releaseScan = resolve;
      });
      let reportScanStarted!: () => void;
      const scanStarted = new Promise<void>((resolve) => {
        reportScanStarted = resolve;
      });
      mockRedis.onScan = reportScanStarted;

      const first = backend.listTerminalRunRetentionCandidates(new Date(10), 1);
      await scanStarted;
      const second = backend.listTerminalRunRetentionCandidates(new Date(10), 1);
      const scansBeforeRelease = mockRedis.scanCalls.length;
      releaseScan();

      const [firstBatch, secondBatch] = await Promise.all([first, second]);
      assertEquals(scansBeforeRelease, 1);
      assertEquals(firstBatch, secondBatch);
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
        "checkpoint.context.step.<redacted>",
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

    it("saves checkpoint state deeper than native JSON can traverse", async () => {
      const runId = "run-cp-deep-context";
      let deep: unknown = { leaf: true };
      for (let index = 0; index < MAX_TRAVERSAL_DEPTH + 7_000; index++) {
        deep = { nested: deep };
      }

      await backend.saveCheckpoint(runId, {
        id: "cp-deep-context",
        nodeId: "step",
        timestamp: new Date("2025-01-01T01:00:00Z"),
        context: { input: {}, step: deep },
        nodeStates: {
          step: {
            nodeId: "step",
            status: "completed",
            attempt: 1,
            output: deep,
          },
        },
        _resumeEnvelope: {
          schemaVersion: 2,
          ownerNodeId: "step",
          context: { input: {}, step: deep },
          nodeStates: {
            step: {
              nodeId: "step",
              status: "completed",
              attempt: 1,
              output: deep,
            },
          },
          workflowProjection: { context: {} },
          graphAdmission: {
            stepsEvaluationContext: { input: {}, step: deep },
            stepsEvaluationProjection: { context: {} },
            graphIdentity: [],
            workflowVersion: null,
          },
        } satisfies CheckpointResumeEnvelope,
      });

      const checkpoint = await backend.getLatestCheckpoint(runId);
      assertEquals(checkpoint?.id, "cp-deep-context");
      let restored = checkpoint?.context.step;
      for (let index = 0; index < MAX_TRAVERSAL_DEPTH + 7_000; index++) {
        restored = (restored as { nested: unknown }).nested;
      }
      assertEquals(restored, { leaf: true });
      let restoredOutput = checkpoint?.nodeStates.step?.output;
      for (let index = 0; index < MAX_TRAVERSAL_DEPTH + 7_000; index++) {
        restoredOutput = (restoredOutput as { nested: unknown }).nested;
      }
      assertEquals(restoredOutput, { leaf: true });
      let restoredEnvelopeContext = checkpoint?._resumeEnvelope?.context.step;
      for (let index = 0; index < MAX_TRAVERSAL_DEPTH + 7_000; index++) {
        restoredEnvelopeContext = (restoredEnvelopeContext as { nested: unknown }).nested;
      }
      assertEquals(restoredEnvelopeContext, { leaf: true });
      let restoredAdmissionContext = checkpoint?._resumeEnvelope?.graphAdmission
        .stepsEvaluationContext.step;
      for (let index = 0; index < MAX_TRAVERSAL_DEPTH + 7_000; index++) {
        restoredAdmissionContext = (restoredAdmissionContext as { nested: unknown }).nested;
      }
      assertEquals(restoredAdmissionContext, { leaf: true });
    });

    it("keeps framework node timestamps outside strict context validation", async () => {
      const strictBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "strict-checkpoint:",
        strictContext: true,
      });
      const timestamp = new Date("2025-01-01T01:00:00Z");
      const warnings: LogEntry[] = [];
      const unsubscribe = __subscribeLogRecordEmitter((entry) => {
        if (entry.level === "warn" && entry.component === "workflow-context") {
          warnings.push(entry);
        }
      });

      try {
        await strictBackend.saveCheckpoint("run-cp-strict-node-dates", {
          id: "cp-strict-node-dates",
          nodeId: "step",
          timestamp,
          context: { input: {}, step: { saved: true } },
          nodeStates: {
            step: {
              nodeId: "step",
              status: "completed",
              attempt: 1,
              startedAt: timestamp,
              completedAt: timestamp,
            },
          },
          _resumeEnvelope: {
            schemaVersion: 2,
            ownerNodeId: "step",
            context: { input: {}, step: { saved: true } },
            nodeStates: {
              step: {
                nodeId: "step",
                status: "completed",
                attempt: 1,
                startedAt: timestamp,
                completedAt: timestamp,
              },
            },
            workflowProjection: { context: {} },
            graphAdmission: {
              stepsEvaluationContext: { input: {}, step: { saved: true } },
              stepsEvaluationProjection: { context: {} },
              graphIdentity: [],
              workflowVersion: null,
            },
          },
        });
      } finally {
        unsubscribe();
      }

      assertEquals(
        (await strictBackend.getLatestCheckpoint("run-cp-strict-node-dates"))?.id,
        "cp-strict-node-dates",
      );
      assertEquals(warnings, []);

      await assertRejects(
        () =>
          strictBackend.saveCheckpoint("run-cp-strict-user-context-date", {
            id: "cp-strict-user-context-date",
            nodeId: "step",
            timestamp,
            context: { input: {}, step: { when: timestamp } },
            nodeStates: {
              step: {
                nodeId: "step",
                status: "completed",
                attempt: 1,
                startedAt: timestamp,
                completedAt: timestamp,
              },
            },
          }),
        Error,
        "strictContext",
      );

      const outputWarnings: LogEntry[] = [];
      const unsubscribeOutputWarnings = __subscribeLogRecordEmitter((entry) => {
        if (entry.level === "warn" && entry.component === "workflow-context") {
          outputWarnings.push(entry);
        }
      });

      try {
        await strictBackend.saveCheckpoint("run-cp-strict-node-output-date", {
          id: "cp-strict-node-output-date",
          nodeId: "step",
          timestamp,
          context: { input: {}, step: { saved: true } },
          nodeStates: {
            step: {
              nodeId: "step",
              status: "completed",
              attempt: 1,
            },
          },
          _resumeEnvelope: {
            schemaVersion: 2,
            ownerNodeId: "step",
            context: { input: {}, step: { saved: true } },
            nodeStates: {
              step: {
                nodeId: "step",
                status: "completed",
                attempt: 1,
                output: { when: timestamp },
              },
            },
            workflowProjection: { context: {} },
            graphAdmission: {
              stepsEvaluationContext: { input: {}, step: { saved: true } },
              stepsEvaluationProjection: { context: {} },
              graphIdentity: [],
              workflowVersion: null,
            },
          },
        });
      } finally {
        unsubscribeOutputWarnings();
      }

      assertEquals(outputWarnings.length, 1);
      const outputWarningPaths = outputWarnings[0]?.context?.paths;
      if (typeof outputWarningPaths !== "string") {
        throw new Error("Expected checkpoint warning paths");
      }
      assertStringIncludes(
        outputWarningPaths,
        "checkpoint._resumeEnvelope.<redacted>.<redacted>.<redacted>.<redacted> (Date)",
      );
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
      assertStringIncludes(
        mockRedis.lastScript,
        "if redis.call('hget', KEYS[1], 'workerId') ~= expectedWorkerId then return 0 end",
        "the final checkpoint owner fence must live in the Lua the backend executes",
      );
      const checkpointFenceArgvCount = Number(mockRedis.lastArgs[0]);
      assertEquals(
        mockRedis.lastArgs[checkpointFenceArgvCount + 1],
        "worker-new",
        "the expected workerId must sit at the ARGV index the Lua fence reads",
      );
      assertEquals((await backend.getCheckpoints("synthetic-child-run"))[0]?.id, "cp-owned");
    });

    it("checks checkpoint ownership without downloading the run hash", async () => {
      const runId = "run-cp-selective-owner-check";
      await backend.createRun(createTestRun(runId, {
        status: "running",
        workerId: "worker-current",
      }));
      let runHashReads = 0;
      const hgetall = mockRedis.hgetall.bind(mockRedis);
      mockRedis.hgetall = (key) => {
        if (key.endsWith(`:${runId}`)) runHashReads++;
        return hgetall(key);
      };

      assertEquals(
        await backend.saveCheckpointIfStatusAndWorker(
          runId,
          runId,
          ["running"],
          "worker-current",
          {
            id: "cp-selective-owner-check",
            nodeId: "step",
            timestamp: new Date(),
            context: { input: {} },
            nodeStates: {},
          },
        ),
        true,
      );

      assertEquals(runHashReads, 0);
      assertEquals((await backend.getCheckpoints(runId))[0]?.id, "cp-selective-owner-check");
    });

    it("checks a stale checkpoint owner before strict context validation", async () => {
      const strictBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "strict:",
        strictContext: true,
      });
      const runId = "run-cp-strict-stale-owner";
      await strictBackend.createRun(createTestRun(runId, {
        status: "running",
        workerId: "worker-current",
      }));

      assertEquals(
        await strictBackend.saveCheckpointIfStatusAndWorker(
          runId,
          runId,
          ["running"],
          "worker-stale",
          {
            id: "cp-strict-stale-owner",
            nodeId: "step",
            timestamp: new Date(),
            context: { input: {}, step: { when: new Date(0) } },
            nodeStates: {},
          },
        ),
        false,
      );
      assertEquals(await strictBackend.getCheckpoints(runId), []);
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
        "checkpoint.context.step.<redacted>",
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
        nodeId: `wait-node-${id}`,
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

    it("preserves the historical append semantics of savePendingApproval", async () => {
      const approval = (id: string): PendingApproval => ({
        ...makeApproval(id),
        nodeId: "review",
      });

      await backend.savePendingApproval("run-ap-append", approval("first"));
      await backend.savePendingApproval("run-ap-append", approval("second"));

      assertEquals(
        (await backend.getPendingApprovals("run-ap-append")).map(({ id }) => id),
        ["first", "second"],
      );
    });

    it("atomically elects one ownerless approval creator", async () => {
      const runId = "run-ap-ownerless-uniqueness";
      const approval = (id: string): PendingApproval => ({
        ...makeApproval(id),
        nodeId: "review",
      });

      assertEquals(await backend.savePendingApprovalIfAbsent(runId, approval("first")), true);
      assertEquals(await backend.savePendingApprovalIfAbsent(runId, approval("second")), false);
      assertEquals((await backend.getPendingApprovals(runId)).map(({ id }) => id), ["first"]);
    });

    it("preserves the historical append contract for unconditional approval saves", async () => {
      const runId = "run-ap-unconditional-append";
      const approval = (id: string): PendingApproval => ({
        ...makeApproval(id),
        nodeId: "review",
      });

      await backend.savePendingApproval(runId, approval("first"));
      await backend.savePendingApproval(runId, approval("second"));

      assertEquals(
        (await backend.getPendingApprovals(runId)).map(({ id }) => id),
        ["first", "second"],
      );
    });

    it("allows a new wait instance while the previous decision is reconciling", async () => {
      const runId = "run-ap-repeated-wait-instance";
      const approval = (id: string, waitInstanceId: string): PersistedPendingApproval => ({
        ...makeApproval(id),
        nodeId: "review",
        waitInstanceId,
      });

      assertEquals(
        await backend.savePendingApprovalIfAbsent(runId, approval("first", "wait-1")),
        true,
      );
      await backend.updateApproval(runId, "first", { approved: true, approver: "reviewer" });
      assertEquals(
        await backend.savePendingApprovalIfAbsent(runId, approval("second", "wait-2")),
        true,
      );
      assertEquals(
        await backend.savePendingApprovalIfAbsent(runId, approval("duplicate", "wait-2")),
        false,
      );
      assertEquals((await backend.getPendingApprovals(runId)).map(({ id }) => id), ["second"]);
    });

    it("atomically rejects an owned duplicate for the same pending node", async () => {
      const runId = "run-ap-node-uniqueness";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        workerId: "worker-a",
      }));
      const approval = (id: string): PendingApproval => ({
        ...makeApproval(id),
        nodeId: "review",
      });

      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          runId,
          ["waiting"],
          "worker-a",
          approval("first"),
        ),
        true,
      );
      const runHash = mockRedis.hashes.get(`test:schema-v1:run:${runId}`)!;
      const revisionAfterFirst = runHash.get("__runObservationRevision");
      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          runId,
          ["waiting"],
          "worker-a",
          approval("duplicate"),
        ),
        false,
      );
      assertEquals((await backend.getPendingApprovals(runId)).map(({ id }) => id), ["first"]);
      assertEquals(
        runHash.get("__runObservationRevision"),
        revisionAfterFirst,
        "a duplicate must not publish a phantom observation revision",
      );

      await backend.updateApproval(runId, "first", {
        approved: true,
        approver: "reviewer",
      });
      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          runId,
          ["waiting"],
          "worker-a",
          approval("retry-before-finalize"),
        ),
        false,
      );
      await backend.finalizeApprovalDecision(runId, "first");
      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          runId,
          ["waiting"],
          "worker-a",
          approval("retry"),
        ),
        true,
      );
      assertEquals((await backend.getPendingApprovals(runId)).map(({ id }) => id), ["retry"]);
    });

    it("bounds approval appends by evicting decided records before live ones", async () => {
      await backend.createRun(createTestRun("run-ap-bounded"));
      await backend.savePendingApproval("run-ap-bounded", makeApproval("ap-live-oldest"));
      await backend.savePendingApproval("run-ap-bounded", makeApproval("ap-decided"));
      await backend.updateApproval("run-ap-bounded", "ap-decided", {
        approved: true,
        approver: "admin",
      });
      await backend.finalizeApprovalDecision("run-ap-bounded", "ap-decided");
      for (let index = 2; index < MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES; index++) {
        await backend.savePendingApproval("run-ap-bounded", makeApproval(`ap-${index}`));
      }

      await backend.savePendingApproval("run-ap-bounded", makeApproval("ap-newest"));

      const stored = mockRedis.lists.get("test:schema-v1:approvals:run-ap-bounded")!;
      assertEquals(stored.length, MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES);
      assertEquals(stored.some((raw) => JSON.parse(raw).id === "ap-decided"), false);
      const retained = await backend.getPendingApprovals("run-ap-bounded");
      assertEquals(retained.length, MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES);
      assertEquals(retained[0]?.id, "ap-live-oldest");
      assertEquals(retained.at(-1)?.id, "ap-newest");
    });

    it("retains expired pending records until expiration reconciliation decides them", async () => {
      await backend.createRun(createTestRun("run-ap-expired"));
      await backend.savePendingApproval("run-ap-expired", makeApproval("ap-live-oldest"));
      await backend.savePendingApproval("run-ap-expired", {
        ...makeApproval("ap-expired"),
        expiresAt: new Date(Date.now() - 60_000),
      });
      for (let index = 2; index < MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES; index++) {
        await backend.savePendingApproval("run-ap-expired", makeApproval(`ap-${index}`));
      }

      await assertRejects(
        () => backend.savePendingApproval("run-ap-expired", makeApproval("ap-newest")),
        Error,
        "pending approval",
      );

      const stored = mockRedis.lists.get("test:schema-v1:approvals:run-ap-expired")!;
      assertEquals(stored.length, MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES);
      assertEquals(stored.some((raw) => JSON.parse(raw).id === "ap-expired"), true);
      assertEquals(JSON.parse(stored[0]!).id, "ap-live-oldest");
      assertEquals(stored.some((raw) => JSON.parse(raw).id === "ap-newest"), false);

      assertEquals(
        await backend.updateApproval("run-ap-expired", "ap-expired", {
          approved: false,
          approver: "system",
          comment: "Approval expired",
        }),
        true,
      );
      await backend.finalizeApprovalDecision("run-ap-expired", "ap-expired");
      await backend.savePendingApproval("run-ap-expired", makeApproval("ap-newest"));
      assertEquals(stored.some((raw) => JSON.parse(raw).id === "ap-expired"), false);
      assertEquals(JSON.parse(stored.at(-1)!).id, "ap-newest");
    });

    it("refuses the append when every retained approval is live", async () => {
      await backend.createRun(createTestRun("run-ap-full"));
      for (let index = 0; index < MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES; index++) {
        await backend.savePendingApproval("run-ap-full", makeApproval(`ap-${index}`));
      }
      const runHash = mockRedis.hashes.get("test:schema-v1:run:run-ap-full")!;
      const stream = mockRedis.streams.get(
        "test:schema-v1:run-observation:run-ap-full",
      )!;
      const revisionBeforeRejection = runHash.get("__runObservationRevision");
      const journalLengthBeforeRejection = stream.length;

      await assertRejects(
        () => backend.savePendingApproval("run-ap-full", makeApproval("ap-overflow")),
        Error,
        "pending approval",
      );

      const stored = mockRedis.lists.get("test:schema-v1:approvals:run-ap-full")!;
      assertEquals(stored.length, MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES);
      assertEquals(JSON.parse(stored[0]!).id, "ap-0");
      assertEquals(stored.some((raw) => JSON.parse(raw).id === "ap-overflow"), false);
      assertEquals(runHash.get("__runObservationRevision"), revisionBeforeRejection);
      assertEquals(stream.length, journalLengthBeforeRejection);
    });

    it("does not partially prune legacy overflow when too few records are decided", async () => {
      const storageKey = "test:schema-v1:approvals:run-ap-legacy-overflow";
      const legacy = [
        JSON.stringify({ ...makeApproval("decided-a"), status: "approved" }),
        JSON.stringify({ ...makeApproval("decided-b"), status: "rejected" }),
        ...Array.from(
          { length: MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES },
          (_, index) => JSON.stringify(makeApproval(`live-${index}`)),
        ),
      ];
      const before = [...legacy];
      mockRedis.lists.set(storageKey, legacy);

      await assertRejects(
        () =>
          backend.savePendingApproval(
            "run-ap-legacy-overflow",
            makeApproval("ap-overflow"),
          ),
        Error,
        "pending approval",
      );

      assertEquals(mockRedis.lists.get(storageKey), before);
    });

    it("bounds owned approval appends with the same state-aware retention", async () => {
      await backend.createRun(createTestRun("run-ap-owned-bounded", {
        status: "waiting",
        workerId: "worker-new",
      }));
      const saveOwned = (approval: PendingApproval) =>
        backend.savePendingApprovalIfStatusAndWorker(
          "run-ap-owned-bounded",
          ["waiting"],
          "worker-new",
          approval,
        );

      assertEquals(await saveOwned(makeApproval("owned-live-oldest")), true);
      assertEquals(await saveOwned(makeApproval("owned-decided")), true);
      await backend.updateApproval("run-ap-owned-bounded", "owned-decided", {
        approved: false,
        approver: "admin",
      });
      await backend.finalizeApprovalDecision("run-ap-owned-bounded", "owned-decided");
      for (let index = 2; index < MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES; index++) {
        assertEquals(await saveOwned(makeApproval(`owned-${index}`)), true);
      }

      assertEquals(await saveOwned(makeApproval("owned-newest")), true);

      const stored = mockRedis.lists.get("test:schema-v1:approvals:run-ap-owned-bounded")!;
      assertEquals(stored.length, MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES);
      assertEquals(stored.some((raw) => JSON.parse(raw).id === "owned-decided"), false);
      assertEquals(JSON.parse(stored[0]!).id, "owned-live-oldest");
      const runHash = mockRedis.hashes.get("test:schema-v1:run:run-ap-owned-bounded")!;
      const stream = mockRedis.streams.get(
        "test:schema-v1:run-observation:run-ap-owned-bounded",
      )!;
      const revisionBeforeRejection = runHash.get("__runObservationRevision");
      const journalLengthBeforeRejection = stream.length;

      await assertRejects(
        () => saveOwned(makeApproval("owned-overflow")),
        Error,
        "pending approval",
      );
      assertEquals(stored.length, MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES);
      assertEquals(runHash.get("__runObservationRevision"), revisionBeforeRejection);
      assertEquals(stream.length, journalLengthBeforeRejection);

      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          "run-ap-owned-bounded",
          ["waiting"],
          "worker-stale",
          makeApproval("owned-must-not-append"),
        ),
        false,
      );
      assertEquals(stored.length, MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES);
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
          data: { confirmed: true },
        }),
        true,
      );

      // The approval left the pending set and recorded the decider verbatim.
      assertEquals(await backend.getPendingApprovals("run-ap-true"), []);
      const stored = JSON.parse(mockRedis.lists.get("test:schema-v1:approvals:run-ap-true")![0]!);
      assertEquals(stored.status, "approved");
      assertEquals(stored.decidedBy, "admin");
      assertEquals(stored.comment, "looks good");
      assertEquals(stored.decisionData, { confirmed: true });
    });

    it("does not recreate a missing run hash when deciding an orphaned approval", async () => {
      const runId = "run-ap-orphaned";
      await backend.createRun(createTestRun(runId));
      await backend.savePendingApproval(runId, makeApproval("ap-orphaned"));
      const runKey = `test:schema-v1:run:${runId}`;
      mockRedis.hashes.delete(runKey);

      assertEquals(
        await backend.updateApproval(runId, "ap-orphaned", {
          approved: true,
          approver: "admin",
        }),
        true,
      );
      assertEquals(mockRedis.hashes.has(runKey), false);
      assertStringIncludes(
        mockRedis.lastScript,
        "if redis.call('exists', runKey) == 1 then",
      );
      assertStringIncludes(mockRedis.lastScript, "elseif metadataRaw then");
    });

    it("rejects strict approval decision data before mutating the approval", async () => {
      const strictBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "strict:",
        strictContext: true,
      });
      await strictBackend.createRun(createTestRun("run-ap-strict-decision"));
      await strictBackend.savePendingApproval(
        "run-ap-strict-decision",
        makeApproval("ap-strict-decision"),
      );

      await assertRejects(
        () =>
          strictBackend.updateApproval("run-ap-strict-decision", "ap-strict-decision", {
            approved: true,
            approver: "admin",
            data: { when: new Date(0) },
          }),
        Error,
        "strictContext",
      );

      const stored = JSON.parse(
        mockRedis.lists.get("strict:schema-v1:approvals:run-ap-strict-decision")![0]!,
      );
      assertEquals(stored.status, "pending");
      assertEquals(stored.decidedBy, undefined);
      assertEquals(stored.decidedAt, undefined);
      assertEquals(stored.decisionData, undefined);
      assertEquals(stored.reconciliationPending, undefined);
    });

    it("preserves strict serialization diagnostics when an approval is missing", async () => {
      const strictBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "strict-missing-approval:",
        strictContext: true,
      });

      let error: unknown;
      try {
        await strictBackend.updateApproval("run-missing-approval", "approval-missing", {
          approved: true,
          approver: "admin",
          data: { when: new Date(0) },
        });
      } catch (caught) {
        error = caught;
      }
      assertInstanceOf(error, Error);
      assertStringIncludes(error.message, "Approval not found");
      assertInstanceOf(error.cause, Error);
      assertStringIncludes(error.cause.message, "strictContext");
    });

    it("keeps deep decision JSON opaque through Redis approval transitions", async () => {
      const runId = "run-ap-deep-decision";
      await backend.createRun(createTestRun(runId));
      await backend.savePendingApproval(runId, makeApproval("ap-deep-decision"));

      let deep: unknown = { leaf: true };
      const depth = MAX_TRAVERSAL_DEPTH + 4_000;
      for (let index = 0; index < depth; index++) deep = { nested: deep };

      assertEquals(
        await backend.updateApproval(runId, "ap-deep-decision", {
          approved: true,
          approver: "admin",
          data: { exact: jsonRawSupport.rawJSON("-0"), deep },
        }),
        true,
      );

      const serializedPatch = mockRedis.lastArgs[1];
      assertExists(serializedPatch);
      assertStringIncludes(mockRedis.lastScript, "local approval = parseJsonObject(raw)");
      assertStringIncludes(mockRedis.lastScript, "mergeJsonObjects(raw, ARGV[2], true)");
      assertStringIncludes(
        mockRedis.lastScript,
        "deleteJsonObjectFields(updated, ARGV[3], true)",
      );
      const patch = JSON.parse(serializedPatch);
      assertEquals(Object.is(patch.decisionData.exact, -0), true);
      let restored = patch.decisionData.deep;
      for (let index = 0; index < depth; index++) {
        restored = (restored as { nested: unknown }).nested;
      }
      assertEquals(restored, { leaf: true });

      await backend.updatePendingApproval(runId, "ap-deep-decision", {
        notificationError: "late notification failure",
      });
      assertStringIncludes(mockRedis.lastScript, "mergeJsonObjects(raw, ARGV[2], true)");

      assertEquals(
        await backend.reserveApprovalDecisionClaim(
          runId,
          "ap-deep-decision",
          "recovery-deep",
          new Date("2026-08-28T00:00:00.000Z"),
          new Date("2026-08-27T23:59:00.000Z"),
        ),
        true,
      );
      assertStringIncludes(mockRedis.lastScript, "mergeJsonObjects(raw, patch, true)");

      await backend.releaseApprovalDecisionClaim(
        runId,
        "ap-deep-decision",
        "recovery-deep",
      );
      assertStringIncludes(
        mockRedis.lastScript,
        'deleteJsonObjectFields(raw, \'["recoveryClaimId","recoveryClaimedAt"]\', true)',
      );
      await backend.finalizeApprovalDecision(runId, "ap-deep-decision");
      assertStringIncludes(
        mockRedis.lastScript,
        '\'["reconciliationPending","recoveryClaimId","recoveryClaimedAt"]\',',
      );
    });

    it("preserves nested empty arrays in durable approval decision data", async () => {
      await backend.createRun(createTestRun("run-ap-empty-arrays"));
      await backend.savePendingApproval(
        "run-ap-empty-arrays",
        makeApproval("ap-empty-arrays"),
      );

      assertEquals(
        await backend.updateApproval("run-ap-empty-arrays", "ap-empty-arrays", {
          approved: true,
          approver: "admin",
          data: { answers: [], nested: { selections: [] } },
        }),
        true,
      );

      const [claim] = await backend.listApprovalDecisionClaims("run-ap-empty-arrays");
      assertEquals(claim?.approval.decisionData, {
        answers: [],
        nested: { selections: [] },
      });
      assertEquals(mockRedis.lastScript.includes("mergeJsonObjects"), true);
      assertEquals(
        mockRedis.lastScript.includes("approval.decisionData = cjson.decode"),
        false,
      );

      await backend.updatePendingApproval("run-ap-empty-arrays", "ap-empty-arrays", {
        notificationError: "late notification failure",
      });
      await backend.finalizeApprovalDecision("run-ap-empty-arrays", "ap-empty-arrays");
      const finalized = JSON.parse(
        mockRedis.lists.get("test:schema-v1:approvals:run-ap-empty-arrays")![0]!,
      );
      assertEquals(finalized.decisionData, {
        answers: [],
        nested: { selections: [] },
      });
    });

    it("updateApproval omits absent comments at the serialized boundary", async () => {
      await backend.createRun(createTestRun("run-ap-no-comment"));
      await backend.savePendingApproval("run-ap-no-comment", makeApproval("ap-no-comment"));

      assertEquals(
        await backend.updateApproval("run-ap-no-comment", "ap-no-comment", {
          approved: true,
          approver: "admin",
        }),
        true,
      );

      const stored = JSON.parse(
        mockRedis.lists.get("test:schema-v1:approvals:run-ap-no-comment")![0]!,
      );
      assertEquals(Object.hasOwn(stored, "comment"), false);
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

    it("returns false for invalid strict data after losing the approval race", async () => {
      const strictBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "strict-race:",
        strictContext: true,
      });
      await strictBackend.createRun(createTestRun("run-ap-strict-race"));
      await strictBackend.savePendingApproval(
        "run-ap-strict-race",
        makeApproval("ap-strict-race"),
      );

      assertEquals(
        await strictBackend.updateApproval("run-ap-strict-race", "ap-strict-race", {
          approved: true,
          approver: "first",
          data: { confirmed: true },
        }),
        true,
      );
      assertEquals(
        await strictBackend.updateApproval("run-ap-strict-race", "ap-strict-race", {
          approved: false,
          approver: "second",
          data: { when: new Date(0) },
        }),
        false,
      );

      const stored = JSON.parse(
        mockRedis.lists.get("strict-race:schema-v1:approvals:run-ap-strict-race")![0]!,
      );
      assertEquals(stored.status, "approved");
      assertEquals(stored.decidedBy, "first");
      assertEquals(stored.decisionData, { confirmed: true });
    });

    it("scans approval decision claims without blocking the Redis keyspace", async () => {
      mockRedis.scanPageSize = 1;
      for (const runId of ["run-ap-claim-a", "run-ap-claim-b"]) {
        await backend.createRun(createTestRun(runId));
        await backend.savePendingApproval(runId, makeApproval(`approval-${runId}`));
        await backend.updateApproval(runId, `approval-${runId}`, {
          approved: true,
          approver: "admin",
        });
      }

      const claims = await backend.listApprovalDecisionClaims();

      assertEquals(
        claims.map(({ runId }) => runId).sort(),
        ["run-ap-claim-a", "run-ap-claim-b"],
      );
      assertEquals(mockRedis.keysCallCount, 0);
      assertEquals(
        mockRedis.scanCalls.map(({ cursor, options }) => [cursor, options?.MATCH]),
        [
          [0, "test:schema-v1:approvals:*"],
          [1, "test:schema-v1:approvals:*"],
        ],
      );
    });

    it("leases approval decision recovery to one process at a time", async () => {
      const runId = "run-ap-recovery-lease";
      await backend.savePendingApproval(runId, makeApproval("approval-lease"));
      await backend.updateApproval(runId, "approval-lease", {
        approved: true,
        approver: "admin",
      });
      const firstClaimedAt = new Date("2026-08-26T10:00:00.000Z");

      assertEquals(
        await backend.reserveApprovalDecisionClaim(
          runId,
          "approval-lease",
          "recovery-first",
          firstClaimedAt,
          new Date("2026-08-26T09:59:00.000Z"),
        ),
        true,
      );
      assertEquals(
        await backend.reserveApprovalDecisionClaim(
          runId,
          "approval-lease",
          "recovery-second",
          new Date("2026-08-26T10:00:01.000Z"),
          new Date("2026-08-26T09:59:59.000Z"),
        ),
        false,
      );

      await backend.releaseApprovalDecisionClaim(
        runId,
        "approval-lease",
        "recovery-first",
      );
      assertEquals(
        await backend.reserveApprovalDecisionClaim(
          runId,
          "approval-lease",
          "recovery-second",
          new Date("2026-08-26T10:00:01.000Z"),
          new Date("2026-08-26T09:59:59.000Z"),
        ),
        true,
      );
      await backend.finalizeApprovalDecision(runId, "approval-lease", "recovery-second");
      assertEquals(await backend.listApprovalDecisionClaims(runId), []);
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

      assertStringIncludes(
        mockRedis.lastScript,
        "if activity ~= ARGV[1] then return 0 end",
        "the stalled-claim activity fence must live in the Lua the backend executes",
      );
      assertStringIncludes(
        mockRedis.lastScript,
        "redis.call('set', KEYS[2], ARGV[2], 'NX', 'PX', ARGV[3])",
        "the claim must be taken with a single NX set in the Lua the backend executes",
      );
      assertEquals(
        mockRedis.lastArgs[1],
        "worker-a",
        "the claiming workerId must sit at the ARGV index the Lua claim reads",
      );

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
    it("does not apply partial creation-time expiry to live run state", async () => {
      const ttlBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "ttl:",
        runTtl: 3600,
      });
      await ttlBackend.createRun(createTestRun("run-ttl"));
      await ttlBackend.updateRun("run-ttl", { status: "waiting" });
      await ttlBackend.saveCheckpoint("run-ttl", {
        id: "cp-ttl",
        nodeId: "gate",
        timestamp: new Date("2026-01-01T00:00:00Z"),
        context: { input: {} },
        nodeStates: {},
      });
      await ttlBackend.savePendingApproval("run-ttl", {
        id: "approval-ttl",
        nodeId: "gate",
        status: "pending",
        message: "Continue?",
        requestedAt: new Date("2026-01-01T00:00:00Z"),
      });

      assertEquals(mockRedis.expiries.size, 0);
      assertEquals((await ttlBackend.getRun("run-ttl"))?.status, "waiting");
      assertEquals((await ttlBackend.getCheckpoints("run-ttl")).length, 1);
      assertEquals((await ttlBackend.getPendingApprovals("run-ttl")).length, 1);
      assertEquals(await ttlBackend.countRuns({}), 1);
    });

    it("clears legacy run expiries without persisting lock leases", async () => {
      const ttlBackend = new RedisBackend({
        client: mockRedis as unknown as RedisAdapter,
        prefix: "ttl-migration:",
      });
      mockRedis.scanPageSize = 1;
      for (const runId of ["legacy-a", "legacy-b"]) {
        await ttlBackend.createRun(createTestRun(runId));
        await ttlBackend.savePendingApproval(runId, {
          id: `approval-${runId}`,
          nodeId: "gate",
          status: "pending",
          message: "Continue?",
          requestedAt: new Date("2026-01-01T00:00:00Z"),
        });
        mockRedis.expiries.set(`ttl-migration:schema-v1:run:${runId}`, 3600);
        mockRedis.expiries.set(`ttl-migration:schema-v1:run-observation:${runId}`, 3600);
        mockRedis.expiries.set(
          `ttl-migration:schema-v1:run-observation-approvals-v1:${runId}`,
          3600,
        );
      }
      await ttlBackend.acquireLock("legacy-a", 60_000);
      mockRedis.expiries.set("ttl-migration:schema-v1:lock:legacy-a", 60_000);

      assertEquals(await ttlBackend.clearLegacyRunTtlExpirations(), 6);
      assertEquals(
        [...mockRedis.expiries.keys()],
        ["ttl-migration:schema-v1:lock:legacy-a"],
      );
      assertEquals(mockRedis.scanCalls.length > 1, true);
      assertEquals(
        mockRedis.scanCalls.every((call) =>
          call.options?.MATCH === "ttl-migration:schema-v1:run:*" &&
          call.options.COUNT === 100
        ),
        true,
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
