/**
 * Shared plumbing consumed by the `@veryfront/ext-*` provider extensions.
 *
 * This barrel is the stable extension-facing surface. Implementations remain
 * internal to `runtime-loader.ts` and `runtime-loader/`; their physical
 * location may change without changing extension imports.
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
export {
  MAX_PROVIDER_SSE_BUFFER_CODE_UNITS,
  parseFinalSseChunk,
  parseSseChunk,
} from "../runtime-loader/provider-sse.ts";

// Retry, error, HTTP, usage, and JSON boundary plumbing.
export {
  buildProviderError,
  createWarningCollector,
  isNumberArray,
  jsonValuesEqual,
  mergeUsage,
  parseRetryAfterMs,
  ProviderError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
  readGatewayBillingMode,
  readProviderOptions,
  readRecord,
  readTextParts,
  requestJson,
  requestStream,
  snapshotJsonValue,
  snapshotProviderJsonValue,
  stringifyJsonValue,
  stringifyToolArguments,
  stringifyToolResultValue,
  toOpenAICompatibleMessages,
  toOpenAICompatibleTools,
  unwrapToolInputSchema,
} from "../runtime-loader.ts";

export type {
  JsonSnapshotOptions,
  JsonSnapshotValue,
  OpenAICompatibleChatMessage,
  OpenAICompatibleChatRequest,
  ProviderWarning,
  RuntimeUsage,
} from "../runtime-loader.ts";
export type {
  ModelRuntimeCallOptions,
  ModelRuntimePromptMessage,
  ModelRuntimeToolDefinition,
  RuntimeAssistantContentPart,
  RuntimePromptMessage,
  RuntimeReasoningOption,
  RuntimeResponseFormat,
} from "../types.ts";

// No-hook runtime inspection used by provider extensions at JSON boundaries.
export {
  canIdentifyProxyWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
