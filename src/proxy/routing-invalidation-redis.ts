import { getRedisModule } from "#veryfront/platform/adapters/redis/modules.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { base64urlEncodeBytes } from "#veryfront/utils";
import type {
  ProxyRoutingInvalidationEvent,
  ProxyRoutingInvalidationPublisher,
  ProxyRoutingInvalidationPublishResult,
} from "./routing-invalidation.ts";

const ROUTING_INVALIDATION_CHANNEL = "vf-proxy-routing-invalidations-v1";
const ROUTING_INVALIDATION_ACK_PREFIX = `${ROUTING_INVALIDATION_CHANNEL}:ack:`;
const DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS = 1_500;
const DEFAULT_CONNECT_TIMEOUT_MS = 3_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECENT_EVENT_IDS = 1_000;
const MAX_SIGNED_ENVELOPE_BYTES = 24 * 1024;
const MAX_SIGNED_PAYLOAD_BYTES = 16 * 1024;
const DEFAULT_MAX_ENVELOPE_AGE_MS = 60_000;
const DEFAULT_MAX_ENVELOPE_FUTURE_MS = 5_000;
const INTEGRITY_SECRET_ENV_VAR = "VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET";
const EVENT_SIGNATURE_DOMAIN = "vf-proxy-routing-invalidation:event:v1";
const ACK_SIGNATURE_DOMAIN = "vf-proxy-routing-invalidation:ack:v1";

type RedisListener = (message: string, channel: string) => void;
type SignatureDomain = "event" | "ack";

export interface RoutingInvalidationRedisClient {
  connect(): Promise<void>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, listener: RedisListener): Promise<number>;
  unsubscribe(channel: string): Promise<number>;
  close(): Promise<void>;
  destroy(): void;
  on?(event: "error", listener: (error: unknown) => void): unknown;
}

interface RoutingInvalidationLogger {
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, error?: Error, extra?: Record<string, unknown>): void;
}

export interface ProxyRoutingInvalidationBus extends ProxyRoutingInvalidationPublisher {
  close(): Promise<void>;
}

