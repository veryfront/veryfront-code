/**
 * Portable BDD testing utilities (describe, it, beforeEach, afterEach).
 *
 * In Deno: @std/testing/bdd with file, suite, and test environment overlays
 * In Node.js: Uses node:test
 * In Bun: Uses bun:test
 *
 * Deno test runs whose dependencies mutate environment variables before they
 * import this module must use `--preload=veryfront/testing/bdd`.
 *
 * @module
 */

import "./init.ts";
import { isBun, isDeno } from "#veryfront/platform/compat/runtime.ts";
import { getEnvOverlayStorage } from "#veryfront/platform/compat/process.ts";
import { isTestOverlayAwareDenoEnvView } from "#veryfront/platform/compat/process/scoped-process-env.ts";

/** Test function that can be sync or async */
type TestFn = () => void | Promise<void>;

/** Test options for Deno sanitizers (ignored in Node/Bun) */
export interface TestOptions {
  sanitizeResources?: boolean;
  sanitizeOps?: boolean;
  sanitizeExit?: boolean;
  skip?: boolean;
  only?: boolean;
  ignore?: boolean;
  timeout?: number;
}

/** Context passed to hooks and tests (BDD-specific) */
export interface BddTestContext {
  name: string;
  origin?: string;
  parent?: BddTestContext;
  step?: (name: string, fn: TestFn) => Promise<void>;
}

/** Hook function */
type HookFn = (ctx?: BddTestContext) => void | Promise<void>;

type EnvOverlayStorageShim = {
  storage: {
    getStore: () => unknown;
    run?: <T>(store: unknown, fn: () => T) => T;
    enterWith?: (store: unknown) => void;
  };
};

type EnvOverlayValue = string | null;
type EnvOverlayStore = Map<string, EnvOverlayValue>;
const DENO_ROOT_ENV_OVERLAY_KEY = "__vfTestDenoRootEnvOverlay";

type DenoEnvFacade = {
  get: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
  delete: (key: string) => void;
  has: (key: string) => boolean;
  toObject: () => Record<string, string>;
};

function getActiveEnvOverlay(): EnvOverlayStore | null {
  const storage = getEnvOverlayStorage();
  const store = storage?.getStore();
  return store instanceof Map ? store as EnvOverlayStore : null;
}

function getDenoRootEnvOverlay(): EnvOverlayStore | null {
  const value = (globalThis as Record<string, unknown>)[DENO_ROOT_ENV_OVERLAY_KEY];
  return value instanceof Map ? value as EnvOverlayStore : null;
}

