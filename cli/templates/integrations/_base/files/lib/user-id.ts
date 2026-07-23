import type { ToolExecutionContext } from "veryfront/tool";

export type RequestIdentityResolver = (
  request: Request,
) => string | null | Promise<string | null>;

const IDENTITY_RESOLVER_KEY = Symbol.for(
  "veryfront.application.request-identity-resolver",
);
const registry = globalThis as unknown as Record<PropertyKey, unknown>;

function normalizeUserId(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024) {
    return null;
  }
  return value.trim() === value ? value : null;
}

/**
 * Install the application's verified session/JWT identity resolver.
 *
 * The resolver must authenticate the request using server-side session state
 * or a cryptographically verified token. Never copy an untrusted request
 * header into the returned user id.
 */
export function installRequestIdentityResolver(
  resolver: RequestIdentityResolver,
): void {
  if (typeof resolver !== "function") {
    throw new TypeError("Request identity resolver must be a function");
  }
  const existing = registry[IDENTITY_RESOLVER_KEY];
  if (existing !== undefined && existing !== resolver) {
    throw new Error("Request identity resolver has already been installed");
  }
  registry[IDENTITY_RESOLVER_KEY] = resolver;
}

export async function requireUserIdFromRequest(
  request: Request,
): Promise<string | null> {
  const resolver = registry[IDENTITY_RESOLVER_KEY];
  if (typeof resolver !== "function") {
    throw new Error(
      "Request identity resolver is not configured. Install a verified session/JWT " +
        "resolver during application startup.",
    );
  }

  return normalizeUserId(await (resolver as RequestIdentityResolver)(request));
}

export function requireUserIdFromContext(
  context?: ToolExecutionContext,
): string {
  const userId = normalizeUserId(context?.userId);
  if (userId) return userId;
  throw new Error("Authenticated tool context userId is required");
}
