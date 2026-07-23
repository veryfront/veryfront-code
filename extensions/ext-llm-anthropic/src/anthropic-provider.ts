/**
 * Anthropic provider - implements the {@link LLMProvider} contract for
 * Anthropic's Messages API (direct + via Veryfront Cloud / Bedrock-compatible
 * proxies).
 *
 * Ported from `src/provider/runtime-loader.ts` as part of PR 12.
 *
 * @module extensions/ext-llm-anthropic/anthropic-provider
 */

import type { LLMProvider, LLMProviderConfig } from "veryfront/extensions/llm";
import type { RuntimeUsage } from "veryfront/provider/shared";
import type { ModelRuntime } from "veryfront/provider/types";
import {
  buildProviderError,
  createAnthropicRequestInit,
  createWarningCollector,
  getAnthropicMessagesUrl,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
  ProviderError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
  readRecord,
  requestJson,
  requestStream,
  stringifyJsonValue,
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  withToolInputStatusTransitions,
} from "veryfront/provider/shared";
import {
  buildAnthropicMessagesRequest,
  type OpenAICompatibleLanguageOptions,
} from "./anthropic-request-builder.ts";
import {
  addAnthropicUsage,
  type AnthropicStreamCompletion,
  extractAnthropicUsage,
  normalizeAnthropicFinishReason,
  parseAnthropicServerToolResult,
  streamAnthropicCompatibleParts,
} from "./anthropic-stream.ts";

const MAX_PAUSE_TURN_CONTINUATIONS = 5;

export {
  buildProviderError,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
  ProviderError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  withToolInputStatusTransitions,
};

export interface AnthropicRuntimeConfig {
  apiKey?: string;
  authToken?: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// Anthropic helper functions
// ---------------------------------------------------------------------------

type AnthropicReasoningContent = {
  type: "reasoning";
  text?: string;
  signature?: string;
  redactedData?: string;
};

type AnthropicCitation = {
  type: string;
  citedText?: string;
  url?: string;
  title?: string;
  startCharIndex?: number;
  endCharIndex?: number;
  startBlockIndex?: number;
  endBlockIndex?: number;
  startPageNumber?: number;
  endPageNumber?: number;
  documentIndex?: number;
  documentTitle?: string;
};

type AnthropicTextContent = {
  type: "text";
  text: string;
  citations?: AnthropicCitation[];
};

type AnthropicToolCallContent = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: string;
  providerExecuted?: boolean;
};

type AnthropicToolResultContent = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
  providerExecuted?: boolean;
};

type AnthropicGenerateContent =
  | AnthropicTextContent
  | AnthropicReasoningContent
  | AnthropicToolCallContent
  | AnthropicToolResultContent;

/**
 * Best-effort camelCase normalization of a single Anthropic citation
 * record. Handles the union of fields across web_search_result_location,
 * web_fetch_result_location, char_location, page_location, and
 * content_block_location citation kinds - see
 * https://docs.claude.com/en/docs/build-with-claude/citations
 */
function normalizeAnthropicCitation(raw: unknown): AnthropicCitation | undefined {
  const r = readRecord(raw);
  if (!r) return undefined;
  const typeStr = typeof r.type === "string" ? r.type : undefined;
  if (!typeStr) return undefined;
  const out: AnthropicCitation = { type: typeStr };
  if (typeof r.cited_text === "string") out.citedText = r.cited_text;
  if (typeof r.url === "string") out.url = r.url;
  if (typeof r.title === "string") out.title = r.title;
  if (typeof r.start_char_index === "number") out.startCharIndex = r.start_char_index;
  if (typeof r.end_char_index === "number") out.endCharIndex = r.end_char_index;
  if (typeof r.start_block_index === "number") out.startBlockIndex = r.start_block_index;
  if (typeof r.end_block_index === "number") out.endBlockIndex = r.end_block_index;
  if (typeof r.start_page_number === "number") out.startPageNumber = r.start_page_number;
  if (typeof r.end_page_number === "number") out.endPageNumber = r.end_page_number;
  if (typeof r.document_index === "number") out.documentIndex = r.document_index;
  if (typeof r.document_title === "string") out.documentTitle = r.document_title;
  return out;
}

