/**
 * Portable BDD testing utilities (describe, it, beforeEach, afterEach).
 *
 * In Deno: Direct re-export from @std/testing/bdd (no wrapper)
 * In Node.js: Uses node:test
 * In Bun: Uses bun:test
 *
 * @module
 */

import { isBun, isDeno } from "../platform/compat/runtime.ts";

// ============================================================================
// Type definitions
// ============================================================================

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

// ============================================================================
// Deno: Direct delegation to @std/testing/bdd
// ============================================================================

// For Deno, we directly use @std/testing/bdd - no wrapper needed
// This avoids creating a "global" test suite from top-level await
let denoBdd: typeof import("@std/testing/bdd") | null = null;

if (isDeno) {
  // Synchronously load the Deno BDD module
  // This is safe because Deno supports top-level await and we're not
  // creating any test hooks at module level
  denoBdd = await import("@std/testing/bdd");
}

// ============================================================================
// Node/Bun implementation interface
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

let _impl: BddImpl | null = null;

/** Parse overloaded BDD function arguments */
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
      if (!testFn) throw new Error("describe requires a test function");
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
      if (!testFn) throw new Error("it requires a test function");
      const isSkip = options.skip || options.ignore;
      if (isSkip) {
        nodeTest.it.skip(name, testFn);
      } else if (options.only && nodeTest.it.only) {
        nodeTest.it.only(name, testFn);
      } else if (options.timeout !== undefined) {
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
// Bun implementation
// ============================================================================

import { getEnvOverlayStorage } from "../platform/compat/process.ts";

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
      if (!testFn) throw new Error("describe requires a test function");
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
      if (!testFn) throw new Error("it requires a test function");
      const testWithEnv = withEnvOverlay(testFn);
      const isSkip = options.skip || options.ignore;
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
      if (Number.isFinite(timeout) && timeout > 0) {
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
// Lazy initialization for Node/Bun
// ============================================================================

async function getImpl(): Promise<BddImpl> {
  if (_impl) return _impl;

  if (isBun) {
    const importBunTest = new Function("return import('bun:test')") as () => Promise<{
      default: BunTestModule;
    }>;
    const bunTestModule = await importBunTest();
    _impl = createBunImpl(bunTestModule.default);
  } else {
    // Node.js
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
  }

  return _impl;
}

// ============================================================================
// Public exports - delegates to Deno BDD or Node/Bun impl
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

export function describe(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | (() => void),
  fn?: () => void,
): void {
  if (denoBdd) {
    // Deno: delegate directly
    const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
    if (!testFn) throw new Error("describe requires a test function");
    const denoOptions = normalizeDenoOptions(options);
    if (hasOptions(denoOptions)) {
      denoBdd.describe({ name, ...denoOptions }, testFn);
    } else {
      denoBdd.describe(name, testFn);
    }
    return;
  }

  if (!_impl) {
    throw new Error(
      "BDD implementation not initialized. For Node/Bun, call initBdd() first, or import from @veryfront/testing which auto-initializes.",
    );
  }
  _impl.describe(nameOrOptions, optionsOrFn, fn);
}

describe.skip = function skip(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | (() => void),
  fn?: () => void,
): void {
  const name = typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;
  const testFn = typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!testFn) throw new Error("describe.skip requires a test function");

  if (denoBdd) {
    denoBdd.describe({ name, ignore: true }, testFn);
    return;
  }

  if (!_impl) throw new Error("BDD implementation not initialized");
  _impl.describe({ name, ignore: true }, testFn);
};

describe.ignore = describe.skip;

describe.only = function only(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | (() => void),
  fn?: () => void,
): void {
  const name = typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;
  const testFn = typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!testFn) throw new Error("describe.only requires a test function");

  if (denoBdd) {
    denoBdd.describe({ name, only: true }, testFn);
    return;
  }

  if (!_impl) throw new Error("BDD implementation not initialized");
  _impl.describe({ name, only: true }, testFn);
};

export function it(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | TestFn,
  fn?: TestFn,
): void {
  if (denoBdd) {
    // Deno: delegate directly
    const { name, options, testFn } = parseBddArgs(nameOrOptions, optionsOrFn, fn);
    if (!testFn) throw new Error("it requires a test function");
    const denoOptions = normalizeDenoOptions(options);
    if (hasOptions(denoOptions)) {
      denoBdd.it({ name, ...denoOptions }, testFn);
    } else {
      denoBdd.it(name, testFn);
    }
    return;
  }

  if (!_impl) {
    throw new Error(
      "BDD implementation not initialized. For Node/Bun, call initBdd() first, or import from @veryfront/testing which auto-initializes.",
    );
  }
  _impl.it(nameOrOptions, optionsOrFn, fn);
}

it.skip = function skip(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | TestFn,
  fn?: TestFn,
): void {
  const name = typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;
  const testFn = typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!testFn) throw new Error("it.skip requires a test function");

  if (denoBdd) {
    denoBdd.it({ name, ignore: true }, testFn);
    return;
  }

  if (!_impl) throw new Error("BDD implementation not initialized");
  _impl.it({ name, ignore: true }, testFn);
};

it.ignore = it.skip;

it.only = function only(
  nameOrOptions: string | (TestOptions & { name: string }),
  optionsOrFn?: TestOptions | TestFn,
  fn?: TestFn,
): void {
  const name = typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;
  const testFn = typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!testFn) throw new Error("it.only requires a test function");

  if (denoBdd) {
    denoBdd.it({ name, only: true }, testFn);
    return;
  }

  if (!_impl) throw new Error("BDD implementation not initialized");
  _impl.it({ name, only: true }, testFn);
};

export function beforeEach(fn: HookFn): void {
  if (denoBdd) {
    denoBdd.beforeEach(fn);
    return;
  }
  if (!_impl) throw new Error("BDD implementation not initialized");
  _impl.beforeEach(fn);
}

export function afterEach(fn: HookFn): void {
  if (denoBdd) {
    denoBdd.afterEach(fn);
    return;
  }
  if (!_impl) throw new Error("BDD implementation not initialized");
  _impl.afterEach(fn);
}

export function beforeAll(fn: HookFn): void {
  if (denoBdd) {
    denoBdd.beforeAll(fn);
    return;
  }
  if (!_impl) throw new Error("BDD implementation not initialized");
  _impl.beforeAll(fn);
}

export function afterAll(fn: HookFn): void {
  if (denoBdd) {
    denoBdd.afterAll(fn);
    return;
  }
  if (!_impl) throw new Error("BDD implementation not initialized");
  _impl.afterAll(fn);
}

export const test = it;

/** Initialize the BDD implementation (required for Node/Bun before using BDD functions) */
export async function initBdd(): Promise<void> {
  if (denoBdd) return; // Already initialized for Deno
  await getImpl();
}
