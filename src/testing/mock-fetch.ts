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
    return await fn();
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
