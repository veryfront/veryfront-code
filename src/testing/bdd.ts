/**
 * Portable BDD testing utilities (describe, it, beforeEach, afterEach).
 *
 * In Deno: Uses @std/testing/bdd
 * In Node.js: Uses node:test
 * In Bun: Uses bun:test
 *
 * IMPORTANT: Import from @veryfront/testing (index.ts) to ensure init.ts runs first.
 *
 * @module
 */

import "./init.ts";
import { isBun, isDeno } from "../platform/compat/runtime.ts";
import { getEnvOverlayStorage } from "../platform/compat/process.ts";
import { installTestIsolation } from "./isolation.ts";

// ============================================================================
// Type definitions
// ============================================================================

/** Test function that can be sync or async */
type TestFn = () => void | Promise<void>;

/** Test options for Deno sanitizers (ignored in Node/Bun) */
export interface TestOptions {
  /**
   * Deno resource sanitizer - checks for leaked resources.
   * Ignored in Node.js and Bun.
   */
  sanitizeResources?: boolean;

  /**
   * Deno ops sanitizer - checks for incomplete async operations.
   * Ignored in Node.js and Bun.
   */
  sanitizeOps?: boolean;

  /**
   * Deno exit sanitizer - checks for unexpected process exits.
   * Ignored in Node.js and Bun.
   */
  sanitizeExit?: boolean;

  /**
   * Skip this test.
   */
  skip?: boolean;

  /**
   * Only run this test (and others marked only).
   */
  only?: boolean;

  /**
   * Ignore failures (test still runs but won't fail the suite).
   */
  ignore?: boolean;

  /**
   * Test timeout in milliseconds.
   */
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

// ============================================================================
// BDD implementation interface
// ============================================================================

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

// ============================================================================
// Deno implementation
// ============================================================================

/** Check if any test options are set */
function hasOptions(options: TestOptions): boolean {
  return Object.values(options).some((v) => v !== undefined);
}

/** Normalize Deno options, converting skip to ignore */
function normalizeDenoOptions(options: TestOptions): TestOptions {
  if (!options.skip) return options;
  const { skip: _skip, ...rest } = options;
  return { ...rest, ignore: true };
}

/** Parse overloaded BDD function arguments into name, options, and function. */
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

function createDenoImpl(denoBdd: typeof import("#std/testing/bdd.ts")): BddImpl {
  return {
    describe(
      nameOrOptions: string | (TestOptions & { name: string }),
      optionsOrFn?: TestOptions | (() => void),
      fn?: () => void,
    ): void {
      const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
      if (!testFn) {
        throw new Error("describe requires a test function");
      }
      const denoOptions = normalizeDenoOptions(options);
      if (hasOptions(denoOptions)) {
        denoBdd.describe({ name, ...denoOptions }, testFn);
      } else {
        denoBdd.describe(name, testFn);
      }
    },
    it(
      nameOrOptions: string | (TestOptions & { name: string }),
      optionsOrFn?: TestOptions | TestFn,
      fn?: TestFn,
    ): void {
      const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
      if (!testFn) {
        throw new Error("it requires a test function");
      }
      const denoOptions = normalizeDenoOptions(options);
      if (hasOptions(denoOptions)) {
        denoBdd.it({ name, ...denoOptions }, testFn);
      } else {
        denoBdd.it(name, testFn);
      }
    },
    beforeEach: denoBdd.beforeEach,
    afterEach: denoBdd.afterEach,
    beforeAll: denoBdd.beforeAll,
    afterAll: denoBdd.afterAll,
  };
}

// ============================================================================
// Node.js implementation
// ============================================================================

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
    describe(
      nameOrOptions: string | (TestOptions & { name: string }),
      optionsOrFn?: TestOptions | (() => void),
      fn?: () => void,
    ): void {
      const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
      if (!testFn) {
        throw new Error("describe requires a test function");
      }
      if (options.skip || options.ignore) {
        nodeTest.describe.skip(name, testFn);
      } else if (options.only && nodeTest.describe.only) {
        nodeTest.describe.only(name, testFn);
      } else {
        nodeTest.describe(name, testFn);
      }
    },
    it(
      nameOrOptions: string | (TestOptions & { name: string }),
      optionsOrFn?: TestOptions | TestFn,
      fn?: TestFn,
    ): void {
      const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
      if (!testFn) {
        throw new Error("it requires a test function");
      }
      const isSkip = options.skip || options.ignore;
      if (isSkip) {
        nodeTest.it.skip(name, testFn);
      } else if (options.only && nodeTest.it.only) {
        nodeTest.it.only(name, testFn);
      } else if (!isSkip && options.timeout !== undefined) {
        nodeTest.it(name, { timeout: options.timeout } as never, testFn);
      } else {
        nodeTest.it(name, testFn);
      }
    },
    beforeEach: nodeTest.beforeEach,
    afterEach: nodeTest.afterEach,
    beforeAll: nodeTest.before,
    afterAll: nodeTest.after,
  };
}

