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
  type PersistedPendingApproval,
  type TerminalRunRetentionBatch,
  type TerminalRunRetentionCandidate,
  type WorkflowBackend,
  type WorkflowRunObservation,
  type WorkflowRunObservedState,
  type WorkflowRunStateSnapshot,
  type WorkflowRunUpdate,
} from "../types.ts";
import { agentLogger, safeJsonParse } from "#veryfront/utils";
import {
  prepareWorkflowJson,
  serializeWorkflowContext,
  serializeWorkflowJson,
} from "../../context-serialization.ts";
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
const arrayIsArray = Array.isArray;
const arrayPush = Array.prototype.push;
const DateConstructor = Date;
const dateGetTime = Date.prototype.getTime;
const dateToISOString = Date.prototype.toISOString;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectDefineProperty = Object.defineProperty;
const reflectApply = Reflect.apply;
const REDIS_STORAGE_SCHEMA_VERSION = "schema-v1";
const REDIS_STORAGE_SCHEMA_NAMESPACE = `${REDIS_STORAGE_SCHEMA_VERSION}:`;
const RUN_OBSERVATION_APPROVAL_SCHEMA_VERSION = "approvals-v1";
const RUN_OBSERVATION_REVISION_FIELD = "__runObservationRevision";
const RUN_RETENTION_REVISION_FIELD = "__runRetentionRevision";
const TERMINAL_RETRY_QUEUED_FIELD = "__terminalRetryQueued";
const TERMINAL_COMPLETED_AT_MS_FIELD = "__terminalCompletedAtMs";
const RUN_OBSERVATION_STREAM_MAX_LENGTH = 64;
const RUN_OBSERVATION_POLL_INTERVAL_MS = 20;
const APPROVAL_RECOVERY_SCAN_COUNT = 100;
// Bound one Lua turn even when a retry-heavy run owns an unusually large queue.
const TERMINAL_RETENTION_QUEUE_CLEANUP_LIMIT = 100;
const CLEAR_LEGACY_RUN_TTL_SCRIPT =
  "-- clear-legacy-run-ttl\nreturn redis.call('persist', KEYS[1])";

/**
 * Merge top-level JSON objects without decoding their values through Redis's
 * bundled cjson. Standard Redis 7 turns a decoded empty array into an empty
 * Lua table and then encodes it as `{}`. The native cjson path handles normal
 * objects; documents containing an ambiguous empty-array token and callers
 * that keep deep values opaque use the raw-slice fallback.
 */
const JSON_OBJECT_PATCH_LUA = String.raw`
local function skipJsonWhitespace(value, position)
  while position <= #value do
    local byte = string.byte(value, position)
    if byte == 32 or byte == 9 or byte == 10 or byte == 13 then
      position = position + 1
    else
      break
    end
  end
  return position
end

local function scanJsonString(value, position)
  if string.sub(value, position, position) ~= '"' then
    error('Expected a JSON object key')
  end
  position = position + 1
  local escaped = false
  while position <= #value do
    local character = string.sub(value, position, position)
    if escaped then
      escaped = false
    elseif character == '\\' then
      escaped = true
    elseif character == '"' then
      return position + 1
    end
    position = position + 1
  end
  error('Unterminated JSON string')
end

local function scanJsonValue(value, position)
  position = skipJsonWhitespace(value, position)
  local first = string.sub(value, position, position)
  if first == '"' then return scanJsonString(value, position) end

  if first == '{' or first == '[' then
    local depth = 0
    local inString = false
    local escaped = false
    while position <= #value do
      local character = string.sub(value, position, position)
      if inString then
        if escaped then
          escaped = false
        elseif character == '\\' then
          escaped = true
        elseif character == '"' then
          inString = false
        end
      elseif character == '"' then
        inString = true
      elseif character == '{' or character == '[' then
        depth = depth + 1
      elseif character == '}' or character == ']' then
        depth = depth - 1
        if depth == 0 then return position + 1 end
      end
      position = position + 1
    end
    error('Unterminated JSON container')
  end

  local start = position
  while position <= #value do
    local character = string.sub(value, position, position)
    local byte = string.byte(value, position)
    if character == ',' or character == '}' or
      byte == 32 or byte == 9 or byte == 10 or byte == 13 then
      break
    end
    position = position + 1
  end
  if position == start then error('Expected a JSON value') end
  return position
end

local function parseJsonObject(value)
  local fields = { entries = {}, index = {} }
  local position = skipJsonWhitespace(value, 1)
  if string.sub(value, position, position) ~= '{' then
    error('Run patch field must be a JSON object')
  end
  position = skipJsonWhitespace(value, position + 1)
  if string.sub(value, position, position) == '}' then return fields end

  while position <= #value do
    local keyStart = position
    position = scanJsonString(value, position)
    local key = cjson.decode(string.sub(value, keyStart, position - 1))
    position = skipJsonWhitespace(value, position)
    if string.sub(value, position, position) ~= ':' then
      error('Expected a colon after a JSON object key')
    end
    position = skipJsonWhitespace(value, position + 1)
    local valueStart = position
    position = scanJsonValue(value, position)
    table.insert(fields.entries, {
      key = key,
      value = string.sub(value, valueStart, position - 1)
    })
    fields.index[key] = #fields.entries
    position = skipJsonWhitespace(value, position)

    local delimiter = string.sub(value, position, position)
    if delimiter == '}' then return fields end
    if delimiter ~= ',' then error('Expected a comma between JSON object entries') end
    position = skipJsonWhitespace(value, position + 1)
  end
  error('Unterminated JSON object')
end

local function encodeJsonObject(fields)
  local entries = {}
  for _, field in ipairs(fields.entries) do
    if field ~= false then
      table.insert(entries, cjson.encode(field.key) .. ':' .. field.value)
    end
  end
  return '{' .. table.concat(entries, ',') .. '}'
end

local function decodeJsonObjectField(fields, key)
  local index = fields.index[key]
  if index == nil then return nil end
  local field = fields.entries[index]
  if field == false then return nil end
  return cjson.decode(field.value)
end

local function setJsonObjectField(fields, key, value)
  local index = fields.index[key]
  if index == nil then
    table.insert(fields.entries, { key = key, value = value })
    fields.index[key] = #fields.entries
  else
    fields.entries[index].value = value
  end
end

local function deleteJsonObjectField(fields, key)
  local index = fields.index[key]
  if index ~= nil then
    fields.entries[index] = false
    fields.index[key] = nil
  end
end

local function containsAmbiguousEmptyArray(value)
  return string.find(value, '%[%s*%]') ~= nil
end

local function mergeJsonObjects(currentJson, patchJson, forceRawValues)
  if forceRawValues or
      containsAmbiguousEmptyArray(currentJson) or containsAmbiguousEmptyArray(patchJson) then
    local current = parseJsonObject(currentJson)
    local patch = parseJsonObject(patchJson)
    for _, field in ipairs(patch.entries) do
      setJsonObjectField(current, field.key, field.value)
    end
    return encodeJsonObject(current)
  end

  local current = cjson.decode(currentJson)
  local patch = cjson.decode(patchJson)
  for key, changed in pairs(patch) do current[key] = changed end
  return next(current) == nil and '{}' or cjson.encode(current)
end

local function deleteJsonObjectFields(currentJson, deletedJson, forceRawValues)
  local deleted = cjson.decode(deletedJson)
  if forceRawValues or containsAmbiguousEmptyArray(currentJson) then
    local current = parseJsonObject(currentJson)
    for _, key in ipairs(deleted) do deleteJsonObjectField(current, key) end
    return encodeJsonObject(current)
  end

  local current = cjson.decode(currentJson)
  for _, key in ipairs(deleted) do current[key] = nil end
  return next(current) == nil and '{}' or cjson.encode(current)
end
`;

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
 * Delete one exact terminal snapshot and every key or shared index membership
 * owned by it. A failed run may be retried, so status and completedAt must
 * still match inside the same Redis turn that deletes the state.
 *
 * When an earlier partial TTL already removed the hash, the supplied snapshot
 * still identifies its workflow index. In that case the script finishes the
 * orphan cleanup but never deletes a different extant run.
 *
 * KEYS[1..7] are the run hash and per-run keys. KEYS[8] is the all-runs
 * index, KEYS[9] the expected workflow index, KEYS[10..15] every status index,
 * KEYS[16..17] the terminal completion index and member map, and KEYS[18..19]
 * the run's queue-message index and shared stream. ARGV contains status,
 * workflowId, createdAt, completedAt, revision, runId, consumer group, and
 * the queue cleanup limit.
 * Like the existing status-update scripts, this requires one logical Redis
 * because the keys are not cluster hash-tagged. Returns 1 when Redis state was
 * removed, 2 when the run was already fully absent, 3 when bounded queue
 * cleanup must resume later, and 0 when an extant run no longer matches the
 * candidate.
 */
const DELETE_TERMINAL_RUN_IF_UNCHANGED_SCRIPT = `-- conditional-terminal-run-delete
local runExists = redis.call('exists', KEYS[1])
local retentionMetadataRaw = redis.call('hget', KEYS[17], ARGV[6])
local retentionMetadata = nil
if retentionMetadataRaw then retentionMetadata = cjson.decode(retentionMetadataRaw) end
if runExists ~= 0 then
  local status = redis.call('hget', KEYS[1], 'status')
  local workflowId = redis.call('hget', KEYS[1], 'workflowId')
  local createdAt = redis.call('hget', KEYS[1], 'createdAt')
  local completedAt = redis.call('hget', KEYS[1], 'completedAt')
  local revision = redis.call('hget', KEYS[1], '${RUN_RETENTION_REVISION_FIELD}') or '0'
  if status ~= ARGV[1] or workflowId ~= ARGV[2] or createdAt ~= ARGV[3] or
      completedAt ~= ARGV[4] or revision ~= ARGV[5] then return 0 end
  if status ~= 'completed' and status ~= 'failed' and status ~= 'cancelled' then return 0 end
elseif not retentionMetadata then
  return 2
elseif retentionMetadata.workflowId ~= ARGV[2] or
    retentionMetadata.createdAt ~= ARGV[3] or retentionMetadata.status ~= ARGV[1] or
    retentionMetadata.completedAt ~= ARGV[4] or
    tostring(retentionMetadata.revision) ~= ARGV[5] then
  return 0
end

local queueIds = redis.call('spop', KEYS[18], tonumber(ARGV[8]))
for _, queueId in ipairs(queueIds) do
  redis.pcall('xack', KEYS[19], ARGV[7], queueId)
  redis.call('xdel', KEYS[19], queueId)
end
if redis.call('scard', KEYS[18]) > 0 then return 3 end

local removed = 0
for index = 1, 7 do removed = removed + redis.call('del', KEYS[index]) end
for index = 8, 15 do removed = removed + redis.call('srem', KEYS[index], ARGV[6]) end
if retentionMetadata then
  removed = removed + redis.call('zrem', KEYS[16], retentionMetadata.member)
  removed = removed + redis.call('hdel', KEYS[17], ARGV[6])
end
removed = removed + redis.call('del', KEYS[18])
if removed > 0 then return 1 end
if runExists == 0 then return 2 end
return 0`;

