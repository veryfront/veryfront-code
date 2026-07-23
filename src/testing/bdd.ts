/**
 * Portable BDD testing utilities (describe, it, beforeEach, afterEach).
 *
 * In Deno: Uses @std/testing/bdd
 * In Node.js: Uses node:test
 * In Bun: Uses bun:test
 *
 * @module
 */

import "./init.ts";
import { dynamicImport } from "#veryfront/platform/compat/dynamic-import.ts";
import { isBun, isDeno } from "#veryfront/platform/compat/runtime.ts";
import { getEnv, getEnvOverlayStorage } from "#veryfront/platform/compat/process.ts";
import {
  resolveBunTestAdapter,
  resolveDefaultTestTimeout,
  validateTestTimeout,
  wrapTestFunctionWithTimeout,
} from "./bdd-adapter.ts";
import { ensureEnvOverlayRuntime, EnvOverlayStore } from "./env-overlay.ts";

/** Portable test options. Sanitizer fields only apply to Deno. */
export interface TestOptions {
  /** Ask Deno to detect leaked runtime resources. */
  sanitizeResources?: boolean;
  /** Ask Deno to detect leaked asynchronous operations. */
  sanitizeOps?: boolean;
  /** Ask Deno to prevent the test from exiting the process. */
  sanitizeExit?: boolean;
  /** Skip this test or suite. */
  skip?: boolean;
  /** Run only this test or suite. */
  only?: boolean;
  /** Alias for `skip`. */
  ignore?: boolean;
  /** Maximum test or hook duration in milliseconds. Suites pass this limit to descendants. */
  timeout?: number;
}

/** Context passed to BDD hooks and tests. */
export interface BddTestContext {
  /** Test or step name supplied by the active runtime. */
  name: string;
  /** Source location supplied by the active runtime, when available. */
  origin?: string;
  /** Parent test context for nested steps, when available. */
  parent?: BddTestContext;
  /** Run a nested test step when the active runtime supports steps. */
  step?: (name: string, fn: TestFn) => Promise<void>;
}

/** Test function that can be sync or async. */
export type TestFn = (ctx?: BddTestContext) => void | Promise<void>;

/** Hook function that can be sync or async. */
export type HookFn = (ctx?: BddTestContext) => void | Promise<void>;

function readContextProperty(context: object, property: PropertyKey): unknown {
  try {
    return Reflect.get(context, property);
  } catch {
    return undefined;
  }
}

function adaptBddContext(
  context: unknown,
  nestedMethod: "step" | "test",
  fallbackName = "",
  seen = new WeakMap<object, BddTestContext>(),
): BddTestContext {
  if ((typeof context !== "object" && typeof context !== "function") || context === null) {
    return { name: fallbackName };
  }
  const existing = seen.get(context);
  if (existing) return existing;

  const name = readContextProperty(context, "name");
  const portable: BddTestContext = {
    name: typeof name === "string" ? name : fallbackName,
  };
  seen.set(context, portable);

  const origin = readContextProperty(context, "origin");
  if (typeof origin === "string") portable.origin = origin;
  const parent = readContextProperty(context, "parent");
  if ((typeof parent === "object" || typeof parent === "function") && parent !== null) {
    portable.parent = adaptBddContext(parent, nestedMethod, "", seen);
  }

  const runtimeStep = readContextProperty(context, nestedMethod);
  if (typeof runtimeStep === "function") {
    portable.step = async (stepName, fn): Promise<void> => {
      await Reflect.apply(runtimeStep, context, [
        stepName,
        (childContext: unknown) =>
          fn(adaptBddContext(childContext, nestedMethod, stepName, new WeakMap())),
      ]);
    };
  }
  return portable;
}

function withNodeContextAdapter<T extends TestFn | HookFn>(fn: T): T {
  if (isDeno || isBun) return fn;
  return ((context?: unknown) =>
    fn(context === undefined ? undefined : adaptBddContext(context, "test"))) as T;
}

