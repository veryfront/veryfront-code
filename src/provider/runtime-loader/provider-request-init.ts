const ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";

export function createRequestHeaders(options: {
  apiKeyHeaderName: string;
  apiKey: string;
  extraHeaders?: HeadersInit;
}): Headers {
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
  const headers = new Headers(options.extraHeaders);
  headers.set("content-type", "application/json");
  headers.set("anthropic-version", headers.get("anthropic-version") ?? "2023-06-01");

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
  return {
    method: "POST",
    headers: createRequestHeaders({
      apiKeyHeaderName: "authorization",
      apiKey: `Bearer ${options.apiKey}`,
      extraHeaders: options.extraHeaders,
    }),
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
