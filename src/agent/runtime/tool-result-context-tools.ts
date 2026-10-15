import type { ToolDefinition } from "#veryfront/tool";
import type { ToolResultContext } from "./tool-result-context.ts";

export const GET_TOOL_RESULT_TOOL_NAME = "get_tool_result";

/** Infrastructure schema for retrieving a bounded section of a run-owned result. */
export function createToolResultReadDefinition(): ToolDefinition {
  return {
    name: GET_TOOL_RESULT_TOOL_NAME,
    description: "Read a bounded section of a tool result reference from this run. " +
      "For JSON results, use view structure to list child pointer tokens and types without values, " +
      "then pass a JSON pointer to read only that value. " +
      "To continue, repeat the same ref, view, and pointer with cursor set to the returned nextCursor. " +
      "Stop when done is true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["ref"],
      properties: {
        ref: {
          type: "string",
          minLength: 1,
          description: "The exact ref from a tool_result_reference returned in this run.",
        },
        view: {
          type: "string",
          enum: ["value", "structure"],
          description: "value (default) reads the selected content. structure lists one level " +
            "of JSON child pointerToken and type entries; append a pointerToken to the pointer to descend.",
        },
        pointer: {
          type: "string",
          maxLength: 4096,
          pattern: "^(?:/(?:[^~/]|~[01])*){0,32}$",
          description: "RFC 6901 JSON pointer into the retained result, such as /items/0. " +
            "Omit to select the whole result.",
        },
        cursor: {
          type: "string",
          pattern: "^(?:0|[1-9][0-9]*)?$",
          description: "The nextCursor from the previous section of the same selection. " +
            "Omit for the first section.",
        },
        maxBytes: { type: "integer", minimum: 4 },
      },
    },
  };
}

/** Validate model arguments independently of provider-side schema validation. */
export function readToolResultContext(context: ToolResultContext, args: Record<string, unknown>) {
  if (
    typeof args.ref !== "string" || !args.ref ||
    (args.view !== undefined && args.view !== "value" && args.view !== "structure") ||
    (args.pointer !== undefined && typeof args.pointer !== "string") ||
    (args.cursor !== undefined && typeof args.cursor !== "string") ||
    (args.maxBytes !== undefined &&
      (typeof args.maxBytes !== "number" || !Number.isSafeInteger(args.maxBytes) ||
        args.maxBytes < 4))
  ) {
    throw new TypeError("Invalid get_tool_result arguments");
  }
  return context.read({
    ref: args.ref,
    view: args.view,
    pointer: args.pointer,
    cursor: args.cursor,
    maxBytes: args.maxBytes,
  });
}
