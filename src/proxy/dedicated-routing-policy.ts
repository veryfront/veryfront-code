/** Host-private dedicated routing policy. Tenant source never selects this mode. */
export const REQUIRE_DEDICATED_ROUTING_ENV = "VERYFRONT_REQUIRE_DEDICATED_ROUTING";

export function parseRequiredDedicatedRouting(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new TypeError(`${REQUIRE_DEDICATED_ROUTING_ENV} must be true or false`);
}

export function retryDedicatedTarget(
  assignedUrl: string | null,
  requireDedicatedRouting: boolean,
): { pinnedDedicatedUrl: string | null; skipDedicated: boolean } {
  if (!assignedUrl) return { pinnedDedicatedUrl: null, skipDedicated: false };
  return requireDedicatedRouting
    ? { pinnedDedicatedUrl: assignedUrl, skipDedicated: false }
    : { pinnedDedicatedUrl: null, skipDedicated: true };
}

/** A resolved project cannot silently lose its assignment lookup identity. */
export function hasDedicatedAssignmentContext(
  projectSlug: string | undefined,
  environmentId: string | undefined,
  requireDedicatedRouting: boolean,
): boolean {
  return !requireDedicatedRouting || !projectSlug || Boolean(environmentId);
}

/** In strict mode a verified assignment selects the renderer WebSocket hop. */
export function websocketRendererOrigin(
  sharedOrigin: string,
  assignedOrigin: string | null,
  requireDedicatedRouting: boolean,
): string {
  return requireDedicatedRouting && assignedOrigin ? assignedOrigin : sharedOrigin;
}
