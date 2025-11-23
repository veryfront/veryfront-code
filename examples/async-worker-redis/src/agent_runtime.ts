import { getRedis } from "./redis_client.ts";
import {
  type AgentRun,
  type AgentRunStatus,
  GROUP_NAME,
  runKey,
  STREAM_KEY,
} from "./agent_types.ts";

function nowISO() {
  return new Date().toISOString();
}

export async function initStream(): Promise<void> {
  const redis = await getRedis();
  try {
    // Create consumer group starting from the beginning (0)
    await redis.xgroupCreate(STREAM_KEY, GROUP_NAME, "0", true);
    console.log(`[Stream] Created consumer group ${GROUP_NAME}`);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (!msg.includes("BUSYGROUP")) {
      console.error("[Stream] Error creating group:", e);
    }
  }
}

export async function createRun(agentId: string, input: string): Promise<AgentRun> {
  const redis = await getRedis();
  const runId = crypto.randomUUID();
  const now = nowISO();

  const run: AgentRun = {
    id: runId,
    agentId,
    input,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };

  // Store state in Hash
  await redis.hset(runKey(runId), {
    id: run.id,
    agentId: run.agentId,
    input: run.input,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  });

  // Push job to Stream
  await redis.xadd(STREAM_KEY, "*", {
    runId,
    agentId,
  });

  return run;
}

export async function getRun(runId: string): Promise<AgentRun | null> {
  const redis = await getRedis();
  const rawData = await redis.hgetall(runKey(runId));

  // hgetall returns array format: ['key1', 'value1', 'key2', 'value2', ...]
  if (!rawData || rawData.length === 0) return null;

  // Convert array to object
  const data: Record<string, string> = {};
  for (let i = 0; i < rawData.length; i += 2) {
    data[rawData[i]] = rawData[i + 1];
  }

  if (Object.keys(data).length === 0) return null;

  return {
    id: data.id,
    agentId: data.agentId,
    input: data.input,
    status: data.status as AgentRunStatus,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    result: data.result,
    error: data.error,
    state: data.state,
  };
}

export async function updateRun(runId: string, patch: Partial<AgentRun>): Promise<void> {
  const redis = await getRedis();
  const now = nowISO();
  const fields: Record<string, string> = { updatedAt: now };

  if (patch.status) fields.status = patch.status;
  if (patch.result !== undefined) fields.result = patch.result;
  if (patch.error !== undefined) fields.error = patch.error;
  if (patch.state !== undefined) fields.state = patch.state;

  await redis.hset(runKey(runId), fields);
}

export async function cancelRun(runId: string): Promise<void> {
  await updateRun(runId, { status: "cancelled" });
}
