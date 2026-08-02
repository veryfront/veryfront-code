import { createClient } from "redis";
import { getEnv } from "veryfront";
import { getErrorMessage } from "veryfront/errors";
import { base64urlEncodeBytes } from "veryfront/utils";
import {
  hasProjectIdentityControlCharacters,
  isCanonicalOpaqueProjectIdentifier,
} from "veryfront/extensions/distributed/routing-invalidation-support";
import type {
  ProxyRoutingInvalidationEvent,
  ProxyRoutingInvalidationPublisher,
  ProxyRoutingInvalidationPublishResult,
} from "veryfront/extensions/distributed/routing-invalidation-support";
import { parseProxyRoutingInvalidationEvent } from "veryfront/extensions/distributed/routing-invalidation-support";

const ROUTING_INVALIDATION_CHANNEL = "vf-proxy-routing-invalidations-v1";
const ROUTING_INVALIDATION_ACK_PREFIX = `${ROUTING_INVALIDATION_CHANNEL}:ack:`;
const DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS = 1_500;
const DEFAULT_CONNECT_TIMEOUT_MS = 3_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECENT_EVENT_IDS = 1_000;
const MAX_ACTIVE_EVENT_PROCESSING = 100;
const MAX_ACTIVE_PUBLISHES = 100;
const MAX_REPLICA_COUNT = 10_000;
const MAX_ACKNOWLEDGEMENT_TIMEOUT_MS = 60_000;
const MAX_REDIS_URL_CODE_UNITS = 4_096;
const MAX_INTEGRITY_SECRET_CODE_UNITS = 64 * 1_024;
const MAX_SIGNED_ENVELOPE_BYTES = 24 * 1024;
const MAX_SIGNED_PAYLOAD_BYTES = 16 * 1024;
const DEFAULT_MAX_ENVELOPE_AGE_MS = 60_000;
const DEFAULT_MAX_ENVELOPE_FUTURE_MS = 5_000;
const INTEGRITY_SECRET_ENV_VAR = "VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET";
const EVENT_SIGNATURE_DOMAIN = "vf-proxy-routing-invalidation:event:v1";
const ACK_SIGNATURE_DOMAIN = "vf-proxy-routing-invalidation:ack:v1";
const HMAC_SHA256_SIGNATURE_BYTES = 32;
const HMAC_SHA256_SIGNATURE_BASE64URL_CODE_UNITS = 43;

type RedisListener = (message: string, channel: string) => void;
type SignatureDomain = "event" | "ack";

export interface RoutingInvalidationRedisClient {
  connect(): Promise<void>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, listener: RedisListener): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  close(): Promise<void>;
  destroy(): void;
  on?(event: "error", listener: (error: unknown) => void): unknown;
}

interface RoutingInvalidationLogger {
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, error?: unknown, extra?: Record<string, unknown>): void;
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

const START_OPTION_NAMES = new Set([
  "acknowledgementTimeoutMs",
  "createClient",
  "expectedReplicas",
  "now",
  "logger",
  "onInvalidate",
  "integritySecret",
  "redisUrl",
  "replicaId",
]);

function assertPlainStartOptions(
  options: StartProxyRoutingInvalidationBusOptions,
): void {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Routing invalidation bus options must be an object");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(options);
    keys = Reflect.ownKeys(options);
  } catch (error) {
    throw new TypeError("Routing invalidation bus options are unreadable", {
      cause: error,
    });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Routing invalidation bus options must be a plain object");
  }
  if (keys.some((key) => typeof key !== "string" || !START_OPTION_NAMES.has(key))) {
    throw new TypeError("Routing invalidation bus options contain an unknown option");
  }
}