const DEFAULT_TEST_TIMEOUT_MS = 30_000;

const suiteTimeoutStack: Array<number | undefined> = [];

function currentSuiteTimeout(): number | undefined {
  return suiteTimeoutStack.at(-1);
}

function effectiveTimeout(configured?: number): number | undefined {
  const timeout = configured ?? currentSuiteTimeout();
  return timeout === undefined ? undefined : validateTestTimeout(timeout);
}

function withSuiteTimeout(testFn: () => void, configured?: number): () => void {
  const timeout = effectiveTimeout(configured);
  return () => {
    suiteTimeoutStack.push(timeout);
    try {
      testFn();
    } finally {
      suiteTimeoutStack.pop();
    }
  };
}

function withPortableTimeout<T extends TestFn | HookFn>(
  fn: T,
  timeout?: number,
): T {
  if (timeout === undefined) return fn;
  return wrapTestFunctionWithTimeout(
    fn as (...args: [BddTestContext?]) => void | Promise<void>,
    timeout,
  ) as T;
}

const contextEnvOverlays = new WeakMap<object, EnvOverlayStore>();

function contextFromArgs(args: unknown[]): object | undefined {
  const context = args[0];
  return typeof context === "object" && context !== null ? context : undefined;
}

function getContextEnvOverlay(args: unknown[]): EnvOverlayStore | undefined {
  const context = contextFromArgs(args);
  if (!context) return undefined;
  const existing = contextEnvOverlays.get(context);
  if (existing) return existing;
  const overlay = new EnvOverlayStore();
  contextEnvOverlays.set(context, overlay);
  return overlay;
}

function hasActiveEnvOverlay(): boolean {
  return getEnvOverlayStorage()?.getStore() instanceof Map;
}

function withEnvOverlay<T extends TestFn | (() => void)>(fn: T): T {
  const overlay = getEnvOverlayStorage();
  if (!overlay) return fn;

  return ((...args: unknown[]) => {
    const contextOverlay = isDeno ? undefined : getContextEnvOverlay(args);
    if (contextOverlay && overlay.run) {
      return overlay.run(
        contextOverlay,
        () => Promise.resolve().then(() => fn(...(args as []))),
      );
    }

    if (hasActiveEnvOverlay()) {
      return Promise.resolve().then(() => fn(...(args as [])));
    }

    if (overlay.run) {
      return overlay.run(
        new EnvOverlayStore(),
        () => Promise.resolve().then(() => fn(...(args as []))),
      );
    }

    if (overlay.enterWith) {
      overlay.enterWith(new EnvOverlayStore());
    }

    return fn(...(args as []));
  }) as T;
}

function withHookEnvOverlay(fn: HookFn): HookFn {
  if (isDeno) return withEnvOverlay(fn);

  const overlay = getEnvOverlayStorage();
  if (!overlay?.run) return fn;

  return ((...args: unknown[]) => {
    const contextOverlay = getContextEnvOverlay(args);
    if (contextOverlay) {
      return overlay.run!(
        contextOverlay,
        () => Promise.resolve().then(() => fn(...(args as [BddTestContext?]))),
      );
    }
    if (hasActiveEnvOverlay()) {
      return Promise.resolve().then(() => fn(...(args as [BddTestContext?])));
    }
    return overlay.run!(
      new EnvOverlayStore(),
      () => Promise.resolve().then(() => fn(...(args as [BddTestContext?]))),
    );
  }) as HookFn;
}

function withoutEnvOverlay<T extends TestFn | (() => void)>(fn: T): T {
  const overlay = getEnvOverlayStorage();
  if (!overlay?.run) return fn;

  return ((...args: unknown[]) => {
    return overlay.run!(null, () => Promise.resolve().then(() => fn(...(args as []))));
  }) as T;
}

