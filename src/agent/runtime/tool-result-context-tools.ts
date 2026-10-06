import type { ToolDefinition } from "#veryfront/tool";
import type { ToolResultContext } from "./tool-result-context.ts";

export const GET_TOOL_RESULT_TOOL_NAME = "get_tool_result";

/** Infrastructure schema for retrieving a bounded section of a run-owned result. */
export function createToolResultReadDefinition(): ToolDefinition {
  return {
    name: GET_TOOL_RESULT_TOOL_NAME,
    description: "Read a bounded section of a tool result reference from this run. " +
      "Use the returned nextCursor for additional sections when needed.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["ref"],
      properties: {
        ref: { type: "string" },
        cursor: { type: "string" },
        maxBytes: { type: "integer", minimum: 4 },
      },
    },
  };
}

/** Validate model arguments independently of provider-side schema validation. */
export function readToolResultContext(context: ToolResultContext, args: Record<string, unknown>) {
  if (
    typeof args.ref !== "string" || !args.ref ||
    (args.cursor !== undefined && typeof args.cursor !== "string") ||
    (args.maxBytes !== undefined &&
      (typeof args.maxBytes !== "number" || !Number.isSafeInteger(args.maxBytes) ||
        args.maxBytes < 4))
  ) {
    throw new TypeError("Invalid get_tool_result arguments");
  }
  return context.read({ ref: args.ref, cursor: args.cursor, maxBytes: args.maxBytes });
}