// ============================================================================
// Bun implementation (uses bun:test module)
// ============================================================================

interface BunTestModule {
  describe: ((name: string, fn: () => void) => void) & {
    skip?: (name: string, fn: () => void) => void;
    only?: (name: string, fn: () => void) => void;
  };
  it: ((name: string, optionsOrFn: { timeout?: number } | TestFn, fn?: TestFn) => void) & {
    skip?: (name: string, fn: TestFn) => void;
    only?: (name: string, fn: TestFn) => void;
  };
  test: ((name: string, optionsOrFn: { timeout?: number } | TestFn, fn?: TestFn) => void) & {
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
  const withEnvOverlay = (fn: TestFn): TestFn => {
    return async () => {
      const overlay = getEnvOverlayStorage();
      if (overlay?.run) {
        return await overlay.run(new Map(), () => Promise.resolve().then(fn));
      }
      if (overlay?.enterWith) {
        overlay.enterWith(new Map());
      }
      return await fn();
    };
  };

  return {
    describe(
      nameOrOptions: string | (TestOptions & { name: string }),
      optionsOrFn?: TestOptions | (() => void),
      fn?: () => void,
    ): void {
      const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
      if (!testFn) {
        throw new Error("describe requires a test function");
      }
      if ((options.skip || options.ignore) && bunTest.describe.skip) {
        bunTest.describe.skip(name, testFn);
      } else if (options.only && bunTest.describe.only) {
        bunTest.describe.only(name, testFn);
      } else {
        bunTest.describe(name, testFn);
      }
    },
    it(
      nameOrOptions: string | (TestOptions & { name: string }),
      optionsOrFn?: TestOptions | TestFn,
      fn?: TestFn,
    ): void {
      const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
      if (!testFn) {
        throw new Error("it requires a test function");
      }
      const testWithEnv = withEnvOverlay(testFn);
      const isSkip = options.skip || options.ignore;
      // Use flexible type to accommodate skip/only variants with different signatures
      type TestRunner = (
        name: string,
        optionsOrFn: { timeout?: number } | TestFn,
        fn?: TestFn,
      ) => void;
      let runner: TestRunner;
      if (isSkip) {
        runner = (bunTest.it.skip ?? bunTest.it) as TestRunner;
      } else if (options.only && bunTest.it.only) {
        runner = bunTest.it.only as TestRunner;
      } else {
        runner = bunTest.it;
      }
      if (isSkip) {
        runner(name, testWithEnv);
        return;
      }
      const timeout = options.timeout ?? defaultTimeout;
      const shouldTimeout = Number.isFinite(timeout) && timeout > 0;
      if (shouldTimeout) {
        runner(name, { timeout }, testWithEnv);
      } else {
        runner(name, testWithEnv);
      }
    },
    beforeEach: bunTest.beforeEach,
    afterEach: bunTest.afterEach,
    beforeAll: bunTest.beforeAll,
    afterAll: bunTest.afterAll,
  };
}

// ============================================================================
// Create implementation based on runtime
// ============================================================================

let impl: BddImpl;

if (isDeno) {
  // Deno: Use @std/testing/bdd
  const denoBdd = await import("#std/testing/bdd.ts");
  impl = createDenoImpl(denoBdd);
} else if (isBun) {
  // Bun: Use bun:test
  // Use Function constructor to prevent Deno/Node from statically analyzing the import
  const importBunTest = new Function("return import('bun:test')") as () => Promise<{
    default: BunTestModule;
  }>;
  const bunTestModule = await importBunTest();
  impl = createBunImpl(bunTestModule.default);
} else {
  // Node.js: Use node:test
  // Use Function constructor to prevent Bun from statically analyzing the import
  const importNodeTest = new Function("return import('node:test')") as () => Promise<unknown>;
  const nodeTest = await importNodeTest();
  impl = createNodeImpl(
    nodeTest as unknown as {
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
}

await installTestIsolation({
  beforeEach: impl.beforeEach,
  afterEach: impl.afterEach,
});

// ============================================================================
// Public exports
// ============================================================================

/**
 * Describes a test suite.
 */
export function describe(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | (() => void),
  fn?: () => void,
): void {
  impl.describe(nameOrOptions, optionsOrFn, fn);
}

/**
 * Skips a test suite.
 * Note: In Deno's @std/testing/bdd, skipping uses the `ignore` property.
 */
describe.skip = function skip(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | (() => void),
  fn?: () => void,
): void {
  const name = typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;
  const testFn = typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!testFn) {
    throw new Error("describe.skip requires a test function");
  }
  // Use 'ignore' for Deno compatibility - 'skip' is not a standard Deno option
  impl.describe({ name, ignore: true }, testFn);
};

/**
 * Marks a test suite as ignored (runs but failures don't fail the suite).
 */
describe.ignore = function ignore(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | (() => void),
  fn?: () => void,
): void {
  const name = typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;
  const testFn = typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!testFn) {
    throw new Error("describe.ignore requires a test function");
  }
  impl.describe({ name, ignore: true }, testFn);
};

/**
 * Runs only this suite (and others marked only).
 */
describe.only = function only(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | (() => void),
  fn?: () => void,
): void {
  const name = typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;
  const testFn = typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!testFn) {
    throw new Error("describe.only requires a test function");
  }
  impl.describe({ name, only: true }, testFn);
};

