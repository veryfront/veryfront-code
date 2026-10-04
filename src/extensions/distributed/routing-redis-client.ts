/** Single-owner Redis transport for routing invalidation, with bounded startup and offline refusal. */
export interface RoutingRedisClient {
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

/** Keep node-redis as the only reconnect owner; never queue routing work while offline. */
export function createRoutingRedisClient(
  createClient: (options: RoutingRedisClientOptions) => RoutingRedisClient,
  url: string,
) {
  const subscriptions = new Map<string, symbol>();
  const retiring = new Set<string>();
  const cancelWaiters = new Set<() => void>();
  const readyListeners = new Set<() => void>();
  let recoveryBarrier = true;
  let connected = false;
  let ready = false;
  let transportReady = false;
  let stopped = false;
  let epoch = 0;
  let pendingCommands = 0;
  let draining: Promise<void> | undefined;
  const raw = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 3_000,
      reconnectStrategy: (retries) => {
        if (stopped || (!connected && retries >= 5)) {
          return new Error("Routing Redis connection retry stopped");
        }
        return Math.min(100 * 2 ** Math.min(retries, 4), 1_000);
      },
    },
  });
  const listen = raw.on.bind(raw);
  const stop = () => {
    stopped = true;
    ready = false;
    transportReady = false;
    epoch++;
    for (const cancel of cancelWaiters) cancel();
    cancelWaiters.clear();
    retiring.clear();
    subscriptions.clear();
    readyListeners.clear();
  };
  const destroy = () => {
    stop();
    try {
      raw.destroy();
    } catch (error) {
      if (!(error instanceof Error) || error.constructor.name !== "ClientClosedError") throw error;
    }
  };
  const command = async <T>(operation: () => Promise<T>): Promise<T> => {
    pendingCommands++;
    try {
      return await operation();
    } finally {
      pendingCommands--;
    }
  };
  const boundedRetirement = async (operation: Promise<unknown>) => {
    let timer: number | undefined;
    let cancel: (() => void) | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          cancel = () => reject(new Error("Routing Redis connection is stopped"));
          cancelWaiters.add(cancel);
          timer = setTimeout(() => {
            try {
              destroy();
            } catch { /* Readiness stays stopped even if transport disposal fails. */ }
            reject(new Error("Routing Redis subscription retirement timed out"));
          }, 3_000);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (cancel) cancelWaiters.delete(cancel);
    }
  };
  const markReady = () => {
    if (stopped || !transportReady || retiring.size > 0 || draining) return;
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
    if (stopped || !transportReady || draining) return;
    if (retiring.size === 0) {
      markReady();
      return;
    }
    if (recoveryBarrier) ready = false;
    const drainEpoch = epoch;
    draining = (async () => {
      for (const channel of retiring) {
        if (stopped || !transportReady || epoch !== drainEpoch) return;
        await boundedRetirement(command(() => raw.unsubscribe(channel)));
        if (stopped || !transportReady || epoch !== drainEpoch) return;
        retiring.delete(channel);
        subscriptions.delete(channel);
      }
    })().catch(() => {
      // A connection failure retains uncertain channels for its next actual ready epoch.
      // A protocol failure in the same ready epoch cannot safely discard ownership.
      if (!stopped && transportReady && epoch === drainEpoch) {
        try {
          destroy();
        } catch { /* Stopped readiness survives a secondary disposal failure. */ }
      }
    }).finally(() => {
      draining = undefined;
      if (!stopped && transportReady) {
        if (retiring.size > 0) drain();
        else markReady();
      }
    });
  };
  Reflect.apply(listen, undefined, ["ready", () => {
    if (stopped) return;
    connected = true;
    recoveryBarrier = true;
    transportReady = true;
    epoch++;
    ready = false;
    drain();
  }]);
  const disconnected = () => {
    recoveryBarrier = true;
    ready = false;
    transportReady = false;
    epoch++;
  };
  Reflect.apply(listen, undefined, ["error", disconnected]);
  Reflect.apply(listen, undefined, ["reconnecting", disconnected]);
  const requireReady = () => {
    if (!ready || stopped) throw new Error("Routing Redis connection is not ready");
  };
  return Object.freeze({
    async connect() {
      if (stopped) throw new Error("Routing Redis connection is stopped");
      await raw.connect();
    },
    async publish(channel: string, message: string) {
      requireReady();
      return await command(() => raw.publish(channel, message));
    },
    async subscribe(channel: string, listener: (message: string, channel: string) => void) {
      requireReady();
      if (subscriptions.has(channel)) throw new Error("Routing Redis channel is already owned");
      if (subscriptions.size >= 512) {
        throw new Error("Routing Redis subscription capacity exhausted");
      }
      const subscription = Symbol("routing-subscription");
      subscriptions.set(channel, subscription);
      try {
        await command(() => raw.subscribe(channel, listener));
      } catch (error) {
        if (!stopped && subscriptions.get(channel) === subscription) {
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
      const mustDestroy = !transportReady || pendingCommands > 0 || retiring.size > 0;
      if (mustDestroy) {
        destroy();
        return;
      }
      stop();
      try {
        await raw.close();
      } catch (error) {
        if (!(error instanceof Error) || error.constructor.name !== "ClientClosedError") {
          throw error;
        }
      }
    },
    destroy,
    on(event: "error", listener: (error: unknown) => void) {
      if (String(event) === "ready") {
        if (!stopped) readyListeners.add(listener as () => void);
        return;
      }
      listen(event, listener);
    },
  });
}
