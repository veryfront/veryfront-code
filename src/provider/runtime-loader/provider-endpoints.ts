const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** Return OpenAI embedding URL. */
export function getOpenAIEmbeddingUrl(baseURL?: string): string {
  return joinUrl(baseURL ?? DEFAULT_OPENAI_BASE_URL, "embeddings");
}

/** Return Anthropic messages URL. */
export function getAnthropicMessagesUrl(baseURL?: string): string {
  return joinUrl(baseURL ?? DEFAULT_ANTHROPIC_BASE_URL, "messages");
}

/** Return OpenAI chat completions URL. */
export function getOpenAIChatCompletionsUrl(baseURL?: string): string {
  return joinUrl(baseURL ?? DEFAULT_OPENAI_BASE_URL, "chat/completions");
}

/** Return OpenAI responses URL. */
export function getOpenAIResponsesUrl(baseURL?: string): string {
  return joinUrl(baseURL ?? DEFAULT_OPENAI_BASE_URL, "responses");
}

/** Return Google generate content URL. */
export function getGoogleGenerateContentUrl(
  baseURL: string | undefined,
  modelId: string,
): string {
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeURIComponent(modelId)}:generateContent`,
  );
}

/** Return Google stream generate content URL. */
export function getGoogleStreamGenerateContentUrl(
  baseURL: string | undefined,
  modelId: string,
): string {
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`,
  );
}

/** Return Google embedding URL. */
export function getGoogleEmbeddingUrl(baseURL: string | undefined, modelId: string): string {
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeURIComponent(modelId)}:embedContent`,
  );
}
