import "../_helpers/contract-init.ts";
import { agent } from "../../src/agent/factory.ts";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export type MockFetchCall = { url: string; init?: RequestInit };

function toRequestUrl(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

export async function withMockedFetch<T>(
  responses: Response[],
  run: (calls: MockFetchCall[]) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls: MockFetchCall[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = toRequestUrl(input);
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) {
      throw new Error(`No mock response for ${url}`);
    }
    return next;
  }) as typeof fetch;

  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export function createGuideAgent(
  config: Partial<Parameters<typeof agent>[0]> = {},
) {
  return agent({
    model: "openai/gpt-4o",
    system: "You are a helpful assistant.",
    ...config,
  });
}