// For Deno, we directly use @std/testing/bdd - no wrapper needed
// This avoids creating a "global" test suite from top-level await
let denoBdd: typeof import("#std/testing/bdd") | null = null;

ensureEnvOverlayRuntime();

if (isDeno) {
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
    const { name: _name, ...rest } = nameOrOptions;
    options = rest;
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

      if (options.only) {
        if (!nodeTest.describe.only) {
          throw new Error("The Node test adapter does not support exclusive suites");
        }
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

      if (options.only) {
        if (!nodeTest.it.only) {
          throw new Error("The Node test adapter does not support exclusive tests");
        }
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
  const defaultTimeout = resolveDefaultTestTimeout(
    getEnv("BUN_TEST_TIMEOUT") ?? getEnv("VF_TEST_TIMEOUT"),
    DEFAULT_TEST_TIMEOUT_MS,
  );

  return {
    describe(nameOrOptions, optionsOrFn, fn): void {
      const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
      if (!testFn) throw new Error("describe requires a test function");

      if ((options.skip || options.ignore) && bunTest.describe.skip) {
        bunTest.describe.skip(name, testFn);
        return;
      }
      if (options.skip || options.ignore) {
        throw new Error("The Bun test adapter does not support skipped suites");
      }

      if (options.only && bunTest.describe.only) {
        bunTest.describe.only(name, testFn);
        return;
      }
      if (options.only) {
        throw new Error("The Bun test adapter does not support exclusive suites");
      }

      bunTest.describe(name, testFn);
    },

    it(nameOrOptions, optionsOrFn, fn): void {
      const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
      if (!testFn) throw new Error("it requires a test function");

      const isSkip = options.skip || options.ignore;

      type TestRunner = (
        name: string,
        optionsOrFn: { timeout?: number } | TestFn,
        fn?: TestFn,
      ) => void;

      let runner: TestRunner = bunTest.it;
      if (isSkip && !bunTest.it.skip) {
        throw new Error("The Bun test adapter does not support skipped tests");
      }
      if (options.only && !bunTest.it.only) {
        throw new Error("The Bun test adapter does not support exclusive tests");
      }
      if (isSkip) runner = bunTest.it.skip as TestRunner;
      else if (options.only && bunTest.it.only) runner = bunTest.it.only as TestRunner;

      if (isSkip) {
        runner(name, testFn);
        return;
      }

      const timeout = options.timeout ?? defaultTimeout;
      if (Number.isFinite(timeout) && timeout > 0) {
        runner(name, { timeout }, testFn);
        return;
      }

      runner(name, testFn);
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
    const imported = await dynamicImport("bun:test");
    const bunTest = resolveBunTestAdapter(imported);
    if (!bunTest) {
      throw new Error("The Bun test adapter is missing required test functions");
    }
    _impl = createBunImpl(bunTest as unknown as BunTestModule);
    _impl.beforeEach(() => {
      getEnvOverlayStorage()?.enterWith?.(new EnvOverlayStore());
    });
    return _impl;
  }

  const nodeTest = await dynamicImport("node:test");
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
  _impl.beforeEach(() => {
    getEnvOverlayStorage()?.enterWith?.(new EnvOverlayStore());
  });

  return _impl;
}

function hasOptions(options: TestOptions): boolean {
  return Object.values(options).some((v) => v !== undefined);
}

function normalizeDenoOptions(options: TestOptions): TestOptions {
  const { skip, timeout: _timeout, ...rest } = options;
  return skip ? { ...rest, ignore: true } : rest;
}

function adaptDenoTestFn(
  fn: TestFn,
): (context: Deno.TestContext) => void | Promise<void> {
  return (context) => fn(adaptBddContext(context, "step"));
}

function requireImpl(): BddImpl {
  if (_impl) return _impl;
  throw new Error(
    "BDD implementation not initialized. For Node/Bun, call initBdd() first, or import from #veryfront/testing which auto-initializes.",
  );
}

let describeDepth = 0;

function withSuiteEnvOverlay(testFn: () => void): () => void {
  if (!denoBdd) return testFn;

  return () => {
    const isTopLevelSuite = describeDepth === 0;
    const initializeTestEnv = () => {
      getEnvOverlayStorage()?.enterWith?.(new EnvOverlayStore());
    };
    if (isTopLevelSuite) {
      denoBdd.beforeEach(initializeTestEnv);
    }

    describeDepth++;
    try {
      testFn();
    } finally {
      describeDepth--;
    }

    if (isTopLevelSuite) {
      denoBdd.afterEach(initializeTestEnv);
    }
  };
}

/** Group related BDD tests. */
export function describe(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | (() => void),
  fn?: () => void,
): void {
  if (!denoBdd) {
    const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
    if (!testFn) throw new Error("describe requires a test function");
    const suiteWithEnv = withSuiteEnvOverlay(withSuiteTimeout(testFn, options.timeout));
    if (hasOptions(options)) {
      requireImpl().describe({ name, ...options }, suiteWithEnv);
      return;
    }
    requireImpl().describe(name, suiteWithEnv);
    return;
  }

  const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
  if (!testFn) throw new Error("describe requires a test function");

  const denoOptions = normalizeDenoOptions(options);
  const suiteWithEnv = withSuiteEnvOverlay(withSuiteTimeout(testFn, options.timeout));
  if (hasOptions(denoOptions)) {
    denoBdd.describe({ name, ...denoOptions }, suiteWithEnv);
    return;
  }

  denoBdd.describe(name, suiteWithEnv);
}

/** Define a skipped BDD suite. */
describe.skip = function skip(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | (() => void),
  fn?: () => void,
): void {
  const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
  if (!testFn) throw new Error("describe.skip requires a test function");
  const skipOptions = { ...options, only: false, ignore: true };

  if (denoBdd) {
    denoBdd.describe(
      { name, ...normalizeDenoOptions(skipOptions) },
      withSuiteEnvOverlay(withSuiteTimeout(testFn, options.timeout)),
    );
    return;
  }

  requireImpl().describe(
    { name, ...skipOptions },
    withSuiteEnvOverlay(withSuiteTimeout(testFn, options.timeout)),
  );
};

/** Define an ignored BDD suite. */
describe.ignore = function ignore(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | (() => void),
  fn?: () => void,
): void {
  describe.skip(nameOrOptions, optionsOrFn, fn);
};

/** Define an exclusive BDD suite. */
describe.only = function only(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | (() => void),
  fn?: () => void,
): void {
  const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
  if (!testFn) throw new Error("describe.only requires a test function");
  const onlyOptions = { ...options, skip: false, ignore: false, only: true };

  if (denoBdd) {
    denoBdd.describe(
      { name, ...normalizeDenoOptions(onlyOptions) },
      withSuiteEnvOverlay(withSuiteTimeout(testFn, options.timeout)),
    );
    return;
  }

  requireImpl().describe(
    { name, ...onlyOptions },
    withSuiteEnvOverlay(withSuiteTimeout(testFn, options.timeout)),
  );
};

/** Define a BDD test case. */
export function it(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | TestFn,
  fn?: TestFn,
): void {
  if (!denoBdd) {
    const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
    if (!testFn) throw new Error("it requires a test function");
    const timeout = effectiveTimeout(options.timeout);
    const testWithEnv = withEnvOverlay(withNodeContextAdapter(testFn));
    const runtimeOptions = timeout === undefined ? options : { ...options, timeout };
    if (hasOptions(runtimeOptions)) {
      requireImpl().it({ name, ...runtimeOptions }, testWithEnv);
      return;
    }
    requireImpl().it(name, testWithEnv);
    return;
  }

  const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
  if (!testFn) throw new Error("it requires a test function");
  const timeout = effectiveTimeout(options.timeout);
  const testWithEnv = withPortableTimeout(withEnvOverlay(testFn), timeout);

  const denoOptions = normalizeDenoOptions(options);
  if (hasOptions(denoOptions)) {
    denoBdd.it({ name, ...denoOptions }, adaptDenoTestFn(testWithEnv));
    return;
  }

  denoBdd.it(name, adaptDenoTestFn(testWithEnv));
}

/** Define a skipped BDD test. */
it.skip = function skip(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | TestFn,
  fn?: TestFn,
): void {
  const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
  if (!testFn) throw new Error("it.skip requires a test function");
  const timeout = effectiveTimeout(options.timeout);
  const testWithEnv = denoBdd
    ? withPortableTimeout(withEnvOverlay(testFn), timeout)
    : withEnvOverlay(withNodeContextAdapter(testFn));
  const skipOptions = { ...options, timeout, only: false, ignore: true };

  if (denoBdd) {
    denoBdd.it(
      { name, ...normalizeDenoOptions(skipOptions) },
      adaptDenoTestFn(testWithEnv),
    );
    return;
  }

  requireImpl().it({ name, ...skipOptions }, testWithEnv);
};

/** Define an ignored BDD test. */
it.ignore = function ignore(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | TestFn,
  fn?: TestFn,
): void {
  it.skip(nameOrOptions, optionsOrFn, fn);
};

/** Define an exclusive BDD test. */
it.only = function only(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | TestFn,
  fn?: TestFn,
): void {
  const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
  if (!testFn) throw new Error("it.only requires a test function");
  const timeout = effectiveTimeout(options.timeout);
  const testWithEnv = denoBdd
    ? withPortableTimeout(withEnvOverlay(testFn), timeout)
    : withEnvOverlay(withNodeContextAdapter(testFn));
  const onlyOptions = { ...options, timeout, skip: false, ignore: false, only: true };

  if (denoBdd) {
    denoBdd.it(
      { name, ...normalizeDenoOptions(onlyOptions) },
      adaptDenoTestFn(testWithEnv),
    );
    return;
  }

  requireImpl().it({ name, ...onlyOptions }, testWithEnv);
};

/** Register a hook before each BDD test. */
export function beforeEach(fn: HookFn): void {
  const hookWithEnv = withHookEnvOverlay(
    withPortableTimeout(withNodeContextAdapter(fn), currentSuiteTimeout()),
  );
  if (denoBdd) {
    denoBdd.beforeEach(hookWithEnv);
    return;
  }
  requireImpl().beforeEach(hookWithEnv);
}

/** Register a hook after each BDD test. */
export function afterEach(fn: HookFn): void {
  const hookWithEnv = withHookEnvOverlay(
    withPortableTimeout(withNodeContextAdapter(fn), currentSuiteTimeout()),
  );
  if (denoBdd) {
    denoBdd.afterEach(hookWithEnv);
    return;
  }
  requireImpl().afterEach(hookWithEnv);
}

/** Register a hook before all BDD tests in a group. */
export function beforeAll(fn: HookFn): void {
  const hostHook = withoutEnvOverlay(
    withPortableTimeout(withNodeContextAdapter(fn), currentSuiteTimeout()),
  );
  if (denoBdd) {
    denoBdd.beforeAll(hostHook);
    return;
  }
  requireImpl().beforeAll(hostHook);
}

/** Register a hook after all BDD tests in a group. */
export function afterAll(fn: HookFn): void {
  const hostHook = withoutEnvOverlay(
    withPortableTimeout(withNodeContextAdapter(fn), currentSuiteTimeout()),
  );
  if (denoBdd) {
    denoBdd.afterAll(hostHook);
    return;
  }
  requireImpl().afterAll(hostHook);
}

/** Shared test value. */
export const test: typeof it = it;

/** Initialize the BDD test adapter. */
export async function initBdd(): Promise<void> {
  if (denoBdd) return;
  await getImpl();
}

if (!isDeno) {
  await initBdd();
}
