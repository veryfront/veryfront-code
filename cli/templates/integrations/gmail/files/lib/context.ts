import type { ToolExecutionContext } from "veryfront/tool";

export function resolveUserId(context?: ToolExecutionContext): string {
  if (typeof context?.endUserId === "string" && context.endUserId.length > 0) {
    return context.endUserId;
  }

  if (typeof context?.userId === "string" && context.userId.length > 0) {
    return context.userId;
  }

  return "current-user";
}
