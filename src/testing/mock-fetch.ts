import {
  __installOutboundFetchTransportForTests,
  __runWithOutboundFetchTransportForTests,
} from "#veryfront/security/http/outbound-fetch.ts";

type FetchMock = typeof globalThis.fetch | undefined;

const STUB_PINNED_ADDRESS = "192.0.2.1";
const STUB_TRANSPORT_OPTIONS = {
  allowedResolvedAddresses: [STUB_PINNED_ADDRESS],
} as const;

function stubTransport(mockFetch: typeof globalThis.fetch) {
  return {
    fetch: mockFetch,
    pinnedFetch: (url: URL, _addresses: readonly string[], init: RequestInit) =>
      mockFetch(url, init),
    resolveHost: () => Promise.resolve([STUB_PINNED_ADDRESS]),
  };
}

/** Standard request-init fields that tests may need to observe from a fetch mock. */
export interface ObservedFetchRequestInit {
  body?: BodyInit | null;
  headers?: HeadersInit;
  method?: string;
  redirect?: RequestRedirect;
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
  const redirect = "redirect" in init ? init.redirect : undefined;
  const signal = "signal" in init ? init.signal : undefined;
  const body = "body" in init ? init.body : undefined;

  return {
    body: body as BodyInit | null | undefined,
    headers: headers as HeadersInit | undefined,
    method: typeof method === "string" ? method : undefined,
    redirect: redirect as RequestRedirect | undefined,
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
      stubTransport(mockFetch),
      fn,
      STUB_TRANSPORT_OPTIONS,
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

/**
 * Install `mockFetch` as both the ambient `globalThis.fetch` and the host
 * outbound transport, until `restoreMockFetch` puts them back.
 *
 * Assigning `globalThis.fetch` alone controls only code that calls `fetch`
 * directly. Anything routed through `guardedOutboundFetch` reads the host
 * transport instead and would reach the real network, so both move together
 * here or neither does. The transport carries a host resolver too, because the
 * egress guard resolves the destination before any transport sees the request.
 *
 * Prefer `withMockFetch` where the stub has a single callback to scope. This
 * pair exists for suites that install per test and tear down in `afterEach`,
 * where there is no callback to wrap.
 */
export function installMockFetch(mockFetch: typeof globalThis.fetch): void {
  const restoreTransport = __installOutboundFetchTransportForTests(
    stubTransport(mockFetch),
    STUB_TRANSPORT_OPTIONS,
  );
  // Only the first install records the pristine state, so a test that swaps its
  // stub mid-way still restores to the real transport rather than to its own
  // earlier stub.
  installedMockFetch ??= { fetch: globalThis.fetch, restoreTransport };
  defineGlobalFetch(mockFetch);
}

/**
 * Restore the ambient fetch and outbound transport that were in place before
 * the first `installMockFetch`. Safe to call when nothing is installed.
 */
export function restoreMockFetch(): void {
  const installed = installedMockFetch;
  if (!installed) return;
  installedMockFetch = undefined;
  installed.restoreTransport();
  defineGlobalFetch(installed.fetch);
}

let installedMockFetch:
  | { fetch: typeof globalThis.fetch; restoreTransport: () => void }
  | undefined;

function defineGlobalFetch(value: typeof globalThis.fetch): void {
  Object.defineProperty(globalThis, "fetch", {
    value,
    configurable: true,
    writable: true,
  });
}
