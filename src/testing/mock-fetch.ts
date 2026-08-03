import { __runWithOutboundFetchTransportForTests } from "#veryfront/security/http/outbound-fetch.ts";

type FetchMock = typeof globalThis.fetch | undefined;

/** Standard request-init fields that tests may need to observe from a fetch mock. */
export interface ObservedFetchRequestInit {
  body?: BodyInit | null;
  headers?: HeadersInit;
  method?: string;
  signal?: AbortSignal | null;
}

/**
 * Read standard request-init fields without assuming that the ambient fetch
 * implementation uses the DOM `RequestInit` type exclusively.
 */
export function observeFetchRequestInit(
  init: Parameters<typeof globalThis.fetch>[1],
): ObservedFetchRequestInit {
  if (init === undefined) return {};

  const headers = "headers" in init ? init.headers : undefined;
  const method = "method" in init ? init.method : undefined;
  const signal = "signal" in init ? init.signal : undefined;
  const body = "body" in init ? init.body : undefined;

  return {
    body: body as BodyInit | null | undefined,
    headers: headers as HeadersInit | undefined,
    method: typeof method === "string" ? method : undefined,
    signal: signal as AbortSignal | null | undefined,
  };
}

const FETCH_MOCK_QUEUE_KEY = "__vfTestFetchMockQueue";

function getFetchMockQueue(): Promise<void> {
  const globalAny = globalThis as Record<string, unknown>;
  const queue = globalAny[FETCH_MOCK_QUEUE_KEY];
  return queue instanceof Promise ? queue : Promise.resolve();
}

function setFetchMockQueue(queue: Promise<void>): void {
  (globalThis as Record<string, unknown>)[FETCH_MOCK_QUEUE_KEY] = queue;
}

export async function withMockFetch<T>(
  mockFetch: FetchMock,
  fn: () => Promise<T>,
): Promise<T> {
  const prior = getFetchMockQueue().catch(() => undefined);
  let release: (() => void) | undefined;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });

  setFetchMockQueue(prior.finally(() => next));
  await prior;

  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    value: mockFetch,
    configurable: true,
    writable: true,
  });

  try {
    if (typeof mockFetch !== "function") {
      return await fn();
    }
    return await __runWithOutboundFetchTransportForTests(
      {
        fetch: mockFetch,
        pinnedFetch: (url, _addresses, init) => mockFetch(url, init),
      },
      fn,
    );
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      value: originalFetch,
      configurable: true,
      writable: true,
    });
    if (release) {
      release();
    }
  }
}
