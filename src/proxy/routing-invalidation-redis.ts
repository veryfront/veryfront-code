import { getRedisModule } from "#veryfront/platform/adapters/redis/modules.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import type {
  ProxyRoutingInvalidationEvent,
  ProxyRoutingInvalidationPublisher,
  ProxyRoutingInvalidationPublishResult,
} from "./routing-invalidation.ts";

const ROUTING_INVALIDATION_CHANNEL = "vf-proxy-routing-invalidations-v1";
const ROUTING_INVALIDATION_ACK_PREFIX = `${ROUTING_INVALIDATION_CHANNEL}:ack:`;
const DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS = 1_500;
const DEFAULT_CONNECT_TIMEOUT_MS = 3_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 3_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECENT_EVENT_IDS = 1_000;
const MAX_IN_FLIGHT_EVENTS = 1_000;
const MAX_IN_FLIGHT_PUBLISHES = 1_000;
const MAX_SIGNED_ENVELOPE_BYTES = 24 * 1024;
const MAX_SIGNED_PAYLOAD_BYTES = 16 * 1024;
const MAX_ROUTING_FIELD_BYTES = 256;
const MIN_INTEGRITY_SECRET_BYTES = 32;
const MAX_EXPECTED_REPLICAS = 10_000;
const MAX_ACKNOWLEDGEMENT_TIMEOUT_MS = 60_000;
const MAX_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ENVELOPE_AGE_MS = 60_000;
const DEFAULT_MAX_ENVELOPE_FUTURE_MS = 5_000;
const INTEGRITY_SECRET_ENV_VAR = "VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET";
const EVENT_SIGNATURE_DOMAIN = "vf-proxy-routing-invalidation:event:v1";
const ACK_SIGNATURE_DOMAIN = "vf-proxy-routing-invalidation:ack:v1";

/** Receives a message from a subscribed Redis channel. */
export type RedisListener = (message: string, channel: string) => void;
type SignatureDomain = "event" | "ack";

/** Redis operations required by the routing invalidation bus. */
export interface RoutingInvalidationRedisClient {
  /** Opens the Redis connection. */
  connect(): Promise<void>;
  /** Publishes a message and returns the number of subscribed recipients. */
  publish(channel: string, message: string): Promise<number>;
  /** Subscribes to a channel. */
  subscribe(channel: string, listener: RedisListener): Promise<number>;
  /** Removes the subscription for a channel. */
  unsubscribe(channel: string): Promise<number>;
  /** Closes the connection gracefully. */
  close(): Promise<void>;
  /** Destroys the connection when graceful close cannot finish. */
  destroy(): void;
  /** Registers an optional Redis client error listener. */
  on?(event: "error", listener: (error: unknown) => void): unknown;
}

/** Logger surface used by the routing invalidation bus. */
export interface RoutingInvalidationLogger {
  /** Records normal lifecycle information. */
  info(message: string, extra?: Record<string, unknown>): void;
  /** Records a recoverable failure. */
  warn(message: string, extra?: Record<string, unknown>): void;
  /** Records an operation failure. */
  error(message: string, error?: Error, extra?: Record<string, unknown>): void;
}

/** Connected publisher and lifecycle handle for routing invalidations. */
export interface ProxyRoutingInvalidationBus extends ProxyRoutingInvalidationPublisher {
  /** Stops subscriptions and closes both Redis clients. */
  close(): Promise<void>;
}

/** Configuration and dependencies used to start a routing invalidation bus. */
export interface StartProxyRoutingInvalidationBusOptions {
  /** Maximum time to wait for acknowledgements from subscribed replicas. */
  acknowledgementTimeoutMs?: number;
  /** Creates a Redis client for the configured connection. */
  createClient?: (
    redisUrl: string,
  ) => RoutingInvalidationRedisClient | Promise<RoutingInvalidationRedisClient>;
  /** Minimum number of subscribed replicas required for convergence. */
  expectedReplicas?: number;
  /** Supplies the current Unix time in milliseconds. */
  now?: () => number;
  /** Receives sanitized bus lifecycle and failure logs. */
  logger?: RoutingInvalidationLogger;
  /** Maximum time for one Redis connection, command, or close operation. */
  operationTimeoutMs?: number;
  /** Applies one validated event to the local routing state. */
  onInvalidate: (event: ProxyRoutingInvalidationEvent) => unknown | Promise<unknown>;
  /** Secret used to authenticate Redis events and acknowledgements. */
  integritySecret?: string;
  /** Redis connection URL. An empty value disables the bus. */
  redisUrl?: string;
  /** Stable identifier used in this replica's acknowledgements. */
  replicaId?: string;
}