function buildAnthropicGenerateResult(payload: unknown): {
  content: AnthropicGenerateContent[];
  finishReason?: string | { unified: string; raw: string } | null;
  usage?: RuntimeUsage;
} {
  const record = readRecord(payload);
  const content = Array.isArray(record?.content) ? record.content : [];
  const normalized: AnthropicGenerateContent[] = [];

  for (const blockValue of content) {
    const block = readRecord(blockValue);
    const blockType = typeof block?.type === "string" ? block.type : undefined;

    if (blockType === "text" && typeof block?.text === "string" && block.text.length > 0) {
      const citationsRaw = Array.isArray(block.citations) ? block.citations : undefined;
      const citations = citationsRaw
        ?.flatMap((c) => {
          const normalizedCitation = normalizeAnthropicCitation(c);
          return normalizedCitation ? [normalizedCitation] : [];
        });
      normalized.push({
        type: "text",
        text: block.text,
        ...(citations && citations.length > 0 ? { citations } : {}),
      });
      continue;
    }

    // Thinking blocks carry the cleartext trace plus a signature that
    // Anthropic uses to verify on subsequent turns. Surfacing both lets
    // callers persist them as `reasoning` content parts and replay on
    // the next turn so Claude can continue from the same thinking.
    if (blockType === "thinking") {
      normalized.push({
        type: "reasoning",
        ...(typeof block?.thinking === "string" ? { text: block.thinking } : {}),
        ...(typeof block?.signature === "string" ? { signature: block.signature } : {}),
      });
      continue;
    }

    // Redacted thinking blocks arrive when Claude's safety classifier
    // hides the trace. Pass the encrypted blob through opaquely so the
    // caller can replay it on the next turn (Anthropic still needs the
    // blob to verify continuity even though it can't read it).
    if (blockType === "redacted_thinking" && typeof block?.data === "string") {
      normalized.push({
        type: "reasoning",
        redactedData: block.data,
      });
      continue;
    }

    if (
      (blockType === "tool_use" || blockType === "server_tool_use") &&
      typeof block?.id === "string" &&
      typeof block?.name === "string"
    ) {
      normalized.push({
        type: "tool-call",
        toolCallId: block.id,
        toolName: block.name,
        input: stringifyJsonValue(block.input ?? {}),
        ...(blockType === "server_tool_use" ? { providerExecuted: true } : {}),
      });
      continue;
    }

    if (blockType === "web_search_tool_result" || blockType === "web_fetch_tool_result") {
      const parsedResult = parseAnthropicServerToolResult(block);
      if (!parsedResult) continue;
      normalized.push({
        type: "tool-result",
        toolCallId: parsedResult.toolCallId,
        toolName: parsedResult.toolName,
        result: parsedResult.result,
        ...(parsedResult.isError === true ? { isError: true } : {}),
        providerExecuted: true,
      });
    }
  }

  return {
    content: normalized,
    finishReason: normalizeAnthropicFinishReason(record?.stop_reason),
    usage: extractAnthropicUsage(payload),
  };
}

type AnthropicRequestBody = Record<string, unknown> & {
  messages?: unknown[];
};

function createPauseTurnContinuationBody(
  baseBody: AnthropicRequestBody,
  rawAssistantContent: unknown[],
): AnthropicRequestBody {
  return {
    ...baseBody,
    messages: [
      ...(Array.isArray(baseBody.messages) ? baseBody.messages : []),
      { role: "assistant", content: rawAssistantContent },
    ],
  };
}

function readRawAnthropicResponse(payload: unknown): {
  rawContent: unknown[];
  rawStopReason?: string;
} {
  const record = readRecord(payload);
  return {
    rawContent: Array.isArray(record?.content) ? record.content : [],
    ...(typeof record?.stop_reason === "string" ? { rawStopReason: record.stop_reason } : {}),
  };
}

function throwIfAnthropicRequestAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  throw new DOMException("The Anthropic request was aborted", "AbortError");
}

function shouldPreserveAnthropicRawAssistantHistory(
  prompt: OpenAICompatibleLanguageOptions["prompt"],
  rawAssistantMessages: unknown[][],
): boolean {
  const hasPriorProviderCall = prompt.some((message) =>
    message.role === "assistant" && (message.providerToolCalls?.length ?? 0) > 0
  );
  let hasServerToolContent = false;
  let hasClientToolUse = false;
  for (const content of rawAssistantMessages) {
    for (const value of content) {
      const block = readRecord(value);
      if (block?.type === "tool_use") hasClientToolUse = true;
      if (
        block?.type === "server_tool_use" || block?.type === "web_search_tool_result" ||
        block?.type === "web_fetch_tool_result"
      ) {
        hasServerToolContent = true;
      }
    }
  }
  return hasPriorProviderCall || hasServerToolContent && hasClientToolUse;
}

