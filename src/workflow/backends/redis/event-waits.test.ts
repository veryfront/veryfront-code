import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
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
    eval: (_script: string, keys: string[], args: string[]) => {
      calls.push({ keys, args });
      return Promise.resolve(JSON.stringify(response));
    },
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
  it("round-trips absent payloads without converting them to null or rejecting publication", async () => {
    const empty = { ...event, payload: undefined };
    const { store, calls } = boundary({ ...storedEvent, value: JSON.stringify(empty) });
    await store.appendRunEvent("run", empty);
    const encoded = JSON.parse(recordedPayload(calls[0]).event.value);
    assertEquals(Object.hasOwn(encoded, "payload"), false);
    assertEquals(await store.peekRunEvent("run", "ready"), empty);
  });
});