function applyEnvOverlay(
  base: Record<string, string>,
  overlay: EnvOverlayStore | null,
): Record<string, string> {
  if (!overlay) return { ...base };

  const merged = { ...base };
  for (const [key, value] of overlay.entries()) {
    if (value === null) {
      delete merged[key];
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function installDenoEnvOverlayFacade(): void {
  if (!isDeno || typeof Deno === "undefined" || typeof Deno.env === "undefined") return;

  const globalAny = globalThis as Record<string, unknown>;
  if (globalAny["__vfTestDenoEnvOverlayFacadeInstalled"]) return;
  globalAny["__vfTestDenoEnvOverlayFacadeInstalled"] = true;

  // The project environment facade composes this overlay itself. It is frozen
  // so tenant code cannot replace its methods, and assigning here would make
  // the public testing module depend on whether the server loaded first.
  if (isTestOverlayAwareDenoEnvView(Deno.env)) return;

  const originalDenoEnv = {
    get: Deno.env.get.bind(Deno.env),
    set: Deno.env.set.bind(Deno.env),
    delete: Deno.env.delete.bind(Deno.env),
    has: Deno.env.has.bind(Deno.env),
    toObject: Deno.env.toObject.bind(Deno.env),
  } satisfies DenoEnvFacade;

  Deno.env.get = (key: string): string | undefined => {
    const overlay = getActiveEnvOverlay();
    if (overlay?.has(key)) return overlay.get(key) ?? undefined;
    return originalDenoEnv.get(key);
  };

  Deno.env.set = (key: string, value: string): void => {
    const overlay = getActiveEnvOverlay();
    if (overlay) {
      overlay.set(key, value);
      return;
    }
    originalDenoEnv.set(key, value);
  };

  Deno.env.delete = (key: string): void => {
    const overlay = getActiveEnvOverlay();
    if (overlay) {
      overlay.set(key, null);
      return;
    }
    originalDenoEnv.delete(key);
  };

  Deno.env.has = (key: string): boolean => {
    const overlay = getActiveEnvOverlay();
    if (overlay?.has(key)) return overlay.get(key) !== null;
    return originalDenoEnv.has(key);
  };

  Deno.env.toObject = (): Record<string, string> => {
    return applyEnvOverlay(originalDenoEnv.toObject(), getActiveEnvOverlay());
  };

  const processAny = globalAny["process"] as
    | { env?: Record<string, string | undefined> }
    | undefined;
  if (!processAny?.env) return;

  const baseProcessEnv = processAny.env;
  processAny.env = new Proxy(baseProcessEnv, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
      return Deno.env.get(prop);
    },
    set(target, prop, value, receiver) {
      if (typeof prop !== "string") return Reflect.set(target, prop, value, receiver);
      Deno.env.set(prop, String(value));
      return true;
    },
    deleteProperty(target, prop) {
      if (typeof prop !== "string") return Reflect.deleteProperty(target, prop);
      Deno.env.delete(prop);
      return true;
    },
    has(target, prop) {
      if (typeof prop !== "string") return Reflect.has(target, prop);
      return Deno.env.has(prop);
    },
    ownKeys() {
      return Object.keys(Deno.env.toObject());
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop !== "string") return Reflect.getOwnPropertyDescriptor(target, prop);
      const value = Deno.env.get(prop);
      if (value === undefined) return undefined;
      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      };
    },
  });
}

async function installDenoEnvOverlayStorage(): Promise<void> {
  if (!isDeno) return;

  const globalAny = globalThis as Record<string, unknown>;
  // Deno test files have separate globals but share one process. Use this
  // isolate-local map whenever execution is outside a suite or test context.
  if (!getDenoRootEnvOverlay()) {
    globalAny[DENO_ROOT_ENV_OVERLAY_KEY] = new Map<string, EnvOverlayValue>();
  }
  const rootOverlay = getDenoRootEnvOverlay();
  if (!globalAny["__vfTestDenoEnvOverlay"]) {
    const { AsyncLocalStorage } = await import("node:async_hooks");
    const storage = new AsyncLocalStorage<EnvOverlayStore>();

    globalAny["__vfTestDenoEnvOverlay"] = {
      storage: {
        getStore: () => storage.getStore() ?? rootOverlay,
        run: <T>(store: unknown, fn: () => T) => storage.run(store as EnvOverlayStore, fn),
        enterWith: (store: unknown) => storage.enterWith(store as EnvOverlayStore),
      },
    } satisfies EnvOverlayStorageShim;
  }

  const storage = getEnvOverlayStorage();
  storage?.enterWith?.(rootOverlay);
  installDenoEnvOverlayFacade();
}

function withEnvOverlay<T extends TestFn | (() => void)>(fn: T): T {
  const overlay = getEnvOverlayStorage();
  if (!overlay) return fn;

  return ((...args: unknown[]) => {
    const activeOverlay = getActiveEnvOverlay();
    const rootOverlay = getDenoRootEnvOverlay();
    if (activeOverlay && activeOverlay !== rootOverlay) {
      return Promise.resolve().then(() => fn(...(args as [])));
    }

    if (overlay.run) {
      return overlay.run(
        new Map(activeOverlay ?? rootOverlay ?? []),
        () => Promise.resolve().then(() => fn(...(args as []))),
      );
    }

    if (overlay.enterWith) {
      overlay.enterWith(new Map<string, string | null>());
    }

    return fn(...(args as []));
  }) as T;
}

