const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function getOpenAIEmbeddingUrl(baseURL?: string): string {
  return joinUrl(baseURL ?? DEFAULT_OPENAI_BASE_URL, "embeddings");
}

export function getAnthropicMessagesUrl(baseURL?: string): string {
  return joinUrl(baseURL ?? DEFAULT_ANTHROPIC_BASE_URL, "messages");
}

export function getOpenAIChatCompletionsUrl(baseURL?: string): string {
  return joinUrl(baseURL ?? DEFAULT_OPENAI_BASE_URL, "chat/completions");
}

export function getOpenAIResponsesUrl(baseURL?: string): string {
  return joinUrl(baseURL ?? DEFAULT_OPENAI_BASE_URL, "responses");
}

export function getGoogleGenerateContentUrl(
  baseURL: string | undefined,
  modelId: string,
): string {
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeURIComponent(modelId)}:generateContent`,
  );
}

export function getGoogleStreamGenerateContentUrl(
  baseURL: string | undefined,
  modelId: string,
): string {
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`,
  );
}

export function getGoogleEmbeddingUrl(baseURL: string | undefined, modelId: string): string {
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeURIComponent(modelId)}:embedContent`,
  );
}
