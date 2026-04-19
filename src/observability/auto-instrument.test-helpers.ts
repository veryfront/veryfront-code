export function withMockFetch<T>(mock: typeof fetch | undefined, fn: () => T): T {
  const originalFetch = globalThis.fetch;
  // @ts-ignore - allow setting undefined for tests
  globalThis.fetch = mock;

  try {
    return fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export function createResolvedFetch(response: Response): typeof fetch {
  return (() => Promise.resolve(response)) as typeof fetch;
}

export function createThrowingFetch(error: Error): typeof fetch {
  return (() => {
    throw error;
  }) as unknown as typeof fetch;
}
