import { AsyncLocalStorage } from "node:async_hooks";

type FetchMock = typeof globalThis.fetch | undefined;
type FetchMockOwner = { active: boolean };

const FETCH_MOCK_QUEUE_KEY = "__vfTestFetchMockQueue";
const fetchMockOwnerStorage = new AsyncLocalStorage<FetchMockOwner>();

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
  fn: () => T | Promise<T>,
): Promise<T> {
  const inheritedOwner = fetchMockOwnerStorage.getStore();
  if (inheritedOwner?.active) {
    return await runWithInstalledFetch(mockFetch, fn);
  }

  const prior = getFetchMockQueue().catch(() => undefined);
  let release: (() => void) | undefined;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });

  setFetchMockQueue(prior.finally(() => next));
  await prior;

  const owner: FetchMockOwner = { active: true };
  try {
    return await fetchMockOwnerStorage.run(
      owner,
      () => runWithInstalledFetch(mockFetch, fn),
    );
  } finally {
    owner.active = false;
    release?.();
  }
}

async function runWithInstalledFetch<T>(
  mockFetch: FetchMock,
  fn: () => T | Promise<T>,
): Promise<T> {
  let originalDescriptor: PropertyDescriptor | undefined;
  let installed = false;
  let operationFailed = false;
  let operationError: unknown;
  let result: T | undefined;

  try {
    originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    Object.defineProperty(globalThis, "fetch", {
      value: mockFetch,
      configurable: true,
      writable: true,
    });
    installed = true;
    result = await fn();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  let restorationFailed = false;
  let restorationError: unknown;
  if (installed) {
    try {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "fetch", originalDescriptor);
      } else if (!Reflect.deleteProperty(globalThis, "fetch")) {
        restorationFailed = true;
        restorationError = new TypeError("Failed to remove the temporary global fetch mock");
      }
    } catch (error) {
      restorationFailed = true;
      restorationError = error;
    }
  }

  if (restorationFailed) {
    if (operationFailed) {
      throw new AggregateError(
        [operationError, restorationError],
        "Fetch mock callback and global fetch restoration both failed",
      );
    }
    throw restorationError;
  }

  if (operationFailed) throw operationError;
  return result as T;
}
