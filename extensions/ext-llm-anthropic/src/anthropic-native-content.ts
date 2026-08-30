import {
  type JsonSnapshotValue,
  readRecord,
  snapshotProviderJsonValue,
} from "veryfront/provider/shared";

export type AnthropicProviderToolNameRegistry = Map<string, string>;

export type AnthropicProviderToolUse = {
  blockType: "server_tool_use" | "mcp_tool_use";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  serverName?: string;
};

export type AnthropicServerToolResult = {
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: true;
};

const PROVIDER_TOOL_RESULT_BLOCK_TYPES = new Set([
  "web_search_tool_result",
  "web_fetch_tool_result",
  "code_execution_tool_result",
  "bash_code_execution_tool_result",
  "text_editor_code_execution_tool_result",
  "mcp_tool_result",
]);

const WEB_SEARCH_ERROR_CODES = new Set([
  "invalid_tool_input",
  "unavailable",
  "max_uses_exceeded",
  "too_many_requests",
  "query_too_long",
  "request_too_large",
]);

const WEB_FETCH_ERROR_CODES = new Set([
  "invalid_tool_input",
  "url_too_long",
  "url_not_allowed",
  "url_not_in_prior_context",
  "url_not_accessible",
  "unsupported_content_type",
  "too_many_requests",
  "max_uses_exceeded",
  "unavailable",
]);

const CODE_EXECUTION_ERROR_CODES = new Set([
  "invalid_tool_input",
  "unavailable",
  "too_many_requests",
  "execution_time_exceeded",
]);

const BASH_CODE_EXECUTION_ERROR_CODES = new Set([
  ...CODE_EXECUTION_ERROR_CODES,
  "output_file_too_large",
]);

const TEXT_EDITOR_CODE_EXECUTION_ERROR_CODES = new Set([
  ...CODE_EXECUTION_ERROR_CODES,
  "file_not_found",
]);

export class AnthropicServerToolResultError extends Error {
  override readonly name = "AnthropicServerToolResultError";
  readonly provider = "anthropic";
  readonly code: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly detail?: string;

  constructor(options: {
    code: string;
    toolCallId: string;
    toolName: string;
    detail?: string;
  }) {
    super(
      `Anthropic ${options.toolName} failed with ${options.code} ` +
        `(tool call ${options.toolCallId})`,
    );
    this.code = options.code;
    this.toolCallId = options.toolCallId;
    this.toolName = options.toolName;
    if (options.detail !== undefined) this.detail = options.detail;
  }
}

export function isAnthropicProviderToolResultBlockType(type: string): boolean {
  return PROVIDER_TOOL_RESULT_BLOCK_TYPES.has(type);
}

export function isAnthropicProviderExecutedContentBlockType(type: unknown): boolean {
  return type === "server_tool_use" ||
    type === "mcp_tool_use" ||
    typeof type === "string" && isAnthropicProviderToolResultBlockType(type);
}

export const MAX_ANTHROPIC_RAW_ASSISTANT_MESSAGES = 6;
/** Maximum raw response groups reconstructed from one cumulative durable checkpoint. */
export const MAX_ANTHROPIC_REPLAY_ASSISTANT_MESSAGES = 100;
export const MAX_ANTHROPIC_RAW_ASSISTANT_BLOCKS = 4_096;
export const MAX_ANTHROPIC_RAW_ASSISTANT_METADATA_BYTES = 8 * 1024 * 1024;
export const MAX_ANTHROPIC_RAW_ASSISTANT_METADATA_DEPTH = 64;
export const MAX_ANTHROPIC_RAW_ASSISTANT_METADATA_NODES = 65_536;

