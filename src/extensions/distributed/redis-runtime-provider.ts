/**
 * Provider-neutral contract for the optional Redis runtime.
 *
 * Core owns feature semantics and stable facades. The extension owns Redis
 * packages, connections, protocol details, and transport lifecycle.
 *
 * @module extensions/distributed/redis-runtime-provider
 */

import type {
  ClaudeCodeEvent,
  ClaudeCodeEventHandler,
  ClaudeCodeEventPublisher,
  ClaudeCodeEventSubscriber,
} from "#veryfront/workflow/claude-code/types.ts";

/** Registry name used by the Redis runtime extension. */
export const RedisRuntimeProviderName = "RedisRuntimeProvider" as const;

/** Structural module surface used by the platform Redis adapter. */
export interface NodeRedisModule {
  createClient(
    options: {
      url?: string;
      socket?: {
        host?: string;
        port?: number;
        connectTimeout?: number;
        reconnectStrategy?: (retries: number) => number | Error;
      };
    },
  ): NodeRedisClient;
}

/** Structural node-redis client surface used by the platform adapter. */
export interface NodeRedisClient {
  connect(): Promise<void>;
  hSet(key: string, fields: Record<string, string>): Promise<number | string>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hDel(key: string, fields: string[]): Promise<number>;
  del(keys: string[]): Promise<number>;
  sAdd(key: string, members: string[]): Promise<number>;
  sRem(key: string, members: string[]): Promise<number>;
  sMembers(key: string): Promise<string[]>;
  rPush(key: string, values: string[]): Promise<number>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  lIndex(key: string, index: number): Promise<string | null>;
  lSet(key: string, index: number, value: string): Promise<string | "OK">;
  lLen(key: string): Promise<number>;
  xAdd(key: string, id: string, fields: Record<string, string>): Promise<string>;
  xRead(
    streams: Array<{ key: string; id: string }>,
    options?: { BLOCK?: number; COUNT?: number },
  ): Promise<
    Array<{ name: string; messages: Array<{ id: string; message: Record<string, string> }> }> | null
  >;
  xGroupCreate(
    key: string,
    group: string,
    id: string,
    options?: { MKSTREAM?: boolean },
  ): Promise<string>;
  xReadGroup(
    group: string,
    consumer: string,
    streams: Array<{ key: string; id: string }>,
    options?: { BLOCK?: number; COUNT?: number },
  ): Promise<
    Array<{ name: string; messages: Array<{ id: string; message: Record<string, string> }> }> | null
  >;
  xAck(key: string, group: string, ids: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  scan(
    cursor: number,
    options?: { MATCH?: string; COUNT?: number },
  ): Promise<{ cursor: number; keys: string[] }>;
  exists(keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  set(
    key: string,
    value: string,
    options?: { NX?: boolean; PX?: number; EX?: number },
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(
    channel: string,
    listener: (message: string, channel: string) => void,
  ): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  eval(
    script: string,
    options?: { keys?: string[]; arguments?: string[] },
  ): Promise<unknown>;
  close(): Promise<void>;
  destroy(): void;
  on(event: "error", listener: (error: unknown) => void): unknown;
}

/** Structural client surface used by core cache features. */
export interface RedisClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  get(key: string): Promise<string | null>;
  mGet(keys: string[]): Promise<Array<string | null>>;
  set(
    key: string,
    value: string,
    options?: { EX?: number; NX?: boolean },
  ): Promise<string | null>;
  del(key: string | string[]): Promise<number>;
  scan(
    cursor: number,
    options?: { MATCH?: string; COUNT?: number },
  ): Promise<{ cursor: number; keys: string[] }>;
  expire(key: string, seconds: number): Promise<number>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  incr(key: string): Promise<number>;
  pExpire(key: string, milliseconds: number): Promise<boolean>;
  pTTL(key: string): Promise<number>;
  ttl?(key: string): Promise<number>;
  info?(section?: "server" | "memory" | "cluster"): Promise<string>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  isOpen?: boolean;
}

/** Independently owned Redis connection returned to a core feature. */
export interface RedisClientHandle {
  readonly client: RedisClient;
  close(): Promise<void>;
}

/** Connection options accepted by the stable core Redis client facade. */
export interface RedisClientOptions {
  url?: string;
  connectTimeout?: number;
  autoReconnect?: boolean;
  tls?: boolean;
  password?: string;
  username?: string;
}

/** Redis Pub/Sub publisher configuration. */
export interface RedisEventPublisherConfig {
  /** Redis URL. */
  url: string;
  /** Channel prefix (default: `claude-code`). */
  channelPrefix?: string;
  /** Enable debug logging. */
  debug?: boolean;
}

/** Redis-backed event publisher/subscriber implementation. */
export interface RedisEventPublisherImplementation
  extends ClaudeCodeEventPublisher, ClaudeCodeEventSubscriber {
  publish(event: ClaudeCodeEvent): Promise<void>;
  subscribe(runId: string, handler: ClaudeCodeEventHandler): Promise<() => void>;
  close(): Promise<void>;
}

/** Optional Redis runtime implementation supplied by an extension. */
export interface RedisRuntimeProvider {
  readonly id: string;
  loadModule(): Promise<NodeRedisModule>;
  getClient(options?: RedisClientOptions): Promise<RedisClient>;
  disconnectClient(): Promise<void>;
  openClient(
    options?: RedisClientOptions,
    signal?: AbortSignal,
  ): Promise<RedisClientHandle>;
  createEventPublisher(
    config: RedisEventPublisherConfig,
  ): Promise<RedisEventPublisherImplementation>;
  close(): Promise<void>;
}

const PROVIDER_METHODS = [
  "loadModule",
  "getClient",
  "disconnectClient",
  "openClient",
  "createEventPublisher",
  "close",
] as const;
const MAX_PROVIDER_ID_CODE_UNITS = 256;
const capturedProviders = new WeakMap<object, Readonly<RedisRuntimeProvider>>();
const capturedClients = new WeakMap<object, RedisClient>();

function readOwnDataProperty(value: object, key: string, label: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch (cause) {
    throw new TypeError(`${label} could not be inspected`, { cause });
  }
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError(`${label} must be an enumerable own data property`);
  }
  return descriptor.value;
}

function captureEventPublisher(value: unknown): RedisEventPublisherImplementation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Redis event publisher must be an object");
  }
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw new TypeError("Redis event publisher could not be inspected", { cause });
  }
  const allowedKeys = new Set<PropertyKey>(["publish", "subscribe", "close"]);
  if (keys.some((key) => !allowedKeys.has(key))) {
    throw new TypeError("Redis event publisher contains an unexpected property");
  }
  const publish = readOwnDataProperty(value, "publish", "Redis event publisher publish");
  const subscribe = readOwnDataProperty(value, "subscribe", "Redis event publisher subscribe");
  const close = readOwnDataProperty(value, "close", "Redis event publisher close");
  if (
    typeof publish !== "function" || typeof subscribe !== "function" || typeof close !== "function"
  ) {
    throw new TypeError("Redis event publisher operations must be functions");
  }

  return Object.freeze({
    async publish(event: ClaudeCodeEvent): Promise<void> {
      await Promise.resolve(Reflect.apply(publish, value, [event]));
    },
    async subscribe(runId: string, handler: ClaudeCodeEventHandler): Promise<() => void> {
      const dispose = await Promise.resolve(Reflect.apply(subscribe, value, [runId, handler]));
      if (typeof dispose !== "function") {
        throw new TypeError("Redis event publisher subscribe must return a disposer");
      }
      return dispose;
    },
    async close(): Promise<void> {
      await Promise.resolve(Reflect.apply(close, value, []));
    },
  });
}

