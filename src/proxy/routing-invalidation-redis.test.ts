import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
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
const TIMEOUT_NOT_UNDER_TEST_MS = 600_000;

async function settleWithin<T>(promise: Promise<T>, label: string): Promise<T> {
  let outcome:
    | { ok: true; value: T }
    | { error: unknown; ok: false }
    | undefined;
  void promise.then(
    (value) => {
      outcome = { ok: true, value };
    },
    (error) => {
      outcome = { error, ok: false };
    },
  );
  for (let turn = 0; turn < 200 && outcome === undefined; turn++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (outcome === undefined) {
    throw new Error(`${label} did not settle within 200 event-loop turns`);
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

async function waitWithin<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 1_000,
): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} did not settle within ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function createFakeRedisServer() {
  const subscriptions = new Map<RoutingInvalidationRedisClient, Map<string, RedisListener>>();
  const clientEventListeners = new Map<
    RoutingInvalidationRedisClient,
    Map<string, Set<(value?: unknown) => void>>
  >();
  const clients: RoutingInvalidationRedisClient[] = [];
  let onPublish:
    | ((channel: string, message: string) => void | Promise<void>)
    | undefined;

  const deliveredPerChannel = new Map<string, number>();

  const publishRaw = async (channel: string, message: string): Promise<number> => {
    await onPublish?.(channel, message);
    const listeners = [...subscriptions.values()]
      .map((channels) => channels.get(channel))
      .filter((listener): listener is RedisListener => Boolean(listener));
    for (const listener of listeners) {
      queueMicrotask(() => {
        try {
          listener(message, channel);
        } finally {
          deliveredPerChannel.set(channel, (deliveredPerChannel.get(channel) ?? 0) + 1);
        }
      });
    }
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
        clientEventListeners.delete(client);
        return Promise.resolve();
      },
      destroy: () => {
        subscriptions.delete(client);
        clientEventListeners.delete(client);
      },
      on: ((event: string, listener: (value?: unknown) => void) => {
        const listeners = clientEventListeners.get(client) ?? new Map();
        const eventListeners = listeners.get(event) ?? new Set();
        eventListeners.add(listener);
        listeners.set(event, eventListeners);
        clientEventListeners.set(client, listeners);
      }) as NonNullable<RoutingInvalidationRedisClient["on"]>,
    };
    clients.push(client);
    return client;
  };

  return {
    clients,
    createClient,
    /**
     * Number of listener invocations that have already returned for a channel.
     *
     * A subscriber listener is synchronous up to its first suspension point, so
     * an increment here means every synchronous step that listener performs for
     * that message - including dispatching its WebCrypto verification - has
     * already happened.
     */
    deliveredCount(channel: string): number {
      return deliveredPerChannel.get(channel) ?? 0;
    },
    emitClientEvent(clientIndex: number, event: string, value?: unknown) {
      const client = clients[clientIndex];
      if (!client) throw new Error(`Missing Redis client ${clientIndex}`);
      for (const listener of clientEventListeners.get(client)?.get(event) ?? []) {
        listener(value);
      }
    },
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

function deferred(): {
  promise: Promise<void>;
  reject: (error: unknown) => void;
  resolve: () => void;
} {
  let reject!: (error: unknown) => void;
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve, innerReject) => {
    reject = innerReject;
    resolve = innerResolve;
  });
  return { promise, reject, resolve };
}

const SENTINEL_EVENT_ID = "sentinel-event";

async function spinUntil(
  predicate: () => boolean,
  failure: string,
  turns = 200,
): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (predicate()) return;
  throw new Error(`${failure} within ${turns} event-loop turns`);
}

async function settleEventLoop(turns = 5): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Publishes an envelope the bus must reject, then a sentinel it must apply, and
 * returns only once both listener pipelines have finished.
 *
 * A rejected envelope produces no observable signal, so a negative assertion
 * made a few turns after publishing passes even when the guard under test is
 * gone and the event is merely applied later. Waiting for a sentinel is not
 * sufficient on its own either: the fake server queues every listener
 * independently and the production subscriber starts `verifySignedEnvelope`
 * without awaiting it, so the sentinel's WebCrypto verification can settle
 * before the rejected envelope's and prove nothing about it.
 *
 * The two are therefore serialised. `verifySignedEnvelope` reaches
 * `crypto.subtle.verify` before its first suspension, so once the fake server
 * reports the rejected envelope's listener invocation as returned, any
 * verification that envelope triggers is already counted in
 * `pendingVerifications`; draining that counter to zero and settling the queued
 * continuations means the rejected envelope has been fully processed before the
 * sentinel is even published.
 */