/**
 * Defines a test case.
 */
export function it(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | TestFn,
  fn?: TestFn,
): void {
  impl.it(nameOrOptions, optionsOrFn, fn);
}

/**
 * Skips a test case.
 * Note: In Deno's @std/testing/bdd, skipping uses the `ignore` property.
 */
it.skip = function skip(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | TestFn,
  fn?: TestFn,
): void {
  const name = typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;
  const testFn = typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!testFn) {
    throw new Error("it.skip requires a test function");
  }
  // Use 'ignore' for Deno compatibility - 'skip' is not a standard Deno option
  impl.it({ name, ignore: true }, testFn);
};

/**
 * Marks a test as ignored (runs but failures don't fail the suite).
 */
it.ignore = function ignore(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | TestFn,
  fn?: TestFn,
): void {
  const name = typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;
  const testFn = typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!testFn) {
    throw new Error("it.ignore requires a test function");
  }
  impl.it({ name, ignore: true }, testFn);
};

/**
 * Runs only this test (and others marked only).
 */
it.only = function only(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | TestFn,
  fn?: TestFn,
): void {
  const name = typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;
  const testFn = typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!testFn) {
    throw new Error("it.only requires a test function");
  }
  impl.it({ name, only: true }, testFn);
};

/**
 * Runs before each test in the current suite.
 */
export function beforeEach(fn: HookFn): void {
  impl.beforeEach(fn);
}

/**
 * Runs after each test in the current suite.
 */
export function afterEach(fn: HookFn): void {
  impl.afterEach(fn);
}

/**
 * Runs once before all tests in the current suite.
 */
export function beforeAll(fn: HookFn): void {
  impl.beforeAll(fn);
}

/**
 * Runs once after all tests in the current suite.
 */
export function afterAll(fn: HookFn): void {
  impl.afterAll(fn);
}

/**
 * Alias for `it` - defines a test case.
 */
export const test = it;
