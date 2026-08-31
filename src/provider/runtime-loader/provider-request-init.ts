const ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";
const ANTHROPIC_MCP_CLIENT_BETA = "mcp-client-2025-11-20";
const DEPRECATED_ANTHROPIC_MCP_CLIENT_BETA = "mcp-client-2025-04-04";
const MAX_PROVIDER_CREDENTIAL_BYTES = 8 * 1024;
const MAX_INFERENCE_CREDENTIAL_BYTES = 16 * 1024;
const PROVIDER_CREDENTIAL_ENCODER = new TextEncoder();

/**
 * Minimum Anthropic API version this runtime was built against.
 * Used as the default when the caller does not supply an `anthropic-version`
 * header. Update this constant (and test against the changelog) whenever
 * adopting a new API version with breaking changes.
 */
const ANTHROPIC_API_VERSION = "2023-06-01";

export function requireProviderCredential(
  value: unknown,
  credentialName: string,
  maxBytes = MAX_PROVIDER_CREDENTIAL_BYTES,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    !/^[\x21-\x7e]+$/.test(value)
  ) {
    throw new TypeError(
      `${credentialName} must be a non-empty visible ASCII string without surrounding whitespace`,
    );
  }
  if (
    PROVIDER_CREDENTIAL_ENCODER.encode(value).byteLength > maxBytes
  ) {
    throw new RangeError(
      `${credentialName} must not exceed ${maxBytes} bytes`,
    );
  }
  return value;
}

/** @internal Validate signed inference credentials at their larger transport bound. */
export function requireInferenceProviderCredential(
  value: unknown,
  credentialName: string,
): string {
  return requireProviderCredential(value, credentialName, MAX_INFERENCE_CREDENTIAL_BYTES);
}

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

function updateAnthropicBetaHeader(
  headers: Headers,
  options: {
    enableFineGrainedToolStreaming?: boolean;
    enableMcpConnector?: boolean;
  },
): void {
  if (!options.enableFineGrainedToolStreaming && !options.enableMcpConnector) {
    return;
  }

  const betas = new Set(
    (headers.get("anthropic-beta") ?? "")
      .split(",")
      .map((beta) => beta.trim())
      .filter((beta) => beta.length > 0),
  );
  if (options.enableMcpConnector) {
    betas.delete(DEPRECATED_ANTHROPIC_MCP_CLIENT_BETA);
    betas.add(ANTHROPIC_MCP_CLIENT_BETA);
  }
  if (options.enableFineGrainedToolStreaming) {
    betas.add(ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA);
  }
  headers.set("anthropic-beta", Array.from(betas).join(","));
}

export function createAnthropicRequestHeaders(options: {
  apiKey?: string;
  authToken?: string;
  extraHeaders?: HeadersInit;
  enableFineGrainedToolStreaming?: boolean;
  enableMcpConnector?: boolean;
}): Headers {
  const headers = new Headers(options.extraHeaders);
  headers.set("content-type", "application/json");
  headers.set("anthropic-version", headers.get("anthropic-version") ?? ANTHROPIC_API_VERSION);

  updateAnthropicBetaHeader(headers, options);

  if (options.authToken !== undefined) {
    const authToken = requireProviderCredential(
      options.authToken,
      "Anthropic auth token",
    );
    headers.delete("x-api-key");
    headers.set("authorization", `Bearer ${authToken}`);
  } else if (options.apiKey !== undefined) {
    const apiKey = requireProviderCredential(
      options.apiKey,
      "Anthropic API key",
    );
    headers.delete("authorization");
    headers.set("x-api-key", apiKey);
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
  const apiKey = requireProviderCredential(options.apiKey, "OpenAI API key");
  return {
    method: "POST",
    headers: createRequestHeaders({
      apiKeyHeaderName: "authorization",
      apiKey: `Bearer ${apiKey}`,
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
  enableMcpConnector?: boolean;
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
      enableMcpConnector: options.enableMcpConnector,
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
  const apiKey = requireProviderCredential(options.apiKey, "Google API key");
  return {
    method: "POST",
    headers: createRequestHeaders({
      apiKeyHeaderName: "x-goog-api-key",
      apiKey,
      extraHeaders: options.extraHeaders,
    }),
    body: options.body,
    signal: options.signal,
  };
}
