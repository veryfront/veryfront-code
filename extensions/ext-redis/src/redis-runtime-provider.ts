import * as NodeRedis from "redis";
import type {
  NodeRedisClient,
  NodeRedisModule,
  RedisClient,
  RedisClientHandle,
  RedisClientOptions,
  RedisEventPublisherConfig,
  RedisEventPublisherImplementation,
  RedisRuntimeProvider,
} from "veryfront/extensions/distributed";
import { createRedisEventPublisher, type RedisEventPublisherClient } from "./event-publisher.ts";
import {
  createRedisClientManager,
  openRedisClient,
  type RedisClientManagerDependencies,
  type RedisClientOpenLifecycle,
  takeRedisClientSetupCleanupClient,
} from "./redis-client-manager.ts";

const PROVIDER_ID = "redis@5.11.0";
const NODE_CLIENT_METHODS = [
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
  "scan",
  "exists",
  "expire",
  "set",
  "get",
  "publish",
  "subscribe",
  "unsubscribe",
  "eval",
  "close",
  "destroy",
  "on",
] as const;
const CLIENT_METHODS = [
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
const OPTIONAL_CLIENT_METHODS = ["ttl", "info", "on"] as const;

function readOptionalClientMethod(
  target: object,
  name: string,
): ((...args: unknown[]) => unknown) | undefined {
  let owner: object | null = target;
  const visited = new Set<object>();
  while (owner) {
    if (visited.has(owner)) return undefined;
    visited.add(owner);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(owner, name);
    } catch {
      return undefined;
    }
    if (descriptor) {
      return "value" in descriptor && typeof descriptor.value === "function"
        ? descriptor.value
        : undefined;
    }
    try {
      owner = Object.getPrototypeOf(owner);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function bindClientMethods<T>(
  target: object,
  methods: readonly string[],
  options: {
    optionalMethods?: readonly string[];
    properties?: readonly string[];
  } = {},
): T {
  const adapter = Object.fromEntries(methods.map((name) => [
    name,
    (...args: unknown[]) => {
      const method = Reflect.get(target, name);
      if (typeof method !== "function") {
        throw new TypeError(`Redis client must expose ${name}`);
      }
      return Reflect.apply(method, target, args);
    },
  ]));
  for (const name of options.optionalMethods ?? []) {
    const method = readOptionalClientMethod(target, name);
    if (!method) continue;
    Object.defineProperty(adapter, name, {
      enumerable: true,
      value: (...args: unknown[]) => Reflect.apply(method, target, args),
    });
  }
  for (const property of options.properties ?? []) {
    Object.defineProperty(adapter, property, {
      enumerable: true,
      get() {
        return Reflect.get(target, property, target);
      },
    });
  }
  return Object.freeze(adapter) as T;
}

export interface RedisRuntimeProviderDependencies {
  clientManagerDependencies?: RedisClientManagerDependencies;
  openClient?: (
    options?: RedisClientOptions,
    lifecycle?: RedisClientOpenLifecycle,
  ) => Promise<RedisClient>;
}

/** Construct an isolated Redis runtime provider. */
export function createRedisRuntimeProvider(
  dependencies: RedisRuntimeProviderDependencies = {},
): RedisRuntimeProvider {
  const clientManagerDependencies = dependencies.clientManagerDependencies ?? {};
  const clientManager = createRedisClientManager(clientManagerDependencies);
  const publishers = new Set<RedisEventPublisherImplementation>();
  const clientHandles = new Set<RedisClientHandle>();
  const failedSetupHandles = new Set<RedisClientHandle>();
  const forcedHandleClosers = new WeakMap<RedisClientHandle, () => Promise<void>>();
  const openingAbortControllers = new Set<AbortController>();
  const exposedClients = new WeakMap<object, RedisClient>();
  const connectClient = dependencies.openClient ??
    ((options, lifecycle) => openRedisClient(options, clientManagerDependencies, lifecycle));
  const moduleAdapter: NodeRedisModule = Object.freeze({
    createClient(options: Parameters<NodeRedisModule["createClient"]>[0]) {
      requireOpen();
      const client = NodeRedis.createClient(options);
      return bindClientMethods<NodeRedisClient>(client, NODE_CLIENT_METHODS);
    },
  });
  let state: "open" | "closing" | "close-failed" | "closed" = "open";
  let closePromise: Promise<void> | null = null;

  function requireOpen(): void {
    if (state !== "open") throw new Error(`Redis runtime provider is ${state}`);
  }

  function createPublisher(
    config: RedisEventPublisherConfig,
  ): RedisEventPublisherImplementation {
    requireOpen();
    const implementation = createRedisEventPublisher(config, {
      createClient(url) {
        return NodeRedis.createClient({ url }) as unknown as RedisEventPublisherClient;
      },
    });
    const publisher: RedisEventPublisherImplementation = {
      publish(event) {
        return implementation.publish(event);
      },
      subscribe(runId, handler) {
        return implementation.subscribe(runId, handler);
      },
      async close() {
        await implementation.close();
        publishers.delete(publisher);
      },
    };
    publishers.add(publisher);
    return publisher;
  }

  function createClientHandle(client: RedisClient): RedisClientHandle {
    let closed = false;
    let closePromise: Promise<void> | null = null;
    let exposedClient = exposedClients.get(client);
    if (!exposedClient) {
      exposedClient = bindClientMethods<RedisClient>(client, CLIENT_METHODS, {
        optionalMethods: OPTIONAL_CLIENT_METHODS,
        properties: ["isOpen"],
      });
      exposedClients.set(client, exposedClient);
    }
    const closeClient = (force: boolean): Promise<void> => {
      if (force) {
        closed = false;
        clientHandles.add(handle);
      }
      if (closed) {
        closed = true;
        clientHandles.delete(handle);
        failedSetupHandles.delete(handle);
        return Promise.resolve();
      }
      if (closePromise) return closePromise;

      const closing = Promise.resolve()
        .then(() => client.isOpen === false ? undefined : client.disconnect())
        .then(() => {
          closed = true;
          clientHandles.delete(handle);
          failedSetupHandles.delete(handle);
        });
      const tracked = closing.finally(() => {
        if (closePromise === tracked) closePromise = null;
      });
      closePromise = tracked;
      return tracked;
    };
    const handle: RedisClientHandle = {
      client: exposedClient,
      close() {
        return closeClient(false);
      },
    };
    forcedHandleClosers.set(handle, () => closeClient(true));
    clientHandles.add(handle);
    return handle;
  }

  async function drainFailedSetups(): Promise<void> {
    const results = await Promise.allSettled(
      [...failedSetupHandles].map((handle) => handle.close()),
    );
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "Redis failed-client cleanup failed");
    }
  }

  function openOwnedClient(
    options: RedisClientOptions = {},
    signal?: AbortSignal,
  ): Promise<RedisClientHandle> {
    requireOpen();
    const abortController = new AbortController();
    const abortFromCaller = () => abortController.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });
    openingAbortControllers.add(abortController);
    let provisionalHandle: RedisClientHandle | undefined;
    const opening = (async () => {
      await drainFailedSetups();
      requireOpen();
      let client: RedisClient;
      try {
        client = await connectClient(options, {
          signal: abortController.signal,
          onClientCreated(createdClient) {
            provisionalHandle = createClientHandle(createdClient);
            return forcedHandleClosers.get(provisionalHandle)!;
          },
        });
      } catch (error) {
        if (provisionalHandle && clientHandles.has(provisionalHandle)) {
          failedSetupHandles.add(provisionalHandle);
        }
        const failedClient = takeRedisClientSetupCleanupClient(error);
        if (failedClient && !provisionalHandle) {
          const failedHandle = createClientHandle(failedClient);
          failedSetupHandles.add(failedHandle);
        }
        throw error;
      }
      const handle = provisionalHandle ?? createClientHandle(client);
      if (state === "open" && !abortController.signal.aborted) return handle;

      await handle.close();
      throw abortController.signal.reason ?? new Error(`Redis runtime provider is ${state}`);
    })();
    const tracked = opening.finally(() => {
      openingAbortControllers.delete(abortController);
      signal?.removeEventListener("abort", abortFromCaller);
    });
    return tracked;
  }

  return {
    id: PROVIDER_ID,
    loadModule() {
      requireOpen();
      return Promise.resolve(moduleAdapter);
    },
    async getClient(options: RedisClientOptions = {}) {
      requireOpen();
      const client = await clientManager.getClient(options);
      let exposedClient = exposedClients.get(client);
      if (!exposedClient) {
        exposedClient = bindClientMethods<RedisClient>(client, CLIENT_METHODS, {
          optionalMethods: OPTIONAL_CLIENT_METHODS,
          properties: ["isOpen"],
        });
        exposedClients.set(client, exposedClient);
      }
      return exposedClient;
    },
    disconnectClient() {
      // Shared-client owners may outlive registry replacement or extension
      // teardown. The manager cleanup is therefore independently idempotent.
      return clientManager.disconnect();
    },
    openClient(options: RedisClientOptions = {}, signal?: AbortSignal) {
      return openOwnedClient(options, signal);
    },
    async createEventPublisher(config) {
      return createPublisher(config);
    },
    close() {
      if (closePromise) return closePromise;
      if (state === "closed") return Promise.resolve();
      state = "closing";
      for (const controller of openingAbortControllers) {
        controller.abort(new Error("Redis runtime provider is closing"));
      }
      const closing = Promise.allSettled([
        ...[...publishers].map((publisher) => publisher.close()),
        ...[...clientHandles].map((handle) => handle.close()),
        clientManager.disconnect(),
      ]).then((results) => {
        const failures = results
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason);
        if (failures.length === 0) {
          state = "closed";
          return;
        }
        state = "close-failed";
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(failures, "Redis runtime provider close failed");
        }
      }).finally(() => {
        if (closePromise === closing) closePromise = null;
      });
      closePromise = closing;
      return closing;
    },
  };
}
