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
  MAX_WORKFLOW_RUN_EVENT_MAILBOXES,
} from "#veryfront/workflow/limits.ts";

async function withReceivers(
  fn: (
    a: RedisBackend,
    b: RedisBackend,
    runId: string,
    cleanup: Array<() => Promise<void>>,
    openReceiver: (
      observeRead?: (active: number) => void,
      afterRunUpdate?: () => Promise<void>,
    ) => Promise<RedisBackend>,
  ) => Promise<void>,
) {
  const prefix = `event-test:${crypto.randomUUID()}`;
  const open = async (
    observeRead?: (active: number) => void,
    afterRunUpdate?: () => Promise<void>,
  ) => {
    const provider = createRedisRuntimeProvider();
    const module = await provider.loadModule();
    const client = module.createClient({ url: Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL") });
    await client.connect();
    const adapter = new NodeRedisAdapter(client);
    if (observeRead) {
      const get = adapter.get.bind(adapter);
      let active = 0;
      adapter.get = async (key) => {
        observeRead(++active);
        try {
          return await get(key);
        } finally {
          active--;
        }
      };
    }
    if (afterRunUpdate) {
      const evalScript = adapter.eval.bind(adapter);
      adapter.eval = async (script, keys, args) => {
        const result = await evalScript(script, keys, args);
        if (script.startsWith("-- conditional-run-update")) await afterRunUpdate();
        return result;
      };
    }
    return new RedisBackend({ prefix, client: adapter });
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
    await fn(a, b, runId, cleanup, open);
  } finally {
    await b.deleteRun(runId);
    for (const close of cleanup) await close();
    await a.destroy();
    await b.destroy();
  }
}

describe("Redis durable event waits", () => {
  it({
    name: "Redis reconciliation visits mailboxes beyond the legacy take-and-restore capacity bound",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, () =>
    withReceivers(async (a, b, runId, cleanup) => {
      const base = await a.getRun(runId);
      assertExists(base);
      const event = { id: "over-bound", eventName: "ready", payload: {}, publishedAt: new Date() };
      const ids = Array.from(
        { length: MAX_WORKFLOW_RUN_EVENT_MAILBOXES },
        () => crypto.randomUUID(),
      );
      const first = ids[0];
      assertExists(first);
      const orphan = crypto.randomUUID(), next = crypto.randomUUID();
      cleanup.push(async () => {
        for (let offset = 0; offset < ids.length; offset += 50) {
          await Promise.all(ids.slice(offset, offset + 50).map((id) => a.deleteRun(id)));
        }
        await a.deleteRun(orphan);
        await a.deleteRun(next);
      });
      for (let offset = 0; offset < ids.length; offset += 50) {
        await Promise.all(
          ids.slice(offset, offset + 50).map(async (id) => {
            await a.createRun({ ...base, id });
            await a.appendRunEvent(id, event);
          }),
        );
      }
      const taken = await a.takeRunEvent(first, "ready");
      assertExists(taken);
      await b.appendRunEvent(orphan, event);
      await a.restoreRunEvent(first, taken);
      const module = await createRedisRuntimeProvider().loadModule();
      const observer = module.createClient({ url: Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL") });
      await observer.connect();
      cleanup.push(() => observer.close());
      const keys = await observer.keys(`*run:${runId}`);
      const key = keys[0];
      assertExists(key);
      const index = `${key.slice(0, -`run:${runId}`.length)}index:event-mailboxes`;
      assertEquals(
        await observer.eval("return redis.call('zcard',KEYS[1])", {
          keys: [index],
          arguments: [],
        }),
        MAX_WORKFLOW_RUN_EVENT_MAILBOXES + 1,
      );
      // Earlier receivers do not maintain the additive eligibility index.
      await observer.del([`${index}:evictable`]);
      await b.appendRunEvent(next, event);
      assertEquals(await a.peekRunEvent(orphan, "ready"), null);
      assertEquals(await a.peekRunEvent(next, "ready"), event);
      assertEquals(await a.peekRunEvent(first, "ready"), event);
    }));

  it({
    name: "Redis terminal transitions discard buffered mail and settle delivery claims",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, () =>
    withReceivers(async (a, b, runId, cleanup, openReceiver) => {
      const now = new Date();
      const claimed = { id: "claimed", eventName: "ready", payload: {}, publishedAt: now };
      await a.savePendingEventWait(runId, {
        id: "wait",
        runId,
        nodeId: "ready",
        eventName: "ready",
        waitKind: "event",
        requestedAt: now,
        status: "pending",
      });
      await b.appendRunEvent(runId, claimed);
      assertEquals(await a.claimRunEventForWait(runId, "wait", "ready"), claimed);
      let observedClaims: unknown;
      let observedReceipt: boolean | undefined;
      const observer = await openReceiver(undefined, async () => {
        observedClaims = await b.listRunEventDeliveryClaims(runId);
        observedReceipt = await b.hasRunEventDeliveryReceipt(runId, claimed.id);
      });
      cleanup.push(() => observer.destroy());
      assertEquals(
        await observer.updateRunIfStatus(runId, ["running"], {
          status: "completed",
          completedAt: now,
          nodeStates: { ready: { nodeId: "ready", status: "completed", attempt: 1 } },
        }),
        true,
      );
      assertEquals(observedClaims, []);
      assertEquals(observedReceipt, true);
      assertEquals(await a.listRunEventDeliveryClaims(runId), []);
      assertEquals(await a.hasRunEventDeliveryReceipt(runId, claimed.id), true);

      const buffered = { id: "buffered", eventName: "late", payload: {}, publishedAt: now };
      await a.appendRunEvent(runId, buffered);
      await b.updateRun(runId, { heartbeatAt: new Date() });
      assertEquals((await a.peekRunEvent(runId, "late"))?.id, buffered.id);
      await b.updateRun(runId, { status: "cancelled", completedAt: now });
      assertEquals(await a.takeRunEvent(runId, "late"), null);
    }));

  it({
    name: "Redis retention protects unfinished failed-run delivery until finalization",
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
      await a.updateRun(runId, { status: "failed", completedAt: now });
      const readCandidates = async (receiver: RedisBackend) => {
        // Index repair is incremental; an empty page with hasMore is not EOF.
        let page = await receiver.listTerminalRunRetentionCandidates(
          new Date(now.getTime() + 1),
          10,
        );
        for (
          let attempt = 0;
          page.hasMore && page.candidates.length === 0 && attempt < 20;
          attempt++
        ) {
          page = await receiver.listTerminalRunRetentionCandidates(new Date(now.getTime() + 1), 10);
        }
        return page;
      };
      const candidates = await readCandidates(b);
      const candidate = candidates.candidates.find((c) => c.runId === runId);
      assertExists(candidate);
      assertEquals(await b.deleteTerminalRunIfUnchanged(candidate), false);
      assertEquals((await b.listRunEventDeliveryClaims(runId)).length, 1);
      await b.finalizeRunEventDelivery(runId, event.id, true);
      assertEquals(await a.deleteTerminalRunIfUnchanged(candidate), false);
      const fresh = (await readCandidates(a)).candidates.find((c) => c.runId === runId);
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
    const open = async (observeRead?: (active: number) => void) => {
      const provider = createRedisRuntimeProvider();
      const module = await provider.loadModule();
      const client = module.createClient({ url: Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL") });
      await client.connect();
      const adapter = new NodeRedisAdapter(client);
      if (observeRead) {
        const get = adapter.get.bind(adapter);
        let active = 0;
        adapter.get = async (key) => {
          observeRead(++active);
          try {
            return await get(key);
          } finally {
            active--;
          }
        };
      }
      return new RedisBackend({ prefix, client: adapter });
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
  it({
    name:
      "Redis standalone rollback preserves two publication sequences across receiver replacement",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, async () => {
    for (const restoreOrder of [[0, 1], [1, 0]]) {
      await withReceivers(async (a, _b, runId, cleanup, openReceiver) => {
        const now = new Date();
        for (const id of ["first", "second"]) {
          await a.appendRunEvent(runId, {
            id,
            eventName: "ready",
            payload: { id },
            publishedAt: now,
          });
        }
        const first = await a.takeRunEvent(runId, "ready"),
          second = await a.takeRunEvent(runId, "ready");
        assertExists(first);
        assertExists(second);
        const snapshots = JSON.parse(JSON.stringify([first, second])).map((
          event: typeof first,
        ) => ({ ...event, publishedAt: new Date(event.publishedAt) }));
        await a.destroy();
        const replacement = await openReceiver();
        cleanup.push(() => replacement.destroy());
        for (const index of restoreOrder) {
          await replacement.restoreRunEvent(runId, snapshots[index]);
        }
        assertEquals((await replacement.takeRunEvent(runId, "ready"))?.id, "first");
        assertEquals((await replacement.takeRunEvent(runId, "ready"))?.id, "second");
      });
    }
  });
  it({
    name: "Redis recovery sweeps preserve all persisted waits with bounded concurrent reads",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, () =>
    withReceivers(async (a, _b, runId, cleanup, open) => {
      const run = await a.getRun(runId);
      assertExists(run);
      const ids = Array.from({ length: 101 }, () => crypto.randomUUID());
      for (const id of ids) {
        await a.createRun({ ...run, id });
        cleanup.push(() => a.deleteRun(id));
        await a.savePendingEventWait(id, {
          id: "wait",
          runId: id,
          nodeId: "event",
          waitKind: "event",
          eventName: "ready",
          status: "pending",
          requestedAt: new Date(),
        });
      }
      let maximumReads = 0;
      let totalReads = 0;
      const replacement = await open((active) => {
        maximumReads = Math.max(maximumReads, active);
        totalReads++;
      });
      cleanup.push(() => replacement.destroy());
      const waits = await replacement.listPendingEventWaits();
      assertEquals(waits.map((entry) => entry.runId).sort(), ids.sort());
      assertEquals(totalReads, ids.length);
      assertEquals(maximumReads <= 50, true);
    }));
  it({
    name: "Redis mailbox pressure bounds reserved IDs without evicting live run data",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, () =>
    withReceivers(async (a, b, runId, cleanup) => {
      const event = { id: "reserved", eventName: "ready", payload: {}, publishedAt: new Date() };
      await a.appendRunEvent(runId, event);
      await a.savePendingEventWait(runId, {
        id: "reservation",
        runId,
        nodeId: "ready",
        waitKind: "event",
        eventName: "ready",
        status: "pending",
        requestedAt: event.publishedAt,
      });
      assertEquals(await a.claimRunEventForWait(runId, "reservation", "ready"), event);
      const ids = Array.from(
        { length: MAX_WORKFLOW_RUN_EVENT_MAILBOXES },
        () => crypto.randomUUID(),
      );
      cleanup.push(async () => {
        for (let offset = 0; offset < ids.length; offset += 50) {
          await Promise.all(ids.slice(offset, offset + 50).map((id) => a.deleteRun(id)));
        }
      });
      const first = ids[0], retryable = ids[1];
      assertExists(first);
      assertExists(retryable);
      await a.appendRunEvent(first, event);
      for (let offset = 1; offset < ids.length; offset += 50) {
        await Promise.all(ids.slice(offset, offset + 50).map((id) => a.appendRunEvent(id, event)));
      }
      assertEquals(await b.peekRunEvent(first, "ready"), null);
      assertEquals((await b.peekRunEvent(ids.at(-1)!, "ready"))?.id, event.id);
      assertEquals((await b.listRunEventDeliveryClaims(runId)).length, 1);
      assertEquals(await b.restoreRunEventDelivery(runId, "reservation", event), true);
      assertEquals((await b.peekRunEvent(runId, "ready"))?.id, event.id);
      const base = await a.getRun(runId);
      assertExists(base);
      for (let offset = 0; offset < ids.length; offset += 50) {
        await Promise.all(ids.slice(offset, offset + 50).map((id) => a.createRun({ ...base, id })));
      }
      await a.updateRun(retryable, { status: "failed" });
      const provider = createRedisRuntimeProvider();
      const module = await provider.loadModule();
      const observer = module.createClient({ url: Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL") });
      await observer.connect();
      cleanup.push(async () => {
        await observer.close();
      });
      const getCalls = async () => {
        const stats = await observer.eval("return redis.call('info','commandstats')", {
          keys: [],
          arguments: [],
        });
        assertEquals(typeof stats, "string");
        return Number(String(stats).match(/cmdstat_get:calls=(\d+)/)?.[1] ?? 0);
      };
      await b.updateRun(runId, { status: "completed" });
      await a.appendRunEvent(runId, event);
      const beforeGetCalls = await getCalls();
      const overflow = crypto.randomUUID();
      await assertRejects(() => a.appendRunEvent(overflow, event));
      const capacityLookupCalls = await getCalls() - beforeGetCalls;
      assertEquals(capacityLookupCalls <= 3, true, `Capacity used ${capacityLookupCalls} GETs`);
      assertEquals(await b.peekRunEvent(overflow, "ready"), null);
      assertEquals((await b.peekRunEvent(retryable, "ready"))?.id, event.id);
      const last = ids.at(-1);
      assertExists(last);
      assertEquals(await b.updateRunIfStatus(last, ["running"], { status: "completed" }), true);
      const runKeys = await observer.keys(`*run:${runId}`);
      assertEquals(runKeys.length, 1);
      const runKey = runKeys[0];
      assertExists(runKey);
      const prefix = runKey.slice(0, -`run:${runId}`.length);
      // Older receivers maintain the global index without the new eligibility index.
      await observer.del([`${prefix}index:event-mailboxes:evictable`]);
      await a.appendRunEvent(overflow, event);
      assertEquals(await b.peekRunEvent(last, "ready"), null);
      assertEquals((await b.peekRunEvent(overflow, "ready"))?.id, event.id);
      cleanup.push(() => a.deleteRun(overflow));
      await b.updateRun(retryable, { status: "cancelled" });
      // A later legacy mutation must be repaired even after an earlier reconciliation.
      await observer.del([`${prefix}index:event-mailboxes:evictable`]);
      const afterCancellation = crypto.randomUUID();
      cleanup.push(() => a.deleteRun(afterCancellation));
      await a.appendRunEvent(afterCancellation, event);
      assertEquals(await b.peekRunEvent(retryable, "ready"), null);
      assertEquals((await b.peekRunEvent(runId, "ready"))?.id, event.id);
    }));

  it({
    name: "Redis reserved ID rollback keeps ordering after its empty mailbox is removed",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, () =>
    withReceivers(async (a, b, _runId, cleanup) => {
      const reserved = crypto.randomUUID();
      cleanup.push(() => a.deleteRun(reserved));
      const at = new Date();
      await a.appendRunEvent(reserved, {
        id: "first",
        eventName: "ready",
        payload: {},
        publishedAt: at,
      });
      const first = await a.takeRunEvent(reserved, "ready");
      assertExists(first);
      await b.appendRunEvent(reserved, {
        id: "second",
        eventName: "ready",
        payload: {},
        publishedAt: at,
      });
      await b.restoreRunEvent(reserved, first);
      assertEquals((await b.takeRunEvent(reserved, "ready"))?.id, "first");
      assertEquals((await b.takeRunEvent(reserved, "ready"))?.id, "second");
    }));
  it({
    name: "Redis public event publication accepts an omitted payload and resumes a durable wait",
    ignore: !Deno.env.get("WORKFLOW_EVENT_TEST_REDIS_URL"),
  }, () =>
    withReceivers(async (_a, b, _runId, cleanup) => {
      const definition = workflow({
        id: "empty-payload-event",
        steps: [waitForEvent("receive", { eventName: "ready" })],
        output: (context) => context.receive,
      });
      const client = createWorkflowClient({ backend: b });
      cleanup.push(() => client.destroy());
      client.register(definition);
      const handle = await client.start(definition.id, {});
      cleanup.unshift(() => b.deleteRun(handle.runId));
      await handle.settled();
      assertEquals((await b.getRun(handle.runId))?.status, "waiting");
      assertEquals(await client.publishEvent(handle.runId, "ready"), "delivered");
      const completed = await b.getRun(handle.runId);
      assertEquals(completed?.status, "completed");
      assertEquals((completed?.context.receive as { payload?: unknown }).payload, undefined);
      assertEquals(await b.getPendingEventWaits(handle.runId), []);
      assertEquals(await b.listRunEventDeliveryClaims(handle.runId), []);
    }));
});
