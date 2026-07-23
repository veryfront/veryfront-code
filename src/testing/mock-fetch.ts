import { AsyncLocalStorage } from "#veryfront/platform/compat/async-local-storage.ts";

type FetchMock = typeof globalThis.fetch | undefined;

type MockFetchScope = {
  tail: Promise<void>;
  acceptingChildren: boolean;
};

type MockFetchCoordinator = {
  tail: Promise<void>;
  storage: AsyncLocalStorage<MockFetchScope>;
};

const FETCH_MOCK_COORDINATOR_KEY = Symbol.for("veryfront.testing.mockFetchCoordinator");

function createCoordinator(): MockFetchCoordinator {
  return {
    tail: Promise.resolve(),
    storage: new AsyncLocalStorage<MockFetchScope>(),
  };
}

function getCoordinator(): MockFetchCoordinator {
  const globalRecord = globalThis as Record<PropertyKey, unknown>;
  const descriptor = Object.getOwnPropertyDescriptor(globalRecord, FETCH_MOCK_COORDINATOR_KEY);
  const existing = descriptor && "value" in descriptor ? descriptor.value : undefined;
  if (isMockFetchCoordinator(existing)) {
    return existing as MockFetchCoordinator;
  }

  const coordinator = createCoordinator();
  if (descriptor && !descriptor.configurable) {
    if (!("value" in descriptor) || !descriptor.writable) {
      throw new TypeError("Global mock fetch coordinator is not replaceable");
    }
    Object.defineProperty(globalRecord, FETCH_MOCK_COORDINATOR_KEY, {
      ...descriptor,
      value: coordinator,
    });
  } else {
    Object.defineProperty(globalRecord, FETCH_MOCK_COORDINATOR_KEY, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? false,
      value: coordinator,
      writable: true,
    });
  }
  return coordinator;
}

function isMockFetchCoordinator(value: unknown): value is MockFetchCoordinator {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }
  try {
    const tail = Object.getOwnPropertyDescriptor(value, "tail");
    const storage = Object.getOwnPropertyDescriptor(value, "storage");
    return tail !== undefined && "value" in tail && tail.value instanceof Promise &&
      storage !== undefined && "value" in storage &&
      storage.value instanceof AsyncLocalStorage;
  } catch {
    return false;
  }
}

function createGate(): { promise: Promise<void>; release: () => void } {
  let release: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release?.() };
}

function createScope(): MockFetchScope {
  return { tail: Promise.resolve(), acceptingChildren: true };
}

async function closeScope(scope: MockFetchScope): Promise<void> {
  while (true) {
    const tail = scope.tail;
    await tail.catch(() => undefined);
    if (scope.tail === tail) break;
  }
  scope.acceptingChildren = false;
}

async function runFetchOverride<T>(
  scope: MockFetchScope,
  mockFetch: FetchMock,
  fn: () => T | Promise<T>,
): Promise<T> {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const enumerable = originalDescriptor?.enumerable ?? true;

  if (originalDescriptor && "value" in originalDescriptor) {
    if (!originalDescriptor.configurable && !originalDescriptor.writable) {
      throw new TypeError("Global fetch is not configurable or writable");
    }
    Object.defineProperty(globalThis, "fetch", {
      ...originalDescriptor,
      value: mockFetch,
    });
  } else {
    if (originalDescriptor && !originalDescriptor.configurable) {
      throw new TypeError("Global fetch accessor is not configurable");
    }
    Object.defineProperty(globalThis, "fetch", {
      value: mockFetch,
      configurable: true,
      enumerable,
      writable: true,
    });
  }

  let callbackResult: T | undefined;
  let callbackError: unknown;
  let callbackFailed = false;
  try {
    callbackResult = await fn();
  } catch (error) {
    callbackFailed = true;
    callbackError = error;
  }

  await closeScope(scope);

  let restoreError: unknown;
  let restoreFailed = false;
  try {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "fetch", originalDescriptor);
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
  } catch (error) {
    restoreFailed = true;
    restoreError = error;
  }

  if (callbackFailed && restoreFailed) {
    throw new AggregateError(
      [callbackError, restoreError],
      "Mock fetch callback and global restoration both failed",
    );
  }
  if (restoreFailed) throw restoreError;
  if (callbackFailed) throw callbackError;
  return callbackResult as T;
}

async function runInScope<T>(
  coordinator: MockFetchCoordinator,
  scope: MockFetchScope,
  mockFetch: FetchMock,
  fn: () => T | Promise<T>,
): Promise<T> {
  const prior = scope.tail.catch(() => undefined);
  const gate = createGate();
  scope.tail = prior.then(() => gate.promise);
  await prior;

  try {
    const childScope = createScope();
    return await coordinator.storage.run(
      childScope,
      () => runFetchOverride(childScope, mockFetch, fn),
    );
  } finally {
    gate.release();
  }
}

/** Run a callback while replacing the global fetch implementation. */
export async function withMockFetch<T>(
  mockFetch: FetchMock,
  fn: () => T | Promise<T>,
): Promise<T> {
  if (mockFetch !== undefined && typeof mockFetch !== "function") {
    throw new TypeError("Mock fetch must be a function or undefined");
  }
  if (typeof fn !== "function") throw new TypeError("Mock fetch callback must be a function");

  const coordinator = getCoordinator();
  const activeScope = coordinator.storage.getStore();
  if (activeScope?.acceptingChildren) {
    return await runInScope(coordinator, activeScope, mockFetch, fn);
  }

  const prior = coordinator.tail.catch(() => undefined);
  const gate = createGate();
  coordinator.tail = prior.then(() => gate.promise);
  await prior;

  try {
    const scope = createScope();
    return await coordinator.storage.run(
      scope,
      () => runFetchOverride(scope, mockFetch, fn),
    );
  } finally {
    gate.release();
  }
}