// Loading the Deno implementation here avoids creating a global test suite
// from top-level await.
let denoBdd: typeof import("#std/testing/bdd") | null = null;

if (isDeno) {
  await installDenoEnvOverlayStorage();
  denoBdd = await import("#std/testing/bdd");
}

interface BddImpl {
  describe(
    nameOrOptions: string | (TestOptions & { name: string }),
    optionsOrFn?: TestOptions | (() => void),
    fn?: () => void,
  ): void;
  it(
    nameOrOptions: string | (TestOptions & { name: string }),
    optionsOrFn?: TestOptions | TestFn,
    fn?: TestFn,
  ): void;
  beforeEach(fn: HookFn): void;
  afterEach(fn: HookFn): void;
  beforeAll(fn: HookFn): void;
  afterAll(fn: HookFn): void;
}

let _impl: BddImpl | null = null;

function parseBddArgs<T extends TestFn | (() => void)>(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | T,
  fn?: T,
): { name: string; options: TestOptions; testFn: T | undefined } {
  const name = typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;

  let options: TestOptions = {};
  if (typeof nameOrOptions === "object") {
    options = nameOrOptions;
  } else if (typeof optionsOrFn === "object" && typeof optionsOrFn !== "function") {
    options = optionsOrFn;
  }

  const testFn = typeof optionsOrFn === "function" ? optionsOrFn : fn;
  return { name, options, testFn };
}

function createNodeImpl(nodeTest: {
  describe: ((name: string, fn: () => void) => void) & {
    skip: (name: string, fn: () => void) => void;
    only?: (name: string, fn: () => void) => void;
  };
  it: ((name: string, optionsOrFn: { timeout?: number } | TestFn, fn?: TestFn) => void) & {
    skip: (name: string, fn: TestFn) => void;
    only?: (name: string, fn: TestFn) => void;
  };
  before: (fn: HookFn) => void;
  after: (fn: HookFn) => void;
  beforeEach: (fn: HookFn) => void;
  afterEach: (fn: HookFn) => void;
}): BddImpl {
  return {
    describe(nameOrOptions, optionsOrFn, fn): void {
      const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
      if (!testFn) throw new Error("describe requires a test function");

      if (options.skip || options.ignore) {
        nodeTest.describe.skip(name, testFn);
        return;
      }

      if (options.only && nodeTest.describe.only) {
        nodeTest.describe.only(name, testFn);
        return;
      }

      nodeTest.describe(name, testFn);
    },

    it(nameOrOptions, optionsOrFn, fn): void {
      const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
      if (!testFn) throw new Error("it requires a test function");

      if (options.skip || options.ignore) {
        nodeTest.it.skip(name, testFn);
        return;
      }

      if (options.only && nodeTest.it.only) {
        nodeTest.it.only(name, testFn);
        return;
      }

      if (options.timeout !== undefined) {
        nodeTest.it(name, { timeout: options.timeout }, testFn);
        return;
      }

      nodeTest.it(name, testFn);
    },

    beforeEach: nodeTest.beforeEach,
    afterEach: nodeTest.afterEach,
    beforeAll: nodeTest.before,
    afterAll: nodeTest.after,
  };
}

interface BunTestModule {
  describe: ((name: string, fn: () => void) => void) & {
    skip?: (name: string, fn: () => void) => void;
    only?: (name: string, fn: () => void) => void;
  };
  it: ((name: string, optionsOrFn: { timeout?: number } | TestFn, fn?: TestFn) => void) & {
    skip?: (name: string, fn: TestFn) => void;
    only?: (name: string, fn: TestFn) => void;
  };
  beforeEach: (fn: HookFn) => void;
  afterEach: (fn: HookFn) => void;
  beforeAll: (fn: HookFn) => void;
  afterAll: (fn: HookFn) => void;
}

