import { resolveManagedAgentBrokerRoute } from "./managed-broker-route.ts";
import type { ManagedNodeBrokerHandler } from "./managed-node-broker.ts";

/** Deployment-owned handlers; each operation retains its own authentication and authority checks. */
export interface ManagedAgentBrokerIngressOptions {
  handlers: {
    signedStream: ManagedNodeBrokerHandler;
    durableStart: ManagedNodeBrokerHandler;
    agUi: ManagedNodeBrokerHandler;
    cancel: ManagedNodeBrokerHandler;
    resume: ManagedNodeBrokerHandler;
    capabilities?: ManagedNodeBrokerHandler;
  };
  readiness(): boolean | Promise<boolean>;
}

/** Mount exact managed-agent routes without routing them through application HTTP or project discovery. */
export function createManagedAgentBrokerIngress(options: ManagedAgentBrokerIngressOptions) {
  if (typeof options.readiness !== "function") {
    throw new TypeError("Missing managed agent readiness");
  }
  const readiness = options.readiness.bind(options);
  const handlers = Object.fromEntries(
    Object.entries(options.handlers).map(([name, handler]) => {
      if (typeof handler?.handle !== "function") {
        throw new TypeError("Invalid managed agent handler");
      }
      return [name, handler.handle.bind(handler)];
    }),
  );
  for (const name of ["signedStream", "durableStart", "agUi", "cancel", "resume"]) {
    if (!handlers[name]) throw new TypeError("Missing managed agent handler");
  }
  return async (request: Request): Promise<Response | null> => {
    const route = resolveManagedAgentBrokerRoute(request.method, new URL(request.url).pathname);
    // Readiness and liveness remain owned by the containing production server.
    if (!route || route.kind === "ready" || route.kind === "liveness") return null;
    if (route.kind === "invalid") {
      return Response.json({ errorCode: "BROKER_INGRESS_TARGET_MISMATCH" }, { status: 400 });
    }
    const handle = handlers[route.kind];
    if (!handle || (route.kind === "capabilities" && !await readiness())) {
      return Response.json({ errorCode: "BROKER_UNAVAILABLE" }, { status: 503 });
    }
    const response = await handle(request, { ...("runId" in route ? { runId: route.runId } : {}) });
    if (!(response instanceof Response)) throw new TypeError("Invalid managed agent response");
    return response;
  };
}