const UPDATE_TERMINAL_RETENTION_INDEX_LUA = `
local function updateTerminalRetentionIndex(
  runKey,
  indexKey,
  membersKey,
  runId,
  backfillCompletedAtMs
)
  local oldMetadata = redis.call('hget', membersKey, runId)
  local oldMember = nil
  if oldMetadata then oldMember = cjson.decode(oldMetadata).member end
  local status = redis.call('hget', runKey, 'status')
  local completedAt = redis.call('hget', runKey, 'completedAt') or ''
  local terminal = status == 'completed' or status == 'failed' or status == 'cancelled'
  if not terminal or completedAt == '' then
    if oldMember then redis.call('zrem', indexKey, oldMember) end
    redis.call('hdel', membersKey, runId)
    return 1
  end
  local completedAtMs = redis.call('hget', runKey, '${TERMINAL_COMPLETED_AT_MS_FIELD}')
  if backfillCompletedAtMs ~= '' then
    completedAtMs = backfillCompletedAtMs
    redis.call('hset', runKey, '${TERMINAL_COMPLETED_AT_MS_FIELD}', completedAtMs)
  end
  local score = tonumber(completedAtMs)
  if not score then return 0 end
  local workflowId = redis.call('hget', runKey, 'workflowId')
  local createdAt = redis.call('hget', runKey, 'createdAt')
  if not workflowId or not createdAt then return 0 end
  local revisionValue = redis.call('hget', runKey, '${RUN_RETENTION_REVISION_FIELD}')
  if not revisionValue then
    revisionValue = '0'
    redis.call('hset', runKey, '${RUN_RETENTION_REVISION_FIELD}', revisionValue)
  end
  local revision = tonumber(revisionValue)
  if not revision then return 0 end
  local member = cjson.encode({ completedAt, runId })
  if oldMember and oldMember ~= member then redis.call('zrem', indexKey, oldMember) end
  redis.call('zadd', indexKey, score, member)
  redis.call('hset', membersKey, runId, cjson.encode({
    member = member,
    workflowId = workflowId,
    createdAt = createdAt,
    status = status,
    completedAt = completedAt,
    revision = revision
  }))
  return 1
end`;

// Allocate every mutation from the same global sequence used by run creation.
// A stale incarnation can then never collide with a later recreation's fence.
const ADVANCE_RUN_RETENTION_REVISION_LUA = `local function advanceRunRetentionRevision(
  runKey,
  membersKey,
  generationKey,
  runId
)
  local metadataRaw = redis.call('hget', membersKey, runId)
  local runExists = redis.call('exists', runKey) == 1
  if not runExists and not metadataRaw then return nil end
  local revision = redis.call('incr', generationKey)
  if runExists then
    redis.call('hset', runKey, '${RUN_RETENTION_REVISION_FIELD}', tostring(revision))
  end
  if metadataRaw then
    local metadata = cjson.decode(metadataRaw)
    metadata.revision = revision
    redis.call('hset', membersKey, runId, cjson.encode(metadata))
  end
  return revision
end`;

const CREATE_RUN_SCRIPT = `-- indexed-run-create
${UPDATE_TERMINAL_RETENTION_INDEX_LUA}
local generation = redis.call('incr', KEYS[8])
for index = 4, #ARGV, 2 do
  redis.call('hset', KEYS[1], ARGV[index], ARGV[index + 1])
end
redis.call('hset', KEYS[1], '${RUN_RETENTION_REVISION_FIELD}', tostring(generation))
redis.call('sadd', KEYS[2], ARGV[1])
redis.call('sadd', KEYS[3], ARGV[1])
redis.call('sadd', KEYS[4], ARGV[1])
local observation = cjson.decode(ARGV[3])
local observationFields = {}
for field, value in pairs(observation) do
  table.insert(observationFields, field)
  table.insert(observationFields, value)
end
redis.call('xadd', KEYS[5], '*', unpack(observationFields))
return updateTerminalRetentionIndex(KEYS[1], KEYS[6], KEYS[7], ARGV[1], ARGV[2])`;

const REFRESH_TERMINAL_RETENTION_INDEX_SCRIPT = `-- refresh-terminal-retention-index
${UPDATE_TERMINAL_RETENTION_INDEX_LUA}
local status = redis.call('hget', KEYS[1], 'status')
if not status then return 0 end
if ARGV[2] ~= '' and status ~= ARGV[2] then return 0 end
local completedAt = redis.call('hget', KEYS[1], 'completedAt') or ''
if ARGV[3] == '-' then
  if completedAt ~= '' then return 0 end
elseif ARGV[3] ~= '' and completedAt ~= ARGV[3] then
  return 0
end
return updateTerminalRetentionIndex(KEYS[1], KEYS[2], KEYS[3], ARGV[1], ARGV[4])`;

const REMOVE_TERMINAL_RETENTION_INDEX_SCRIPT = `-- remove-terminal-retention-index
local metadata = redis.call('hget', KEYS[2], ARGV[1])
if not metadata then return 0 end
redis.call('zrem', KEYS[1], cjson.decode(metadata).member)
redis.call('hdel', KEYS[2], ARGV[1])
return 1`;

const READ_TERMINAL_RETENTION_FIELDS_SCRIPT = `-- read-terminal-retention-fields
return redis.call(
  'hmget',
  KEYS[1],
  'id',
  'workflowId',
  'createdAt',
  'status',
  'completedAt',
  '${RUN_RETENTION_REVISION_FIELD}'
)`;

const SCAN_TERMINAL_RUN_KEYS_SCRIPT = `-- scan-terminal-retention-run-keys
return redis.call('scan', ARGV[1], 'MATCH', ARGV[2], 'COUNT', ARGV[3])`;

const LIST_TERMINAL_RETENTION_CANDIDATES_SCRIPT = `-- list-terminal-retention-candidates
local members = redis.call('zrangebyscore', KEYS[1], '-inf', '(' .. ARGV[1], 'LIMIT', 0, ARGV[2])
local result = { '0' }
for _, member in ipairs(members) do
  local decoded = cjson.decode(member)
  local runId = decoded[2]
  local mappedRaw = redis.call('hget', KEYS[2], runId)
  local mapped = nil
  if mappedRaw then mapped = cjson.decode(mappedRaw) end
  local values = redis.call(
    'hmget',
    ARGV[3] .. runId,
    'workflowId',
    'createdAt',
    'status',
    'completedAt',
    '${RUN_RETENTION_REVISION_FIELD}',
    '${TERMINAL_RETRY_QUEUED_FIELD}'
  )
  local terminal = values[3] == 'completed' or values[3] == 'failed' or
    values[3] == 'cancelled'
  local mappedTerminal = mapped and (
    mapped.status == 'completed' or mapped.status == 'failed' or mapped.status == 'cancelled'
  )
  if mapped and mapped.member == member and values[1] and values[2] and terminal and
      values[4] == decoded[1] and values[5] then
    if values[6] ~= '1' then
      table.insert(result, {
        runId,
        values[1],
        values[2],
        values[3],
        values[4],
        values[5]
      })
    end
  elseif mapped and mapped.member == member and not values[1] and mapped.workflowId and
      mapped.createdAt and mappedTerminal and mapped.completedAt == decoded[1] and
      mapped.revision ~= nil then
    table.insert(result, {
      runId,
      mapped.workflowId,
      mapped.createdAt,
      mapped.status,
      mapped.completedAt,
      tostring(mapped.revision)
    })
  else
    redis.call('zrem', KEYS[1], member)
    if mapped and mapped.member == member then redis.call('hdel', KEYS[2], runId) end
    result[1] = '1'
  end
end
return result`;

const BACKFILL_QUEUE_MESSAGE_INDEX_SCRIPT = `-- backfill-workflow-queue-message-index
if ARGV[4] == '0-0' then return { '1', '' } end
local entries = redis.call('xrange', KEYS[1], ARGV[1], ARGV[4], 'COUNT', ARGV[2])
local lastId = ''
for _, entry in ipairs(entries) do
  local id = entry[1]
  local fields = entry[2]
  for index = 1, #fields, 2 do
    if fields[index] == 'runId' and fields[index + 1] ~= '' then
      redis.call('sadd', ARGV[3] .. fields[index + 1], id)
      break
    end
  end
  lastId = id
end
local complete = (#entries < tonumber(ARGV[2]) or lastId == ARGV[4]) and '1' or '0'
return { complete, lastId }`;

const READ_QUEUE_HIGH_WATER_SCRIPT = `-- read-workflow-queue-high-water
local entries = redis.call('xrevrange', KEYS[1], '+', '-', 'COUNT', 1)
if #entries == 0 then return '0-0' end
return entries[1][1]`;

const ENQUEUE_RUN_SCRIPT = `-- indexed-workflow-enqueue
${ADVANCE_RUN_RETENTION_REVISION_LUA}
local id = redis.call(
  'xadd',
  KEYS[1],
  '*',
  'runId', ARGV[1],
  'workflowId', ARGV[2],
  'input', ARGV[3],
  'priority', ARGV[4],
  'createdAt', ARGV[5]
)
redis.call('sadd', KEYS[2], id)
local status = redis.call('hget', KEYS[3], 'status')
if status == 'completed' or status == 'failed' or status == 'cancelled' then
  redis.call('hset', KEYS[3], '${TERMINAL_RETRY_QUEUED_FIELD}', '1')
  local metadataRaw = redis.call('hget', KEYS[4], ARGV[1])
  if metadataRaw then redis.call('zrem', KEYS[6], cjson.decode(metadataRaw).member) end
end
advanceRunRetentionRevision(KEYS[3], KEYS[4], KEYS[5], ARGV[1])
return id`;

