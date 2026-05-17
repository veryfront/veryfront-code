import type { ToolExecutionContext } from "veryfront/tool";

function isProductionRuntime(): boolean {
  return Deno.env.get("NODE_ENV") === "production";
}

function devUserId(): string {
  return Deno.env.get("VERYFRONT_DEV_USER_ID") ?? "dev-user";
}

function requireUserId(value: string | null | undefined): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (!isProductionRuntime()) {
    return devUserId();
  }

  throw new Error(
    "Authenticated user id is required in production. " +
      "Pass the authenticated user's id from your session, JWT, or auth provider.",
  );
}

export function requireUserIdFromRequest(request: Request): string {
  return requireUserId(
    request.headers.get("x-veryfront-user-id") ?? request.headers.get("x-user-id"),
  );
}

export function requireUserIdFromContext(context?: ToolExecutionContext): string {
  return requireUserId(context?.endUserId ?? context?.userId);
}
