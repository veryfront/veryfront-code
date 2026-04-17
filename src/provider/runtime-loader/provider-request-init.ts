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
}): Headers {
  const headers = new Headers(options.extraHeaders);
  headers.set("content-type", "application/json");
  headers.set("anthropic-version", headers.get("anthropic-version") ?? "2023-06-01");

  if (options.authToken) {
    headers.set("authorization", `Bearer ${options.authToken}`);
  } else if (options.apiKey) {
    headers.set("x-api-key", options.apiKey);
  }

  return headers;
}

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

export function createAnthropicRequestInit(options: {
  apiKey?: string;
  authToken?: string;
  extraHeaders?: HeadersInit;
  body: string;
  signal?: AbortSignal;
}): RequestInit {
  return {
    method: "POST",
    headers: createAnthropicRequestHeaders({
      apiKey: options.apiKey,
      authToken: options.authToken,
      extraHeaders: options.extraHeaders,
    }),
    body: options.body,
    signal: options.signal,
  };
}

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
