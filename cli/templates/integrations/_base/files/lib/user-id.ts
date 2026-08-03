import type { ToolExecutionContext } from "veryfront/tool";

function normalizeUserId(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024) {
    return null;
  }
  return value.trim() === value ? value : null;
}

/**
 * Application-owned session/JWT lookup.
 *
 * Replace this implementation with a server-side session lookup or verified
 * JWT check. There is deliberately no environment-gated default, because an
 * ambient identity collapses every visitor onto a single OAuth token owner.
 */
export async function resolveAuthenticatedUserId(
  _request: Request,
): Promise<string | null> {
  throw new Error(
    "Authenticated request identity is not configured. Implement " +
      "resolveAuthenticatedUserId in lib/user-id.ts using a verified session or JWT.",
  );
}

/** Resolve and validate the authenticated user for an OAuth request. */
export async function requireUserIdFromRequest(
  request: Request,
): Promise<string | null> {
  return normalizeUserId(await resolveAuthenticatedUserId(request));
}

export function requireUserIdFromContext(
  context?: ToolExecutionContext,
): string {
  const userId = normalizeUserId(context?.userId);
  if (userId) return userId;
  throw new Error("Authenticated tool context userId is required");
}
