import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import {
  getRedisModule,
  NodeRedisAdapter,
  type RedisAdapter,
} from "#veryfront/platform/adapters/redis/index.ts";
import { RedisBackend } from "../../../src/workflow/backends/redis/index.ts";
import type { PendingApproval, WorkflowRun } from "../../../src/workflow/types.ts";

const REDIS_URL = Deno.env.get("WORKFLOW_REDIS_TEST_URL") ?? "redis://127.0.0.1:6379";
const SOURCE_POLICY = normalizeSourceIntegrationPolicy(undefined);

function uniquePrefix(label: string): string {
  return `integration:workflow:${label}:${crypto.randomUUID()}:`;
}

function createRun(id: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id,
    workflowId: "integration-workflow",
    status: "pending",
    input: { nested: { value: id } },
    nodeStates: {},
    currentNodes: [],
    context: { input: { nested: { value: id } } },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    sourceIntegrationPolicy: SOURCE_POLICY,
    ...overrides,
  };
}

function createApproval(id: string): PendingApproval {
  return {
    id,
    nodeId: "approval-node",
    status: "pending",
    message: `Approve ${id}?`,
    payload: { id },
    requestedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

async function connectRedis(): Promise<RedisAdapter> {
  const { NodeRedis } = await getRedisModule();
  const client = NodeRedis.createClient({ url: REDIS_URL });
  await client.connect();
  return new NodeRedisAdapter(client);
}

function wrapRedis(
  base: RedisAdapter,
  hooks: {
    beforeEval?: (script: string, keys: string[], args: string[]) => Promise<void> | void;
    afterEval?: (
      script: string,
      keys: string[],
      args: string[],
      result: unknown,
    ) => Promise<void> | void;
    calls?: Record<string, number>;
  },
): RedisAdapter {
  return new Proxy(base, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (property === "eval") {
        return async (script: string, keys: string[], args: string[]) => {
          if (hooks.calls) hooks.calls.eval = (hooks.calls.eval ?? 0) + 1;
          await hooks.beforeEval?.(script, keys, args);
          const result = await target.eval(script, keys, args);
          await hooks.afterEval?.(script, keys, args, result);
          return result;
        };
      }
      return (...args: unknown[]) => {
        if (hooks.calls && typeof property === "string") {
          hooks.calls[property] = (hooks.calls[property] ?? 0) + 1;
        }
        return Reflect.apply(value, target, args);
      };
    },
  }) as RedisAdapter;
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Condition did not become true within ${timeoutMs}ms`);
}

async function redisCommandCalls(adapter: RedisAdapter, command: string): Promise<number> {
  const info = await adapter.eval("return redis.call('info', 'commandstats')", [], []);
  if (typeof info !== "string") throw new Error("Redis commandstats response was not text");
  const match = info.match(new RegExp(`(?:^|\\r?\\n)cmdstat_${command}:calls=(\\d+)`));
  if (!match) throw new Error(`Redis commandstats did not include ${command}`);
  return Number(match[1]);
}

describe("RedisBackend against Redis 7 standalone", () => {
  it("runs against Redis 7 and never mixes a deleted run with recreated approvals", async () => {
    const prefix = uniquePrefix("snapshot");
    const primaryBase = await connectRedis();
    const controlBase = await connectRedis();
    const control = new RedisBackend({ prefix, client: controlBase });
    let injected = false;
    const primary = new RedisBackend({
      prefix,
      client: wrapRedis(primaryBase, {
        calls: {},
        beforeEval: async (script) => {
          if (injected || !script.includes("read-workflow-run-snapshot")) return;
          injected = true;
          await control.deleteRun("snapshot-run");
          await control.createRun(createRun("snapshot-run", {
            workflowId: "new-workflow",
          }));
          await control.savePendingApproval("snapshot-run", createApproval("new-approval"));
        },
      }),
    });

    try {
      const info = await controlBase.eval("return redis.call('info', 'server')", [], []);
      assertEquals(typeof info === "string" && /redis_version:7\./.test(info), true);
      await primary.createRun(createRun("snapshot-run", { workflowId: "old-workflow" }));
      await primary.savePendingApproval("snapshot-run", createApproval("old-approval"));

      const snapshot = await primary.getRun("snapshot-run");

      assertEquals(injected, true);
      assertEquals(snapshot?.workflowId, "new-workflow");
      assertEquals(
        snapshot?.pendingApprovals.map((approval) => approval.id),
        ["new-approval"],
      );
    } finally {
      await primary.destroy();
      await control.destroy();
    }
  });

  it("allows exactly one concurrent approval decision", async () => {
    const backend = new RedisBackend({
      prefix: uniquePrefix("approval-race"),
      client: await connectRedis(),
    });
    try {
      const run = createRun("approval-race-run");
      await backend.createRun(run);
      await backend.savePendingApproval(run.id, createApproval("approval-race"));

      const decisions = await Promise.all([
        backend.updateApproval(run.id, "approval-race", {
          approved: true,
          approver: "first",
        }),
        backend.updateApproval(run.id, "approval-race", {
          approved: false,
          approver: "second",
        }),
      ]);

      assertEquals(decisions.filter(Boolean).length, 1);
      const rows = await backend.listPendingApprovals({ workflowId: run.workflowId });
      assertEquals(rows.length, 1);
      assertEquals(rows[0]?.approval.decidedBy, decisions[0] ? "first" : "second");
      assertEquals(rows[0]?.approval.status, decisions[0] ? "approved" : "rejected");
    } finally {
      await backend.destroy();
    }
  });

  it("keeps a replacement incarnation's stalled claim after an old terminal update", async () => {
    const prefix = uniquePrefix("claim-race");
    const primaryBase = await connectRedis();
    const controlBase = await connectRedis();
    const control = new RedisBackend({ prefix, client: controlBase });
    let injected = false;
    const primary = new RedisBackend({
      prefix,
      client: wrapRedis(primaryBase, {
        calls: {},
        afterEval: async (script, _keys, _args, result) => {
          if (injected || !script.includes("conditional-run-update") || Number(result) !== 1) {
            return;
          }
          injected = true;
          await control.deleteRun("claim-race-run");
          await control.createRun(createRun("claim-race-run", {
            status: "running",
            workerId: "replacement-owner",
            startedAt: new Date(Date.now() - 120_000),
          }));
          assertEquals(
            await control.claimStalledRun("claim-race-run", "new-worker", 60_000),
            true,
          );
        },
      }),
    });

    try {
      await primary.createRun(createRun("claim-race-run", {
        status: "running",
        workerId: "old-worker",
        startedAt: new Date(Date.now() - 120_000),
      }));

      assertEquals(
        await primary.updateRunIfStatusAndWorker(
          "claim-race-run",
          ["running"],
          "old-worker",
          { status: "completed" },
        ),
        true,
      );
      assertEquals(injected, true);
      assertEquals(
        await controlBase.get(`${prefix}schema-v2:claim:claim-race-run`),
        "new-worker",
      );
    } finally {
      await primary.destroy();
      await control.destroy();
    }
  });

  it("expires run-owned state and removes ordered-index ghosts", async () => {
    const prefix = uniquePrefix("ttl");
    const adapter = await connectRedis();
    const backend = new RedisBackend({
      prefix,
      runTtl: 3,
      client: adapter,
    });
    try {
      const run = createRun("ttl-run");
      await backend.createRun(run);
      // Make a fresh child TTL observably wrong: retained child state must
      // inherit the run's existing absolute deadline after this delay.
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      await backend.saveCheckpoint(run.id, {
        id: "ttl-checkpoint",
        nodeId: "node",
        timestamp: new Date(),
        context: { input: {} },
        nodeStates: {},
      });
      await backend.savePendingApproval(run.id, createApproval("ttl-approval"));

      const namespace = `${prefix}schema-v2:`;
      const runKey = `${namespace}run:${run.id}`;
      const checkpointsKey = `${namespace}checkpoints:${run.id}`;
      const approvalsKey = `${namespace}approvals:${run.id}`;
      const retentionKey = `${namespace}index:retention`;
      const allRunsKey = `${namespace}index:created`;
      const workflowRunsKey = `${namespace}index:created:workflow:${run.workflowId}`;
      const statusRunsKey = `${namespace}index:created:status:${run.status}`;
      const workflowStatusRunsKey =
        `${namespace}index:created:workflow-status:${run.workflowId}:${run.status}`;
      const workflowMetadataKey = `${namespace}index:run-workflow`;
      const statusMetadataKey = `${namespace}index:run-status`;

      const beforeExpiry = await adapter.eval(
        `return {
          redis.call('pttl', KEYS[1]),
          redis.call('pttl', KEYS[2]),
          redis.call('pttl', KEYS[3]),
          redis.call('pexpiretime', KEYS[1]),
          redis.call('pexpiretime', KEYS[2]),
          redis.call('pexpiretime', KEYS[3]),
          redis.call('zscore', KEYS[4], ARGV[1]) or '',
          redis.call('zscore', KEYS[5], ARGV[1]) or '',
          redis.call('hget', KEYS[6], ARGV[1]) or '',
          redis.call('hget', KEYS[7], ARGV[1]) or ''
        }`,
        [
          runKey,
          checkpointsKey,
          approvalsKey,
          retentionKey,
          allRunsKey,
          workflowMetadataKey,
          statusMetadataKey,
        ],
        [run.id],
      );
      assertEquals(Array.isArray(beforeExpiry), true);
      const before = beforeExpiry as unknown[];
      for (const ttl of before.slice(0, 3)) {
        assertEquals(Number(ttl) > 0 && Number(ttl) <= 3_000, true);
      }
      const deadlines = before.slice(3, 6).map(Number);
      // Ten milliseconds tolerates server-clock/command-boundary rounding but
      // remains far below the 1.1-second drift from incorrectly starting a
      // fresh three-second TTL on either child append.
      assertEquals(deadlines.every((deadline) => deadline > 0), true);
      assertEquals(Math.max(...deadlines) - Math.min(...deadlines) <= 10, true);
      assertEquals(before[6] !== "", true);
      assertEquals(before[7] !== "", true);
      assertEquals(before[8], run.workflowId);
      assertEquals(before[9], run.status);

      await waitUntil(async () =>
        Number(
          await adapter.eval(
            "return redis.call('exists', KEYS[1], KEYS[2], KEYS[3])",
            [runKey, checkpointsKey, approvalsKey],
            [],
          ),
        ) === 0
      );

      const beforeDrain = await adapter.eval(
        `return {
          redis.call('zscore', KEYS[1], ARGV[1]) or '',
          redis.call('zscore', KEYS[2], ARGV[1]) or '',
          redis.call('zscore', KEYS[3], ARGV[1]) or '',
          redis.call('zscore', KEYS[4], ARGV[1]) or '',
          redis.call('zscore', KEYS[5], ARGV[1]) or '',
          redis.call('hget', KEYS[6], ARGV[1]) or '',
          redis.call('hget', KEYS[7], ARGV[1]) or ''
        }`,
        [
          retentionKey,
          allRunsKey,
          workflowRunsKey,
          statusRunsKey,
          workflowStatusRunsKey,
          workflowMetadataKey,
          statusMetadataKey,
        ],
        [run.id],
      );
      assertEquals(Array.isArray(beforeDrain), true);
      assertEquals((beforeDrain as unknown[]).every((value) => value !== ""), true);

      assertEquals(await backend.drainExpiredRuns(), { processed: 1, hasMoreDue: false });

      const afterDrain = await adapter.eval(
        `return {
          redis.call('zscore', KEYS[1], ARGV[1]) or '',
          redis.call('zscore', KEYS[2], ARGV[1]) or '',
          redis.call('zscore', KEYS[3], ARGV[1]) or '',
          redis.call('zscore', KEYS[4], ARGV[1]) or '',
          redis.call('zscore', KEYS[5], ARGV[1]) or '',
          redis.call('hget', KEYS[6], ARGV[1]) or '',
          redis.call('hget', KEYS[7], ARGV[1]) or ''
        }`,
        [
          retentionKey,
          allRunsKey,
          workflowRunsKey,
          statusRunsKey,
          workflowStatusRunsKey,
          workflowMetadataKey,
          statusMetadataKey,
        ],
        [run.id],
      );
      assertEquals(afterDrain, ["", "", "", "", "", "", ""]);

      assertEquals(await backend.getCheckpoints(run.id), []);
      assertEquals(await backend.getPendingApprovals(run.id), []);
      assertEquals(await backend.countRuns({}), 0);
      assertEquals(await backend.listRuns({}), []);
    } finally {
      await backend.destroy();
    }
  });

  it("fails closed on an expired backlog and recovers through bounded drains", async () => {
    const prefix = uniquePrefix("maintenance");
    const adapter = await connectRedis();
    const backend = new RedisBackend({ prefix, runTtl: 1, client: adapter });
    try {
      const runIds: string[] = [];
      for (let index = 0; index < 257; index++) {
        const runId = `maintenance-${String(index).padStart(3, "0")}`;
        runIds.push(runId);
        await backend.createRun(createRun(runId));
      }
      const lastRunKey = `${prefix}schema-v2:run:${runIds.at(-1)}`;
      await waitUntil(async () =>
        Number(
          await adapter.eval("return redis.call('pttl', KEYS[1])", [lastRunKey], []),
        ) < 1
      );

      const error = await assertRejects(
        () => backend.countRuns({}),
        Error,
        "retention maintenance backlog",
      );
      assertEquals((error as { status?: number }).status, 503);

      const listError = await assertRejects(
        () => backend.listRuns({}),
        Error,
        "retention maintenance backlog",
      );
      assertEquals((listError as { status?: number }).status, 503);

      const drain = await backend.drainExpiredRuns();
      assertEquals(drain.hasMoreDue, false);
      assertEquals(drain.processed, 1);
      assertEquals(await backend.countRuns({}), 0);
    } finally {
      await backend.destroy();
    }
  });

  it("hydrates only the requested page and counts from ordered indexes", async () => {
    const calls: Record<string, number> = {};
    const base = await connectRedis();
    const prefix = uniquePrefix("bounded-query");
    const backend = new RedisBackend({
      prefix,
      client: wrapRedis(base, { calls }),
    });
    try {
      for (let index = 0; index < 20; index++) {
        await backend.createRun(createRun(`bounded-${index}`, {
          workflowId: index % 2 === 0 ? "even" : "odd",
          status: index % 3 === 0 ? "running" : "pending",
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
        }));
      }
      for (const key of Object.keys(calls)) calls[key] = 0;
      const hgetallBeforePage = await redisCommandCalls(base, "hgetall");
      const lrangeBeforePage = await redisCommandCalls(base, "lrange");

      const page = await backend.listRuns({
        workflowId: "even",
        status: ["pending", "running"],
        createdAfter: new Date(Date.UTC(2026, 0, 1, 0, 0, 5)),
        limit: 3,
      });

      assertEquals(page.map((run) => run.id), ["bounded-18", "bounded-16", "bounded-14"]);
      assertEquals(calls.smembers ?? 0, 0);
      assertEquals(calls.hgetall ?? 0, 0);
      assertEquals(calls.lrange ?? 0, 0);
      assertEquals((await redisCommandCalls(base, "hgetall")) - hgetallBeforePage, 3);
      assertEquals((await redisCommandCalls(base, "lrange")) - lrangeBeforePage, 3);

      for (const key of Object.keys(calls)) calls[key] = 0;
      const hgetallBeforeCount = await redisCommandCalls(base, "hgetall");
      const lrangeBeforeCount = await redisCommandCalls(base, "lrange");
      assertEquals(
        await backend.countRuns({ workflowId: "even", status: ["pending", "running"] }),
        10,
      );
      assertEquals(calls.smembers ?? 0, 0);
      assertEquals(calls.hgetall ?? 0, 0);
      assertEquals(calls.lrange ?? 0, 0);
      assertEquals((await redisCommandCalls(base, "hgetall")) - hgetallBeforeCount, 0);
      assertEquals((await redisCommandCalls(base, "lrange")) - lrangeBeforeCount, 0);
    } finally {
      await backend.destroy();
    }
  });

  it("continues an internal cursor scan after an earlier row is deleted", async () => {
    const prefix = uniquePrefix("cursor-delete");
    const primaryBase = await connectRedis();
    const controlBase = await connectRedis();
    const control = new RedisBackend({ prefix, client: controlBase });
    let cursorCalls = 0;
    const primary = new RedisBackend({
      prefix,
      client: wrapRedis(primaryBase, {
        beforeEval: async (script) => {
          if (!script.includes("cursor-page-workflow-runs-exact")) return;
          cursorCalls++;
          if (cursorCalls === 2) await control.deleteRun("cursor-run-1000");
        },
      }),
    });

    try {
      for (let batchStart = 0; batchStart < 1_001; batchStart += 100) {
        await Promise.all(
          Array.from(
            { length: Math.min(100, 1_001 - batchStart) },
            (_, batchOffset) => {
              const index = batchStart + batchOffset;
              return control.createRun(createRun(`cursor-run-${index}`, {
                status: "running",
                startedAt: new Date(Date.now() - 120_000),
                createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
              }));
            },
          ),
        );
      }

      const stalled = await primary.findStalledRuns(60_000);

      assertEquals(cursorCalls, 2);
      assertEquals(stalled.length, 1_001);
      assertEquals(new Set(stalled.map((run) => run.id)).size, 1_001);
      assertEquals(stalled.some((run) => run.id === "cursor-run-0"), true);
    } finally {
      await primary.destroy();
      await control.destroy();
    }
  });

  it("matches Redis byte ordering for equal timestamps and includes date boundaries", async () => {
    const backend = new RedisBackend({
      prefix: uniquePrefix("stable-order"),
      client: await connectRedis(),
    });
    const createdAt = new Date("2026-02-01T00:00:00.000Z");
    try {
      for (const id of ["order-a", "order-\uE000", "order-😀"]) {
        await backend.createRun(createRun(id, { createdAt }));
      }

      assertEquals(
        (await backend.listRuns({ createdAfter: createdAt, createdBefore: createdAt })).map((run) =>
          run.id
        ),
        ["order-😀", "order-\uE000", "order-a"],
      );
      assertEquals(
        await backend.countRuns({ createdAfter: createdAt, createdBefore: createdAt }),
        3,
      );
    } finally {
      await backend.destroy();
    }
  });
});