async function publishRejectedEnvelopeAndDrain(
  redis: ReturnType<typeof createFakeRedisServer>,
  integritySecret: string,
  observed: ProxyRoutingInvalidationEvent[],
  rejectedEnvelope: string,
): Promise<void> {
  const originalVerify = crypto.subtle.verify.bind(crypto.subtle);
  const originalVerifyDescriptor = Object.getOwnPropertyDescriptor(crypto.subtle, "verify");
  let pendingVerifications = 0;
  Object.defineProperty(crypto.subtle, "verify", {
    configurable: true,
    value: (...args: Parameters<SubtleCrypto["verify"]>) => {
      pendingVerifications++;
      return originalVerify(...args).finally(() => {
        pendingVerifications--;
      });
    },
  });

  try {
    const deliveredBefore = redis.deliveredCount(ROUTING_INVALIDATION_CHANNEL);
    await redis.publishRaw(ROUTING_INVALIDATION_CHANNEL, rejectedEnvelope);
    await spinUntil(
      () => redis.deliveredCount(ROUTING_INVALIDATION_CHANNEL) > deliveredBefore,
      "the rejected envelope was never delivered to the subscriber",
    );
    await spinUntil(
      () => pendingVerifications === 0,
      "the rejected envelope's signature verification never settled",
    );
    await settleEventLoop();

    await redis.publishRaw(
      ROUTING_INVALIDATION_CHANNEL,
      await signTestEnvelope(
        EVENT_SIGNATURE_DOMAIN,
        JSON.stringify(createEvent(SENTINEL_EVENT_ID)),
        integritySecret,
      ),
    );
    await spinUntil(
      () => observed.some((event) => event.eventId === SENTINEL_EVENT_ID),
      "the sentinel invalidation was never applied",
    );
    await spinUntil(
      () => pendingVerifications === 0,
      "the sentinel's signature verification never settled",
    );
    // Let any straggling delivery surface before the caller asserts.
    await settleEventLoop();
  } finally {
    if (originalVerifyDescriptor) {
      Object.defineProperty(crypto.subtle, "verify", originalVerifyDescriptor);
    } else {
      Object.defineProperty(crypto.subtle, "verify", {
        configurable: true,
        value: originalVerify,
      });
    }
  }
}

/**
 * Installs a fake-server publish hook that answers the bus's invalidation
 * event with an acknowledgement the bus must reject, and only lets the event
 * publish complete once that acknowledgement has been fully processed.
 *
 * The production `publish()` starts its `acknowledgementTimeoutMs` timer only
 * after `publishClient.publish` resolves, and the fake server awaits this hook
 * before resolving it. Delivering the rejected acknowledgement here, waiting
 * for its listener invocation to return, draining every WebCrypto verification
 * it started, and settling the queued continuations therefore guarantees that
 * the acknowledgement's fate is decided before the timer is even armed. If the
 * guard under test were removed, `acknowledgedReplicas` would already hold the
 * forged replica when `publish()` checks it, and the result would report
 * `acknowledged: 1` regardless of how long verification took. Without this
 * ordering a slow verification could lose the race against the timeout and let
 * the negative assertion pass vacuously.
 *
 * Returns a restore function the caller must invoke once `publish()` settles.
 */
