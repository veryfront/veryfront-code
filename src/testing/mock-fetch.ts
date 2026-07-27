import { AsyncLocalStorage } from "node:async_hooks";

type FetchMock = typeof globalThis.fetch | undefined;
type FetchMockScope = {
  acceptingChildren: boolean;
  childTail: Promise<void>;
};

const FETCH_MOCK_QUEUE_KEY = "__vfTestFetchMockQueue";
const fetchMockScopeStorage = new AsyncLocalStorage<FetchMockScope>();

function getFetchMockQueue(): Promise<void> {
  const globalAny = globalThis as Record<string, unknown>;
  const queue = globalAny[FETCH_MOCK_QUEUE_KEY];
  return queue instanceof Promise ? queue : Promise.resolve();
}

function setFetchMockQueue(queue: Promise<void>): void {
  (globalThis as Record<string, unknown>)[FETCH_MOCK_QUEUE_KEY] = queue;
}

/**
 * Run a callback while temporarily replacing the process-global fetch.
 *
 * Independent calls and sibling nested calls are serialized. Deeper nesting
 * remains re-entrant, but serialized siblings must not depend on a later
 * sibling to release an earlier one. Always await the returned promise.
 */
export async function withMockFetch<T>(
  mockFetch: FetchMock,
  fn: () => T | Promise<T>,
): Promise<T> {
  const parentScope = fetchMockScopeStorage.getStore();
  if (parentScope?.acceptingChildren) {
    return await enqueueNestedFetchScope(parentScope, mockFetch, fn);
  }

  const prior = getFetchMockQueue().catch(() => undefined);
  let release: (() => void) | undefined;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });

  setFetchMockQueue(prior.finally(() => next));
  await prior;

  try {
    return await runInFetchScope(mockFetch, fn);
  } finally {
    release?.();
  }
}

function enqueueNestedFetchScope<T>(
  parentScope: FetchMockScope,
  mockFetch: FetchMock,
  fn: () => T | Promise<T>,
): Promise<T> {
  const operation = parentScope.childTail.then(() => runInFetchScope(mockFetch, fn));
  parentScope.childTail = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

async function runInFetchScope<T>(
  mockFetch: FetchMock,
  fn: () => T | Promise<T>,
): Promise<T> {
  const scope: FetchMockScope = {
    acceptingChildren: true,
    childTail: Promise.resolve(),
  };

  try {
    return await fetchMockScopeStorage.run(
      scope,
      () =>
        runWithInstalledFetch(mockFetch, async () => {
          try {
            return await fn();
          } finally {
            scope.acceptingChildren = false;
            await scope.childTail;
          }
        }),
    );
  } finally {
    scope.acceptingChildren = false;
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
