type BunTestFn = () => void | Promise<void>;
type BunHookFn = () => void | Promise<void>;

type BunDescribeRunner = ((name: string, fn: () => void) => void) & {
  skip: (name: string, fn: () => void) => void;
  only: (name: string, fn: () => void) => void;
};

type BunTestRegistration = (name: string, fn: BunTestFn, timeout?: number) => void;

type BunSerialTestRunner = BunTestRegistration & {
  skip: BunTestRegistration;
  only: BunTestRegistration;
};

type BunTestRunner = BunTestRegistration & {
  skip: (name: string, fn: BunTestFn, timeout?: number) => void;
  only: (name: string, fn: BunTestFn, timeout?: number) => void;
  serial: BunSerialTestRunner;
};

/** Named exports required from the supported `bun:test` module. */
export interface BunTestModule {
  describe: BunDescribeRunner;
  it: BunTestRunner;
  beforeEach: (fn: BunHookFn) => void;
  afterEach: (fn: BunHookFn) => void;
  beforeAll: (fn: BunHookFn) => void;
  afterAll: (fn: BunHookFn) => void;
}

export interface BunRegistrationOptions {
  skip?: boolean;
  ignore?: boolean;
  only?: boolean;
  timeout?: number;
}

const REQUIRED_FUNCTION_EXPORTS = [
  "describe",
  "it",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
] as const;

/** Validate the dynamically imported Bun test module before registering tests. */
export function assertBunTestModule(value: unknown): asserts value is BunTestModule {
  if (!value || typeof value !== "object") {
    throw new TypeError("bun:test did not return a module namespace object");
  }

  const module = value as Record<string, unknown>;
  for (const name of REQUIRED_FUNCTION_EXPORTS) {
    if (typeof module[name] !== "function") {
      throw new TypeError(`bun:test is missing the required named export "${name}"`);
    }
  }

  for (const name of ["describe", "it"] as const) {
    const runner = module[name] as unknown as Record<string, unknown>;
    for (const modifier of ["skip", "only"] as const) {
      if (typeof runner[modifier] !== "function") {
        throw new TypeError(`bun:test ${name}.${modifier} is not available`);
      }
    }
  }

  const serial = (module.it as unknown as Record<string, unknown>)["serial"];
  if (typeof serial !== "function") {
    throw new TypeError("bun:test it.serial is not available");
  }
  for (const modifier of ["skip", "only"] as const) {
    if (typeof (serial as unknown as Record<string, unknown>)[modifier] !== "function") {
      throw new TypeError(`bun:test it.serial.${modifier} is not available`);
    }
  }
}

/** Register a suite through Bun's supported named-export modifiers. */
export function registerBunSuite(
  bunTest: BunTestModule,
  name: string,
  options: BunRegistrationOptions,
  fn: () => void,
): void {
  if (options.skip || options.ignore) {
    bunTest.describe.skip(name, fn);
    return;
  }
  if (options.only) {
    bunTest.describe.only(name, fn);
    return;
  }
  bunTest.describe(name, fn);
}

/** Register a test using Bun's third positional timeout argument. */
export function registerBunTest(
  bunTest: BunTestModule,
  name: string,
  options: BunRegistrationOptions,
  fn: BunTestFn,
  defaultTimeout: number,
): void {
  if (options.skip || options.ignore) {
    bunTest.it.serial.skip(name, fn);
    return;
  }

  const runner = options.only ? bunTest.it.serial.only : bunTest.it.serial;
  runner(name, fn, options.timeout ?? defaultTimeout);
}

type BunEnvironmentScope = {
  release: () => void;
  snapshot: Record<string, string>;
};

let bunEnvironmentTail = Promise.resolve();
let activeBunEnvironmentScope: BunEnvironmentScope | null = null;

/**
 * Serialize Bun test bodies and restore the host environment after each test.
 *
 * Bun executes lifecycle hooks in separate async contexts, so an
 * AsyncLocalStorage value created by `beforeEach` is not visible to the test
 * callback. A scoped host snapshot keeps hook and test mutations coherent while
 * the queue prevents concurrent tests from sharing that mutable host state.
 */
export function installBunEnvironmentIsolation(bunTest: BunTestModule): void {
  bunTest.beforeEach(async () => {
    const release = await acquireBunEnvironmentScope();
    try {
      activeBunEnvironmentScope = {
        release,
        snapshot: snapshotProcessEnvironment(),
      };
    } catch (error) {
      release();
      throw error;
    }
  });

  bunTest.afterEach(() => {
    const scope = activeBunEnvironmentScope;
    activeBunEnvironmentScope = null;
    if (!scope) return;

    try {
      restoreProcessEnvironment(scope.snapshot);
    } finally {
      scope.release();
    }
  });
}

/** Wrap a top-level Bun test that does not belong to a `describe` suite. */
export function withBunEnvironmentIsolation<T>(
  fn: () => T | Promise<T>,
): () => Promise<T> {
  return async () => {
    if (activeBunEnvironmentScope) return await fn();

    const release = await acquireBunEnvironmentScope();
    let snapshot: Record<string, string>;
    try {
      snapshot = snapshotProcessEnvironment();
    } catch (error) {
      release();
      throw error;
    }

    try {
      return await fn();
    } finally {
      try {
        restoreProcessEnvironment(snapshot);
      } finally {
        release();
      }
    }
  };
}

async function acquireBunEnvironmentScope(): Promise<() => void> {
  const prior = bunEnvironmentTail.catch(() => undefined);
  let release: (() => void) | undefined;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  bunEnvironmentTail = prior.then(() => next);
  await prior;
  if (!release) throw new Error("Failed to create the Bun environment isolation release");
  return release;
}

function getProcessEnvironment(): Record<string, string | undefined> {
  const runtimeProcess = (globalThis as Record<string, unknown>)["process"] as
    | { env?: Record<string, string | undefined> }
    | undefined;
  if (!runtimeProcess?.env) {
    throw new Error("Bun test environment isolation requires process.env");
  }
  return runtimeProcess.env;
}

function snapshotProcessEnvironment(): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const [key, value] of Object.entries(getProcessEnvironment())) {
    if (value !== undefined) snapshot[key] = value;
  }
  return snapshot;
}

function restoreProcessEnvironment(snapshot: Record<string, string>): void {
  const environment = getProcessEnvironment();
  const failures: unknown[] = [];

  for (const key of Object.keys(environment)) {
    if (Object.prototype.hasOwnProperty.call(snapshot, key)) continue;
    try {
      delete environment[key];
    } catch (error) {
      failures.push(error);
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    try {
      environment[key] = value;
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, "Failed to restore the Bun test environment");
  }
}
