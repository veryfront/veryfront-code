import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function assertModelId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 4_096 ||
    /\s/u.test(value) || hasUnsafeControlCharacters(value)
  ) {
    throw new TypeError("Provider model ID is invalid");
  }
}

function joinUrl(base: string, path: string): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new TypeError("Provider base URL is invalid");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password ||
    url.hash
  ) {
    throw new TypeError("Provider base URL is invalid");
  }

  const separator = path.indexOf("?");
  const endpointPath = separator < 0 ? path : path.slice(0, separator);
  const endpointQuery = separator < 0 ? "" : path.slice(separator + 1);
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/${endpointPath.replace(/^\/+/, "")}`;
  for (const [key, value] of new URLSearchParams(endpointQuery)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
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
  assertModelId(modelId);
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
  assertModelId(modelId);
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`,
  );
}

/** Return Google embedding URL. */
export function getGoogleEmbeddingUrl(baseURL: string | undefined, modelId: string): string {
  assertModelId(modelId);
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeURIComponent(modelId)}:embedContent`,
  );
}