function createBunImpl(bunTest: BunTestModule): BddImpl {
  const defaultTimeout = (() => {
    const env = (globalThis as Record<string, unknown>).process as
      | { env?: Record<string, string | undefined> }
      | undefined;
    const raw = env?.env?.BUN_TEST_TIMEOUT ?? env?.env?.VF_TEST_TIMEOUT ?? "30000";
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
  })();

  return {
    describe(nameOrOptions, optionsOrFn, fn): void {
      const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
      if (!testFn) throw new Error("describe requires a test function");

      if ((options.skip || options.ignore) && bunTest.describe.skip) {
        bunTest.describe.skip(name, testFn);
        return;
      }

      if (options.only && bunTest.describe.only) {
        bunTest.describe.only(name, testFn);
        return;
      }

      bunTest.describe(name, testFn);
    },

    it(nameOrOptions, optionsOrFn, fn): void {
      const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
      if (!testFn) throw new Error("it requires a test function");

      const testWithEnv = withEnvOverlay(testFn);
      const isSkip = options.skip || options.ignore;

      type TestRunner = (
        name: string,
        optionsOrFn: { timeout?: number } | TestFn,
        fn?: TestFn,
      ) => void;

      let runner: TestRunner = bunTest.it;
      if (isSkip) runner = (bunTest.it.skip ?? bunTest.it) as TestRunner;
      else if (options.only && bunTest.it.only) runner = bunTest.it.only as TestRunner;

      if (isSkip) {
        runner(name, testWithEnv);
        return;
      }

      const timeout = options.timeout ?? defaultTimeout;
      if (Number.isFinite(timeout) && timeout > 0) {
        runner(name, { timeout }, testWithEnv);
        return;
      }

      runner(name, testWithEnv);
    },

    beforeEach: bunTest.beforeEach,
    afterEach: bunTest.afterEach,
    beforeAll: bunTest.beforeAll,
    afterAll: bunTest.afterAll,
  };
}

async function getImpl(): Promise<BddImpl> {
  if (_impl) return _impl;

  if (isBun) {
    const importBunTest = new Function("return import('bun:test')") as () => Promise<{
      default: BunTestModule;
    }>;
    const bunTestModule = await importBunTest();
    _impl = createBunImpl(bunTestModule.default);
    return _impl;
  }

  const importNodeTest = new Function("return import('node:test')") as () => Promise<unknown>;
  const nodeTest = await importNodeTest();
  _impl = createNodeImpl(
    nodeTest as {
      describe: ((name: string, fn: () => void) => void) & {
        skip: (name: string, fn: () => void) => void;
        only?: (name: string, fn: () => void) => void;
      };
      it: ((name: string, optionsOrFn: { timeout?: number } | TestFn, fn?: TestFn) => void) & {
        skip: (name: string, fn: TestFn) => void;
        only?: (name: string, fn: TestFn) => void;
      };
      before: (fn: HookFn) => void;
      after: (fn: HookFn) => void;
      beforeEach: (fn: HookFn) => void;
      afterEach: (fn: HookFn) => void;
    },
  );

  return _impl;
}

function hasOptions(options: TestOptions): boolean {
  return Object.values(options).some((v) => v !== undefined);
}

function normalizeDenoOptions(options: TestOptions): TestOptions {
  if (!options.skip) return options;
  const { skip: _skip, ...rest } = options;
  return { ...rest, ignore: true };
}

function requireImpl(): BddImpl {
  if (_impl) return _impl;
  throw new Error(
    "BDD implementation not initialized. For Node/Bun, call initBdd() first, or import from #veryfront/testing which auto-initializes.",
  );
}

type DenoSuiteEnvOverlay = {
  parent: DenoSuiteEnvOverlay | null;
  /** Environment changes relative to the parent suite. */
  values: EnvOverlayStore;
};

let currentDenoSuiteEnvOverlay: DenoSuiteEnvOverlay | null = null;

function applyEnvOverlayValues(target: EnvOverlayStore, values: EnvOverlayStore): void {
  for (const [key, value] of values) {
    target.set(key, value);
  }
}

