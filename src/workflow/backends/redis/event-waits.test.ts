import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { isVeryfrontError, ORCHESTRATION_ERROR } from "#veryfront/errors";
import type { RedisAdapter } from "#veryfront/platform/adapters/redis/index.ts";
import { RedisBackend } from "#veryfront/workflow/backends/redis/index.ts";
import type { PersistedPendingEventWait } from "#veryfront/workflow/backends/types.ts";

const at = new Date("2026-10-06T12:00:00.000Z");
const event = { id: "event", eventName: "ready", payload: { items: [] }, publishedAt: at };
const storedEvent = {
  value: JSON.stringify(event),
  id: event.id,
  name: event.eventName,
  at: at.getTime(),
  order: 7,
};
const payloadFreeEvent = {
  id: "payload-free",
  eventName: "ready",
  payload: undefined,
  publishedAt: at,
};
const payloadFreeStoredEvent = {
  value: JSON.stringify({
    id: payloadFreeEvent.id,
    eventName: payloadFreeEvent.eventName,
    payloadAbsent: true,
    publishedAt: at,
  }),
  id: payloadFreeEvent.id,
  name: payloadFreeEvent.eventName,
  at: at.getTime(),
};
const wait: PersistedPendingEventWait = {
  id: "wait",
  runId: "run",
  nodeId: "node",
  waitInstanceId: "attempt",
  waitKind: "event",
  eventName: "ready",
  status: "pending",
  requestedAt: at,
  expiresAt: at,
  claimedAt: at,
  recoveryClaimedAt: at,
  claimedEventId: "event",
  deliveredEventId: "delivered",
};
const storedWait = {
  value: JSON.stringify(wait),
  id: wait.id,
  nodeId: wait.nodeId,
  instance: "attempt",
  kind: wait.waitKind,
  status: wait.status,
  claimedAt: at.getTime(),
  recoveryClaimedAt: at.getTime(),
  claimedEventId: "event",
  deliveredEventId: "delivered",
};
function recordedPayload(call: { args: string[] } | undefined) {
  assertExists(call);
  const raw = call.args[1];
  assertExists(raw);
  return JSON.parse(raw);
}

function boundary(response: unknown = true, state: unknown = { waits: [], mail: [], claims: {} }) {
  const calls: Array<{ keys: string[]; args: string[] }> = [];
  // Predetermined transport replies test encoding/decoding only; Lua behavior
  // is qualified separately with real Redis receivers.
  const client = {
    eval: (_script: string, keys: string[], args: string[]): Promise<unknown> => {
      calls.push({ keys, args });
      return Promise.resolve(JSON.stringify(response));
    },
    del: (_key: string) => Promise.resolve(1),
    get: () => Promise.resolve(state === null ? null : JSON.stringify(state)),
    smembers: () => Promise.resolve(["run", "gone"]),
    exists: (key: string) => Promise.resolve(key.endsWith(":run:run") ? 1 : 0),
  };
  return {
    client,
    calls,
    store: new RedisBackend({ client: client as unknown as RedisAdapter, prefix: "proof:" }),
  };
}