function answerEventWithRejectedAcknowledgement(
  redis: ReturnType<typeof createFakeRedisServer>,
  buildAcknowledgement: () => Promise<string>,
): { restore: () => void } {
  const originalVerify = crypto.subtle.verify.bind(crypto.subtle);
  const originalVerifyDescriptor = Object.getOwnPropertyDescriptor(crypto.subtle, "verify");
  let pendingVerifications = 0;
  Object.defineProperty(crypto.subtle, "verify", {
    configurable: true,
    value: (...args: Parameters<SubtleCrypto["verify"]>) => {
      pendingVerifications++;
      return originalVerify(...args).finally(() => {
        pendingVerifications--;
      });
    },
  });

  redis.setOnPublish(async (channel) => {
    if (channel !== ROUTING_INVALIDATION_CHANNEL) return;
    const acknowledgementChannel = `${ROUTING_INVALIDATION_ACK_PREFIX}event-1`;
    const deliveredBefore = redis.deliveredCount(acknowledgementChannel);
    await redis.publishRaw(acknowledgementChannel, await buildAcknowledgement());
    await spinUntil(
      () => redis.deliveredCount(acknowledgementChannel) > deliveredBefore,
      "the rejected acknowledgement was never delivered to the publisher",
    );
    await spinUntil(
      () => pendingVerifications === 0,
      "the rejected acknowledgement's signature verification never settled",
    );
    await settleEventLoop();
  });

  return {
    restore() {
      if (originalVerifyDescriptor) {
        Object.defineProperty(crypto.subtle, "verify", originalVerifyDescriptor);
      } else {
        Object.defineProperty(crypto.subtle, "verify", {
          configurable: true,
          value: originalVerify,
        });
      }
    },
  };
}