function assertProviderId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_PROVIDER_ID_CODE_UNITS || value.trim() !== value ||
    value.normalize("NFC") !== value || /\p{Cc}/u.test(value)
  ) {
    throw new TypeError("Redis runtime provider id must be a bounded canonical string");
  }
}

function readDataMethod(
  value: object,
  key: string,
  label: string,
  optional = false,
): ((...args: unknown[]) => unknown) | undefined {
  const visited = new Set<object>();
  let owner: object | null = value;
  while (owner) {
    if (visited.has(owner)) throw new TypeError(`${label} has a cyclic prototype chain`);
    visited.add(owner);

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(owner, key);
    } catch (cause) {
      throw new TypeError(`${label} could not be inspected`, { cause });
    }
    if (descriptor) {
      if (!("value" in descriptor)) {
        throw new TypeError(`${label} must be a data property`);
      }
      if (typeof descriptor.value !== "function") {
        throw new TypeError(`${label} must be a function`);
      }
      return descriptor.value as (...args: unknown[]) => unknown;
    }
    try {
      owner = Object.getPrototypeOf(owner);
    } catch (cause) {
      throw new TypeError(`${label} prototype could not be inspected`, { cause });
    }
  }
  if (optional) return undefined;
  throw new TypeError(`${label} must be exposed`);
}

