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
  DEFAULT_PROVIDER_STREAM_HEADERS_TIMEOUT_MS,
  DEFAULT_PROVIDER_STREAM_TOTAL_HEADERS_BUDGET_MS,
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
  waitForProviderStreamRetry,
} from "veryfront/provider/shared";
import {
  buildAnthropicMessagesRequestWithCorrelationState,
  type OpenAICompatibleLanguageOptions,
} from "./anthropic-request-builder.ts";
import {
  type AnthropicProviderToolNameRegistry,
  isAnthropicProviderExecutedContentBlockType,
  isAnthropicProviderToolResultBlockType,
  parseAnthropicProviderToolUse,
  parseAnthropicServerToolResult,
  validateAnthropicRawAssistantMessages,
} from "./anthropic-native-content.ts";
import {
  addAnthropicUsage,
  type AnthropicStreamCompletion,
  extractAnthropicUsage,
  normalizeAnthropicFinishReason,
  streamAnthropicCompatibleParts,
} from "./anthropic-stream.ts";
import { type AnthropicCitation, normalizeAnthropicCitation } from "./anthropic-citations.ts";

const MAX_PAUSE_TURN_CONTINUATIONS = 5;

/**
 * Replays allowed when the SSE body itself reports a retryable failure.
 *
 * Anthropic answers HTTP 200 and then delivers `overloaded_error` or
 * `rate_limit_error` as the first event of the stream. `requestStream` cannot
 * retry that: it hands the body off the moment headers arrive, and past that
 * point a reader owns the body. So the replay has to live here, where the
 * request body is still available to re-issue. The bound and the backoff match
 * the pre-header loop in `provider/runtime-loader/provider-http.ts`.
 *
 * The backoff can add at most 3 seconds. Replay header attempts remain inside
 * the shared total header/idle-window budget, and each replay's header wait is
 * capped at 10 seconds.
 */
const MAX_ANTHROPIC_STREAM_REPLAYS = 2;
const ANTHROPIC_STREAM_REPLAY_DELAY_MS = 1_000;

/**
 * Ceiling on how long one replay may wait for response headers.
 *
 * The shared idle-window budget already stops replays from each opening a
 * fresh 40-second header budget, but it is generous by the time a replay
 * starts early in a window. This clamps the wait to the failure it covers: an
 * `overloaded_error` is the first event of the stream and arrives within about
 * a second of the headers, so a replay that cannot get headers inside ten
 * seconds was never going to rescue the run, and spending the rest of the idle
 * window on it only delays the same failure with a vaguer message.
 */
const ANTHROPIC_STREAM_REPLAY_HEADERS_BUDGET_MS = 10_000;

/**
 * Only a typed provider failure the classifier marked retryable may be
 * replayed. Caller cancellation surfaces as an `AbortError`, never a
 * `ProviderError`, so it can never reach a replay.
 *
 * The other half of the safety condition lives at the call site: a replay is
 * only issued while the consumer has seen nothing, because re-issuing after
 * output would duplicate it.
 */
function isReplayableAnthropicStreamFailure(error: unknown): boolean {
  return error instanceof ProviderError && error.retryable;
}

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
  providerExecuted: true;
};

type AnthropicGenerateContent =
  | AnthropicTextContent
  | AnthropicReasoningContent
  | AnthropicToolCallContent
  | AnthropicToolResultContent;

function invalidAnthropicResponse(
  providerLabel: string,
  issue: string,
): ProviderRequestError {
  return new ProviderRequestError({
    provider: "anthropic",
    status: 200,
    message: `${providerLabel} request failed: invalid successful response (${issue})`,
    retryable: false,
  });
}

function sanitizeAnthropicUsage(usage: RuntimeUsage | undefined): RuntimeUsage | undefined {
  const normalized = mergeUsage(undefined, usage);
  return normalized && Object.keys(normalized).length > 0 ? normalized : undefined;
}