describe("Redis event-wait transport boundary", () => {
  it("serializes dates and ownership constraints before a durable wait write", async () => {
    const { store, calls } = boundary();
    await store.savePendingEventWait("run", wait);
    assertEquals(
      await store.savePendingEventWaitIfStatusAndWorker("run", ["running"], "worker", wait),
      true,
    );
    const input = recordedPayload(calls[1]);
    assertEquals(input.statuses, ["running"]);
    assertEquals(input.worker, "worker");
    assertEquals(JSON.parse(input.wait.value).requestedAt, at.toISOString());
    assertEquals(input.wait.claimedAt, at.getTime());
    await assertRejects(() =>
      store.savePendingEventWait("run", { ...wait, requestedAt: new Date(NaN) })
    );
    assertEquals(calls.length, 2);
  });
  it("hydrates wait dates and filters run discovery without exposing orphan waits", async () => {
    const { store } = boundary(true, {
      waits: [storedWait, { ...storedWait, status: "cancelled" }],
      mail: {},
      claims: {},
    });
    assertEquals(await store.getPendingEventWaits("run"), [wait]);
    assertEquals(await store.listPendingEventWaits(), [{ runId: "run", wait }]);
    assertEquals(await store.hasRunEventDeliveryReceipt("run", "delivered"), true);
    assertEquals(await store.hasRunEventDeliveryReceipt("run", "absent"), false);
    assertEquals(await boundary(true, null).store.getPendingEventWaits("run"), []);
  });
  it("decodes only timed claims and keeps persisted event delivery correlation", async () => {
    const timed = { ...storedWait, status: "expired" };
    const { store } = boundary(true, {
      waits: [timed, {
        ...storedWait,
        id: "delay",
        kind: "delay",
        status: "delivered",
        value: JSON.stringify({ ...wait, id: "delay", waitKind: "delay" }),
      }, {
        ...storedWait,
        id: "other",
        claimedAt: undefined,
      }],
      mail: [],
      claims: { event: { waitId: "wait", event: storedEvent, claimedAt: at.getTime() } },
    });
    assertEquals((await store.listTimedEventWaitClaims("run")).map((w) => w.id), ["wait", "delay"]);
    const claims = await store.listRunEventDeliveryClaims("run");
    const claim = claims[0];
    assertExists(claim);
    assertEquals(claim.event, event);
    assertEquals(claim.claimedAt, at);
    assertEquals(claim.wait.claimedEventId, "event");
    await assertRejects(() =>
      boundary(true, {
        waits: [],
        mail: [],
        claims: { bad: { waitId: "missing", event: storedEvent, claimedAt: 0 } },
      }).store.listRunEventDeliveryClaims("run")
    );
  });
  it("preserves event payload shape and private ordering across take and restore", async () => {
    const { store, calls } = boundary(storedEvent);
    assertEquals(await store.peekRunEvent("run", "ready"), event);
    const taken = await store.takeRunEvent("run", "ready");
    const expectedTaken = { ...event, _publicationOrder: 7 };
    assertEquals(taken, expectedTaken);
    await store.restoreRunEvent("run", taken!);
    const restored = recordedPayload(calls.at(-1)).event;
    assertEquals(restored.order, 7);
    assertEquals(JSON.parse(restored.value).payload, { items: [] });
    assertEquals(await store.claimRunEventForWait("run", "wait", "ready", at), event);

    const payloadFree = boundary(payloadFreeStoredEvent);
    assertEquals(await payloadFree.store.peekRunEvent("run", "ready"), payloadFreeEvent);
    await payloadFree.store.appendRunEvent("run", payloadFreeEvent);
    const encoded = JSON.parse(recordedPayload(payloadFree.calls.at(-1)).event.value);
    assertEquals("payload" in encoded, false);
    assertEquals(encoded.payloadAbsent, true);
    await payloadFree.store.restoreRunEvent("run", payloadFreeEvent);
    const restoredPayloadFree = JSON.parse(recordedPayload(payloadFree.calls.at(-1)).event.value);
    assertEquals(restoredPayloadFree.payloadAbsent, true);

    const empty = boundary(null).store;
    assertEquals(await empty.peekRunEvent("run", "ready"), null);
    assertEquals(await empty.takeRunEvent("run", "ready"), null);
    assertEquals(await empty.claimRunEventForWait("run", "wait", "ready"), null);
  });
  it("forwards explicit rollback, deadline and finalization decisions without dropping bindings", async () => {
    const { store, calls } = boundary();
    assertEquals(
      await store.resolvePendingEventWait("run", "wait", "expired", {
        eventName: "ready",
        publishedBefore: at,
      }),
      true,
    );
    assertEquals(recordedPayload(calls.at(-1)).cutoff, at.getTime());
    assertEquals(await store.restorePendingEventWait("run", "wait"), true);
    assertEquals(await store.reserveTimedEventWaitClaim("run", "wait", at, at), true);
    await store.finalizeTimedEventWaitClaim("run", "wait");
    await store.appendRunEvent("run", event);
    assertEquals(await store.removeRunEvent("run", "event"), true);
    assertEquals(await store.reserveRunEventDeliveryClaim("run", "wait", "event", at, at), true);
    assertEquals(await store.restoreRunEventDelivery("run", "wait", event), true);
    await store.finalizeRunEventDelivery("run", "event", true);
    assertEquals(recordedPayload(calls.at(-1)), { eventId: "event", delivered: true });
  });
  it("maps malformed and rejected Redis replies to registered errors", async () => {
    const { store, client } = boundary();
    client.get = () => Promise.reject(new Error("unavailable"));
    await assertRejects(() => store.getPendingEventWaits("run"));
    client.eval = () => Promise.reject(new Error("Workflow run not found"));
    await assertRejects(() => store.savePendingEventWait("run", wait));
    client.eval = () => Promise.reject(new Error("unavailable"));
    await assertRejects(() => store.appendRunEvent("run", event));
    client.eval = () => Promise.resolve("not-json");
    await assertRejects(() => store.removeRunEvent("run", "event"));
  });
  it("repairs legacy mailbox eligibility in bounded turns before retrying the same publication", async () => {
    const { store, client, calls } = boundary();
    const ids = Array.from({ length: 51 }, (_, i) => `legacy-${i}`);
    const replies: unknown[] = [
      new Error("Run event mailbox capacity reached"),
      ids,
      50,
      1,
      "true",
    ];
    const deleted: string[] = [];
    client.eval = (_script, keys, args) => {
      calls.push({ keys, args });
      const reply = replies.shift();
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    };
    client.del = (key) => {
      deleted.push(key);
      return Promise.resolve(1);
    };
    await store.appendRunEvent("run", event);
    assertEquals(calls.length, 5);
    const [initial, snapshot, first, second, retry] = calls;
    assertExists(initial);
    assertExists(snapshot);
    assertExists(first);
    assertExists(second);
    assertExists(retry);
    assertEquals(snapshot.keys, [initial.keys[5]]);
    assertEquals(deleted, [`${initial.keys[5]}:evictable`]);
    assertEquals(recordedPayload(first), ids.slice(0, 50));
    assertEquals(recordedPayload(second), ids.slice(50));
    assertEquals(first.args[0], initial.args[7]);
    assertEquals(retry.keys, initial.keys);
    assertEquals(recordedPayload(retry), recordedPayload(initial));
  });
  it("rejects invalid legacy index replies and preserves reconciliation errors as registered failures", async () => {
    for (const reply of [null, [1], new Error("index unavailable")]) {
      const { store, client } = boundary();
      let calls = 0;
      client.eval = () => {
        if (++calls === 1) return Promise.reject(new Error("Run event mailbox capacity reached"));
        return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
      };
      const error = await assertRejects(() => store.appendRunEvent("run", event));
      if (!isVeryfrontError(error)) {
        throw new Error("Reconciliation error lost registered identity");
      }
      assertEquals(error.slug, ORCHESTRATION_ERROR.slug);
      assertEquals(error.message, "Redis workflow mailbox reconciliation failed");
      assertEquals(calls, 2);
    }
  });
  it("does not loop on a full protected mailbox after one repair attempt", async () => {
    const { store, client } = boundary();
    let calls = 0;
    client.eval = () =>
      ++calls === 2
        ? Promise.resolve([])
        : Promise.reject(new Error("Run event mailbox capacity reached"));
    const error = await assertRejects(() => store.appendRunEvent("run", event));
    if (!isVeryfrontError(error)) throw new Error("Capacity error lost registered identity");
    assertEquals(error.slug, ORCHESTRATION_ERROR.slug);
    assertEquals(calls, 3);
  });
});