function captureAsyncMethods(
  value: object,
  names: readonly string[],
  label: string,
): Record<string, (...args: unknown[]) => Promise<unknown>> {
  return Object.fromEntries(names.map((name) => {
    const method = readDataMethod(value, name, `${label} ${name}`)!;
    return [
      name,
      (...args: unknown[]) => Promise.resolve(Reflect.apply(method, value, args)),
    ];
  }));
}

const NODE_REDIS_CLIENT_ASYNC_METHODS = [
  "connect",
  "hSet",
  "hGetAll",
  "hDel",
  "del",
  "sAdd",
  "sRem",
  "sMembers",
  "rPush",
  "lRange",
  "lIndex",
  "lSet",
  "lLen",
  "xAdd",
  "xGroupCreate",
  "xReadGroup",
  "xAck",
  "keys",
  "exists",
  "expire",
  "set",
  "get",
  "publish",
  "subscribe",
  "unsubscribe",
  "eval",
  "close",
] as const;

function captureNodeRedisClient(value: unknown): NodeRedisClient {
  if (!value || typeof value !== "object") {
    throw new TypeError("Redis runtime provider module returned an invalid client");
  }
  const methods = captureAsyncMethods(
    value,
    NODE_REDIS_CLIENT_ASYNC_METHODS,
    "Redis module client",
  );
  const scan = readDataMethod(value, "scan", "Redis module client scan", true);
  const keys = methods.keys!;
  const destroy = readDataMethod(value, "destroy", "Redis module client destroy")!;
  const on = readDataMethod(value, "on", "Redis module client on")!;
  return Object.freeze({
    ...methods,
    scan(
      cursor: number,
      options?: { MATCH?: string; COUNT?: number },
    ): Promise<{ cursor: number; keys: string[] }> {
      if (scan) {
        return Promise.resolve(Reflect.apply(scan, value, [cursor, options])) as Promise<{
          cursor: number;
          keys: string[];
        }>;
      }
      // Providers predating cursor scans still expose KEYS. Preserve their
      // module contract with one terminal page; newer providers retain the
      // non-blocking cursor path above.
      if (cursor !== 0) return Promise.resolve({ cursor: 0, keys: [] });
      return keys(options?.MATCH ?? "*").then((keys) => ({
        cursor: 0,
        keys: keys as string[],
      }));
    },
    destroy(): void {
      Reflect.apply(destroy, value, []);
    },
    on(event: "error", listener: (error: unknown) => void): unknown {
      return Reflect.apply(on, value, [event, listener]);
    },
  }) as NodeRedisClient;
}

