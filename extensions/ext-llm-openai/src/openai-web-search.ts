import {
  readRecord,
  stringifyJsonValue,
} from "veryfront/provider/shared";
import {
  isBoundedOpenAIStreamString,
  MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
} from "./openai-stream-metadata.ts";

const OPENAI_WEB_SEARCH_TYPES = new Set([
  "web_search",
  "web_search_2025_08_26",
  "web_search_preview",
  "web_search_preview_2025_03_11",
]);

export const OPENAI_WEB_SEARCH_SOURCES_INCLUDE =
  "web_search_call.action.sources";

type ProviderTool = {
  type: "provider";
  name: string;
  id: `${string}.${string}`;
  args: Record<string, unknown>;
};

export type OpenAIWebSearchDescriptor = {
  name: string;
  requestTool: Record<string, unknown>;
};

export type OpenAIWebSearchResult = {
  id: string;
  input: string;
  result: Record<string, unknown>;
  isError: boolean;
};

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

export function resolveOpenAIWebSearchDescriptor(
  tools: Array<
    | ProviderTool
    | { type: "function"; name: string; description?: string; inputSchema: unknown }
  > | undefined,
): OpenAIWebSearchDescriptor | undefined {
  let resolved: OpenAIWebSearchDescriptor | undefined;
  for (const tool of tools ?? []) {
    if (tool.type !== "provider" || !tool.id.startsWith("openai.")) continue;
    const providerType = tool.id.slice("openai.".length);
    if (!OPENAI_WEB_SEARCH_TYPES.has(providerType)) {
      throw new TypeError(`Unsupported OpenAI provider tool: ${tool.id}`);
    }
    if (resolved) {
      throw new TypeError("Only one OpenAI web-search provider tool is supported per request");
    }
    if (
      !hasOnlyKeys(tool.args, new Set(["searchContextSize"])) ||
      (tool.args.searchContextSize !== undefined &&
        tool.args.searchContextSize !== "low" &&
        tool.args.searchContextSize !== "medium" &&
        tool.args.searchContextSize !== "high")
    ) {
      throw new TypeError("OpenAI web-search tool arguments were unsupported");
    }
    resolved = {
      name: tool.name,
      requestTool: {
        type: providerType,
        ...(tool.args.searchContextSize !== undefined
          ? { search_context_size: tool.args.searchContextSize }
          : {}),
      },
    };
  }
  return resolved;
}

export function normalizeOpenAIWebSearchCall(
  item: Record<string, unknown>,
  invalid: (issue: string) => Error,
): OpenAIWebSearchResult {
  if (
    !isBoundedOpenAIStreamString(item.id, MAX_OPENAI_STREAM_IDENTIFIER_BYTES) ||
    item.type !== "web_search_call" ||
    (item.status !== "completed" && item.status !== "incomplete")
  ) {
    throw invalid("web-search output item identity or status was malformed");
  }
  const action = readRecord(item.action);
  if (!action || typeof action.type !== "string") {
    throw invalid("web-search action was malformed");
  }

  let sources: Array<Record<string, unknown>> | undefined;
  if (action.type === "search") {
    if (
      !hasOnlyKeys(action, new Set(["type", "query", "queries", "sources"])) ||
      (action.query !== undefined &&
        (typeof action.query !== "string" || action.query.length === 0)) ||
      (action.queries !== undefined &&
        (!Array.isArray(action.queries) ||
          action.queries.some((query) => typeof query !== "string" || query.length === 0)))
    ) {
      throw invalid("web-search search action was malformed");
    }
    if (action.sources !== undefined) {
      if (!Array.isArray(action.sources)) {
        throw invalid("web-search sources were malformed");
      }
      sources = action.sources.map((source) => {
        const record = readRecord(source);
        if (
          !record ||
          !hasOnlyKeys(record, new Set(["type", "url"])) ||
          record.type !== "url" ||
          !isHttpUrl(record.url)
        ) {
          throw invalid("web-search source was malformed");
        }
        return record;
      });
    }
  } else if (action.type === "open_page") {
    if (
      !hasOnlyKeys(action, new Set(["type", "url"])) ||
      !isHttpUrl(action.url)
    ) {
      throw invalid("web-search open-page action was malformed");
    }
  } else if (action.type === "find_in_page") {
    if (
      !hasOnlyKeys(action, new Set(["type", "url", "pattern"])) ||
      !isHttpUrl(action.url) ||
      typeof action.pattern !== "string" ||
      action.pattern.length === 0
    ) {
      throw invalid("web-search find-in-page action was malformed");
    }
  } else {
    throw invalid("web-search action type was unsupported");
  }

  const { sources: _sources, ...invocationAction } = action;
  return {
    id: item.id,
    input: stringifyJsonValue(invocationAction),
    result: item.status === "completed"
      ? {
        status: "completed",
        ...(sources !== undefined ? { sources } : {}),
      }
      : { status: "incomplete", action },
    isError: item.status === "incomplete",
  };
}

export function validateOpenAIUrlCitation(
  value: unknown,
  invalid: (issue: string) => Error,
): Record<string, unknown> {
  const annotation = readRecord(value);
  if (
    !annotation ||
    !hasOnlyKeys(
      annotation,
      new Set(["type", "start_index", "end_index", "url", "title"]),
    ) ||
    annotation.type !== "url_citation" ||
    !Number.isSafeInteger(annotation.start_index) ||
    (annotation.start_index as number) < 0 ||
    !Number.isSafeInteger(annotation.end_index) ||
    (annotation.end_index as number) < (annotation.start_index as number) ||
    !isHttpUrl(annotation.url) ||
    typeof annotation.title !== "string"
  ) {
    throw invalid("URL citation annotation was malformed");
  }
  return annotation;
}

export function createOpenAIRawResponseMetadata(
  outputItems: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return { openai: { rawResponseOutputItems: outputItems } };
}

export function readOpenAIRawResponseOutputItems(
  providerMetadata: Record<string, unknown> | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!providerMetadata || providerMetadata.openai === undefined) return undefined;
  const openai = readRecord(providerMetadata.openai);
  if (!openai || !Array.isArray(openai.rawResponseOutputItems)) {
    throw new TypeError("OpenAI raw response metadata was malformed");
  }
  const seenIds = new Set<string>();
  return openai.rawResponseOutputItems.map((value) => {
    const item = readRecord(value);
    if (
      !item ||
      !isBoundedOpenAIStreamString(item.id, MAX_OPENAI_STREAM_IDENTIFIER_BYTES) ||
      (item.type !== "message" &&
        item.type !== "reasoning" &&
        item.type !== "function_call" &&
        item.type !== "web_search_call") ||
      seenIds.has(item.id)
    ) {
      throw new TypeError("OpenAI raw response metadata item was malformed");
    }
    seenIds.add(item.id);
    return item;
  });
}
