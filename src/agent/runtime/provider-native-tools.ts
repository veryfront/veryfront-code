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

const WEB_FETCH_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    url: {
      type: "string",
    },
  },
  required: ["url"],
  additionalProperties: false,
};

const WEB_FETCH_OUTPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      const: "web_fetch_result",
    },
    url: {
      type: "string",
    },
    content: {
      type: "object",
      properties: {
        type: {
          type: "string",
          const: "document",
        },
        source: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["text", "base64"],
            },
            mediaType: {
              type: "string",
            },
            data: {
              type: "string",
            },
          },
          required: ["type", "mediaType", "data"],
          additionalProperties: true,
        },
      },
      required: ["type", "source"],
      additionalProperties: true,
    },
    retrievedAt: {
      type: "string",
    },
  },
  required: ["type", "url", "content", "retrievedAt"],
  additionalProperties: false,
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

export function createAnthropicWebFetchToolSet(): RuntimeToolSet {
  return {
    web_fetch: createRuntimeProviderTool({
      id: "anthropic.web_fetch_20250910",
      args: {},
      inputSchema: createLazyRuntimeJsonSchema(WEB_FETCH_INPUT_SCHEMA),
      outputSchema: createLazyRuntimeJsonSchema(WEB_FETCH_OUTPUT_SCHEMA),
      supportsDeferredResults: true,
    }),
  };
}
