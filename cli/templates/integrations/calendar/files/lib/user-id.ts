import type { ToolExecutionContext } from "veryfront/tool";

export function requireUserIdFromContext(
  context?: ToolExecutionContext,
): string {
  const userId = context?.userId;
  if (!userId) {
    throw new Error("Calendar tool execution requires an authenticated user.");
  }
  return userId;
}
