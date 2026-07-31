/****
 * Redis Workflow Backend
 *
 * Production-grade Redis implementation of WorkflowBackend.
 * Uses Redis hashes for state storage and Redis Streams for job queuing.
 *
 * @module ai/workflow/backends/redis
 */

import type {
  ApprovalDecision,
  Checkpoint,
  PendingApproval,
  RunFilter,
  WorkflowQueueItem,
  WorkflowRun,
  WorkflowStatus,
} from "veryfront/extensions/distributed/workflow-support";
import { agentLogger, MAX_TIMER_DELAY_MS, safeJsonParse } from "veryfront/utils";
import {
  INVALID_ARGUMENT,
  RESOURCE_NOT_FOUND,
  SERVICE_OVERLOADED,
  WORKFLOW_RUN_CONFLICT,
} from "veryfront/errors";

import { createClient } from "redis";
import type { RedisAdapter } from "./redis-adapter.ts";
import {
  type ApprovalDecisionTiming,
  assertWorkflowLockId,
  assertWorkflowRunUpdate,
  assertWorkflowWorkerId,
  captureApprovalDecisionTiming,
  capturePendingApprovalMetadataUpdate,
  getTimedWorkflowWaits,
  MAX_WORKFLOW_RUN_LIST_LIMIT,
  type PendingApprovalMetadataUpdate,
  requeueRun,
  requireWorkflowSourceIntegrationPolicy,
  resolveRunDateBounds,
  resolveRunListPage,
  resolveWorkflowRunCursorPage,
  type TimedWaitClaim,
  type TimedWaitClaimRequest,
  type WorkflowBackend,
  type WorkflowRunCursorFilter,
  type WorkflowRunUpdate,
} from "veryfront/extensions/distributed/workflow-support";
import { arrayToObject } from "./array-to-object.ts";
import { NodeRedisAdapter } from "./node-redis-adapter.ts";
import type { NodeRedisClient, NodeRedisClientOptions } from "./node-redis-types.ts";

export type { RedisAdapter } from "./redis-adapter.ts";
export type { RedisBackendConfig, RedisRetentionDrainResult } from "./workflow-backend-types.ts";

import type {
  RedisBackendConfig,
  RedisBackendInternalConfig,
  RedisRetentionDrainResult,
} from "./workflow-backend-types.ts";

const logger = agentLogger.component("redis-backend");
const REDIS_STORAGE_SCHEMA_VERSION = "schema-v2";
const REDIS_STORAGE_SCHEMA_NAMESPACE = `${REDIS_STORAGE_SCHEMA_VERSION}:`;
const WORKFLOW_STATUSES: readonly WorkflowStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "waiting",
];
const RETENTION_CLEANUP_BATCH_SIZE = 128;
const MAX_INTERNAL_CURSOR_RESTARTS = 8;
const DEFAULT_REDIS_CONNECT_TIMEOUT_MS = 5_000;
const TIMED_WAIT_MIGRATION_BATCH_SIZE = 100;
const MAX_TIMED_WAIT_CLAIM_BATCH_SIZE = 100;

type RedisBackendLifecycleState = "open" | "closing" | "closed";
type RedisClientCloseMode = "quit" | "disconnect";

interface RedisConnectionAttempt {
  readonly generation: number;
  readonly client: RedisAdapter;
  readonly cancel: () => void;
  promise: Promise<RedisAdapter>;
}

interface RedisInitializationAttempt {
  readonly generation: number;
  readonly cancel: () => void;
  promise: Promise<void>;
}

interface RedisInitializationFailure {
  readonly generation: number;
  readonly error: unknown;
}

interface AttachedNodeRedisClient {
  readonly adapter: NodeRedisAdapter;
  readonly createCleanupAdapter: () => NodeRedisAdapter;
  readonly observedError: () => boolean;
}

class RedisLifecycleCleanupError extends AggregateError {
  override readonly name = "RedisLifecycleCleanupError";
}

interface RunSnapshot {
  run: WorkflowRun;
  approvals: PendingApproval[];
}

interface RunSnapshotCursor {
  score: string;
  member: string;
}

interface CursorRunSnapshotPage {
  snapshots: RunSnapshot[];
  nextCursor: RunSnapshotCursor | null;
  cursorReset: boolean;
}

interface TimedWaitIndexEntry {
  readonly nodeId: string;
  readonly deadline: number;
  readonly waitKind: "delay" | "event";
}

function appendStorageSchemaVersion(base: string): string {
  return `${base.replace(/:+$/, "")}:${REDIS_STORAGE_SCHEMA_VERSION}`;
}

function assertValidRunTtl(runTtl: number | undefined, nowMs: number): void {
  if (runTtl === undefined) return;
  const expiresAt = nowMs + (runTtl * 1000);
  if (runTtl < 0 || !Number.isSafeInteger(runTtl) || !Number.isSafeInteger(expiresAt)) {
    throw INVALID_ARGUMENT.create({
      detail:
        "runTtl must be a non-negative safe integer whose absolute deadline is safely representable",
    });
  }
}

function requireConnectTimeoutMs(value: unknown): number {
  if (
    !Number.isSafeInteger(value) || (value as number) <= 0 ||
    (value as number) > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `Redis workflow connectTimeoutMs must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`,
    );
  }
  return value as number;
}

function lifecycleError(state: RedisBackendLifecycleState): Error {
  const error = new Error(`Redis workflow backend is ${state}`);
  error.name = "InvalidStateError";
  return error;
}

function supersededError(operation: "connection" | "initialization"): Error {
  const error = new Error(`Redis workflow backend ${operation} was superseded by destroy()`);
  error.name = "AbortError";
  return error;
}

function isBusyGroupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /^BUSYGROUP(?:\s|$)/.test(message);
}

function requireRedisScriptInteger(value: unknown, operation: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw INVALID_ARGUMENT.create({
      detail: `Invalid Redis ${operation} response`,
    });
  }
  return value;
}

function requireRedisScriptBoolean(value: unknown, operation: string): boolean {
  const code = requireRedisScriptInteger(value, operation);
  if (code !== 0 && code !== 1) {
    throw INVALID_ARGUMENT.create({
      detail: `Invalid Redis ${operation} response code`,
    });
  }
  return code === 1;
}

function getTimedWaitIndexEntries(run: WorkflowRun): TimedWaitIndexEntry[] {
  if (run.status !== "waiting") return [];
  return getTimedWorkflowWaits(run).map((wait) => {
    if (!Number.isSafeInteger(wait.deadline)) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Timed-wait deadline is not safely representable for run ${run.id}, node ${wait.nodeId}`,
      });
    }
    return {
      nodeId: wait.nodeId,
      deadline: wait.deadline,
      waitKind: wait.waitKind,
    };
  });
}

function serializeTimedWaitIndex(run: WorkflowRun): string {
  return JSON.stringify(getTimedWaitIndexEntries(run));
}

function serializeTimedWaitIndexFromNodeStates(
  runId: string,
  nodeStates: WorkflowRun["nodeStates"],
  workerId?: string,
): string {
  return JSON.stringify(getTimedWaitIndexEntries({
    id: runId,
    status: "waiting",
    workerId,
    nodeStates,
  } as WorkflowRun));
}

function timedWaitRowId(runId: string, nodeId: string): string {
  if (typeof nodeId !== "string" || nodeId.length === 0) {
    throw INVALID_ARGUMENT.create({
      detail: "Timed-wait node id must be a non-empty string",
    });
  }
  return JSON.stringify([runId, nodeId]);
}

/**
 * Atomic compare-and-delete: delete the lock only if it still holds our token.
 * Server-side Lua (Redis EVAL) so the GET and DEL are one indivisible step,
 * preventing a stale owner from deleting another worker's reacquired lock.
 */
const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * Atomic compare-and-pexpire: extend the lock TTL only if it still holds our
 * token. Same TOCTOU protection as the release script.
 */
const EXTEND_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

/** Read one run hash and its approval list at the same Redis linearization point. */
const READ_RUN_SNAPSHOT_SCRIPT = `-- read-workflow-run-snapshot
return {
  redis.call('hgetall', KEYS[1]),
  redis.call('lrange', KEYS[2], 0, -1)
}`;

const TIMED_WAIT_INDEX_LUA = `
local function removeTimedWaitRows(runId, metadataKey, delayIndex, eventIndex, leaseIndex, claimPrefix)
  local encodedRows = redis.call('hget', metadataKey, runId)
  if encodedRows and encodedRows ~= '' then
    local rows = cjson.decode(encodedRows)
    for _, rowId in ipairs(rows) do
      redis.call('zrem', delayIndex, rowId)
      redis.call('zrem', eventIndex, rowId)
      redis.call('zrem', leaseIndex, rowId)
      redis.call('del', claimPrefix .. rowId)
    end
  end
  redis.call('hdel', metadataKey, runId)
end

local function publishTimedWaitRows(runKey, runId, metadataKey, delayIndex, eventIndex)
  local encodedIndex = redis.call('hget', runKey, 'timedWaitIndex')
  if not encodedIndex or encodedIndex == '' then return end
  local entries = cjson.decode(encodedIndex)
  local rowIds = {}
  for _, entry in ipairs(entries) do
    local rowId = cjson.encode({runId, entry.nodeId})
    if entry.waitKind == 'delay' then
      redis.call('zadd', delayIndex, tonumber(entry.deadline), rowId)
    elseif entry.waitKind == 'event' then
      redis.call('zadd', eventIndex, tonumber(entry.deadline), rowId)
    end
    table.insert(rowIds, rowId)
  end
  redis.call('hset', metadataKey, runId, cjson.encode(rowIds))
end`;

/**
 * Atomically create a run hash, publish every index membership, and record its
 * retention horizon. Stale bookkeeping from an already-expired incarnation of
 * the same id is removed before the new run becomes visible.
 */
const CREATE_RUN_SCRIPT = `-- create-workflow-run-if-absent
${TIMED_WAIT_INDEX_LUA}
if redis.call('exists', KEYS[1]) == 1 then return 0 end
local runId = ARGV[1]
local workflowId = ARGV[2]
local status = ARGV[3]
local ttl = tonumber(ARGV[4])
local createdAtMs = tonumber(ARGV[5])
local workflowPrefix = ARGV[6]
local statusPrefix = ARGV[7]
local workflowStatusPrefix = ARGV[8]
local oldWorkflowId = redis.call('hget', KEYS[6], runId)
local oldStatus = redis.call('hget', KEYS[7], runId)
redis.call('zrem', KEYS[2], runId)
if oldWorkflowId and oldWorkflowId ~= '' then
  redis.call('zrem', workflowPrefix .. oldWorkflowId, runId)
end
if oldStatus and oldStatus ~= '' then
  redis.call('zrem', statusPrefix .. oldStatus, runId)
end
if oldWorkflowId and oldWorkflowId ~= '' and oldStatus and oldStatus ~= '' then
  redis.call('zrem', workflowStatusPrefix .. oldWorkflowId .. ':' .. oldStatus, runId)
end
redis.call('hdel', KEYS[6], runId)
redis.call('hdel', KEYS[7], runId)
redis.call('zrem', KEYS[8], runId)
redis.call('del', KEYS[9], KEYS[10], KEYS[11], KEYS[12])
local fieldCount = tonumber(ARGV[9])
local fieldStart = 10
local timedClaimPrefix = ARGV[fieldStart + (fieldCount * 2)]
removeTimedWaitRows(runId, KEYS[16], KEYS[13], KEYS[14], KEYS[15], timedClaimPrefix)
for i = 0, fieldCount - 1 do
  local offset = fieldStart + (i * 2)
  redis.call('hset', KEYS[1], ARGV[offset], ARGV[offset + 1])
end
redis.call('zadd', KEYS[2], createdAtMs, runId)
redis.call('zadd', KEYS[3], createdAtMs, runId)
redis.call('zadd', KEYS[4], createdAtMs, runId)
redis.call('zadd', KEYS[5], createdAtMs, runId)
redis.call('hset', KEYS[6], runId, workflowId)
redis.call('hset', KEYS[7], runId, status)
if status == 'waiting' then
  publishTimedWaitRows(KEYS[1], runId, KEYS[16], KEYS[13], KEYS[14])
end
if ttl and ttl > 0 then
  redis.call('expire', KEYS[1], ttl)
  local remaining = redis.call('pttl', KEYS[1])
  local now = redis.call('time')
  local nowMs = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)
  redis.call('zadd', KEYS[8], nowMs + remaining, runId)
end
return 1`;

/** Delete a missing run's auxiliary keys and index memberships after rechecking atomically. */
const CLEANUP_MISSING_RUN_SCRIPT = `-- cleanup-missing-workflow-run
${TIMED_WAIT_INDEX_LUA}
if redis.call('exists', KEYS[1]) == 1 then return 0 end
local runId = ARGV[1]
local workflowPrefix = ARGV[2]
local statusPrefix = ARGV[3]
local workflowStatusPrefix = ARGV[4]
local timedClaimPrefix = ARGV[5]
local workflowId = redis.call('hget', KEYS[7], runId)
local status = redis.call('hget', KEYS[8], runId)
removeTimedWaitRows(runId, KEYS[13], KEYS[10], KEYS[11], KEYS[12], timedClaimPrefix)
redis.call('del', KEYS[2], KEYS[3], KEYS[4], KEYS[5])
redis.call('zrem', KEYS[6], runId)
if workflowId and workflowId ~= '' then
  redis.call('zrem', workflowPrefix .. workflowId, runId)
end
if status and status ~= '' then
  redis.call('zrem', statusPrefix .. status, runId)
end
if workflowId and workflowId ~= '' and status and status ~= '' then
  redis.call('zrem', workflowStatusPrefix .. workflowId .. ':' .. status, runId)
end
redis.call('hdel', KEYS[7], runId)
redis.call('hdel', KEYS[8], runId)
redis.call('zrem', KEYS[9], runId)
return 1`;

/** Delete a run and every owned key/index entry in one atomic boundary. */
const DELETE_RUN_SCRIPT = `-- delete-workflow-run
${TIMED_WAIT_INDEX_LUA}
local runId = ARGV[1]
local workflowPrefix = ARGV[2]
local statusPrefix = ARGV[3]
local workflowStatusPrefix = ARGV[4]
local timedClaimPrefix = ARGV[5]
local workflowId = redis.call('hget', KEYS[1], 'workflowId')
if not workflowId or workflowId == '' then workflowId = redis.call('hget', KEYS[7], runId) end
local status = redis.call('hget', KEYS[1], 'status')
if not status or status == '' then status = redis.call('hget', KEYS[8], runId) end
removeTimedWaitRows(runId, KEYS[13], KEYS[10], KEYS[11], KEYS[12], timedClaimPrefix)
redis.call('del', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5])
redis.call('zrem', KEYS[6], runId)
if workflowId and workflowId ~= '' then
  redis.call('zrem', workflowPrefix .. workflowId, runId)
end
if status and status ~= '' then
  redis.call('zrem', statusPrefix .. status, runId)
end
if workflowId and workflowId ~= '' and status and status ~= '' then
  redis.call('zrem', workflowStatusPrefix .. workflowId .. ':' .. status, runId)
end
redis.call('hdel', KEYS[7], runId)
redis.call('hdel', KEYS[8], runId)
redis.call('zrem', KEYS[9], runId)
return 1`;

/**
 * Lazily drain only retention-ledger entries whose deadline has passed. The
 * caller supplies its current time so the write script remains deterministic;
 * PTTL is rechecked before deletion, preventing a skewed clock from deleting a
 * live run. This is bounded and never scans the Redis keyspace.
 */
const CLEANUP_EXPIRED_RUNS_SCRIPT = `-- cleanup-expired-workflow-runs
${TIMED_WAIT_INDEX_LUA}
local limit = tonumber(ARGV[9])
local timedClaimPrefix = ARGV[10]
local now = redis.call('time')
local nowMs = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)
local runIds = redis.call('zrangebyscore', KEYS[1], '-inf', nowMs, 'LIMIT', 0, limit)
for _, runId in ipairs(runIds) do
  local runKey = ARGV[1] .. runId
  local remaining = redis.call('pttl', runKey)
  if remaining > 0 then
    redis.call('zadd', KEYS[1], nowMs + remaining, runId)
  elseif remaining == -1 then
    redis.call('zrem', KEYS[1], runId)
  else
    local workflowId = redis.call('hget', KEYS[2], runId)
    local status = redis.call('hget', KEYS[3], runId)
    removeTimedWaitRows(runId, KEYS[8], KEYS[5], KEYS[6], KEYS[7], timedClaimPrefix)
    redis.call('del', runKey, ARGV[2] .. runId, ARGV[3] .. runId, ARGV[4] .. runId, ARGV[5] .. runId)
    redis.call('zrem', KEYS[4], runId)
    if workflowId and workflowId ~= '' then
      redis.call('zrem', ARGV[6] .. workflowId, runId)
    end
    if status and status ~= '' then
      redis.call('zrem', ARGV[7] .. status, runId)
    end
    if workflowId and workflowId ~= '' and status and status ~= '' then
      redis.call('zrem', ARGV[8] .. workflowId .. ':' .. status, runId)
    end
    redis.call('hdel', KEYS[2], runId)
    redis.call('hdel', KEYS[3], runId)
    redis.call('zrem', KEYS[1], runId)
  end
