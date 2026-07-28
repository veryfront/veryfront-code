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
} from "../../types.ts";
import { assertWorkflowRunUpdate, type WorkflowBackend, type WorkflowRunUpdate } from "../types.ts";
import { agentLogger, safeJsonParse } from "#veryfront/utils";
import { requeueRun } from "../shared/requeue-run.ts";
import {
  INITIALIZATION_ERROR,
  INVALID_ARGUMENT,
  RESOURCE_NOT_FOUND,
  SERVICE_OVERLOADED,
  WORKFLOW_RUN_CONFLICT,
} from "#veryfront/errors";
import { requireWorkflowSourceIntegrationPolicy } from "../../source-integration-policy.ts";

import type { RedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";
import {
  arrayToObject,
  getRedisModule,
  NodeRedisAdapter,
} from "#veryfront/platform/adapters/redis/index.ts";

export type { RedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";
export type { RedisBackendConfig, RedisRetentionDrainResult } from "./types.ts";

import type {
  RedisBackendConfig,
  RedisBackendInternalConfig,
  RedisRetentionDrainResult,
} from "./types.ts";
import {
  MAX_WORKFLOW_RUN_LIST_LIMIT,
  resolveRunDateBounds,
  resolveRunListPage,
} from "../run-filter.ts";

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
for i = expectedCount + 7, #ARGV, 2 do
  redis.call('hset', KEYS[1], ARGV[i], ARGV[i + 1])
end
if nextStatus ~= '' and nextStatus ~= 'running' then
  redis.call('del', KEYS[2])
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

/**
 * Atomically patch metadata on the approval whose parsed `.id` matches, located
 * by scanning the list inside the script. This replaces the previous
 * lrange -> findIndex -> lset sequence, which was non-atomic: a concurrent
 * rpush/lset could shift the list between the read and the positional write, so
 * the LSET would clobber the wrong element.
 *
 * KEYS[1] = approvals list key
 * ARGV[1] = approval id
 * ARGV[2] = patch, JSON-encoded (date fields already ISO strings via toJSON)
 *
 * Returns 1 when the approval was found and patched, 0 when the id is absent.
 */
const UPDATE_PENDING_APPROVAL_SCRIPT = `-- conditional-approval-patch
local approvalId = ARGV[1]
local patch = cjson.decode(ARGV[2])
local len = redis.call('llen', KEYS[1])
for i = 0, len - 1 do
  local raw = redis.call('lindex', KEYS[1], i)
  if raw then
    local approval = cjson.decode(raw)
    if approval.id == approvalId then
      for k, v in pairs(patch) do approval[k] = v end
      approval.id = approvalId
      redis.call('lset', KEYS[1], i, cjson.encode(approval))
      return 1
    end
  end
end
return 0`;

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
 * ARGV[5] = "1" when a comment is provided, "0" otherwise
 * ARGV[6] = comment (ignored unless ARGV[5] == "1")
 *
 * Returns 1 when applied, 2 when the approval was found but no longer pending
 * (a lost race), 0 when the id is absent.
 */
const UPDATE_APPROVAL_SCRIPT = `-- conditional-approval-decision
local approvalId = ARGV[1]
local len = redis.call('llen', KEYS[1])
for i = 0, len - 1 do
  local raw = redis.call('lindex', KEYS[1], i)
  if raw then
    local approval = cjson.decode(raw)
    if approval.id == approvalId then
      if approval.status ~= 'pending' then return 2 end
      approval.status = ARGV[2]
      approval.decidedBy = ARGV[3]
      approval.decidedAt = ARGV[4]
      if ARGV[5] == '1' then approval.comment = ARGV[6] else approval.comment = nil end
      redis.call('lset', KEYS[1], i, cjson.encode(approval))
      return 1
    end
  end
end
return 0`;

/** Implement redis backend. */
export class RedisBackend implements WorkflowBackend {
  private client: RedisAdapter | null = null;
  private connectionPromise: Promise<RedisAdapter> | null = null;
  private config: RedisBackendInternalConfig;
  private initialized = false;
  /** Per-run lock tokens for ownership-checked release/extend (Redlock pattern). */
  private lockValues = new Map<string, string>();
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
      prefix: "vf:workflow:",
      streamKey: "vf:workflow:stream",
      groupName: "vf:workflow:workers",
      consumerName: `worker-${crypto.randomUUID().slice(0, 8)}`,
      debug: false,
      ...config,
    };
    this.config = {
      ...resolvedConfig,
      streamKey: appendStorageSchemaVersion(resolvedConfig.streamKey),
      groupName: appendStorageSchemaVersion(resolvedConfig.groupName),
    };

    if (config.client) this.client = config.client;
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

  private ensureClient(): Promise<RedisAdapter> {
    if (this.client) return Promise.resolve(this.client);

    if (!this.connectionPromise) {
      this.connectionPromise = this.createConnection().catch((error) => {
        this.connectionPromise = null;
        this.client = null;
        throw error;
      });
    }

    return this.connectionPromise;
  }

  private async createConnection(): Promise<RedisAdapter> {
    const { NodeRedis: nodeRedis } = await getRedisModule();

    if (this.config.debug) {
      logger.debug(
        `[RedisBackend] Connecting to ${this.config.hostname || "127.0.0.1"}:${
          this.config.port || 6379
        }`,
      );
    }

    if (nodeRedis) {
      const client = nodeRedis.createClient({
        url: this.config.url,
        socket: { host: this.config.hostname, port: this.config.port },
      });
      await client.connect();
      this.client = new NodeRedisAdapter(client);
      return this.client;
    }

    throw INITIALIZATION_ERROR.create({ detail: "No Redis client available for this runtime." });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const client = await this.ensureClient();

    try {
      await client.xgroupCreate(this.config.streamKey, this.config.groupName, "0", true);
      if (this.config.debug) {
        logger.debug(`Created consumer group: ${this.config.groupName}`);
      }
    } catch (e) {
      // The node-redis client surfaces "group already exists" only as a
      // BUSYGROUP-prefixed error message (no structured code is exposed through
      // our adapter), so substring matching is the only signal available. Any
      // other error is a genuine failure worth logging.
      const msg = String(e instanceof Error ? e.message : e);
      if (!msg.includes("BUSYGROUP")) {
        logger.error("Error creating consumer group:", e);
      }
    }

    this.initialized = true;
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
    snapshot.run.pendingApprovals = snapshot.approvals.filter(
      (approval) => approval.status === "pending",
    );
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
    return await this.updateRunConditionally(
      runId,
      expectedStatuses,
      patch,
      expectedWorkerId,
    );
  }

  private async updateRunConditionally(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    assertWorkflowRunUpdate(patch);
    const client = await this.ensureClient();
    const fields = this.serializeRunPatch(patch);
    const fieldArgs = Object.entries(fields).flatMap(([field, value]) => [field, value]);
    const result = await client.eval(
      UPDATE_RUN_IF_STATUS_SCRIPT,
      [this.runKey(runId), this.claimKey(runId), this.runStatusMetadataKey()],
      [
        String(expectedStatuses.length),
        ...expectedStatuses,
        patch.status ?? "",
        this.statusIndexPrefix(),
        this.workflowStatusIndexPrefix(),
        runId,
        expectedWorkerId ?? "",
        ...fieldArgs,
      ],
    );
    if (Number(result) === -1) {
      throw SERVICE_OVERLOADED.create({
        detail: `Workflow run index metadata is incomplete for run: ${runId}`,
      });
    }
    return Number(result) === 1;
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
      pendingApprovals: approvals.filter((approval) => approval.status === "pending"),
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

    await this.appendRunState(
      runId,
      this.approvalsKey(runId),
      this.serializeApproval(approval),
    );
  }

  savePendingApprovalIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    approval: PendingApproval,
  ): Promise<boolean> {
    return this.appendIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      this.approvalsKey(runId),
      this.serializeApproval(approval),
    );
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
    return snapshot.approvals.filter((approval) => approval.status === "pending");
  }

  async getPendingApproval(runId: string, approvalId: string): Promise<PendingApproval | null> {
    const approvals = await this.getPendingApprovals(runId);
    return approvals.find((a) => a.id === approvalId) || null;
  }

  async updatePendingApproval(
    runId: string,
    approvalId: string,
    patch: Partial<PendingApproval>,
  ): Promise<void> {
    const client = await this.ensureClient();
    // Locate-and-write in a single Lua step so a concurrent append/decision
    // cannot shift the list between a positional read and write. JSON.stringify
    // converts any Date fields on the patch to ISO strings via toJSON, matching
    // serializeApproval.
    const result = await client.eval(
      UPDATE_PENDING_APPROVAL_SCRIPT,
      [this.approvalsKey(runId)],
      [approvalId, JSON.stringify(patch)],
    );
    if (Number(result) !== 1) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Approval not found: ${approvalId}` });
    }
  }

  async updateApproval(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<boolean> {
    const client = await this.ensureClient();
    const hasComment = decision.comment !== undefined;
    // Atomic find-by-id + pending-precondition + LSET (see UPDATE_APPROVAL_SCRIPT).
    // decidedAt is computed here so the stored value is deterministic and does
    // not depend on the Redis server clock.
    const result = await client.eval(
      UPDATE_APPROVAL_SCRIPT,
      [this.approvalsKey(runId)],
      [
        approvalId,
        decision.approved ? "approved" : "rejected",
        decision.approver,
        new Date().toISOString(),
        hasComment ? "1" : "0",
        hasComment ? decision.comment! : "",
      ],
    );
    const code = Number(result);
    if (code === 0) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Approval not found: ${approvalId}` });
    }
    // 1 = applied; 2 = found but already decided (lost race).
    return code === 1;
  }

  async listPendingApprovals(filter?: {
    workflowId?: string;
    approver?: string;
    status?: "pending" | "expired";
  }): Promise<Array<{ runId: string; approval: PendingApproval }>> {
    const result: Array<{ runId: string; approval: PendingApproval }> = [];
    const snapshots = await this.scanRunSnapshots({ workflowId: filter?.workflowId });
    for (const snapshot of snapshots) {
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
    if (result === "OK") {
      // Remember our token so release/extend can verify ownership (Redlock).
      this.lockValues.set(runId, lockValue);
      return lockValue;
    }
    return null;
  }

  async releaseLock(runId: string, lockId?: string): Promise<void> {
    const client = await this.ensureClient();
    const key = this.lockKey(runId);
    const ourValue = lockId ?? this.lockValues.get(runId);

    // Only release if we still own the lock (compare-and-delete). Without a
    // known token we never owned it, so do nothing.
    if (ourValue === undefined) return;

    // Atomic GET + DEL via Lua so a stale owner cannot delete a lock that was
    // reacquired by another worker between the check and the delete (TOCTOU).
    await client.eval(RELEASE_LOCK_SCRIPT, [key], [ourValue]);
    if (this.lockValues.get(runId) === ourValue) this.lockValues.delete(runId);
  }

  async extendLock(runId: string, duration: number, lockId?: string): Promise<boolean> {
    const client = await this.ensureClient();
    const key = this.lockKey(runId);
    const ourValue = lockId ?? this.lockValues.get(runId);

    // Only extend if we still own the lock (compare-and-pexpire).
    if (ourValue === undefined) return false;

    // Atomic GET + PEXPIRE via Lua. PEXPIRE returns 1 when the key existed and
    // the TTL was set, 0 otherwise (e.g. our token no longer owns the lock).
    const result = await client.eval(EXTEND_LOCK_SCRIPT, [key], [
      ourValue,
      String(duration),
    ]);
    return Number(result) === 1;
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

  async destroy(): Promise<void> {
    if (this.client) {
      try {
        if (typeof this.client.quit === "function") await this.client.quit();
        else if (typeof this.client.disconnect === "function") await this.client.disconnect();
      } catch {
        // Ignore errors during cleanup — connection may already be closed
      }
      this.client = null;
    }

    this.connectionPromise = null;
    this.initialized = false;

    if (this.config.debug) logger.debug("[RedisBackend] Destroyed");
  }
}