function createAnthropicRawAssistantMetadata(
  prompt: OpenAICompatibleLanguageOptions["prompt"],
  rawAssistantMessages: unknown[][],
): Record<string, unknown> | undefined {
  if (!shouldPreserveAnthropicRawAssistantHistory(prompt, rawAssistantMessages)) {
    return undefined;
  }
  return { anthropic: { rawAssistantMessages } };
}

function createProviderAbortScope(callerSignal: AbortSignal | undefined): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal?.aborted) {
    abortFromCaller();
    return { controller, dispose() {} };
  }

  callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  return {
    controller,
    dispose() {
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function createCancelableProviderStream(
  iterable: AsyncIterable<unknown>,
  providerAbortController: AbortController,
  disposeAbortScope: () => void,
): ReadableStream<unknown> {
  const iterator = iterable[Symbol.asyncIterator]();
  let consumerCanceled = false;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disposeAbortScope();
  };

  return new ReadableStream<unknown>(
    {
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) {
            dispose();
            controller.close();
            return;
          }
          controller.enqueue(next.value);
        } catch (error) {
          dispose();
          if (!consumerCanceled) {
            controller.error(error);
          }
        }
      },
      async cancel(reason) {
        consumerCanceled = true;
        if (!providerAbortController.signal.aborted) {
          providerAbortController.abort(reason);
        }
        try {
          await iterator.return?.();
        } catch (error) {
          if (!providerAbortController.signal.aborted) {
            throw error;
          }
        } finally {
          dispose();
        }
      },
    },
    // Do not speculatively pull the nested async iterators. Keeping zero
    // buffered parts lets cancel() reach their return/finally chain
    // immediately after the consumer's last read.
    { highWaterMark: 0 },
  );
}

