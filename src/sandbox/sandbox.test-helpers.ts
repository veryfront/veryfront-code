export type FetchCall = { url: string; init?: RequestInit };
export type MockResponseEntry =
  | Response
  | ((input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>);

export const SANDBOX_ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_URL",
] as const;

const originalSetTimeout = globalThis.setTimeout;
const originalDateNow = Date.now;

export function installMockFetch(
  state: { calls: FetchCall[]; responses: MockResponseEntry[] },
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    state.calls.push({ url, init });
    const entry = state.responses.shift();
    if (!entry) throw new Error(`No mock response for: ${url}`);
    return typeof entry === "function" ? await entry(input, init) : entry;
  }) as typeof fetch;
}

export function mockTimers(options: { advanceTimeByMs?: boolean } = {}): void {
  let fakeNow = 0;

  Date.now = () => fakeNow;
  (globalThis as Record<string, unknown>).setTimeout = (fn: () => void, ms?: number) => {
    if (options.advanceTimeByMs) {
      fakeNow += ms ?? 0;
    }
    return originalSetTimeout(fn, 0);
  };
}

export function restoreTimers(): void {
  (globalThis as Record<string, unknown>).setTimeout = originalSetTimeout;
  Date.now = originalDateNow;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

export function ndjsonResponse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((event) => JSON.stringify(event)).join("\n");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

export function getCall(calls: FetchCall[], index: number): FetchCall {
  const entry = calls[index];
  if (!entry) throw new Error(`No fetch call at index ${index}`);
  return entry;
}

export function headerValue(calls: FetchCall[], index: number, name: string): string | null {
  return new Headers(getCall(calls, index).init?.headers).get(name);
}

export function jsonBody(calls: FetchCall[], index: number): unknown {
  const body = getCall(calls, index).init?.body;
  if (typeof body !== "string") {
    throw new Error(`Expected string body for fetch call ${index}`);
  }
  return JSON.parse(body);
}

export function clearSandboxEnv(): void {
  for (const key of SANDBOX_ENV_KEYS) {
    try {
      Deno.env.delete(key);
    } catch {
      // expected: env may already be unset
    }
  }
}
