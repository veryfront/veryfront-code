import type { MessagePart, ToolResultPart } from "../types.ts";

export function isToolResultPart(part: MessagePart): part is ToolResultPart {
  return part.type === "tool-result" && "result" in part;
}