interface RoutingInvalidationAcknowledgement {
  eventId: string;
  replicaId: string;
}

interface SignedRoutingInvalidationEnvelope {
  version: 1;
  issuedAtMs: number;
  payload: string;
  signature: string;
}

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function encodedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function validRoutingField(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    !hasControlCharacter(value) &&
    encodedByteLength(value) <= MAX_ROUTING_FIELD_BYTES;
}

function validRedisUrl(value: string): boolean {
  if (value !== value.trim()) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "redis:" || url.protocol === "rediss:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const promise = Promise.resolve().then(operation);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function parseSignedEnvelope(message: string): SignedRoutingInvalidationEnvelope | null {
  if (encodedByteLength(message) > MAX_SIGNED_ENVELOPE_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const envelope = parsed as Record<string, unknown>;
  if (
    envelope.version !== 1 ||
    typeof envelope.issuedAtMs !== "number" ||
    !Number.isSafeInteger(envelope.issuedAtMs) ||
    envelope.issuedAtMs <= 0 ||
    typeof envelope.payload !== "string" ||
    encodedByteLength(envelope.payload) > MAX_SIGNED_PAYLOAD_BYTES ||
    typeof envelope.signature !== "string" ||
    envelope.signature.length < 32 ||
    envelope.signature.length > 128
  ) {
    return null;
  }
  return envelope as unknown as SignedRoutingInvalidationEnvelope;
}

function signatureDomainPrefix(domain: SignatureDomain): string {
  return domain === "event" ? EVENT_SIGNATURE_DOMAIN : ACK_SIGNATURE_DOMAIN;
}

function signatureInput(domain: SignatureDomain, issuedAtMs: number, payload: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(
    `${signatureDomainPrefix(domain)}\0${issuedAtMs}\0${payload}`,
  );
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}

function base64UrlEncode(bytes: ArrayBuffer): string {
  const binary = Array.from(new Uint8Array(bytes), (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): ArrayBuffer | null {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return null;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  try {
    const decoded = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    if (decoded.byteLength !== 32 || base64UrlEncode(decoded.buffer) !== value) return null;
    return decoded.buffer;
  } catch {
    return null;
  }
}

async function createHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signPayload(
  key: CryptoKey,
  domain: SignatureDomain,
  issuedAtMs: number,
  payload: string,
): Promise<string> {
  return base64UrlEncode(
    await crypto.subtle.sign("HMAC", key, signatureInput(domain, issuedAtMs, payload)),
  );
}

async function verifyPayloadSignature(
  key: CryptoKey,
  domain: SignatureDomain,
  issuedAtMs: number,
  payload: string,
  signature: string,
): Promise<boolean> {
  const signatureBytes = base64UrlDecode(signature);
  if (!signatureBytes) return false;
  return await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    signatureInput(domain, issuedAtMs, payload),
  );
}

async function serializeSignedEnvelope(
  key: CryptoKey,
  domain: SignatureDomain,
  payload: string,
  now: () => number,
): Promise<string> {
  if (encodedByteLength(payload) > MAX_SIGNED_PAYLOAD_BYTES) {
    throw new Error("Proxy routing invalidation payload is too large");
  }
  const issuedAtMs = Math.trunc(now());
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0) {
    throw new Error("Proxy routing invalidation clock returned an invalid timestamp");
  }
  return JSON.stringify(
    {
      version: 1,
      issuedAtMs,
      payload,
      signature: await signPayload(key, domain, issuedAtMs, payload),
    } satisfies SignedRoutingInvalidationEnvelope,
  );
}

async function verifySignedEnvelope(
  key: CryptoKey,
  domain: SignatureDomain,
  message: string,
  now: () => number,
): Promise<string | null> {
  const envelope = parseSignedEnvelope(message);
  if (!envelope) return null;
  const currentTimeMs = now();
  if (!Number.isSafeInteger(currentTimeMs) || currentTimeMs <= 0) return null;
  if (
    envelope.issuedAtMs < currentTimeMs - DEFAULT_MAX_ENVELOPE_AGE_MS ||
    envelope.issuedAtMs > currentTimeMs + DEFAULT_MAX_ENVELOPE_FUTURE_MS
  ) {
    return null;
  }
  const verified = await verifyPayloadSignature(
    key,
    domain,
    envelope.issuedAtMs,
    envelope.payload,
    envelope.signature,
  );
  return verified ? envelope.payload : null;
}

function parseEvent(message: string): ProxyRoutingInvalidationEvent | null {
  if (encodedByteLength(message) > MAX_SIGNED_PAYLOAD_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const event = parsed as Record<string, unknown>;
  if (
    event.version !== 1 ||
    !validRoutingField(event.eventId) ||
    !validRoutingField(event.projectId) ||
    !validRoutingField(event.projectSlug) ||
    !validRoutingField(event.deploymentId) ||
    !validRoutingField(event.environmentId) ||
    !validRoutingField(event.environmentName) ||
    !validRoutingField(event.releaseId)
  ) {
    return null;
  }
  return {
    version: 1,
    eventId: event.eventId,
    projectId: event.projectId,
    projectSlug: event.projectSlug,
    deploymentId: event.deploymentId,
    environmentId: event.environmentId,
    environmentName: event.environmentName,
    releaseId: event.releaseId,
  };
}

function parseAcknowledgement(message: string): RoutingInvalidationAcknowledgement | null {
  if (encodedByteLength(message) > MAX_SIGNED_PAYLOAD_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const acknowledgement = parsed as Record<string, unknown>;
  if (
    !validRoutingField(acknowledgement.eventId) ||
    !validRoutingField(acknowledgement.replicaId)
  ) {
    return null;
  }
  return {
    eventId: acknowledgement.eventId,
    replicaId: acknowledgement.replicaId,
  };
}

async function createDefaultClient(redisUrl: string): Promise<RoutingInvalidationRedisClient> {
  const { NodeRedis } = await getRedisModule();
  if (!NodeRedis) throw new Error("Redis client module is unavailable");

  const createClient = NodeRedis.createClient as unknown as (options: {
    url: string;
    socket: {
      connectTimeout: number;
      reconnectStrategy: (retries: number) => number | Error;
    };
  }) => RoutingInvalidationRedisClient;

  return createClient({
    url: redisUrl,
    socket: {
      connectTimeout: DEFAULT_CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) =>
        retries >= MAX_RECONNECT_ATTEMPTS
          ? new Error("Routing invalidation Redis reconnect limit reached")
          : Math.min(100 * 2 ** retries, 1_000),
    },
  });
}

async function closeClient(
  client: RoutingInvalidationRedisClient,
  operationTimeoutMs: number,
  logger?: RoutingInvalidationLogger,
): Promise<void> {
  try {
    await withTimeout(
      () => client.close(),
      operationTimeoutMs,
      "Routing invalidation Redis client close timed out",
    );
  } catch {
    try {
      client.destroy();
    } catch {
      // The client already failed to close. Cleanup errors cannot recover it.
    }
    logger?.warn("Failed to close routing invalidation Redis client cleanly");
  }
}

/** Starts an authenticated Redis fan-out bus, or returns null when disabled. */
export async function startProxyRoutingInvalidationBus(
  options: StartProxyRoutingInvalidationBusOptions,
): Promise<ProxyRoutingInvalidationBus | null> {
  const redisUrl = options.redisUrl === undefined ? getEnv("REDIS_URL") : options.redisUrl;
  if (!redisUrl) return null;
  if (!validRedisUrl(redisUrl)) throw new Error("Invalid routing invalidation Redis URL");
  const integritySecret = options.integritySecret ?? getEnv(INTEGRITY_SECRET_ENV_VAR) ?? "";
  if (encodedByteLength(integritySecret) < MIN_INTEGRITY_SECRET_BYTES) return null;

  const expectedReplicas = positiveInteger(
    options.expectedReplicas ?? getEnv("VERYFRONT_PROXY_EXPECTED_REPLICAS"),
    1,
    MAX_EXPECTED_REPLICAS,
  );
  const acknowledgementTimeoutMs = positiveInteger(
    options.acknowledgementTimeoutMs,
    DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS,
    MAX_ACKNOWLEDGEMENT_TIMEOUT_MS,
  );
  const operationTimeoutMs = positiveInteger(
    options.operationTimeoutMs,
    DEFAULT_OPERATION_TIMEOUT_MS,
    MAX_OPERATION_TIMEOUT_MS,
  );
  const replicaId = options.replicaId ?? getEnv("HOSTNAME") ?? crypto.randomUUID();
  if (!validRoutingField(replicaId)) {
    throw new Error("Invalid proxy routing invalidation replica identifier");
  }
  const createClient = options.createClient ?? createDefaultClient;
  const hmacKey = await createHmacKey(integritySecret);
  const now = options.now ?? (() => Date.now());

  let publishClient: RoutingInvalidationRedisClient | undefined;
  let subscribeClient: RoutingInvalidationRedisClient | undefined;
  const destroyClient = (client: RoutingInvalidationRedisClient | undefined): void => {
    try {
      client?.destroy();
    } catch {
      // Startup has already failed. Cleanup errors cannot recover the client.
    }
  };
  try {
    publishClient = await createClient(redisUrl);
    subscribeClient = await createClient(redisUrl);
  } catch (error) {
    destroyClient(publishClient);
    destroyClient(subscribeClient);
    throw error;
  }

  if (!publishClient || !subscribeClient) {
    destroyClient(publishClient);
    destroyClient(subscribeClient);
    throw new Error("Routing invalidation Redis client factory returned no client");
  }
  const publisher = publishClient;
  const subscriber = subscribeClient;
  const processedEvents = new Map<string, string>();
  const eventProcessing = new Map<
    string,
    { identity: string; promise: Promise<boolean> }
  >();
  interface AcknowledgementSubscription {
    listeners: Set<RedisListener>;
    ready: Promise<void>;
  }
  const acknowledgementSubscriptions = new Map<string, AcknowledgementSubscription>();
  const activeAcknowledgementChannels = new Set<string>();
  let resolveClosed!: () => void;
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  let closed = false;
  let activePublishes = 0;
  let closePromise: Promise<void> | undefined;
  const waitForClose = (): Promise<void> => {
    return closed ? Promise.resolve() : closedPromise;
  };

  const subscribeAcknowledgement = async (
    channel: string,
    listener: RedisListener,
  ): Promise<void> => {
    let subscription = acknowledgementSubscriptions.get(channel);
    if (!subscription) {
      subscription = {
        listeners: new Set(),
        ready: Promise.resolve(),
      };
      const currentSubscription = subscription;
      acknowledgementSubscriptions.set(channel, currentSubscription);
      currentSubscription.ready = withTimeout(
        () =>
          subscriber.subscribe(channel, (message, receivedChannel) => {
            if (receivedChannel !== channel) return;
            for (const acknowledgementListener of currentSubscription.listeners) {
              acknowledgementListener(message, receivedChannel);
            }
          }),
        operationTimeoutMs,
        "Routing invalidation Redis acknowledgement subscription timed out",
      ).then(() => {
        activeAcknowledgementChannels.add(channel);
      }).catch((error) => {
        activeAcknowledgementChannels.add(channel);
        throw error;
      });
    }
    subscription.listeners.add(listener);
    try {
      await subscription.ready;
    } catch (error) {
      subscription.listeners.delete(listener);
      try {
        await withTimeout(
          () => subscriber.unsubscribe(channel),
          operationTimeoutMs,
          "Routing invalidation Redis failed-subscription cleanup timed out",
        );
      } catch {
        // Closing the subscriber remains the final cleanup boundary.
      }
      if (acknowledgementSubscriptions.get(channel) === subscription) {
        acknowledgementSubscriptions.delete(channel);
      }
      activeAcknowledgementChannels.delete(channel);
      throw error;
    }
    if (closed) {
      subscription.listeners.delete(listener);
      throw new Error("Proxy routing invalidation bus is closed");
    }
  };

  const unsubscribeAcknowledgement = async (
    channel: string,
    listener: RedisListener,
  ): Promise<void> => {
    const subscription = acknowledgementSubscriptions.get(channel);
    if (!subscription) return;
    subscription.listeners.delete(listener);
    if (subscription.listeners.size > 0 || closed) return;
    try {
      await withTimeout(
        () => subscriber.unsubscribe(channel),
        operationTimeoutMs,
        "Routing invalidation Redis acknowledgement unsubscribe timed out",
      );
      acknowledgementSubscriptions.delete(channel);
      activeAcknowledgementChannels.delete(channel);
    } catch {
      options.logger?.warn("Failed to unsubscribe routing invalidation acknowledgement channel");
    }
  };

  const rememberProcessedEvent = (eventId: string, identity: string) => {
    processedEvents.delete(eventId);
    processedEvents.set(eventId, identity);
    while (processedEvents.size > MAX_RECENT_EVENT_IDS) {
      const oldestEventId = processedEvents.keys().next().value;
      if (!oldestEventId) break;
      processedEvents.delete(oldestEventId);
    }
  };

  const processEvent = (event: ProxyRoutingInvalidationEvent): Promise<boolean> => {
    const identity = JSON.stringify(event);
    const processedIdentity = processedEvents.get(event.eventId);
    if (processedIdentity !== undefined) return Promise.resolve(processedIdentity === identity);

    const existing = eventProcessing.get(event.eventId);
    if (existing) {
      return existing.identity === identity ? existing.promise : Promise.resolve(false);
    }
    if (eventProcessing.size >= MAX_IN_FLIGHT_EVENTS) {
      options.logger?.warn("Proxy routing invalidation processing limit reached");
      return Promise.resolve(false);
    }

    const processing = Promise.resolve()
      .then(() => options.onInvalidate(event))
      .then(() => {
        rememberProcessedEvent(event.eventId, identity);
        return true;
      })
      .finally(() => {
        if (eventProcessing.get(event.eventId)?.promise === processing) {
          eventProcessing.delete(event.eventId);
        }
      });
    eventProcessing.set(event.eventId, { identity, promise: processing });
    return processing;
  };

  const logRedisError = (_error: unknown) => {
    options.logger?.error(
      "Proxy routing invalidation Redis error",
      new Error("Redis client operation failed"),
    );
  };
  publisher.on?.("error", logRedisError);
  subscriber.on?.("error", logRedisError);

  try {
    await Promise.all([
      withTimeout(
        () => publisher.connect(),
        operationTimeoutMs,
        "Routing invalidation Redis publisher connection timed out",
      ),
      withTimeout(
        () => subscriber.connect(),
        operationTimeoutMs,
        "Routing invalidation Redis subscriber connection timed out",
      ),
    ]);
    await withTimeout(
      () =>
        subscriber.subscribe(ROUTING_INVALIDATION_CHANNEL, (message, channel) => {
          if (channel !== ROUTING_INVALIDATION_CHANNEL) return;
          void verifySignedEnvelope(hmacKey, "event", message, now)
            .then((payload) => {
              if (!payload || closed) return null;
              const event = parseEvent(payload);
              if (!event) return null;
              return processEvent(event).then(async (accepted) => {
                if (!accepted || closed) return;
                const acknowledgementPayload = JSON.stringify({
                  eventId: event.eventId,
                  replicaId,
                });
                await withTimeout(
                  async () =>
                    await publisher.publish(
                      `${ROUTING_INVALIDATION_ACK_PREFIX}${event.eventId}`,
                      await serializeSignedEnvelope(hmacKey, "ack", acknowledgementPayload, now),
                    ),
                  operationTimeoutMs,
                  "Routing invalidation Redis acknowledgement publish timed out",
                );
              });
            })
            .catch((_error) => {
              options.logger?.error(
                "Failed to apply proxy routing invalidation",
                new Error("Routing invalidation callback failed"),
              );
            });
        }),
      operationTimeoutMs,
      "Routing invalidation Redis event subscription timed out",
    );
  } catch (error) {
    destroyClient(publisher);
    destroyClient(subscriber);
    throw error;
  }

  options.logger?.info("Proxy routing invalidation bus connected", {
    expectedReplicas,
  });

  return {
    async publish(event): Promise<ProxyRoutingInvalidationPublishResult> {
      if (closed) throw new Error("Proxy routing invalidation bus is closed");
      let normalizedEvent: ProxyRoutingInvalidationEvent | null = null;
      try {
        normalizedEvent = parseEvent(JSON.stringify(event));
      } catch {
        // The validation error below is stable even for hostile property accessors.
      }
      if (!normalizedEvent) throw new Error("Invalid proxy routing invalidation event");
      const validEvent = normalizedEvent;
      if (activePublishes >= MAX_IN_FLIGHT_PUBLISHES) {
        throw new Error("Proxy routing invalidation publish limit reached");
      }
      activePublishes++;

      const acknowledgementChannel = `${ROUTING_INVALIDATION_ACK_PREFIX}${validEvent.eventId}`;
      const acknowledgedReplicas = new Set<string>();
      let recipients = 0;
      let resolveAcknowledged: (() => void) | undefined;
      const acknowledgementReceived = new Promise<void>((resolve) => {
        resolveAcknowledged = resolve;
      });

      const acknowledgementListener: RedisListener = (message, channel) => {
        if (channel !== acknowledgementChannel) return;
        void verifySignedEnvelope(hmacKey, "ack", message, now)
          .then((payload) => {
            if (!payload) return;
            const acknowledgement = parseAcknowledgement(payload);
            if (!acknowledgement || acknowledgement.eventId !== validEvent.eventId) return;
            acknowledgedReplicas.add(acknowledgement.replicaId);
            if (recipients > 0 && acknowledgedReplicas.size >= recipients) {
              resolveAcknowledged?.();
            }
          })
          .catch((_error) => {
            options.logger?.error(
              "Failed to verify proxy routing invalidation acknowledgement",
              new Error("Routing invalidation acknowledgement verification failed"),
            );
          });
      };

      let subscribed = false;
      try {
        await subscribeAcknowledgement(acknowledgementChannel, acknowledgementListener);
        subscribed = true;
        const eventPayload = JSON.stringify(validEvent);
        try {
          const publishedRecipients = await withTimeout(
            async () =>
              await publisher.publish(
                ROUTING_INVALIDATION_CHANNEL,
                await serializeSignedEnvelope(hmacKey, "event", eventPayload, now),
              ),
            operationTimeoutMs,
            "Routing invalidation Redis event publish timed out",
          );
          if (!Number.isSafeInteger(publishedRecipients) || publishedRecipients < 0) {
            throw new Error("Routing invalidation Redis returned an invalid recipient count");
          }
          recipients = publishedRecipients;
        } catch (error) {
          if (!closed) throw error;
          return {
            acknowledged: Math.min(acknowledgedReplicas.size, recipients),
            converged: false,
            recipients,
          };
        }
        if (recipients > 0 && acknowledgedReplicas.size >= recipients) resolveAcknowledged?.();

        if (recipients > 0) {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            acknowledgementReceived,
            waitForClose(),
            new Promise<void>((resolve) => {
              timeout = setTimeout(resolve, acknowledgementTimeoutMs);
            }),
          ]);
          if (timeout !== undefined) clearTimeout(timeout);
        }

        const acknowledged = Math.min(acknowledgedReplicas.size, recipients);
        return {
          acknowledged,
          converged: recipients >= expectedReplicas && acknowledged >= recipients,
          recipients,
        };
      } finally {
        try {
          if (subscribed) {
            await unsubscribeAcknowledgement(acknowledgementChannel, acknowledgementListener);
          }
        } finally {
          activePublishes--;
        }
      }
    },

    async close() {
      if (closePromise) return await closePromise;
      closed = true;
      resolveClosed();
      closePromise = (async () => {
        const inFlightProcessing = [...eventProcessing.values()].map(({ promise }) => promise);
        if (inFlightProcessing.length > 0) {
          try {
            await withTimeout(
              () => Promise.allSettled(inFlightProcessing).then(() => undefined),
              operationTimeoutMs,
              "Routing invalidation processing shutdown timed out",
            );
          } catch (error) {
            options.logger?.warn("Routing invalidation processing did not finish before close", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        await Promise.allSettled(
          [...acknowledgementSubscriptions.values()].map(({ ready }) => ready),
        );
        await Promise.allSettled([
          withTimeout(
            () => subscriber.unsubscribe(ROUTING_INVALIDATION_CHANNEL),
            operationTimeoutMs,
            "Routing invalidation Redis event unsubscribe timed out",
          ),
          ...[...activeAcknowledgementChannels].map((channel) =>
            withTimeout(
              () => subscriber.unsubscribe(channel),
              operationTimeoutMs,
              "Routing invalidation Redis acknowledgement unsubscribe timed out",
            )
          ),
        ]);
        acknowledgementSubscriptions.clear();
        activeAcknowledgementChannels.clear();
        await Promise.all([
          closeClient(publisher, operationTimeoutMs, options.logger),
          closeClient(subscriber, operationTimeoutMs, options.logger),
        ]);
      })();
      return await closePromise;
    },
  };
}
