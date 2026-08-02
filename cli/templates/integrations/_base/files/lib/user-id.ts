import type { ToolExecutionContext } from "veryfront/tool";

function isDevelopmentRuntime(): boolean {
  const mode = Deno.env.get("NODE_ENV") ?? Deno.env.get("DENO_ENV");
  return mode === "development" || mode === "test";
}

function devUserId(): string {
  return Deno.env.get("VERYFRONT_DEV_USER_ID") ?? "dev-user";
}

function requireUserId(value: string | null | undefined): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (isDevelopmentRuntime()) {
    return devUserId();
  }

  throw new Error(
    "Authenticated user id is required outside explicit development and test modes. " +
      "Pass the authenticated user's id from your session, JWT, or auth provider.",
  );
}

export function requireUserIdFromRequest(_request: Request): string {
  if (isDevelopmentRuntime()) {
    return devUserId();
  }

  throw new Error(
    "Authenticated request identity is not configured. " +
      "Implement requireUserIdFromRequest in lib/user-id.ts using your verified session, JWT, or auth provider.",
  );
}

export function requireUserIdFromContext(context?: ToolExecutionContext): string {
  return requireUserId(context?.userId);
}
