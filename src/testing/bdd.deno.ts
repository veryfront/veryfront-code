/**
 * Deno BDD testing utilities - direct re-export from @std/testing/bdd.
 *
 * This file is used by Deno only (via deno.json import map).
 * No wrapper, no side effects, no top-level await.
 *
 * @module
 */

export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
  it as test,
} from "@std/testing/bdd";

// Type definitions (duplicated here to avoid importing from bdd.ts which has side effects)

/** Test function that can be sync or async */
type TestFn = () => void | Promise<void>;

/** Test options for Deno sanitizers */
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
