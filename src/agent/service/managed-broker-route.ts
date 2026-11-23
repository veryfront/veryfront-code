import { decodeBrokerRunId } from "./broker-run-route.ts";

type RunRoute = { kind: "signedStream" | "cancel" | "resume"; runId: string };

type Route =
  | RunRoute
  | { kind: "durableStart" | "agUi" | "capabilities" | "liveness" | "ready" | "invalid" };

/** Resolve the fixed broker operation set without treating arbitrary application prefixes as authority. */
export function resolveManagedAgentBrokerRoute(
  method: string,
  pathname: string,
): Route | undefined {
  if (method === "GET" && pathname === "/liveness") return { kind: "liveness" };
  if (method === "GET" && pathname === "/readiness") return { kind: "ready" };
  if (method === "POST" && pathname === "/api/runs") return { kind: "durableStart" };
  if (method === "POST" && pathname === "/api/ag-ui") return { kind: "agUi" };
  if (method === "POST" && pathname === "/api/control-plane/runtime/capabilities") {
    return { kind: "capabilities" };
  }
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
  const runId = decodeBrokerRunId(value);
  return runId === null ? { kind: "invalid" } : { kind, runId };
}

/** Only exact managed operations bypass application routing and proxy source context. */
export function isManagedAgentBrokerRequest(method: string, pathname: string): boolean {
  const route = resolveManagedAgentBrokerRoute(method, pathname);
  return route !== undefined && route.kind !== "liveness" && route.kind !== "ready";
}