function materializeDenoSuiteEnvOverlay(suite: DenoSuiteEnvOverlay | null): EnvOverlayStore {
  const materialized = new Map(getDenoRootEnvOverlay() ?? []);
  const lineage: DenoSuiteEnvOverlay[] = [];
  for (let current = suite; current; current = current.parent) {
    lineage.push(current);
  }
  for (const current of lineage.reverse()) {
    applyEnvOverlayValues(materialized, current.values);
  }
  return materialized;
}

function captureDenoSuiteEnvChanges(
  suite: DenoSuiteEnvOverlay,
  parentValues: EnvOverlayStore,
  values: EnvOverlayStore,
): void {
  suite.values.clear();
  for (const [key, value] of values) {
    if (!parentValues.has(key) || parentValues.get(key) !== value) {
      suite.values.set(key, value);
    }
  }
}

function captureDenoSuiteCleanupChanges(
  suite: DenoSuiteEnvOverlay,
  parentValues: EnvOverlayStore,
  initialValues: EnvOverlayStore,
  values: EnvOverlayStore,
): void {
  for (const key of new Set([...initialValues.keys(), ...values.keys()])) {
    if (
      suite.values.has(key) ||
      !parentValues.has(key) ||
      initialValues.get(key) === values.get(key)
    ) {
      continue;
    }

    const value = values.get(key) ?? null;
    if (suite.parent) {
      suite.parent.values.set(key, value);
    } else {
      getDenoRootEnvOverlay()?.set(key, value);
    }
  }
}

function runWithDenoSuiteEnvOverlay<T>(
  suite: DenoSuiteEnvOverlay,
  fn: () => T,
  captureMode: "suite" | "cleanup",
): T {
  const storage = getEnvOverlayStorage();
  if (!storage?.run) return fn();

  const parentValues = materializeDenoSuiteEnvOverlay(suite.parent);
  const values = new Map(parentValues);
  applyEnvOverlayValues(values, suite.values);
  const initialValues = new Map(values);
  const capture = () => {
    if (captureMode === "suite") {
      captureDenoSuiteEnvChanges(suite, parentValues, values);
    } else {
      captureDenoSuiteCleanupChanges(suite, parentValues, initialValues, values);
    }
  };

  return storage.run(values, () => {
    try {
      const result = fn();
      if (result instanceof Promise) {
        return result.finally(capture) as T;
      }
      capture();
      return result;
    } catch (error) {
      capture();
      throw error;
    }
  });
}

function withDenoSuiteEnvOverlay(testFn: () => void): () => void {
  const suite: DenoSuiteEnvOverlay = {
    parent: currentDenoSuiteEnvOverlay,
    values: new Map(),
  };

  return () => {
    denoBdd!.beforeEach(() => {
      const activeOverlay = getActiveEnvOverlay();
      const testOverlay = suite.parent && activeOverlay
        ? new Map(activeOverlay)
        : materializeDenoSuiteEnvOverlay(suite);
      if (suite.parent) applyEnvOverlayValues(testOverlay, suite.values);
      getEnvOverlayStorage()?.enterWith?.(testOverlay);
    });

    const previousSuite = currentDenoSuiteEnvOverlay;
    currentDenoSuiteEnvOverlay = suite;
    try {
      runWithDenoSuiteEnvOverlay(suite, testFn, "suite");
    } finally {
      currentDenoSuiteEnvOverlay = previousSuite;
    }
  };
}

function getNameAndFn<T extends TestFn | (() => void)>(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | T,
  fn?: T,
): { name: string; testFn: T } {
  const name = typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;
  const testFn = typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!testFn) throw new Error("Missing test function");
  return { name, testFn };
}

/** Group related BDD tests. */
export function describe(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | (() => void),
  fn?: () => void,
): void {
  if (!denoBdd) {
    requireImpl().describe(nameOrOptions, optionsOrFn, fn);
    return;
  }

  const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
  if (!testFn) throw new Error("describe requires a test function");

  const denoOptions = normalizeDenoOptions(options);
  const suiteWithEnv = withDenoSuiteEnvOverlay(testFn);
  if (hasOptions(denoOptions)) {
    denoBdd.describe({ name, ...denoOptions }, suiteWithEnv);
    return;
  }

  denoBdd.describe(name, suiteWithEnv);
}