export function snapshotAnthropicRawAssistantMetadata(
  value: unknown,
): JsonSnapshotValue {
  try {
    return snapshotProviderJsonValue(value, {
      maxBytes: MAX_ANTHROPIC_RAW_ASSISTANT_METADATA_BYTES,
      maxDepth: MAX_ANTHROPIC_RAW_ASSISTANT_METADATA_DEPTH,
      maxNodes: MAX_ANTHROPIC_RAW_ASSISTANT_METADATA_NODES,
    });
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message ===
        `Provider JSON snapshot exceeded ${MAX_ANTHROPIC_RAW_ASSISTANT_METADATA_BYTES} UTF-8 bytes`
    ) {
      throw new TypeError(
        `Anthropic raw assistant metadata exceeded ${MAX_ANTHROPIC_RAW_ASSISTANT_METADATA_BYTES} UTF-8 bytes`,
      );
    }
    throw new TypeError("Anthropic raw assistant metadata was not valid bounded JSON");
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isNullableNonNegativeSafeInteger(value: unknown): value is number | null {
  return value === null || isSafeInteger(value) && value >= 0;
}

function hasValidCaller(value: unknown): boolean {
  if (value === undefined) {
    // Anthropic's narrative and direct-call examples omit `caller`, while the
    // current generated response model marks it required. Accept both wire
    // shapes, but validate the field strictly whenever it is present.
    return true;
  }
  const caller = readRecord(value);
  if (!caller) return false;
  if (caller.type === "direct") return true;
  if (
    caller.type === "code_execution_20250825" ||
    caller.type === "code_execution_20260120"
  ) {
    return isNonEmptyString(caller.tool_id);
  }
  return false;
}

/**
 * Validate exact Anthropic assistant content before replaying it from provider
 * metadata. The records retain their provider wire shape; validation only
 * proves that every block is supported and provider-tool results correlate.
 */
export function validateAnthropicRawAssistantMessages(
  value: unknown,
  providerToolNamesById: AnthropicProviderToolNameRegistry = new Map(),
  maximumMessages = MAX_ANTHROPIC_RAW_ASSISTANT_MESSAGES,
): Array<Array<Record<string, unknown>>> {
  if (
    !Number.isSafeInteger(maximumMessages) || maximumMessages < 1 ||
    maximumMessages > MAX_ANTHROPIC_REPLAY_ASSISTANT_MESSAGES
  ) {
    throw new TypeError(
      `Anthropic raw assistant message limit must be between 1 and ${MAX_ANTHROPIC_REPLAY_ASSISTANT_MESSAGES}`,
    );
  }
  const snapshot = snapshotAnthropicRawAssistantMetadata(value);
  if (
    !Array.isArray(snapshot) ||
    snapshot.length === 0 ||
    snapshot.length > maximumMessages
  ) {
    throw new TypeError(
      `Anthropic raw assistant messages must contain between 1 and ${maximumMessages} messages`,
    );
  }

  const messages = snapshot as Array<Array<Record<string, unknown>>>;
  let blockCount = 0;

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const content = messages[messageIndex];
    if (!Array.isArray(content) || content.length === 0) {
      throw new TypeError(
        "Anthropic raw assistant messages must contain non-empty arrays of content blocks",
      );
    }
    if (content.length > MAX_ANTHROPIC_RAW_ASSISTANT_BLOCKS - blockCount) {
      throw new TypeError(
        `Anthropic raw assistant metadata exceeded ${MAX_ANTHROPIC_RAW_ASSISTANT_BLOCKS} content blocks`,
      );
    }
    blockCount += content.length;

    for (let blockIndex = 0; blockIndex < content.length; blockIndex += 1) {
      const value = content[blockIndex];
      const block = readRecord(value);
      if (!block || !isNonEmptyString(block.type)) {
        throw new TypeError("Anthropic raw assistant content block must be an object with a type");
      }

      switch (block.type) {
        case "text":
          if (typeof block.text !== "string") {
            throw new TypeError("Anthropic raw assistant text block is malformed");
          }
          break;
        case "thinking":
          if (
            (block.thinking !== undefined && typeof block.thinking !== "string") ||
            (block.signature !== undefined && typeof block.signature !== "string") ||
            (typeof block.thinking !== "string" && typeof block.signature !== "string")
          ) {
            throw new TypeError("Anthropic raw assistant thinking block is malformed");
          }
          break;
        case "redacted_thinking":
          if (!isNonEmptyString(block.data)) {
            throw new TypeError("Anthropic raw assistant redacted thinking block is malformed");
          }
          break;
        case "tool_use": {
          const input = block.input === undefined ? {} : readRecord(block.input);
          if (!isNonEmptyString(block.id) || !isNonEmptyString(block.name) || !input) {
            throw new TypeError("Anthropic raw assistant tool-use block is malformed");
          }
          break;
        }
        case "server_tool_use":
        case "mcp_tool_use": {
          const providerToolUse = parseAnthropicProviderToolUse(block);
          if (
            !providerToolUse ||
            providerToolNamesById.has(providerToolUse.toolCallId)
          ) {
            throw new TypeError(
              "Anthropic raw assistant provider tool-use block is malformed or duplicated",
            );
          }
          providerToolNamesById.set(
            providerToolUse.toolCallId,
            providerToolUse.toolName,
          );
          break;
        }
        default:
          if (!isAnthropicProviderToolResultBlockType(block.type)) {
            throw new TypeError("Anthropic raw assistant content block type is unsupported");
          }
          if (!parseAnthropicServerToolResult(block, providerToolNamesById)) {
            throw new TypeError(
              "Anthropic raw assistant provider tool result is malformed or unpaired",
            );
          }
          providerToolNamesById.delete(String(block.tool_use_id));
      }
    }
  }

  return messages;
}

