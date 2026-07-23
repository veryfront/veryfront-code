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
import { agentLogger } from "#veryfront/utils";
import { requeueRun } from "../shared/requeue-run.ts";
import { INITIALIZATION_ERROR, INVALID_ARGUMENT, RESOURCE_NOT_FOUND } from "#veryfront/errors";
import { requireWorkflowSourceIntegrationPolicy } from "../../source-integration-policy.ts";

import type { RedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";
import { getRedisModule, NodeRedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";

export type { RedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";
export type { RedisBackendConfig } from "./types.ts";

import type { RedisBackendConfig, RedisBackendInternalConfig } from "./types.ts";

const logger = agentLogger.component("redis-backend");
const REDIS_STORAGE_SCHEMA_VERSION = "schema-v1";
const REDIS_STORAGE_SCHEMA_NAMESPACE = `${REDIS_STORAGE_SCHEMA_VERSION}:`;

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
return 1`;

/** Atomically verify that a run exists, patch it, and update its status index. */
const UPDATE_RUN_SCRIPT = `-- atomic-run-update
local oldStatus = redis.call('hget', KEYS[1], 'status')
if not oldStatus or oldStatus == '' then return 0 end
local nextStatus = ARGV[3]
for i = 4, #ARGV, 2 do
  redis.call('hset', KEYS[1], ARGV[i], ARGV[i + 1])
end
if nextStatus ~= '' and oldStatus ~= nextStatus then
  redis.call('hset', KEYS[1], 'status', nextStatus)
  redis.call('srem', ARGV[2] .. oldStatus, ARGV[1])
  redis.call('sadd', ARGV[2] .. nextStatus, ARGV[1])
end
if nextStatus ~= '' and nextStatus ~= 'running' then
  redis.call('del', KEYS[2])
end
return 1`;

/** Atomically replace a canonical run hash and all of its secondary indexes. */
const CREATE_RUN_SCRIPT = `-- atomic-run-create-or-replace
local oldStatus = redis.call('hget', KEYS[1], 'status')
local oldWorkflowId = redis.call('hget', KEYS[1], 'workflowId')
if oldStatus and oldStatus ~= '' then
  redis.call('srem', ARGV[2] .. oldStatus, ARGV[1])
end
if oldWorkflowId and oldWorkflowId ~= '' then
  redis.call('srem', ARGV[3] .. oldWorkflowId, ARGV[1])
end
redis.call('del', KEYS[1])
for i = 8, #ARGV, 2 do
  redis.call('hset', KEYS[1], ARGV[i], ARGV[i + 1])
end
redis.call('sadd', ARGV[2] .. ARGV[4], ARGV[1])
redis.call('sadd', ARGV[3] .. ARGV[5], ARGV[1])
redis.call('sadd', ARGV[6], ARGV[1])
if ARGV[7] ~= '' then
  redis.call('expire', KEYS[1], ARGV[7])
end
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
for i = expectedCount + 6, #ARGV, 2 do
  redis.call('hset', KEYS[1], ARGV[i], ARGV[i + 1])
end
if nextStatus ~= '' and nextStatus ~= 'running' then
  redis.call('del', KEYS[2])
end
return 1`;

/** Atomically remove a canonical run, its auxiliary data, and secondary indexes. */
const DELETE_RUN_SCRIPT = `-- atomic-run-delete
local status = redis.call('hget', KEYS[1], 'status')
local workflowId = redis.call('hget', KEYS[1], 'workflowId')
redis.call('del', KEYS[1], KEYS[2], KEYS[3], KEYS[4])
redis.call('srem', ARGV[4], ARGV[1])
if status and status ~= '' then
  redis.call('srem', ARGV[2] .. status, ARGV[1])
end
if workflowId and workflowId ~= '' then
  redis.call('srem', ARGV[3] .. workflowId, ARGV[1])
end
if status or workflowId then return 1 end
return 0`;

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
redis.call('rpush', ARGV[expectedCount + 3], ARGV[expectedCount + 4])
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
    if (
      config.runTtl !== undefined &&
      (!Number.isSafeInteger(config.runTtl) || config.runTtl <= 0)
    ) {
      throw INVALID_ARGUMENT.create({ detail: "runTtl must be a positive safe integer" });
    }

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
      [this.runKey(ownershipRunId)],
      [
        String(expectedStatuses.length),
        ...expectedStatuses,
        expectedWorkerId,
        storageKey,
        value,
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

    function parseJson<T>(
      runId: string,
      field: string,
      value: string,
    ): T {
      try {
        return JSON.parse(value) as T;
      } catch (e) {
        throw INVALID_ARGUMENT.create({
          detail:
            `Invalid workflow run data for run "${runId}": failed to parse '${field}' as JSON. ` +
            `Error: ${e instanceof Error ? e.message : String(e)}`,
          cause: e instanceof Error ? e : undefined,
        });
      }
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
      // our adapter), so substring matching is the only signal available.
      const msg = String(e instanceof Error ? e.message : e);
      if (!msg.includes("BUSYGROUP")) {
        throw INITIALIZATION_ERROR.create({
          detail: "Failed to initialize the Redis workflow queue",
          cause: e instanceof Error ? e : undefined,
        });
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
      [this.runKey(run.id)],
      [
        run.id,
        `${this.storagePrefix()}index:status:`,
        `${this.storagePrefix()}index:workflow:`,
        run.status,
        run.workflowId,
        this.allRunsIndexKey(),
        this.config.runTtl ? String(this.config.runTtl) : "",
        ...Object.entries(serializedRun).flatMap(([field, value]) => [field, value]),
      ],
    );
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

    const fields = this.serializeRunPatch(patch);
    const result = await client.eval(
      UPDATE_RUN_SCRIPT,
      [this.runKey(runId), this.claimKey(runId)],
      [
        runId,
        `${this.storagePrefix()}index:status:`,
        patch.status ?? "",
        ...Object.entries(fields).flatMap(([field, value]) => [field, value]),
      ],
    );
    if (Number(result) !== 1) {
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
      [this.runKey(runId), this.claimKey(runId)],
      [
        String(expectedStatuses.length),
        ...expectedStatuses,
        patch.status ?? "",
        `${this.storagePrefix()}index:status:`,
        runId,
        expectedWorkerId ?? "",
        ...fieldArgs,
      ],
    );
    return Number(result) === 1;
  }

  async deleteRun(runId: string): Promise<void> {
    const client = await this.ensureClient();
    await client.eval(
      DELETE_RUN_SCRIPT,
      [
        this.runKey(runId),
        this.checkpointsKey(runId),
        this.approvalsKey(runId),
        this.claimKey(runId),
      ],
      [
        runId,
        `${this.storagePrefix()}index:status:`,
        `${this.storagePrefix()}index:workflow:`,
        this.allRunsIndexKey(),
      ],
    );
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

    await client.rpush(
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
    const client = await this.ensureClient();

    if (this.config.debug) logger.debug(`[RedisBackend] Saving approval: ${approval.id}`);

    await client.rpush(
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