function captureRedisModule(value: unknown): NodeRedisModule {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    throw new TypeError("Redis runtime provider returned an invalid module");
  }
  const createClient = readDataMethod(
    value,
    "createClient",
    "Redis runtime provider module createClient",
  )!;
  return Object.freeze({
    createClient(options: Parameters<NodeRedisModule["createClient"]>[0]) {
      return captureNodeRedisClient(Reflect.apply(createClient, value, [options]));
    },
  });
}

const REDIS_CLIENT_METHODS = [
  "connect",
  "disconnect",
  "get",
  "mGet",
  "set",
  "del",
  "scan",
  "expire",
  "eval",
  "incr",
  "pExpire",
  "pTTL",
] as const;

function captureRedisClient(value: unknown): RedisClient {
  if (!value || typeof value !== "object") {
    throw new TypeError("Redis runtime provider returned an invalid client");
  }
  const cached = capturedClients.get(value);
  if (cached) return cached;
  const methods = captureAsyncMethods(value, REDIS_CLIENT_METHODS, "Redis provider client");
  const ttl = readDataMethod(value, "ttl", "Redis provider client ttl", true);
  const info = readDataMethod(value, "info", "Redis provider client info", true);
  const on = readDataMethod(value, "on", "Redis provider client on", true);
  let isOpenOwner: object | null = value;
  let isOpenDescriptor: PropertyDescriptor | undefined;
  const visited = new Set<object>();
  while (isOpenOwner) {
    if (visited.has(isOpenOwner)) {
      throw new TypeError("Redis provider client isOpen has a cyclic prototype chain");
    }
    visited.add(isOpenOwner);
    try {
      isOpenDescriptor = Object.getOwnPropertyDescriptor(isOpenOwner, "isOpen");
    } catch (cause) {
      throw new TypeError("Redis provider client isOpen could not be inspected", { cause });
    }
    if (isOpenDescriptor) break;
    try {
      isOpenOwner = Object.getPrototypeOf(isOpenOwner);
    } catch (cause) {
      throw new TypeError("Redis provider client isOpen prototype could not be inspected", {
        cause,
      });
    }
  }
  if (isOpenDescriptor && !("value" in isOpenDescriptor) && !isOpenDescriptor.get) {
    throw new TypeError("Redis provider client isOpen accessor must be readable");
  }

  const capturedValue: Record<PropertyKey, unknown> = {
    ...methods,
    ...(ttl
      ? {
        ttl: (...args: unknown[]) => Promise.resolve(Reflect.apply(ttl, value, args)),
      }
      : {}),
    ...(info
      ? {
        info: (...args: unknown[]) => Promise.resolve(Reflect.apply(info, value, args)),
      }
      : {}),
    ...(on
      ? {
        on: (...args: unknown[]) => {
          Reflect.apply(on, value, args);
        },
      }
      : {}),
  };
  if (isOpenDescriptor) {
    Object.defineProperty(capturedValue, "isOpen", {
      enumerable: true,
      get() {
        return Reflect.get(value, "isOpen", value);
      },
    });
  }
  const captured = Object.freeze(capturedValue) as unknown as RedisClient;
  capturedClients.set(value, captured);
  return captured;
}

function captureRedisClientHandle(value: unknown): Readonly<RedisClientHandle> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Redis runtime provider returned an invalid client handle");
  }
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw new TypeError("Redis client handle could not be inspected", { cause });
  }
  const allowedKeys = new Set<PropertyKey>(["client", "close"]);
  if (keys.some((key) => !allowedKeys.has(key))) {
    throw new TypeError("Redis client handle contains an unexpected property");
  }

  const client = readOwnDataProperty(value, "client", "Redis client handle client");
  const close = readOwnDataProperty(value, "close", "Redis client handle close");
  const capturedClient = captureRedisClient(client);
  if (typeof close !== "function") {
    throw new TypeError("Redis client handle close must be a function");
  }

  return Object.freeze({
    client: capturedClient,
    async close(): Promise<void> {
      await Promise.resolve(Reflect.apply(close, value, []));
    },
  });
}