export function parseAnthropicProviderToolUse(
  value: unknown,
): AnthropicProviderToolUse | undefined {
  const block = readRecord(value);
  if (!block || (block.type !== "server_tool_use" && block.type !== "mcp_tool_use")) {
    return undefined;
  }
  const input = block.input === undefined ? {} : readRecord(block.input);
  if (
    !isNonEmptyString(block.id) ||
    !isNonEmptyString(block.name) ||
    !input
  ) {
    return undefined;
  }

  if (block.type === "server_tool_use") {
    if (!hasValidCaller(block.caller)) return undefined;
    return {
      blockType: "server_tool_use",
      toolCallId: block.id,
      toolName: block.name,
      input,
    };
  }

  if (!isNonEmptyString(block.server_name)) return undefined;
  return {
    blockType: "mcp_tool_use",
    toolCallId: block.id,
    toolName: block.name,
    input,
    serverName: block.server_name,
  };
}

function createToolResultError(
  content: Record<string, unknown>,
  expectedType: string,
  allowedCodes: ReadonlySet<string>,
  toolCallId: string,
  toolName: string,
  allowDetail = false,
): AnthropicServerToolResult | undefined {
  if (content.type !== expectedType || !isNonEmptyString(content.error_code)) {
    return undefined;
  }
  if (!allowedCodes.has(content.error_code)) return undefined;

  let detail: string | undefined;
  if (allowDetail) {
    if (
      !("error_message" in content) ||
      content.error_message !== null && typeof content.error_message !== "string"
    ) {
      return undefined;
    }
    if (typeof content.error_message === "string") detail = content.error_message;
  }

  return {
    toolCallId,
    toolName,
    result: new AnthropicServerToolResultError({
      code: content.error_code,
      toolCallId,
      toolName,
      ...(detail === undefined ? {} : { detail }),
    }),
    isError: true,
  };
}

function normalizeFileOutputs(
  value: unknown,
  expectedType: "code_execution_output" | "bash_code_execution_output",
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined;
  const output: Array<Record<string, unknown>> = [];
  for (const item of value) {
    const record = readRecord(item);
    if (!record || record.type !== expectedType || !isNonEmptyString(record.file_id)) {
      return undefined;
    }
    output.push({ type: expectedType, fileId: record.file_id });
  }
  return output;
}

