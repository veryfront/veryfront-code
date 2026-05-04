/**
 * Shared plumbing consumed by the `@veryfront/ext-*` provider extensions.
 *
 * This barrel is the stable public surface: implementations currently live
 * in `runtime-loader.ts` and `runtime-loader/` subdirectory. Future PRs
 * (post ext-anthropic / ext-google extraction) may move the implementations
 * into this directory; extensions keep importing from here unchanged.
 *
 * @module provider/shared
 */

// URL builders
export {
  getAnthropicMessagesUrl,
  getGoogleEmbeddingUrl,
  getGoogleGenerateContentUrl,
  getGoogleStreamGenerateContentUrl,
  getOpenAIChatCompletionsUrl,
  getOpenAIEmbeddingUrl,
  getOpenAIResponsesUrl,
} from "../runtime-loader/provider-endpoints.ts";

// Request init builders
export {
  createAnthropicRequestInit,
  createGoogleRequestInit,
  createOpenAIRequestInit,
} from "../runtime-loader/provider-request-init.ts";

// Tool-input status transitions
export {
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  withToolInputStatusTransitions,
} from "../runtime-loader/tool-input-status.ts";

// SSE chunk parser
export { parseSseChunk } from "../runtime-loader/provider-sse.ts";

// Retry / error / HTTP plumbing (currently in runtime-loader.ts).
export {
  buildProviderError,
  createWarningCollector,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
  ProviderError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
  readProviderOptions,
  readRecord,
  readTextParts,
  requestJson,
  requestStream,
  stringifyJsonValue,
  toOpenAICompatibleMessages,
  toOpenAICompatibleTools,
  unwrapToolInputSchema,
} from "../runtime-loader.ts";

export type {
  OpenAICompatibleChatMessage,
  OpenAICompatibleChatRequest,
  RuntimePromptMessage,
} from "../runtime-loader.ts";
