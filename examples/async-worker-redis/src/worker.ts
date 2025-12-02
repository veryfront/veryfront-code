// Helper for Cross-Platform CWD
function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== 'undefined') {
    // @ts-ignore - Deno global
    return Deno.env.get(key);
  }
  // @ts-ignore - process global
  else if (typeof process !== 'undefined' && process.env) {
    // @ts-ignore - process global
    return process.env[key];
  }
  return undefined;
}

// Helper for Cross-Platform randomUUID
function getRandomUUID(): string {
  // @ts-ignore - crypto global
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for Node.js < 19 or other environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0,
      v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

import { getRedis } from "./redis_client.ts";
import { GROUP_NAME, STREAM_KEY } from "./agent_types.ts";
import { getRun, initStream, updateRun } from "./agent_runtime.ts";
import { executeAgent } from "./agent_factory.ts";

const CONSUMER_NAME = getEnv("CONSUMER_NAME") ?? `worker-${getRandomUUID().slice(0, 8)}`;
const BLOCK_MS = 5000;

async function processLoop() {
  const redis = await getRedis();
  await initStream();

  console.log(`[Worker] Started as consumer '${CONSUMER_NAME}'`);

  while (true) {
    try {
      // Read from stream using correct XKeyIdGroup format
      const streams = await redis.xreadgroup(
        [{ key: STREAM_KEY, xid: ">" }],
        {
          group: GROUP_NAME,
          consumer: CONSUMER_NAME,
          block: BLOCK_MS,
          count: 1,
        },
      ) as any[];

      if (!streams || streams.length === 0) continue;

      for (const stream of streams) {
        const messages = stream.messages || [];
        for (const message of messages) {
          const streamId = message.xid;
          let fields = message.fieldValues;

          // Handle raw array case if library returns it
          if (Array.isArray(fields)) {
            const obj: Record<string, string> = {};
            for (let i = 0; i < fields.length; i += 2) {
              obj[fields[i]] = fields[i + 1];
            }
            fields = obj;
          }

          const runId = fields.runId;
          const agentId = fields.agentId;

          if (!runId || !agentId) {
            console.warn(`[Worker] Invalid message ${streamId}`);
            await redis.xack(STREAM_KEY, GROUP_NAME, streamId);
            continue;
          }

          console.log(`[Worker] Processing job ${runId} (stream ID: ${streamId})`);

          try {
            // 1. Check if run is still valid
            const run = await getRun(runId);
            if (!run) {
              console.warn(`[Worker] Run ${runId} not found in state.`);
              await redis.xack(STREAM_KEY, GROUP_NAME, streamId);
              continue;
            }

            if (run.status === "cancelled") {
              console.log(`[Worker] Run ${runId} was cancelled. Skipping.`);
              await redis.xack(STREAM_KEY, GROUP_NAME, streamId);
              continue;
            }

            // 2. Mark as running
            await updateRun(runId, { status: "running" });

            // 3. Execute Agent Logic
            const result = await executeAgent(run.input, agentId);

            // 4. Update Result
            await updateRun(runId, {
              status: "completed",
              result: result,
            });

            console.log(`[Worker] Job ${runId} completed.`);
          } catch (err) {
            console.error(`[Worker] Job ${runId} failed:`, err);
            await updateRun(runId, {
              status: "failed",
              error: String(err instanceof Error ? err.message : err),
            });
          } finally {
            // 5. Acknowledge message so it's not re-delivered
            await redis.xack(STREAM_KEY, GROUP_NAME, streamId);
          }
        }
      }
    } catch (error) {
      console.error("[Worker] Loop error:", error);
      await new Promise((r) => setTimeout(r, 1000)); // Backoff
    }
  }
}

if (import.meta.main) {
  processLoop();
}