function normalizeCodeExecutionContent(
  content: Record<string, unknown>,
  toolCallId: string,
): AnthropicServerToolResult | undefined {
  const toolName = "code_execution";
  const error = createToolResultError(
    content,
    "code_execution_tool_result_error",
    CODE_EXECUTION_ERROR_CODES,
    toolCallId,
    toolName,
  );
  if (error) return error;

  if (content.type === "code_execution_result") {
    const outputs = normalizeFileOutputs(content.content, "code_execution_output");
    if (
      !outputs ||
      typeof content.stdout !== "string" ||
      typeof content.stderr !== "string" ||
      !isSafeInteger(content.return_code)
    ) {
      return undefined;
    }
    return {
      toolCallId,
      toolName,
      result: {
        type: "code_execution_result",
        stdout: content.stdout,
        stderr: content.stderr,
        returnCode: content.return_code,
        content: outputs,
      },
    };
  }

  if (content.type === "encrypted_code_execution_result") {
    const outputs = normalizeFileOutputs(content.content, "code_execution_output");
    if (
      !outputs ||
      typeof content.encrypted_stdout !== "string" ||
      typeof content.stderr !== "string" ||
      !isSafeInteger(content.return_code)
    ) {
      return undefined;
    }
    return {
      toolCallId,
      toolName,
      result: {
        type: "encrypted_code_execution_result",
        encryptedStdout: content.encrypted_stdout,
        stderr: content.stderr,
        returnCode: content.return_code,
        content: outputs,
      },
    };
  }

  return undefined;
}

function normalizeBashCodeExecutionContent(
  content: Record<string, unknown>,
  toolCallId: string,
): AnthropicServerToolResult | undefined {
  const toolName = "bash_code_execution";
  const error = createToolResultError(
    content,
    "bash_code_execution_tool_result_error",
    BASH_CODE_EXECUTION_ERROR_CODES,
    toolCallId,
    toolName,
  );
  if (error) return error;

  const outputs = normalizeFileOutputs(content.content, "bash_code_execution_output");
  if (
    content.type !== "bash_code_execution_result" ||
    !outputs ||
    typeof content.stdout !== "string" ||
    typeof content.stderr !== "string" ||
    !isSafeInteger(content.return_code)
  ) {
    return undefined;
  }
  return {
    toolCallId,
    toolName,
    result: {
      type: "bash_code_execution_result",
      stdout: content.stdout,
      stderr: content.stderr,
      returnCode: content.return_code,
      content: outputs,
    },
  };
}

function normalizeTextEditorCodeExecutionContent(
  content: Record<string, unknown>,
  toolCallId: string,
): AnthropicServerToolResult | undefined {
  const toolName = "text_editor_code_execution";
  const error = createToolResultError(
    content,
    "text_editor_code_execution_tool_result_error",
    TEXT_EDITOR_CODE_EXECUTION_ERROR_CODES,
    toolCallId,
    toolName,
    true,
  );
  if (error) return error;

  if (content.type === "text_editor_code_execution_view_result") {
    if (
      typeof content.content !== "string" ||
      (content.file_type !== "text" &&
        content.file_type !== "image" &&
        content.file_type !== "pdf") ||
      !("num_lines" in content) ||
      !isNullableNonNegativeSafeInteger(content.num_lines) ||
      !("start_line" in content) ||
      !isNullableNonNegativeSafeInteger(content.start_line) ||
      !("total_lines" in content) ||
      !isNullableNonNegativeSafeInteger(content.total_lines)
    ) {
      return undefined;
    }
    return {
      toolCallId,
      toolName,
      result: {
        type: "text_editor_code_execution_view_result",
        content: content.content,
        fileType: content.file_type,
        numLines: content.num_lines,
        startLine: content.start_line,
        totalLines: content.total_lines,
      },
    };
  }

  if (content.type === "text_editor_code_execution_create_result") {
    if (typeof content.is_file_update !== "boolean") return undefined;
    return {
      toolCallId,
      toolName,
      result: {
        type: "text_editor_code_execution_create_result",
        isFileUpdate: content.is_file_update,
      },
    };
  }

  if (content.type === "text_editor_code_execution_str_replace_result") {
    if (
      !("lines" in content) ||
      !(content.lines === null ||
        Array.isArray(content.lines) &&
          content.lines.every((line) => typeof line === "string")) ||
      !("old_start" in content) ||
      !isNullableNonNegativeSafeInteger(content.old_start) ||
      !("old_lines" in content) ||
      !isNullableNonNegativeSafeInteger(content.old_lines) ||
      !("new_start" in content) ||
      !isNullableNonNegativeSafeInteger(content.new_start) ||
      !("new_lines" in content) ||
      !isNullableNonNegativeSafeInteger(content.new_lines)
    ) {
      return undefined;
    }
    return {
      toolCallId,
      toolName,
      result: {
        type: "text_editor_code_execution_str_replace_result",
        lines: content.lines,
        oldStart: content.old_start,
        oldLines: content.old_lines,
        newStart: content.new_start,
        newLines: content.new_lines,
      },
    };
  }

  return undefined;
}