function readOwnOption(
  options: StartProxyRoutingInvalidationBusOptions,
  key: keyof StartProxyRoutingInvalidationBusOptions,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(options, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Routing invalidation bus option ${key} must be a data property`);
  }
  return descriptor.value;
}

function resolveInteger(
  value: unknown,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === "") return fallback;
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    parsed = Number(value);
  } else {
    throw new TypeError(`${label} must be a decimal integer`);
  }
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new RangeError(
      `${label} must be between ${minimum} and ${maximum}`,
    );
  }
  return parsed;
}

function requireRedisUrl(value: unknown): string | null {
  if (value === undefined || value === "") return null;
  if (
    typeof value !== "string" ||
    value.length > MAX_REDIS_URL_CODE_UNITS ||
    value !== value.trim() ||
    value.includes("\\") ||
    hasProjectIdentityControlCharacters(value)
  ) {
    throw new TypeError("Routing invalidation REDIS_URL is invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Routing invalidation REDIS_URL is invalid");
  }
  if (
    (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") ||
    !parsed.hostname ||
    parsed.hash
  ) {
    throw new TypeError(
      "Routing invalidation REDIS_URL must use redis:// or rediss:// with a host",
    );
  }
  return value;
}

function requireIntegritySecret(value: unknown): string | null {
  if (value === undefined || value === "") return null;
  if (
    typeof value !== "string" ||
    value.length > MAX_INTEGRITY_SECRET_CODE_UNITS
  ) {
    throw new TypeError("Routing invalidation integrity secret is invalid");
  }
  return value;
}

function requireFunction<TFunction extends (...args: never[]) => unknown>(
  value: unknown,
  fallback: TFunction,
  label: string,
): TFunction {
  if (value === undefined) return fallback;
  if (typeof value !== "function") {
    throw new TypeError(`${label} must be a function`);
  }
  return value as TFunction;
}

function requireConfiguredFunction<
  TFunction extends (...args: never[]) => unknown,
>(
  value: unknown,
  label: string,
): TFunction {
  if (typeof value !== "function") {
    throw new TypeError(`${label} must be a function`);
  }
  return value as TFunction;
}

function readClock(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Routing invalidation clock must return a positive safe integer");
  }
  return value;
}

function validateReplicaId(value: unknown): string {
  if (!isCanonicalOpaqueProjectIdentifier(value)) {
    throw new TypeError("Routing invalidation replica ID is invalid");
  }
  return value;
}

function safeDestroyUnknown(client: unknown): void {
  try {
    if (!client || typeof client !== "object") return;
    const destroy = Reflect.get(client, "destroy");
    if (typeof destroy === "function") Reflect.apply(destroy, client, []);
  } catch {
    // Construction failure remains the actionable startup error.
  }
}

function snapshotRedisClient(
  value: unknown,
  label: string,
): RoutingInvalidationRedisClient {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} returned an invalid Redis client`);
  }
  const operation = (
    name: string,
    required = true,
  ): ((...args: never[]) => unknown) | undefined => {
    let candidate: unknown;
    try {
      candidate = Reflect.get(value, name);
    } catch (error) {
      throw new TypeError(`${label} Redis client ${name} is unreadable`, {
        cause: error,
      });
    }
    if (candidate === undefined && !required) return undefined;
    if (typeof candidate !== "function") {
      throw new TypeError(`${label} Redis client ${name} must be a function`);
    }
    return candidate as (...args: never[]) => unknown;
  };
  const connect = operation("connect")!;
  const publish = operation("publish")!;
  const subscribe = operation("subscribe")!;
  const unsubscribe = operation("unsubscribe")!;
  const close = operation("close")!;
  const destroy = operation("destroy")!;
  const on = operation("on", false);
  const requireSubscriberCount = (result: unknown): number => {
    if (
      typeof result !== "number" ||
      !Number.isSafeInteger(result) ||
      result < 0 ||
      result > MAX_REPLICA_COUNT
    ) {
      throw new TypeError(`${label} Redis client publish returned an invalid count`);
    }
    return result;
  };

  return Object.freeze({
    async connect(): Promise<void> {
      await Reflect.apply(connect, value, []);
    },
    async publish(channel: string, message: string): Promise<number> {
      return requireSubscriberCount(
        await Reflect.apply(publish, value, [channel, message]),
      );
    },
    async subscribe(channel: string, listener: RedisListener): Promise<void> {
      await Reflect.apply(subscribe, value, [channel, listener]);
    },
    async unsubscribe(channel: string): Promise<void> {
      await Reflect.apply(unsubscribe, value, [channel]);
    },
    async close(): Promise<void> {
      await Reflect.apply(close, value, []);
    },
    destroy(): void {
      Reflect.apply(destroy, value, []);
    },
    ...(on
      ? {
        on(event: "error", listener: (error: unknown) => void): unknown {
          return Reflect.apply(on, value, [event, listener]);
        },
      }
      : {}),
  });
}

function encodedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isWithinEncodedLimit(value: string, maximumBytes: number): boolean {
  return value.length <= maximumBytes &&
    encodedByteLength(value) <= maximumBytes;
}

