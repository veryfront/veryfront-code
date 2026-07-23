import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type RoutingInvalidationRedisClient,
  startProxyRoutingInvalidationBus,
} from "./routing-invalidation-redis.ts";
import type { ProxyRoutingInvalidationEvent } from "./routing-invalidation.ts";

type RedisListener = (message: string, channel: string) => void;

const ROUTING_INVALIDATION_CHANNEL = "vf-proxy-routing-invalidations-v1";
const ROUTING_INVALIDATION_ACK_PREFIX = `${ROUTING_INVALIDATION_CHANNEL}:ack:`;
const EVENT_SIGNATURE_DOMAIN = "vf-proxy-routing-invalidation:event:v1";
const ACK_SIGNATURE_DOMAIN = "vf-proxy-routing-invalidation:ack:v1";
const TEST_NOW_MS = 1_800_000_000_000;

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
        return Promise.resolve(1);
      },
      unsubscribe: (channel) => {
        subscriptions.get(client)?.delete(channel);
        return Promise.resolve(0);
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

function makeSignatureNonCanonical(envelope: string): string {
  const parsed = JSON.parse(envelope) as { signature: string };
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const lastIndex = alphabet.indexOf(parsed.signature.at(-1) ?? "");
  if (lastIndex < 0 || lastIndex % 4 !== 0) throw new Error("Unexpected test signature");
  parsed.signature = `${parsed.signature.slice(0, -1)}${alphabet[lastIndex + 1]}`;
  return JSON.stringify(parsed);
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
      redisUrl: "redis://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: 100,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: (event) => {
        replicaA.push(event);
      },
    });
    const busB = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-b",
      acknowledgementTimeoutMs: 100,
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
      redisUrl: "redis://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: 10,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: () => {},
    });
    const busB = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-b",
      acknowledgementTimeoutMs: 10,
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
      redisUrl: "redis://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: 20,
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
      redisUrl: "redis://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: 100,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: (event) => {
        replicaA.push(event.eventId);
      },
    });
    const busB = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-b",
      acknowledgementTimeoutMs: 100,
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
      redisUrl: "redis://example.test:6379",
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
      redisUrl: "redis://example.test:6379",
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

  it("ignores non-canonical HMAC encodings", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const replicaEvents: ProxyRoutingInvalidationEvent[] = [];
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      replicaId: "replica-a",
      createClient: redis.createClient,
      integritySecret,
      now: () => TEST_NOW_MS,
      onInvalidate: (event) => {
        replicaEvents.push(event);
      },
    });

    const envelope = await signTestEnvelope(
      EVENT_SIGNATURE_DOMAIN,
      JSON.stringify(createEvent()),
      integritySecret,
    );
    await redis.publishRaw(ROUTING_INVALIDATION_CHANNEL, makeSignatureNonCanonical(envelope));
    await new Promise((resolve) => setTimeout(resolve, 10));

    assertEquals(replicaEvents, []);
    await bus?.close();
  });

  it("rejects envelopes when the local clock is invalid", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const replicaEvents: ProxyRoutingInvalidationEvent[] = [];
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      replicaId: "replica-a",
      createClient: redis.createClient,
      integritySecret,
      now: () => Number.NaN,
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
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

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
      redisUrl: "redis://example.test:6379",
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
      redisUrl: "redis://example.test:6379",
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
      redisUrl: "redis://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: 200,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: () => {},
    });
    const busB = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
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
      redisUrl: "redis://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: 20,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: () => {},
    });
    const busB = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
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
      redisUrl: "redis://example.test:6379",
      createClient: redis.createClient,
      integritySecret: "",
      onInvalidate: () => {},
    });

    assertEquals(bus, null);
    assertEquals(redis.clients.length, 0);
  });

  it("stays disabled when the integrity secret is too short", async () => {
    const redis = createFakeRedisServer();
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      createClient: redis.createClient,
      integritySecret: "too-short",
      onInvalidate: () => {},
    });

    try {
      assertEquals(bus, null);
      assertEquals(redis.clients.length, 0);
    } finally {
      await bus?.close();
    }
  });

  it("destroys a partially created client when the second client fails", async () => {
    let createCalls = 0;
    let destroyed = 0;
    const firstClient: RoutingInvalidationRedisClient = {
      connect: () => Promise.resolve(),
      publish: () => Promise.resolve(0),
      subscribe: () => Promise.resolve(0),
      unsubscribe: () => Promise.resolve(0),
      close: () => Promise.resolve(),
      destroy: () => {
        destroyed++;
      },
    };

    await assertRejects(() =>
      startProxyRoutingInvalidationBus({
        redisUrl: "redis://example.test:6379",
        integritySecret: createIntegritySecret(),
        createClient: () => {
          createCalls++;
          if (createCalls === 1) return firstClient;
          throw new Error("second client failed");
        },
        onInvalidate: () => {},
      })
    );
    assertEquals(destroyed, 1);
  });

  it("does not acknowledge a conflicting replay that reuses an event identifier", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const invalidated: ProxyRoutingInvalidationEvent[] = [];
    let acknowledgements = 0;
    redis.setOnPublish((channel) => {
      if (channel.startsWith(ROUTING_INVALIDATION_ACK_PREFIX)) acknowledgements++;
    });
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      replicaId: "replica-a",
      createClient: redis.createClient,
      integritySecret,
      now: () => TEST_NOW_MS,
      onInvalidate: (event) => {
        invalidated.push(event);
      },
    });

    try {
      const original = createEvent("event-conflict");
      const conflicting = { ...original, releaseId: "release-conflict" };
      await redis.publishRaw(
        ROUTING_INVALIDATION_CHANNEL,
        await signTestEnvelope(EVENT_SIGNATURE_DOMAIN, JSON.stringify(original), integritySecret),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      await redis.publishRaw(
        ROUTING_INVALIDATION_CHANNEL,
        await signTestEnvelope(
          EVENT_SIGNATURE_DOMAIN,
          JSON.stringify(conflicting),
          integritySecret,
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));

      assertEquals(invalidated, [original]);
      assertEquals(acknowledgements, 1);
    } finally {
      await bus?.close();
    }
  });

  it("rejects outbound events with unsafe identifiers", async () => {
    const redis = createFakeRedisServer();
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      replicaId: "replica-a",
      createClient: redis.createClient,
      integritySecret: createIntegritySecret(),
      acknowledgementTimeoutMs: 5,
      onInvalidate: () => {},
    });
    assert(bus);

    try {
      await assertRejects(
        () => bus.publish(createEvent("x".repeat(257))),
        Error,
        "Invalid proxy routing invalidation event",
      );
    } finally {
      await bus.close();
    }
  });

  it("bounds Redis client close and destroys clients that do not close", async () => {
    let destroyed = 0;
    const createClient = (): RoutingInvalidationRedisClient => ({
      connect: () => Promise.resolve(),
      publish: () => Promise.resolve(0),
      subscribe: () => Promise.resolve(1),
      unsubscribe: () => Promise.resolve(0),
      close: () => new Promise<void>(() => {}),
      destroy: () => {
        destroyed++;
      },
    });
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      createClient,
      integritySecret: createIntegritySecret(),
      operationTimeoutMs: 5,
      onInvalidate: () => {},
    });
    assert(bus);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let closed: boolean;
    try {
      closed = await Promise.race([
        bus.close().then(() => true),
        new Promise<false>((resolve) => {
          timeoutId = setTimeout(() => resolve(false), 50);
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
    assertEquals(closed, true);
    assertEquals(destroyed, 2);
  });

  it("bounds Redis publication when the client never settles", async () => {
    const redis = createFakeRedisServer();
    redis.setOnPublish((channel) => {
      if (channel === ROUTING_INVALIDATION_CHANNEL) return new Promise<void>(() => {});
    });
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      replicaId: "replica-a",
      createClient: redis.createClient,
      integritySecret: createIntegritySecret(),
      operationTimeoutMs: 5,
      onInvalidate: () => {},
    });
    assert(bus);

    try {
      await assertRejects(
        () => bus.publish(createEvent()),
        Error,
        "event publish timed out",
      );
    } finally {
      await bus.close();
    }
  });

  it("makes concurrent close calls wait for the same cleanup", async () => {
    const releaseClose = deferred();
    const bothClientsClosing = deferred();
    let closeCalls = 0;
    const createClient = (): RoutingInvalidationRedisClient => ({
      connect: () => Promise.resolve(),
      publish: () => Promise.resolve(0),
      subscribe: () => Promise.resolve(1),
      unsubscribe: () => Promise.resolve(0),
      close: async () => {
        closeCalls++;
        if (closeCalls === 2) bothClientsClosing.resolve();
        await releaseClose.promise;
      },
      destroy: () => {},
    });
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      createClient,
      integritySecret: createIntegritySecret(),
      operationTimeoutMs: 100,
      onInvalidate: () => {},
    });
    assert(bus);

    const firstClose = bus.close();
    let secondResolved = false;
    const secondClose = bus.close().then(() => {
      secondResolved = true;
    });
    await bothClientsClosing.promise;
    assertEquals(secondResolved, false);
    releaseClose.resolve();
    await Promise.all([firstClose, secondClose]);
    assertEquals(closeCalls, 2);
  });
});
