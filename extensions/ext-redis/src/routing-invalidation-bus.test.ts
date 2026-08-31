import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type RoutingInvalidationRedisClient,
  startProxyRoutingInvalidationBus,
} from "./routing-invalidation-bus.ts";
import type { ProxyRoutingInvalidationEvent } from "veryfront/extensions/distributed/routing-invalidation-support";

type RedisListener = (message: string, channel: string) => void;

const ROUTING_INVALIDATION_CHANNEL = "vf-proxy-routing-invalidations-v1";
const ROUTING_INVALIDATION_ACK_PREFIX = `${ROUTING_INVALIDATION_CHANNEL}:ack:`;
const EVENT_SIGNATURE_DOMAIN = "vf-proxy-routing-invalidation:event:v1";
const ACK_SIGNATURE_DOMAIN = "vf-proxy-routing-invalidation:ack:v1";
const TEST_NOW_MS = 1_800_000_000_000;
// These tests assert acknowledgement semantics, not scheduler speed. WebCrypto
// verification can exceed 100 ms when the repository test matrix runs in
// parallel, so keep the deadline comfortably above normal host contention.
const ACKNOWLEDGEMENT_TEST_TIMEOUT_MS = 1_000;

function createFakeRedisServer() {
  const subscriptions = new Map<RoutingInvalidationRedisClient, Map<string, RedisListener>>();
  const clients: RoutingInvalidationRedisClient[] = [];
  let onPublish:
    | ((channel: string, message: string) => void | Promise<void>)
    | undefined;

  const publishRaw = async (channel: string, message: string): Promise<number> => {
    await onPublish?.(channel, message);
    const listeners = [...subscriptions.values()]
      .map((channels) => channels.get(channel))
      .filter((listener): listener is RedisListener => Boolean(listener));
    for (const listener of listeners) queueMicrotask(() => listener(message, channel));
    return listeners.length;
  };

  const createClient = (): RoutingInvalidationRedisClient => {
    const client: RoutingInvalidationRedisClient = {
      connect: () => Promise.resolve(),
      publish: publishRaw,
      subscribe: (channel, listener) => {
        const channels = subscriptions.get(client) ?? new Map<string, RedisListener>();
        channels.set(channel, listener);
        subscriptions.set(client, channels);
        return Promise.resolve();
      },
      unsubscribe: (channel) => {
        subscriptions.get(client)?.delete(channel);
        return Promise.resolve();
      },
      close: () => {
        subscriptions.delete(client);
        return Promise.resolve();
      },
      destroy: () => subscriptions.delete(client),
    };
    clients.push(client);
    return client;
  };

  return {
    clients,
    createClient,
    publishRaw,
    setOnPublish(listener: typeof onPublish) {
      onPublish = listener;
    },
  };
}

function createEvent(eventId = "event-1"): ProxyRoutingInvalidationEvent {
  return {
    eventId,
    version: 1,
    projectId: "project-1",
    projectSlug: "demo-project",
    deploymentId: "deployment-1",
    environmentId: "environment-1",
    environmentName: "production",
    releaseId: "release-1",
  };
}

function createIntegritySecret(): string {
  return crypto.randomUUID();
}

