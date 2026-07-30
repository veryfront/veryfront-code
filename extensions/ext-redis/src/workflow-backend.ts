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
  MAX_WORKFLOW_RUN_LIST_LIMIT,
  type PendingApprovalMetadataUpdate,
  requeueRun,
  requireWorkflowSourceIntegrationPolicy,
  resolveRunDateBounds,
  resolveRunListPage,
  type WorkflowBackend,
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

/**
 * Atomically create a run hash, publish every index membership, and record its
 * retention horizon. Stale bookkeeping from an already-expired incarnation of
 * the same id is removed before the new run becomes visible.
 */
const CREATE_RUN_SCRIPT = `-- create-workflow-run-if-absent
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
if redis.call('exists', KEYS[1]) == 1 then return 0 end
local runId = ARGV[1]
local workflowPrefix = ARGV[2]
local statusPrefix = ARGV[3]
local workflowStatusPrefix = ARGV[4]
local workflowId = redis.call('hget', KEYS[7], runId)
local status = redis.call('hget', KEYS[8], runId)
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
local runId = ARGV[1]
local workflowPrefix = ARGV[2]
local statusPrefix = ARGV[3]
local workflowStatusPrefix = ARGV[4]
local workflowId = redis.call('hget', KEYS[1], 'workflowId')
if not workflowId or workflowId == '' then workflowId = redis.call('hget', KEYS[7], runId) end
local status = redis.call('hget', KEYS[1], 'status')
if not status or status == '' then status = redis.call('hget', KEYS[8], runId) end
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
local limit = tonumber(ARGV[9])
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
local function removeRun(runId)
  local workflowId = redis.call('hget', KEYS[2], runId)
  local status = redis.call('hget', KEYS[3], runId)
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
local maxScore = ARGV[10]
local minScore = ARGV[11]
local offset = tonumber(ARGV[12])
local limit = tonumber(ARGV[13])
local selectedCount = tonumber(ARGV[14])
local window = offset + limit
local byId = {}
for index = 1, selectedCount do
  local values = redis.call(
    'zrevrangebyscore',
    KEYS[4 + index],
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
local cursorScore = ARGV[10]
local cursorMember = ARGV[11]
local limit = tonumber(ARGV[12])
local start = 0
local reset = 0
if cursorMember ~= '' then
  local actualScore = redis.call('zscore', KEYS[5], cursorMember)
  if actualScore and tonumber(actualScore) == tonumber(cursorScore) then
    local rank = redis.call('zrevrank', KEYS[5], cursorMember)
    if rank then
      start = rank + 1
    else
      reset = 1
    end
  else
    reset = 1
  end
end
local values = redis.call('zrevrange', KEYS[5], start, start + limit - 1, 'withscores')
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
return {1, processed, snapshots, nextScore, nextMember, reset}`;

/** Exact filtered count from disjoint ordered indexes, without run hydration. */
const COUNT_RUNS_SCRIPT = `-- count-workflow-runs-exact
${RETENTION_CLEANUP_LUA}
local processed, hasMore = cleanupRetention()
if hasMore then return {0, processed, 'retention-backlog'} end
local maxScore = ARGV[10]
local minScore = ARGV[11]
local selectedCount = tonumber(ARGV[12])
local count = 0
for index = 1, selectedCount do
  count = count + redis.call('zcount', KEYS[4 + index], minScore, maxScore)
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
for i = expectedCount + 8, #ARGV, 2 do
  redis.call('hset', KEYS[1], ARGV[i], ARGV[i + 1])
end
if nextStatus ~= '' and nextStatus ~= 'running' then
  redis.call('del', KEYS[2])
  if expectedLockId ~= '' then redis.call('del', KEYS[4]) end
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
    ];
  }

  private cleanupArgs(runId: string): string[] {
    return [
      runId,
      this.workflowIndexPrefix(),
      this.statusIndexPrefix(),
      this.workflowStatusIndexPrefix(),
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

  private serializeRun(run: WorkflowRun): Record<string, string> {
    const sourceIntegrationPolicy = requireWorkflowSourceIntegrationPolicy(run);
    return {
      id: run.id,
      workflowId: run.workflowId,
      version: run.version || "",
      status: run.status,
      workerId: run.workerId || "",
      tenant: run._tenant ? JSON.stringify(run._tenant) : "",
      sourceIntegrationPolicy: JSON.stringify(sourceIntegrationPolicy),
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

  private serializeRunPatch(patch: WorkflowRunUpdate): Record<string, string> {
    const fields: Record<string, string> = {};
    if (patch.workerId !== undefined) fields.workerId = patch.workerId ?? "";
    if (patch.output !== undefined) fields.output = JSON.stringify(patch.output);
    if (patch.nodeStates !== undefined) fields.nodeStates = JSON.stringify(patch.nodeStates);
    if (patch.currentNodes !== undefined) fields.currentNodes = JSON.stringify(patch.currentNodes);
    if (patch.context !== undefined) fields.context = JSON.stringify(patch.context);
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

    return {
      id: data.id,
      workflowId: data.workflowId,
      version: data.version || undefined,
      status: status ?? "pending",
      workerId: data.workerId || undefined,
      _tenant: parseJsonOr(data.id, "tenant", data.tenant, undefined),
      sourceIntegrationPolicy,
      input: parseJsonOr(data.id, "input", data.input, undefined),
      output: parseJsonOr(data.id, "output", data.output, undefined),
      nodeStates: parseJsonOr(data.id, "nodeStates", data.nodeStates, {}),
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
    const fields = this.serializeRunPatch(patch);
    const fieldArgs = Object.entries(fields).flatMap(([field, value]) => [field, value]);
    const result = await client.eval(
      UPDATE_RUN_IF_STATUS_SCRIPT,
      [
        this.runKey(runId),
        this.claimKey(runId),
        this.runStatusMetadataKey(),
        this.lockKey(runId),
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
        ...fieldArgs,
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
        String(MAX_WORKFLOW_RUN_LIST_LIMIT),
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