const REMOVE_ACKNOWLEDGED_QUEUE_MESSAGES_SCRIPT = `-- remove-acknowledged-queue-messages
${UPDATE_TERMINAL_RETENTION_INDEX_LUA}
for index = 2, #ARGV do
  redis.call('xdel', KEYS[1], ARGV[index])
  redis.call('srem', KEYS[2], ARGV[index])
end
if redis.call('scard', KEYS[2]) == 0 then
  redis.call('del', KEYS[2])
  redis.call('hdel', KEYS[3], '${TERMINAL_RETRY_QUEUED_FIELD}')
  updateTerminalRetentionIndex(KEYS[3], KEYS[4], KEYS[5], ARGV[1], '')
end
return #ARGV - 1`;

const CLEAR_RUN_QUEUE_MESSAGES_SCRIPT = `-- clear-run-queue-messages
local ids = redis.call('spop', KEYS[2], tonumber(ARGV[2]))
for _, id in ipairs(ids) do
  redis.pcall('xack', KEYS[1], ARGV[1], id)
  redis.call('xdel', KEYS[1], id)
end
local hasMore = redis.call('scard', KEYS[2]) > 0 and '1' or '0'
if hasMore == '0' then redis.call('del', KEYS[2]) end
return { tostring(#ids), hasMore }`;

function parseRedisTerminalRetentionCandidate(row: unknown): TerminalRunRetentionCandidate {
  if (
    !arrayIsArray(row) || row.length !== 6 ||
    typeof row[0] !== "string" || typeof row[1] !== "string" ||
    typeof row[2] !== "string" ||
    (row[3] !== "completed" && row[3] !== "failed" && row[3] !== "cancelled") ||
    typeof row[4] !== "string" || typeof row[5] !== "string"
  ) {
    throw ORCHESTRATION_ERROR.create({
      detail: "Redis returned an invalid terminal-run retention candidate",
    });
  }
  const createdAt = new DateConstructor(row[2]);
  const completedAt = new DateConstructor(row[4]);
  const revision = Number(row[5]);
  if (
    !numberIsFinite(reflectApply(dateGetTime, createdAt, []) as number) ||
    !numberIsFinite(reflectApply(dateGetTime, completedAt, []) as number) ||
    !numberIsSafeInteger(revision) || revision < 0
  ) {
    throw ORCHESTRATION_ERROR.create({
      detail: "Redis returned an invalid terminal-run retention timestamp",
    });
  }
  return {
    runId: row[0],
    workflowId: row[1],
    createdAt,
    status: row[3],
    completedAt,
    revision,
  };
}

function serializeCompletionInstant(value: Date | undefined): {
  completedAt: string;
  completedAtMs: string;
} {
  if (value === undefined) return { completedAt: "", completedAtMs: "" };
  const timestamp = reflectApply(dateGetTime, value, []) as number;
  return {
    completedAt: serializeDateInstant(value),
    completedAtMs: String(timestamp),
  };
}

function serializeDateInstant(value: Date): string {
  const timestamp = reflectApply(dateGetTime, value, []) as number;
  return reflectApply(dateToISOString, new DateConstructor(timestamp), []) as string;
}

function escapeRedisGlobLiteral(value: string): string {
  let escaped = "";
  for (let index = 0; index < value.length; index++) { // NOSONAR: Avoid mutable iterator hooks.
    const character = value[index]!;
    if (
      character === "\\" || character === "*" || character === "?" ||
      character === "[" || character === "]"
    ) escaped += "\\";
    escaped += character;
  }
  return escaped;
}

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
redis.call(
  'hset',
  KEYS[1],
  '${RUN_RETENTION_REVISION_FIELD}',
  tostring(redis.call('incr', KEYS[3]))
)
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
 * KEYS[2..3] = terminal completion index and member metadata
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
${JSON_OBJECT_PATCH_LUA}
${UPDATE_TERMINAL_RETENTION_INDEX_LUA}
local function applyPatchField(field, value)
  if field == 'nodeStateDeletes' then
    local current = redis.call('hget', KEYS[1], 'nodeStates') or '{}'
    redis.call('hset', KEYS[1], 'nodeStates', deleteJsonObjectFields(current, value, true))
  elseif field == 'contextDeletes' then
    local current = redis.call('hget', KEYS[1], 'context') or '{}'
    redis.call('hset', KEYS[1], 'context', deleteJsonObjectFields(current, value, true))
  elseif field == 'context' then
    local current = redis.call('hget', KEYS[1], 'context') or '{}'
    redis.call('hset', KEYS[1], 'context', mergeJsonObjects(current, value, true))
  elseif field == 'nodeStates' then
    local current = redis.call('hget', KEYS[1], field) or '{}'
    redis.call('hset', KEYS[1], field, mergeJsonObjects(current, value, true))
  else
    redis.call('hset', KEYS[1], field, value)
  end
end
local old = redis.call('hget', KEYS[1], 'status')
local nextStatus = ARGV[2]
if nextStatus ~= '' and old ~= nextStatus then
  redis.call('hset', KEYS[1], 'status', nextStatus)
  if old and old ~= '' then redis.call('srem', ARGV[3] .. old, ARGV[1]) end
  redis.call('sadd', ARGV[3] .. nextStatus, ARGV[1])
end
for i = 6, #ARGV, 2 do applyPatchField(ARGV[i], ARGV[i + 1]) end
local revision = redis.call('hincrby', KEYS[1], '${RUN_OBSERVATION_REVISION_FIELD}', 1)
redis.call(
  'hset',
  KEYS[1],
  '${RUN_RETENTION_REVISION_FIELD}',
  tostring(redis.call('incr', KEYS[4]))
)
local status = redis.call('hget', KEYS[1], 'status')
updateTerminalRetentionIndex(KEYS[1], KEYS[2], KEYS[3], ARGV[1], '')
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

/**
 * Atomically verify the current status, update fields, and move the status
 * index. The replace-maps flag (ARGV[expectedCount + 8]) switches `context`
 * and `nodeStates` from the per-key merge to wholesale replacement: checkpoint
 * restore must drop keys written after the snapshot, which a merge cannot do.
 */
const UPDATE_RUN_IF_STATUS_SCRIPT = `-- conditional-run-update
local old = redis.call('hget', KEYS[1], 'status')
local expectedCount = tonumber(ARGV[1])
local replaceMaps = ARGV[expectedCount + 8] == '1'
${JSON_OBJECT_PATCH_LUA}
${UPDATE_TERMINAL_RETENTION_INDEX_LUA}
local function applyPatchField(field, value)
  if field == 'nodeStateDeletes' then
    local current = redis.call('hget', KEYS[1], 'nodeStates') or '{}'
    redis.call('hset', KEYS[1], 'nodeStates', deleteJsonObjectFields(current, value, true))
  elseif field == 'contextDeletes' then
    local current = redis.call('hget', KEYS[1], 'context') or '{}'
    redis.call('hset', KEYS[1], 'context', deleteJsonObjectFields(current, value, true))
  elseif not replaceMaps and field == 'context' then
    local current = redis.call('hget', KEYS[1], 'context') or '{}'
    redis.call('hset', KEYS[1], 'context', mergeJsonObjects(current, value, true))
  elseif not replaceMaps and field == 'nodeStates' then
    local current = redis.call('hget', KEYS[1], field) or '{}'
    redis.call('hset', KEYS[1], field, mergeJsonObjects(current, value, true))
  else
    redis.call('hset', KEYS[1], field, value)
  end
end
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
for i = expectedCount + 9, #ARGV, 2 do
  applyPatchField(ARGV[i], ARGV[i + 1])
end
local revision = redis.call('hincrby', KEYS[1], '${RUN_OBSERVATION_REVISION_FIELD}', 1)
redis.call(
  'hset',
  KEYS[1],
  '${RUN_RETENTION_REVISION_FIELD}',
  tostring(redis.call('incr', KEYS[4]))
)
local status = redis.call('hget', KEYS[1], 'status')
updateTerminalRetentionIndex(KEYS[1], KEYS[2], KEYS[3], runId, '')
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

function projectApproval(
  approval: PendingApproval,
): NonNullable<WorkflowRunObservedState["approvals"]>[number] {
  return {
    id: approval.id,
    nodeId: approval.nodeId,
    ...(approval.message !== undefined ? { message: approval.message } : {}),
  };
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
${ADVANCE_RUN_RETENTION_REVISION_LUA}
redis.call('rpush', KEYS[1], ARGV[1])
redis.call('ltrim', KEYS[1], -tonumber(ARGV[2]), -1)
advanceRunRetentionRevision(KEYS[2], KEYS[3], KEYS[4], ARGV[3])
return redis.call('llen', KEYS[1])`;

/** Read only the run fields needed to reject stale owner-fenced work early. */
const CHECK_RUN_PRECONDITION_SCRIPT = `-- conditional-run-precondition-check
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
local checkWorker = ARGV[expectedCount + 3] == '1'
if checkWorker and redis.call('hget', KEYS[1], 'workerId') ~= expectedWorkerId then
  return 0
end
return 1`;

