/** Single-owner Redis transport for routing invalidation, with bounded startup and offline refusal. */
export interface RoutingRedisClient {
  readonly isReady?: boolean;
  connect(): Promise<unknown>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(
    channel: string,
    listener: (message: string, channel: string) => void,
  ): Promise<number | void>;
  unsubscribe(channel: string): Promise<number | void>;
  close(): void | Promise<void>;
  destroy(): void;
  on(event: "error", listener: (error: unknown) => void): unknown;
}
export interface RoutingRedisClientOptions {
  url: string;
  disableOfflineQueue: boolean;
  socket: { connectTimeout: number; reconnectStrategy: (retries: number) => number | Error };
}

/** Keep one bounded routing transport owner and refuse offline work. */
export function createRoutingRedisClient(
  createClient: (options: RoutingRedisClientOptions) => RoutingRedisClient,
  url: string,
) {
  type Subscription = {
    token: symbol;
    listener: (message: string, channel: string) => void;
    live: boolean;
    delivery?: { generation: number; listener: (message: string, channel: string) => void };
  };
  const subscriptions = new Map<string, Subscription>();
  const retiring = new Set<string>();
  const cancelWaiters = new Set<() => void>();
  const readyListeners = new Set<() => void>();
  const errorListeners = new Set<(error: unknown) => void>();
  const pendingCommands = new Map<number, number>();
  let recoveryBarrier = true;
  let connected = false;
  let ready = false;
  let transportReady = false;
  let stopped = false;
  let epoch = 0;
  let generation = 1;
  let restoring = false;
  let resetTimer: number | undefined;
  let draining: Promise<void> | undefined;
  let raw: RoutingRedisClient;
  let rawDisposed = false;
  const cancelOperations = () => {
    for (const cancel of cancelWaiters) cancel();
    cancelWaiters.clear();
  };
  const stop = () => {
    stopped = true;
    ready = false;
    transportReady = false;
    epoch++;
    generation++;
    if (resetTimer !== undefined) clearTimeout(resetTimer);
    resetTimer = undefined;
    cancelOperations();
    retiring.clear();
    subscriptions.clear();
    readyListeners.clear();
    errorListeners.clear();
    pendingCommands.clear();
  };
  const destroy = () => {
    stop();
    try {
      if (!rawDisposed) raw.destroy();
      rawDisposed = true;
    } catch (error) {
      if (!(error instanceof Error) || error.constructor.name !== "ClientClosedError") throw error;
    }
  };
  const command = async <T>(owner: number, operation: () => Promise<T>): Promise<T> => {
    pendingCommands.set(owner, (pendingCommands.get(owner) ?? 0) + 1);
    try {
      const value = await operation();
      if (stopped || owner !== generation) {
        throw new Error("Routing Redis connection generation changed");
      }
      return value;
    } finally {
      const remaining = (pendingCommands.get(owner) ?? 1) - 1;
      if (remaining > 0) pendingCommands.set(owner, remaining);
      else pendingCommands.delete(owner);
    }
  };
  const reset = (owner: number) => {
    if (stopped || owner !== generation || resetTimer !== undefined) return;
    const previous = raw;
    ready = false;
    transportReady = false;
    recoveryBarrier = true;
    epoch++;
    generation++;
    cancelOperations();
    for (const listener of errorListeners) {
      try {
        listener(new Error("Routing Redis connection reset"));
      } catch { /* Diagnostics cannot own recovery. */ }
    }
    // Invalidate every old event/result before disposal. An uncertain disposal cannot create another owner.
    try {
      previous.destroy();
    } catch {
      stop();
      return;
    }
    rawDisposed = true;
    pendingCommands.delete(owner);
    for (const [channel, subscription] of subscriptions) {
      if (!subscription.live || retiring.has(channel)) subscriptions.delete(channel);
    }
    retiring.clear();
    restoring = true;
    resetTimer = setTimeout(() => {
      resetTimer = undefined;
      if (stopped) return;
      try {
        installRaw();
        const current = raw;
        const owner = generation;
        void current.connect().catch(() => {
          if (!stopped && owner === generation) reset(owner);
        });
      } catch {
        stop();
      }
    }, 1_000);
  };
  const boundedRetirement = async (owner: number, operation: Promise<unknown>) => {
    let timer: number | undefined;
    let cancel: (() => void) | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          cancel = () => reject(new Error("Routing Redis connection generation changed"));
          cancelWaiters.add(cancel);
          timer = setTimeout(() => {
            reset(owner);
            reject(new Error("Routing Redis subscription retirement timed out"));
          }, 3_000);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (cancel) cancelWaiters.delete(cancel);
    }
  };
  const delivery = (channel: string, subscription: Subscription, owner: number) => {
    if (subscription.delivery?.generation === owner) return subscription.delivery.listener;
    const listener = (message: string, receivedChannel: string) => {
      if (
        !stopped && owner === generation && subscriptions.get(channel) === subscription &&
        !retiring.has(channel)
      ) {
        subscription.listener(message, receivedChannel);
      }
    };
    subscription.delivery = { generation: owner, listener };
    return listener;
  };
  const markReady = () => {
    if (stopped || !transportReady || restoring || retiring.size > 0 || draining) return;
    recoveryBarrier = false;
    if (ready) return;
    ready = true;
    for (const listener of readyListeners) {
      try {
        listener();
      } catch { /* Diagnostics cannot own transport readiness. */ }
    }
  };
  const drain = (): void => {
    if (stopped || !transportReady || draining || resetTimer !== undefined) return;
    if (!restoring && retiring.size === 0) {
      markReady();
      return;
    }
    if (recoveryBarrier) ready = false;
    const drainEpoch = epoch;
    const owner = generation;
    const current = raw;
    const task = (async () => {
      if (restoring) {
        for (const [channel, subscription] of subscriptions) {
          if (!subscription.live || retiring.has(channel)) continue;
          if (stopped || !transportReady || generation !== owner || epoch !== drainEpoch) return;
          await boundedRetirement(
            owner,
            command(
              owner,
              () => current.subscribe(channel, delivery(channel, subscription, owner)),
            ),
          );
          if (stopped || !transportReady || generation !== owner || epoch !== drainEpoch) return;
        }
        restoring = false;
      }
      for (const channel of retiring) {
        if (stopped || !transportReady || generation !== owner || epoch !== drainEpoch) return;
        await boundedRetirement(owner, command(owner, () => current.unsubscribe(channel)));
        if (stopped || !transportReady || generation !== owner || epoch !== drainEpoch) return;
        retiring.delete(channel);
        subscriptions.delete(channel);
      }
    })().catch(() => {
      if (!stopped && generation === owner && transportReady && epoch === drainEpoch) reset(owner);
    }).finally(() => {
      if (draining === task) draining = undefined;
      if (!stopped && transportReady && resetTimer === undefined) {
        if (restoring || retiring.size > 0) drain();
        else markReady();
      }
    });
    draining = task;
  };
  const disconnected = (owner: number) => {
    if (stopped || owner !== generation) return;
    recoveryBarrier = true;
    ready = false;
    transportReady = false;
    epoch++;
  };
  const installRaw = () => {
    const owner = generation;
    const current = createClient({
      url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 3_000,
        reconnectStrategy: (retries) => {
          if (stopped || owner !== generation || (!connected && retries >= 5)) {
            return new Error("Routing Redis connection retry stopped");
          }
          return Math.min(100 * 2 ** Math.min(retries, 4), 1_000);
        },
      },
    });
    raw = current;
    rawDisposed = false;
    const listen = current.on.bind(current);
    Reflect.apply(listen, undefined, ["ready", () => {
      if (stopped || owner !== generation) return;
      connected = true;
      recoveryBarrier = true;
      transportReady = true;
      epoch++;
      ready = false;
      drain();
    }]);
    Reflect.apply(listen, undefined, ["error", (error: unknown) => {
      if (stopped || owner !== generation) return;
      let usable = false;
      try {
        usable = current.isReady === true;
      } catch { /* Missing readiness is not authority. */ }
      if (!usable) disconnected(owner);
      for (const listener of errorListeners) {
        try {
          listener(error);
        } catch { /* Diagnostics cannot own the transport. */ }
      }
    }]);
    Reflect.apply(listen, undefined, ["reconnecting", () => disconnected(owner)]);
    Reflect.apply(listen, undefined, ["end", () => {
      if (stopped || owner !== generation) return;
      disconnected(owner);
      if (!connected) {
        try {
          destroy();
        } catch {
          stop();
        }
      } else reset(owner);
    }]);
  };
  installRaw();
  const requireReady = () => {
    if (!ready || stopped) throw new Error("Routing Redis connection is not ready");
  };
  return Object.freeze({
    async connect() {
      if (stopped) throw new Error("Routing Redis connection is stopped");
      const owner = generation;
      const current = raw;
      await current.connect();
      if (stopped || owner !== generation) {
        throw new Error("Routing Redis connection generation changed");
      }
    },
    async publish(channel: string, message: string) {
      requireReady();
      const owner = generation;
      const current = raw;
      return await command(owner, () => current.publish(channel, message));
    },
    async subscribe(channel: string, listener: (message: string, channel: string) => void) {
      requireReady();
      if (subscriptions.has(channel)) throw new Error("Routing Redis channel is already owned");
      if (subscriptions.size >= 512) {
        throw new Error("Routing Redis subscription capacity exhausted");
      }
      const subscription: Subscription = {
        token: Symbol("routing-subscription"),
        listener,
        live: false,
      };
      subscriptions.set(channel, subscription);
      const owner = generation;
      const current = raw;
      try {
        await command(
          owner,
          () => current.subscribe(channel, delivery(channel, subscription, owner)),
        );
        if (subscriptions.get(channel) !== subscription || retiring.has(channel)) {
          throw new Error("Routing Redis subscription ownership changed");
        }
        subscription.live = true;
      } catch (error) {
        if (!stopped && owner === generation && subscriptions.get(channel) === subscription) {
          retiring.add(channel);
          recoveryBarrier = true;
          ready = false;
          drain();
        }
        throw error;
      }
    },
    async unsubscribe(channel: string) {
      if (stopped) throw new Error("Routing Redis connection is stopped");
      const subscription = subscriptions.get(channel);
      if (!subscription) return;
      retiring.add(channel);
      if (recoveryBarrier) ready = false;
      if (!transportReady) throw new Error("Routing Redis connection is not ready");
      while (!stopped && transportReady && subscriptions.get(channel) === subscription) {
        drain();
        const currentDrain = draining;
        if (!currentDrain) break;
        await currentDrain;
      }
      if (subscriptions.get(channel) === subscription || stopped) {
        throw new Error("Routing Redis subscription retirement not confirmed");
      }
    },
    async close() {
      if (stopped) return;
      const current = raw;
      const mustDestroy = !transportReady || (pendingCommands.get(generation) ?? 0) > 0 ||
        retiring.size > 0 || restoring || resetTimer !== undefined;
      if (mustDestroy) {
        destroy();
        return;
      }
      stop();
      try {
        await current.close();
      } catch (error) {
        if (!(error instanceof Error) || error.constructor.name !== "ClientClosedError") {
          throw error;
        }
      }
    },
    destroy,
    on(event: "error", listener: (error: unknown) => void) {
      if (String(event) === "ready") { if (!stopped) readyListeners.add(listener as () => void); }
      else if (String(event) === "error" && !stopped) errorListeners.add(listener);
    },
  });
}
