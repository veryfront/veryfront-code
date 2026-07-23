import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";

/**
 * Minimum Anthropic API version this runtime was built against.
 * Used as the default when the caller does not supply an `anthropic-version`
 * header. Update this constant (and test against the changelog) whenever
 * adopting a new API version with breaking changes.
 */
const ANTHROPIC_API_VERSION = "2023-06-01";

function assertCredential(value: unknown): asserts value is string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 16_384 ||
    /\s/u.test(value) || hasUnsafeControlCharacters(value)
  ) {
    throw new TypeError("Provider credential is invalid");
  }
}

export function createRequestHeaders(options: {
  apiKeyHeaderName: string;
  apiKey: string;
  extraHeaders?: HeadersInit;
}): Headers {
  assertCredential(options.apiKey);
  const headers = new Headers(options.extraHeaders);
  headers.set("content-type", "application/json");
  headers.set(options.apiKeyHeaderName, options.apiKey);
  return headers;
}

export function createAnthropicRequestHeaders(options: {
  apiKey?: string;
  authToken?: string;
  extraHeaders?: HeadersInit;
  enableFineGrainedToolStreaming?: boolean;
}): Headers {
  if (!options.authToken && !options.apiKey) {
    throw new TypeError("Anthropic credential is required");
  }
  if (options.authToken !== undefined) assertCredential(options.authToken);
  if (options.apiKey !== undefined) assertCredential(options.apiKey);
  const headers = new Headers(options.extraHeaders);
  headers.set("content-type", "application/json");
  headers.set("anthropic-version", headers.get("anthropic-version") ?? ANTHROPIC_API_VERSION);
  headers.delete("authorization");
  headers.delete("x-api-key");

  if (options.enableFineGrainedToolStreaming) {
    const existingBetaHeader = headers.get("anthropic-beta");
    if (!existingBetaHeader) {
      headers.set("anthropic-beta", ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA);
    } else {
      const betas = new Set(
        existingBetaHeader.split(",").map((beta) => beta.trim()).filter((beta) => beta.length > 0),
      );
      betas.add(ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA);
      headers.set("anthropic-beta", Array.from(betas).join(","));
    }
  }

  if (options.authToken) {
    headers.set("authorization", `Bearer ${options.authToken}`);
  } else if (options.apiKey) {
    headers.set("x-api-key", options.apiKey);
  }

  return headers;
}

/** Create request init options for OpenAI-compatible providers. */
export function createOpenAIRequestInit(options: {
  apiKey: string;
  extraHeaders?: HeadersInit;
  body: string;
  signal?: AbortSignal;
}): RequestInit {
  const headers = createRequestHeaders({
    apiKeyHeaderName: "authorization",
    apiKey: options.apiKey,
    extraHeaders: options.extraHeaders,
  });
  headers.set("authorization", `Bearer ${options.apiKey}`);
  return {
    method: "POST",
    headers,
    body: options.body,
    signal: options.signal,
  };
}

/** Create Anthropic request init. */
export function createAnthropicRequestInit(options: {
  apiKey?: string;
  authToken?: string;
  extraHeaders?: HeadersInit;
  enableFineGrainedToolStreaming?: boolean;
  body: string;
  signal?: AbortSignal;
}): RequestInit {
  return {
    method: "POST",
    headers: createAnthropicRequestHeaders({
      apiKey: options.apiKey,
      authToken: options.authToken,
      extraHeaders: options.extraHeaders,
      enableFineGrainedToolStreaming: options.enableFineGrainedToolStreaming,
    }),
    body: options.body,
    signal: options.signal,
  };
}

/** Create Google request init. */
export function createGoogleRequestInit(options: {
  apiKey: string;
  extraHeaders?: HeadersInit;
  body: string;
  signal?: AbortSignal;
}): RequestInit {
  return {
    method: "POST",
    headers: createRequestHeaders({
      apiKeyHeaderName: "x-goog-api-key",
      apiKey: options.apiKey,
      extraHeaders: options.extraHeaders,
    }),
    body: options.body,
    signal: options.signal,
  };
}