interface StartProxyRoutingInvalidationBusOptions {
  acknowledgementTimeoutMs?: number;
  createClient?: (
    redisUrl: string,
  ) => RoutingInvalidationRedisClient | Promise<RoutingInvalidationRedisClient>;
  expectedReplicas?: number;
  now?: () => number;
  logger?: RoutingInvalidationLogger;
  onInvalidate: (event: ProxyRoutingInvalidationEvent) => unknown | Promise<unknown>;
  integritySecret?: string;
  redisUrl?: string;
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

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function encodedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
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
    !Number.isInteger(envelope.issuedAtMs) ||
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

function base64UrlDecode(value: string): ArrayBuffer | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  try {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)).buffer;
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
  return base64urlEncodeBytes(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, signatureInput(domain, issuedAtMs, payload)),
    ),
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
    typeof event.eventId !== "string" || !event.eventId ||
    typeof event.projectId !== "string" || !event.projectId ||
    typeof event.projectSlug !== "string" || !event.projectSlug ||
    typeof event.deploymentId !== "string" || !event.deploymentId ||
    typeof event.environmentId !== "string" || !event.environmentId ||
    typeof event.environmentName !== "string" || !event.environmentName ||
    typeof event.releaseId !== "string" || !event.releaseId
  ) {
    return null;
  }
  return event as unknown as ProxyRoutingInvalidationEvent;
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
    typeof acknowledgement.eventId !== "string" || !acknowledgement.eventId ||
    typeof acknowledgement.replicaId !== "string" || !acknowledgement.replicaId
  ) {
    return null;
  }
  return acknowledgement as unknown as RoutingInvalidationAcknowledgement;
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
  logger?: RoutingInvalidationLogger,
): Promise<void> {
  try {
    await client.close();
  } catch (error) {
    client.destroy();
    logger?.warn("Failed to close routing invalidation Redis client cleanly", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function startProxyRoutingInvalidationBus(
  options: StartProxyRoutingInvalidationBusOptions,
): Promise<ProxyRoutingInvalidationBus | null> {
  const redisUrl = options.redisUrl === undefined ? getEnv("REDIS_URL") : options.redisUrl;
  if (!redisUrl) return null;
  const integritySecret = options.integritySecret ?? getEnv(INTEGRITY_SECRET_ENV_VAR) ?? "";
  if (!integritySecret) return null;

  const expectedReplicas = positiveInteger(
    options.expectedReplicas ?? getEnv("VERYFRONT_PROXY_EXPECTED_REPLICAS"),
    1,
  );
  const acknowledgementTimeoutMs = positiveInteger(
    options.acknowledgementTimeoutMs,
    DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS,
  );
  const replicaId = options.replicaId ?? getEnv("HOSTNAME") ?? crypto.randomUUID();
  const createClient = options.createClient ?? createDefaultClient;
  const publishClient = await createClient(redisUrl);
  const subscribeClient = await createClient(redisUrl);
  const processedEventIds = new Set<string>();
  const eventProcessing = new Map<string, Promise<void>>();
  const hmacKey = await createHmacKey(integritySecret);
  const now = options.now ?? (() => Date.now());
  const acknowledgementListeners = new Map<string, Set<RedisListener>>();
  const activeAcknowledgementChannels = new Set<string>();
  const closeWaiters = new Set<() => void>();

  let closed = false;
  const waitForClose = (): Promise<void> => {
    if (closed) return Promise.resolve();
    return new Promise((resolve) => {
      closeWaiters.add(resolve);
    });
  };

  const resolveCloseWaiters = (): void => {
    for (const resolve of closeWaiters) resolve();
    closeWaiters.clear();
  };

  const subscribeAcknowledgement = async (
    channel: string,
    listener: RedisListener,
  ): Promise<void> => {
    let listeners = acknowledgementListeners.get(channel);
    if (!listeners) {
      listeners = new Set();
      acknowledgementListeners.set(channel, listeners);
      await subscribeClient.subscribe(channel, (message, receivedChannel) => {
        if (receivedChannel !== channel) return;
        for (const acknowledgementListener of listeners ?? []) {
          acknowledgementListener(message, receivedChannel);
        }
      });
    }
    listeners.add(listener);
    activeAcknowledgementChannels.add(channel);
  };

  const unsubscribeAcknowledgement = async (
    channel: string,
    listener: RedisListener,
  ): Promise<void> => {
    const listeners = acknowledgementListeners.get(channel);
    if (!listeners) return;
    listeners.delete(listener);
    if (listeners.size > 0) return;
    acknowledgementListeners.delete(channel);
    activeAcknowledgementChannels.delete(channel);
    if (!closed) await subscribeClient.unsubscribe(channel);
  };

  const rememberProcessedEvent = (eventId: string) => {
    processedEventIds.delete(eventId);
    processedEventIds.add(eventId);
    while (processedEventIds.size > MAX_RECENT_EVENT_IDS) {
      const oldestEventId = processedEventIds.values().next().value;
      if (!oldestEventId) break;
      processedEventIds.delete(oldestEventId);
    }
  };

  const processEvent = (event: ProxyRoutingInvalidationEvent): Promise<void> => {
    if (processedEventIds.has(event.eventId)) return Promise.resolve();
    const existing = eventProcessing.get(event.eventId);
    if (existing) return existing;

    const processing = Promise.resolve()
      .then(() => options.onInvalidate(event))
      .then(
        () => {
          rememberProcessedEvent(event.eventId);
          eventProcessing.delete(event.eventId);
        },
        (error) => {
          eventProcessing.delete(event.eventId);
          throw error;
        },
      );
    eventProcessing.set(event.eventId, processing);
    return processing;
  };

  const logRedisError = (error: unknown) => {
    options.logger?.error(
      "Proxy routing invalidation Redis error",
      error instanceof Error ? error : new Error(String(error)),
    );
  };
  publishClient.on?.("error", logRedisError);
  subscribeClient.on?.("error", logRedisError);

  try {
    await Promise.all([publishClient.connect(), subscribeClient.connect()]);
    await subscribeClient.subscribe(ROUTING_INVALIDATION_CHANNEL, (message, channel) => {
      if (channel !== ROUTING_INVALIDATION_CHANNEL) return;
      void verifySignedEnvelope(hmacKey, "event", message, now)
        .then((payload) => {
          if (!payload || closed) return null;
          const event = parseEvent(payload);
          if (!event) return null;
          return processEvent(event).then(async () => {
            if (closed) return;
            const acknowledgementPayload = JSON.stringify({ eventId: event.eventId, replicaId });
            await publishClient.publish(
              `${ROUTING_INVALIDATION_ACK_PREFIX}${event.eventId}`,
              await serializeSignedEnvelope(hmacKey, "ack", acknowledgementPayload, now),
            );
          });
        })
        .catch((error) => {
          options.logger?.error(
            "Failed to apply proxy routing invalidation",
            error instanceof Error ? error : new Error(String(error)),
          );
        });
    });
  } catch (error) {
    publishClient.destroy();
    subscribeClient.destroy();
    throw error;
  }

  options.logger?.info("Proxy routing invalidation bus connected", {
    expectedReplicas,
    replicaId,
  });

  return {
    async publish(event): Promise<ProxyRoutingInvalidationPublishResult> {
      if (closed) throw new Error("Proxy routing invalidation bus is closed");
      const acknowledgementChannel = `${ROUTING_INVALIDATION_ACK_PREFIX}${event.eventId}`;
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
            if (!acknowledgement || acknowledgement.eventId !== event.eventId) return;
            acknowledgedReplicas.add(acknowledgement.replicaId);
            if (recipients > 0 && acknowledgedReplicas.size >= recipients) {
              resolveAcknowledged?.();
            }
          })
          .catch((error) => {
            options.logger?.error(
              "Failed to verify proxy routing invalidation acknowledgement",
              error instanceof Error ? error : new Error(String(error)),
              { eventId: event.eventId },
            );
          });
      };

      await subscribeAcknowledgement(acknowledgementChannel, acknowledgementListener);

      try {
        const eventPayload = JSON.stringify(event);
        try {
          recipients = await publishClient.publish(
            ROUTING_INVALIDATION_CHANNEL,
            await serializeSignedEnvelope(hmacKey, "event", eventPayload, now),
          );
        } catch (error) {
          if (!closed) throw error;
          return {
            acknowledged: acknowledgedReplicas.size,
            converged: false,
            recipients,
          };
        }
        if (recipients > 0 && acknowledgedReplicas.size >= recipients) resolveAcknowledged?.();

        if (recipients > 0) {
          let timeout: number | undefined;
          await Promise.race([
            acknowledgementReceived,
            waitForClose(),
            new Promise<void>((resolve) => {
              timeout = setTimeout(resolve, acknowledgementTimeoutMs);
            }),
          ]);
          if (timeout !== undefined) clearTimeout(timeout);
        }

        const acknowledged = acknowledgedReplicas.size;
        return {
          acknowledged,
          converged: recipients >= expectedReplicas && acknowledged >= recipients,
          recipients,
        };
      } finally {
        await unsubscribeAcknowledgement(acknowledgementChannel, acknowledgementListener);
      }
    },

    async close() {
      if (closed) return;
      closed = true;
      resolveCloseWaiters();
      try {
        await Promise.allSettled([
          subscribeClient.unsubscribe(ROUTING_INVALIDATION_CHANNEL),
          ...[...activeAcknowledgementChannels].map((channel) =>
            subscribeClient.unsubscribe(channel)
          ),
        ]);
      } finally {
        await Promise.all([
          closeClient(publishClient, options.logger),
          closeClient(subscribeClient, options.logger),
        ]);
      }
    },
  };
}
