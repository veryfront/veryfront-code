import type { ToolExecutionContext } from "veryfront/tool";
import { requireUserIdFromContext } from "./user-id.ts";

export function resolveUserId(context?: ToolExecutionContext): string {
  return requireUserIdFromContext(context);
}
