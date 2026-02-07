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
  WorkflowJob,
  WorkflowRun,
  WorkflowStatus,
} from "../../types.ts";
import type { WorkflowBackend } from "../types.ts";
import { agentLogger as logger } from "#veryfront/utils";
import { requeueRun } from "../shared/requeue-run.ts";

import type { RedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";
import {
  DenoRedisAdapter,
  getRedisModule,
  NodeRedisAdapter,
} from "#veryfront/platform/adapters/redis/index.ts";

export type { RedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";
export type { RedisBackendConfig } from "./types.ts";

import type { RedisBackendConfig, RedisBackendInternalConfig } from "./types.ts";

export class RedisBackend implements WorkflowBackend {
  private client: RedisAdapter | null = null;
  private connectionPromise: Promise<RedisAdapter> | null = null;
  private config: RedisBackendInternalConfig;
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

    if (config.client) this.client = config.client;
  }

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

  private claimKey(runId: string): string {
    return `${this.config.prefix}claim:${runId}`;
  }

  private serializeRun(run: WorkflowRun): Record<string, string> {
    return {
      id: run.id,
      workflowId: run.workflowId,
      version: run.version || "",
      status: run.status,
      workerId: run.workerId || "",
      tenant: run._tenant ? JSON.stringify(run._tenant) : "",
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

  private deserializeRun(data: Record<string, string>): WorkflowRun {
    if (!data.id) throw new Error("Invalid workflow run data: missing 'id' field");
    if (!data.workflowId) {
      throw new Error(`Invalid workflow run data for run "${data.id}": missing 'workflowId' field`);
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
      throw new Error(
        `Invalid workflow run data for run "${data.id}": unknown status "${data.status}". ` +
          `Expected one of: ${validStatuses.join(", ")}`,
      );
    }

    function safeJsonParse<T>(
      runId: string,
      field: string,
      value: string | undefined,
      defaultValue: T,
    ): T {
      if (!value) return defaultValue;
      try {
        return JSON.parse(value) as T;
      } catch (e) {
        throw new Error(
          `Invalid workflow run data for run "${runId}": failed to parse '${field}' as JSON. ` +
            `Error: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return {
      id: data.id,
      workflowId: data.workflowId,
      version: data.version || undefined,
      status: status ?? "pending",
      workerId: data.workerId || undefined,
      _tenant: safeJsonParse(data.id, "tenant", data.tenant, undefined),
      input: safeJsonParse(data.id, "input", data.input, undefined),
      output: safeJsonParse(data.id, "output", data.output, undefined),
      nodeStates: safeJsonParse(data.id, "nodeStates", data.nodeStates, {}),
      currentNodes: safeJsonParse(data.id, "currentNodes", data.currentNodes, []),
      context: safeJsonParse(data.id, "context", data.context, { input: undefined }),
      checkpoints: [],
      pendingApprovals: [],
      error: safeJsonParse(data.id, "error", data.error, undefined),
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
    const { DenoRedis: denoRedis, NodeRedis: nodeRedis } = await getRedisModule();

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

    if (denoRedis) {
      const client = await denoRedis.connect({
        hostname: this.config.hostname,
        port: this.config.port,
      });
      this.client = new DenoRedisAdapter(client);
      return this.client;
    }

    throw new Error("No Redis client available for this runtime.");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const client = await this.ensureClient();

    try {
      await client.xgroupCreate(this.config.streamKey, this.config.groupName, "0", true);
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

  async createRun(run: WorkflowRun): Promise<void> {
    const client = await this.ensureClient();

    if (this.config.debug) logger.debug(`[RedisBackend] Creating run: ${run.id}`);

    await client.hset(this.runKey(run.id), this.serializeRun(run));
    await client.sadd(this.statusIndexKey(run.status), run.id);
    await client.sadd(this.workflowIndexKey(run.workflowId), run.id);

    if (this.config.runTtl) await client.expire(this.runKey(run.id), this.config.runTtl);
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    const client = await this.ensureClient();
    const data = await client.hgetall(this.runKey(runId));
    if (!data || Object.keys(data).length === 0) return null;

    const run = this.deserializeRun(data);
    run.pendingApprovals = await this.getPendingApprovals(runId);
    return run;
  }

  async updateRun(runId: string, patch: Partial<WorkflowRun>): Promise<void> {
    const client = await this.ensureClient();

    if (this.config.debug) logger.debug(`[RedisBackend] Updating run: ${runId}`);

    const oldStatus = (await this.getRun(runId))?.status;

    const fields: Record<string, string> = {};
    if (patch.status !== undefined) fields.status = patch.status;
    if (patch.workerId !== undefined) fields.workerId = patch.workerId ?? "";
    if (patch._tenant !== undefined) {
      fields.tenant = patch._tenant ? JSON.stringify(patch._tenant) : "";
    }
    if (patch.output !== undefined) fields.output = JSON.stringify(patch.output);
    if (patch.nodeStates !== undefined) fields.nodeStates = JSON.stringify(patch.nodeStates);
    if (patch.currentNodes !== undefined) fields.currentNodes = JSON.stringify(patch.currentNodes);
    if (patch.context !== undefined) fields.context = JSON.stringify(patch.context);
    if (patch.error !== undefined) fields.error = JSON.stringify(patch.error);
    if (patch.startedAt !== undefined) fields.startedAt = patch.startedAt.toISOString();
    if (patch.heartbeatAt !== undefined) fields.heartbeatAt = patch.heartbeatAt.toISOString();
    if (patch.completedAt !== undefined) fields.completedAt = patch.completedAt.toISOString();

    if (Object.keys(fields).length > 0) await client.hset(this.runKey(runId), fields);

    if (patch.status && oldStatus && patch.status !== oldStatus) {
      await client.srem(this.statusIndexKey(oldStatus), runId);
      await client.sadd(this.statusIndexKey(patch.status), runId);
    }

    // Terminal states should clear stale-claim markers.
    if (patch.status && patch.status !== "running") {
      await client.del(this.claimKey(runId));
    }
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
    );
    await client.srem(this.statusIndexKey(run.status), runId);
    await client.srem(this.workflowIndexKey(run.workflowId), runId);
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
      const keys = await client.keys(`${this.config.prefix}run:*`);
      runIds = keys.map((k) => k.replace(`${this.config.prefix}run:`, ""));
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
    const runs = await this.listRuns({ ...filter, limit: undefined, offset: undefined });
    return runs.length;
  }

  async saveCheckpoint(runId: string, checkpoint: Checkpoint): Promise<void> {
    const client = await this.ensureClient();

    if (this.config.debug) logger.debug(`[RedisBackend] Saving checkpoint: ${checkpoint.id}`);

    await client.rpush(
      this.checkpointsKey(runId),
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
      JSON.stringify({
        ...approval,
        requestedAt: approval.requestedAt.toISOString(),
        expiresAt: approval.expiresAt?.toISOString(),
        decidedAt: approval.decidedAt?.toISOString(),
      }),
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

  async updateApproval(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    const client = await this.ensureClient();
    const key = this.approvalsKey(runId);

    const rawList = await client.lrange(key, 0, -1);

    const targetIndex = rawList.findIndex((raw) => {
      if (!raw) return false;
      const data = JSON.parse(raw);
      return data.id === approvalId;
    });

    if (targetIndex === -1) throw new Error(`Approval not found: ${approvalId}`);

    const rawTarget = rawList[targetIndex];
    if (!rawTarget) throw new Error(`Approval data not found: ${approvalId}`);

    const data = JSON.parse(rawTarget);
    data.status = decision.approved ? "approved" : "rejected";
    data.decidedBy = decision.approver;
    data.decidedAt = new Date().toISOString();
    data.comment = decision.comment;

    await client.lset(key, targetIndex, JSON.stringify(data));
  }

  async listPendingApprovals(filter?: {
    workflowId?: string;
    approver?: string;
    status?: "pending" | "expired";
  }): Promise<Array<{ runId: string; approval: PendingApproval }>> {
    const client = await this.ensureClient();
    const result: Array<{ runId: string; approval: PendingApproval }> = [];

    const keys = await client.keys(`${this.config.prefix}approvals:*`);

    for (const key of keys) {
      const runId = key.replace(`${this.config.prefix}approvals:`, "");

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

  async enqueue(job: WorkflowJob): Promise<void> {
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

  async dequeue(): Promise<WorkflowJob | null> {
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

    return {
      runId: data.runId ?? "",
      workflowId: data.workflowId ?? "",
      input: data.input ? JSON.parse(data.input) : undefined,
      priority: data.priority ? parseInt(data.priority) : undefined,
      createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
    };
  }

  acknowledge(runId: string): Promise<void> {
    if (this.config.debug) logger.debug(`[RedisBackend] Acknowledged: ${runId}`);
    return Promise.resolve();
  }

  async nack(runId: string): Promise<void> {
    await requeueRun(this, runId);
  }

  async acquireLock(runId: string, duration: number): Promise<boolean> {
    const client = await this.ensureClient();
    const lockValue = crypto.randomUUID();

    const result = await client.set(this.lockKey(runId), lockValue, { nx: true, px: duration });
    return result === "OK";
  }

  async releaseLock(runId: string): Promise<void> {
    const client = await this.ensureClient();
    await client.del(this.lockKey(runId));
  }

  async extendLock(runId: string, duration: number): Promise<boolean> {
    const client = await this.ensureClient();
    const key = this.lockKey(runId);

    const exists = await client.exists(key);
    if (exists === 0) return false;

    await client.expire(key, Math.ceil(duration / 1000));
    return true;
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

    const claimed = await client.set(this.claimKey(runId), workerId, {
      nx: true,
      px: stalledThreshold,
    });
    if (claimed !== "OK") {
      return false;
    }

    try {
      await this.updateRun(runId, {
        workerId,
        startedAt: run.startedAt ?? new Date(now),
        heartbeatAt: new Date(now),
      });
      return true;
    } catch (error) {
      await client.del(this.claimKey(runId));
      throw error;
    }
  }

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
      if (typeof this.client.quit === "function") this.client.quit();
      else if (typeof this.client.disconnect === "function") this.client.disconnect();
      this.client = null;
    }

    this.connectionPromise = null;
    this.initialized = false;

    if (this.config.debug) logger.debug("[RedisBackend] Destroyed");
    return Promise.resolve();
  }
}