describe.skip = function skip(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | (() => void),
  fn?: () => void,
): void {
  const { name, testFn } = getNameAndFn(nameOrOptions, optionsOrFn, fn);

  if (denoBdd) {
    denoBdd.describe({ name, ignore: true }, withDenoSuiteEnvOverlay(testFn));
    return;
  }

  requireImpl().describe({ name, ignore: true }, testFn);
};

describe.ignore = describe.skip;

describe.only = function only(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | (() => void),
  fn?: () => void,
): void {
  const { name, testFn } = getNameAndFn(nameOrOptions, optionsOrFn, fn);

  if (denoBdd) {
    denoBdd.describe({ name, only: true }, withDenoSuiteEnvOverlay(testFn));
    return;
  }

  requireImpl().describe({ name, only: true }, testFn);
};

/** Define a BDD test case. */
export function it(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | TestFn,
  fn?: TestFn,
): void {
  if (!denoBdd) {
    requireImpl().it(nameOrOptions, optionsOrFn, fn);
    return;
  }

  const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
  if (!testFn) throw new Error("it requires a test function");
  const testWithEnv = withEnvOverlay(testFn);

  const denoOptions = normalizeDenoOptions(options);
  if (hasOptions(denoOptions)) {
    denoBdd.it({ name, ...denoOptions }, testWithEnv);
    return;
  }

  denoBdd.it(name, testWithEnv);
}

it.skip = function skip(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | TestFn,
  fn?: TestFn,
): void {
  const { name, testFn } = getNameAndFn(nameOrOptions, optionsOrFn, fn);
  const testWithEnv = withEnvOverlay(testFn);

  if (denoBdd) {
    denoBdd.it({ name, ignore: true }, testWithEnv);
    return;
  }

  requireImpl().it({ name, ignore: true }, testWithEnv);
};

it.ignore = it.skip;

it.only = function only(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | TestFn,
  fn?: TestFn,
): void {
  const { name, testFn } = getNameAndFn(nameOrOptions, optionsOrFn, fn);
  const testWithEnv = withEnvOverlay(testFn);

  if (denoBdd) {
    denoBdd.it({ name, only: true }, testWithEnv);
    return;
  }

  requireImpl().it({ name, only: true }, testWithEnv);
};

/** Register a hook before each BDD test. */
export function beforeEach(fn: HookFn): void {
  if (denoBdd) {
    denoBdd.beforeEach(fn);
    return;
  }
  requireImpl().beforeEach(fn);
}

/** Register a hook after each BDD test. */
export function afterEach(fn: HookFn): void {
  const hookWithEnv = withEnvOverlay(fn);
  if (denoBdd) {
    denoBdd.afterEach(hookWithEnv);
    return;
  }
  requireImpl().afterEach(hookWithEnv);
}

/** Register a hook before all BDD tests in a group. */
export function beforeAll(fn: HookFn): void {
  if (denoBdd) {
    const suite = currentDenoSuiteEnvOverlay;
    denoBdd.beforeAll(
      suite
        ? (...args: Parameters<HookFn>) =>
          runWithDenoSuiteEnvOverlay(suite, () => fn(...args), "suite")
        : withEnvOverlay(fn),
    );
    return;
  }
  requireImpl().beforeAll(fn);
}

/** Register a hook after all BDD tests in a group. */
export function afterAll(fn: HookFn): void {
  if (denoBdd) {
    const suite = currentDenoSuiteEnvOverlay;
    denoBdd.afterAll(
      suite
        ? (...args: Parameters<HookFn>) =>
          runWithDenoSuiteEnvOverlay(suite, () => fn(...args), "cleanup")
        : withEnvOverlay(fn),
    );
    return;
  }
  requireImpl().afterAll(fn);
}

/** Shared test value. */
export const test = it;

/** Initialize the BDD test adapter. */
export async function initBdd(): Promise<void> {
  if (denoBdd) return;
  await getImpl();
}

if (!isDeno) {
  await initBdd();
}
