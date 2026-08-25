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
import {
  assertWorkflowRunUpdate,
  type WorkflowBackend,
  type WorkflowRunObservation,
  type WorkflowRunObservedState,
  type WorkflowRunUpdate,
} from "../types.ts";
import { agentLogger, safeJsonParse } from "#veryfront/utils";
import { prepareWorkflowJson, serializeWorkflowContext } from "../../context-serialization.ts";
import { requeueRun } from "../shared/requeue-run.ts";
import {
  INITIALIZATION_ERROR,
  INVALID_ARGUMENT,
  ORCHESTRATION_ERROR,
  RESOURCE_NOT_FOUND,
} from "#veryfront/errors";
import { requireWorkflowSourceIntegrationPolicy } from "../../source-integration-policy.ts";
import {
  MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES,
  MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES,
} from "../../limits.ts";

import type { RedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";
import { getRedisModule, NodeRedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";

export type { RedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";
export type { RedisBackendConfig } from "./types.ts";

import type { RedisBackendConfig, RedisBackendInternalConfig } from "./types.ts";

const logger = agentLogger.component("redis-backend");
const objectDefineProperty = Object.defineProperty;
const REDIS_STORAGE_SCHEMA_VERSION = "schema-v1";
const REDIS_STORAGE_SCHEMA_NAMESPACE = `${REDIS_STORAGE_SCHEMA_VERSION}:`;
const RUN_OBSERVATION_APPROVAL_SCHEMA_VERSION = "approvals-v1";
const RUN_OBSERVATION_REVISION_FIELD = "__runObservationRevision";
const RUN_OBSERVATION_STREAM_MAX_LENGTH = 64;
const RUN_OBSERVATION_APPROVAL_JOURNAL_RETENTION_MULTIPLIER = 2;
const RUN_OBSERVATION_POLL_INTERVAL_MS = 20;

function appendStorageSchemaVersion(base: string): string {
  return `${base.replace(/:+$/, "")}:${REDIS_STORAGE_SCHEMA_VERSION}`;
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
local revision = redis.call('hincrby', KEYS[1], '${RUN_OBSERVATION_REVISION_FIELD}', 1)
local status = redis.call('hget', KEYS[1], 'status')
local sourceNodes = cjson.decode(redis.call('hget', KEYS[1], 'nodeStates') or '{}')
local nodes = {}
for nodeId, node in pairs(sourceNodes) do
  local reduced = { status = node.status, attempt = node.attempt }
  if node.error ~= nil then reduced.error = node.error end
  nodes[nodeId] = reduced
end
local nodesJson = next(nodes) == nil and '{}' or cjson.encode(nodes)
local streamFields = { 'revision', tostring(revision), 'status', status, 'nodes', nodesJson }
local rawError = redis.call('hget', KEYS[1], 'error')
if rawError and rawError ~= '' then
  local runError = cjson.decode(rawError)
  if runError.message ~= nil then
    table.insert(streamFields, 'runError')
    table.insert(streamFields, runError.message)
  end
end
redis.call('xadd', ARGV[5], 'MAXLEN', '~', ARGV[6], '*', unpack(streamFields))
return 1`;

/**
 * Atomically move a run between status index sets and write its new status,
 * reading the previous status from the run hash inside the script. This closes
 * the read-then-write race where two concurrent updateRun() calls both read the
 * old status and then issue their own SREM/SADD, leaving the run in the wrong
 * status set (or in two at once).
 *
 * KEYS[1] = run hash key
 * ARGV[1] = runId
 * ARGV[2] = new status
 * ARGV[3] = status index key prefix (the status value is appended to it)
 *
 * The index keys are derived from ARGV (the old status is unknown to the
 * caller), so this assumes a single logical Redis, matching the lock scripts
 * above.
 */
const UPDATE_RUN_SCRIPT = `-- observable-run-update
if redis.call('exists', KEYS[1]) == 0 then return 0 end
local old = redis.call('hget', KEYS[1], 'status')
local nextStatus = ARGV[2]
if nextStatus ~= '' and old ~= nextStatus then
  redis.call('hset', KEYS[1], 'status', nextStatus)
  if old and old ~= '' then redis.call('srem', ARGV[3] .. old, ARGV[1]) end
  redis.call('sadd', ARGV[3] .. nextStatus, ARGV[1])
end
for i = 6, #ARGV, 2 do redis.call('hset', KEYS[1], ARGV[i], ARGV[i + 1]) end
local revision = redis.call('hincrby', KEYS[1], '${RUN_OBSERVATION_REVISION_FIELD}', 1)
local status = redis.call('hget', KEYS[1], 'status')
local rawNodes = redis.call('hget', KEYS[1], 'nodeStates') or '{}'
local sourceNodes = cjson.decode(rawNodes)
local nodes = {}
for nodeId, node in pairs(sourceNodes) do
  local reduced = { status = node.status, attempt = node.attempt }
  if node.error ~= nil then reduced.error = node.error end
  nodes[nodeId] = reduced
end
local nodesJson = next(nodes) == nil and '{}' or cjson.encode(nodes)
local fields = { 'revision', tostring(revision), 'status', status, 'nodes', nodesJson }
local rawError = redis.call('hget', KEYS[1], 'error')
if rawError and rawError ~= '' then
  local runError = cjson.decode(rawError)
  if runError.message ~= nil then
    table.insert(fields, 'runError')
    table.insert(fields, runError.message)
  end
end
redis.call('xadd', ARGV[4], 'MAXLEN', '~', ARGV[5], '*', unpack(fields))
return revision`;

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
local runId = ARGV[expectedCount + 4]
local expectedWorkerId = ARGV[expectedCount + 5]
if expectedWorkerId ~= '' and redis.call('hget', KEYS[1], 'workerId') ~= expectedWorkerId then
  return 0
end
if nextStatus ~= '' and old ~= nextStatus then
  redis.call('hset', KEYS[1], 'status', nextStatus)
  redis.call('srem', statusPrefix .. old, runId)
  redis.call('sadd', statusPrefix .. nextStatus, runId)
end
local streamKey = ARGV[expectedCount + 6]
local maxLength = ARGV[expectedCount + 7]
for i = expectedCount + 8, #ARGV, 2 do
  redis.call('hset', KEYS[1], ARGV[i], ARGV[i + 1])
end
local revision = redis.call('hincrby', KEYS[1], '${RUN_OBSERVATION_REVISION_FIELD}', 1)
local status = redis.call('hget', KEYS[1], 'status')
local sourceNodes = cjson.decode(redis.call('hget', KEYS[1], 'nodeStates') or '{}')
local nodes = {}
for nodeId, node in pairs(sourceNodes) do
  local reduced = { status = node.status, attempt = node.attempt }
  if node.error ~= nil then reduced.error = node.error end
  nodes[nodeId] = reduced
end
local nodesJson = next(nodes) == nil and '{}' or cjson.encode(nodes)
local streamFields = { 'revision', tostring(revision), 'status', status, 'nodes', nodesJson }
local rawError = redis.call('hget', KEYS[1], 'error')
if rawError and rawError ~= '' then
  local runError = cjson.decode(rawError)
  if runError.message ~= nil then
    table.insert(streamFields, 'runError')
    table.insert(streamFields, runError.message)
  end
end
redis.call('xadd', streamKey, 'MAXLEN', '~', maxLength, '*', unpack(streamFields))
return 1`;

/** Atomically capture the run hash and journal revision used as the observation baseline. */
const OPEN_RUN_OBSERVATION_SCRIPT = `-- open-run-observation
local raw = redis.call('hgetall', KEYS[1])
if #raw == 0 then return nil end
local run = {}
for i = 1, #raw, 2 do run[raw[i]] = raw[i + 1] end
return { tostring(run['${RUN_OBSERVATION_REVISION_FIELD}'] or '0'), cjson.encode(run) }`;

const TERMINAL_RUN_STATUSES = new Set<WorkflowStatus>(["completed", "failed", "cancelled"]);

function parseRunObservedState(data: Record<string, string>): WorkflowRunObservedState {
  const allowedFields = new Set(["revision", "status", "nodes", "runError"]);
  if (Object.keys(data).some((field) => !allowedFields.has(field))) {
    throw new Error("Invalid workflow run observation record");
  }
  const revision = Number(data.revision);
  const validStatuses: WorkflowStatus[] = [
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled",
    "waiting",
  ];
  if (
    !Number.isSafeInteger(revision) || revision < 0 ||
    !validStatuses.includes(data.status as WorkflowStatus)
  ) {
    throw new Error("Invalid workflow run observation record");
  }
  const parsedNodes = JSON.parse(data.nodes ?? "null") as unknown;
  if (!parsedNodes || typeof parsedNodes !== "object" || Array.isArray(parsedNodes)) {
    throw new Error("Invalid workflow run observation record");
  }
  const nodes: WorkflowRunObservedState["nodes"] = {};
  for (const [nodeId, value] of Object.entries(parsedNodes)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid workflow run observation record");
    }
    const node = value as Record<string, unknown>;
    const validNodeStatuses = ["pending", "running", "completed", "failed", "skipped"];
    if (
      Object.keys(node).some((field) => !["status", "attempt", "error"].includes(field)) ||
      typeof node.status !== "string" || !validNodeStatuses.includes(node.status) ||
      !Number.isSafeInteger(node.attempt) || (node.attempt as number) < 0 ||
      (node.error !== undefined && typeof node.error !== "string")
    ) {
      throw new Error("Invalid workflow run observation record");
    }
    objectDefineProperty(nodes, nodeId, {
      value: {
        status: node.status as WorkflowRunObservedState["nodes"][string]["status"],
        attempt: node.attempt as number,
        ...(node.error !== undefined ? { error: node.error } : {}),
      },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  if (data.runError !== undefined && typeof data.runError !== "string") {
    throw new Error("Invalid workflow run observation record");
  }
  return {
    revision,
    status: data.status as WorkflowStatus,
    nodes,
    ...(data.runError !== undefined ? { runError: data.runError } : {}),
  };
}

function parseRunObservedApprovals(
  data: string,
): NonNullable<WorkflowRunObservedState["approvals"]> {
  const parsedApprovals = JSON.parse(data) as unknown;
  if (!Array.isArray(parsedApprovals)) {
    throw new Error("Invalid workflow run approval observation record");
  }
  return parsedApprovals.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid workflow run approval observation record");
    }
    const entry = value as Record<string, unknown>;
    if (
      Object.keys(entry).some((field) => !["id", "nodeId", "message"].includes(field)) ||
      typeof entry.id !== "string" || typeof entry.nodeId !== "string" ||
      (entry.message !== undefined && typeof entry.message !== "string")
    ) {
      throw new Error("Invalid workflow run approval observation record");
    }
    return {
      id: entry.id,
      nodeId: entry.nodeId,
      ...(entry.message !== undefined ? { message: entry.message } : {}),
    };
  });
}

function projectPendingApprovals(
  approvals: PendingApproval[],
): NonNullable<WorkflowRunObservedState["approvals"]> {
  return projectObservableApprovals(approvals.filter((approval) => approval.status === "pending"));
}

function projectObservableApprovals(
  approvals: PendingApproval[],
): NonNullable<WorkflowRunObservedState["approvals"]> {
  return approvals.map((approval) => ({
    id: approval.id,
    nodeId: approval.nodeId,
    ...(approval.message !== undefined ? { message: approval.message } : {}),
  }));
}

function serializeInitialRunObservation(run: WorkflowRun): Record<string, string> {
  const nodes: WorkflowRunObservedState["nodes"] = {};
  for (const [nodeId, node] of Object.entries(run.nodeStates)) {
    nodes[nodeId] = {
      status: node.status,
      attempt: node.attempt,
      ...(node.error !== undefined ? { error: node.error } : {}),
    };
  }
  return {
    revision: "0",
    status: run.status,
    nodes: JSON.stringify(nodes),
    ...(run.error?.message !== undefined ? { runError: run.error.message } : {}),
  };
}

function waitForObservationPoll(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(finish, RUN_OBSERVATION_POLL_INTERVAL_MS);
    function finish(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Atomically append and retain only the newest bounded list entries. */
const APPEND_RETAINED_LIST_SCRIPT = `-- retained-list-append
redis.call('rpush', KEYS[1], ARGV[1])
redis.call('ltrim', KEYS[1], -tonumber(ARGV[2]), -1)
return redis.call('llen', KEYS[1])`;

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
local storageKey = ARGV[expectedCount + 3]
redis.call('rpush', storageKey, ARGV[expectedCount + 4])
local maxEntries = tonumber(ARGV[expectedCount + 5])
if maxEntries then redis.call('ltrim', storageKey, -maxEntries, -1) end
return 1`;

/**
 * State-aware retention for the per-run approval list, shared by the approval
 * append scripts. The list is append-only (decisions rewrite records in
 * place), so a live pending approval must never be evicted: a run waiting on
 * an evicted ID could never be decided or expired and would wait forever. At
 * the bound this evicts the oldest decided record. An expired record remains
 * pending until expiration reconciliation decides it, so it cannot be evicted
 * safely. The routine reports failure when there are not enough decided
 * records to make room, so the caller can reject the append without changing
 * existing history instead of silently dropping a decidable approval.
 */
const RETAIN_APPROVALS_LUA = `local function retainApprovals(key, maxEntries)
  local len = redis.call('llen', key)
  local evictionsRequired = len - maxEntries + 1
  if evictionsRequired <= 0 then return true end
  local decidedIndexes = {}
  for i = 0, len - 1 do
    local raw = redis.call('lindex', key, i)
    if raw then
      local approval = cjson.decode(raw)
      if approval.status ~= 'pending' then
        table.insert(decidedIndexes, i)
        if #decidedIndexes == evictionsRequired then break end
      end
    end
  end
  if #decidedIndexes < evictionsRequired then return false end
  for _, index in ipairs(decidedIndexes) do
    redis.call('lset', key, index, '__vf_evicted__')
  end
  redis.call('lrem', key, 0, '__vf_evicted__')
  return true
end`;

const JOURNAL_APPROVAL_PROJECTION_LUA = `local function journalApprovalProjection(
  key,
  runKey,
  revision,
  approvalsJson,
  maxLength
)
  redis.call('hset', key, tostring(revision), approvalsJson)
  local oldestRetainedRevision = revision - (maxLength * ${RUN_OBSERVATION_APPROVAL_JOURNAL_RETENTION_MULTIPLIER})
  if oldestRetainedRevision > 0 then
    local storedRevisions = redis.call('hkeys', key)
    for _, storedRevision in ipairs(storedRevisions) do
      if tonumber(storedRevision) <= oldestRetainedRevision then
        redis.call('hdel', key, storedRevision)
      end
    end
  end
  local runTtl = redis.call('pttl', runKey)
  if runTtl > 0 then redis.call('pexpire', key, runTtl) end
end`;

/**
 * Atomically append a pending approval and journal it as its own observation
 * revision. The run-mutation scripts above publish node/status transitions,
 * but an approval append changes what a `waiting` run is blocked on without
 * touching the run hash, so it must bump `__runObservationRevision` and XADD
 * itself or subscribers only learn of the approval by re-fetching (and even an
 * immediate fetch races this write, because the run flips to `waiting` before
 * the approval exists).
 *
 * A versioned companion journal reduces the approvals list to pending
 * id/nodeId/message projections; approval payloads never enter either record.
 * The existing schema-v1 stream stays unchanged for rolling compatibility.
 *
 * KEYS[1] = run hash key
 * KEYS[2] = approvals list key
 * KEYS[3] = versioned approval observation journal key
 * ARGV[1] = serialized approval
 * ARGV[2] = max approval entries
 * ARGV[3] = observation stream key
 * ARGV[4] = observation stream max length
 *
 * Returns 1 when the append was journaled, 0 when the run hash is absent (the
 * approval is still appended, preserving the unconditional-save contract),
 * and 2 when insufficient decided history can be evicted. Retention preflight,
 * append, revision increment, and journal write all happen atomically.
 */
const SAVE_PENDING_APPROVAL_SCRIPT = `-- observable-approval-append
${RETAIN_APPROVALS_LUA}
${JOURNAL_APPROVAL_PROJECTION_LUA}
if not retainApprovals(KEYS[2], tonumber(ARGV[2])) then return 2 end
redis.call('rpush', KEYS[2], ARGV[1])
if redis.call('exists', KEYS[1]) == 0 then return 0 end
local revision = redis.call('hincrby', KEYS[1], '${RUN_OBSERVATION_REVISION_FIELD}', 1)
local status = redis.call('hget', KEYS[1], 'status')
local sourceNodes = cjson.decode(redis.call('hget', KEYS[1], 'nodeStates') or '{}')
local nodes = {}
for nodeId, node in pairs(sourceNodes) do
  local reduced = { status = node.status, attempt = node.attempt }
  if node.error ~= nil then reduced.error = node.error end
  nodes[nodeId] = reduced
end
local nodesJson = next(nodes) == nil and '{}' or cjson.encode(nodes)
local rawApprovals = redis.call('lrange', KEYS[2], 0, -1)
local pending = {}
for i = 1, #rawApprovals do
  local candidate = cjson.decode(rawApprovals[i])
  if candidate.status == 'pending' then
    local entry = { id = candidate.id, nodeId = candidate.nodeId }
    if candidate.message ~= nil then entry.message = candidate.message end
    pending[#pending + 1] = entry
  end
end
local approvalsJson = #pending == 0 and '[]' or cjson.encode(pending)
journalApprovalProjection(KEYS[3], KEYS[1], revision, approvalsJson, tonumber(ARGV[4]))
local streamFields = { 'revision', tostring(revision), 'status', status, 'nodes', nodesJson }
local rawError = redis.call('hget', KEYS[1], 'error')
if rawError and rawError ~= '' then
  local runError = cjson.decode(rawError)
  if runError.message ~= nil then
    table.insert(streamFields, 'runError')
    table.insert(streamFields, runError.message)
  end
end
redis.call('xadd', ARGV[3], 'MAXLEN', ARGV[4], '*', unpack(streamFields))
return 1`;

/**
 * Ownership-checked variant of the script above: verify status and worker
 * ownership, then append and journal in the same atomic step. A denied append
 * must not bump the revision, or readers wait on a record that never comes.
 *
 * KEYS[1] = run hash key
 * KEYS[2] = approvals list key
 * KEYS[3] = versioned approval observation journal key
 * ARGV[1] = expected status count
 * ARGV[2..n+1] = expected statuses
 * ARGV[n+2] = expected worker id
 * ARGV[n+3] = serialized approval
 * ARGV[n+4] = max approval entries
 * ARGV[n+5] = observation stream key
 * ARGV[n+6] = observation stream max length
 *
 * Returns 1 when appended and journaled, 0 when the ownership fence fails,
 * and 2 when insufficient decided history can be evicted.
 */
const SAVE_PENDING_APPROVAL_IF_OWNED_SCRIPT = `-- conditional-owned-approval-append
${RETAIN_APPROVALS_LUA}
${JOURNAL_APPROVAL_PROJECTION_LUA}
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
if not retainApprovals(KEYS[2], tonumber(ARGV[expectedCount + 4])) then
  return 2
end
redis.call('rpush', KEYS[2], ARGV[expectedCount + 3])
local revision = redis.call('hincrby', KEYS[1], '${RUN_OBSERVATION_REVISION_FIELD}', 1)
local sourceNodes = cjson.decode(redis.call('hget', KEYS[1], 'nodeStates') or '{}')
local nodes = {}
for nodeId, node in pairs(sourceNodes) do
  local reduced = { status = node.status, attempt = node.attempt }
  if node.error ~= nil then reduced.error = node.error end
  nodes[nodeId] = reduced
end
local nodesJson = next(nodes) == nil and '{}' or cjson.encode(nodes)
local rawApprovals = redis.call('lrange', KEYS[2], 0, -1)
local pending = {}
for i = 1, #rawApprovals do
  local candidate = cjson.decode(rawApprovals[i])
  if candidate.status == 'pending' then
    local entry = { id = candidate.id, nodeId = candidate.nodeId }
    if candidate.message ~= nil then entry.message = candidate.message end
    pending[#pending + 1] = entry
  end
end
local approvalsJson = #pending == 0 and '[]' or cjson.encode(pending)
journalApprovalProjection(
  KEYS[3],
  KEYS[1],
  revision,
  approvalsJson,
  tonumber(ARGV[expectedCount + 6])
)
local streamFields = { 'revision', tostring(revision), 'status', status, 'nodes', nodesJson }
local rawError = redis.call('hget', KEYS[1], 'error')
if rawError and rawError ~= '' then
  local runError = cjson.decode(rawError)
  if runError.message ~= nil then
    table.insert(streamFields, 'runError')
    table.insert(streamFields, runError.message)
  end
end
redis.call('xadd', ARGV[expectedCount + 5], 'MAXLEN', ARGV[expectedCount + 6], '*', unpack(streamFields))
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
  private runObservationClosers = new Set<() => void>();

  constructor(config: RedisBackendConfig = {}) {
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
    return `${this.storagePrefix()}run:${runId}`;
  }

  private checkpointsKey(runId: string): string {
    return `${this.storagePrefix()}checkpoints:${runId}`;
  }

  private approvalsKey(runId: string): string {
    return `${this.storagePrefix()}approvals:${runId}`;
  }

  private runObservationKey(runId: string): string {
    return `${this.storagePrefix()}run-observation:${runId}`;
  }

  private runObservationApprovalsKey(runId: string): string {
    return `${this.storagePrefix()}run-observation-${RUN_OBSERVATION_APPROVAL_SCHEMA_VERSION}:${runId}`;
  }

  private statusIndexKey(status: WorkflowStatus): string {
    return `${this.storagePrefix()}index:status:${status}`;
  }

  private workflowIndexKey(workflowId: string): string {
    return `${this.storagePrefix()}index:workflow:${workflowId}`;
  }

  /**
   * Set of every run id. Maintained on create/delete so unfiltered listRuns and
   * countRuns can enumerate runs via SMEMBERS instead of a keyspace-wide
   * KEYS scan (which blocks the Redis event loop).
   */
  private allRunsIndexKey(): string {
    return `${this.storagePrefix()}index:runs`;
  }

  /** Enumerate only runs explicitly indexed in the current storage schema. */
  private enumerateAllRunIds(client: RedisAdapter): Promise<string[]> {
    return client.smembers(this.allRunsIndexKey());
  }

  private lockKey(runId: string): string {
    return `${this.storagePrefix()}lock:${runId}`;
  }

  private claimKey(runId: string): string {
    return `${this.storagePrefix()}claim:${runId}`;
  }

  private serializeRun(run: WorkflowRun): Record<string, string> {
    const sourceIntegrationPolicy = requireWorkflowSourceIntegrationPolicy(run);
    // Encoded before the fields below, on purpose. A step's return value reaches
    // `input`, `output`, and `nodeStates` as well, and those are encoded by
    // `JSON.stringify`, so whichever runs first decides the error a caller sees.
    const context = serializeWorkflowContext(run.context, run.id);
    return {
      id: run.id,
      workflowId: run.workflowId,
      version: run.version || "",
      status: run.status,
      workerId: run.workerId || "",
      tenant: run._tenant ? JSON.stringify(run._tenant) : "",
      traceContext: run._traceContext || "",
      sourceIntegrationPolicy: JSON.stringify(sourceIntegrationPolicy),
      input: JSON.stringify(run.input),
      output: run.output !== undefined ? JSON.stringify(run.output) : "",
      nodeStates: JSON.stringify(run.nodeStates),
      currentNodes: JSON.stringify(run.currentNodes),
      context,
      error: run.error ? JSON.stringify(run.error) : "",
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() || "",
      heartbeatAt: run.heartbeatAt?.toISOString() || "",
      completedAt: run.completedAt?.toISOString() || "",
      [RUN_OBSERVATION_REVISION_FIELD]: "0",
    };
  }

  private serializeRunPatch(patch: WorkflowRunUpdate, runId?: string): Record<string, string> {
    // Encoded before the fields below for the same reason as in `serializeRun`:
    // `output` and `nodeStates` carry the same step values, and the field that
    // is encoded first decides the error a caller sees.
    //
    // `runId` is passed so a lossy-value warning names the run it came from.
    // Patches are where warnings actually fire, because creation usually writes
    // only `input` while patches write the accumulated node outputs.
    const context = patch.context !== undefined
      ? serializeWorkflowContext(patch.context, runId)
      : undefined;
    const fields: Record<string, string> = {};
    if (Object.hasOwn(patch, "workerId")) fields.workerId = patch.workerId ?? "";
    if (Object.hasOwn(patch, "output")) {
      fields.output = patch.output !== undefined ? JSON.stringify(patch.output) : "";
    }
    if (patch.nodeStates !== undefined) fields.nodeStates = JSON.stringify(patch.nodeStates);
    if (patch.currentNodes !== undefined) fields.currentNodes = JSON.stringify(patch.currentNodes);
    if (context !== undefined) fields.context = context;
    if (Object.hasOwn(patch, "error")) {
      fields.error = patch.error ? JSON.stringify(patch.error) : "";
    }
    if (Object.hasOwn(patch, "startedAt")) {
      fields.startedAt = patch.startedAt?.toISOString() ?? "";
    }
    if (Object.hasOwn(patch, "heartbeatAt")) {
      fields.heartbeatAt = patch.heartbeatAt?.toISOString() ?? "";
    }
    if (Object.hasOwn(patch, "completedAt")) {
      fields.completedAt = patch.completedAt?.toISOString() ?? "";
    }
    if (Object.hasOwn(patch, "_traceContext")) {
      fields.traceContext = patch._traceContext ?? "";
    }
    return fields;
  }

  private serializeCheckpoint(runId: string, checkpoint: Checkpoint): string {
    // Checked before the rest of the checkpoint is encoded below, so a value
    // JSON refuses is named by its path rather than by the native error.
    const { normalized: context } = prepareWorkflowJson(
      checkpoint.context,
      "checkpoint.context",
      runId,
    );
    return JSON.stringify({
      ...checkpoint,
      context,
      timestamp: checkpoint.timestamp.toISOString(),
    });
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
    maxEntries?: number,
  ): Promise<boolean> {
    const client = await this.ensureClient();
    const result = await client.eval(
      APPEND_IF_STATUS_AND_WORKER_SCRIPT,
      [this.runKey(ownershipRunId)],
      [
        String(expectedStatuses.length),
        ...expectedStatuses,
        expectedWorkerId,
        storageKey,
        value,
        maxEntries === undefined ? "" : String(maxEntries),
      ],
    );
    return Number(result) === 1;
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

    const validStatuses: WorkflowStatus[] = [
      "pending",
      "running",
      "completed",
      "failed",
      "cancelled",
      "waiting",
    ];

    const status = data.status as WorkflowStatus;
    if (data.status && !validStatuses.includes(status)) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Invalid workflow run data for run "${data.id}": unknown status "${data.status}". ` +
          `Expected one of: ${validStatuses.join(", ")}`,
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
      _traceContext: data.traceContext || undefined,
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

    if (this.config.debug) logger.debug(`[RedisBackend] Creating run: ${run.id}`);

    await client.hset(this.runKey(run.id), serializedRun);
    await client.sadd(this.statusIndexKey(run.status), run.id);
    await client.sadd(this.workflowIndexKey(run.workflowId), run.id);
    await client.sadd(this.allRunsIndexKey(), run.id);
    await client.xadd(this.runObservationKey(run.id), "*", serializeInitialRunObservation(run));

    if (this.config.runTtl) {
      await client.expire(this.runKey(run.id), this.config.runTtl);
      await client.expire(this.runObservationKey(run.id), this.config.runTtl);
    }
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    const client = await this.ensureClient();
    const data = await client.hgetall(this.runKey(runId));
    if (!data || Object.keys(data).length === 0) return null;

    const run = this.deserializeRun(data);
    run.pendingApprovals = await this.getPendingApprovals(runId);
    return run;
  }

  async updateRun(runId: string, patch: WorkflowRunUpdate): Promise<void> {
    assertWorkflowRunUpdate(patch);
    const client = await this.ensureClient();

    if (this.config.debug) logger.debug(`[RedisBackend] Updating run: ${runId}`);

    const fields = this.serializeRunPatch(patch, runId);
    const result = await client.eval(
      UPDATE_RUN_SCRIPT,
      [this.runKey(runId)],
      [
        runId,
        patch.status ?? "",
        `${this.storagePrefix()}index:status:`,
        this.runObservationKey(runId),
        String(RUN_OBSERVATION_STREAM_MAX_LENGTH),
        ...Object.entries(fields).flatMap(([field, value]) => [field, value]),
      ],
    );
    if (Number(result) === 0) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });
    }

    // Terminal states should clear stale-claim markers.
    if (patch.status && patch.status !== "running") {
      await client.del(this.claimKey(runId));
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
    const fields = this.serializeRunPatch(patch, runId);
    const fieldArgs = Object.entries(fields).flatMap(([field, value]) => [field, value]);
    const result = await client.eval(
      UPDATE_RUN_IF_STATUS_SCRIPT,
      [this.runKey(runId)],
      [
        String(expectedStatuses.length),
        ...expectedStatuses,
        patch.status ?? "",
        `${this.storagePrefix()}index:status:`,
        runId,
        expectedWorkerId ?? "",
        this.runObservationKey(runId),
        String(RUN_OBSERVATION_STREAM_MAX_LENGTH),
        ...fieldArgs,
      ],
    );
    const updated = Number(result) === 1;

    if (updated && patch.status && patch.status !== "running") {
      await client.del(this.claimKey(runId));
    }
    return updated;
  }

  async deleteRun(runId: string): Promise<void> {
    const client = await this.ensureClient();

    const run = await this.getRun(runId);
    if (!run) return;

    await client.del(
      this.runKey(runId),
      this.checkpointsKey(runId),
      this.approvalsKey(runId),
      this.claimKey(runId),
      this.runObservationKey(runId),
      this.runObservationApprovalsKey(runId),
    );
    await client.srem(this.statusIndexKey(run.status), runId);
    await client.srem(this.workflowIndexKey(run.workflowId), runId);
    await client.srem(this.allRunsIndexKey(), runId);
    this.pendingMessageIds.delete(runId);
  }

  async listRuns(filter: RunFilter): Promise<WorkflowRun[]> {
    const client = await this.ensureClient();

    const statuses = filter.status
      ? Array.isArray(filter.status) ? filter.status : [filter.status]
      : null;

    let runIds: string[] = [];
    if (filter.workflowId) {
      runIds = await client.smembers(this.workflowIndexKey(filter.workflowId));
    } else if (statuses) {
      const all = await Promise.all(statuses.map((s) => client.smembers(this.statusIndexKey(s))));
      runIds = [...new Set(all.flat())];
    } else {
      runIds = await this.enumerateAllRunIds(client);
    }

    const runs: WorkflowRun[] = [];
    for (const runId of runIds) {
      const run = await this.getRun(runId);
      if (!run) continue;

      if (statuses && !statuses.includes(run.status)) continue;
      if (filter.createdAfter && run.createdAt < filter.createdAfter) continue;
      if (filter.createdBefore && run.createdAt > filter.createdBefore) continue;

      runs.push(run);
    }

    runs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    let result = runs;
    if (filter.offset) result = result.slice(filter.offset);
    if (filter.limit) result = result.slice(0, filter.limit);

    return result;
  }

  async countRuns(filter: RunFilter): Promise<number> {
    // Date filters need each run's createdAt, so fall back to materializing.
    if (filter.createdAfter || filter.createdBefore) {
      const runs = await this.listRuns({ ...filter, limit: undefined, offset: undefined });
      return runs.length;
    }

    // Otherwise count membership of the index sets (ids only) rather than
    // fetching and deserializing every run.
    const client = await this.ensureClient();
    const statuses = filter.status
      ? Array.isArray(filter.status) ? filter.status : [filter.status]
      : null;

    if (filter.workflowId && statuses) {
      const wfIds = new Set(await client.smembers(this.workflowIndexKey(filter.workflowId)));
      const statusIds = (await Promise.all(
        statuses.map((s) => client.smembers(this.statusIndexKey(s))),
      )).flat();
      return new Set(statusIds.filter((id) => wfIds.has(id))).size;
    }

    if (filter.workflowId) {
      return (await client.smembers(this.workflowIndexKey(filter.workflowId))).length;
    }

    if (statuses) {
      const all = await Promise.all(statuses.map((s) => client.smembers(this.statusIndexKey(s))));
      return new Set(all.flat()).size;
    }

    return (await this.enumerateAllRunIds(client)).length;
  }

  async saveCheckpoint(runId: string, checkpoint: Checkpoint): Promise<void> {
    const client = await this.ensureClient();

    if (this.config.debug) logger.debug(`[RedisBackend] Saving checkpoint: ${checkpoint.id}`);

    await client.eval(
      APPEND_RETAINED_LIST_SCRIPT,
      [this.checkpointsKey(runId)],
      [
        this.serializeCheckpoint(runId, checkpoint),
        String(MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES),
      ],
    );
  }

  async saveCheckpointIfStatusAndWorker(
    storageRunId: string,
    ownershipRunId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    checkpoint: Checkpoint,
  ): Promise<boolean> {
    return await this.appendIfStatusAndWorker(
      ownershipRunId,
      expectedStatuses,
      expectedWorkerId,
      this.checkpointsKey(storageRunId),
      this.serializeCheckpoint(storageRunId, checkpoint),
      MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES,
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
    const client = await this.ensureClient();

    if (this.config.debug) logger.debug(`[RedisBackend] Saving approval: ${approval.id}`);

    // Append and journal in one atomic script so the observation revision the
    // record carries is contiguous with the run-mutation scripts' revisions.
    // State-aware retention runs first in that same script and refuses to
    // mutate anything when no decided approval can be evicted safely.
    const result = await client.eval(
      SAVE_PENDING_APPROVAL_SCRIPT,
      [
        this.runKey(runId),
        this.approvalsKey(runId),
        this.runObservationApprovalsKey(runId),
      ],
      [
        this.serializeApproval(approval),
        String(MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES),
        this.runObservationKey(runId),
        String(RUN_OBSERVATION_STREAM_MAX_LENGTH),
      ],
    );
    if (Number(result) === 2) {
      throw this.approvalListFullError(approval.id);
    }
  }

  private approvalListFullError(approvalId: string): Error {
    return ORCHESTRATION_ERROR.create({
      detail: `Approval list full (max: ${MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES}) and ` +
        `not enough decided records can be evicted without dropping a pending approval. ` +
        `Cannot append approval: ${approvalId}`,
    });
  }

  async savePendingApprovalIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    approval: PendingApproval,
  ): Promise<boolean> {
    const client = await this.ensureClient();
    const result = await client.eval(
      SAVE_PENDING_APPROVAL_IF_OWNED_SCRIPT,
      [
        this.runKey(runId),
        this.approvalsKey(runId),
        this.runObservationApprovalsKey(runId),
      ],
      [
        String(expectedStatuses.length),
        ...expectedStatuses,
        expectedWorkerId,
        this.serializeApproval(approval),
        String(MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES),
        this.runObservationKey(runId),
        String(RUN_OBSERVATION_STREAM_MAX_LENGTH),
      ],
    );
    if (Number(result) === 2) {
      throw this.approvalListFullError(approval.id);
    }
    return Number(result) === 1;
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

  async getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    const client = await this.ensureClient();
    const rawList = await client.lrange(this.approvalsKey(runId), 0, -1);
    return rawList.map((raw) => this.parseApproval(raw)).filter((a) => a.status === "pending");
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
    const client = await this.ensureClient();
    const result: Array<{ runId: string; approval: PendingApproval }> = [];

    const approvalsPrefix = `${this.storagePrefix()}approvals:`;
    const keys = await client.keys(`${approvalsPrefix}*`);

    for (const key of keys) {
      const runId = key.replace(approvalsPrefix, "");

      if (filter?.workflowId) {
        const run = await this.getRun(runId);
        if (!run || run.workflowId !== filter.workflowId) continue;
      }

      const rawList = await client.lrange(key, 0, -1);

      for (const raw of rawList) {
        const approval = this.parseApproval(raw);

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
    const runs = await this.listRuns({ status: "running" });
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
      [
        observedActivity,
        workerId,
        String(stalledThreshold),
        new Date(now).toISOString(),
        this.runObservationKey(runId),
        String(RUN_OBSERVATION_STREAM_MAX_LENGTH),
      ],
    );
    return Number(claimed) === 1;
  }

  async openRunObservation(
    runId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<WorkflowRunObservation | null> {
    const client = await this.ensureClient();
    const captured = await client.eval(
      OPEN_RUN_OBSERVATION_SCRIPT,
      [this.runKey(runId)],
      [],
    );
    if (captured === null || captured === undefined) return null;
    if (
      !Array.isArray(captured) || captured.length !== 2 ||
      typeof captured[0] !== "string" || typeof captured[1] !== "string"
    ) {
      throw new Error("Workflow run observation failed");
    }

    let initialRevision: number;
    let initial: WorkflowRun;
    try {
      initialRevision = Number(captured[0]);
      if (!Number.isSafeInteger(initialRevision) || initialRevision < 0) throw new Error();
      const data = JSON.parse(captured[1]) as unknown;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
      initial = this.deserializeRun(data as Record<string, string>);
      // Hydrated after the atomic revision capture, so this read can include
      // an approval whose journaled revision is newer than the baseline. That
      // direction is safe by design: the subscriber gets the approval in the
      // initial snapshot, and event derivation seeds its baseline from that
      // same snapshot, so the newer record is consumed (contiguity intact)
      // and suppressed instead of reported twice. The reverse order would be
      // the real hazard (a snapshot older than the baseline revision misses
      // state), which is why the fetch must stay after the capture.
      initial.pendingApprovals = await this.getPendingApprovals(runId);
    } catch {
      throw new Error("Workflow run observation failed");
    }

    const controller = new AbortController();
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      controller.abort();
      options.signal?.removeEventListener("abort", close);
      this.runObservationClosers.delete(close);
    };
    this.runObservationClosers.add(close);
    options.signal?.addEventListener("abort", close, { once: true });
    if (options.signal?.aborted) close();

    const runKey = this.runKey(runId);
    const streamKey = this.runObservationKey(runId);
    const approvalJournalKey = this.runObservationApprovalsKey(runId);
    const readLegacyApprovalProjection = async () => {
      const rawList = await client.lrange(this.approvalsKey(runId), 0, -1);
      return projectObservableApprovals(rawList.map((raw) => this.parseApproval(raw)));
    };
    const changes: AsyncIterable<WorkflowRunObservedState> = {
      [Symbol.asyncIterator]: async function* () {
        if (TERMINAL_RUN_STATUSES.has(initial.status)) {
          close();
          return;
        }
        let expectedRevision = initialRevision + 1;
        let lastStreamId = "0-0";
        let lastObservedState = parseRunObservedState({
          ...serializeInitialRunObservation(initial),
          revision: String(initialRevision),
        });
        let approvalProjectionJson = JSON.stringify(
          projectPendingApprovals(initial.pendingApprovals),
        );
        const readLegacyApprovalState = async (): Promise<
          WorkflowRunObservedState | undefined
        > => {
          if (lastObservedState.status !== "waiting") return undefined;
          let approvals: NonNullable<WorkflowRunObservedState["approvals"]>;
          try {
            approvals = await readLegacyApprovalProjection();
          } catch {
            throw new Error("Workflow run observation failed");
          }
          const nextProjectionJson = JSON.stringify(approvals);
          if (nextProjectionJson === approvalProjectionJson) return undefined;
          approvalProjectionJson = nextProjectionJson;
          const legacyApprovalState = { ...lastObservedState, approvals };
          lastObservedState = legacyApprovalState;
          return legacyApprovalState;
        };
        try {
          while (!controller.signal.aborted) {
            let streams;
            try {
              streams = await client.xread([{ key: streamKey, xid: lastStreamId }], {
                count: RUN_OBSERVATION_STREAM_MAX_LENGTH,
              });
            } catch {
              throw new Error("Workflow run observation failed");
            }
            const messages = streams[0]?.messages ?? [];
            if (messages.length === 0) {
              try {
                if (await client.exists(runKey) === 0) {
                  throw new Error("Workflow run observation failed");
                }
              } catch {
                throw new Error("Workflow run observation failed");
              }
              // Older workers append approvals without a revision or stream
              // record. While a run is waiting, dual-read the bounded approval
              // list so rolling deployments still surface those requests. The
              // repeated revision is intentional: no durable stream revision
              // exists for this legacy write, and a later journaled record is
              // still consumed against the unchanged contiguous expectation.
              const legacyApprovalState = await readLegacyApprovalState();
              if (legacyApprovalState !== undefined) yield legacyApprovalState;
              await waitForObservationPoll(controller.signal);
              continue;
            }
            let approvalRecords: Record<string, string>;
            try {
              approvalRecords = await client.hgetall(approvalJournalKey);
            } catch {
              throw new Error("Workflow run observation failed");
            }
            // Older workers can append approvals without a stream record and a
            // newer worker can queue a transition before this reader reaches an
            // empty read. Check the legacy list before consuming queued records
            // when this batch does not already carry a journaled approval
            // projection, so the waiting baseline is not overwritten first and
            // normal journaled approval revisions still retain their durable
            // revision number.
            const batchHasApprovalProjection = messages.some((message) =>
              approvalRecords[message.data.revision ?? ""] !== undefined
            );
            if (!batchHasApprovalProjection) {
              const legacyApprovalState = await readLegacyApprovalState();
              if (legacyApprovalState !== undefined) yield legacyApprovalState;
            }
            for (const message of messages) {
              lastStreamId = message.id;
              let state: WorkflowRunObservedState;
              try {
                state = parseRunObservedState(message.data);
                const approvals = approvalRecords[String(state.revision)];
                if (approvals !== undefined) {
                  state.approvals = parseRunObservedApprovals(approvals);
                }
              } catch {
                throw new Error("Workflow run observation failed");
              }
              if (state.revision <= initialRevision) continue;
              if (state.revision !== expectedRevision) {
                throw new Error("Workflow run observation failed");
              }
              expectedRevision++;
              lastObservedState = state;
              if (state.approvals !== undefined) {
                approvalProjectionJson = JSON.stringify(state.approvals);
              }
              yield state;
              if (TERMINAL_RUN_STATUSES.has(state.status)) return;
            }
          }
        } finally {
          close();
        }
      },
    };

    return { initial, changes, close: () => Promise.resolve(close()) };
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
    for (const close of [...this.runObservationClosers]) close();
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
