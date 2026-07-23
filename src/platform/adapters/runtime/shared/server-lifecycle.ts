import type { RuntimeRequestHandler, ServeOptions, Server } from "../../base.ts";
import { SERVER_START_ERROR } from "#veryfront/errors/error-registry/server.ts";

type ServerFactory = (handler: RuntimeRequestHandler, options: ServeOptions) => Promise<Server>;
type ServerSetter = (server: Server) => void;

export type ServerLifecycleState = "idle" | "starting" | "running" | "stopping";

export interface ServerLifecycle {
  readonly state: ServerLifecycleState;
  serve(handler: RuntimeRequestHandler, options?: ServeOptions): Promise<Server>;
  shutdown(): Promise<void>;
}

export function createServerLifecycle(createServer: ServerFactory): ServerLifecycle {
  let state: ServerLifecycleState = "idle";
  let activeServer: Server | null = null;
  let startup: Promise<Server> | null = null;
  let shutdownPromise: Promise<void> | null = null;
  let removeAbortListener: () => void = () => {};

  const lifecycle: ServerLifecycle = {
    get state(): ServerLifecycleState {
      return state;
    },

    async serve(handler: RuntimeRequestHandler, options: ServeOptions = {}): Promise<Server> {
      if (state !== "idle") {
        throw SERVER_START_ERROR.create({ message: "A runtime server is already active" });
      }
      options.signal?.throwIfAborted();

      state = "starting";
      const signal = options.signal;
      const factoryOptions = { ...options };
      const currentStartup = Promise.resolve().then(() => createServer(handler, factoryOptions));
      startup = currentStartup;
      if (signal) {
        const onAbort = (): void => {
          void lifecycle.shutdown().catch(() => {});
        };
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", onAbort);
      }
      try {
        const server = await currentStartup;
        if (state === "starting") {
          activeServer = server;
          state = "running";
        }
        return {
          get addr(): { hostname: string; port: number } {
            return server.addr;
          },
          stop: () => lifecycle.shutdown(),
        };
      } catch (error) {
        if (state === "starting") {
          state = "idle";
          removeAbortListener();
          removeAbortListener = () => {};
        }
        throw error;
      } finally {
        if (startup === currentStartup) startup = null;
      }
    },

    shutdown(): Promise<void> {
      if (shutdownPromise) return shutdownPromise;

      const operation = async (): Promise<void> => {
        if (state === "idle") return;

        let server: Server;
        if (state === "starting") {
          state = "stopping";
          try {
            server = await startup!;
          } catch {
            state = "idle";
            removeAbortListener();
            removeAbortListener = () => {};
            return;
          }
        } else if (state === "running") {
          state = "stopping";
          server = activeServer!;
        } else {
          return;
        }

        try {
          await server.stop();
          if (activeServer === server) activeServer = null;
          state = "idle";
          removeAbortListener();
          removeAbortListener = () => {};
        } catch (error) {
          activeServer = server;
          state = "running";
          throw error;
        }
      };

      const pendingShutdown = operation().finally(() => {
        if (shutdownPromise === pendingShutdown) shutdownPromise = null;
      });
      shutdownPromise = pendingShutdown;
      return pendingShutdown;
    },
  };

  return lifecycle;
}

export function createServeHandler(createServer: ServerFactory, setActive: ServerSetter) {
  return (
    handler: RuntimeRequestHandler,
    options: ServeOptions = {},
  ): Promise<Server> => {
    return startManagedServer(createServer, handler, options, setActive);
  };
}

async function startManagedServer(
  createServer: ServerFactory,
  handler: RuntimeRequestHandler,
  options: ServeOptions,
  setActive: (server: Server) => void,
): Promise<Server> {
  const server = await createServer(handler, options);
  setActive(server);
  return server;
}

export async function stopManagedServer<T extends Server>(server: T | null): Promise<T | null> {
  if (!server) return null;
  await server.stop();
  return null;
}