function ownDataValue(
  descriptors: PropertyDescriptorMap,
  key: string,
): unknown {
  const descriptor = descriptors[key];
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function parseSignedEnvelope(message: string): SignedRoutingInvalidationEnvelope | null {
  if (!isWithinEncodedLimit(message, MAX_SIGNED_ENVELOPE_BYTES)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(parsed);
  } catch {
    return null;
  }
  const version = ownDataValue(descriptors, "version");
  const issuedAtMs = ownDataValue(descriptors, "issuedAtMs");
  const payload = ownDataValue(descriptors, "payload");
  const signature = ownDataValue(descriptors, "signature");
  if (
    version !== 1 ||
    typeof issuedAtMs !== "number" ||
    !Number.isSafeInteger(issuedAtMs) ||
    issuedAtMs <= 0 ||
    typeof payload !== "string" ||
    !isWithinEncodedLimit(payload, MAX_SIGNED_PAYLOAD_BYTES) ||
    typeof signature !== "string" ||
    signature.length !== HMAC_SHA256_SIGNATURE_BASE64URL_CODE_UNITS
  ) {
    return null;
  }
  return Object.freeze({
    version: 1,
    issuedAtMs,
    payload,
    signature,
  });
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
  if (
    !signatureBytes ||
    signatureBytes.byteLength !== HMAC_SHA256_SIGNATURE_BYTES
  ) return false;
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
  if (!isWithinEncodedLimit(payload, MAX_SIGNED_PAYLOAD_BYTES)) {
    throw new Error("Proxy routing invalidation payload is too large");
  }
  const issuedAtMs = readClock(now);
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
  const currentTimeMs = readClock(now);
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
  if (!isWithinEncodedLimit(message, MAX_SIGNED_PAYLOAD_BYTES)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  return parseProxyRoutingInvalidationEvent(parsed);
}

function parseAcknowledgement(message: string): RoutingInvalidationAcknowledgement | null {
  if (!isWithinEncodedLimit(message, MAX_SIGNED_PAYLOAD_BYTES)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(parsed);
  } catch {
    return null;
  }
  const eventId = ownDataValue(descriptors, "eventId");
  const replicaId = ownDataValue(descriptors, "replicaId");
  if (
    !isCanonicalOpaqueProjectIdentifier(eventId) ||
    !isCanonicalOpaqueProjectIdentifier(replicaId)
  ) {
    return null;
  }
  return Object.freeze({ eventId, replicaId });
}

async function createDefaultClient(redisUrl: string): Promise<RoutingInvalidationRedisClient> {
  const createRedisClient = createClient as unknown as (options: {
    url: string;
    socket: {
      connectTimeout: number;
      reconnectStrategy: (retries: number) => number | Error;
    };
  }) => RoutingInvalidationRedisClient;

  return createRedisClient({
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

function logInfo(
  logger: RoutingInvalidationLogger | undefined,
  message: string,
  extra?: Record<string, unknown>,
): void {
  try {
    logger?.info(message, extra);
  } catch {
    // Diagnostic callbacks cannot own the routing lifecycle.
  }
}

function logWarn(
  logger: RoutingInvalidationLogger | undefined,
  message: string,
  extra?: Record<string, unknown>,
): void {
  try {
    logger?.warn(message, extra);
  } catch {
    // Diagnostic callbacks cannot own the routing lifecycle.
  }
}

function logError(
  logger: RoutingInvalidationLogger | undefined,
  message: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  try {
    logger?.error(message, error, extra);
  } catch {
    // Diagnostic callbacks cannot own the routing lifecycle.
  }
}

async function closeClient(
  client: RoutingInvalidationRedisClient,
  logger?: RoutingInvalidationLogger,
): Promise<void> {
  try {
    await client.close();
  } catch (error) {
    try {
      client.destroy();
    } catch {
      // The process-level cleanup deadline remains authoritative.
    }
    logWarn(logger, "Failed to close routing invalidation Redis client cleanly", {
      error: getErrorMessage(error),
    });
  }
}

export async function startProxyRoutingInvalidationBus(
  options: StartProxyRoutingInvalidationBusOptions,
): Promise<ProxyRoutingInvalidationBus | null> {
  assertPlainStartOptions(options);
  const configuredRedisUrl = readOwnOption(options, "redisUrl");
  const redisUrl = requireRedisUrl(
    configuredRedisUrl === undefined ? getEnv("REDIS_URL") : configuredRedisUrl,
  );
  if (redisUrl === null) return null;
  const configuredIntegritySecret = readOwnOption(options, "integritySecret");
  const integritySecret = requireIntegritySecret(
    configuredIntegritySecret === undefined
      ? getEnv(INTEGRITY_SECRET_ENV_VAR)
      : configuredIntegritySecret,
  );
  if (integritySecret === null) return null;

  const configuredExpectedReplicas = readOwnOption(
    options,
    "expectedReplicas",
  );
  const expectedReplicas = resolveInteger(
    configuredExpectedReplicas === undefined
      ? getEnv("VERYFRONT_PROXY_EXPECTED_REPLICAS")
      : configuredExpectedReplicas,
    1,
    "Routing invalidation expected replicas",
    1,
    MAX_REPLICA_COUNT,
  );
  const acknowledgementTimeoutMs = resolveInteger(
    readOwnOption(options, "acknowledgementTimeoutMs"),
    DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS,
    "Routing invalidation acknowledgement timeout",
    1,
    MAX_ACKNOWLEDGEMENT_TIMEOUT_MS,
  );
  const configuredReplicaId = readOwnOption(options, "replicaId");
  const replicaId = validateReplicaId(
    configuredReplicaId === undefined
      ? getEnv("HOSTNAME") ?? crypto.randomUUID()
      : configuredReplicaId,
  );
  const createClient = requireFunction(
    readOwnOption(options, "createClient"),
    createDefaultClient,
    "Routing invalidation Redis client factory",
  ) as (
    redisUrl: string,
  ) => RoutingInvalidationRedisClient | Promise<RoutingInvalidationRedisClient>;
  const onInvalidate = requireConfiguredFunction(
    readOwnOption(options, "onInvalidate"),
    "Routing invalidation callback",
  ) as (
    event: ProxyRoutingInvalidationEvent,
  ) => unknown | Promise<unknown>;
  const now = requireFunction(
    readOwnOption(options, "now"),
    () => Date.now(),
    "Routing invalidation clock",
  ) as () => number;
  readClock(now);
  const logger = readOwnOption(options, "logger") as
    | RoutingInvalidationLogger
    | undefined;

  let rawPublishClient: unknown;
  let rawSubscribeClient: unknown;
  let publishClient: RoutingInvalidationRedisClient;
  let subscribeClient: RoutingInvalidationRedisClient;
  let hmacKey: CryptoKey;
  try {
    rawPublishClient = await createClient(redisUrl);
    publishClient = snapshotRedisClient(
      rawPublishClient,
      "Routing invalidation publish",
    );
    rawSubscribeClient = await createClient(redisUrl);
    subscribeClient = snapshotRedisClient(
      rawSubscribeClient,
      "Routing invalidation subscribe",
    );
    hmacKey = await createHmacKey(integritySecret);
  } catch (error) {
    safeDestroyUnknown(rawPublishClient);
    if (rawSubscribeClient !== rawPublishClient) {
      safeDestroyUnknown(rawSubscribeClient);
    }
    throw error;
  }

  const processedEventIds = new Set<string>();
  const eventProcessing = new Map<string, Promise<void>>();
  const acknowledgementListeners = new Map<string, Set<RedisListener>>();
  const activeAcknowledgementChannels = new Set<string>();
  const activePublishEventIds = new Set<string>();
  const closeWaiters = new Set<() => void>();

  let closed = false;
  let closePromise: Promise<void> | null = null;

  const createCloseWaiter = (): Readonly<{
    promise: Promise<void>;
    dispose: () => void;
  }> => {
    if (closed) {
      return Object.freeze({
        promise: Promise.resolve(),
        dispose: () => undefined,
      });
    }
    let resolve!: () => void;
    const promise = new Promise<void>((innerResolve) => {
      resolve = innerResolve;
    });
    closeWaiters.add(resolve);
    return Object.freeze({
      promise,
      dispose: () => closeWaiters.delete(resolve),
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
      try {
        await subscribeClient.subscribe(channel, (message, receivedChannel) => {
          if (receivedChannel !== channel) return;
          for (const acknowledgementListener of listeners ?? []) {
            acknowledgementListener(message, receivedChannel);
          }
        });
      } catch (error) {
        acknowledgementListeners.delete(channel);
        throw error;
      }
      if (closed) {
        acknowledgementListeners.delete(channel);
        try {
          await subscribeClient.unsubscribe(channel);
        } catch {
          // The bus close path owns the underlying connection.
        }
        throw new Error("Proxy routing invalidation bus is closed");
      }
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
    if (eventProcessing.size >= MAX_ACTIVE_EVENT_PROCESSING) {
      return Promise.reject(
        new Error("Proxy routing invalidation processing capacity is exhausted"),
      );
    }

    const processing = Promise.resolve()
      .then(() => onInvalidate(event))
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
    logError(
      logger,
      "Proxy routing invalidation Redis error",
      error,
    );
  };

  try {
    publishClient.on?.("error", logRedisError);
    subscribeClient.on?.("error", logRedisError);
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
          logError(
            logger,
            "Failed to apply proxy routing invalidation",
            error,
          );
        });
    });
    logInfo(logger, "Proxy routing invalidation bus connected", {
      expectedReplicas,
      replicaId,
    });
  } catch (error) {
    safeDestroyUnknown(rawPublishClient);
    if (rawSubscribeClient !== rawPublishClient) {
      safeDestroyUnknown(rawSubscribeClient);
    }
    throw error;
  }

  const bus: ProxyRoutingInvalidationBus = {
    async publish(eventValue): Promise<ProxyRoutingInvalidationPublishResult> {
      if (closed) throw new Error("Proxy routing invalidation bus is closed");
      const event = parseProxyRoutingInvalidationEvent(eventValue);
      if (!event) {
        throw new TypeError("Proxy routing invalidation event is invalid");
      }
      if (activePublishEventIds.has(event.eventId)) {
        throw new Error(
          `Proxy routing invalidation event ${event.eventId} is already publishing`,
        );
      }
      if (activePublishEventIds.size >= MAX_ACTIVE_PUBLISHES) {
        throw new Error("Proxy routing invalidation publish capacity is exhausted");
      }
      activePublishEventIds.add(event.eventId);

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
            if (acknowledgedReplicas.size < MAX_REPLICA_COUNT) {
              acknowledgedReplicas.add(acknowledgement.replicaId);
            }
            if (recipients > 0 && acknowledgedReplicas.size >= recipients) {
              resolveAcknowledged?.();
            }
          })
          .catch((error) => {
            logError(
              logger,
              "Failed to verify proxy routing invalidation acknowledgement",
              error,
              { eventId: event.eventId },
            );
          });
      };

      let subscribed = false;
      try {
        await subscribeAcknowledgement(acknowledgementChannel, acknowledgementListener);
        subscribed = true;

        const eventPayload = JSON.stringify(event);
        try {
          recipients = await publishClient.publish(
            ROUTING_INVALIDATION_CHANNEL,
            await serializeSignedEnvelope(hmacKey, "event", eventPayload, now),
          );
        } catch (error) {
          if (!closed) throw error;
          return Object.freeze({
            acknowledged: Math.min(acknowledgedReplicas.size, recipients),
            converged: false,
            recipients,
          });
        }
        if (recipients > 0 && acknowledgedReplicas.size >= recipients) resolveAcknowledged?.();

        if (recipients > 0) {
          const closeWaiter = createCloseWaiter();
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              acknowledgementReceived,
              closeWaiter.promise,
              new Promise<void>((resolve) => {
                timeoutId = setTimeout(resolve, acknowledgementTimeoutMs);
              }),
            ]);
          } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            closeWaiter.dispose();
          }
        }

        const acknowledged = Math.min(acknowledgedReplicas.size, recipients);
        return Object.freeze({
          acknowledged,
          converged: recipients >= expectedReplicas && acknowledged >= recipients,
          recipients,
        });
      } finally {
        try {
          if (subscribed) {
            await unsubscribeAcknowledgement(
              acknowledgementChannel,
              acknowledgementListener,
            );
          }
        } finally {
          activePublishEventIds.delete(event.eventId);
        }
      }
    },

    close(): Promise<void> {
      if (closePromise) return closePromise;
      closed = true;
      resolveCloseWaiters();
      closePromise = (async () => {
        try {
          await Promise.allSettled([
            subscribeClient.unsubscribe(ROUTING_INVALIDATION_CHANNEL),
            ...[...activeAcknowledgementChannels].map((channel) =>
              subscribeClient.unsubscribe(channel)
            ),
          ]);
        } finally {
          const clients = rawPublishClient === rawSubscribeClient
            ? [publishClient]
            : [publishClient, subscribeClient];
          await Promise.all(
            clients.map((client) => closeClient(client, logger)),
          );
        }
      })();
      return closePromise;
    },
  };
  return Object.freeze(bus);
}
