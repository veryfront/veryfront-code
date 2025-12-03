/**
 * Redis Workflow Backend
 *
 * Production-grade Redis implementation of WorkflowBackend.
 * Uses Redis hashes for state storage and Redis Streams for job queuing.
 */

import type {
  ApprovalDecision,
  Checkpoint,
  PendingApproval,
  RunFilter,
  WorkflowJob,
  WorkflowRun,
  WorkflowStatus,
} from "../types.ts";
import type { BackendConfig, WorkflowBackend } from "./types.ts";
import { agentLogger as logger } from "@veryfront/utils";

// Lazy-loaded Redis client modules (loaded only when Redis backend is used)
// @ts-ignore - Deno global
let DenoRedis: any = null;
let NodeRedis: any = null;

/**
 * Lazily load the Redis module for the current runtime.
 * This ensures the redis package is only required when the Redis backend is actually used.
 */
async function getRedisModule(): Promise<{ DenoRedis: any; NodeRedis: any }> {
  // Return cached modules if already loaded
  if (DenoRedis || NodeRedis) {
    return { DenoRedis, NodeRedis };
  }

  // @ts-ignore - Deno global
  if (typeof Deno !== "undefined") {
    try {
      // @ts-ignore - Deno global
      DenoRedis = await import("https://deno.land/x/redis@v0.32.1/mod.ts");
    } catch (error) {
      throw new Error(
        `Failed to load Deno Redis module. Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else {
    try {
      NodeRedis = await import("redis");
    } catch (error) {
      throw new Error(
        `Failed to load 'redis' package. Please install it with: npm install redis\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return { DenoRedis, NodeRedis };
}

/**
 * Standardized Redis Adapter Interface
 * Normalizes differences between Deno and Node Redis clients
 */
export interface RedisAdapter {
  // Hash operations
  hset(key: string, fields: Record<string, string>): Promise<number | string>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  del(...keys: string[]): Promise<number>;

  // Set operations (for indexing)
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;

  // List operations (for checkpoints)
  rpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  lindex(key: string, index: number): Promise<string | null>;
  lset(key: string, index: number, value: string): Promise<string | 'OK'>;
  llen(key: string): Promise<number>;

  // Stream operations
  xadd(key: string, id: string, fields: Record<string, string>): Promise<string>;
  xgroupCreate(key: string, group: string, id: string, mkstream?: boolean): Promise<string>;
  xreadgroup(
    streams: Array<{ key: string; xid: string }>,
    options: { group: string; consumer: string; block?: number; count?: number },
  ): Promise<Array<{ key: string; messages: Array<{ id: string; data: Record<string, string> }> }>>;
  xack(key: string, group: string, ...ids: string[]): Promise<number>;

  // Key operations
  keys(pattern: string): Promise<string[]>;
  exists(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;

  // Lock operations (using SET with NX and PX)
  set(
    key: string,
    value: string,
    options?: { nx?: boolean; px?: number; ex?: number },
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;

  // Connection
  quit(): Promise<void>;
  disconnect(): Promise<void>;
}

// Helper to convert array [k1, v1, k2, v2] to object
function arrayToObject(arr: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < arr.length; i += 2) {
    const key = arr[i];
    const value = arr[i + 1];
    if (key && value !== undefined) {
      obj[key] = value;
    }
  }
  return obj;
}

/**
 * Adapter for Node.js 'redis' package
 */
class NodeRedisAdapter implements RedisAdapter {
  constructor(private client: any) {}

  async hset(key: string, fields: Record<string, string>): Promise<number | string> {
    return await this.client.hSet(key, fields);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return await this.client.hGetAll(key);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return await this.client.hDel(key, fields);
  }

  async del(...keys: string[]): Promise<number> {
    return await this.client.del(keys);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    return await this.client.sAdd(key, members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return await this.client.sRem(key, members);
  }

  async smembers(key: string): Promise<string[]> {
    return await this.client.sMembers(key);
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    return await this.client.rPush(key, values);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return await this.client.lRange(key, start, stop);
  }

  async lindex(key: string, index: number): Promise<string | null> {
    return await this.client.lIndex(key, index);
  }

  async lset(key: string, index: number, value: string): Promise<string | 'OK'> {
    return await this.client.lSet(key, index, value);
  }

  async llen(key: string): Promise<number> {
    return await this.client.lLen(key);
  }

  async xadd(key: string, id: string, fields: Record<string, string>): Promise<string> {
    return await this.client.xAdd(key, id, fields);
  }

  async xgroupCreate(key: string, group: string, id: string, mkstream?: boolean): Promise<string> {
    return await this.client.xGroupCreate(key, group, id, { MKSTREAM: mkstream });
  }

  async xreadgroup(
    streams: Array<{ key: string; xid: string }>,
    options: { group: string; consumer: string; block?: number; count?: number },
  ): Promise<Array<{ key: string; messages: Array<{ id: string; data: Record<string, string> }> }>> {
    // Node redis format: { key: string, messages: Array<{ id: string, message: Record<string, string> }> }
    // OR if single stream: Array<{ id: string, message: Record<string, string> }> ??
    // The node-redis v4 API is slightly different.
    // Assuming commandOptions style:
    const result = await this.client.xReadGroup(
      options.group,
      options.consumer,
      streams.map(s => ({ key: s.key, id: s.xid })),
      {
        BLOCK: options.block,
        COUNT: options.count
      }
    );

    if (!result) return [];

    // Normalize output
    // node-redis v4 returns: Array<{ name: string, messages: Array<{ id: string, message: Record<string, string> }> }>
    return (result as any[]).map((stream: any) => ({
      key: stream.name,
      messages: stream.messages.map((msg: any) => ({
        id: msg.id,
        data: msg.message,
      })),
    }));
  }

  async xack(key: string, group: string, ...ids: string[]): Promise<number> {
    return await this.client.xAck(key, group, ids);
  }

  async keys(pattern: string): Promise<string[]> {
    return await this.client.keys(pattern);
  }

  async exists(...keys: string[]): Promise<number> {
    return await this.client.exists(keys);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return await this.client.expire(key, seconds);
  }

  async set(
    key: string,
    value: string,
    options?: { nx?: boolean; px?: number; ex?: number },
  ): Promise<string | null> {
    const opts: any = {};
    if (options?.nx) opts.NX = true;
    if (options?.px) opts.PX = options.px;
    if (options?.ex) opts.EX = options.ex;
    return await this.client.set(key, value, opts);
  }

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async quit(): Promise<void> {
    await this.client.quit();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }
}

/**
 * Adapter for Deno 'redis' module
 */
class DenoRedisAdapter implements RedisAdapter {
  constructor(private client: any) {}

  async hset(key: string, fields: Record<string, string>): Promise<number | string> {
    return await this.client.hset(key, fields);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const res = await this.client.hgetall(key);
    // Deno redis returns array [k1, v1, k2, v2]
    return arrayToObject(res);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return await this.client.hdel(key, ...fields);
  }

  async del(...keys: string[]): Promise<number> {
    return await this.client.del(...keys);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    return await this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return await this.client.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return await this.client.smembers(key);
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    return await this.client.rpush(key, ...values);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return await this.client.lrange(key, start, stop);
  }

  async lindex(key: string, index: number): Promise<string | null> {
    return await this.client.lindex(key, index);
  }

  async lset(key: string, index: number, value: string): Promise<string | 'OK'> {
    return await this.client.lset(key, index, value);
  }

  async llen(key: string): Promise<number> {
    return await this.client.llen(key);
  }

  async xadd(key: string, id: string, fields: Record<string, string>): Promise<string> {
    return await this.client.xadd(key, id, fields);
  }

  async xgroupCreate(key: string, group: string, id: string, mkstream?: boolean): Promise<string> {
    return await this.client.xgroupCreate(key, group, id, mkstream);
  }

  async xreadgroup(
    streams: Array<{ key: string; xid: string }>,
    options: { group: string; consumer: string; block?: number; count?: number },
  ): Promise<Array<{ key: string; messages: Array<{ id: string; data: Record<string, string> }> }>> {
    if (streams.length === 0) return [];

    // Deno redis returns: Array<{ key: string, messages: Array<{ id: string, fieldValues: string[] }> }>
    const res = await this.client.xreadgroup(
      streams.map(s => ({ key: s.key, xid: s.xid })),
      options
    );

    if (!res) return [];

    return (res as any[]).map((stream: any) => ({
      key: stream.key,
      messages: stream.messages.map((msg: any) => ({
        id: msg.id,
        data: arrayToObject(msg.fieldValues),
      })),
    }));
  }

  async xack(key: string, group: string, ...ids: string[]): Promise<number> {
    return await this.client.xack(key, group, ...ids);
  }

  async keys(pattern: string): Promise<string[]> {
    return await this.client.keys(pattern);
  }

  async exists(...keys: string[]): Promise<number> {
    return await this.client.exists(...keys);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return await this.client.expire(key, seconds);
  }

  async set(
    key: string,
    value: string,
    options?: { nx?: boolean; px?: number; ex?: number },
  ): Promise<string | null> {
    return await this.client.set(key, value, options);
  }

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async quit(): Promise<void> {
    await this.client.close(); // Deno redis uses close
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }
}

/**
 * Redis backend configuration
 */
export interface RedisBackendConfig extends BackendConfig {
  /** Redis connection URL or config */
  url?: string;
  /** Redis hostname */
  hostname?: string;
  /** Redis port */
  port?: number;
  /** Key prefix for namespacing */
  prefix?: string;
  /** Stream name for job queue */
  streamKey?: string;
  /** Consumer group name */
  groupName?: string;
  /** Consumer name (unique per worker) */
  consumerName?: string;
  /** Default TTL for runs (in seconds) */
  runTtl?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Existing Redis client (optional) */
  client?: RedisAdapter;
}

/**
 * Redis Workflow Backend
 */
export class RedisBackend implements WorkflowBackend {
  private client: RedisAdapter | null = null;
  private connectionPromise: Promise<RedisAdapter> | null = null;
  private config: Required<
    Pick<RedisBackendConfig, "prefix" | "streamKey" | "groupName" | "consumerName" | "debug">
  > & RedisBackendConfig;
  private initialized = false;

  constructor(config: RedisBackendConfig = {}) {
    this.config = {
      prefix: "vf:workflow:",
      streamKey: "vf:workflow:stream",
      groupName: "vf:workflow:workers",
      consumerName: `worker-${crypto.randomUUID().slice(0, 8)}`,
      debug: false,
      ...config,
    };

    // Use provided client if available
    if (config.client) {
      this.client = config.client;
    }
  }

  // =========================================================================
  // Key Generation
  // =========================================================================

  private runKey(runId: string): string {
    return `${this.config.prefix}run:${runId}`;
  }

  private checkpointsKey(runId: string): string {
    return `${this.config.prefix}checkpoints:${runId}`;
  }

  private approvalsKey(runId: string): string {
    return `${this.config.prefix}approvals:${runId}`;
  }

  private statusIndexKey(status: WorkflowStatus): string {
    return `${this.config.prefix}index:status:${status}`;
  }

  private workflowIndexKey(workflowId: string): string {
    return `${this.config.prefix}index:workflow:${workflowId}`;
  }

  private lockKey(runId: string): string {
    return `${this.config.prefix}lock:${runId}`;
  }

  // =========================================================================
  // Serialization
  // =========================================================================

  private serializeRun(run: WorkflowRun): Record<string, string> {
    return {
      id: run.id,
      workflowId: run.workflowId,
      version: run.version || "",
      status: run.status,
      input: JSON.stringify(run.input),
      output: run.output !== undefined ? JSON.stringify(run.output) : "",
      nodeStates: JSON.stringify(run.nodeStates),
      currentNodes: JSON.stringify(run.currentNodes),
      context: JSON.stringify(run.context),
      error: run.error ? JSON.stringify(run.error) : "",
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() || "",
      completedAt: run.completedAt?.toISOString() || "",
    };
  }

  private deserializeRun(data: Record<string, string>): WorkflowRun {
    // Validate required fields
    if (!data.id) {
      throw new Error("Invalid workflow run data: missing 'id' field");
    }
    if (!data.workflowId) {
      throw new Error(`Invalid workflow run data for run "${data.id}": missing 'workflowId' field`);
    }

    // Validate status is a known value
    const validStatuses: WorkflowStatus[] = ["pending", "running", "completed", "failed", "cancelled", "waiting"];
    const status = data.status as WorkflowStatus;
    if (data.status && !validStatuses.includes(status)) {
      throw new Error(
        `Invalid workflow run data for run "${data.id}": unknown status "${data.status}". ` +
        `Expected one of: ${validStatuses.join(", ")}`
      );
    }

    // Safely parse JSON fields with error context
    const safeJsonParse = <T>(field: string, value: string | undefined, defaultValue: T): T => {
      if (!value) return defaultValue;
      try {
        return JSON.parse(value) as T;
      } catch (e) {
        throw new Error(
          `Invalid workflow run data for run "${data.id}": failed to parse '${field}' as JSON. ` +
          `Error: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    };

    return {
      id: data.id,
      workflowId: data.workflowId,
      version: data.version || undefined,
      status: status ?? "pending",
      input: safeJsonParse("input", data.input, undefined),
      output: safeJsonParse("output", data.output, undefined),
      nodeStates: safeJsonParse("nodeStates", data.nodeStates, {}),
      currentNodes: safeJsonParse("currentNodes", data.currentNodes, []),
      context: safeJsonParse("context", data.context, { input: undefined }),
      checkpoints: [], // Loaded separately
      pendingApprovals: [], // Loaded separately
      error: safeJsonParse("error", data.error, undefined),
      createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
      startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
      completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
    };
  }

  // =========================================================================
  // Connection Management
  // =========================================================================

  private ensureClient(): Promise<RedisAdapter> {
    // Return existing client if available
    if (this.client) {
      return Promise.resolve(this.client);
    }

    // Use existing connection promise to prevent race conditions
    // Multiple concurrent calls will share the same connection promise
    if (!this.connectionPromise) {
      this.connectionPromise = this.createConnection();
    }

    return this.connectionPromise;
  }

  /**
   * Create a new Redis connection
   */
  private async createConnection(): Promise<RedisAdapter> {
    // Lazily load the Redis module for the current runtime
    const { DenoRedis: denoRedis, NodeRedis: nodeRedis } = await getRedisModule();

    if (nodeRedis) {
      const client = nodeRedis.createClient({
        url: this.config.url,
        socket: {
          host: this.config.hostname,
          port: this.config.port,
        },
      });
      await client.connect();
      this.client = new NodeRedisAdapter(client);
    } else if (denoRedis) {
      const client = await denoRedis.connect({
        hostname: this.config.hostname,
        port: this.config.port,
      });
      this.client = new DenoRedisAdapter(client);
    } else {
      throw new Error("No Redis client available for this runtime.");
    }

    const hostname = this.config.hostname || "127.0.0.1";
    const port = this.config.port || 6379;

    if (this.config.debug) {
      logger.debug(`[RedisBackend] Connecting to ${hostname}:${port}`);
    }

    // Ensure client is not null for TS
    return this.client!;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const client = await this.ensureClient();

    // Create consumer group for stream
    try {
      await client.xgroupCreate(
        this.config.streamKey,
        this.config.groupName,
        "0",
        true,
      );
      if (this.config.debug) {
        logger.debug(`[RedisBackend] Created consumer group: ${this.config.groupName}`);
      }
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (!msg.includes("BUSYGROUP")) {
        logger.error("[RedisBackend] Error creating consumer group:", e);
      }
    }

    this.initialized = true;
  }

  // =========================================================================
  // Run Management
  // =========================================================================

  async createRun(run: WorkflowRun): Promise<void> {
    const client = await this.ensureClient();

    if (this.config.debug) {
      logger.debug(`[RedisBackend] Creating run: ${run.id}`);
    }

    // Store run in hash
    await client.hset(this.runKey(run.id), this.serializeRun(run));

    // Add to indexes
    await client.sadd(this.statusIndexKey(run.status), run.id);
    await client.sadd(this.workflowIndexKey(run.workflowId), run.id);

    // Set TTL if configured
    if (this.config.runTtl) {
      await client.expire(this.runKey(run.id), this.config.runTtl);
    }
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    const client = await this.ensureClient();
    const data = await client.hgetall(this.runKey(runId));

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    const run = this.deserializeRun(data);

    // Load approvals
    run.pendingApprovals = await this.getPendingApprovals(runId);

    return run;
  }

  async updateRun(runId: string, patch: Partial<WorkflowRun>): Promise<void> {
    const client = await this.ensureClient();

    if (this.config.debug) {
      logger.debug(`[RedisBackend] Updating run: ${runId}`);
    }

    // Get current status for index update
    const currentRun = await this.getRun(runId);
    const oldStatus = currentRun?.status;

    // Build fields to update
    const fields: Record<string, string> = {};

    if (patch.status !== undefined) fields.status = patch.status;
    if (patch.output !== undefined) fields.output = JSON.stringify(patch.output);
    if (patch.nodeStates !== undefined) fields.nodeStates = JSON.stringify(patch.nodeStates);
    if (patch.currentNodes !== undefined) fields.currentNodes = JSON.stringify(patch.currentNodes);
    if (patch.context !== undefined) fields.context = JSON.stringify(patch.context);
    if (patch.error !== undefined) fields.error = JSON.stringify(patch.error);
    if (patch.startedAt !== undefined) fields.startedAt = patch.startedAt.toISOString();
    if (patch.completedAt !== undefined) fields.completedAt = patch.completedAt.toISOString();

    if (Object.keys(fields).length > 0) {
      await client.hset(this.runKey(runId), fields);
    }

    // Update status index
    if (patch.status && oldStatus && patch.status !== oldStatus) {
      await client.srem(this.statusIndexKey(oldStatus), runId);
      await client.sadd(this.statusIndexKey(patch.status), runId);
    }
  }

  async deleteRun(runId: string): Promise<void> {
    const client = await this.ensureClient();

    // Get run for index cleanup
    const run = await this.getRun(runId);
    if (!run) return;

    // Delete run data
    await client.del(
      this.runKey(runId),
      this.checkpointsKey(runId),
      this.approvalsKey(runId),
    );

    // Remove from indexes
    await client.srem(this.statusIndexKey(run.status), runId);
    await client.srem(this.workflowIndexKey(run.workflowId), runId);
  }

  async listRuns(filter: RunFilter): Promise<WorkflowRun[]> {
    const client = await this.ensureClient();
    let runIds: string[] = [];

    // Get run IDs from indexes
    if (filter.workflowId) {
      runIds = await client.smembers(this.workflowIndexKey(filter.workflowId));
    } else if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      for (const status of statuses) {
        const ids = await client.smembers(this.statusIndexKey(status));
        runIds.push(...ids);
      }
      // Deduplicate
      runIds = [...new Set(runIds)];
    } else {
      // Get all runs (expensive - should use cursor in production)
      const keys = await client.keys(`${this.config.prefix}run:*`);
      runIds = keys.map((k) => k.replace(`${this.config.prefix}run:`, ""));
    }

    // Load runs
    const runs: WorkflowRun[] = [];
    for (const runId of runIds) {
      const run = await this.getRun(runId);
      if (!run) continue;

      // Apply filters
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        if (!statuses.includes(run.status)) continue;
      }

      if (filter.createdAfter && run.createdAt < filter.createdAfter) continue;
      if (filter.createdBefore && run.createdAt > filter.createdBefore) continue;

      runs.push(run);
    }

    // Sort by creation date (newest first)
    runs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Apply pagination
    let result = runs;
    if (filter.offset) {
      result = result.slice(filter.offset);
    }
    if (filter.limit) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  async countRuns(filter: RunFilter): Promise<number> {
    const runs = await this.listRuns({ ...filter, limit: undefined, offset: undefined });
    return runs.length;
  }

  // =========================================================================
  // Checkpointing
  // =========================================================================

  async saveCheckpoint(runId: string, checkpoint: Checkpoint): Promise<void> {
    const client = await this.ensureClient();

    if (this.config.debug) {
      logger.debug(`[RedisBackend] Saving checkpoint: ${checkpoint.id}`);
    }

    const serialized = JSON.stringify({
      ...checkpoint,
      timestamp: checkpoint.timestamp.toISOString(),
    });

    await client.rpush(this.checkpointsKey(runId), serialized);
  }

  async getLatestCheckpoint(runId: string): Promise<Checkpoint | null> {
    const client = await this.ensureClient();

    // Get last element
    const raw = await client.lindex(this.checkpointsKey(runId), -1);
    if (!raw) return null;

    const data = JSON.parse(raw);
    return {
      ...data,
      timestamp: new Date(data.timestamp),
    };
  }

  async getCheckpoints(runId: string): Promise<Checkpoint[]> {
    const client = await this.ensureClient();

    const rawList = await client.lrange(this.checkpointsKey(runId), 0, -1);

    return rawList.map((raw) => {
      const data = JSON.parse(raw);
      return {
        ...data,
        timestamp: new Date(data.timestamp),
      };
    });
  }

  // =========================================================================
  // Approvals
  // =========================================================================

  async savePendingApproval(runId: string, approval: PendingApproval): Promise<void> {
    const client = await this.ensureClient();

    if (this.config.debug) {
      logger.debug(`[RedisBackend] Saving approval: ${approval.id}`);
    }

    const serialized = JSON.stringify({
      ...approval,
      requestedAt: approval.requestedAt.toISOString(),
      expiresAt: approval.expiresAt?.toISOString(),
      decidedAt: approval.decidedAt?.toISOString(),
    });

    await client.rpush(this.approvalsKey(runId), serialized);
  }

  async getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    const client = await this.ensureClient();

    const rawList = await client.lrange(this.approvalsKey(runId), 0, -1);

    return rawList
      .map((raw) => {
        const data = JSON.parse(raw);
        return {
          ...data,
          requestedAt: new Date(data.requestedAt),
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
          decidedAt: data.decidedAt ? new Date(data.decidedAt) : undefined,
        } as PendingApproval;
      })
      .filter((a) => a.status === "pending");
  }

  async getPendingApproval(runId: string, approvalId: string): Promise<PendingApproval | null> {
    const approvals = await this.getPendingApprovals(runId);
    return approvals.find((a) => a.id === approvalId) || null;
  }

  async updateApproval(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    const client = await this.ensureClient();
    const key = this.approvalsKey(runId);

    // Get all approvals to find the index
    const rawList = await client.lrange(key, 0, -1);

    // Find the index of the approval to update
    let targetIndex = -1;
    for (let i = 0; i < rawList.length; i++) {
      const data = JSON.parse(rawList[i]!);
      if (data.id === approvalId) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex === -1) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    // Parse and update the approval data
    const data = JSON.parse(rawList[targetIndex]!);
    data.status = decision.approved ? "approved" : "rejected";
    data.decidedBy = decision.approver;
    data.decidedAt = new Date().toISOString();
    data.comment = decision.comment;

    // Use LSET to atomically update the specific index
    // This is more atomic than del + rpush as it only modifies one element
    await client.lset(key, targetIndex, JSON.stringify(data));
  }

  async listPendingApprovals(filter?: {
    workflowId?: string;
    approver?: string;
    status?: "pending" | "expired";
  }): Promise<Array<{ runId: string; approval: PendingApproval }>> {
    const client = await this.ensureClient();
    const result: Array<{ runId: string; approval: PendingApproval }> = [];

    // Get all approval keys
    const keys = await client.keys(`${this.config.prefix}approvals:*`);

    for (const key of keys) {
      const runId = key.replace(`${this.config.prefix}approvals:`, "");

      // Check workflow filter
      if (filter?.workflowId) {
        const run = await this.getRun(runId);
        if (!run || run.workflowId !== filter.workflowId) continue;
      }

      const rawList = await client.lrange(key, 0, -1);

      for (const raw of rawList) {
        const data = JSON.parse(raw);
        const approval: PendingApproval = {
          ...data,
          requestedAt: new Date(data.requestedAt),
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
          decidedAt: data.decidedAt ? new Date(data.decidedAt) : undefined,
        };

        // Check status filter
        if (filter?.status === "pending" && approval.status !== "pending") continue;
        if (filter?.status === "expired") {
          const isExpired = approval.expiresAt && new Date() > approval.expiresAt;
          if (!isExpired) continue;
        }

        // Check approver filter
        if (filter?.approver && approval.approvers && !approval.approvers.includes(filter.approver)) {
          continue;
        }

        result.push({ runId, approval });
      }
    }

    return result;
  }

  // =========================================================================
  // Queue Operations
  // =========================================================================

  async enqueue(job: WorkflowJob): Promise<void> {
    const client = await this.ensureClient();

    if (this.config.debug) {
      logger.debug(`[RedisBackend] Enqueueing job: ${job.runId}`);
    }

    await client.xadd(this.config.streamKey, "*", {
      runId: job.runId,
      workflowId: job.workflowId,
      input: JSON.stringify(job.input),
      priority: String(job.priority || 0),
      createdAt: job.createdAt.toISOString(),
    });
  }

  async dequeue(): Promise<WorkflowJob | null> {
    const client = await this.ensureClient();

    const streams = await client.xreadgroup(
      [{ key: this.config.streamKey, xid: ">" }],
      {
        group: this.config.groupName,
        consumer: this.config.consumerName,
        block: 5000, // 5 second timeout
        count: 1,
      },
    );

    if (!streams || streams.length === 0) {
      return null;
    }

    // Now streams is strongly typed due to Adapter
    const stream = streams[0];
    if (!stream || !stream.messages || stream.messages.length === 0) {
      return null;
    }

    const message = stream.messages[0];
    if (!message) {
      return null;
    }

    const data = message.data;

    return {
      runId: data.runId ?? "",
      workflowId: data.workflowId ?? "",
      input: data.input ? JSON.parse(data.input) : undefined,
      priority: data.priority ? parseInt(data.priority) : undefined,
      createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
    };
  }

  acknowledge(runId: string): Promise<void> {
    // Note: In a full implementation, we'd need to track the message ID
    // For now, this is a placeholder
    if (this.config.debug) {
      logger.debug(`[RedisBackend] Acknowledged: ${runId}`);
    }
    return Promise.resolve();
  }

  async nack(runId: string): Promise<void> {
    // Re-enqueue the job
    const run = await this.getRun(runId);
    if (run) {
      await this.enqueue({
        runId: run.id,
        workflowId: run.workflowId,
        input: run.input,
        createdAt: new Date(),
      });
    }
  }

  // =========================================================================
  // Distributed Locking
  // =========================================================================

  async acquireLock(runId: string, duration: number): Promise<boolean> {
    const client = await this.ensureClient();
    const lockValue = crypto.randomUUID();

    const result = await client.set(this.lockKey(runId), lockValue, {
      nx: true,
      px: duration,
    });

    return result === "OK";
  }

  async releaseLock(runId: string): Promise<void> {
    const client = await this.ensureClient();
    await client.del(this.lockKey(runId));
  }

  async extendLock(runId: string, duration: number): Promise<boolean> {
    const client = await this.ensureClient();
    const exists = await client.exists(this.lockKey(runId));

    if (exists === 0) return false;

    await client.expire(this.lockKey(runId), Math.ceil(duration / 1000));
    return true;
  }

  async isLocked(runId: string): Promise<boolean> {
    const client = await this.ensureClient();
    const exists = await client.exists(this.lockKey(runId));
    return exists > 0;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.ensureClient();
      await client.set("__health_check__", "ok", { ex: 1 });
      return true;
    } catch {
      return false;
    }
  }

  destroy(): Promise<void> {
    if (this.client) {
      if (typeof this.client.quit === 'function') {
        this.client.quit();
      } else if (typeof this.client.disconnect === 'function') {
        this.client.disconnect();
      }
      this.client = null;
    }
    this.connectionPromise = null;
    this.initialized = false;

    if (this.config.debug) {
      logger.debug("[RedisBackend] Destroyed");
    }
    return Promise.resolve();
  }
}