export function createAnthropicModelRuntime(
  config: AnthropicRuntimeConfig,
  modelId: string,
): ModelRuntime {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const providerName = config.name ?? "anthropic";
  const streamOptions = providerName === "veryfront-cloud"
    ? { clientToolUseTrailingUsageTimeoutMode: "drain" as const }
    : undefined;

  return {
    provider: providerName,
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    async doGenerate(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getAnthropicMessagesUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildAnthropicMessagesRequest(
        modelId,
        config.name ?? "anthropic",
        options,
        false,
        warnings,
      ) as AnthropicRequestBody;
      let requestBody = body;
      let continuationCount = 0;
      let aggregateUsage: RuntimeUsage | undefined;
      const aggregateContent: AnthropicGenerateContent[] = [];
      const rawAssistantMessages: unknown[][] = [];
      let finalResult: ReturnType<typeof buildAnthropicGenerateResult> | undefined;

      while (true) {
        throwIfAnthropicRequestAborted(options.abortSignal);
        const payload = await requestJson({
          url,
          fetchImpl,
          providerLabel: config.name ?? "anthropic",
          providerKind: "anthropic",
          init: createAnthropicRequestInit({
            apiKey: config.apiKey,
            authToken: config.authToken,
            extraHeaders: options.headers,
            body: JSON.stringify(requestBody),
            signal: options.abortSignal,
          }),
        });
        const result = buildAnthropicGenerateResult(payload);
        aggregateContent.push(...result.content);
        aggregateUsage = addAnthropicUsage(aggregateUsage, result.usage);
        finalResult = result;

        const raw = readRawAnthropicResponse(payload);
        if (raw.rawContent.length > 0) rawAssistantMessages.push(raw.rawContent);
        if (
          raw.rawStopReason !== "pause_turn" ||
          raw.rawContent.length === 0 ||
          continuationCount >= MAX_PAUSE_TURN_CONTINUATIONS
        ) {
          break;
        }

        continuationCount++;
        requestBody = createPauseTurnContinuationBody(requestBody, raw.rawContent);
      }

      const drained = warnings.drain();
      const providerMetadata = createAnthropicRawAssistantMetadata(
        options.prompt,
        rawAssistantMessages,
      );
      return {
        content: aggregateContent,
        finishReason: finalResult?.finishReason ?? null,
        ...(aggregateUsage ? { usage: aggregateUsage } : {}),
        ...(providerMetadata ? { providerMetadata } : {}),
        ...(drained.length > 0 ? { warnings: drained } : {}),
      };
    },
    async doStream(optionsForRuntime: unknown) {
      const options = optionsForRuntime as OpenAICompatibleLanguageOptions;
      const url = getAnthropicMessagesUrl(config.baseURL);
      const warnings = createWarningCollector();
      const body = buildAnthropicMessagesRequest(
        modelId,
        config.name ?? "anthropic",
        options,
        true,
        warnings,
      ) as AnthropicRequestBody;
      throwIfAnthropicRequestAborted(options.abortSignal);
      const providerAbortScope = createProviderAbortScope(options.abortSignal);
      let firstResponseStream: ReadableStream<Uint8Array>;
      try {
        firstResponseStream = await requestStream({
          url,
          fetchImpl,
          providerLabel: config.name ?? "anthropic",
          providerKind: "anthropic",
          init: createAnthropicRequestInit({
            apiKey: config.apiKey,
            authToken: config.authToken,
            extraHeaders: options.headers,
            enableFineGrainedToolStreaming: true,
            body: JSON.stringify(body),
            signal: providerAbortScope.controller.signal,
          }),
        });
      } catch (error) {
        providerAbortScope.dispose();
        throw error;
      }
      const drained = warnings.drain();

      const continuePausedStream = async function* (): AsyncIterable<unknown> {
        let responseStream = firstResponseStream;
        let continuationCount = 0;
        let aggregateUsage: RuntimeUsage | undefined;
        let requestBody = body;
        const rawAssistantMessages: unknown[][] = [];

        while (true) {
          let completion: AnthropicStreamCompletion | undefined;
          let finishPart: Record<string, unknown> | undefined;
          for await (
            const part of streamAnthropicCompatibleParts(responseStream, {
              ...streamOptions,
              onCompletion(value) {
                completion = value;
              },
            })
          ) {
            const record = readRecord(part);
            if (record?.type === "finish") {
              finishPart = record;
              continue;
            }
            yield part;
          }

          aggregateUsage = addAnthropicUsage(aggregateUsage, completion?.usage);
          if (completion && completion.rawContent.length > 0) {
            rawAssistantMessages.push(completion.rawContent);
          }
          if (
            completion?.rawStopReason !== "pause_turn" ||
            completion.rawContent.length === 0 ||
            continuationCount >= MAX_PAUSE_TURN_CONTINUATIONS
          ) {
            const providerMetadata = createAnthropicRawAssistantMetadata(
              options.prompt,
              rawAssistantMessages,
            );
            yield {
              ...(finishPart ?? { type: "finish", finishReason: completion?.finishReason ?? null }),
              ...(aggregateUsage ? { usage: aggregateUsage } : {}),
              ...(providerMetadata ? { providerMetadata } : {}),
            };
            return;
          }

          continuationCount++;
          requestBody = createPauseTurnContinuationBody(requestBody, completion.rawContent);
          throwIfAnthropicRequestAborted(providerAbortScope.controller.signal);
          responseStream = await requestStream({
            url,
            fetchImpl,
            providerLabel: config.name ?? "anthropic",
            providerKind: "anthropic",
            init: createAnthropicRequestInit({
              apiKey: config.apiKey,
              authToken: config.authToken,
              extraHeaders: options.headers,
              enableFineGrainedToolStreaming: true,
              body: JSON.stringify(requestBody),
              signal: providerAbortScope.controller.signal,
            }),
          });
        }
      };

      return {
        stream: createCancelableProviderStream(
          withToolInputStatusTransitions(continuePausedStream()),
          providerAbortScope.controller,
          providerAbortScope.dispose,
        ),
        ...(drained.length > 0 ? { warnings: drained } : {}),
      };
    },
  };
}

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";

  createModel(modelId: string, config: LLMProviderConfig): ModelRuntime {
    return createAnthropicModelRuntime(
      {
        apiKey: config.credential,
        authToken: typeof config.authToken === "string" ? config.authToken : undefined,
        baseURL: config.baseURL,
        name: config.name ?? "anthropic",
        fetch: config.fetch,
      },
      modelId,
    );
  }
}