end
local hasMore = redis.call('zcount', KEYS[1], '-inf', nowMs) > 0
return {#runIds, hasMore and 1 or 0}`;

const RETENTION_CLEANUP_LUA = `
${TIMED_WAIT_INDEX_LUA}
local function removeRun(runId)
  local workflowId = redis.call('hget', KEYS[2], runId)
  local status = redis.call('hget', KEYS[3], runId)
  removeTimedWaitRows(runId, KEYS[8], KEYS[5], KEYS[6], KEYS[7], ARGV[10])
  redis.call('del', ARGV[1] .. runId, ARGV[2] .. runId, ARGV[3] .. runId, ARGV[4] .. runId, ARGV[5] .. runId)
  redis.call('zrem', KEYS[4], runId)
  if workflowId and workflowId ~= '' then
    redis.call('zrem', ARGV[6] .. workflowId, runId)
  end
  if status and status ~= '' then
    redis.call('zrem', ARGV[7] .. status, runId)
  end
  if workflowId and workflowId ~= '' and status and status ~= '' then
    redis.call('zrem', ARGV[8] .. workflowId .. ':' .. status, runId)
  end
  redis.call('hdel', KEYS[2], runId)
  redis.call('hdel', KEYS[3], runId)
  redis.call('zrem', KEYS[1], runId)
end

local function cleanupRetention()
  local cleanupLimit = tonumber(ARGV[9])
  local now = redis.call('time')
  local nowMs = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)
  local due = redis.call('zrangebyscore', KEYS[1], '-inf', nowMs, 'LIMIT', 0, cleanupLimit)
  for _, runId in ipairs(due) do
    local remaining = redis.call('pttl', ARGV[1] .. runId)
    if remaining > 0 then
      redis.call('zadd', KEYS[1], nowMs + remaining, runId)
    elseif remaining == -1 then
      redis.call('zrem', KEYS[1], runId)
    else
      removeRun(runId)
    end
  end
  local hasMore = redis.call('zcount', KEYS[1], '-inf', nowMs) > 0
  return #due, hasMore
end`;

/** Bounded exact run page plus run/approval snapshots in one Redis transaction. */
const LIST_RUNS_SCRIPT = `-- list-workflow-runs-exact
${RETENTION_CLEANUP_LUA}
local processed, hasMore = cleanupRetention()
if hasMore then return {0, processed, 'retention-backlog'} end
local maxScore = ARGV[11]
local minScore = ARGV[12]
local offset = tonumber(ARGV[13])
local limit = tonumber(ARGV[14])
local selectedCount = tonumber(ARGV[15])
local window = offset + limit
local byId = {}
for index = 1, selectedCount do
  local values = redis.call(
    'zrevrangebyscore',
    KEYS[8 + index],
    maxScore,
    minScore,
    'withscores',
    'limit',
    0,
    window
  )
  for valueIndex = 1, #values, 2 do
    byId[values[valueIndex]] = tonumber(values[valueIndex + 1])
  end
end
local ordered = {}
for runId, score in pairs(byId) do
  table.insert(ordered, {runId, score})
end
table.sort(ordered, function(left, right)
  if left[2] == right[2] then return left[1] > right[1] end
  return left[2] > right[2]
end)
local snapshots = {}
local last = math.min(#ordered, offset + limit)
for index = offset + 1, last do
  local runId = ordered[index][1]
  local run = redis.call('hgetall', ARGV[1] .. runId)
  if #run == 0 then
    removeRun(runId)
    return {0, processed, 'index-ghost'}
  end
  local approvals = redis.call('lrange', ARGV[3] .. runId, 0, -1)
  table.insert(snapshots, {run, approvals})
end
return {1, processed, snapshots}`;

/**
 * Bounded single-index cursor page for internal polling. The cursor is the
 * exact sorted-set (score, member) row from the prior page. If that row moved
 * or disappeared, restart from the head; the caller de-duplicates the replay.
 */
const CURSOR_LIST_RUNS_SCRIPT = `-- cursor-page-workflow-runs-exact
${RETENTION_CLEANUP_LUA}
local processed, hasMore = cleanupRetention()
if hasMore then return {0, processed, 'retention-backlog'} end
local cursorScore = ARGV[11]
local cursorMember = ARGV[12]
local limit = tonumber(ARGV[13])
local start = 0
if cursorMember ~= '' then
  local actualScore = redis.call('zscore', KEYS[9], cursorMember)
  if actualScore then
    if tonumber(actualScore) ~= tonumber(cursorScore) then
      return {2, processed, 'cursor-score-mismatch'}
    end
    local rank = redis.call('zrevrank', KEYS[9], cursorMember)
    if not rank then return {2, processed, 'cursor-rank-missing'} end
    start = rank + 1
  else
    -- Reconstruct the insertion point even after the cursor run left this
    -- status index. Redis executes the script atomically, so the temporary
    -- boundary member is never externally visible.
    redis.call('zadd', KEYS[9], tonumber(cursorScore), cursorMember)
    local rank = redis.call('zrevrank', KEYS[9], cursorMember)
    redis.call('zrem', KEYS[9], cursorMember)
    if not rank then return {2, processed, 'cursor-rank-missing'} end
    start = rank
  end
end
local values = redis.call('zrevrange', KEYS[9], start, start + limit - 1, 'withscores')
local snapshots = {}
for index = 1, #values, 2 do
  local runId = values[index]
  local run = redis.call('hgetall', ARGV[1] .. runId)
  if #run == 0 then
    removeRun(runId)
    return {0, processed, 'index-ghost'}
  end
  local approvals = redis.call('lrange', ARGV[3] .. runId, 0, -1)
  table.insert(snapshots, {run, approvals})
end
local nextScore = ''
local nextMember = ''
if #values > 0 then
  nextMember = values[#values - 1]
  nextScore = values[#values]
end
return {1, processed, snapshots, nextScore, nextMember, 0}`;

/** Exact filtered count from disjoint ordered indexes, without run hydration. */
const COUNT_RUNS_SCRIPT = `-- count-workflow-runs-exact
${RETENTION_CLEANUP_LUA}
local processed, hasMore = cleanupRetention()
if hasMore then return {0, processed, 'retention-backlog'} end
local maxScore = ARGV[11]
local minScore = ARGV[12]
local selectedCount = tonumber(ARGV[13])
local count = 0
for index = 1, selectedCount do
  count = count + redis.call('zcount', KEYS[8 + index], minScore, maxScore)
end
return {1, processed, count}`;

/** Append run-owned list state and cap it at the run hash's remaining lifetime. */
const APPEND_RUN_STATE_SCRIPT = `-- append-retained-workflow-run-state
if redis.call('exists', KEYS[1]) == 0 then return 0 end
local remaining = redis.call('pttl', KEYS[1])
if remaining == -2 or remaining == 0 then return 0 end
redis.call('rpush', KEYS[2], ARGV[1])
if remaining > 0 then redis.call('pexpire', KEYS[2], remaining) end
return 1`;

/** Append one run-unique approval while preserving the run retention horizon. */
const APPEND_UNIQUE_APPROVAL_SCRIPT = `-- append-unique-retained-workflow-approval
if redis.call('exists', KEYS[1]) == 0 then return 0 end
if redis.call('hget', KEYS[1], 'status') ~= 'waiting' then return 3 end
local remaining = redis.call('pttl', KEYS[1])
if remaining == -2 or remaining == 0 then return 0 end
local incoming = cjson.decode(ARGV[1])
if type(incoming.id) ~= 'string' then return -1 end
local len = redis.call('llen', KEYS[2])
for i = 0, len - 1 do
  local raw = redis.call('lindex', KEYS[2], i)
  if raw then
    local stored = cjson.decode(raw)
    if stored.id == incoming.id then return 2 end
  end
end
redis.call('rpush', KEYS[2], ARGV[1])
if remaining > 0 then redis.call('pexpire', KEYS[2], remaining) end
return 1`;

/**
 * Atomically claim a still-stalled running run. The caller supplies the exact
 * activity timestamp it validated as stale; any heartbeat or terminal update
 * between that read and this script makes the comparison fail.
 *
 * KEYS[1] = run hash key
 * KEYS[2] = stalled-claim lease key
 * ARGV[1] = observed activity timestamp
 * ARGV[2] = replacement worker id
 * ARGV[3] = claim lease duration in milliseconds
 * ARGV[4] = current timestamp
 */
const CLAIM_STALLED_RUN_SCRIPT = `-- conditional-stalled-run-claim
if redis.call('hget', KEYS[1], 'status') ~= 'running' then return 0 end
local heartbeat = redis.call('hget', KEYS[1], 'heartbeatAt')
local started = redis.call('hget', KEYS[1], 'startedAt')
local created = redis.call('hget', KEYS[1], 'createdAt')
local activity = heartbeat
if not activity or activity == '' then activity = started end
if not activity or activity == '' then activity = created end
if activity ~= ARGV[1] then return 0 end
local claimed = redis.call('set', KEYS[2], ARGV[2], 'NX', 'PX', ARGV[3])
if not claimed then return 0 end
redis.call('hset', KEYS[1], 'workerId', ARGV[2], 'heartbeatAt', ARGV[4])
if not started or started == '' then redis.call('hset', KEYS[1], 'startedAt', ARGV[4]) end
return 1`;

/** Atomically verify the current status, update fields, and move the status index. */
const UPDATE_RUN_IF_STATUS_SCRIPT = `-- conditional-run-update
${TIMED_WAIT_INDEX_LUA}
local old = redis.call('hget', KEYS[1], 'status')
local expectedCount = tonumber(ARGV[1])
local allowed = false
for i = 2, expectedCount + 1 do
  if old == ARGV[i] then
    allowed = true
    break
  end
end
if not allowed then return 0 end
local nextStatus = ARGV[expectedCount + 2]
local statusPrefix = ARGV[expectedCount + 3]
local workflowStatusPrefix = ARGV[expectedCount + 4]
local runId = ARGV[expectedCount + 5]
local expectedWorkerId = ARGV[expectedCount + 6]
if expectedWorkerId ~= '' and redis.call('hget', KEYS[1], 'workerId') ~= expectedWorkerId then
  return 0
end
local expectedLockId = ARGV[expectedCount + 7]
if expectedLockId ~= '' and redis.call('get', KEYS[4]) ~= expectedLockId then
  return 0
end
local invalidateTimedWait = ARGV[expectedCount + 8] == '1'
local fieldCount = tonumber(ARGV[expectedCount + 9])
local fieldStart = expectedCount + 10
local timedClaimPrefix = ARGV[fieldStart + (fieldCount * 2)]
if invalidateTimedWait then
  removeTimedWaitRows(runId, KEYS[8], KEYS[5], KEYS[6], KEYS[7], timedClaimPrefix)
end
if nextStatus ~= '' and old ~= nextStatus then
  local workflowId = redis.call('hget', KEYS[1], 'workflowId')
  local createdAtMs = tonumber(redis.call('hget', KEYS[1], 'createdAtMs'))
  if not workflowId or workflowId == '' or not createdAtMs then return -1 end
  redis.call('hset', KEYS[1], 'status', nextStatus)
  redis.call('zrem', statusPrefix .. old, runId)
  redis.call('zrem', workflowStatusPrefix .. workflowId .. ':' .. old, runId)
  redis.call('zadd', statusPrefix .. nextStatus, createdAtMs, runId)
  redis.call('zadd', workflowStatusPrefix .. workflowId .. ':' .. nextStatus, createdAtMs, runId)
  redis.call('hset', KEYS[3], runId, nextStatus)
end
for i = 0, fieldCount - 1 do
  local offset = fieldStart + (i * 2)
  redis.call('hset', KEYS[1], ARGV[offset], ARGV[offset + 1])
end
if invalidateTimedWait and redis.call('hget', KEYS[1], 'status') == 'waiting' then
  publishTimedWaitRows(KEYS[1], runId, KEYS[8], KEYS[5], KEYS[6])
end
if nextStatus ~= '' and nextStatus ~= 'running' then
  redis.call('del', KEYS[2])
  if expectedLockId ~= '' then redis.call('del', KEYS[4]) end
end
return 1`;

/** Claim one bounded migration page from legacy waiting rows. */
const MIGRATE_TIMED_WAIT_INDEX_PAGE_SCRIPT = `-- migrate-timed-wait-index-page
local limit = tonumber(ARGV[1])
local runPrefix = ARGV[2]
local cursorMember = redis.call('hget', KEYS[2], 'member') or ''
local cursorScore = redis.call('hget', KEYS[2], 'score') or ''
local start = 0
if cursorMember ~= '' then
  local actualScore = redis.call('zscore', KEYS[1], cursorMember)
  if actualScore and tonumber(actualScore) == tonumber(cursorScore) then
    local rank = redis.call('zrevrank', KEYS[1], cursorMember)
    if rank then start = rank + 1 end
  else
    redis.call('zadd', KEYS[1], tonumber(cursorScore), cursorMember)
    local rank = redis.call('zrevrank', KEYS[1], cursorMember)
    redis.call('zrem', KEYS[1], cursorMember)
    if rank then start = rank end
  end
end
local values = redis.call('zrevrange', KEYS[1], start, start + limit - 1, 'withscores')
local snapshots = {}
for index = 1, #values, 2 do
  local runId = values[index]
  local runKey = runPrefix .. runId
  if redis.call('exists', runKey) == 1 and redis.call('hexists', runKey, 'timedWaitIndex') == 0 then
    table.insert(snapshots, redis.call('hgetall', runKey))
  end
end
if #values == limit * 2 then
  redis.call('hset', KEYS[2], 'member', values[#values - 1], 'score', values[#values])
else
  redis.call('del', KEYS[2])
end
return snapshots`;

/** Publish computed deadline rows only if the migrated snapshot is still exact. */
const BACKFILL_TIMED_WAIT_INDEX_SCRIPT = `-- backfill-timed-wait-index-page
${TIMED_WAIT_INDEX_LUA}
local runPrefix = ARGV[1]
local claimPrefix = ARGV[2]
local count = tonumber(ARGV[3])
local applied = 0
for index = 0, count - 1 do
  local offset = 4 + (index * 3)
  local runId = ARGV[offset]
  local observedNodeStates = ARGV[offset + 1]
  local encodedIndex = ARGV[offset + 2]
  local runKey = runPrefix .. runId
  if redis.call('hget', runKey, 'status') == 'waiting' and
      redis.call('hexists', runKey, 'timedWaitIndex') == 0 and
      redis.call('hget', runKey, 'nodeStates') == observedNodeStates then
    redis.call('hset', runKey, 'timedWaitIndex', encodedIndex)
    removeTimedWaitRows(runId, KEYS[3], KEYS[1], KEYS[2], KEYS[4], claimPrefix)
    publishTimedWaitRows(runKey, runId, KEYS[3], KEYS[1], KEYS[2])
    applied = applied + 1
  end
end
return applied`;

/** Atomically lease earliest due rows and recover expired claim leases. */
const CLAIM_DUE_TIMED_WAITS_SCRIPT = `-- claim-due-timed-waits
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local leaseDuration = tonumber(ARGV[3])
local ownerId = ARGV[4]
local runPrefix = ARGV[5]
local claimPrefix = ARGV[6]
local requestedKind = ARGV[7]
local selectedIndex = requestedKind == 'delay' and KEYS[1] or KEYS[2]
local serverTime = redis.call('time')
local leaseNow = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)

local function findEntry(runKey, nodeId)
  local encoded = redis.call('hget', runKey, 'timedWaitIndex')
  if not encoded or encoded == '' then return nil end
  for _, entry in ipairs(cjson.decode(encoded)) do
    if entry.nodeId == nodeId then return entry end
  end
  return nil
end

local expired = redis.call('zrangebyscore', KEYS[3], '-inf', leaseNow, 'LIMIT', 0, limit)
for _, rowId in ipairs(expired) do
  local claimKey = claimPrefix .. rowId
  if redis.call('exists', claimKey) == 0 then
    redis.call('zrem', KEYS[3], rowId)
    local identity = cjson.decode(rowId)
    local runKey = runPrefix .. identity[1]
    local entry = findEntry(runKey, identity[2])
    if redis.call('hget', runKey, 'status') == 'waiting' and entry then
      local target = entry.waitKind == 'delay' and KEYS[1] or KEYS[2]
      redis.call('zadd', target, tonumber(entry.deadline), rowId)
    end
  end
end

local candidates = redis.call('zrangebyscore', selectedIndex, '-inf', now, 'LIMIT', 0, limit)
local claims = {}
for _, rowId in ipairs(candidates) do
  local identity = cjson.decode(rowId)
  local runId = identity[1]
  local nodeId = identity[2]
  local runKey = runPrefix .. runId
  local entry = findEntry(runKey, nodeId)
  local indexedDeadline = redis.call('zscore', selectedIndex, rowId)
  if redis.call('hget', runKey, 'status') ~= 'waiting' or not entry then
    redis.call('zrem', selectedIndex, rowId)
  elseif entry.waitKind ~= requestedKind or
      tonumber(entry.deadline) ~= tonumber(indexedDeadline) then
    redis.call('zrem', KEYS[1], rowId)
    redis.call('zrem', KEYS[2], rowId)
    local currentIndex = entry.waitKind == 'delay' and KEYS[1] or KEYS[2]
    redis.call('zadd', currentIndex, tonumber(entry.deadline), rowId)
  else
    local fence = redis.call('incr', KEYS[4])
    local token = ownerId .. ':' .. tostring(fence)
    local claimKey = claimPrefix .. rowId
    local acquired = redis.call('set', claimKey, token, 'NX', 'PX', leaseDuration)
    if acquired then
      local expiresAt = leaseNow + leaseDuration
      redis.call('zrem', selectedIndex, rowId)
      redis.call('zadd', KEYS[3], expiresAt, rowId)
      table.insert(claims, {
        rowId,
        tostring(entry.deadline),
        token,
        tostring(expiresAt),
        redis.call('hgetall', runKey)
      })
    end
  end
end
return claims`;

/** Release one exact claim and restore only its still-current row. */
const RELEASE_TIMED_WAIT_CLAIM_SCRIPT = `-- release-timed-wait-claim
if redis.call('get', KEYS[4]) ~= ARGV[1] then return 0 end
redis.call('del', KEYS[4])
redis.call('zrem', KEYS[3], ARGV[2])
if redis.call('hget', KEYS[5], 'status') ~= 'waiting' then return 1 end
local encoded = redis.call('hget', KEYS[5], 'timedWaitIndex')
if not encoded or encoded == '' then return 1 end
for _, entry in ipairs(cjson.decode(encoded)) do
  if entry.nodeId == ARGV[3] then
    local target = entry.waitKind == 'delay' and KEYS[1] or KEYS[2]
    redis.call('zadd', target, tonumber(entry.deadline), ARGV[2])
    return 1
  end
end
return 1`;

/** Resolve one wait only while its exact row lease and run owner remain live. */
const UPDATE_RUN_IF_TIMED_WAIT_CLAIM_SCRIPT = `-- conditional-timed-wait-resolution
${TIMED_WAIT_INDEX_LUA}
if redis.call('get', KEYS[2]) ~= ARGV[1] then return 0 end
if redis.call('hget', KEYS[1], 'status') ~= 'waiting' then return 0 end
if redis.call('hget', KEYS[1], 'workerId') ~= ARGV[5] then return 0 end
local encoded = redis.call('hget', KEYS[1], 'timedWaitIndex')
if not encoded or encoded == '' then return 0 end
local exact = false
for _, entry in ipairs(cjson.decode(encoded)) do
  if entry.nodeId == ARGV[3] and tonumber(entry.deadline) == tonumber(ARGV[4]) then
    exact = true
    break
  end
end
if not exact then return 0 end

local nextStatus = ARGV[6]
local statusPrefix = ARGV[7]
local workflowStatusPrefix = ARGV[8]
local runId = ARGV[9]
local fieldCount = tonumber(ARGV[10])
local fieldStart = 11
local claimPrefix = ARGV[fieldStart + (fieldCount * 2)]
local workflowId = redis.call('hget', KEYS[1], 'workflowId')
local createdAtMs = tonumber(redis.call('hget', KEYS[1], 'createdAtMs'))
if not workflowId or workflowId == '' or not createdAtMs then return -1 end

removeTimedWaitRows(runId, KEYS[7], KEYS[4], KEYS[5], KEYS[3], claimPrefix)
redis.call('hset', KEYS[1], 'status', nextStatus)
redis.call('zrem', statusPrefix .. 'waiting', runId)
redis.call('zrem', workflowStatusPrefix .. workflowId .. ':waiting', runId)
redis.call('zadd', statusPrefix .. nextStatus, createdAtMs, runId)
redis.call('zadd', workflowStatusPrefix .. workflowId .. ':' .. nextStatus, createdAtMs, runId)
redis.call('hset', KEYS[6], runId, nextStatus)
for index = 0, fieldCount - 1 do
  local offset = fieldStart + (index * 2)
  redis.call('hset', KEYS[1], ARGV[offset], ARGV[offset + 1])
end
return 1`;

/** Atomically verify canonical run ownership before appending auxiliary run state. */
const APPEND_IF_STATUS_AND_WORKER_SCRIPT = `-- conditional-owned-append
local status = redis.call('hget', KEYS[1], 'status')
local expectedCount = tonumber(ARGV[1])
local allowed = false
for i = 2, expectedCount + 1 do
  if status == ARGV[i] then
    allowed = true
    break
  end
end
if not allowed then return 0 end
local expectedWorkerId = ARGV[expectedCount + 2]
if redis.call('hget', KEYS[1], 'workerId') ~= expectedWorkerId then return 0 end
local remaining = redis.call('pttl', KEYS[1])
if remaining == -2 or remaining == 0 then return 0 end
redis.call('rpush', KEYS[2], ARGV[expectedCount + 3])
if remaining > 0 then redis.call('pexpire', KEYS[2], remaining) end
return 1`;

/** Atomically verify run ownership and append one run-unique approval. */
const APPEND_UNIQUE_APPROVAL_IF_STATUS_AND_WORKER_SCRIPT =
  `-- conditional-owned-unique-approval-append
local status = redis.call('hget', KEYS[1], 'status')
if status ~= 'waiting' then return 0 end
local expectedCount = tonumber(ARGV[1])
local allowed = false
for i = 2, expectedCount + 1 do
  if status == ARGV[i] then
    allowed = true
    break
  end
end
if not allowed then return 0 end
local expectedWorkerId = ARGV[expectedCount + 2]
if redis.call('hget', KEYS[1], 'workerId') ~= expectedWorkerId then return 0 end
local remaining = redis.call('pttl', KEYS[1])
if remaining == -2 or remaining == 0 then return 0 end
local encoded = ARGV[expectedCount + 3]
local incoming = cjson.decode(encoded)
if type(incoming.id) ~= 'string' then return -1 end
local len = redis.call('llen', KEYS[2])
for i = 0, len - 1 do
  local raw = redis.call('lindex', KEYS[2], i)
  if raw then
    local stored = cjson.decode(raw)
    if stored.id == incoming.id then return 2 end
  end
end
redis.call('rpush', KEYS[2], encoded)
if remaining > 0 then redis.call('pexpire', KEYS[2], remaining) end
return 1`;

/**
 * Atomically patch metadata on the approval whose parsed `.id` matches, located
 * by scanning the list inside the script. This replaces the previous
 * lrange -> findIndex -> lset sequence, which was non-atomic: a concurrent
 * rpush/lset could shift the list between the read and the positional write, so
 * the LSET would clobber the wrong element.
 *
 * KEYS[1] = approvals list key
 * KEYS[2] = owning run hash key
 * ARGV[1] = approval id
 * ARGV[2] = notification error
 *
 * Returns 1 when the approval was found and patched, 2 when duplicate stored
 * ids make the target ambiguous, and 0 when the id is absent.
 */
const UPDATE_PENDING_APPROVAL_SCRIPT = `-- conditional-approval-patch
local approvalId = ARGV[1]
local len = redis.call('llen', KEYS[1])
local matchIndex = -1
local matched = nil
for i = 0, len - 1 do
  local raw = redis.call('lindex', KEYS[1], i)
  if raw then
    local approval = cjson.decode(raw)
    if approval.id == approvalId then
      if matchIndex ~= -1 then return 2 end
      matchIndex = i
      matched = approval
    end
  end
end
if matchIndex == -1 then return 0 end
matched.notificationError = ARGV[2]
redis.call('lset', KEYS[1], matchIndex, cjson.encode(matched))
return 1`;

/**
 * Atomically apply an approval decision, located by scanning the list for the
 * element whose parsed `.id` matches, and only while that element is still
 * `pending`. Same TOCTOU protection as the patch script above, plus a status
 * precondition so a second concurrent decision cannot overwrite the first.
 *
 * KEYS[1] = approvals list key
 * ARGV[1] = approval id
 * ARGV[2] = new status ("approved" | "rejected")
 * ARGV[3] = decidedBy
 * ARGV[4] = decidedAt (ISO string, computed by the caller for determinism)
 * ARGV[5] = expiry condition ("unexpired" | "expired")
 * ARGV[6] = "1" when a comment is provided, "0" otherwise
 * ARGV[7] = comment (ignored unless ARGV[6] == "1")
 *
 * Returns 1 when applied, 2 when the approval was found but no longer pending
 * (a lost race), 3 when duplicate stored ids make the target ambiguous, and 0
 * when the id is absent.
 */
const UPDATE_APPROVAL_SCRIPT = `-- conditional-approval-decision
local approvalId = ARGV[1]
if redis.call('hget', KEYS[2], 'status') ~= 'waiting' then return 2 end
local len = redis.call('llen', KEYS[1])
local matchIndex = -1
local matched = nil
for i = 0, len - 1 do
  local raw = redis.call('lindex', KEYS[1], i)
  if raw then
    local approval = cjson.decode(raw)
    if approval.id == approvalId then
      if matchIndex ~= -1 then return 3 end
      matchIndex = i
      matched = approval
    end
  end
end
if matchIndex == -1 then return 0 end
if matched.status ~= 'pending' then return 2 end
local expiresAt = matched.expiresAt
local hasExpiry = expiresAt ~= nil and expiresAt ~= cjson.null
if hasExpiry and type(expiresAt) ~= 'string' then return 4 end
local isExpired = hasExpiry and ARGV[4] > expiresAt
if ARGV[5] == 'unexpired' then
  if isExpired then return 2 end
elseif ARGV[5] == 'expired' then
  if not hasExpiry or not isExpired then return 2 end
else
  return 5
end
matched.status = ARGV[2]
matched.decidedBy = ARGV[3]
matched.decidedAt = ARGV[4]
if ARGV[6] == '1' then matched.comment = ARGV[7] else matched.comment = nil end
redis.call('lset', KEYS[1], matchIndex, cjson.encode(matched))
return 1`;

/** Implement redis backend. */
export class RedisBackend implements WorkflowBackend {
  private client: RedisAdapter | null = null;
  private connectionAttempt: RedisConnectionAttempt | null = null;
  private config: RedisBackendInternalConfig;
  private initialized = false;
  private lifecycleState: RedisBackendLifecycleState = "open";
  private lifecycleGeneration = 0;
  private initializationAttempt: RedisInitializationAttempt | null = null;
  private initializationFailure: RedisInitializationFailure | null = null;
  private invalidationCleanup: Promise<void> | null = null;
  private destroyPromise: Promise<void> | null = null;
  private readonly pendingCloseClients = new Map<RedisAdapter, RedisClientCloseMode>();
  private readonly closePromises = new WeakMap<RedisAdapter, Promise<void>>();
  private readonly closedClients = new WeakSet<RedisAdapter>();
  /**
   * Stream message IDs this consumer has read but not yet acknowledged, keyed
   * by runId. Populated in {@link dequeue} and consumed by {@link acknowledge}
   * so we can XACK the exact PEL entry (a runId may map to more than one
   * pending message if it was requeued and re-read before acking).
   */
  private pendingMessageIds = new Map<string, string[]>();

  constructor(config: RedisBackendConfig = {}) {
    assertValidRunTtl(config.runTtl, Date.now());
    const resolvedConfig: RedisBackendInternalConfig = {
      ...config,
      prefix: config.prefix ?? "vf:workflow:",
      streamKey: config.streamKey ?? "vf:workflow:stream",
      groupName: config.groupName ?? "vf:workflow:workers",
      consumerName: config.consumerName ?? `worker-${crypto.randomUUID().slice(0, 8)}`,
      debug: config.debug ?? false,
      connectTimeoutMs: requireConnectTimeoutMs(
        config.connectTimeoutMs ?? DEFAULT_REDIS_CONNECT_TIMEOUT_MS,
      ),
    };
    this.config = {
      ...resolvedConfig,
      streamKey: appendStorageSchemaVersion(resolvedConfig.streamKey),
      groupName: appendStorageSchemaVersion(resolvedConfig.groupName),
    };

    if (config.client) {
      this.client = config.client;
      this.pendingCloseClients.set(config.client, "quit");
    }
  }

  private storagePrefix(): string {
    return `${this.config.prefix}${REDIS_STORAGE_SCHEMA_NAMESPACE}`;
  }

  private runKey(runId: string): string {
    return `${this.runKeyPrefix()}${runId}`;
  }

  private runKeyPrefix(): string {
    return `${this.storagePrefix()}run:`;
  }

  private checkpointsKey(runId: string): string {
    return `${this.checkpointsKeyPrefix()}${runId}`;
  }

  private checkpointsKeyPrefix(): string {
    return `${this.storagePrefix()}checkpoints:`;
  }

  private approvalsKey(runId: string): string {
    return `${this.approvalsKeyPrefix()}${runId}`;
  }

  private approvalsKeyPrefix(): string {
    return `${this.storagePrefix()}approvals:`;
  }

  private statusIndexKey(status: WorkflowStatus): string {
    return `${this.statusIndexPrefix()}${status}`;
  }

  private statusIndexPrefix(): string {
    return `${this.storagePrefix()}index:created:status:`;
  }

  private workflowIndexKey(workflowId: string): string {
    return `${this.workflowIndexPrefix()}${workflowId}`;
  }

  private workflowIndexPrefix(): string {
    return `${this.storagePrefix()}index:created:workflow:`;
  }

  private workflowStatusIndexKey(workflowId: string, status: WorkflowStatus): string {
    return `${this.workflowStatusIndexPrefix()}${workflowId}:${status}`;
  }

  private workflowStatusIndexPrefix(): string {
    return `${this.storagePrefix()}index:created:workflow-status:`;
  }

  /** Every run ordered by creation time, newest first at query time. */
  private allRunsIndexKey(): string {
    return `${this.storagePrefix()}index:created`;
  }

  /** Per-run workflow id used for targeted cleanup after the run hash expires. */
  private runWorkflowMetadataKey(): string {
    return `${this.storagePrefix()}index:run-workflow`;
  }

  /** Per-run status used for targeted cleanup after the run hash expires. */
  private runStatusMetadataKey(): string {
    return `${this.storagePrefix()}index:run-status`;
  }

  /** Sorted set of run ids scored by their absolute Redis-server expiry time. */
  private retentionIndexKey(): string {
    return `${this.storagePrefix()}index:retention`;
  }

  private cleanupKeys(runId: string): string[] {
    return [
      this.runKey(runId),
      this.checkpointsKey(runId),
      this.approvalsKey(runId),
      this.claimKey(runId),
      this.lockKey(runId),
      this.allRunsIndexKey(),
      this.runWorkflowMetadataKey(),
      this.runStatusMetadataKey(),
      this.retentionIndexKey(),
      this.timedWaitDeadlineIndexKey("delay"),
      this.timedWaitDeadlineIndexKey("event"),
      this.timedWaitClaimLeaseIndexKey(),
      this.timedWaitRowsMetadataKey(),
    ];
  }

  private cleanupArgs(runId: string): string[] {
    return [
      runId,
      this.workflowIndexPrefix(),
      this.statusIndexPrefix(),
      this.workflowStatusIndexPrefix(),
      this.timedWaitClaimKeyPrefix(),
    ];
  }

  private async cleanupMissingRun(client: RedisAdapter, runId: string): Promise<boolean> {
    const cleaned = await client.eval(
      CLEANUP_MISSING_RUN_SCRIPT,
      this.cleanupKeys(runId),
      this.cleanupArgs(runId),
    );
    return Number(cleaned) === 1;
  }

  private async cleanupExpiredRuns(
    client: RedisAdapter,
  ): Promise<{ processed: number; hasMoreDue: boolean }> {
    const result = await client.eval(
      CLEANUP_EXPIRED_RUNS_SCRIPT,
      [
        this.retentionIndexKey(),
        this.runWorkflowMetadataKey(),
        this.runStatusMetadataKey(),
        this.allRunsIndexKey(),
        this.timedWaitDeadlineIndexKey("delay"),
        this.timedWaitDeadlineIndexKey("event"),
        this.timedWaitClaimLeaseIndexKey(),
        this.timedWaitRowsMetadataKey(),
      ],
      [
        this.runKeyPrefix(),
        this.checkpointsKeyPrefix(),
        this.approvalsKeyPrefix(),
        this.claimKeyPrefix(),
        this.lockKeyPrefix(),
        this.workflowIndexPrefix(),
        this.statusIndexPrefix(),
        this.workflowStatusIndexPrefix(),
        String(RETENTION_CLEANUP_BATCH_SIZE),
        this.timedWaitClaimKeyPrefix(),
      ],
    );
    if (!Array.isArray(result)) {
      throw INVALID_ARGUMENT.create({ detail: "Invalid Redis retention cleanup response" });
    }
    return {
      processed: Number(result[0]),
      hasMoreDue: Number(result[1]) === 1,
    };
  }

  private lockKey(runId: string): string {
    return `${this.lockKeyPrefix()}${runId}`;
  }

  private lockKeyPrefix(): string {
    return `${this.storagePrefix()}lock:`;
  }

  private claimKey(runId: string): string {
    return `${this.claimKeyPrefix()}${runId}`;
  }

  private claimKeyPrefix(): string {
    return `${this.storagePrefix()}claim:`;
  }

  private timedWaitDeadlineIndexKey(waitKind: "delay" | "event"): string {
    return `${this.storagePrefix()}index:timed-wait:${waitKind}`;
  }

  private timedWaitClaimKey(rowId: string): string {
    return `${this.timedWaitClaimKeyPrefix()}${rowId}`;
  }

  private timedWaitClaimKeyPrefix(): string {
    return `${this.storagePrefix()}timed-wait-claim:`;
  }

  private timedWaitClaimLeaseIndexKey(): string {
    return `${this.storagePrefix()}index:timed-wait-claims`;
  }

  private timedWaitRowsMetadataKey(): string {
    return `${this.storagePrefix()}index:run-timed-wait-rows`;
  }

  private timedWaitFenceKey(): string {
    return `${this.storagePrefix()}sequence:timed-wait-claim`;
  }

  private timedWaitMigrationCursorKey(): string {
    return `${this.storagePrefix()}migration:timed-wait-index`;
  }

  private serializeRun(run: WorkflowRun): Record<string, string> {
    const sourceIntegrationPolicy = requireWorkflowSourceIntegrationPolicy(run);
    return {
      id: run.id,
      workflowId: run.workflowId,
      version: run.version || "",
      status: run.status,
      workerId: run.workerId || "",
      tenant: run._tenant ? JSON.stringify(run._tenant) : "",
      runtimeStateVersion: run._runtimeStateVersion === undefined
        ? ""
        : String(run._runtimeStateVersion),
      workflowProjection: run._workflowProjection === undefined
        ? ""
        : JSON.stringify(run._workflowProjection),
      sourceIntegrationPolicy: JSON.stringify(sourceIntegrationPolicy),
      timedWaitIndex: serializeTimedWaitIndex(run),
      input: JSON.stringify(run.input),
      output: run.output !== undefined ? JSON.stringify(run.output) : "",
      nodeStates: JSON.stringify(run.nodeStates),
      currentNodes: JSON.stringify(run.currentNodes),
      context: JSON.stringify(run.context),
      error: run.error ? JSON.stringify(run.error) : "",
      createdAt: run.createdAt.toISOString(),
      createdAtMs: String(run.createdAt.getTime()),
      startedAt: run.startedAt?.toISOString() || "",
      heartbeatAt: run.heartbeatAt?.toISOString() || "",
      completedAt: run.completedAt?.toISOString() || "",
    };
  }

  private serializeRunPatch(runId: string, patch: WorkflowRunUpdate): Record<string, string> {
    const fields: Record<string, string> = {};
    if (patch.workerId !== undefined) fields.workerId = patch.workerId ?? "";
    if (patch.output !== undefined) fields.output = JSON.stringify(patch.output);
    if (patch.nodeStates !== undefined) fields.nodeStates = JSON.stringify(patch.nodeStates);
    if (patch.nodeStates !== undefined) {
      fields.timedWaitIndex = serializeTimedWaitIndexFromNodeStates(
        runId,
        patch.nodeStates,
        patch.workerId ?? undefined,
      );
    } else if (patch.status !== undefined && patch.status !== "waiting") {
      fields.timedWaitIndex = "[]";
    }
    if (patch.currentNodes !== undefined) fields.currentNodes = JSON.stringify(patch.currentNodes);
    if (patch.context !== undefined) fields.context = JSON.stringify(patch.context);
    if (patch._workflowProjection !== undefined) {
      fields.workflowProjection = JSON.stringify(patch._workflowProjection);
    }
    if (patch.error !== undefined) fields.error = JSON.stringify(patch.error);
    if (patch.startedAt !== undefined) fields.startedAt = patch.startedAt.toISOString();
    if (patch.heartbeatAt !== undefined) fields.heartbeatAt = patch.heartbeatAt.toISOString();
    if (patch.completedAt !== undefined) fields.completedAt = patch.completedAt.toISOString();
    return fields;
  }

  private serializeApproval(approval: PendingApproval): string {
    return JSON.stringify({
      ...approval,
      requestedAt: approval.requestedAt.toISOString(),
      expiresAt: approval.expiresAt?.toISOString(),
      decidedAt: approval.decidedAt?.toISOString(),
    });
  }

  private async appendIfStatusAndWorker(
    ownershipRunId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    storageKey: string,
    value: string,
  ): Promise<boolean> {
    const client = await this.ensureClient();
    const result = await client.eval(
      APPEND_IF_STATUS_AND_WORKER_SCRIPT,
      [
        this.runKey(ownershipRunId),
        storageKey,
      ],
      [
        String(expectedStatuses.length),
        ...expectedStatuses,
        expectedWorkerId,
        value,
      ],
    );
    return Number(result) === 1;
  }

  private async appendRunState(
    runId: string,
    storageKey: string,
    value: string,
  ): Promise<void> {
    const client = await this.ensureClient();
    const appended = await client.eval(
      APPEND_RUN_STATE_SCRIPT,
      [this.runKey(runId), storageKey],
      [value],
    );
    if (Number(appended) !== 1) {
      await this.cleanupMissingRun(client, runId);
      throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });
    }
  }

  private deserializeRun(data: Record<string, string>): WorkflowRun {
    if (!data.id) {
      throw INVALID_ARGUMENT.create({ detail: "Invalid workflow run data: missing 'id' field" });
    }
    if (!data.workflowId) {
      throw INVALID_ARGUMENT.create({
        detail: `Invalid workflow run data for run "${data.id}": missing 'workflowId' field`,
      });
    }
    if (!data.sourceIntegrationPolicy) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Invalid workflow run data for run "${data.id}": missing 'sourceIntegrationPolicy' field`,
      });
    }

    const status = data.status as WorkflowStatus;
    if (data.status && !WORKFLOW_STATUSES.includes(status)) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Invalid workflow run data for run "${data.id}": unknown status "${data.status}". ` +
          `Expected one of: ${WORKFLOW_STATUSES.join(", ")}`,
      });
    }

    function parseJson<T>(runId: string, field: string, value: string): T {
      const r = safeJsonParse<T>(value);
      if (!r.ok) {
        throw INVALID_ARGUMENT.create({
          detail:
            `Invalid workflow run data for run "${runId}": failed to parse '${field}' as JSON. ` +
            `Error: ${r.error.message}`,
          cause: r.error,
        });
      }
      return r.value;
    }

    function parseJsonOr<T>(
      runId: string,
      field: string,
      value: string | undefined,
      defaultValue: T,
    ): T {
      return value ? parseJson<T>(runId, field, value) : defaultValue;
    }

    const sourceIntegrationPolicy = requireWorkflowSourceIntegrationPolicy({
      id: data.id,
      sourceIntegrationPolicy: parseJson<WorkflowRun["sourceIntegrationPolicy"]>(
        data.id,
        "sourceIntegrationPolicy",
        data.sourceIntegrationPolicy,
      ),
    });
    const nodeStates = parseJsonOr<WorkflowRun["nodeStates"]>(
      data.id,
      "nodeStates",
      data.nodeStates,
      {},
    );
    for (const [nodeId, state] of Object.entries(nodeStates)) {
      if (typeof state !== "object" || state === null || Array.isArray(state)) {
        throw INVALID_ARGUMENT.create({
          detail:
            `Invalid workflow run data for run "${data.id}": node state "${nodeId}" is invalid`,
        });
      }
      const persistedState = state as unknown as Record<string, unknown>;
      for (const field of ["startedAt", "completedAt"] as const) {
        const encodedDate = persistedState[field];
        if (encodedDate === undefined) continue;
        if (typeof encodedDate !== "string") {
          throw INVALID_ARGUMENT.create({
            detail:
              `Invalid workflow run data for run "${data.id}": node state "${nodeId}" has an invalid '${field}' field`,
          });
        }
        const date = new Date(encodedDate);
        if (!Number.isFinite(date.getTime())) {
          throw INVALID_ARGUMENT.create({
            detail:
              `Invalid workflow run data for run "${data.id}": node state "${nodeId}" has an invalid '${field}' field`,
          });
        }
        persistedState[field] = date;
      }
    }

    const runtimeStateVersion = data.runtimeStateVersion === undefined ||
        data.runtimeStateVersion === ""
      ? undefined
      : Number(data.runtimeStateVersion);
    if (
      runtimeStateVersion !== undefined &&
      (!Number.isSafeInteger(runtimeStateVersion) || runtimeStateVersion < 1)
    ) {
      throw INVALID_ARGUMENT.create({
        detail: `Invalid workflow run data for run "${data.id}": runtime state version is invalid`,
      });
    }

    return {
      id: data.id,
      workflowId: data.workflowId,
      version: data.version || undefined,
      status: status ?? "pending",
      workerId: data.workerId || undefined,
      _tenant: parseJsonOr(data.id, "tenant", data.tenant, undefined),
      _runtimeStateVersion: runtimeStateVersion,
      _workflowProjection: parseJsonOr(
        data.id,
        "workflowProjection",
        data.workflowProjection,
        undefined,
      ),
      sourceIntegrationPolicy,
      input: parseJsonOr(data.id, "input", data.input, undefined),
      output: parseJsonOr(data.id, "output", data.output, undefined),
      nodeStates,
      currentNodes: parseJsonOr(data.id, "currentNodes", data.currentNodes, []),
      context: parseJsonOr(data.id, "context", data.context, { input: undefined }),
      checkpoints: [],
      pendingApprovals: [],
      error: parseJsonOr(data.id, "error", data.error, undefined),
      createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
      startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
      heartbeatAt: data.heartbeatAt ? new Date(data.heartbeatAt) : undefined,
      completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
    };
  }

  /**
   * Return a client only after this lifecycle generation is ready. A failed
   * readiness generation is retained so ordinary operations fail closed; only
   * an explicit initialize() call starts a retry.
   */
  private ensureClient(): Promise<RedisAdapter> {
    try {
      this.assertOpen();
    } catch (error) {
      return Promise.reject(error);
    }

    if (this.initialized) return this.connectClient();

    const failure = this.initializationFailure;
    if (failure?.generation === this.lifecycleGeneration) {
      return Promise.reject(failure.error);
    }

    const readiness = this.initializationAttempt?.promise ?? this.startInitialization();
    return readiness.then(() => this.connectClient());
  }

  /** Connect without recursively requiring consumer-group readiness. */
  private connectClient(): Promise<RedisAdapter> {
    try {
      this.assertOpen();
    } catch (error) {
      return Promise.reject(error);
    }

    if (this.client) return Promise.resolve(this.client);
    if (this.connectionAttempt) return this.connectionAttempt.promise;
    if (this.invalidationCleanup) {
      return this.invalidationCleanup.then(() => this.connectClient());
    }

    return this.startConnection();
  }

  private assertOpen(): void {
    if (this.lifecycleState !== "open") throw lifecycleError(this.lifecycleState);
  }

  protected createNodeRedisClient(options: NodeRedisClientOptions): NodeRedisClient {
    return createClient(options) as unknown as NodeRedisClient;
  }

  private attachNodeRedisErrorListener(
    client: NodeRedisClient,
    generation: number,
  ): AttachedNodeRedisClient {
    let observedError = false;
    let detached = false;
    const onError = (error: unknown) => {
      observedError = true;
      // node-redis requires an error listener. Keep diagnostics bounded and do
      // not risk logging a server URL or credential-bearing error message.
      logger.error("Redis workflow client emitted an error", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      this.invalidatePublishedClient(adapter, generation);
    };
    const detach = () => {
      if (detached) return;
      client.off("error", onError);
      detached = true;
    };
    const adapter = new NodeRedisAdapter(client, detach);
    client.on("error", onError);
    return {
      adapter,
      createCleanupAdapter: () => new NodeRedisAdapter(client, detach),
      observedError: () => observedError,
    };
  }

  private invalidatePublishedClient(client: RedisAdapter, generation: number): void {
    if (
      this.lifecycleState !== "open" || generation !== this.lifecycleGeneration ||
      this.client !== client
    ) {
      return;
    }

    this.lifecycleGeneration++;
    const invalidationGeneration = this.lifecycleGeneration;
    this.client = null;
    this.initialized = false;
    const unavailable = new Error("Redis workflow connection became unavailable");
    unavailable.name = "RedisConnectionError";
    this.initializationFailure = { generation: invalidationGeneration, error: unavailable };
    this.pendingCloseClients.set(client, "disconnect");

    const cleanup = this.closeTrackedClient(client);
    this.invalidationCleanup = cleanup;
    void cleanup.then(
      () => {
        if (this.invalidationCleanup === cleanup) this.invalidationCleanup = null;
      },
      (cleanupError) => {
        if (this.invalidationCleanup !== cleanup) return;
        this.invalidationCleanup = null;
        if (
          this.lifecycleState === "open" &&
          invalidationGeneration === this.lifecycleGeneration && this.client === null
        ) {
          this.lifecycleState = "closing";
          this.lifecycleGeneration++;
          this.initializationFailure = {
            generation: this.lifecycleGeneration,
            error: new RedisLifecycleCleanupError(
              [unavailable, cleanupError],
              "Redis workflow connection invalidation cleanup failed",
            ),
          };
        }
      },
    );
  }

  private startConnection(): Promise<RedisAdapter> {
    const generation = this.lifecycleGeneration;
    const cancellationError = supersededError("connection");
    let cancelled = false;
    let cancel!: () => void;
    const cancellation = new Promise<never>((_, reject) => {
      cancel = () => {
        if (cancelled) return;
        cancelled = true;
        reject(cancellationError);
      };
    });

    let rawClient: NodeRedisClient;
    let attachment: AttachedNodeRedisClient;
    try {
      rawClient = this.createNodeRedisClient({
        ...(this.config.url === undefined ? {} : { url: this.config.url }),
        socket: {
          ...(this.config.hostname === undefined ? {} : { host: this.config.hostname }),
          ...(this.config.port === undefined ? {} : { port: this.config.port }),
          connectTimeout: this.config.connectTimeoutMs,
          reconnectStrategy: false,
        },
      });
      attachment = this.attachNodeRedisErrorListener(rawClient, generation);
    } catch (error) {
      return Promise.reject(error);
    }

    const adapter = attachment.adapter;
    const attempt: RedisConnectionAttempt = {
      generation,
      client: adapter,
      cancel,
      promise: undefined as unknown as Promise<RedisAdapter>,
    };

    const connectPromise = Promise.resolve().then(() => rawClient.connect());
    let connectSettled = false;
    void connectPromise.then(
      () => {
        connectSettled = true;
      },
      () => {
        connectSettled = true;
      },
    );

    const work = (async (): Promise<RedisAdapter> => {
      try {
        if (this.config.debug) {
          logger.debug(
            `[RedisBackend] Connecting to ${this.config.hostname ?? "127.0.0.1"}:${
              this.config.port ?? 6379
            }`,
          );
        }

        await Promise.race([connectPromise, cancellation]);
        if (attachment.observedError()) {
          const error = new Error("Redis workflow connection emitted an error while opening");
          error.name = "RedisConnectionError";
          throw error;
        }
        if (
          this.lifecycleState !== "open" ||
          generation !== this.lifecycleGeneration ||
          this.connectionAttempt !== attempt
        ) {
          throw cancellationError;
        }

        this.client = adapter;
        this.pendingCloseClients.set(adapter, "quit");
        return adapter;
      } catch (connectionError) {
        const cancelledBeforeConnectSettled = connectionError === cancellationError &&
          !connectSettled;
        let firstCleanupError: unknown;
        try {
          await adapter.disconnect();
        } catch (cleanupError) {
          firstCleanupError = cleanupError;
        }

        let lateConnectSucceeded = false;
        if (cancelledBeforeConnectSettled) {
          const lateConnect = await Promise.allSettled([connectPromise]);
          lateConnectSucceeded = lateConnect[0]?.status === "fulfilled";
        }

        let finalCleanupError: unknown;
        if (firstCleanupError !== undefined || lateConnectSucceeded) {
          const cleanupAdapter = attachment.createCleanupAdapter();
          try {
            // A connect implementation may ignore the first destroy() and
            // resolve later, reopening the transport. Use a fresh adapter
            // close state so that late success is always followed by a second
            // force-close while sharing the same idempotent listener detach.
            await cleanupAdapter.disconnect();
          } catch (cleanupError) {
            finalCleanupError = cleanupError;
            this.pendingCloseClients.set(cleanupAdapter, "disconnect");
          }
        }

        if (finalCleanupError !== undefined) {
          if (this.lifecycleState === "open" && generation === this.lifecycleGeneration) {
            this.lifecycleState = "closing";
            this.lifecycleGeneration++;
            this.initialized = false;
          }
          throw new RedisLifecycleCleanupError(
            [
              connectionError,
              ...(firstCleanupError === undefined ? [] : [firstCleanupError]),
              finalCleanupError,
            ],
            "Redis workflow connection and provisional-client cleanup failed",
          );
        }
        throw connectionError;
      }
    })();

    attempt.promise = work;
    this.connectionAttempt = attempt;
    void attempt.promise.then(
      () => {
        if (this.connectionAttempt === attempt) this.connectionAttempt = null;
      },
      () => {
        if (this.connectionAttempt === attempt) this.connectionAttempt = null;
      },
    );
    return attempt.promise;
  }

  private startInitialization(): Promise<void> {
    const generation = this.lifecycleGeneration;
    const cancellationError = supersededError("initialization");
    let cancelled = false;
    let cancel!: () => void;
    const cancellation = new Promise<never>((_, reject) => {
      cancel = () => {
        if (cancelled) return;
        cancelled = true;
        reject(cancellationError);
      };
    });
    const attempt: RedisInitializationAttempt = {
      generation,
      cancel,
      promise: undefined as unknown as Promise<void>,
    };

    const work = (async () => {
      // Cancellation may win only before a command is issued. Once XGROUP is
      // in flight, destroy() closes the transport and joins the actual command
      // promise so no Redis work can outlive successful teardown.
      const client = await Promise.race([this.connectClient(), cancellation]);
      try {
        await client.xgroupCreate(this.config.streamKey, this.config.groupName, "0", true);
        if (this.config.debug) {
          logger.debug(`Created consumer group: ${this.config.groupName}`);
        }
      } catch (error) {
        // node-redis exposes the existing-group condition only through this
        // documented message prefix. Substrings elsewhere are real failures.
        if (!isBusyGroupError(error)) throw error;
      }

      if (
        this.lifecycleState !== "open" ||
        generation !== this.lifecycleGeneration ||
        this.initializationAttempt !== attempt ||
        this.client !== client
      ) {
        throw cancellationError;
      }
      this.initialized = true;
    })();

    attempt.promise = work;
    this.initializationAttempt = attempt;
    // Observe the retained promise internally: the synchronous provider may
    // start initialization without awaiting it, but failures must never become
    // unhandled or disappear from the next operation.
    void attempt.promise.then(
      () => {
        if (this.initializationAttempt !== attempt) return;
        this.initializationAttempt = null;
        this.initializationFailure = null;
      },
      (error) => {
        if (this.initializationAttempt !== attempt) return;
        this.initializationAttempt = null;
        if (this.lifecycleState === "open" && generation === this.lifecycleGeneration) {
          this.initializationFailure = { generation, error };
        }
      },
    );
    return attempt.promise;
  }

  initialize(): Promise<void> {
    try {
      this.assertOpen();
    } catch (error) {
      return Promise.reject(error);
    }

    if (this.initialized) return Promise.resolve();
    if (this.initializationAttempt) return this.initializationAttempt.promise;

    // A direct initialize() call is the explicit retry boundary after a
    // failed readiness generation. Ordinary operations replay the failure.
    this.initializationFailure = null;
    return this.startInitialization();
  }

  private closeTrackedClient(client: RedisAdapter): Promise<void> {
    if (this.closedClients.has(client)) return Promise.resolve();
    const existing = this.closePromises.get(client);
    if (existing) return existing;

    const mode = this.pendingCloseClients.get(client);
    if (!mode) return Promise.resolve();
    const pending = Promise.resolve().then(() =>
      mode === "quit" ? client.quit() : client.disconnect()
    );
    this.closePromises.set(client, pending);
    void pending.then(
      () => {
        if (this.closePromises.get(client) === pending) {
          this.closePromises.delete(client);
        }
        this.pendingCloseClients.delete(client);
        this.closedClients.add(client);
      },
      () => {
        if (this.closePromises.get(client) === pending) {
          this.closePromises.delete(client);
        }
      },
    );
    return pending;
  }

  async createRun(run: WorkflowRun): Promise<void> {
    const serializedRun = this.serializeRun(run);
    const client = await this.ensureClient();
    const nowMs = Date.now();
    assertValidRunTtl(this.config.runTtl, nowMs);

    if (this.config.debug) logger.debug(`[RedisBackend] Creating run: ${run.id}`);

    const fieldArgs = Object.entries(serializedRun).flatMap(([field, value]) => [field, value]);
    const created = await client.eval(
      CREATE_RUN_SCRIPT,
      [
        this.runKey(run.id),
        this.allRunsIndexKey(),
        this.workflowIndexKey(run.workflowId),
        this.statusIndexKey(run.status),
        this.workflowStatusIndexKey(run.workflowId, run.status),
        this.runWorkflowMetadataKey(),
        this.runStatusMetadataKey(),
        this.retentionIndexKey(),
        this.checkpointsKey(run.id),
        this.approvalsKey(run.id),
        this.claimKey(run.id),
        this.lockKey(run.id),
        this.timedWaitDeadlineIndexKey("delay"),
        this.timedWaitDeadlineIndexKey("event"),
        this.timedWaitClaimLeaseIndexKey(),
        this.timedWaitRowsMetadataKey(),
      ],
      [
        run.id,
        run.workflowId,
        run.status,
        String(this.config.runTtl ?? 0),
        String(run.createdAt.getTime()),
        this.workflowIndexPrefix(),
        this.statusIndexPrefix(),
        this.workflowStatusIndexPrefix(),
        String(Object.keys(serializedRun).length),
        ...fieldArgs,
        this.timedWaitClaimKeyPrefix(),
      ],
    );
    if (Number(created) !== 1) {
      throw WORKFLOW_RUN_CONFLICT.create({
        detail: `Workflow run already exists: ${run.id}`,
      });
    }
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    const client = await this.ensureClient();
    const snapshot = await this.readRunSnapshot(client, runId);
    if (!snapshot) return null;
    snapshot.run.pendingApprovals = snapshot.run.status === "waiting"
      ? snapshot.approvals.filter((approval) => approval.status === "pending")
      : [];
    return snapshot.run;
  }

  async updateRun(runId: string, patch: WorkflowRunUpdate): Promise<void> {
    assertWorkflowRunUpdate(patch);
    if (this.config.debug) logger.debug(`[RedisBackend] Updating run: ${runId}`);

    const updated = await this.updateRunConditionally(
      runId,
      [...WORKFLOW_STATUSES],
      patch,
    );
    if (!updated) {
      const client = await this.ensureClient();
      await this.cleanupMissingRun(client, runId);
      throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });
    }
  }

  async updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    patch: WorkflowRunUpdate,
  ): Promise<boolean> {
    return await this.updateRunConditionally(runId, expectedStatuses, patch);
  }

  async updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    patch: WorkflowRunUpdate,
  ): Promise<boolean> {
    assertWorkflowWorkerId(expectedWorkerId);
    return await this.updateRunConditionally(
      runId,
      expectedStatuses,
      patch,
      expectedWorkerId,
    );
  }

  async updateRunIfStatusAndLock(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    assertWorkflowLockId(lockId);
    if (expectedWorkerId !== undefined) assertWorkflowWorkerId(expectedWorkerId);
    return await this.updateRunConditionally(
      runId,
      expectedStatuses,
      patch,
      expectedWorkerId,
      lockId,
    );
  }

  private async updateRunConditionally(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
    expectedLockId?: string,
  ): Promise<boolean> {
    assertWorkflowRunUpdate(patch);
    const client = await this.ensureClient();
    const fields = this.serializeRunPatch(runId, patch);
    const fieldArgs = Object.entries(fields).flatMap(([field, value]) => [field, value]);
    const result = await client.eval(
      UPDATE_RUN_IF_STATUS_SCRIPT,
      [
        this.runKey(runId),
        this.claimKey(runId),
        this.runStatusMetadataKey(),
        this.lockKey(runId),
        this.timedWaitDeadlineIndexKey("delay"),
        this.timedWaitDeadlineIndexKey("event"),
        this.timedWaitClaimLeaseIndexKey(),
        this.timedWaitRowsMetadataKey(),
      ],
      [
        String(expectedStatuses.length),
        ...expectedStatuses,
        patch.status ?? "",
        this.statusIndexPrefix(),
        this.workflowStatusIndexPrefix(),
        runId,
        expectedWorkerId ?? "",
        expectedLockId ?? "",
        patch.status !== undefined || patch.nodeStates !== undefined || patch.workerId !== undefined
          ? "1"
          : "0",
        String(Object.keys(fields).length),
        ...fieldArgs,
        this.timedWaitClaimKeyPrefix(),
      ],
    );
    const code = requireRedisScriptInteger(result, "conditional run update");
    if (code === -1) {
      throw SERVICE_OVERLOADED.create({
        detail: `Workflow run index metadata is incomplete for run: ${runId}`,
      });
    }
    if (code === 1) return true;
    if (code === 0) return false;
    throw INVALID_ARGUMENT.create({
      detail: "Invalid Redis conditional run update response code",
    });
  }

  async deleteRun(runId: string): Promise<void> {
    const client = await this.ensureClient();
    await client.eval(
      DELETE_RUN_SCRIPT,
      this.cleanupKeys(runId),
      this.cleanupArgs(runId),
    );
    this.pendingMessageIds.delete(runId);
  }

  private selectRunIndexKeys(filter: RunFilter): string[] {
    const selectedStatuses = filter.status
      ? [...new Set(Array.isArray(filter.status) ? filter.status : [filter.status])]
      : null;
    const includesEveryStatus = selectedStatuses?.length === WORKFLOW_STATUSES.length &&
      WORKFLOW_STATUSES.every((status) => selectedStatuses.includes(status));

    if (selectedStatuses?.length === 0) return [];
    if (filter.workflowId) {
      if (!selectedStatuses || includesEveryStatus) {
        return [this.workflowIndexKey(filter.workflowId)];
      }
      return selectedStatuses.map((status) =>
        this.workflowStatusIndexKey(filter.workflowId!, status)
      );
    }
    if (!selectedStatuses || includesEveryStatus) return [this.allRunsIndexKey()];
    return selectedStatuses.map((status) => this.statusIndexKey(status));
  }

  private runScoreBounds(filter: RunFilter): { minScore: string; maxScore: string } {
    const { createdAfterMs: after, createdBeforeMs: before } = resolveRunDateBounds(filter);
    return {
      minScore: after === undefined ? "-inf" : String(after),
      maxScore: before === undefined ? "+inf" : String(before),
    };
  }

  private retentionQueryKeys(indexKeys: string[]): string[] {
    return [
      this.retentionIndexKey(),
      this.runWorkflowMetadataKey(),
      this.runStatusMetadataKey(),
      this.allRunsIndexKey(),
      this.timedWaitDeadlineIndexKey("delay"),
      this.timedWaitDeadlineIndexKey("event"),
      this.timedWaitClaimLeaseIndexKey(),
      this.timedWaitRowsMetadataKey(),
      ...indexKeys,
    ];
  }

  private retentionQueryArgs(): string[] {
    return [
      this.runKeyPrefix(),
      this.checkpointsKeyPrefix(),
      this.approvalsKeyPrefix(),
      this.claimKeyPrefix(),
      this.lockKeyPrefix(),
      this.workflowIndexPrefix(),
      this.statusIndexPrefix(),
      this.workflowStatusIndexPrefix(),
      String(RETENTION_CLEANUP_BATCH_SIZE),
      this.timedWaitClaimKeyPrefix(),
    ];
  }

  private throwRunQueryMaintenance(reason: unknown, processed: unknown): never {
    const cause = reason === "index-ghost"
      ? "an index ghost was repaired"
      : "the retention maintenance backlog exceeds one bounded cleanup pass";
    throw SERVICE_OVERLOADED.create({
      detail: `Workflow Redis retention maintenance backlog prevents an exact query: ${cause}; ` +
        `processed ${Number(processed)} entries. Run another bounded drain and retry.`,
    });
  }

  private parseRunSnapshotRow(row: unknown): RunSnapshot {
    if (!Array.isArray(row)) {
      throw INVALID_ARGUMENT.create({ detail: "Invalid Redis workflow run row" });
    }
    const hashFields = Array.isArray(row[0])
      ? row[0].filter((value): value is string => typeof value === "string")
      : [];
    const approvalRows = Array.isArray(row[1])
      ? row[1].filter((value): value is string => typeof value === "string")
      : [];
    return {
      run: this.deserializeRun(arrayToObject(hashFields)),
      approvals: approvalRows.map((approval) => this.parseApproval(approval)),
    };
  }

  private snapshotToRun({ run, approvals }: RunSnapshot): WorkflowRun {
    return {
      ...run,
      pendingApprovals: run.status === "waiting"
        ? approvals.filter((approval) => approval.status === "pending")
        : [],
    };
  }

  private async queryRunSnapshots(filter: RunFilter): Promise<RunSnapshot[]> {
    const { limit, offset } = resolveRunListPage(filter);
    const indexKeys = this.selectRunIndexKeys(filter);
    const { minScore, maxScore } = this.runScoreBounds(filter);
    const client = await this.ensureClient();
    const raw = await client.eval(
      LIST_RUNS_SCRIPT,
      this.retentionQueryKeys(indexKeys),
      [
        ...this.retentionQueryArgs(),
        maxScore,
        minScore,
        String(offset),
        String(limit),
        String(indexKeys.length),
      ],
    );
    if (!Array.isArray(raw) || Number(raw[0]) !== 1) {
      if (Array.isArray(raw)) this.throwRunQueryMaintenance(raw[2], raw[1]);
      throw INVALID_ARGUMENT.create({ detail: "Invalid Redis workflow run list response" });
    }
    const rows = Array.isArray(raw[2]) ? raw[2] : [];
    return rows.map((row) => this.parseRunSnapshotRow(row));
  }

  private async queryRunSnapshotCursorPage(
    filter: RunFilter,
    cursor: RunSnapshotCursor | null,
    limit = MAX_WORKFLOW_RUN_LIST_LIMIT,
  ): Promise<CursorRunSnapshotPage> {
    const indexKeys = this.selectRunIndexKeys(filter);
    if (indexKeys.length !== 1) {
      throw INVALID_ARGUMENT.create({
        detail: "Internal Redis workflow cursor queries require exactly one ordered index",
      });
    }
    const client = await this.ensureClient();
    const raw = await client.eval(
      CURSOR_LIST_RUNS_SCRIPT,
      this.retentionQueryKeys(indexKeys),
      [
        ...this.retentionQueryArgs(),
        cursor?.score ?? "",
        cursor?.member ?? "",
        String(limit),
      ],
    );
    if (!Array.isArray(raw) || Number(raw[0]) !== 1) {
      if (Array.isArray(raw)) this.throwRunQueryMaintenance(raw[2], raw[1]);
      throw INVALID_ARGUMENT.create({ detail: "Invalid Redis workflow run cursor response" });
    }

    const rows = Array.isArray(raw[2]) ? raw[2] : [];
    const nextScore = raw[3];
    const nextMember = raw[4];
    const resetValue = Number(raw[5]);
    if (
      typeof nextScore !== "string" ||
      typeof nextMember !== "string" ||
      (nextScore === "") !== (nextMember === "") ||
      (resetValue !== 0 && resetValue !== 1)
    ) {
      throw INVALID_ARGUMENT.create({ detail: "Invalid Redis workflow run cursor response" });
    }

    return {
      snapshots: rows.map((row) => this.parseRunSnapshotRow(row)),
      nextCursor: nextMember === "" ? null : { score: nextScore, member: nextMember },
      cursorReset: resetValue === 1,
    };
  }

  private async scanRunSnapshots(filter: RunFilter): Promise<RunSnapshot[]> {
    const snapshots: RunSnapshot[] = [];
    const seenRunIds = new Set<string>();
    let cursor: RunSnapshotCursor | null = null;
    let cursorRestarts = 0;

    while (true) {
      const page = await this.queryRunSnapshotCursorPage(filter, cursor);
      if (page.cursorReset && ++cursorRestarts > MAX_INTERNAL_CURSOR_RESTARTS) {
        throw SERVICE_OVERLOADED.create({
          detail:
            "Workflow Redis ordered index changed too frequently to complete a bounded cursor scan; retry the operation",
        });
      }
      for (const snapshot of page.snapshots) {
        if (seenRunIds.has(snapshot.run.id)) continue;
        seenRunIds.add(snapshot.run.id);
        snapshots.push(snapshot);
      }
      if (page.snapshots.length < MAX_WORKFLOW_RUN_LIST_LIMIT) return snapshots;
      if (!page.nextCursor) {
        throw INVALID_ARGUMENT.create({ detail: "Invalid Redis workflow run cursor response" });
      }
      cursor = page.nextCursor;
    }
  }

  async listRuns(filter: RunFilter): Promise<WorkflowRun[]> {
    const snapshots = await this.queryRunSnapshots(filter);
    return snapshots.map((snapshot) => this.snapshotToRun(snapshot));
  }

  async listRunsAfterCursor(filter: WorkflowRunCursorFilter): Promise<WorkflowRun[]> {
    const page = resolveWorkflowRunCursorPage(filter);
    const cursor = page.cursor
      ? { score: String(page.cursor.createdAtMs), member: page.cursor.runId }
      : null;
    const result = await this.queryRunSnapshotCursorPage(
      { status: filter.status },
      cursor,
      page.limit,
    );
    return result.snapshots.map((snapshot) => this.snapshotToRun(snapshot));
  }

  private async migrateTimedWaitIndex(client: RedisAdapter): Promise<void> {
    const raw = await client.eval(
      MIGRATE_TIMED_WAIT_INDEX_PAGE_SCRIPT,
      [this.statusIndexKey("waiting"), this.timedWaitMigrationCursorKey()],
      [String(TIMED_WAIT_MIGRATION_BATCH_SIZE), this.runKeyPrefix()],
    );
    if (!Array.isArray(raw)) {
      throw INVALID_ARGUMENT.create({ detail: "Invalid Redis timed-wait migration response" });
    }

    const backfillArgs: string[] = [];
    for (const row of raw) {
      if (!Array.isArray(row) || !row.every((value) => typeof value === "string")) {
        throw INVALID_ARGUMENT.create({ detail: "Invalid Redis timed-wait migration row" });
      }
      const run = this.deserializeRun(arrayToObject(row as string[]));
      backfillArgs.push(
        run.id,
        JSON.stringify(run.nodeStates),
        serializeTimedWaitIndex(run),
      );
    }
    if (backfillArgs.length === 0) return;

    const applied = await client.eval(
      BACKFILL_TIMED_WAIT_INDEX_SCRIPT,
      [
        this.timedWaitDeadlineIndexKey("delay"),
        this.timedWaitDeadlineIndexKey("event"),
        this.timedWaitRowsMetadataKey(),
        this.timedWaitClaimLeaseIndexKey(),
      ],
      [
        this.runKeyPrefix(),
        this.timedWaitClaimKeyPrefix(),
        String(backfillArgs.length / 3),
        ...backfillArgs,
      ],
    );
    const count = requireRedisScriptInteger(applied, "timed-wait migration backfill");
    if (count < 0 || count > backfillArgs.length / 3) {
      throw INVALID_ARGUMENT.create({
        detail: "Invalid Redis timed-wait migration backfill response code",
      });
    }
  }

  async claimDueTimedWaits(request: TimedWaitClaimRequest): Promise<TimedWaitClaim[]> {
    assertWorkflowWorkerId(request.ownerId);
    if (!Number.isSafeInteger(request.now)) {
      throw INVALID_ARGUMENT.create({ detail: "Timed-wait claim time must be a safe integer" });
    }
    if (
      !Number.isSafeInteger(request.limit) || request.limit <= 0 ||
      request.limit > MAX_TIMED_WAIT_CLAIM_BATCH_SIZE
    ) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Timed-wait claim limit must be an integer from 1 to ${MAX_TIMED_WAIT_CLAIM_BATCH_SIZE}`,
      });
    }
    if (
      !Number.isSafeInteger(request.leaseDuration) || request.leaseDuration <= 0 ||
      !Number.isSafeInteger(request.now + request.leaseDuration)
    ) {
      throw INVALID_ARGUMENT.create({
        detail: "Timed-wait claim lease duration must be a positive safe integer",
      });
    }
    if (request.waitKind !== "delay" && request.waitKind !== "event") {
      throw INVALID_ARGUMENT.create({ detail: "Timed-wait claim kind must be delay or event" });
    }

    const client = await this.ensureClient();
    await this.migrateTimedWaitIndex(client);
    const raw = await client.eval(
      CLAIM_DUE_TIMED_WAITS_SCRIPT,
      [
        this.timedWaitDeadlineIndexKey("delay"),
        this.timedWaitDeadlineIndexKey("event"),
        this.timedWaitClaimLeaseIndexKey(),
        this.timedWaitFenceKey(),
        this.timedWaitRowsMetadataKey(),
      ],
      [
        String(request.now),
        String(request.limit),
        String(request.leaseDuration),
        request.ownerId,
        this.runKeyPrefix(),
        this.timedWaitClaimKeyPrefix(),
        request.waitKind,
      ],
    );
    if (!Array.isArray(raw) || raw.length > request.limit) {
      throw INVALID_ARGUMENT.create({ detail: "Invalid Redis timed-wait claim response" });
    }

    return raw.map((row): TimedWaitClaim => {
      if (!Array.isArray(row) || row.length !== 5 || !Array.isArray(row[4])) {
        throw INVALID_ARGUMENT.create({ detail: "Invalid Redis timed-wait claim row" });
      }
      const [encodedIdentity, encodedDeadline, claimId, encodedExpiry, hashRow] = row;
      if (
        typeof encodedIdentity !== "string" || typeof encodedDeadline !== "string" ||
        typeof claimId !== "string" || typeof encodedExpiry !== "string" ||
        !(hashRow as unknown[]).every((value) => typeof value === "string")
      ) {
        throw INVALID_ARGUMENT.create({ detail: "Invalid Redis timed-wait claim row" });
      }
      const identity = safeJsonParse<[string, string]>(encodedIdentity);
      const deadline = Number(encodedDeadline);
      const leaseExpiresAtMs = Number(encodedExpiry);
      if (
        !identity.ok || !Array.isArray(identity.value) || identity.value.length !== 2 ||
        identity.value.some((value) => typeof value !== "string" || value.length === 0) ||
        !Number.isSafeInteger(deadline) || !Number.isSafeInteger(leaseExpiresAtMs)
      ) {
        throw INVALID_ARGUMENT.create({ detail: "Invalid Redis timed-wait claim row" });
      }
      const run = this.deserializeRun(arrayToObject(hashRow as string[]));
      if (run.id !== identity.value[0]) {
        throw INVALID_ARGUMENT.create({ detail: "Invalid Redis timed-wait claim identity" });
      }
      return {
        run: { ...run, pendingApprovals: [] },
        nodeId: identity.value[1],
        deadline,
        claimId,
        leaseExpiresAt: new Date(leaseExpiresAtMs),
        waitKind: request.waitKind,
      };
    });
  }

  async updateRunIfTimedWaitClaim(
    runId: string,
    nodeId: string,
    claimId: string,
    expectedDeadline: number,
    expectedWorkerId: string,
    patch: WorkflowRunUpdate,
  ): Promise<boolean> {
    assertWorkflowLockId(claimId);
    assertWorkflowWorkerId(expectedWorkerId);
    assertWorkflowRunUpdate(patch);
    const rowId = timedWaitRowId(runId, nodeId);
    if (!Number.isSafeInteger(expectedDeadline)) {
      throw INVALID_ARGUMENT.create({ detail: "Timed-wait deadline must be a safe integer" });
    }
    if (patch.status !== "pending" && patch.status !== "failed") {
      throw INVALID_ARGUMENT.create({
        detail: "Timed-wait claim updates must resolve the run to pending or failed",
      });
    }

    const fields = this.serializeRunPatch(runId, patch);
    const fieldArgs = Object.entries(fields).flatMap(([field, value]) => [field, value]);
    const result = await (await this.ensureClient()).eval(
      UPDATE_RUN_IF_TIMED_WAIT_CLAIM_SCRIPT,
      [
        this.runKey(runId),
        this.timedWaitClaimKey(rowId),
        this.timedWaitClaimLeaseIndexKey(),
        this.timedWaitDeadlineIndexKey("delay"),
        this.timedWaitDeadlineIndexKey("event"),
        this.runStatusMetadataKey(),
        this.timedWaitRowsMetadataKey(),
      ],
      [
        claimId,
        rowId,
        nodeId,
        String(expectedDeadline),
        expectedWorkerId,
        patch.status,
        this.statusIndexPrefix(),
        this.workflowStatusIndexPrefix(),
        runId,
        String(Object.keys(fields).length),
        ...fieldArgs,
        this.timedWaitClaimKeyPrefix(),
      ],
    );
    const code = requireRedisScriptInteger(result, "timed-wait claim update");
    if (code === -1) {
      throw SERVICE_OVERLOADED.create({
        detail: `Workflow run index metadata is incomplete for run: ${runId}`,
      });
    }
    if (code === 0 || code === 1) return code === 1;
    throw INVALID_ARGUMENT.create({ detail: "Invalid Redis timed-wait claim update response" });
  }

  async releaseTimedWaitClaim(
    runId: string,
    nodeId: string,
    claimId: string,
  ): Promise<boolean> {
    assertWorkflowLockId(claimId);
    const rowId = timedWaitRowId(runId, nodeId);
    return requireRedisScriptBoolean(
      await (await this.ensureClient()).eval(
        RELEASE_TIMED_WAIT_CLAIM_SCRIPT,
        [
          this.timedWaitDeadlineIndexKey("delay"),
          this.timedWaitDeadlineIndexKey("event"),
          this.timedWaitClaimLeaseIndexKey(),
          this.timedWaitClaimKey(rowId),
          this.runKey(runId),
        ],
        [claimId, rowId, nodeId],
      ),
      "timed-wait claim release",
    );
  }

  async countRuns(filter: RunFilter): Promise<number> {
    const indexKeys = this.selectRunIndexKeys(filter);
    const { minScore, maxScore } = this.runScoreBounds(filter);
    const client = await this.ensureClient();
    const raw = await client.eval(
      COUNT_RUNS_SCRIPT,
      this.retentionQueryKeys(indexKeys),
      [
        ...this.retentionQueryArgs(),
        maxScore,
        minScore,
        String(indexKeys.length),
      ],
    );
    if (!Array.isArray(raw) || Number(raw[0]) !== 1) {
      if (Array.isArray(raw)) this.throwRunQueryMaintenance(raw[2], raw[1]);
      throw INVALID_ARGUMENT.create({ detail: "Invalid Redis workflow run count response" });
    }
    return Number(raw[2]);
  }

  /** Process one bounded batch from the run-retention ledger. */
  async drainExpiredRuns(): Promise<RedisRetentionDrainResult> {
    return await this.cleanupExpiredRuns(await this.ensureClient());
  }

  async saveCheckpoint(runId: string, checkpoint: Checkpoint): Promise<void> {
    if (this.config.debug) logger.debug(`[RedisBackend] Saving checkpoint: ${checkpoint.id}`);

    await this.appendRunState(
      runId,
      this.checkpointsKey(runId),
      JSON.stringify({ ...checkpoint, timestamp: checkpoint.timestamp.toISOString() }),
    );
  }

  saveCheckpointIfStatusAndWorker(
    storageRunId: string,
    ownershipRunId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    checkpoint: Checkpoint,
  ): Promise<boolean> {
    return this.appendIfStatusAndWorker(
      ownershipRunId,
      expectedStatuses,
      expectedWorkerId,
      this.checkpointsKey(storageRunId),
      JSON.stringify({ ...checkpoint, timestamp: checkpoint.timestamp.toISOString() }),
    );
  }

  async getLatestCheckpoint(runId: string): Promise<Checkpoint | null> {
    const client = await this.ensureClient();
    const raw = await client.lindex(this.checkpointsKey(runId), -1);
    if (!raw) return null;

    const data = JSON.parse(raw);
    return { ...data, timestamp: new Date(data.timestamp) };
  }

  async getCheckpoints(runId: string): Promise<Checkpoint[]> {
    const client = await this.ensureClient();
    const rawList = await client.lrange(this.checkpointsKey(runId), 0, -1);

    return rawList.map((raw) => {
      const data = JSON.parse(raw);
      return { ...data, timestamp: new Date(data.timestamp) };
    });
  }

  async savePendingApproval(runId: string, approval: PendingApproval): Promise<void> {
    if (this.config.debug) logger.debug(`[RedisBackend] Saving approval: ${approval.id}`);

    const client = await this.ensureClient();
    const result = requireRedisScriptInteger(
      await client.eval(
        APPEND_UNIQUE_APPROVAL_SCRIPT,
        [this.runKey(runId), this.approvalsKey(runId)],
        [this.serializeApproval(approval)],
      ),
      "approval append",
    );
    if (result === 1) return;
    if (result === 2) {
      throw INVALID_ARGUMENT.create({
        detail: `Approval already exists for run "${runId}": ${approval.id}`,
      });
    }
    if (result === 3) {
      throw INVALID_ARGUMENT.create({
        detail: "Approval can be saved only while run is waiting",
      });
    }
    if (result === 0) {
      await this.cleanupMissingRun(client, runId);
      throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });
    }
    throw INVALID_ARGUMENT.create({ detail: "Invalid Redis approval append response code" });
  }

  async savePendingApprovalIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    approval: PendingApproval,
  ): Promise<boolean> {
    const client = await this.ensureClient();
    const result = requireRedisScriptInteger(
      await client.eval(
        APPEND_UNIQUE_APPROVAL_IF_STATUS_AND_WORKER_SCRIPT,
        [this.runKey(runId), this.approvalsKey(runId)],
        [
          String(expectedStatuses.length),
          ...expectedStatuses,
          expectedWorkerId,
          this.serializeApproval(approval),
        ],
      ),
      "owned approval append",
    );
    if (result === 1) return true;
    if (result === 0) return false;
    if (result === 2) {
      throw INVALID_ARGUMENT.create({
        detail: `Approval already exists for run "${runId}": ${approval.id}`,
      });
    }
    throw INVALID_ARGUMENT.create({ detail: "Invalid Redis owned approval append response code" });
  }

  private parseApproval(raw: string): PendingApproval {
    const data = JSON.parse(raw);
    return {
      ...data,
      requestedAt: new Date(data.requestedAt),
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      decidedAt: data.decidedAt ? new Date(data.decidedAt) : undefined,
    };
  }

  private async readRunSnapshot(
    client: RedisAdapter,
    runId: string,
  ): Promise<RunSnapshot | null> {
    const raw = await client.eval(
      READ_RUN_SNAPSHOT_SCRIPT,
      [this.runKey(runId), this.approvalsKey(runId)],
      [],
    );
    if (!Array.isArray(raw)) {
      throw INVALID_ARGUMENT.create({ detail: "Invalid Redis workflow run snapshot response" });
    }

    const hashFields = Array.isArray(raw[0])
      ? raw[0].filter((value): value is string => typeof value === "string")
      : [];
    if (hashFields.length === 0) {
      await this.cleanupMissingRun(client, runId);
      return null;
    }
    const approvalRows = Array.isArray(raw[1])
      ? raw[1].filter((value): value is string => typeof value === "string")
      : [];

    return {
      run: this.deserializeRun(arrayToObject(hashFields)),
      approvals: approvalRows.map((row) => this.parseApproval(row)),
    };
  }

  async getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    const client = await this.ensureClient();
    const snapshot = await this.readRunSnapshot(client, runId);
    if (!snapshot) return [];
    if (snapshot.run.status !== "waiting") return [];
    return snapshot.approvals.filter((approval) => approval.status === "pending");
  }

  async getApproval(runId: string, approvalId: string): Promise<PendingApproval | null> {
    const client = await this.ensureClient();
    const snapshot = await this.readRunSnapshot(client, runId);
    const matches = snapshot?.approvals.filter((approval) => approval.id === approvalId) ?? [];
    if (matches.length > 1) {
      throw INVALID_ARGUMENT.create({
        detail: `Duplicate approval id stored for run "${runId}": ${approvalId}`,
      });
    }
    return matches[0] ?? null;
  }

  async updatePendingApproval(
    runId: string,
    approvalId: string,
    patch: PendingApprovalMetadataUpdate,
  ): Promise<void> {
    const metadata = capturePendingApprovalMetadataUpdate(patch);
    const client = await this.ensureClient();
    // Locate and write in one Lua step, changing only notification metadata.
    const result = await client.eval(
      UPDATE_PENDING_APPROVAL_SCRIPT,
      [this.approvalsKey(runId)],
      [approvalId, metadata.notificationError],
    );
    const code = requireRedisScriptInteger(result, "approval metadata update");
    if (code === 2) {
      throw INVALID_ARGUMENT.create({
        detail: `Duplicate approval id stored for run "${runId}": ${approvalId}`,
      });
    }
    if (code === 0) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Approval not found: ${approvalId}` });
    }
    if (code !== 1) {
      throw INVALID_ARGUMENT.create({
        detail: "Invalid Redis approval metadata update response code",
      });
    }
  }

  async updateApproval(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
    timingInput: ApprovalDecisionTiming,
  ): Promise<boolean> {
    const timing = captureApprovalDecisionTiming(timingInput);
    const client = await this.ensureClient();
    const hasComment = decision.comment !== undefined;
    // Atomic find-by-id + pending-precondition + LSET (see UPDATE_APPROVAL_SCRIPT).
    // decidedAt is computed here so the stored value is deterministic and does
    // not depend on the Redis server clock.
    const result = await client.eval(
      UPDATE_APPROVAL_SCRIPT,
      [this.approvalsKey(runId), this.runKey(runId)],
      [
        approvalId,
        decision.approved ? "approved" : "rejected",
        decision.approver,
        timing.decidedAt.toISOString(),
        timing.expiryCondition,
        hasComment ? "1" : "0",
        hasComment ? decision.comment! : "",
      ],
    );
    const code = requireRedisScriptInteger(result, "approval decision");
    if (code === 0) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Approval not found: ${approvalId}` });
    }
    if (code === 3) {
      throw INVALID_ARGUMENT.create({
        detail: `Duplicate approval id stored for run "${runId}": ${approvalId}`,
      });
    }
    if (code === 4) {
      throw INVALID_ARGUMENT.create({
        detail: `Approval has an invalid persisted expiry: ${approvalId}`,
      });
    }
    if (code === 5) {
      throw INVALID_ARGUMENT.create({ detail: "Invalid Redis approval expiry condition" });
    }
    if (code === 1) return true;
    if (code === 2) return false;
    throw INVALID_ARGUMENT.create({ detail: "Invalid Redis approval decision response code" });
  }

  async listPendingApprovals(filter?: {
    workflowId?: string;
    approver?: string;
    status?: "pending" | "expired";
  }): Promise<Array<{ runId: string; approval: PendingApproval }>> {
    const result: Array<{ runId: string; approval: PendingApproval }> = [];
    const snapshots = await this.scanRunSnapshots({ workflowId: filter?.workflowId });
    for (const snapshot of snapshots) {
      if (snapshot.run.status !== "waiting") continue;
      const runId = snapshot.run.id;
      for (const approval of snapshot.approvals) {
        if (filter?.status === "pending" && approval.status !== "pending") continue;
        if (filter?.status === "expired") {
          const isExpired = approval.expiresAt && new Date() > approval.expiresAt;
          if (!isExpired) continue;
        }

        if (
          filter?.approver && approval.approvers && !approval.approvers.includes(filter.approver)
        ) {
          continue;
        }

        result.push({ runId, approval });
      }
    }

    return result;
  }

  async enqueue(job: WorkflowQueueItem): Promise<void> {
    const client = await this.ensureClient();

    if (this.config.debug) logger.debug(`[RedisBackend] Enqueueing job: ${job.runId}`);

    await client.xadd(this.config.streamKey, "*", {
      runId: job.runId,
      workflowId: job.workflowId,
      input: JSON.stringify(job.input),
      priority: String(job.priority || 0),
      createdAt: job.createdAt.toISOString(),
    });
  }

  async dequeue(): Promise<WorkflowQueueItem | null> {
    const client = await this.ensureClient();

    const streams = await client.xreadgroup([{ key: this.config.streamKey, xid: ">" }], {
      group: this.config.groupName,
      consumer: this.config.consumerName,
      block: 5000,
      count: 1,
    });

    const message = streams?.[0]?.messages?.[0];
    if (!message) return null;

    const data = message.data;
    const runId = data.runId ?? "";

    // Remember the stream message id so acknowledge()/nack() can XACK the exact
    // PEL entry. Without this the message stays pending forever and is
    // redelivered on the next consumer-group read (duplicate execution).
    if (runId) {
      const ids = this.pendingMessageIds.get(runId);
      if (ids) ids.push(message.id);
      else this.pendingMessageIds.set(runId, [message.id]);
    }

    return {
      runId,
      workflowId: data.workflowId ?? "",
      input: data.input ? JSON.parse(data.input) : undefined,
      priority: data.priority ? parseInt(data.priority) : undefined,
      createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
    };
  }

  async acknowledge(runId: string): Promise<void> {
    const messageIds = this.pendingMessageIds.get(runId);
    if (!messageIds || messageIds.length === 0) {
      // Nothing tracked in this process — the message was either already acked
      // or read by another consumer (its PEL entry is recovered via stalled-run
      // reclaim, not here). Nothing to do.
      if (this.config.debug) logger.debug(`[RedisBackend] Acknowledge (no pending): ${runId}`);
      return;
    }

    const client = await this.ensureClient();
    await client.xack(this.config.streamKey, this.config.groupName, ...messageIds);
    this.pendingMessageIds.delete(runId);

    if (this.config.debug) {
      logger.debug(`[RedisBackend] Acknowledged ${messageIds.length} message(s): ${runId}`);
    }
  }

  async nack(runId: string): Promise<void> {
    // XACK the consumed message first so it leaves the PEL; requeueRun then adds
    // a fresh stream entry. Skipping the ack would leave the old entry pending
    // AND the requeued copy, growing the PEL unbounded.
    await this.acknowledge(runId);
    await requeueRun(this, runId);
  }

  async acquireLock(runId: string, duration: number): Promise<string | null> {
    const client = await this.ensureClient();
    const lockValue = crypto.randomUUID();

    const result = await client.set(this.lockKey(runId), lockValue, { nx: true, px: duration });
    if (result === "OK") return lockValue;
    return null;
  }

  async releaseLock(runId: string, lockId: string): Promise<boolean> {
    const client = await this.ensureClient();
    const key = this.lockKey(runId);

    // Atomic GET + DEL via Lua so a stale owner cannot delete a lock that was
    // reacquired by another worker between the check and the delete (TOCTOU).
    return requireRedisScriptBoolean(
      await client.eval(RELEASE_LOCK_SCRIPT, [key], [lockId]),
      "lock release",
    );
  }

  async extendLock(runId: string, duration: number, lockId: string): Promise<boolean> {
    const client = await this.ensureClient();
    const key = this.lockKey(runId);

    // Atomic GET + PEXPIRE via Lua. PEXPIRE returns 1 when the key existed and
    // the TTL was set, 0 otherwise (e.g. our token no longer owns the lock).
    return requireRedisScriptBoolean(
      await client.eval(EXTEND_LOCK_SCRIPT, [key], [lockId, String(duration)]),
      "lock renewal",
    );
  }

  async isLocked(runId: string): Promise<boolean> {
    const client = await this.ensureClient();
    return (await client.exists(this.lockKey(runId))) > 0;
  }

  async findStalledRuns(stalledThreshold: number): Promise<WorkflowRun[]> {
    const runs = (await this.scanRunSnapshots({ status: "running" })).map((snapshot) =>
      this.snapshotToRun(snapshot)
    );
    const now = Date.now();

    return runs.filter((run) => {
      const lastActivity = run.heartbeatAt?.getTime() ?? run.startedAt?.getTime() ??
        run.createdAt.getTime();
      return now - lastActivity >= stalledThreshold;
    });
  }

  async claimStalledRun(
    runId: string,
    workerId: string,
    stalledThreshold: number,
  ): Promise<boolean> {
    const client = await this.ensureClient();
    const run = await this.getRun(runId);
    if (!run || run.status !== "running") {
      return false;
    }

    const now = Date.now();
    const lastActivity = run.heartbeatAt?.getTime() ?? run.startedAt?.getTime() ??
      run.createdAt.getTime();
    if (now - lastActivity < stalledThreshold) {
      return false;
    }

    const observedActivity = (run.heartbeatAt ?? run.startedAt ?? run.createdAt).toISOString();
    const claimed = await client.eval(
      CLAIM_STALLED_RUN_SCRIPT,
      [this.runKey(runId), this.claimKey(runId)],
      [observedActivity, workerId, String(stalledThreshold), new Date(now).toISOString()],
    );
    return Number(claimed) === 1;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.ensureClient();
      await client.set("__health_check__", "ok", { ex: 1 });
      return true;
    } catch (error) {
      logger.debug("Redis health check failed", { error });
      return false;
    }
  }

  destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    if (this.lifecycleState === "closed") return Promise.resolve();

    const initialization = this.initializationAttempt?.promise;
    const connection = this.connectionAttempt?.promise;
    const invalidationCleanup = this.invalidationCleanup ?? undefined;
    if (this.lifecycleState === "open") {
      this.lifecycleState = "closing";
      this.lifecycleGeneration++;
      this.initialized = false;
      this.initializationFailure = null;
      this.client = null;
      this.pendingMessageIds.clear();
    }
    // Attempts can still be present when connection cleanup itself moved the
    // backend to closing, so every destroy attempt snapshots and cancels them.
    this.initializationAttempt?.cancel();
    this.connectionAttempt?.cancel();

    const pending = this.performDestroy(initialization, connection, invalidationCleanup);
    this.destroyPromise = pending;
    void pending.then(
      () => {
        if (this.destroyPromise !== pending) return;
        this.lifecycleState = "closed";
        if (this.config.debug) logger.debug("[RedisBackend] Destroyed");
      },
      () => {
        if (this.destroyPromise === pending) this.destroyPromise = null;
      },
    );
    return pending;
  }

  private async performDestroy(
    initialization?: Promise<void>,
    connection?: Promise<RedisAdapter>,
    invalidationCleanup?: Promise<void>,
  ): Promise<void> {
    const clients = [...this.pendingCloseClients.keys()];
    const closeResults = await Promise.allSettled(
      clients.map((client) => Promise.resolve().then(() => this.closeTrackedClient(client))),
    );

    // Cancellation rejects these lifecycle promises by design. Joining them
    // prevents stale generations from outliving teardown; their operation
    // errors are already retained/observed at their original call boundary.
    const lifecycleResults = await Promise.allSettled([
      ...(initialization ? [initialization] : []),
      ...(connection ? [connection] : []),
      ...(invalidationCleanup ? [invalidationCleanup] : []),
    ]);

    const failures: unknown[] = closeResults.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    for (const result of lifecycleResults) {
      if (
        result.status === "rejected" && result.reason instanceof RedisLifecycleCleanupError &&
        !failures.includes(result.reason)
      ) {
        failures.push(result.reason);
      }
    }
    if (this.pendingCloseClients.size > 0 && failures.length === 0) {
      failures.push(new Error("Redis workflow backend still owns an unclosed client"));
    }
    if (failures.length > 0 || this.pendingCloseClients.size > 0) {
      throw new AggregateError(
        failures,
        "Redis workflow backend teardown failed; destroy() may be retried",
      );
    }
  }
}
