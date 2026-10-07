import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { RedisBackend } from "#veryfront/workflow/backends/redis/index.ts";
import { hasEventWaitSupport } from "#veryfront/workflow/backends/types.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { createRedisRuntimeProvider } from "../../../extensions/ext-redis/src/redis-runtime-provider.ts";
import { NodeRedisAdapter } from "#veryfront/platform/adapters/redis/node.ts";
import { createWorkflowClient } from "#veryfront/workflow/api/workflow-client.ts";
import { workflow } from "#veryfront/workflow/dsl/workflow.ts";
import { waitForEvent } from "#veryfront/workflow/dsl/wait.ts";
import {
  MAX_WORKFLOW_PENDING_EVENT_WAIT_ENTRIES,
  MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES,
} from "#veryfront/workflow/limits.ts";

async function withReceivers(
  fn: (
    a: RedisBackend,
    b: RedisBackend,
    runId: string,
    cleanup: Array<() => Promise<void>>,
  ) => Promise<void>,
) {
  const prefix = `event-test:${crypto.randomUUID()}`;
  const open = async () => {
    const provider = createRedisRuntimeProvider();
    const module = await provider.loadModule();
    const client = module.createClient({ url: Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL") });
    await client.connect();
    return new RedisBackend({ prefix, client: new NodeRedisAdapter(client) });
  };
  const a = await open(), b = await open(), runId = crypto.randomUUID();
  const cleanup: Array<() => Promise<void>> = [];
  try {
    if (!hasEventWaitSupport(a) || !hasEventWaitSupport(b)) {
      throw new Error("Redis receiver cannot persist event waits");
    }
    await a.createRun({
      id: runId,
      workflowId: "event-proof",
      status: "running",
      workerId: "worker-1",
      input: {},
      nodeStates: {},
      currentNodes: [],
      context: { input: {} },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
    });
    await fn(a, b, runId, cleanup);
  } finally {
    await b.deleteRun(runId);
    for (const close of cleanup) await close();
    await a.destroy();
    await b.destroy();
  }
}

describe("Redis durable event waits", () => {
  it({
    name:
      "Redis retention cannot delete an unfinished event delivery and deletes finalized event state",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, () =>
    withReceivers(async (a, b, runId) => {
      const now = new Date();
      const event = { id: "delivery", eventName: "ready", payload: {}, publishedAt: now };
      await a.savePendingEventWait(runId, {
        id: "wait",
        runId,
        nodeId: "ready",
        eventName: "ready",
        waitKind: "event",
        requestedAt: now,
        status: "pending",
      });
      await b.appendRunEvent(runId, event);
      assertEquals(await a.claimRunEventForWait(runId, "wait", "ready"), event);
      await a.updateRun(runId, { status: "completed", completedAt: now });
      const candidates = await b.listTerminalRunRetentionCandidates(
        new Date(now.getTime() + 1),
        10,
      );
      const candidate = candidates.candidates.find((c) => c.runId === runId);
      assertExists(candidate);
      assertEquals(await b.deleteTerminalRunIfUnchanged(candidate), false);
      assertEquals((await b.listRunEventDeliveryClaims(runId)).length, 1);
      await b.finalizeRunEventDelivery(runId, event.id, true);
      assertEquals(await a.deleteTerminalRunIfUnchanged(candidate), false);
      const fresh = (await a.listTerminalRunRetentionCandidates(new Date(now.getTime() + 1), 10))
        .candidates.find((c) => c.runId === runId);
      assertExists(fresh);
      assertEquals(await a.deleteTerminalRunIfUnchanged(fresh), true);
      assertEquals(await b.listRunEventDeliveryClaims(runId), []);
      assertEquals(await b.hasRunEventDeliveryReceipt(runId, event.id), false);
    }));

  it({
    name: "Redis wait and mailbox bounds preserve unfinished records and reserved event slots",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, () =>
    withReceivers(async (a, b, runId) => {
      const now = new Date();
      for (let i = 0; i < MAX_WORKFLOW_PENDING_EVENT_WAIT_ENTRIES; i++) {
        await a.savePendingEventWait(runId, {
          id: `wait-${i}`,
          runId,
          nodeId: `node-${i}`,
          eventName: "ready",
          waitKind: "event",
          requestedAt: now,
          status: "pending",
        });
      }
      await assertRejects(() =>
        b.savePendingEventWait(runId, {
          id: "overflow",
          runId,
          nodeId: "overflow",
          eventName: "ready",
          waitKind: "event",
          requestedAt: now,
          status: "pending",
        })
      );
      assertEquals(
        (await b.getPendingEventWaits(runId)).length,
        MAX_WORKFLOW_PENDING_EVENT_WAIT_ENTRIES,
      );
      for (let i = 0; i < MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES; i++) {
        await a.appendRunEvent(runId, {
          id: `event-${i}`,
          eventName: "ready",
          payload: i,
          publishedAt: now,
        });
      }
      const first = await b.claimRunEventForWait(runId, "wait-0", "ready");
      assertExists(first);
      await assertRejects(() =>
        a.appendRunEvent(runId, {
          id: "overflow",
          eventName: "ready",
          payload: null,
          publishedAt: now,
        })
      );
      assertEquals(await a.restoreRunEventDelivery(runId, "wait-0", first), true);
      assertEquals((await b.takeRunEvent(runId, "ready"))?.id, "event-0");
      assertEquals((await b.peekRunEvent(runId, "ready"))?.id, "event-1");
      assertEquals(await b.removeRunEvent(runId, "event-1"), true);
      assertEquals((await a.peekRunEvent(runId, "ready"))?.id, "event-2");
    }));

  it({
    name: "Redis event mailbox can precede a run and normal orphan cleanup removes it",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, () =>
    withReceivers(async (a, b) => {
      const runId = crypto.randomUUID();
      const event = { id: "early", eventName: "ready", payload: false, publishedAt: new Date() };
      await a.appendRunEvent(runId, event);
      assertEquals(await b.peekRunEvent(runId, "ready"), event);
      await b.deleteRun(runId);
      assertEquals(await a.peekRunEvent(runId, "ready"), null);
    }));

  it({
    name: "Redis workflow resumes its actual persisted event checkpoint after receiver replacement",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, () =>
    withReceivers(async (a, b, _runId, cleanup) => {
      const definition = workflow({
        id: "event-resume",
        steps: [waitForEvent("receive", { eventName: "invoice.received" })],
        output: (context) => context.receive,
      });
      const initial = createWorkflowClient({ backend: a });
      const replacement = createWorkflowClient({ backend: b });
      cleanup.push(() => initial.destroy(), () => replacement.destroy());
      initial.register(definition);
      replacement.register(definition);
      let id: string | undefined;
      try {
        const handle = await initial.start(definition.id, {});
        id = handle.runId;
        await handle.settled();
        assertEquals((await b.getRun(id))?.status, "waiting");
        assertEquals((await b.getPendingEventWaits(id)).length, 1);
        await initial.destroy();
        assertEquals(
          await replacement.publishEvent(id, "invoice.received", { amount: 7, items: [] }),
          "delivered",
        );
        const completed = await b.getRun(id);
        assertEquals(completed?.status, "completed");
        assertEquals((completed?.context.receive as { payload: unknown }).payload, {
          amount: 7,
          items: [],
        });
        assertEquals(await b.getPendingEventWaits(id), []);
        assertEquals(await b.listRunEventDeliveryClaims(id), []);
      } finally {
        if (id) await b.deleteRun(id);
      }
    }));

  it({
    name: "Redis on-time buffered event wins expiry and delivery is claimed once",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, () =>
    withReceivers(async (a, b, runId) => {
      const deadline = new Date("2026-01-01T00:00:00Z");
      await a.savePendingEventWait(runId, {
        id: "wait",
        runId,
        nodeId: "ready",
        eventName: "ready",
        waitKind: "event",
        requestedAt: deadline,
        expiresAt: deadline,
        status: "pending",
      });
      await b.appendRunEvent(runId, {
        id: "on-time",
        eventName: "ready",
        payload: { empty: [], nested: { empty: [] } },
        publishedAt: deadline,
      });
      const [expiry, event] = await Promise.all([
        a.resolvePendingEventWait(runId, "wait", "expired", {
          eventName: "ready",
          publishedBefore: deadline,
        }),
        b.claimRunEventForWait(runId, "wait", "ready", deadline),
      ]);
      assertEquals(expiry, false);
      assertEquals(event?.id, "on-time");
      assertEquals(event?.payload, { empty: [], nested: { empty: [] } });
      assertEquals(await a.resolvePendingEventWait(runId, "wait", "expired"), false);
      await b.finalizeRunEventDelivery(runId, "on-time", true);
    }));

  it({
    name: "Redis failed delivery restores oldest event and wait atomically across receivers",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, () =>
    withReceivers(async (a, b, runId) => {
      const now = new Date();
      await a.savePendingEventWait(runId, {
        id: "wait",
        runId,
        nodeId: "ready",
        eventName: "ready",
        waitKind: "event",
        requestedAt: now,
        status: "pending",
      });
      const event = { id: "first", eventName: "ready", payload: "first", publishedAt: now };
      await a.appendRunEvent(runId, event);
      await b.appendRunEvent(runId, { ...event, id: "second", payload: "second" });
      assertEquals(await a.claimRunEventForWait(runId, "wait", "ready"), event);
      const reservations = await Promise.all([
        a.reserveRunEventDeliveryClaim(runId, "wait", event.id, now, new Date(0)),
        b.reserveRunEventDeliveryClaim(runId, "wait", event.id, now, new Date(0)),
      ]);
      assertEquals(reservations.filter(Boolean).length, 1);
      assertEquals(await b.restoreRunEventDelivery(runId, "wait", event), true);
      assertEquals((await a.getPendingEventWaits(runId)).map((w) => w.id), ["wait"]);
      assertEquals(await a.listRunEventDeliveryClaims(runId), []);
      assertEquals(await b.claimRunEventForWait(runId, "wait", "ready"), event);
      await b.finalizeRunEventDelivery(runId, event.id, true);
      assertEquals((await a.takeRunEvent(runId, "ready"))?.id, "second");
    }));

  it({
    name: "Redis wait append fences a stale worker and timeout recovery reserves one receiver",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, () =>
    withReceivers(async (a, b, runId) => {
      const now = new Date();
      const wait = {
        id: "delay",
        runId,
        nodeId: "delay",
        eventName: "internal-delay",
        waitKind: "delay" as const,
        requestedAt: now,
        status: "pending" as const,
      };
      assertEquals(
        await a.savePendingEventWaitIfStatusAndWorker(runId, ["running"], "stale-worker", wait),
        false,
      );
      assertEquals(await b.getPendingEventWaits(runId), []);
      assertEquals(
        await b.savePendingEventWaitIfStatusAndWorker(runId, ["running"], "worker-1", wait),
        true,
      );
      assertEquals(
        await a.savePendingEventWaitIfStatusAndWorker(runId, ["running"], "worker-1", {
          ...wait,
          id: "duplicate",
        }),
        false,
      );
      assertEquals(await a.resolvePendingEventWait(runId, "delay", "delivered"), true);
      assertEquals((await b.listTimedEventWaitClaims(runId)).map((w) => w.id), ["delay"]);
      const reserved = await Promise.all([
        a.reserveTimedEventWaitClaim(runId, "delay", now, new Date(0)),
        b.reserveTimedEventWaitClaim(runId, "delay", now, new Date(0)),
      ]);
      assertEquals(reserved.filter(Boolean).length, 1);
      await b.finalizeTimedEventWaitClaim(runId, "delay");
      assertEquals(await a.listTimedEventWaitClaims(runId), []);
    }));

  it({
    name: "Redis event wait survives a receiver restart and only one publisher claims it",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, async () => {
    const prefix = `event-test:${crypto.randomUUID()}`;
    const open = async () => {
      const provider = createRedisRuntimeProvider();
      const module = await provider.loadModule();
      const client = module.createClient({ url: Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL") });
      await client.connect();
      return new RedisBackend({ prefix, client: new NodeRedisAdapter(client) });
    };
    const first = await open();
    const second = await open();
    const runId = crypto.randomUUID();
    try {
      assertEquals(hasEventWaitSupport(first), true);
      assertEquals(hasEventWaitSupport(second), true);
      if (!hasEventWaitSupport(first) || !hasEventWaitSupport(second)) return;
      await first.createRun({
        id: runId,
        workflowId: "event-proof",
        status: "running",
        input: {},
        nodeStates: {},
        currentNodes: [],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
      });
      const event = {
        id: "event-1",
        eventName: "ready",
        payload: { items: [] },
        publishedAt: new Date(),
      };
      await first.appendRunEvent(runId, event);
      await first.savePendingEventWait(runId, {
        id: "wait-1",
        runId,
        nodeId: "wait",
        eventName: "ready",
        waitKind: "event",
        requestedAt: new Date(),
        status: "pending",
      });
      await first.destroy();
      assertEquals((await second.getPendingEventWaits(runId)).length, 1);
      const replacement = await open();
      try {
        const claims = await Promise.all([
          second.claimRunEventForWait(runId, "wait-1", "ready"),
          replacement.claimRunEventForWait(runId, "wait-1", "ready"),
        ]);
        assertEquals(claims.filter(Boolean).length, 1);
        assertEquals(claims.find(Boolean), event);
        assertExists((await replacement.listRunEventDeliveryClaims(runId))[0]);
        await replacement.finalizeRunEventDelivery(runId, event.id, true);
        assertEquals(await second.hasRunEventDeliveryReceipt(runId, event.id), true);
        assertEquals(await second.claimRunEventForWait(runId, "wait-1", "ready"), null);
        await second.deleteRun(runId);
        assertEquals(await replacement.hasRunEventDeliveryReceipt(runId, event.id), false);
        assertEquals(await replacement.listRunEventDeliveryClaims(runId), []);
      } finally {
        await replacement.destroy();
      }
    } finally {
      await second.deleteRun(runId);
      await first.destroy();
      await second.destroy();
    }
  });

  it({
    name: "Redis standalone restoration succeeds after a taken slot is refilled",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, () =>
    withReceivers(async (a, b, runId) => {
      const now = new Date();
      for (let i = 0; i < MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES; i++) {
        await a.appendRunEvent(runId, {
          id: `restore-bound-${i}`,
          eventName: "ready",
          payload: { index: i },
          publishedAt: now,
        });
      }
      const taken = await a.takeRunEvent(runId, "ready");
      assertExists(taken);
      await b.appendRunEvent(runId, {
        id: "refilled-slot",
        eventName: "ready",
        payload: {},
        publishedAt: now,
      });
      await a.restoreRunEvent(runId, taken);
      assertEquals(await b.takeRunEvent(runId, "ready"), taken);
      assertEquals((await b.takeRunEvent(runId, "ready"))?.id, "restore-bound-1");
    }));
});
