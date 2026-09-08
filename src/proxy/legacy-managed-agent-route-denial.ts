import { isControlPlaneSurfaceRoute } from "#veryfront/channels/control-plane.ts";
import { normalizeProxyOriginFormPath } from "./request-path.ts";

export const LEGACY_MANAGED_AGENT_ROUTE_DENY_ENV =
  "VERYFRONT_PROXY_DENY_LEGACY_MANAGED_AGENT_ROUTES";

const DURABLE_RUN_PATH = /^\/api\/runs\/[^/]+$/u;
const DURABLE_RUN_RESUME_PATH = /^\/api\/runs\/[^/]+\/resume$/u;

/**
 * Parse the trusted proxy switch that retires renderer-owned managed agent routes.
 *
 * The switch is deliberately dormant unless an operator supplies an exact
 * boolean string. Rejecting malformed values prevents a misspelled cutover
 * setting from silently leaving the legacy credential path available.
 */
export function parseLegacyManagedAgentRouteDeny(raw: string | undefined): boolean {
  if (raw === undefined || raw === "" || raw === "false") return false;
  if (raw === "true") return true;
  throw new TypeError(
    `${LEGACY_MANAGED_AGENT_ROUTE_DENY_ENV} must be exactly true or false`,
  );
}

/** True only for legacy managed agent routes currently served by project runtimes. */
export function isLegacyManagedAgentRoute(method: string, pathname: string): boolean {
  const normalizedMethod = method.toUpperCase();
  const normalizedPathname = normalizeProxyRoutePolicyPathname(pathname);
  if (isControlPlaneSurfaceRoute(normalizedMethod, normalizedPathname)) return true;
  if (normalizedMethod === "POST") {
    return normalizedPathname === "/api/ag-ui" || normalizedPathname === "/api/runs" ||
      DURABLE_RUN_RESUME_PATH.test(normalizedPathname);
  }
  return normalizedMethod === "DELETE" && DURABLE_RUN_PATH.test(normalizedPathname);
}

/** Match the path identity used by renderer app-route discovery. */
export function normalizeProxyRoutePolicyPathname(pathname: string): string {
  const originFormPathname = normalizeProxyOriginFormPath(pathname);
  const segments = originFormPathname.split("/");
  let normalizedPathname = "";
  for (const segment of segments) {
    if (segment.length > 0) normalizedPathname += `/${segment}`;
  }
  return normalizedPathname || "/";
}