describe("proxy routing invalidation Redis bus", () => {
  it("warns for a managed socket recycle and reports successful resubscription", async () => {
    const redis = createFakeRedisServer();
    const info: Array<{ message: string; extra?: Record<string, unknown> }> = [];
    const warnings: Array<{ message: string; extra?: Record<string, unknown> }> = [];
    const errors: Array<{ message: string; error?: Error }> = [];
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      replicaId: "replica-a",
      createClient: redis.createClient,
      integritySecret: createIntegritySecret(),
      logger: {
        info: (message, extra) => info.push({ message, extra }),
        warn: (message, extra) => warnings.push({ message, extra }),
        error: (message, error) => errors.push({ message, error }),
      },
      onInvalidate: () => {},
    });

    class SocketClosedUnexpectedlyError extends Error {
      constructor() {
        super("Socket closed unexpectedly");
      }
    }

    redis.emitClientEvent(1, "ready");
    redis.emitClientEvent(1, "error", new SocketClosedUnexpectedlyError());
    redis.emitClientEvent(1, "ready");
    redis.emitClientEvent(0, "ready");
    redis.emitClientEvent(0, "error", new SocketClosedUnexpectedlyError());
    redis.emitClientEvent(0, "ready");
    redis.emitClientEvent(0, "error", new Error("Redis authentication failed"));

    assertEquals(warnings, [
      {
        message: "Proxy routing invalidation Redis socket closed; reconnecting",
        extra: { clientRole: "subscriber" },
      },
      {
        message: "Proxy routing invalidation Redis socket closed; reconnecting",
        extra: { clientRole: "publisher" },
      },
    ]);
    assertEquals(
      info.filter((entry) => entry.message.includes("reconnected")),
      [
        {
          message: "Proxy routing invalidation Redis subscriber reconnected and resubscribed",
          extra: { clientRole: "subscriber" },
        },
        {
          message: "Proxy routing invalidation Redis publisher reconnected",
          extra: { clientRole: "publisher" },
        },
      ],
    );
    assertEquals(errors.map(({ message, error }) => ({ message, error: error?.message })), [{
      message: "Proxy routing invalidation Redis error",
      error: "Redis authentication failed",
    }]);

    await bus?.close();
  });

  it("force-destroys a Redis client whose close rejects at shutdown", async () => {
    const redis = createFakeRedisServer();
    const destroyed: string[] = [];
    const warnings: Array<{ message: string; extra?: Record<string, unknown> }> = [];
    let created = 0;
    const bus = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      replicaId: "replica-a",
      integritySecret: createIntegritySecret(),
      createClient: () => {
        const client = redis.createClient();
        const role = created++ === 0 ? "publisher" : "subscriber";
        return {
          ...client,
          close: () => Promise.reject(new Error("close failed")),
          destroy: () => {
            destroyed.push(role);
            client.destroy();
          },
        };
      },
      logger: {
        info: () => {},
        warn: (message, extra) => warnings.push({ message, extra }),
        error: () => {},
      },
      onInvalidate: () => {},
    });

    await bus?.close();

    assertEquals(
      destroyed.length,
      2,
      "both the publisher and the subscriber must be force-destroyed when close() rejects",
    );
    assertEquals(
      warnings.some((entry) =>
        entry.message.includes("Failed to close routing invalidation Redis client cleanly")
      ),
      true,
      "a failed shutdown close must be reported, not swallowed",
    );
  });

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

  it("counts distinct replicas, not acknowledgement messages", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const duplicateAcknowledgementsVerified = deferred();
    const originalVerify = crypto.subtle.verify.bind(crypto.subtle);
    const originalVerifyDescriptor = Object.getOwnPropertyDescriptor(crypto.subtle, "verify");
    let duplicateAcknowledgementVerifications = 0;
    Object.defineProperty(crypto.subtle, "verify", {
      configurable: true,
      value: async (...args: Parameters<SubtleCrypto["verify"]>) => {
        try {
          const verified = await originalVerify(...args);
          const input = args[3];
          const bytes = input instanceof ArrayBuffer
            ? new Uint8Array(input)
            : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
          if (
            verified &&
            new TextDecoder().decode(bytes).startsWith(`${ACK_SIGNATURE_DOMAIN}\0`)
          ) {
            duplicateAcknowledgementVerifications++;
            if (duplicateAcknowledgementVerifications === 2) {
              duplicateAcknowledgementsVerified.resolve();
            }
          }
          return verified;
        } catch (error) {
          duplicateAcknowledgementsVerified.reject(error);
          throw error;
        }
      },
    });
    // Redis redelivery, or one buggy replica, can repeat an acknowledgement.
    redis.setOnPublish(async (channel) => {
      if (channel !== ROUTING_INVALIDATION_CHANNEL) return;
      const acknowledgement = await signTestEnvelope(
        ACK_SIGNATURE_DOMAIN,
        JSON.stringify({ eventId: "event-1", replicaId: "replica-b" }),
        integritySecret,
      );
      await redis.publishRaw(`${ROUTING_INVALIDATION_ACK_PREFIX}event-1`, acknowledgement);
      await redis.publishRaw(`${ROUTING_INVALIDATION_ACK_PREFIX}event-1`, acknowledgement);
    });
    const busA = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: TIMEOUT_NOT_UNDER_TEST_MS,
      createClient: redis.createClient,
      integritySecret,
      now: () => TEST_NOW_MS,
      onInvalidate: () => {
        throw new Error("replica-a did not apply the event");
      },
    });
    const busB = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-b",
      acknowledgementTimeoutMs: TIMEOUT_NOT_UNDER_TEST_MS,
      createClient: redis.createClient,
      integritySecret,
      now: () => TEST_NOW_MS,
      onInvalidate: () => {
        throw new Error("replica-b did not apply the event");
      },
    });

    try {
      const resultPromise = busA?.publish(createEvent());
      await waitWithin(
        duplicateAcknowledgementsVerified.promise,
        "duplicate acknowledgement verification",
      );
      await busA?.close();
      const result = await resultPromise;

      assertEquals(
        result,
        { acknowledged: 1, converged: false, recipients: 2 },
        "two acknowledgements from one replica must count once",
      );
    } finally {
      if (originalVerifyDescriptor) {
        Object.defineProperty(crypto.subtle, "verify", originalVerifyDescriptor);
      } else {
        Object.defineProperty(crypto.subtle, "verify", {
          configurable: true,
          value: originalVerify,
        });
      }
      await busA?.close();
      await busB?.close();
    }
  });

  it("does not claim convergence when a subscribed replica fails to apply the event", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const busA = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-a",
      acknowledgementTimeoutMs: 100,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: () => {},
    });
    const busB = await startProxyRoutingInvalidationBus({
      redisUrl: "redis://example.test:6379",
      expectedReplicas: 2,
      replicaId: "replica-b",
      acknowledgementTimeoutMs: 100,
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
      acknowledgementTimeoutMs: TIMEOUT_NOT_UNDER_TEST_MS,
      createClient: redis.createClient,
      integritySecret,
      onInvalidate: () => {},
    });
    assert(bus);

    const publish = bus.publish(createEvent());
    try {
      const result = await settleWithin(
        publish,
        "single-recipient invalidation",
      );

      assertEquals(result, { acknowledged: 1, converged: false, recipients: 1 });
    } finally {
      await bus.close();
      await publish.catch(() => undefined);
    }
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

    await publishRejectedEnvelopeAndDrain(
      redis,
      integritySecret,
      replicaEvents,
      await signTestEnvelope(
        ACK_SIGNATURE_DOMAIN,
        JSON.stringify(createEvent()),
        integritySecret,
      ),
    );

    assertEquals(
      replicaEvents.map((event) => event.eventId),
      [SENTINEL_EVENT_ID],
      "an envelope signed for the acknowledgement domain must not be applied",
    );
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

    await publishRejectedEnvelopeAndDrain(
      redis,
      integritySecret,
      replicaEvents,
      await signTestEnvelope(
        EVENT_SIGNATURE_DOMAIN,
        JSON.stringify(createEvent()),
        integritySecret,
        TEST_NOW_MS - 61_000,
      ),
    );

    assertEquals(
      replicaEvents.map((event) => event.eventId),
      [SENTINEL_EVENT_ID],
      "an envelope issued beyond the maximum age must not be applied",
    );
    await bus?.close();
  });

  it("ignores future-dated Redis invalidation events", async () => {
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

    await publishRejectedEnvelopeAndDrain(
      redis,
      integritySecret,
      replicaEvents,
      await signTestEnvelope(
        EVENT_SIGNATURE_DOMAIN,
        JSON.stringify(createEvent()),
        integritySecret,
        TEST_NOW_MS + 6_000,
      ),
    );

    assertEquals(
      replicaEvents.map((event) => event.eventId),
      [SENTINEL_EVENT_ID],
      "an envelope issued beyond the clock-skew allowance must not be applied",
    );
    await bus?.close();
  });

  it("ignores forged Redis acknowledgements", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const acknowledgement = answerEventWithRejectedAcknowledgement(
      redis,
      () =>
        signTestEnvelope(
          EVENT_SIGNATURE_DOMAIN,
          JSON.stringify({ eventId: "event-1", replicaId: "replica-b" }),
          integritySecret,
        ),
    );
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

    try {
      const result = await bus?.publish(createEvent());

      assertEquals(
        result,
        { acknowledged: 0, converged: false, recipients: 1 },
        "an acknowledgement signed under the event domain must not count toward convergence",
      );
    } finally {
      acknowledgement.restore();
      await bus?.close();
    }
  });

  it("ignores expired Redis acknowledgements", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const acknowledgement = answerEventWithRejectedAcknowledgement(
      redis,
      () =>
        signTestEnvelope(
          ACK_SIGNATURE_DOMAIN,
          JSON.stringify({ eventId: "event-1", replicaId: "replica-b" }),
          integritySecret,
          TEST_NOW_MS - 61_000,
        ),
    );
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

    try {
      const result = await bus?.publish(createEvent());

      assertEquals(
        result,
        { acknowledged: 0, converged: false, recipients: 1 },
        "an expired acknowledgement must not count toward convergence",
      );
    } finally {
      acknowledgement.restore();
      await bus?.close();
    }
  });

  it("ignores future-dated Redis acknowledgements", async () => {
    const redis = createFakeRedisServer();
    const integritySecret = createIntegritySecret();
    const acknowledgement = answerEventWithRejectedAcknowledgement(
      redis,
      () =>
        signTestEnvelope(
          ACK_SIGNATURE_DOMAIN,
          JSON.stringify({ eventId: "event-1", replicaId: "replica-b" }),
          integritySecret,
          TEST_NOW_MS + 6_000,
        ),
    );
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

    try {
      const result = await bus?.publish(createEvent());

      assertEquals(
        result,
        { acknowledged: 0, converged: false, recipients: 1 },
        "a future-dated acknowledgement must not count toward convergence",
      );
    } finally {
      acknowledgement.restore();
      await bus?.close();
    }
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
});