/** Atomically verify canonical run ownership before appending auxiliary run state. */
const APPEND_IF_STATUS_AND_WORKER_SCRIPT = `-- conditional-owned-append
${ADVANCE_RUN_RETENTION_REVISION_LUA}
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
advanceRunRetentionRevision(KEYS[2], KEYS[3], KEYS[4], ARGV[expectedCount + 6])
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
      local approval = parseJsonObject(raw)
      if decodeJsonObjectField(approval, 'status') ~= 'pending' and
          decodeJsonObjectField(approval, 'reconciliationPending') ~= true then
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
  local oldestRetainedRevision = revision - maxLength
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
 * Read observation stream records and their companion approval projections in
 * one Redis turn. Without this script, a writer can prune a revision from the
 * bounded journal after XREAD returns it but before HGETALL reaches Redis.
 *
 * KEYS[1] = observation stream key
 * KEYS[2] = approval observation journal key
 * ARGV[1] = last consumed stream id
 * ARGV[2] = maximum records to return
 */
const READ_RUN_OBSERVATIONS_SCRIPT = `-- read-run-observations
local streams = redis.call(
  'xread',
  'COUNT',
  tonumber(ARGV[2]),
  'STREAMS',
  KEYS[1],
  ARGV[1]
)
if not streams then return '[]' end
local records = {}
for _, message in ipairs(streams[1][2]) do
  local fields = message[2]
  local data = {}
  for index = 1, #fields, 2 do data[fields[index]] = fields[index + 1] end
  local record = { id = message[1], data = data }
  if data.revision then
    local approvals = redis.call('hget', KEYS[2], data.revision)
    if approvals then record.approvals = approvals end
  end
  records[#records + 1] = record
end
return cjson.encode(records)`;

function parseRunObservationRecords(
  raw: unknown,
): Array<{ id: string; data: Record<string, string>; approvals?: string }> {
  if (typeof raw !== "string") throw new Error();
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error();
  return parsed.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const record = value as Record<string, unknown>;
    if (
      typeof record.id !== "string" || !record.data || typeof record.data !== "object" ||
      Array.isArray(record.data) ||
      (record.approvals !== undefined && typeof record.approvals !== "string")
    ) {
      throw new Error();
    }
    const data: Record<string, string> = {};
    for (const [field, fieldValue] of Object.entries(record.data)) {
      if (typeof fieldValue !== "string") throw new Error();
      data[field] = fieldValue;
    }
    return {
      id: record.id,
      data,
      ...(record.approvals !== undefined ? { approvals: record.approvals } : {}),
    };
  });
}

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
 * ARGV[5] = whether to reject a duplicate live node execution
 *
 * Returns 1 when the append was journaled, 0 when the run hash is absent (the
 * approval is still appended, preserving the unconditional-save contract),
 * 2 when insufficient decided history can be evicted, and 3 when a coalescing
 * append finds a pending approval for the same wait execution. Duplicate
 * preflight, retention, append, revision increment, and journal write all
 * happen atomically.
 */
const SAVE_PENDING_APPROVAL_SCRIPT = `-- observable-approval-append
${JSON_OBJECT_PATCH_LUA}
${RETAIN_APPROVALS_LUA}
${JOURNAL_APPROVAL_PROJECTION_LUA}
${ADVANCE_RUN_RETENTION_REVISION_LUA}
local approval = parseJsonObject(ARGV[1])
if ARGV[5] == '1' then
  local existingApprovals = redis.call('lrange', KEYS[2], 0, -1)
  for i = 1, #existingApprovals do
    local candidate = parseJsonObject(existingApprovals[i])
    local candidateWaitInstanceId = decodeJsonObjectField(candidate, 'waitInstanceId')
    local approvalWaitInstanceId = decodeJsonObjectField(approval, 'waitInstanceId')
    if (decodeJsonObjectField(candidate, 'status') == 'pending' or
        decodeJsonObjectField(candidate, 'reconciliationPending') == true) and
        decodeJsonObjectField(candidate, 'nodeId') == decodeJsonObjectField(approval, 'nodeId') and
        (candidateWaitInstanceId == nil or approvalWaitInstanceId == nil or
          candidateWaitInstanceId == approvalWaitInstanceId) then
      return 3
    end
  end
end
if not retainApprovals(KEYS[2], tonumber(ARGV[2])) then return 2 end
redis.call('rpush', KEYS[2], ARGV[1])
if redis.call('exists', KEYS[1]) == 0 then
  advanceRunRetentionRevision(KEYS[1], KEYS[4], KEYS[5], ARGV[6])
  return 0
end
local revision = redis.call('hincrby', KEYS[1], '${RUN_OBSERVATION_REVISION_FIELD}', 1)
advanceRunRetentionRevision(KEYS[1], KEYS[4], KEYS[5], ARGV[6])
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
  local candidate = parseJsonObject(rawApprovals[i])
  if decodeJsonObjectField(candidate, 'status') == 'pending' then
    local entry = {
      id = decodeJsonObjectField(candidate, 'id'),
      nodeId = decodeJsonObjectField(candidate, 'nodeId')
    }
    local message = decodeJsonObjectField(candidate, 'message')
    if message ~= nil then entry.message = message end
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
 * 2 when insufficient decided history can be evicted, and 3 when a pending
 * approval already exists for the same node.
 */
const SAVE_PENDING_APPROVAL_IF_OWNED_SCRIPT = `-- conditional-owned-approval-append
${JSON_OBJECT_PATCH_LUA}
${RETAIN_APPROVALS_LUA}
${JOURNAL_APPROVAL_PROJECTION_LUA}
${ADVANCE_RUN_RETENTION_REVISION_LUA}
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
local approval = parseJsonObject(ARGV[expectedCount + 3])
local existingApprovals = redis.call('lrange', KEYS[2], 0, -1)
for i = 1, #existingApprovals do
  local candidate = parseJsonObject(existingApprovals[i])
  local candidateWaitInstanceId = decodeJsonObjectField(candidate, 'waitInstanceId')
  local approvalWaitInstanceId = decodeJsonObjectField(approval, 'waitInstanceId')
  if (decodeJsonObjectField(candidate, 'status') == 'pending' or
      decodeJsonObjectField(candidate, 'reconciliationPending') == true) and
      decodeJsonObjectField(candidate, 'nodeId') == decodeJsonObjectField(approval, 'nodeId') and
      (candidateWaitInstanceId == nil or approvalWaitInstanceId == nil or
        candidateWaitInstanceId == approvalWaitInstanceId) then
    return 3
  end
end
if not retainApprovals(KEYS[2], tonumber(ARGV[expectedCount + 4])) then
  return 2
end
redis.call('rpush', KEYS[2], ARGV[expectedCount + 3])
local revision = redis.call('hincrby', KEYS[1], '${RUN_OBSERVATION_REVISION_FIELD}', 1)
advanceRunRetentionRevision(KEYS[1], KEYS[4], KEYS[5], ARGV[expectedCount + 7])
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
  local candidate = parseJsonObject(rawApprovals[i])
  if decodeJsonObjectField(candidate, 'status') == 'pending' then
    local entry = {
      id = decodeJsonObjectField(candidate, 'id'),
      nodeId = decodeJsonObjectField(candidate, 'nodeId')
    }
    local message = decodeJsonObjectField(candidate, 'message')
    if message ~= nil then entry.message = message end
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
 * KEYS[2] = run hash key
 * ARGV[1] = approval id
 * ARGV[2] = patch, JSON-encoded (date fields already ISO strings via toJSON)
 *
 * Returns 1 when the approval was found and patched, 0 when the id is absent.
 */
const UPDATE_PENDING_APPROVAL_SCRIPT = `${JSON_OBJECT_PATCH_LUA}
${ADVANCE_RUN_RETENTION_REVISION_LUA}
-- conditional-approval-patch
local approvalId = ARGV[1]
local len = redis.call('llen', KEYS[1])
for i = 0, len - 1 do
  local raw = redis.call('lindex', KEYS[1], i)
  if raw then
    local approval = parseJsonObject(raw)
    if decodeJsonObjectField(approval, 'id') == approvalId then
      redis.call('lset', KEYS[1], i, mergeJsonObjects(raw, ARGV[2], true))
      advanceRunRetentionRevision(KEYS[2], KEYS[3], KEYS[4], ARGV[3])
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
 * ARGV[2] = decision fields as a JSON object
 * ARGV[3] = absent optional field names as a JSON array
 *
 * Returns 1 when applied, 2 when the approval was found but no longer pending
 * (a lost race), 0 when the id is absent.
 */
const UPDATE_APPROVAL_SCRIPT = `${JSON_OBJECT_PATCH_LUA}
${ADVANCE_RUN_RETENTION_REVISION_LUA}
-- conditional-approval-decision
local approvalId = ARGV[1]
local len = redis.call('llen', KEYS[1])
for i = 0, len - 1 do
  local raw = redis.call('lindex', KEYS[1], i)
  if raw then
    local approval = parseJsonObject(raw)
    if decodeJsonObjectField(approval, 'id') == approvalId then
      if decodeJsonObjectField(approval, 'status') ~= 'pending' then return 2 end
      local updated = mergeJsonObjects(raw, ARGV[2], true)
      updated = deleteJsonObjectFields(updated, ARGV[3], true)
      redis.call('lset', KEYS[1], i, updated)
      advanceRunRetentionRevision(KEYS[2], KEYS[3], KEYS[4], ARGV[4])
      return 1
    end
  end
end
return 0`;

/** Lease one approval decision claim to one recovery process. */
const RESERVE_APPROVAL_DECISION_SCRIPT = `${JSON_OBJECT_PATCH_LUA}
${ADVANCE_RUN_RETENTION_REVISION_LUA}
-- reserve-approval-decision
local approvalId = ARGV[1]
local recoveryClaimId = ARGV[2]
local staleBefore = ARGV[3]
local patch = ARGV[4]
local len = redis.call('llen', KEYS[1])
for i = 0, len - 1 do
  local raw = redis.call('lindex', KEYS[1], i)
  if raw then
    local approval = parseJsonObject(raw)
    if decodeJsonObjectField(approval, 'id') == approvalId then
      if decodeJsonObjectField(approval, 'reconciliationPending') ~= true then return 0 end
      local storedClaimId = decodeJsonObjectField(approval, 'recoveryClaimId')
      local storedClaimedAt = decodeJsonObjectField(approval, 'recoveryClaimedAt')
      if storedClaimId ~= nil and
          (storedClaimedAt == nil or storedClaimedAt > staleBefore) then
        return 2
      end
      redis.call('lset', KEYS[1], i, mergeJsonObjects(raw, patch, true))
      advanceRunRetentionRevision(KEYS[2], KEYS[3], KEYS[4], ARGV[5])
      return 1
    end
  end
end
return 0`;

/** Release one recovery lease without consuming the decision claim. */
const RELEASE_APPROVAL_DECISION_CLAIM_SCRIPT = `${JSON_OBJECT_PATCH_LUA}
${ADVANCE_RUN_RETENTION_REVISION_LUA}
-- release-approval-decision-claim
local approvalId = ARGV[1]
local recoveryClaimId = ARGV[2]
local len = redis.call('llen', KEYS[1])
for i = 0, len - 1 do
  local raw = redis.call('lindex', KEYS[1], i)
  if raw then
    local approval = parseJsonObject(raw)
    if decodeJsonObjectField(approval, 'id') == approvalId then
      if decodeJsonObjectField(approval, 'recoveryClaimId') ~= recoveryClaimId then return 2 end
      redis.call('lset', KEYS[1], i,
        deleteJsonObjectFields(raw, '["recoveryClaimId","recoveryClaimedAt"]', true))
      advanceRunRetentionRevision(KEYS[2], KEYS[3], KEYS[4], ARGV[3])
      return 1
    end
  end
end
return 0`;

/** Release one approval decision reservation after its node outcome commits. */
const FINALIZE_APPROVAL_DECISION_SCRIPT = `${JSON_OBJECT_PATCH_LUA}
${ADVANCE_RUN_RETENTION_REVISION_LUA}
-- finalize-approval-decision
local approvalId = ARGV[1]
local recoveryClaimId = ARGV[2]
local len = redis.call('llen', KEYS[1])
for i = 0, len - 1 do
  local raw = redis.call('lindex', KEYS[1], i)
  if raw then
    local approval = parseJsonObject(raw)
    if decodeJsonObjectField(approval, 'id') == approvalId then
      local storedClaimId = decodeJsonObjectField(approval, 'recoveryClaimId')
      if recoveryClaimId == '' then
        if storedClaimId ~= nil then return 2 end
      elseif storedClaimId ~= recoveryClaimId then
        return 2
      end
      redis.call('lset', KEYS[1], i,
        deleteJsonObjectFields(
          raw,
          '["reconciliationPending","recoveryClaimId","recoveryClaimedAt"]',
          true
        ))
      advanceRunRetentionRevision(KEYS[2], KEYS[3], KEYS[4], ARGV[3])
      return 1
    end
  end
end
return 0`;

/** Implement redis backend. */
export class RedisBackend implements WorkflowBackend {
  /** The run-update scripts merge context and node-state maps by key. */
  readonly supportsRunPatchKeyMerge = true;
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
  private terminalRetentionBackfillCursor = "0";
  private terminalRetentionRunBackfillComplete = false;
  private terminalRetentionQueueBackfillCursor = "-";
  private terminalRetentionQueueBackfillHighWater: string | null = null;
  private terminalRetentionQueueBackfillComplete = false;
  private terminalRetentionRepairInFlight: Promise<boolean> | null = null;

  constructor(config: RedisBackendConfig = {}) {
    const resolvedConfig: RedisBackendInternalConfig = {
      prefix: "vf:workflow:",
      streamKey: "vf:workflow:stream",
      groupName: "vf:workflow:workers",
      consumerName: `worker-${crypto.randomUUID().slice(0, 8)}`,
      debug: false,
      strictContext: false,
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

  private terminalRunRetentionIndexKey(): string {
    return `${this.storagePrefix()}index:terminal-completed-at`;
  }

  private terminalRunRetentionMembersKey(): string {
    return `${this.storagePrefix()}index:terminal-completed-at-members`;
  }

  private terminalRunRetentionGenerationKey(): string {
    return `${this.storagePrefix()}index:terminal-retention-generation`;
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

  private queueMessagesKey(runId: string): string {
    return `${this.storagePrefix()}queue-messages:${runId}`;
  }

  private async refreshTerminalRetentionIndex(
    client: RedisAdapter,
    runId: string,
    expectedStatus: string,
    expectedCompletedAt: string,
    completedAtMs: string,
  ): Promise<void> {
    await client.eval(
      REFRESH_TERMINAL_RETENTION_INDEX_SCRIPT,
      [
        this.runKey(runId),
        this.terminalRunRetentionIndexKey(),
        this.terminalRunRetentionMembersKey(),
      ],
      [runId, expectedStatus, expectedCompletedAt, completedAtMs],
    );
  }

  private serializeRun(run: WorkflowRun): Record<string, string> {
    const sourceIntegrationPolicy = requireWorkflowSourceIntegrationPolicy(run);
    const completion = serializeCompletionInstant(run.completedAt);
    // Encoded before the fields below, on purpose. A step's return value reaches
    // `input`, `output`, and `nodeStates` as well, and those are encoded by
    // `JSON.stringify`, so whichever runs first decides the error a caller sees.
    const context = serializeWorkflowContext(run.context, run.id, {
      strictContext: this.config.strictContext,
    });
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
      createdAt: serializeDateInstant(run.createdAt),
      startedAt: run.startedAt?.toISOString() || "",
      heartbeatAt: run.heartbeatAt?.toISOString() || "",
      completedAt: completion.completedAt,
      [TERMINAL_COMPLETED_AT_MS_FIELD]: completion.completedAtMs,
      [RUN_OBSERVATION_REVISION_FIELD]: "0",
      [RUN_RETENTION_REVISION_FIELD]: "0",
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
    const patchContext = patch.context;
    const patchContextKeys = patchContext === undefined ? [] : Object.keys(patchContext);
    const preparedContext = patchContext !== undefined
      ? prepareWorkflowJson(patchContext, "context", runId, {
        strictContext: this.config.strictContext,
      })
      : undefined;
    const fields: Record<string, string> = {};
    const completion = Object.hasOwn(patch, "completedAt")
      ? serializeCompletionInstant(patch.completedAt)
      : undefined;
    const setOwnedField = (patchKey: keyof WorkflowRunUpdate, fieldKey: string, value: string) => {
      if (Object.hasOwn(patch, patchKey)) fields[fieldKey] = value;
    };
    const setNonEmptyArrayField = (fieldKey: string, value: unknown[] | undefined) => {
      if (value !== undefined && value.length > 0) fields[fieldKey] = JSON.stringify(value);
    };
    const setDefinedField = (fieldKey: string, value: unknown, serialized: string) => {
      if (value !== undefined) fields[fieldKey] = serialized;
    };
    setOwnedField("workerId", "workerId", patch.workerId ?? "");
    setOwnedField(
      "output",
      "output",
      patch.output !== undefined ? JSON.stringify(patch.output) : "",
    );
    setDefinedField("nodeStates", patch.nodeStates, JSON.stringify(patch.nodeStates));
    setNonEmptyArrayField("nodeStateDeletes", patch.nodeStateDeletes);
    setDefinedField("currentNodes", patch.currentNodes, JSON.stringify(patch.currentNodes));
    setDefinedField("context", preparedContext, preparedContext?.serialized ?? "");
    const contextDeletes = [...patch.contextDeletes ?? []];
    if (preparedContext !== undefined) {
      const normalizedContext = preparedContext.normalized as Record<string, unknown>;
      for (const key of patchContextKeys) {
        if (!Object.hasOwn(normalizedContext, key) && !contextDeletes.includes(key)) {
          contextDeletes.push(key);
        }
      }
    }
    setNonEmptyArrayField("contextDeletes", contextDeletes);
    setOwnedField("error", "error", patch.error ? JSON.stringify(patch.error) : "");
    setOwnedField("startedAt", "startedAt", patch.startedAt?.toISOString() ?? "");
    setOwnedField("heartbeatAt", "heartbeatAt", patch.heartbeatAt?.toISOString() ?? "");
    if (completion !== undefined) {
      fields.completedAt = completion.completedAt;
      fields[TERMINAL_COMPLETED_AT_MS_FIELD] = completion.completedAtMs;
    }
    setOwnedField("_traceContext", "traceContext", patch._traceContext ?? "");
    return fields;
  }

  private serializeCheckpointNodeStates(
    runId: string,
    nodeStates: Checkpoint["nodeStates"],
  ): string {
    return prepareWorkflowJson(
      this.normalizeCheckpointNodeStates(nodeStates),
      "checkpoint.nodeStates",
      runId,
      { strictContext: false },
    ).serialized;
  }

  private normalizeCheckpointNodeStates(
    nodeStates: Checkpoint["nodeStates"],
  ): Record<string, unknown> {
    const normalizedNodeStates: Record<string, unknown> = {};
    for (const [nodeId, nodeState] of Object.entries(nodeStates)) {
      const normalizedNodeState: Record<string, unknown> = { ...nodeState };
      if (nodeState.startedAt !== undefined) {
        normalizedNodeState.startedAt = nodeState.startedAt.toISOString();
      }
      if (nodeState.completedAt !== undefined) {
        normalizedNodeState.completedAt = nodeState.completedAt.toISOString();
      }
      normalizedNodeStates[nodeId] = normalizedNodeState;
    }
    return normalizedNodeStates;
  }

  private serializeCheckpoint(runId: string, checkpoint: Checkpoint): string {
    // Checked before the rest of the checkpoint is encoded below, so a value
    // JSON refuses is named by its path rather than by the native error.
    const { serialized: context } = prepareWorkflowJson(
      checkpoint.context,
      "checkpoint.context",
      runId,
      { strictContext: this.config.strictContext },
    );
    const nodeStates = this.serializeCheckpointNodeStates(runId, checkpoint.nodeStates);
    const {
      context: _context,
      nodeStates: _nodeStates,
      _resumeEnvelope,
      ...checkpointMetadata
    } = checkpoint;
    const serializedCheckpoint = JSON.stringify({
      ...checkpointMetadata,
      timestamp: checkpoint.timestamp.toISOString(),
    });
    const normalizedResumeEnvelope = _resumeEnvelope === undefined ? undefined : {
      ..._resumeEnvelope,
      nodeStates: this.normalizeCheckpointNodeStates(_resumeEnvelope.nodeStates),
    };
    const resumeEnvelope = normalizedResumeEnvelope === undefined
      ? ""
      : `,"_resumeEnvelope":${
        prepareWorkflowJson(
          normalizedResumeEnvelope,
          "checkpoint._resumeEnvelope",
          runId,
          { strictContext: false },
        ).serialized
      }`;
    return `${
      serializedCheckpoint.slice(0, -1)
    },"context":${context},"nodeStates":${nodeStates}${resumeEnvelope}}`;
  }

  private serializeApproval(approval: PersistedPendingApproval): string {
    return JSON.stringify({
      ...approval,
      requestedAt: approval.requestedAt.toISOString(),
      expiresAt: approval.expiresAt?.toISOString(),
      decidedAt: approval.decidedAt?.toISOString(),
      recoveryClaimedAt: approval.recoveryClaimedAt?.toISOString(),
    });
  }

  private async appendIfStatusAndWorker(
    ownershipRunId: string,
    storageRunId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    storageKey: string,
    value: string,
    maxEntries?: number,
  ): Promise<boolean> {
    const client = await this.ensureClient();
    const result = await client.eval(
      APPEND_IF_STATUS_AND_WORKER_SCRIPT,
      [
        this.runKey(ownershipRunId),
        this.runKey(storageRunId),
        this.terminalRunRetentionMembersKey(),
        this.terminalRunRetentionGenerationKey(),
      ],
      [
        String(expectedStatuses.length),
        ...expectedStatuses,
        expectedWorkerId,
        storageKey,
        value,
        maxEntries === undefined ? "" : String(maxEntries),
        storageRunId,
      ],
    );
    return Number(result) === 1;
  }

  private async runPreconditionMatches(
    client: RedisAdapter,
    runId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId?: string,
  ): Promise<boolean> {
    const result = await client.eval(
      CHECK_RUN_PRECONDITION_SCRIPT,
      [this.runKey(runId)],
      [
        String(expectedStatuses.length),
        ...expectedStatuses,
        expectedWorkerId ?? "",
        expectedWorkerId === undefined ? "0" : "1",
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
    await client.eval(
      CREATE_RUN_SCRIPT,
      [
        this.runKey(run.id),
        this.statusIndexKey(run.status),
        this.workflowIndexKey(run.workflowId),
        this.allRunsIndexKey(),
        this.runObservationKey(run.id),
        this.terminalRunRetentionIndexKey(),
        this.terminalRunRetentionMembersKey(),
        this.terminalRunRetentionGenerationKey(),
      ],
      [
        run.id,
        serializedRun[TERMINAL_COMPLETED_AT_MS_FIELD] ?? "",
        JSON.stringify(serializeInitialRunObservation(run)),
        ...Object.entries(serializedRun).flatMap(([field, value]) => [field, value]),
      ],
    );
  }

  /**
   * Remove TTLs written by the deprecated creation-time `runTtl` behavior.
   *
   * Run this once after old workers have drained and before removing `runTtl`
   * from deployment configuration. The cursor scan avoids blocking Redis with
   * a keyspace-wide `KEYS` command. Lock and stalled-claim TTLs remain intact
   * because they are execution leases, not run-retention state.
   *
   * @returns Number of legacy TTLs removed.
   */
  async clearLegacyRunTtlExpirations(): Promise<number> {
    const client = await this.ensureClient();
    const runPrefix = `${this.storagePrefix()}run:`;
    let cursor = 0;
    let cleared = 0;
    do {
      const page = await client.scan(cursor, {
        MATCH: `${runPrefix}*`,
        COUNT: APPROVAL_RECOVERY_SCAN_COUNT,
      });
      cursor = page.cursor;
      for (let index = 0; index < page.keys.length; index++) { // NOSONAR: Avoid mutable iterator hooks.
        const runKey = page.keys[index]!;
        const runId = runKey.slice(runPrefix.length);
        cleared += Number(await client.eval(CLEAR_LEGACY_RUN_TTL_SCRIPT, [runKey], []));
        cleared += Number(
          await client.eval(
            CLEAR_LEGACY_RUN_TTL_SCRIPT,
            [this.runObservationKey(runId)],
            [],
          ),
        );
        cleared += Number(
          await client.eval(
            CLEAR_LEGACY_RUN_TTL_SCRIPT,
            [this.runObservationApprovalsKey(runId)],
            [],
          ),
        );
      }
    } while (cursor !== 0);
    return cleared;
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
    const client = await this.ensureClient();
    const runKey = this.runKey(runId);

    if (this.config.debug) logger.debug(`[RedisBackend] Updating run: ${runId}`);

    let fields: Record<string, string>;
    try {
      assertWorkflowRunUpdate(patch);
      fields = this.serializeRunPatch(patch, runId);
    } catch (error) {
      if (await client.exists(runKey) === 0) {
        throw RESOURCE_NOT_FOUND.create({
          detail: `Run not found: ${runId}`,
          cause: error,
        });
      }
      throw error;
    }
    const result = await client.eval(
      UPDATE_RUN_SCRIPT,
      [
        runKey,
        this.terminalRunRetentionIndexKey(),
        this.terminalRunRetentionMembersKey(),
        this.terminalRunRetentionGenerationKey(),
      ],
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

  /**
   * Replace context and node-state maps with a snapshot, only while status
   * and (optionally) worker ownership match. Same atomic script as the
   * conditional patch, with the replace-maps flag set: checkpoint restore
   * must drop keys written after the snapshot, which the merge retains.
   */
  async restoreRunStateIfStatus(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    snapshot: WorkflowRunStateSnapshot,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    return await this.updateRunConditionally(
      runId,
      expectedStatuses,
      snapshot,
      expectedWorkerId,
      true,
    );
  }

  private async updateRunConditionally(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
    replaceMapFields = false,
  ): Promise<boolean> {
    assertWorkflowRunUpdate(patch);
    const client = await this.ensureClient();
    let fields: Record<string, string>;
    try {
      fields = this.serializeRunPatch(patch, runId);
    } catch (error) {
      if (
        !await this.runPreconditionMatches(
          client,
          runId,
          expectedStatuses,
          expectedWorkerId,
        )
      ) return false;
      throw error;
    }
    const fieldArgs = Object.entries(fields).flatMap(([field, value]) => [field, value]);
    const result = await client.eval(
      UPDATE_RUN_IF_STATUS_SCRIPT,
      [
        this.runKey(runId),
        this.terminalRunRetentionIndexKey(),
        this.terminalRunRetentionMembersKey(),
        this.terminalRunRetentionGenerationKey(),
      ],
      [
        String(expectedStatuses.length),
        ...expectedStatuses,
        patch.status ?? "",
        `${this.storagePrefix()}index:status:`,
        runId,
        expectedWorkerId ?? "",
        this.runObservationKey(runId),
        String(RUN_OBSERVATION_STREAM_MAX_LENGTH),
        replaceMapFields ? "1" : "0",
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

    await this.clearRunQueueMessages(client, runId);
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
    await client.eval(
      REMOVE_TERMINAL_RETENTION_INDEX_SCRIPT,
      [this.terminalRunRetentionIndexKey(), this.terminalRunRetentionMembersKey()],
      [runId],
    );
    this.pendingMessageIds.delete(runId);
  }

  private async clearRunQueueMessages(client: RedisAdapter, runId: string): Promise<void> {
    let hasMore = true;
    while (hasMore) {
      const raw = await client.eval(
        CLEAR_RUN_QUEUE_MESSAGES_SCRIPT,
        [this.config.streamKey, this.queueMessagesKey(runId)],
        [this.config.groupName, String(TERMINAL_RETENTION_QUEUE_CLEANUP_LIMIT)],
      );
      if (
        !arrayIsArray(raw) || raw.length !== 2 || typeof raw[0] !== "string" ||
        (raw[1] !== "0" && raw[1] !== "1")
      ) {
        throw ORCHESTRATION_ERROR.create({
          detail: "Redis returned an invalid run queue cleanup result",
        });
      }
      const cleaned = Number(raw[0]);
      if (
        !numberIsSafeInteger(cleaned) || cleaned < 0 ||
        cleaned > TERMINAL_RETENTION_QUEUE_CLEANUP_LIMIT ||
        (cleaned === 0 && raw[1] === "1")
      ) {
        throw ORCHESTRATION_ERROR.create({
          detail: "Redis returned an invalid run queue cleanup count",
        });
      }
      hasMore = raw[1] === "1";
    }
  }

  async deleteTerminalRunIfUnchanged(
    candidate: TerminalRunRetentionCandidate,
  ): Promise<boolean> {
    if (
      candidate.status !== "completed" && candidate.status !== "failed" &&
        candidate.status !== "cancelled" ||
      !numberIsSafeInteger(candidate.revision) ||
      candidate.revision < 0
    ) return false;

    let createdAt: string;
    let completedAt: string;
    try {
      createdAt = reflectApply(dateToISOString, candidate.createdAt, []) as string;
      completedAt = reflectApply(dateToISOString, candidate.completedAt, []) as string;
    } catch {
      return false;
    }
    const client = await this.ensureClient();
    const result = await client.eval(
      DELETE_TERMINAL_RUN_IF_UNCHANGED_SCRIPT,
      [
        this.runKey(candidate.runId),
        this.checkpointsKey(candidate.runId),
        this.approvalsKey(candidate.runId),
        this.claimKey(candidate.runId),
        this.runObservationKey(candidate.runId),
        this.runObservationApprovalsKey(candidate.runId),
        this.lockKey(candidate.runId),
        this.allRunsIndexKey(),
        this.workflowIndexKey(candidate.workflowId),
        this.statusIndexKey("pending"),
        this.statusIndexKey("running"),
        this.statusIndexKey("waiting"),
        this.statusIndexKey("completed"),
        this.statusIndexKey("failed"),
        this.statusIndexKey("cancelled"),
        this.terminalRunRetentionIndexKey(),
        this.terminalRunRetentionMembersKey(),
        this.queueMessagesKey(candidate.runId),
        this.config.streamKey,
      ],
      [
        candidate.status,
        candidate.workflowId,
        createdAt,
        completedAt,
        String(candidate.revision),
        candidate.runId,
        this.config.groupName,
        String(TERMINAL_RETENTION_QUEUE_CLEANUP_LIMIT),
      ],
    );
    const resultCode = Number(result);
    const deleted = resultCode === 1;
    if (resultCode === 1) {
      this.lockValues.delete(candidate.runId);
      this.pendingMessageIds.delete(candidate.runId);
    }
    return deleted;
  }

  private async backfillTerminalRunIndexPage(
    client: RedisAdapter,
    limit: number,
  ): Promise<boolean> {
    const cursor = this.terminalRetentionBackfillCursor;

    const runPrefix = `${this.storagePrefix()}run:`;
    const page = await client.eval(
      SCAN_TERMINAL_RUN_KEYS_SCRIPT,
      [],
      [cursor, `${escapeRedisGlobLiteral(runPrefix)}*`, String(limit)],
    );
    if (
      !arrayIsArray(page) || page.length !== 2 || typeof page[0] !== "string" ||
      !arrayIsArray(page[1])
    ) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Redis returned an invalid terminal-run backfill page",
      });
    }
    const [nextCursor, keys] = page;
    let keyIndex = 0;
    while (keyIndex < keys.length) {
      const key = keys[keyIndex++];
      if (typeof key !== "string") continue;
      const values = await client.eval(
        READ_TERMINAL_RETENTION_FIELDS_SCRIPT,
        [key],
        [],
      );
      if (!arrayIsArray(values) || values.length !== 6) continue;
      const [runId, _workflowId, _createdAt, status, completedAt] = values;
      let completedAtMs: number | undefined;
      if (typeof completedAt === "string") {
        const parsedCompletedAt = new DateConstructor(completedAt);
        const timestamp = reflectApply(dateGetTime, parsedCompletedAt, []) as number;
        if (numberIsFinite(timestamp)) completedAtMs = timestamp;
      }
      if (
        typeof runId !== "string" || typeof completedAt !== "string" ||
        completedAtMs === undefined ||
        (status !== "completed" && status !== "failed" && status !== "cancelled")
      ) continue;
      await this.refreshTerminalRetentionIndex(
        client,
        runId,
        status,
        completedAt,
        String(completedAtMs),
      );
    }

    this.terminalRetentionBackfillCursor = nextCursor;
    return nextCursor === "0";
  }

  private async backfillTerminalQueueIndexPage(
    client: RedisAdapter,
    limit: number,
  ): Promise<boolean> {
    if (this.terminalRetentionQueueBackfillHighWater === null) {
      const highWater = await client.eval(
        READ_QUEUE_HIGH_WATER_SCRIPT,
        [this.config.streamKey],
        [],
      );
      if (typeof highWater !== "string") {
        throw ORCHESTRATION_ERROR.create({
          detail: "Redis returned an invalid workflow queue high-water mark",
        });
      }
      this.terminalRetentionQueueBackfillHighWater = highWater;
    }
    const raw = await client.eval(
      BACKFILL_QUEUE_MESSAGE_INDEX_SCRIPT,
      [this.config.streamKey],
      [
        this.terminalRetentionQueueBackfillCursor,
        String(limit),
        `${this.storagePrefix()}queue-messages:`,
        this.terminalRetentionQueueBackfillHighWater,
      ],
    );
    if (
      !arrayIsArray(raw) || raw.length !== 2 ||
      (raw[0] !== "0" && raw[0] !== "1") || typeof raw[1] !== "string"
    ) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Redis returned an invalid workflow queue backfill page",
      });
    }
    if (raw[0] === "1") {
      this.terminalRetentionQueueBackfillCursor = "-";
      return true;
    }
    if (raw[1] === "") {
      throw ORCHESTRATION_ERROR.create({
        detail: "Redis returned an invalid workflow queue backfill cursor",
      });
    }
    this.terminalRetentionQueueBackfillCursor = `(${raw[1]}`;
    return false;
  }

  private async performTerminalRetentionIndexRepair(
    client: RedisAdapter,
    limit: number,
  ): Promise<boolean> {
    if (!this.terminalRetentionRunBackfillComplete) {
      this.terminalRetentionRunBackfillComplete = await this.backfillTerminalRunIndexPage(
        client,
        limit,
      );
    }
    if (!this.terminalRetentionQueueBackfillComplete) {
      this.terminalRetentionQueueBackfillComplete = await this.backfillTerminalQueueIndexPage(
        client,
        limit,
      );
    }
    if (
      !this.terminalRetentionRunBackfillComplete ||
      !this.terminalRetentionQueueBackfillComplete
    ) return false;
    return true;
  }

  private async finishTerminalRetentionIndexRepair(
    repair: Promise<boolean>,
  ): Promise<boolean> {
    try {
      return await repair;
    } finally {
      if (this.terminalRetentionRepairInFlight === repair) {
        this.terminalRetentionRepairInFlight = null;
      }
    }
  }

  private repairTerminalRetentionIndexes(
    client: RedisAdapter,
    limit: number,
  ): Promise<boolean> {
    const inFlight = this.terminalRetentionRepairInFlight;
    if (inFlight !== null) return inFlight;
    const repair = this.performTerminalRetentionIndexRepair(client, limit);
    this.terminalRetentionRepairInFlight = repair;
    return this.finishTerminalRetentionIndexRepair(repair);
  }

  /** Return a bounded oldest-first batch without hydrating run payloads. */
  async listTerminalRunRetentionCandidates(
    completedBefore: Date,
    limit: number,
  ): Promise<TerminalRunRetentionBatch> {
    let cutoffMs: number;
    try {
      reflectApply(dateToISOString, completedBefore, []);
      cutoffMs = reflectApply(dateGetTime, completedBefore, []) as number;
    } catch {
      return { candidates: [], hasMore: false };
    }
    if (!numberIsSafeInteger(limit) || limit <= 0) {
      return { candidates: [], hasMore: false };
    }
    const client = await this.ensureClient();
    const backfillComplete = await this.repairTerminalRetentionIndexes(client, limit);
    if (!backfillComplete) return { candidates: [], hasMore: true };
    const raw = await client.eval(
      LIST_TERMINAL_RETENTION_CANDIDATES_SCRIPT,
      [this.terminalRunRetentionIndexKey(), this.terminalRunRetentionMembersKey()],
      [
        String(cutoffMs),
        String(limit + 1),
        `${this.storagePrefix()}run:`,
      ],
    );
    if (!arrayIsArray(raw) || raw.length === 0) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Redis returned an invalid terminal-run retention batch",
      });
    }
    const candidates: TerminalRunRetentionCandidate[] = [];
    for (let index = 1; index < raw.length; index++) {
      reflectApply(arrayPush, candidates, [parseRedisTerminalRetentionCandidate(raw[index])]);
    }
    const hasMore = raw[0] === "1" || candidates.length > limit;
    if (candidates.length > limit) candidates.length = limit;
    return { candidates, hasMore };
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
      [
        this.checkpointsKey(runId),
        this.runKey(runId),
        this.terminalRunRetentionMembersKey(),
        this.terminalRunRetentionGenerationKey(),
      ],
      [
        this.serializeCheckpoint(runId, checkpoint),
        String(MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES),
        runId,
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
    const client = await this.ensureClient();
    const ownershipMatches = (): Promise<boolean> =>
      this.runPreconditionMatches(
        client,
        ownershipRunId,
        expectedStatuses,
        expectedWorkerId,
      );
    if (!await ownershipMatches()) return false;

    let serializedCheckpoint: string;
    try {
      serializedCheckpoint = this.serializeCheckpoint(storageRunId, checkpoint);
    } catch (error) {
      if (!await ownershipMatches()) return false;
      throw error;
    }
    return await this.appendIfStatusAndWorker(
      ownershipRunId,
      storageRunId,
      expectedStatuses,
      expectedWorkerId,
      this.checkpointsKey(storageRunId),
      serializedCheckpoint,
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

  async savePendingApproval(runId: string, approval: PersistedPendingApproval): Promise<void> {
    await this.savePendingApprovalRecord(runId, approval, false);
  }

  async savePendingApprovalIfAbsent(
    runId: string,
    approval: PersistedPendingApproval,
  ): Promise<boolean> {
    return await this.savePendingApprovalRecord(runId, approval, true);
  }

  private async savePendingApprovalRecord(
    runId: string,
    approval: PersistedPendingApproval,
    rejectDuplicate: boolean,
  ): Promise<boolean> {
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
        this.terminalRunRetentionMembersKey(),
        this.terminalRunRetentionGenerationKey(),
      ],
      [
        this.serializeApproval(approval),
        String(MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES),
        this.runObservationKey(runId),
        String(RUN_OBSERVATION_STREAM_MAX_LENGTH),
        rejectDuplicate ? "1" : "0",
        runId,
      ],
    );
    if (Number(result) === 2) {
      throw this.approvalListFullError(approval.id);
    }
    return Number(result) !== 3;
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
    approval: PersistedPendingApproval,
  ): Promise<boolean> {
    const client = await this.ensureClient();
    const result = await client.eval(
      SAVE_PENDING_APPROVAL_IF_OWNED_SCRIPT,
      [
        this.runKey(runId),
        this.approvalsKey(runId),
        this.runObservationApprovalsKey(runId),
        this.terminalRunRetentionMembersKey(),
        this.terminalRunRetentionGenerationKey(),
      ],
      [
        String(expectedStatuses.length),
        ...expectedStatuses,
        expectedWorkerId,
        this.serializeApproval(approval),
        String(MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES),
        this.runObservationKey(runId),
        String(RUN_OBSERVATION_STREAM_MAX_LENGTH),
        runId,
      ],
    );
    if (Number(result) === 2) {
      throw this.approvalListFullError(approval.id);
    }
    return Number(result) === 1;
  }

  private parseApproval(raw: string): PersistedPendingApproval {
    const data = JSON.parse(raw);
    return {
      ...data,
      requestedAt: new Date(data.requestedAt),
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      decidedAt: data.decidedAt ? new Date(data.decidedAt) : undefined,
      recoveryClaimedAt: data.recoveryClaimedAt ? new Date(data.recoveryClaimedAt) : undefined,
    };
  }

  private async getApprovals(runId: string): Promise<PersistedPendingApproval[]> {
    const client = await this.ensureClient();
    const rawList = await client.lrange(this.approvalsKey(runId), 0, -1);
    return rawList.map((raw) => this.parseApproval(raw));
  }

  async getPendingApprovals(runId: string): Promise<PersistedPendingApproval[]> {
    return (await this.getApprovals(runId)).filter((approval) => approval.status === "pending");
  }

  async getPendingApproval(
    runId: string,
    approvalId: string,
  ): Promise<PersistedPendingApproval | null> {
    const approvals = await this.getPendingApprovals(runId);
    return approvals.find((a) => a.id === approvalId) || null;
  }

  async updatePendingApproval(
    runId: string,
    approvalId: string,
    patch: Partial<PersistedPendingApproval>,
  ): Promise<void> {
    const client = await this.ensureClient();
    // Locate-and-write in a single Lua step so a concurrent append/decision
    // cannot shift the list between a positional read and write. JSON.stringify
    // converts any Date fields on the patch to ISO strings via toJSON, matching
    // serializeApproval.
    const result = await client.eval(
      UPDATE_PENDING_APPROVAL_SCRIPT,
      [
        this.approvalsKey(runId),
        this.runKey(runId),
        this.terminalRunRetentionMembersKey(),
        this.terminalRunRetentionGenerationKey(),
      ],
      [approvalId, JSON.stringify({ ...patch, id: approvalId }), runId],
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
    const hasData = decision.data !== undefined;
    let serializedDecisionData: string | undefined;
    if (hasData) {
      try {
        serializedDecisionData = serializeWorkflowJson(
          decision.data,
          "approval decision data",
          runId,
          { strictContext: this.config.strictContext },
        );
      } catch (error) {
        const approval = (await this.getApprovals(runId)).find(({ id }) => id === approvalId);
        if (approval === undefined) {
          throw RESOURCE_NOT_FOUND.create({
            detail: `Approval not found: ${approvalId}`,
            cause: error,
          });
        }
        if (approval.status !== "pending") return false;
        throw error;
      }
    }
    // Atomic find-by-id + pending-precondition + LSET (see UPDATE_APPROVAL_SCRIPT).
    // decidedAt is computed here so the stored value is deterministic and does
    // not depend on the Redis server clock.
    const serializedPatchWithoutDecisionData = JSON.stringify({
      status: decision.approved ? "approved" : "rejected",
      decidedBy: decision.approver,
      decidedAt: new Date().toISOString(),
      reconciliationPending: true,
      ...(hasComment ? { comment: decision.comment } : {}),
    });
    const serializedPatch = serializedDecisionData === undefined
      ? serializedPatchWithoutDecisionData
      : `${
        serializedPatchWithoutDecisionData.slice(0, -1)
      },"decisionData":${serializedDecisionData}}`;
    const result = await client.eval(
      UPDATE_APPROVAL_SCRIPT,
      [
        this.approvalsKey(runId),
        this.runKey(runId),
        this.terminalRunRetentionMembersKey(),
        this.terminalRunRetentionGenerationKey(),
      ],
      [
        approvalId,
        serializedPatch,
        JSON.stringify([
          ...(hasComment ? [] : ["comment"]),
          ...(hasData ? [] : ["decisionData"]),
        ]),
        runId,
      ],
    );
    const code = Number(result);
    if (code === 0) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Approval not found: ${approvalId}` });
    }
    // 1 = applied; 2 = found but already decided (lost race).
    return code === 1;
  }

  async listApprovalDecisionClaims(
    runId?: string,
  ): Promise<Array<{ runId: string; approval: PersistedPendingApproval }>> {
    const client = await this.ensureClient();
    const result: Array<{ runId: string; approval: PersistedPendingApproval }> = [];
    if (runId !== undefined) {
      for (const approval of await this.getApprovals(runId)) {
        if (approval.reconciliationPending === true) result.push({ runId, approval });
      }
      return result;
    }

    const approvalsPrefix = `${this.storagePrefix()}approvals:`;
    const approvalKeys = new Set<string>();
    let cursor = 0;
    do {
      const page = await client.scan(cursor, {
        MATCH: `${approvalsPrefix}*`,
        COUNT: APPROVAL_RECOVERY_SCAN_COUNT,
      });
      cursor = page.cursor;
      for (const key of page.keys) approvalKeys.add(key);
    } while (cursor !== 0);

    for (const key of approvalKeys) {
      const claimRunId = key.replace(approvalsPrefix, "");
      for (const approval of await this.getApprovals(claimRunId)) {
        if (approval.reconciliationPending === true) {
          result.push({ runId: claimRunId, approval });
        }
      }
    }
    return result;
  }

  async reserveApprovalDecisionClaim(
    runId: string,
    approvalId: string,
    recoveryClaimId: string,
    claimedAt: Date,
    staleBefore: Date,
  ): Promise<boolean> {
    const client = await this.ensureClient();
    const result = await client.eval(
      RESERVE_APPROVAL_DECISION_SCRIPT,
      [
        this.approvalsKey(runId),
        this.runKey(runId),
        this.terminalRunRetentionMembersKey(),
        this.terminalRunRetentionGenerationKey(),
      ],
      [
        approvalId,
        recoveryClaimId,
        staleBefore.toISOString(),
        JSON.stringify({
          recoveryClaimId,
          recoveryClaimedAt: claimedAt.toISOString(),
        }),
        runId,
      ],
    );
    return Number(result) === 1;
  }

  async releaseApprovalDecisionClaim(
    runId: string,
    approvalId: string,
    recoveryClaimId: string,
  ): Promise<void> {
    const client = await this.ensureClient();
    await client.eval(
      RELEASE_APPROVAL_DECISION_CLAIM_SCRIPT,
      [
        this.approvalsKey(runId),
        this.runKey(runId),
        this.terminalRunRetentionMembersKey(),
        this.terminalRunRetentionGenerationKey(),
      ],
      [approvalId, recoveryClaimId, runId],
    );
  }

  async finalizeApprovalDecision(
    runId: string,
    approvalId: string,
    recoveryClaimId?: string,
  ): Promise<void> {
    const client = await this.ensureClient();
    await client.eval(
      FINALIZE_APPROVAL_DECISION_SCRIPT,
      [
        this.approvalsKey(runId),
        this.runKey(runId),
        this.terminalRunRetentionMembersKey(),
        this.terminalRunRetentionGenerationKey(),
      ],
      [approvalId, recoveryClaimId ?? "", runId],
    );
  }

  async listPendingApprovals(filter?: {
    workflowId?: string;
    approver?: string;
    status?: "pending" | "expired";
  }): Promise<Array<{ runId: string; approval: PersistedPendingApproval }>> {
    const client = await this.ensureClient();
    const result: Array<{ runId: string; approval: PersistedPendingApproval }> = [];

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

    await client.eval(
      ENQUEUE_RUN_SCRIPT,
      [
        this.config.streamKey,
        this.queueMessagesKey(job.runId),
        this.runKey(job.runId),
        this.terminalRunRetentionMembersKey(),
        this.terminalRunRetentionGenerationKey(),
        this.terminalRunRetentionIndexKey(),
      ],
      [
        job.runId,
        job.workflowId,
        JSON.stringify(job.input),
        String(job.priority || 0),
        job.createdAt.toISOString(),
      ],
    );
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
    await client.eval(
      REMOVE_ACKNOWLEDGED_QUEUE_MESSAGES_SCRIPT,
      [
        this.config.streamKey,
        this.queueMessagesKey(runId),
        this.runKey(runId),
        this.terminalRunRetentionIndexKey(),
        this.terminalRunRetentionMembersKey(),
      ],
      [runId, ...messageIds],
    );
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
      [
        this.runKey(runId),
        this.claimKey(runId),
        this.terminalRunRetentionGenerationKey(),
      ],
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
    let initialApprovals: PendingApproval[];
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
      initialApprovals = await this.getApprovals(runId);
      initial.pendingApprovals = initialApprovals.filter((approval) =>
        approval.status === "pending"
      );
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
    const readApprovals = () => this.getApprovals(runId);
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
        const observedApprovalIds = new Set(initialApprovals.map((approval) => approval.id));
        try {
          while (!controller.signal.aborted) {
            let records: ReturnType<typeof parseRunObservationRecords>;
            try {
              records = parseRunObservationRecords(
                await client.eval(
                  READ_RUN_OBSERVATIONS_SCRIPT,
                  [streamKey, approvalJournalKey],
                  [lastStreamId, String(RUN_OBSERVATION_STREAM_MAX_LENGTH)],
                ),
              );
            } catch {
              throw new Error("Workflow run observation failed");
            }
            if (records.length === 0) {
              try {
                if (await client.exists(runKey) === 0) {
                  throw new Error("Workflow run observation failed");
                }
              } catch {
                throw new Error("Workflow run observation failed");
              }
            }

            const readLegacyApprovalState = async (
              baseState: WorkflowRunObservedState,
              queuedRecords: ReturnType<typeof parseRunObservationRecords>,
            ): Promise<WorkflowRunObservedState | undefined> => {
              let approvals: PendingApproval[];
              const journaledApprovalIds = new Set<string>();
              try {
                for (const record of queuedRecords) {
                  if (record.approvals === undefined) continue;
                  for (const approval of parseRunObservedApprovals(record.approvals)) {
                    journaledApprovalIds.add(approval.id);
                  }
                }
                approvals = await readApprovals();
              } catch {
                throw new Error("Workflow run observation failed");
              }
              const boundaryIndex = approvals.findIndex((approval) =>
                !observedApprovalIds.has(approval.id) &&
                journaledApprovalIds.has(approval.id)
              );
              const boundaryApproval = boundaryIndex === -1 ? undefined : approvals[boundaryIndex];
              const eligibleEnd = boundaryIndex === -1
                ? approvals.length
                : boundaryIndex + (boundaryApproval?.status === "pending" ? 0 : 1);
              const eligibleApprovals = approvals.slice(0, eligibleEnd);
              const unseen = eligibleApprovals.filter((approval) =>
                !observedApprovalIds.has(approval.id)
              );
              if (unseen.length > 0) {
                const unseenIds = new Set(unseen.map((approval) => approval.id));
                const eligibleIds = new Set(eligibleApprovals.map((approval) => approval.id));
                const baseApprovals = new Map(
                  (baseState.approvals ?? []).map((approval) => [approval.id, approval]),
                );
                for (const approval of unseen) observedApprovalIds.add(approval.id);
                const projection: NonNullable<WorkflowRunObservedState["approvals"]> = [];
                const projectedIds = new Set<string>();
                for (const approval of approvals) {
                  const baseApproval = baseApprovals.get(approval.id);
                  if (baseApproval !== undefined) {
                    projection.push(baseApproval);
                    projectedIds.add(approval.id);
                    continue;
                  }
                  if (
                    (approval.status === "pending" &&
                      (observedApprovalIds.has(approval.id) || eligibleIds.has(approval.id))) ||
                    unseenIds.has(approval.id)
                  ) {
                    projection.push(projectApproval(approval));
                    projectedIds.add(approval.id);
                  }
                }
                for (const approval of baseState.approvals ?? []) {
                  if (!projectedIds.has(approval.id)) projection.push(approval);
                }
                return {
                  ...baseState,
                  approvals: projection,
                };
              }
              return undefined;
            };

            // Older workers append and decide approvals without observation
            // revisions. Compare every retained id only when the currently
            // observed state is waiting. A decided record is included once
            // when it first appears so a fast legacy decision cannot erase the
            // preceding pending transition, even when a queued pending-only
            // projection already names it.
            if (lastObservedState.status === "waiting") {
              const legacyApprovalState = await readLegacyApprovalState(
                lastObservedState,
                records,
              );
              if (legacyApprovalState !== undefined) {
                lastObservedState = legacyApprovalState;
                yield legacyApprovalState;
              }
            }

            if (records.length === 0) {
              await waitForObservationPoll(controller.signal);
              continue;
            }
            for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
              const record = records[recordIndex];
              if (record === undefined) continue;
              lastStreamId = record.id;
              let state: WorkflowRunObservedState;
              try {
                state = parseRunObservedState(record.data);
                if (record.approvals !== undefined) {
                  state.approvals = parseRunObservedApprovals(record.approvals);
                }
              } catch {
                throw new Error("Workflow run observation failed");
              }
              if (state.revision <= initialRevision) continue;
              if (state.revision !== expectedRevision) {
                throw new Error("Workflow run observation failed");
              }
              expectedRevision++;
              if (state.approvals !== undefined) {
                for (const approval of state.approvals) observedApprovalIds.add(approval.id);
              }
              let observedState = state;
              if (observedState.status === "waiting") {
                observedState = await readLegacyApprovalState(
                  observedState,
                  records.slice(recordIndex + 1),
                ) ?? observedState;
              }
              lastObservedState = observedState;
              if (observedState.approvals !== undefined) {
                for (const approval of observedState.approvals) {
                  observedApprovalIds.add(
                    approval.id,
                  );
                }
              }
              yield observedState;
              if (TERMINAL_RUN_STATUSES.has(observedState.status)) return;
            }
          }
        } finally {
          close();
        }
      },
    };

    return {
      initial,
      changes,
      close: () => {
        close();
        return Promise.resolve();
      },
    };
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
