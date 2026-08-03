import {
  readRecord,
  snapshotProviderJsonValue,
  stringifyJsonValue,
} from "veryfront/provider/shared";
import {
  isBoundedOpenAIStreamString,
  MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
  MAX_OPENAI_STREAM_TOOL_NAME_BYTES,
} from "./openai-stream-metadata.ts";
import { isJsonObjectText, MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES } from "./openai-tool-input.ts";

const OPENAI_WEB_SEARCH_TYPES = new Set([
  "web_search",
  "web_search_2025_08_26",
  "web_search_preview",
  "web_search_preview_2025_03_11",
]);

export const OPENAI_WEB_SEARCH_SOURCES_INCLUDE = "web_search_call.action.sources";
export const OPENAI_REASONING_ENCRYPTED_CONTENT_INCLUDE = "reasoning.encrypted_content";
export const MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES = 8 * 1024 * 1024;
export const MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS = 4_096;
export const MAX_OPENAI_WEB_SEARCH_TEXT_BYTES = 64 * 1024;
export const MAX_OPENAI_WEB_SEARCH_URL_BYTES = 16 * 1024;
export const MAX_OPENAI_WEB_SEARCH_VALUES = 256;

const textEncoder = new TextEncoder();

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

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      return true;
    }
  }
  return false;
}

function isHttpUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    hasAsciiControlCharacter(value) ||
    textEncoder.encode(value).byteLength > MAX_OPENAI_WEB_SEARCH_URL_BYTES
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0;
  } catch {
    return false;
  }
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function isBoundedText(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    textEncoder.encode(value).byteLength <= MAX_OPENAI_WEB_SEARCH_TEXT_BYTES;
}

export function resolveOpenAIWebSearchDescriptor(
  tools:
    | ReadonlyArray<
      | ProviderTool
      | { type: "function"; name: string; description?: string; inputSchema: unknown }
    >
    | undefined,
): OpenAIWebSearchDescriptor | undefined {
  let resolved: OpenAIWebSearchDescriptor | undefined;
  for (const tool of tools ?? []) {
    if (
      tool.type !== "provider" ||
      typeof tool.id !== "string" ||
      !tool.id.startsWith("openai.")
    ) {
      continue;
    }
    const providerType = tool.id.slice("openai.".length);
    if (!OPENAI_WEB_SEARCH_TYPES.has(providerType)) {
      throw new TypeError(`Unsupported OpenAI provider tool: ${tool.id}`);
    }
    if (resolved) {
      throw new TypeError("Only one OpenAI web-search provider tool is supported per request");
    }
    if (
      !isBoundedOpenAIStreamString(
        tool.name,
        MAX_OPENAI_STREAM_TOOL_NAME_BYTES,
      )
    ) {
      throw new TypeError("OpenAI web-search tool name was malformed");
    }
    const args = readRecord(tool.args);
    if (
      !args ||
      !hasOnlyKeys(args, new Set(["searchContextSize"])) ||
      (args.searchContextSize !== undefined &&
        args.searchContextSize !== "low" &&
        args.searchContextSize !== "medium" &&
        args.searchContextSize !== "high")
    ) {
      throw new TypeError("OpenAI web-search tool arguments were unsupported");
    }
    resolved = {
      name: tool.name,
      requestTool: {
        type: providerType,
        ...(args.searchContextSize !== undefined
          ? { search_context_size: args.searchContextSize }
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
    (item.status !== "completed" &&
      item.status !== "failed" &&
      item.status !== "incomplete")
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
      (action.query !== undefined && !isBoundedText(action.query, true)) ||
      (action.queries !== undefined &&
        (!Array.isArray(action.queries) ||
          action.queries.length > MAX_OPENAI_WEB_SEARCH_VALUES ||
          action.queries.some((query) => !isBoundedText(query, true))))
    ) {
      throw invalid("web-search search action was malformed");
    }
    if (action.sources !== undefined) {
      if (
        !Array.isArray(action.sources) ||
        action.sources.length > MAX_OPENAI_WEB_SEARCH_VALUES
      ) {
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
      (action.url !== undefined &&
        action.url !== null &&
        !isHttpUrl(action.url))
    ) {
      throw invalid("web-search open-page action was malformed");
    }
  } else if (action.type === "find_in_page") {
    if (
      !hasOnlyKeys(action, new Set(["type", "url", "pattern"])) ||
      !isHttpUrl(action.url) ||
      !isBoundedText(action.pattern)
    ) {
      throw invalid("web-search find-in-page action was malformed");
    }
  } else {
    throw invalid("web-search action type was unsupported");
  }

  const { sources: _sources, ...invocationAction } = action;
  const input = stringifyJsonValue(invocationAction);
  if (
    textEncoder.encode(input).byteLength >
      MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES
  ) {
    throw invalid("web-search action exceeded the tool-input limit");
  }
  return {
    id: item.id,
    input,
    result: item.status === "completed"
      ? {
        status: "completed",
        ...(sources !== undefined ? { sources } : {}),
      }
      : { status: item.status, action },
    isError: item.status !== "completed",
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
    (annotation.end_index as number) <= (annotation.start_index as number) ||
    !isHttpUrl(annotation.url) ||
    !isBoundedText(annotation.title, true)
  ) {
    throw invalid("URL citation annotation was malformed");
  }
  return annotation;
}

export function createOpenAIRawResponseMetadata(
  outputItems: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    openai: {
      rawResponseOutputItems: snapshotOpenAIRawResponseOutputItems(outputItems),
    },
  };
}

function readOwnOpenAIMetadataValue(
  providerMetadata: Record<string, unknown>,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(providerMetadata, "openai");
  } catch {
    throw new TypeError("OpenAI provider metadata could not be inspected");
  }
  if (descriptor === undefined) return undefined;
  if (!Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
    throw new TypeError("OpenAI provider metadata was malformed");
  }
  return descriptor.value;
}

function readOwnRawOutputItemsValue(openaiMetadata: unknown): unknown {
  if (
    openaiMetadata === null ||
    typeof openaiMetadata !== "object" ||
    Array.isArray(openaiMetadata)
  ) {
    throw new TypeError("OpenAI raw response metadata was malformed");
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(
      openaiMetadata,
      "rawResponseOutputItems",
    );
  } catch {
    throw new TypeError("OpenAI raw response metadata could not be inspected");
  }
  if (descriptor === undefined) return undefined;
  if (!Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
    throw new TypeError("OpenAI raw response metadata was malformed");
  }
  return descriptor.value;
}

function snapshotOpenAIRawResponseOutputItems(
  value: unknown,
): Array<Record<string, unknown>> {
  let snapshot: unknown;
  try {
    snapshot = snapshotProviderJsonValue(value, {
      maxBytes: MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES,
    });
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message ===
        `Provider JSON snapshot exceeded ${MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES} UTF-8 bytes`
    ) {
      throw new TypeError(
        `OpenAI raw response metadata exceeded ${MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES} UTF-8 bytes`,
      );
    }
    throw new TypeError("OpenAI raw response metadata was not valid bounded JSON");
  }
  if (!Array.isArray(snapshot)) {
    throw new TypeError("OpenAI raw response metadata was malformed");
  }
  return snapshot as Array<Record<string, unknown>>;
}

