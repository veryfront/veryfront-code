import { resolveManagedAgentBrokerRoute } from "./managed-broker-route.ts";
import {
  createVeryfrontServer,
  type NodeVeryfrontServiceServer,
  startNodeVeryfrontServer,
  type VeryfrontServiceServerLogger,
} from "../../server/service-server.ts";

/** Trusted broker route handler and optional retirement hook. */
export interface ManagedNodeBrokerHandler {
  handle(request: Request, input: { runId?: string }): Response | Promise<Response>;
  close?: () => void | Promise<void>;
}

/** Broker admission and settlement lifecycle retained by the HTTP server. */
export interface ManagedNodeBrokerPool {
  shutdown(): Promise<unknown>;
  readonly closed: Promise<unknown>;
  readonly settled: Promise<void>;
}

/** Bind managed routes and stop admission before joining all work during shutdown. */
export async function startNodeManagedAgentBroker(options: {
  port: number;
  bindAddress?: string;
  signals?: readonly NodeJS.Signals[];
  hardShutdownTimeoutMs?: number;
  logger?: VeryfrontServiceServerLogger;
  broker: ManagedNodeBrokerPool;
  readiness(): boolean | Promise<boolean>;
  handlers: {
    signedStream: ManagedNodeBrokerHandler;
    durableStart: ManagedNodeBrokerHandler;
    agUi: ManagedNodeBrokerHandler;
    cancel: ManagedNodeBrokerHandler;
    resume: ManagedNodeBrokerHandler;
    /** Trusted signed metadata verifier; omission refuses protocol probing. */
    capabilities?: ManagedNodeBrokerHandler;
  };
}): Promise<NodeVeryfrontServiceServer> {
  validateOptions(options);
  let shuttingDown = false;
  let shutdown: Promise<unknown> | undefined;
  const beginShutdown = () => {
    shuttingDown = true;
    if (!shutdown) {
      shutdown = (async () => await options.broker.shutdown())();
    }
    void shutdown.catch(() => {});
    return shutdown;
  };
  const handlers = Object.values(options.handlers).filter(
    (handler): handler is ManagedNodeBrokerHandler => handler !== undefined,
  );
  const runtime = createVeryfrontServer({
    logger: options.logger,
    modules: [{
      name: "managed-agent-broker",
      async handle(request) {
        const url = new URL(request.url);
        const route = resolveManagedAgentBrokerRoute(request.method, url.pathname);
        if (route?.kind === "invalid") {
          return Response.json({ errorCode: "BROKER_INGRESS_TARGET_MISMATCH" }, { status: 400 });
        }
        if (route?.kind === "liveness") return new Response("OK");
        if (route?.kind === "ready") {
          const ready = !shuttingDown && await options.readiness();
          return new Response(ready ? "OK" : shuttingDown ? "Shutting down" : "Not Ready", {
            status: ready ? 200 : 503,
          });
        }
        if (!route) return null;
        if (shuttingDown) {
          return Response.json({ errorCode: "BROKER_UNAVAILABLE" }, { status: 503 });
        }
        const handler = options.handlers[route.kind];
        if (!handler || (route.kind === "capabilities" && !await options.readiness())) {
          return Response.json({ errorCode: "BROKER_UNAVAILABLE" }, { status: 503 });
        }
        return await handler.handle(request, {
          ...("runId" in route ? { runId: route.runId } : {}),
        });
      },
      setShuttingDown() {
        void beginShutdown();
      },
      async stop() {
        const results = await Promise.allSettled([
          beginShutdown(),
          options.broker.closed,
          options.broker.settled,
          ...[...new Set(handlers)].map((handler) =>
            Promise.resolve().then(() => handler.close?.())
          ),
        ]);
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      },
    }],
  });
  const server = await startNodeVeryfrontServer({
    runtime,
    port: options.port,
    bindAddress: options.bindAddress,
    signals: options.signals,
    hardShutdownTimeoutMs: options.hardShutdownTimeoutMs,
    logger: options.logger,
  });
  await server.ready;
  return server;
}

function validateOptions(options: {
  broker: ManagedNodeBrokerPool;
  readiness: unknown;
  handlers: Record<string, ManagedNodeBrokerHandler | undefined>;
}): void {
  if (
    !options.broker || typeof options.broker.shutdown !== "function" ||
    !(options.broker.closed instanceof Promise) || !(options.broker.settled instanceof Promise) ||
    typeof options.readiness !== "function"
  ) throw new TypeError("Managed broker lifecycle configuration is incomplete");
  for (const name of ["signedStream", "durableStart", "agUi", "cancel", "resume"]) {
    if (typeof options.handlers?.[name]?.handle !== "function") {
      throw new TypeError("Managed broker route configuration is incomplete");
    }
  }
  if (
    options.handlers.capabilities !== undefined &&
    typeof options.handlers.capabilities.handle !== "function"
  ) throw new TypeError("Managed broker capability verifier is invalid");
}