function normalizeWebSearchContent(
  content: unknown,
  toolCallId: string,
): AnthropicServerToolResult | undefined {
  const toolName = "web_search";
  const errorContent = readRecord(content);
  if (errorContent) {
    return createToolResultError(
      errorContent,
      "web_search_tool_result_error",
      WEB_SEARCH_ERROR_CODES,
      toolCallId,
      toolName,
    );
  }
  if (!Array.isArray(content)) return undefined;

  const results: Array<Record<string, unknown>> = [];
  for (const value of content) {
    const record = readRecord(value);
    if (
      !record ||
      record.type !== "web_search_result" ||
      !isNonEmptyString(record.url) ||
      typeof record.title !== "string" ||
      typeof record.encrypted_content !== "string" ||
      !("page_age" in record) ||
      record.page_age !== null && typeof record.page_age !== "string"
    ) {
      return undefined;
    }
    results.push({
      type: "web_search_result",
      url: record.url,
      title: record.title,
      pageAge: record.page_age,
      encryptedContent: record.encrypted_content,
    });
  }
  return { toolCallId, toolName, result: results };
}

function normalizeWebFetchSource(
  value: unknown,
): Record<string, unknown> | undefined {
  const source = readRecord(value);
  if (!source || typeof source.data !== "string") return undefined;
  if (source.type === "text" && source.media_type === "text/plain") {
    return {
      type: "text",
      mediaType: "text/plain",
      data: source.data,
    };
  }
  if (source.type === "base64" && source.media_type === "application/pdf") {
    return {
      type: "base64",
      mediaType: "application/pdf",
      data: source.data,
    };
  }
  return undefined;
}

function normalizeWebFetchContent(
  content: Record<string, unknown>,
  toolCallId: string,
): AnthropicServerToolResult | undefined {
  const toolName = "web_fetch";
  const error = createToolResultError(
    content,
    "web_fetch_tool_result_error",
    WEB_FETCH_ERROR_CODES,
    toolCallId,
    toolName,
  );
  if (error) return error;

  const document = readRecord(content.content);
  const source = normalizeWebFetchSource(document?.source);
  if (
    content.type !== "web_fetch_result" ||
    !isNonEmptyString(content.url) ||
    !("retrieved_at" in content) ||
    content.retrieved_at !== null && typeof content.retrieved_at !== "string" ||
    !document ||
    document.type !== "document" ||
    !source ||
    document.title !== undefined &&
      document.title !== null &&
      typeof document.title !== "string"
  ) {
    return undefined;
  }
  const citations = document.citations;
  if (
    citations !== undefined &&
    citations !== null &&
    (readRecord(citations)?.enabled !== true && readRecord(citations)?.enabled !== false)
  ) {
    return undefined;
  }

  return {
    toolCallId,
    toolName,
    result: {
      type: "web_fetch_result",
      url: content.url,
      content: {
        type: "document",
        source,
        ...(document.title === undefined ? {} : { title: document.title }),
        ...(citations === undefined ? {} : { citations }),
      },
      retrievedAt: content.retrieved_at,
    },
  };
}