export function readOpenAIRawResponseOutputItems(
  providerMetadata: Record<string, unknown> | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!providerMetadata) return undefined;
  const openaiMetadata = readOwnOpenAIMetadataValue(providerMetadata);
  if (openaiMetadata === undefined) return undefined;
  const rawOutputItems = readOwnRawOutputItemsValue(openaiMetadata);
  if (rawOutputItems === undefined) return undefined;
  const snapshot = snapshotOpenAIRawResponseOutputItems(rawOutputItems);
  if (snapshot.length === 0) {
    throw new TypeError("OpenAI raw response metadata contained no output items");
  }
  if (
    snapshot.length > MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS
  ) {
    throw new TypeError("OpenAI raw response metadata contained too many output items");
  }
  const seenIds = new Set<string>();
  for (let index = 0; index < snapshot.length; index += 1) {
    const value = snapshot[index];
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
    const validStatus = item.status === undefined ||
      item.status === "completed" ||
      item.status === "incomplete" ||
      (item.type === "web_search_call" && item.status === "failed");
    if (!validStatus) {
      throw new TypeError("OpenAI raw response metadata item was malformed");
    }
    try {
      validateRawOutputItem(item);
    } catch {
      throw new TypeError("OpenAI raw response metadata item was malformed");
    }
    seenIds.add(item.id);
  }
  return snapshot;
}

function validateRawOutputItem(item: Record<string, unknown>): void {
  if (item.type === "web_search_call") {
    normalizeOpenAIWebSearchCall(item, (issue) => new TypeError(issue));
    return;
  }
  if (item.type === "function_call") {
    if (
      !isBoundedOpenAIStreamString(
        item.call_id,
        MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
      ) ||
      !isBoundedOpenAIStreamString(
        item.name,
        MAX_OPENAI_STREAM_TOOL_NAME_BYTES,
      ) ||
      typeof item.arguments !== "string" ||
      textEncoder.encode(item.arguments).byteLength >
        MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES ||
      !isJsonObjectText(item.arguments)
    ) {
      throw new TypeError("function call was malformed");
    }
    return;
  }
  if (item.type === "message") {
    if (
      item.role !== "assistant" ||
      !Array.isArray(item.content) ||
      item.content.length > MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS
    ) {
      throw new TypeError("message was malformed");
    }
    for (const value of item.content) {
      const part = readRecord(value);
      if (!part) throw new TypeError("message part was malformed");
      if (part.type === "output_text") {
        const annotations = part.annotations ?? [];
        if (
          typeof part.text !== "string" ||
          !Array.isArray(annotations) ||
          annotations.length > MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS
        ) {
          throw new TypeError("output text was malformed");
        }
        for (const annotation of annotations) {
          const citation = validateOpenAIUrlCitation(
            annotation,
            (issue) => new TypeError(issue),
          );
          if ((citation.end_index as number) > part.text.length) {
            throw new TypeError("citation exceeded output text");
          }
        }
      } else if (part.type === "refusal") {
        if (
          typeof part.refusal !== "string" ||
          part.annotations !== undefined
        ) {
          throw new TypeError("refusal was malformed");
        }
      } else {
        throw new TypeError("message part type was unsupported");
      }
    }
    return;
  }
  if (item.type === "reasoning") {
    validateRawReasoningParts(item.summary, "summary_text");
    validateRawReasoningParts(item.content, "reasoning_text");
    if (
      item.encrypted_content !== undefined &&
      typeof item.encrypted_content !== "string"
    ) {
      throw new TypeError("reasoning signature was malformed");
    }
  }
}

function validateRawReasoningParts(
  value: unknown,
  expectedType: "summary_text" | "reasoning_text",
): void {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.length > MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS
  ) {
    throw new TypeError("reasoning parts were malformed");
  }
  for (const rawPart of value) {
    const part = readRecord(rawPart);
    if (
      !part ||
      part.type !== expectedType ||
      typeof part.text !== "string" ||
      (part.id !== undefined &&
        !isBoundedOpenAIStreamString(
          part.id,
          MAX_OPENAI_STREAM_IDENTIFIER_BYTES,
        ))
    ) {
      throw new TypeError("reasoning part was malformed");
    }
  }
}
