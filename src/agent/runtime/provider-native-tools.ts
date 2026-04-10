import type { JsonSchema } from "#veryfront/tool/schema";
import { createLazyRuntimeJsonSchema, createRuntimeProviderTool } from "./runtime-tool-builder.ts";
import type { RuntimeToolSet } from "./runtime-tool-types.ts";

const WEB_SEARCH_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
    },
  },
  required: ["query"],
  additionalProperties: false,
};

const WEB_SEARCH_OUTPUT_SCHEMA: JsonSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      url: {
        type: "string",
      },
      title: {
        anyOf: [
          { type: "string" },
          { type: "null" },
        ],
      },
      pageAge: {
        anyOf: [
          { type: "string" },
          { type: "null" },
        ],
      },
      encryptedContent: {
        type: "string",
      },
      type: {
        type: "string",
        const: "web_search_result",
      },
    },
    required: ["url", "title", "pageAge", "encryptedContent", "type"],
    additionalProperties: false,
  },
};

export function createAnthropicWebSearchToolSet(): RuntimeToolSet {
  return {
    web_search: createRuntimeProviderTool({
      id: "anthropic.web_search_20250305",
      args: {
        maxUses: 5,
      },
      inputSchema: createLazyRuntimeJsonSchema(WEB_SEARCH_INPUT_SCHEMA),
      outputSchema: createLazyRuntimeJsonSchema(WEB_SEARCH_OUTPUT_SCHEMA),
      supportsDeferredResults: true,
    }),
  };
}
