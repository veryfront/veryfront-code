type FetchMock = typeof globalThis.fetch | undefined;

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
  let release: (() => void) | null = null;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });

  setFetchMockQueue(prior.finally(() => next));
  await prior;

  const originalFetch = globalThis.fetch;
  // @ts-ignore tests intentionally override the host fetch implementation
  globalThis.fetch = mockFetch;

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    release?.();
  }
}