function base64UrlEncode(bytes: ArrayBuffer): string {
  const binary = Array.from(new Uint8Array(bytes), (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function signTestEnvelope(
  domain: string,
  payload: string,
  secret: string,
  issuedAtMs = TEST_NOW_MS,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const encoded = new TextEncoder().encode(`${domain}\0${issuedAtMs}\0${payload}`);
  const input = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  return JSON.stringify({
    version: 1,
    issuedAtMs,
    payload,
    signature: base64UrlEncode(await crypto.subtle.sign("HMAC", key, input)),
  });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe("proxy routing invalidation Redis bus", () => {
  it("fans out to every replica and waits for a distinct acknowledgement from each", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const replicaA: ProxyRoutingInvalidationEvent[] = [];
    const replicaB: ProxyRoutingInvalidationEvent[] = [];
    const busA = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: ACKNOWLEDGEMENT_TEST_TIMEOUT_MS,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: (event) => {
        replicaA.push(event);
      },
    });
    const busB = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-b",
      acknowledgementTimeoutMs: ACKNOWLEDGEMENT_TEST_TIMEOUT_MS,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: (event) => {
        replicaB.push(event);
      },
    });

    const result = await busA?.publish(createEvent());
    const duplicateResult = await busA?.publish(createEvent());

    assertEquals(result, { acknowledged: 2, converged: true, recipients: 2 });
    assertEquals(duplicateResult, { acknowledged: 2, converged: true, recipients: 2 });
    assertEquals(replicaA, [createEvent()]);
    assertEquals(replicaB, [createEvent()]);

    await busA?.close();
    await busB?.close();
    assertEquals(redis.clients.length, 4);
  });

  it("does not claim convergence when a subscribed replica fails to apply the event", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const busA = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: ACKNOWLEDGEMENT_TEST_TIMEOUT_MS,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: () => {},
    });
    const busB = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-b",
      acknowledgementTimeoutMs: ACKNOWLEDGEMENT_TEST_TIMEOUT_MS,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: () => {
        throw new Error("failed to invalidate");
      },
    });

    const result = await busA?.publish(createEvent());

    assertEquals(result, { acknowledged: 1, converged: false, recipients: 2 });
    await busA?.close();
    await busB?.close();
  });

  it("does not claim convergence when fewer replicas are subscribed than configured", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-a",
      // This assertion is about configured replica convergence, not scheduler
      // speed. Leave enough time for WebCrypto verification under a parallel
      // repository test run.
      acknowledgementTimeoutMs: 1_000,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: () => {},
    });

    const result = await bus?.publish(createEvent());

    assertEquals(result, { acknowledged: 1, converged: false, recipients: 1 });
    await bus?.close();
  });

  it("keeps overlapping publish acknowledgement subscriptions isolated", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const replicaA: string[] = [];
    const replicaB: string[] = [];
    const busA = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: ACKNOWLEDGEMENT_TEST_TIMEOUT_MS,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: (event) => {
        replicaA.push(event.eventId);
      },
    });
    const busB = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-b",
      acknowledgementTimeoutMs: ACKNOWLEDGEMENT_TEST_TIMEOUT_MS,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: (event) => {
        replicaB.push(event.eventId);
      },
    });

    const [firstResult, secondResult] = await Promise.all([
      busA?.publish(createEvent("event-1")),
      busA?.publish(createEvent("event-2")),
    ]);

    assertEquals(firstResult, { acknowledged: 2, converged: true, recipients: 2 });
    assertEquals(secondResult, { acknowledged: 2, converged: true, recipients: 2 });
    assertEquals(replicaA.sort(), ["event-1", "event-2"]);
    assertEquals(replicaB.sort(), ["event-1", "event-2"]);

    await busA?.close();
    await busB?.close();
  });

  it("ignores forged Redis invalidation events", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const replicaEvents: ProxyRoutingInvalidationEvent[] = [];
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 1,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: 10,
      createClient: redis.createClient,
      integritySecret,
      now: () => TEST_NOW_MS,
      onInvalidate: (event) => {
        replicaEvents.push(event);
      },
    });

    await redis.publishRaw(
      ROUTING_INVALIDATION_CHANNEL,
      await signTestEnvelope(
        ACK_SIGNATURE_DOMAIN,
        JSON.stringify(createEvent()),
        integritySecret,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(replicaEvents, []);
    await bus?.close();
  });

  it("ignores expired Redis invalidation events", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const replicaEvents: ProxyRoutingInvalidationEvent[] = [];
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 1,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: 10,
      createClient: redis.createClient,
      integritySecret,
      now: () => TEST_NOW_MS,
      onInvalidate: (event) => {
        replicaEvents.push(event);
      },
    });

    await redis.publishRaw(
      ROUTING_INVALIDATION_CHANNEL,
      await signTestEnvelope(
        EVENT_SIGNATURE_DOMAIN,
        JSON.stringify(createEvent()),
        integritySecret,
        TEST_NOW_MS - 61_000,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(replicaEvents, []);
    await bus?.close();
  });

  it("ignores forged Redis acknowledgements", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    redis.setOnPublish(async (channel) => {
      if (channel !== ROUTING_INVALIDATION_CHANNEL) return;
      await redis.publishRaw(
        `${ROUTING_INVALIDATION_ACK_PREFIX}event-1`,
        await signTestEnvelope(
          EVENT_SIGNATURE_DOMAIN,
          JSON.stringify({ eventId: "event-1", replicaId: "replica-b" }),
          integritySecret,
        ),
      );
    });
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 1,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: 10,
      createClient: redis.createClient,
      integritySecret,
      now: () => TEST_NOW_MS,
      onInvalidate: () => {
        throw new Error("no legitimate acknowledgement");
      },
    });

    const result = await bus?.publish(createEvent());

    assertEquals(result, { acknowledged: 0, converged: false, recipients: 1 });
    await bus?.close();
  });

  it("ignores expired Redis acknowledgements", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    redis.setOnPublish(async (channel) => {
      if (channel !== ROUTING_INVALIDATION_CHANNEL) return;
      await redis.publishRaw(
        `${ROUTING_INVALIDATION_ACK_PREFIX}event-1`,
        await signTestEnvelope(
          ACK_SIGNATURE_DOMAIN,
          JSON.stringify({ eventId: "event-1", replicaId: "replica-b" }),
          integritySecret,
          TEST_NOW_MS - 61_000,
        ),
      );
    });
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 1,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: 10,
      createClient: redis.createClient,
      integritySecret,
      now: () => TEST_NOW_MS,
      onInvalidate: () => {
        throw new Error("no legitimate acknowledgement");
      },
    });

    const result = await bus?.publish(createEvent());

    assertEquals(result, { acknowledged: 0, converged: false, recipients: 1 });
    await bus?.close();
  });

  it("resolves an in-flight publish without convergence when the bus closes", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const replicaBStarted = deferred();
    const releaseReplicaB = deferred();
    const busA = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: 200,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: () => {},
    });
    const busB = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-b",
      acknowledgementTimeoutMs: 200,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: async () => {
        replicaBStarted.resolve();
        await releaseReplicaB.promise;
      },
    });
    assert(busA);

    const publish = busA.publish(createEvent());
    await replicaBStarted.promise;
    await busA.close();
    releaseReplicaB.resolve();
    const result = await publish;

    assertEquals(result.recipients, 2);
    assertEquals(result.converged, false);
    await busB?.close();
  });

  it("does not count a draining replica that closes before publication", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const replicaB: ProxyRoutingInvalidationEvent[] = [];
    const busA = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: 20,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: () => {},
    });
    const busB = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-b",
      acknowledgementTimeoutMs: 20,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: (event) => {
        replicaB.push(event);
      },
    });

    await busB?.close();
    const result = await busA?.publish(createEvent());

    assertEquals(result, { acknowledged: 1, converged: false, recipients: 1 });
    assertEquals(replicaB, []);
    await busA?.close();
  });

  it("stays disabled without the proxy Redis connection", async () => {
    const redis = createFakeRedisServer();
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "",
      createClient: redis.createClient,
      onInvalidate: () => {},
    });

    assertEquals(bus, null);
    assertEquals(redis.clients.length, 0);
  });

  it("stays disabled without an integrity secret", async () => {
    const redis = createFakeRedisServer();
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      createClient: redis.createClient,
      integritySecret: "",
      onInvalidate: () => {},
    });

    assertEquals(bus, null);
    assertEquals(redis.clients.length, 0);
  });

  it("rejects malformed startup policy before creating clients", async () => {
    const redis = createFakeRedisServer();
    const base = {
      redisUrl: "rediss://example.test:6379",
      createClient: redis.createClient,
      integritySecret: createIntegritySecret(),
      onInvalidate: () => {},
    };

    await assertRejects(
      () =>
        startProxyRoutingInvalidationBus({
          ...base,
          expectedReplicas: 0,
        }),
      RangeError,
      "expected replicas",
    );
    await assertRejects(
      () =>
        startProxyRoutingInvalidationBus({
          ...base,
          acknowledgementTimeoutMs: Number.NaN,
        }),
      RangeError,
      "between 1 and 60000",
    );
    await assertRejects(
      () =>
        startProxyRoutingInvalidationBus({
          ...base,
          replicaId: " replica-a ",
        }),
      TypeError,
      "replica ID",
    );
    await assertRejects(
      () =>
        startProxyRoutingInvalidationBus({
          ...base,
          redisUrl: "https://example.test",
        }),
      TypeError,
      "redis:// or rediss://",
    );
    await assertRejects(
      () =>
        startProxyRoutingInvalidationBus({
          ...base,
          now: () => Number.NaN,
        }),
      TypeError,
      "clock",
    );
    for (
      const integritySecret of [
        "a".repeat(31),
        `${"a".repeat(32)}\n`,
        `${"a".repeat(32)}\u0000`,
        `${"a".repeat(32)}\ud800`,
      ]
    ) {
      await assertRejects(
        () => startProxyRoutingInvalidationBus({ ...base, integritySecret }),
        TypeError,
        "integrity secret",
      );
    }
    assertEquals(redis.clients.length, 0);
  });

  it("destroys a partially constructed client set when later construction fails", async () => {
    let calls = 0;
    let destroyed = 0;
    const firstClient: RoutingInvalidationRedisClient = {
      connect: () => Promise.resolve(),
      publish: () => Promise.resolve(0),
      subscribe: () => Promise.resolve(),
      unsubscribe: () => Promise.resolve(),
      close: () => Promise.resolve(),
      destroy: () => {
        destroyed++;
      },
    };

    await assertRejects(
      () =>
        startProxyRoutingInvalidationBus({
          redisUrl: "rediss://example.test:6379",
          createClient: () => {
            calls++;
            if (calls === 1) return firstClient;
            throw new Error("second client failed");
          },
          integritySecret: createIntegritySecret(),
          onInvalidate: () => {},
        }),
      Error,
      "second client failed",
    );
    assertEquals(destroyed, 1);
  });

  it("rejects a concurrent duplicate event ID and returns frozen results", async () => {
    const redis = createFakeRedisServer();
    const publishStarted = deferred();
    const releasePublish = deferred();
    redis.setOnPublish(async (channel) => {
      if (channel !== ROUTING_INVALIDATION_CHANNEL) return;
      publishStarted.resolve();
      await releasePublish.promise;
    });
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 1,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: ACKNOWLEDGEMENT_TEST_TIMEOUT_MS,
      createClient: redis.createClient,
      integritySecret: createIntegritySecret(),
      onInvalidate: () => {},
    });
    assert(bus);

    const first = bus.publish(createEvent());
    await publishStarted.promise;
    await assertRejects(
      () => bus.publish(createEvent()),
      Error,
      "already publishing",
    );
    releasePublish.resolve();
    const result = await first;

    assertEquals(result, { acknowledged: 1, converged: true, recipients: 1 });
    assertEquals(Object.isFrozen(result), true);
    await bus.close();
  });

  it("returns the same in-flight close promise to every caller", async () => {
    const closeGate = deferred();
    let closeCalls = 0;
    const createClient = (): RoutingInvalidationRedisClient => ({
      connect: () => Promise.resolve(),
      publish: () => Promise.resolve(0),
      subscribe: () => Promise.resolve(),
      unsubscribe: () => Promise.resolve(),
      close: async () => {
        closeCalls++;
        await closeGate.promise;
      },
      destroy: () => {},
    });
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      createClient,
      integritySecret: createIntegritySecret(),
      replicaId: "replica-a",
      onInvalidate: () => {},
    });
    assert(bus);

    const first = bus.close();
    const second = bus.close();
    assert(first === second);
    closeGate.resolve();
    await first;
    assertEquals(closeCalls, 2);
  });

  it("validates events and Redis publish counts at the adapter boundary", async () => {
    const createClient = (): RoutingInvalidationRedisClient => ({
      connect: () => Promise.resolve(),
      publish: () => Promise.resolve(-1),
      subscribe: () => Promise.resolve(),
      unsubscribe: () => Promise.resolve(),
      close: () => Promise.resolve(),
      destroy: () => {},
    });
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      createClient,
      integritySecret: createIntegritySecret(),
      replicaId: "replica-a",
      onInvalidate: () => {},
    });
    assert(bus);

    await assertRejects(
      () => bus.publish(createEvent(" event-1 ")),
      TypeError,
      "event is invalid",
    );
    await assertRejects(
      () => bus.publish(createEvent()),
      TypeError,
      "returned an invalid count",
    );
    await bus.close();
  });

  it("does not let diagnostic logger failures own the bus lifecycle", async () => {
    const redis = createFakeRedisServer();
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "rediss://example.test:6379",
      expectedReplicas: 1,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: ACKNOWLEDGEMENT_TEST_TIMEOUT_MS,
      createClient: redis.createClient,
      integritySecret: createIntegritySecret(),
      logger: {
        info: () => {
          throw new Error("logger failed");
        },
        warn: () => {
          throw new Error("logger failed");
        },
        error: () => {
          throw new Error("logger failed");
        },
      },
      onInvalidate: () => {},
    });
    assert(bus);

    assertEquals(await bus.publish(createEvent()), {
      acknowledged: 1,
      converged: true,
      recipients: 1,
    });
    await bus.close();
  });
});