function buildAnthropicGenerateResult(
  payload: unknown,
  providerLabel: string,
  providerToolNamesById: AnthropicProviderToolNameRegistry,
): {
  content: AnthropicGenerateContent[];
  finishReason?: string | { unified: string; raw: string } | null;
  usage?: RuntimeUsage;
} {
  const record = readRecord(payload);
  if (!record) {
    throw invalidAnthropicResponse(providerLabel, "response body was not an object");
  }
  if (!Array.isArray(record.content) || record.content.length === 0) {
    throw invalidAnthropicResponse(providerLabel, "content array missing or empty");
  }
  if (typeof record.stop_reason !== "string" || record.stop_reason.length === 0) {
    throw invalidAnthropicResponse(providerLabel, "stop reason missing");
  }
  const content = record.content;
  const normalized: AnthropicGenerateContent[] = [];

  for (const blockValue of content) {
    const block = readRecord(blockValue);
    if (!block) {
      throw invalidAnthropicResponse(providerLabel, "content block was not an object");
    }
    const blockType = typeof block?.type === "string" ? block.type : undefined;

    if (blockType === "text") {
      if (typeof block.text !== "string") {
        throw invalidAnthropicResponse(providerLabel, "text content block was malformed");
      }
      if (block.text.length === 0) continue;
      if (block.citations !== undefined && !Array.isArray(block.citations)) {
        throw invalidAnthropicResponse(providerLabel, "text citations were malformed");
      }
      const citations = block.citations?.map((citation) => {
        const normalizedCitation = normalizeAnthropicCitation(citation);
        if (!normalizedCitation) {
          throw invalidAnthropicResponse(providerLabel, "text citation was malformed");
        }
        return normalizedCitation;
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
      if (
        (block.thinking !== undefined && typeof block.thinking !== "string") ||
        (block.signature !== undefined && typeof block.signature !== "string") ||
        (typeof block.thinking !== "string" && typeof block.signature !== "string")
      ) {
        throw invalidAnthropicResponse(providerLabel, "thinking content block was malformed");
      }
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
    if (blockType === "redacted_thinking") {
      if (typeof block.data !== "string" || block.data.length === 0) {
        throw invalidAnthropicResponse(
          providerLabel,
          "redacted thinking content block was malformed",
        );
      }
      normalized.push({ type: "reasoning", redactedData: block.data });
      continue;
    }

    if (blockType === "tool_use") {
      const input = block.input === undefined ? {} : readRecord(block.input);
      if (
        typeof block.id !== "string" ||
        block.id.length === 0 ||
        typeof block.name !== "string" ||
        block.name.length === 0 ||
        !input
      ) {
        throw invalidAnthropicResponse(providerLabel, "tool-use content block was malformed");
      }
      normalized.push({
        type: "tool-call",
        toolCallId: block.id,
        toolName: block.name,
        input: stringifyJsonValue(input),
      });
      continue;
    }

    if (blockType === "server_tool_use" || blockType === "mcp_tool_use") {
      const providerToolUse = parseAnthropicProviderToolUse(block);
      if (
        !providerToolUse ||
        providerToolNamesById.has(providerToolUse.toolCallId)
      ) {
        throw invalidAnthropicResponse(
          providerLabel,
          "provider tool-use content block was malformed",
        );
      }
      providerToolNamesById.set(
        providerToolUse.toolCallId,
        providerToolUse.toolName,
      );
      normalized.push({
        type: "tool-call",
        toolCallId: providerToolUse.toolCallId,
        toolName: providerToolUse.toolName,
        input: stringifyJsonValue(providerToolUse.input),
        providerExecuted: true,
      });
      continue;
    }

    if (blockType && isAnthropicProviderToolResultBlockType(blockType)) {
      const parsedResult = parseAnthropicServerToolResult(block, providerToolNamesById);
      if (!parsedResult) {
        throw invalidAnthropicResponse(
          providerLabel,
          "provider tool-result content block was malformed",
        );
      }
      providerToolNamesById.delete(parsedResult.toolCallId);
      normalized.push({
        type: "tool-result",
        toolCallId: parsedResult.toolCallId,
        toolName: parsedResult.toolName,
        result: parsedResult.result,
        ...(parsedResult.isError === true ? { isError: true } : {}),
        providerExecuted: true,
      });
      continue;
    }

    throw invalidAnthropicResponse(
      providerLabel,
      "unsupported content block type",
    );
  }
  if (normalized.length === 0) {
    throw invalidAnthropicResponse(providerLabel, "content contained no supported blocks");
  }

  return {
    content: normalized,
    finishReason: normalizeAnthropicFinishReason(record?.stop_reason),
    usage: sanitizeAnthropicUsage(extractAnthropicUsage(payload)),
  };
}

type AnthropicRequestBody = Record<string, unknown> & {
  messages?: unknown[];
};

function usesAnthropicMcpConnector(body: AnthropicRequestBody): boolean {
  return Array.isArray(body.mcp_servers) && body.mcp_servers.length > 0;
}

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
    message.role === "assistant" &&
    (
      (message.providerToolCalls?.length ?? 0) > 0 ||
      message.content.some((part) => part.type === "tool-call" && part.providerExecuted === true)
    )
  );
  let hasServerToolContent = false;
  let hasClientToolContent = false;
  let hasReplayRequiredContent = false;
  for (const content of rawAssistantMessages) {
    for (const value of content) {
      const block = readRecord(value);
      if (block?.type === "thinking" || block?.type === "redacted_thinking") {
        hasReplayRequiredContent = true;
      }
      if (block?.type === "tool_use") {
        hasClientToolContent = true;
      }
      if (
        isAnthropicProviderExecutedContentBlockType(block?.type)
      ) {
        hasServerToolContent = true;
      }
    }
  }
  return hasPriorProviderCall || hasServerToolContent || hasClientToolContent ||
    hasReplayRequiredContent;
}

function createAnthropicRawAssistantMetadata(
  providerLabel: string,
  prompt: OpenAICompatibleLanguageOptions["prompt"],
  rawAssistantMessages: unknown[][],
  initialProviderToolNamesById: ReadonlyMap<string, string>,
): Record<string, unknown> | undefined {
  if (rawAssistantMessages.length === 0) {
    return undefined;
  }
  try {
    const snapshot = validateAnthropicRawAssistantMessages(
      rawAssistantMessages,
      new Map(initialProviderToolNamesById),
    );
    if (!shouldPreserveAnthropicRawAssistantHistory(prompt, snapshot)) {
      return undefined;
    }
    return { anthropic: { rawAssistantMessages: snapshot } };
  } catch {
    throw invalidAnthropicResponse(
      providerLabel,
      "raw assistant metadata could not be retained safely",
    );
  }
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
): ModelRuntime<OpenAICompatibleLanguageOptions, AnthropicGenerateContent> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const providerName = config.name ?? "anthropic";
  const streamOptions = providerName === "veryfront-cloud"
    ? {
      clientToolUseTrailingUsageTimeoutMode: "drain" as const,
      allowPostTerminalUsage: true,
    }
    : undefined;

  return {
    provider: providerName,
    modelProvider: "anthropic",
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    runtimeCapabilities: {
      structuredOutput: supportsAnthropicStructuredOutput(modelId) ? ["json_schema"] : false,
    },
    async doGenerate(options: OpenAICompatibleLanguageOptions) {
      const url = getAnthropicMessagesUrl(config.baseURL);
      const warnings = createWarningCollector();
      const {
        body,
        providerToolNamesById: initialProviderToolNamesById,
      } = buildAnthropicMessagesRequestWithCorrelationState(
        modelId,
        config.name ?? "anthropic",
        options,
        false,
        warnings,
      );
      const enableMcpConnector = usesAnthropicMcpConnector(body);
      let requestBody: AnthropicRequestBody = body;
      let continuationCount = 0;
      let aggregateUsage: RuntimeUsage | undefined;
      const aggregateContent: AnthropicGenerateContent[] = [];
      const rawAssistantMessages: unknown[][] = [];
      const providerToolNamesById: AnthropicProviderToolNameRegistry = new Map(
        initialProviderToolNamesById,
      );
      let finalResult: ReturnType<typeof buildAnthropicGenerateResult> | undefined;

      while (true) {
        throwIfAnthropicRequestAborted(options.abortSignal);
        const payload = await requestJson({
          url,
          fetchImpl,
          providerLabel: config.name ?? "anthropic",
          providerKind: "anthropic",
          modelId,
          init: createAnthropicRequestInit({
            apiKey: config.apiKey,
            authToken: config.authToken,
            extraHeaders: options.headers,
            enableMcpConnector,
            body: JSON.stringify(requestBody),
            signal: options.abortSignal,
          }),
        });
        const result = buildAnthropicGenerateResult(
          payload,
          providerName,
          providerToolNamesById,
        );
        aggregateContent.push(...result.content);
        aggregateUsage = addAnthropicUsage(aggregateUsage, result.usage);
        finalResult = result;

        const raw = readRawAnthropicResponse(payload);
        if (raw.rawContent.length > 0) rawAssistantMessages.push(raw.rawContent);
        const shouldContinue = raw.rawStopReason === "pause_turn" &&
          raw.rawContent.length > 0;
        if (!shouldContinue) {
          break;
        }
        if (continuationCount >= MAX_PAUSE_TURN_CONTINUATIONS) {
          throw invalidAnthropicResponse(
            providerName,
            "pause_turn continuation limit exceeded",
          );
        }

        continuationCount++;
        requestBody = createPauseTurnContinuationBody(requestBody, raw.rawContent);
      }

      const drained = warnings.drain();
      const providerMetadata = createAnthropicRawAssistantMetadata(
        providerName,
        options.prompt,
        rawAssistantMessages,
        initialProviderToolNamesById,
      );
      return {
        content: aggregateContent,
        finishReason: finalResult?.finishReason ?? null,
        ...(aggregateUsage ? { usage: aggregateUsage } : {}),
        ...(providerMetadata ? { providerMetadata } : {}),
        ...(drained.length > 0 ? { warnings: drained } : {}),
      };
    },
    async doStream(options: OpenAICompatibleLanguageOptions) {
      const url = getAnthropicMessagesUrl(config.baseURL);
      const warnings = createWarningCollector();
      const {
        body,
        providerToolNamesById: initialProviderToolNamesById,
      } = buildAnthropicMessagesRequestWithCorrelationState(
        modelId,
        config.name ?? "anthropic",
        options,
        true,
        warnings,
      );
      const enableMcpConnector = usesAnthropicMcpConnector(body);
      throwIfAnthropicRequestAborted(options.abortSignal);
      const providerAbortScope = createProviderAbortScope(options.abortSignal);
      // Anchor for the shared header budget. It bounds one *idle window*: the
      // stretch where the consumer is awaiting a part and the stream watchdog
      // is counting. Replays stay inside the window they failed in, because a
      // replay only happens when nothing was yielded.
      //
      // It is re-anchored when a part is yielded, because that is when the
      // watchdog window restarts: the watchdog wraps each pending pull, so a
      // delivered part ends one window and the consumer's next pull opens the
      // next. A pause_turn continuation deliberately does NOT re-anchor. The
      // stream may spend most of a window finishing the paused response after
      // its last visible part, and handing the continuation a fresh budget
      // there would let it wait for headers past the window the watchdog is
      // still timing.
      let streamHeadersBudgetStartedAt = Math.floor(performance.now());
      const remainingStreamHeadersBudgetMs = () =>
        Math.max(
          0,
          DEFAULT_PROVIDER_STREAM_TOTAL_HEADERS_BUDGET_MS -
            (Math.floor(performance.now()) - streamHeadersBudgetStartedAt),
        );
      const issueStream = (
        requestBody: AnthropicRequestBody,
        headersBudgetCeilingMs?: number,
      ): Promise<ReadableStream<Uint8Array>> => {
        const totalHeadersBudgetMs = headersBudgetCeilingMs === undefined
          ? remainingStreamHeadersBudgetMs()
          : Math.min(headersBudgetCeilingMs, remainingStreamHeadersBudgetMs());
        return requestStream({
          url,
          fetchImpl,
          providerLabel: config.name ?? "anthropic",
          providerKind: "anthropic",
          modelId,
          init: createAnthropicRequestInit({
            apiKey: config.apiKey,
            authToken: config.authToken,
            extraHeaders: options.headers,
            enableFineGrainedToolStreaming: true,
            enableMcpConnector,
            body: JSON.stringify(requestBody),
            signal: providerAbortScope.controller.signal,
          }),
          // `requestStream` never shortens a request's *first* attempt to fit
          // the total budget, so the attempt deadline is clamped here as
          // well: to the replay ceiling when one is given, and always to what
          // is left of the idle window, so a request issued late in a window
          // cannot wait for headers beyond it.
          headersTimeoutMs: Math.min(
            headersBudgetCeilingMs ?? DEFAULT_PROVIDER_STREAM_HEADERS_TIMEOUT_MS,
            totalHeadersBudgetMs,
          ),
          totalHeadersBudgetMs,
        });
      };
      let firstResponseStream: ReadableStream<Uint8Array>;
      try {
        firstResponseStream = await issueStream(body);
      } catch (error) {
        providerAbortScope.dispose();
        throw error;
      }
      const drained = warnings.drain();

      const continuePausedStream = async function* (): AsyncIterable<unknown> {
        let responseStream = firstResponseStream;
        let continuationCount = 0;
        let streamReplayCount = 0;
        let aggregateUsage: RuntimeUsage | undefined;
        let requestBody: AnthropicRequestBody = body;
        const rawAssistantMessages: unknown[][] = [];
        const providerToolNamesById: AnthropicProviderToolNameRegistry = new Map(
          initialProviderToolNamesById,
        );

        while (true) {
          let completion: AnthropicStreamCompletion | undefined;
          let finishPart: Record<string, unknown> | undefined;
          // Every registry mutation in the parser is immediately followed by a
          // yield, so a replay can only happen while the registry is still
          // untouched. No snapshot is needed to restore it.
          let yieldedThisAttempt = false;
          try {
            for await (
              const part of streamAnthropicCompatibleParts(responseStream, {
                ...streamOptions,
                providerLabel: providerName,
                providerToolNamesById,
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
              yieldedThisAttempt = true;
              yield part;
              // Resuming after a yield means the consumer received that part
              // and pulled the next one: a new idle window just opened, so
              // the header budget and the replay bound restart with it. This
              // is the only place either resets.
              streamHeadersBudgetStartedAt = Math.floor(performance.now());
              streamReplayCount = 0;
            }
          } catch (error) {
            if (
              yieldedThisAttempt ||
              streamReplayCount >= MAX_ANTHROPIC_STREAM_REPLAYS ||
              !isReplayableAnthropicStreamFailure(error)
            ) {
              throw error;
            }
            if (
              Math.floor(performance.now()) - streamHeadersBudgetStartedAt >=
                DEFAULT_PROVIDER_STREAM_TOTAL_HEADERS_BUDGET_MS
            ) {
              throw error;
            }
            await waitForProviderStreamRetry(
              ANTHROPIC_STREAM_REPLAY_DELAY_MS * 2 ** streamReplayCount,
              providerAbortScope.controller.signal,
            );
            streamReplayCount++;
            throwIfAnthropicRequestAborted(providerAbortScope.controller.signal);
            if (remainingStreamHeadersBudgetMs() <= 0) {
              throw error;
            }
            responseStream = await issueStream(
              requestBody,
              ANTHROPIC_STREAM_REPLAY_HEADERS_BUDGET_MS,
            );
            continue;
          }

          aggregateUsage = addAnthropicUsage(aggregateUsage, completion?.usage);
          if (completion && completion.rawContent.length > 0) {
            rawAssistantMessages.push(completion.rawContent);
          }
          const continuationContent = completion?.rawStopReason === "pause_turn" &&
              completion.rawContent.length > 0
            ? completion.rawContent
            : undefined;
          if (!continuationContent) {
            const providerMetadata = createAnthropicRawAssistantMetadata(
              providerName,
              options.prompt,
              rawAssistantMessages,
              initialProviderToolNamesById,
            );
            yield {
              ...(finishPart ?? { type: "finish", finishReason: completion?.finishReason ?? null }),
              ...(aggregateUsage ? { usage: aggregateUsage } : {}),
              ...(providerMetadata ? { providerMetadata } : {}),
            };
            return;
          }
          if (continuationCount >= MAX_PAUSE_TURN_CONTINUATIONS) {
            throw invalidAnthropicResponse(
              providerName,
              "pause_turn continuation limit exceeded",
            );
          }

          continuationCount++;
          requestBody = createPauseTurnContinuationBody(requestBody, continuationContent);
          throwIfAnthropicRequestAborted(providerAbortScope.controller.signal);
          // The idle window open here began at the last yielded part, and the
          // watchdog timing it does not restart for a continuation. Draw on
          // what remains of that window instead of resetting it; when the
          // paused response already spent the whole window after its last
          // visible part, report the exhaustion rather than issuing a request
          // with no time to succeed in.
          if (remainingStreamHeadersBudgetMs() <= 0) {
            throw new ProviderRequestError({
              provider: "anthropic",
              status: 0,
              message: `${providerName} request failed: the stream header budget ` +
                `was exhausted before the pause_turn continuation was issued`,
              retryable: true,
            });
          }
          responseStream = await issueStream(requestBody);
        }
      };

      return {
        stream: createCancelableProviderStream(
          continuePausedStream(),
          providerAbortScope.controller,
          providerAbortScope.dispose,
        ),
        ...(drained.length > 0 ? { warnings: drained } : {}),
      };
    },
  };
}

function supportsAnthropicStructuredOutput(modelId: string): boolean {
  return /^claude-(?:fable-5|mythos-5|mythos-preview|haiku-4-5|sonnet-(?:4-[56]|5)|opus-(?:4-[5-8]|5))(?:-|$)/i
    .test(modelId);
}

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";

  createModel(
    modelId: string,
    config: LLMProviderConfig,
  ): ModelRuntime<OpenAICompatibleLanguageOptions, AnthropicGenerateContent> {
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