async function closeRejectedResource(value: unknown, label: string): Promise<void> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, "close");
  } catch (cause) {
    throw new TypeError(`${label} could not be inspected for cleanup`, { cause });
  }
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    return;
  }
  await Promise.resolve(Reflect.apply(descriptor.value, value, []));
}

/**
 * Validate and snapshot a provider before core invokes extension-owned code.
 * Accessors are rejected so registration cannot execute code during capture.
 */
export function captureRedisRuntimeProvider(value: unknown): Readonly<RedisRuntimeProvider> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Redis runtime provider must be an object");
  }
  const cached = capturedProviders.get(value);
  if (cached) return cached;

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw new TypeError("Redis runtime provider could not be inspected", { cause });
  }
  const allowedKeys = new Set<PropertyKey>(["id", ...PROVIDER_METHODS]);
  if (keys.some((key) => !allowedKeys.has(key))) {
    throw new TypeError("Redis runtime provider contains an unexpected property");
  }

  const id = readOwnDataProperty(value, "id", "Redis runtime provider id");
  assertProviderId(id);
  const methods = Object.fromEntries(
    PROVIDER_METHODS.map((name) => [
      name,
      readOwnDataProperty(value, name, `Redis runtime provider ${name}`),
    ]),
  ) as Record<typeof PROVIDER_METHODS[number], unknown>;
  for (const name of PROVIDER_METHODS) {
    if (typeof methods[name] !== "function") {
      throw new TypeError(`Redis runtime provider ${name} must be a function`);
    }
  }
  const capturedMethods = methods as Record<
    typeof PROVIDER_METHODS[number],
    (...args: unknown[]) => unknown
  >;

  const captured = Object.freeze({
    id,
    async loadModule(): Promise<NodeRedisModule> {
      const module = await Promise.resolve(Reflect.apply(capturedMethods.loadModule, value, []));
      return captureRedisModule(module);
    },
    async getClient(options: RedisClientOptions = {}): Promise<RedisClient> {
      const client = await Promise.resolve(
        Reflect.apply(capturedMethods.getClient, value, [options]),
      );
      return captureRedisClient(client);
    },
    async disconnectClient(): Promise<void> {
      await Promise.resolve(Reflect.apply(capturedMethods.disconnectClient, value, []));
    },
    async openClient(
      options: RedisClientOptions = {},
      signal?: AbortSignal,
    ): Promise<RedisClientHandle> {
      const handle = await Promise.resolve(
        Reflect.apply(capturedMethods.openClient, value, [options, signal]),
      );
      try {
        return captureRedisClientHandle(handle);
      } catch (error) {
        try {
          await closeRejectedResource(handle, "Rejected Redis client handle");
        } catch (closeError) {
          throw new AggregateError(
            [error, closeError],
            "Redis client handle validation and cleanup failed",
          );
        }
        throw error;
      }
    },
    async createEventPublisher(
      config: RedisEventPublisherConfig,
    ): Promise<RedisEventPublisherImplementation> {
      const implementation = await Promise.resolve(
        Reflect.apply(capturedMethods.createEventPublisher, value, [config]),
      );
      try {
        return captureEventPublisher(implementation);
      } catch (error) {
        try {
          await closeRejectedResource(
            implementation,
            "Rejected Redis event publisher",
          );
        } catch (closeError) {
          throw new AggregateError(
            [error, closeError],
            "Redis event publisher validation and cleanup failed",
          );
        }
        throw error;
      }
    },
    async close(): Promise<void> {
      await Promise.resolve(Reflect.apply(capturedMethods.close, value, []));
    },
  });
  capturedProviders.set(value, captured);
  return captured;
}
