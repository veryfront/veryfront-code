const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function joinUrl(base: string, path: string): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new TypeError("Provider base URL must be a valid HTTP(S) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Provider base URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new TypeError("Provider base URL must not contain embedded credentials");
  }

  const queryIndex = path.indexOf("?");
  const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
  const pathQuery = queryIndex === -1 ? undefined : path.slice(queryIndex + 1);

  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${pathname.replace(/^\/+/, "")}`;
  if (pathQuery !== undefined) {
    const pathParams = new URLSearchParams(pathQuery);
    const overriddenNames = new Set(pathParams.keys());
    for (const name of overriddenNames) {
      url.searchParams.delete(name);
    }
    for (const [name, value] of pathParams) {
      url.searchParams.append(name, value);
    }
  }
  // Fragments are client-side document identifiers and never belong on an API
  // request. Queries are retained for compatible gateways that require them.
  url.hash = "";
  return url.toString();
}

function encodeModelId(modelId: string): string {
  if (typeof modelId !== "string" || modelId.length === 0 || modelId !== modelId.trim()) {
    throw new TypeError("Provider model ID must be a non-empty trimmed string");
  }
  return encodeURIComponent(modelId);
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
    `models/${encodeModelId(modelId)}:generateContent`,
  );
}

/** Return Google stream generate content URL. */
export function getGoogleStreamGenerateContentUrl(
  baseURL: string | undefined,
  modelId: string,
): string {
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeModelId(modelId)}:streamGenerateContent?alt=sse`,
  );
}

/** Return Google embedding URL. */
export function getGoogleEmbeddingUrl(baseURL: string | undefined, modelId: string): string {
  return joinUrl(
    baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    `models/${encodeModelId(modelId)}:embedContent`,
  );
}
