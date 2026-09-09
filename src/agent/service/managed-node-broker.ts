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
  const handlers = Object.values(options.handlers);
  const runtime = createVeryfrontServer({
    logger: options.logger,
    modules: [{
      name: "managed-agent-broker",
      async handle(request) {
        const url = new URL(request.url);
        const route = resolveRoute(request.method, url.pathname);
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
        return await options.handlers[route.kind].handle(request, {
          ...("runId" in route ? { runId: route.runId } : {}),
        });
      },
      setShuttingDown() {
        beginShutdown();
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

type RunRoute = { kind: "signedStream" | "cancel" | "resume"; runId: string };

type Route =
  | RunRoute
  | { kind: "durableStart" | "agUi" | "liveness" | "ready" | "invalid" };

function resolveRoute(method: string, pathname: string): Route | undefined {
  if (method === "GET" && pathname === "/liveness") return { kind: "liveness" };
  if (method === "GET" && pathname === "/readiness") return { kind: "ready" };
  if (method === "POST" && pathname === "/api/runs") return { kind: "durableStart" };
  if (method === "POST" && pathname === "/api/ag-ui") return { kind: "agUi" };
  const signed = /^\/api\/control-plane\/runs\/([^/]+)\/stream$/u.exec(pathname);
  if (method === "POST" && signed) return decodeRunRoute("signedStream", signed[1]!);
  const resume = /^\/api\/runs\/([^/]+)\/resume$/u.exec(pathname);
  if (method === "POST" && resume) return decodeRunRoute("resume", resume[1]!);
  const controlResume = /^\/api\/control-plane\/runs\/([^/]+)\/resume$/u.exec(pathname);
  if (method === "POST" && controlResume) {
    return decodeRunRoute("resume", controlResume[1]!);
  }
  const cancel = /^\/api\/runs\/([^/]+)$/u.exec(pathname);
  if (method === "DELETE" && cancel) return decodeRunRoute("cancel", cancel[1]!);
  const controlCancel = /^\/api\/control-plane\/runs\/([^/]+)$/u.exec(pathname);
  if (method === "DELETE" && controlCancel) {
    return decodeRunRoute("cancel", controlCancel[1]!);
  }
  return undefined;
}

function decodeRunRoute(kind: RunRoute["kind"], value: string): Route {
  let runId: string;
  try {
    runId = decodeURIComponent(value);
  } catch {
    return { kind: "invalid" };
  }
  return runId && !runId.includes("/") ? { kind, runId } : { kind: "invalid" };
}

function validateOptions(options: {
  broker: ManagedNodeBrokerPool;
  readiness: unknown;
  handlers: Record<string, ManagedNodeBrokerHandler>;
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
}