function normalizeMcpContent(value: unknown): string | Array<Record<string, unknown>> | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const blocks: Array<Record<string, unknown>> = [];
  for (const item of value) {
    const block = readRecord(item);
    const citations = block?.citations;
    if (
      !block ||
      block.type !== "text" ||
      typeof block.text !== "string" ||
      citations !== undefined &&
        citations !== null &&
        (!Array.isArray(citations) ||
          citations.some((citation) => {
            const record = readRecord(citation);
            return !record || !isNonEmptyString(record.type);
          }))
    ) {
      return undefined;
    }
    blocks.push({
      type: "text",
      text: block.text,
      ...(citations === undefined ? {} : { citations }),
    });
  }
  return blocks;
}

function resultMatchesRegisteredTool(
  toolNamesById: ReadonlyMap<string, string> | undefined,
  toolCallId: string,
  expectedToolName: string,
): boolean {
  const registeredName = toolNamesById?.get(toolCallId);
  return registeredName === expectedToolName;
}

export function parseAnthropicServerToolResult(
  value: unknown,
  toolNamesById?: ReadonlyMap<string, string>,
): AnthropicServerToolResult | undefined {
  const block = readRecord(value);
  if (
    !block ||
    !isAnthropicProviderToolResultBlockType(String(block.type)) ||
    !isNonEmptyString(block.tool_use_id)
  ) {
    return undefined;
  }
  const toolCallId = block.tool_use_id;

  if (block.type === "mcp_tool_result") {
    const toolName = toolNamesById?.get(toolCallId);
    const content = normalizeMcpContent(block.content);
    if (
      !isNonEmptyString(toolName) ||
      typeof block.is_error !== "boolean" ||
      content === undefined
    ) {
      return undefined;
    }
    return {
      toolCallId,
      toolName,
      result: content,
      ...(block.is_error ? { isError: true } : {}),
    };
  }

  if (block.type === "web_search_tool_result") {
    if (
      !hasValidCaller(block.caller) ||
      !resultMatchesRegisteredTool(toolNamesById, toolCallId, "web_search")
    ) {
      return undefined;
    }
    return normalizeWebSearchContent(block.content, toolCallId);
  }

  if (block.type === "web_fetch_tool_result") {
    const content = readRecord(block.content);
    if (
      !content ||
      !hasValidCaller(block.caller) ||
      !resultMatchesRegisteredTool(toolNamesById, toolCallId, "web_fetch")
    ) {
      return undefined;
    }
    return normalizeWebFetchContent(content, toolCallId);
  }

  const content = readRecord(block.content);
  if (!content) return undefined;
  if (block.type === "code_execution_tool_result") {
    if (!resultMatchesRegisteredTool(toolNamesById, toolCallId, "code_execution")) {
      return undefined;
    }
    return normalizeCodeExecutionContent(content, toolCallId);
  }
  if (block.type === "bash_code_execution_tool_result") {
    if (!resultMatchesRegisteredTool(toolNamesById, toolCallId, "bash_code_execution")) {
      return undefined;
    }
    return normalizeBashCodeExecutionContent(content, toolCallId);
  }
  if (block.type === "text_editor_code_execution_tool_result") {
    if (
      !resultMatchesRegisteredTool(
        toolNamesById,
        toolCallId,
        "text_editor_code_execution",
      )
    ) {
      return undefined;
    }
    return normalizeTextEditorCodeExecutionContent(content, toolCallId);
  }
  return undefined;
}
