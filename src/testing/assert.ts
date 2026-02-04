import "./init.ts";
import { isDeno } from "../platform/compat/runtime.ts";
import { deepEquals, safeStringify } from "./utils.ts";

// deno-lint-ignore no-explicit-any
type ErrorClass = new (...args: any[]) => Error;

interface AssertImpl {
  assertEquals<T>(actual: T, expected: T, msg?: string): void;
  assertNotEquals<T>(actual: T, expected: T, msg?: string): void;
  assertStrictEquals<T>(actual: T, expected: T, msg?: string): void;
  assert(expr: unknown, msg?: string): void;
  assertExists<T>(actual: T, msg?: string): void;
  assertThrows(
    fn: () => unknown,
    errorClassOrMsg?: ErrorClass | string,
    msgIncludesOrMsg?: string,
    msg?: string,
  ): void;
  assertRejects(
    fn: () => Promise<unknown>,
    errorClassOrMsg?: ErrorClass | string,
    msgIncludesOrMsg?: string,
    msg?: string,
  ): Promise<unknown>;
  assertStringIncludes(actual: string, expected: string, msg?: string): void;
  assertMatch(actual: string, expected: RegExp, msg?: string): void;
  // deno-lint-ignore no-explicit-any
  assertInstanceOf<T>(
    actual: unknown,
    expectedType: abstract new (...args: any[]) => T,
    msg?: string,
  ): void;
  fail(msg?: string): never;
  assertNotStrictEquals<T>(actual: T, expected: T, msg?: string): void;
  // deno-lint-ignore no-explicit-any
  assertObjectMatch(
    actual: Record<string, any>,
    expected: Record<string, any>,
    msg?: string,
  ): void;
  assertGreater(actual: number, expected: number, msg?: string): void;
  assertGreaterOrEqual(actual: number, expected: number, msg?: string): void;
  assertLess(actual: number, expected: number, msg?: string): void;
  assertLessOrEqual(actual: number, expected: number, msg?: string): void;
}

function createNodeAssertImpl(): AssertImpl {
  function assertErrorMessageIncludes(error: unknown, includes?: string): void {
    if (!includes) return;
    if (!(error instanceof Error)) return;

    if (error.message.includes(includes)) return;
    throw new Error(`Expected error message to include "${includes}", got "${error.message}"`);
  }

  function assertThrowsOrRejects(
    threw: boolean,
    error: unknown,
    errorClassOrMsg?: ErrorClass | string,
    msgIncludesOrMsg?: string,
    defaultMsg?: string,
  ): void {
    if (!threw) {
      throw new Error(typeof errorClassOrMsg === "string" ? errorClassOrMsg : defaultMsg);
    }

    if (typeof errorClassOrMsg !== "function") return;

    if (!(error instanceof errorClassOrMsg)) {
      throw new Error(
        `Expected error to be instance of ${errorClassOrMsg.name}, got ${
          (error as Error | undefined)?.name ?? typeof error
        }`,
      );
    }

    assertErrorMessageIncludes(error, msgIncludesOrMsg);
  }

  function assertObjectMatch(
    actual: Record<string, any>,
    expected: Record<string, any>,
    msg?: string,
  ): void {
    for (const key of Object.keys(expected)) {
      const actualVal = actual[key];
      const expectedVal = expected[key];

      if (typeof expectedVal === "object" && expectedVal !== null) {
        if (typeof actualVal !== "object" || actualVal === null) {
          throw new Error(msg || `Expected ${key} to be an object`);
        }

        assertObjectMatch(actualVal, expectedVal, msg);
        continue;
      }

      if (actualVal === expectedVal) continue;

      throw new Error(
        msg ||
          `Expected ${key} to be ${JSON.stringify(expectedVal)}, got ${JSON.stringify(actualVal)}`,
      );
    }
  }

  return {
    assertEquals<T>(actual: T, expected: T, msg?: string): void {
      if (deepEquals(actual, expected)) return;
      throw new Error(msg || `Expected ${safeStringify(expected)}, got ${safeStringify(actual)}`);
    },

    assertNotEquals<T>(actual: T, expected: T, msg?: string): void {
      if (!deepEquals(actual, expected)) return;
      throw new Error(msg || `Expected values to not be equal: ${safeStringify(actual)}`);
    },

    assertStrictEquals<T>(actual: T, expected: T, msg?: string): void {
      if (actual === expected) return;
      throw new Error(msg || `Expected ${expected}, got ${actual}`);
    },

    assert(expr: unknown, msg?: string): void {
      if (expr) return;
      throw new Error(msg || "Assertion failed: expected truthy value");
    },

    assertExists<T>(actual: T, msg?: string): void {
      if (actual !== null && actual !== undefined) return;
      throw new Error(msg || `Expected value to exist, but got ${actual}`);
    },

    assertThrows(
      fn: () => unknown,
      errorClassOrMsg?: ErrorClass | string,
      msgIncludesOrMsg?: string,
      _msg?: string,
    ): void {
      let threw = false;
      let error: unknown;

      try {
        fn();
      } catch (e) {
        threw = true;
        error = e;
      }

      assertThrowsOrRejects(
        threw,
        error,
        errorClassOrMsg,
        msgIncludesOrMsg,
        "Expected function to throw",
      );
    },

    async assertRejects(
      fn: () => Promise<unknown>,
      errorClassOrMsg?: ErrorClass | string,
      msgIncludesOrMsg?: string,
      _msg?: string,
    ): Promise<void> {
      let threw = false;
      let error: unknown;

      try {
        await fn();
      } catch (e) {
        threw = true;
        error = e;
      }

      assertThrowsOrRejects(
        threw,
        error,
        errorClassOrMsg,
        msgIncludesOrMsg,
        "Expected function to reject",
      );
    },

    assertStringIncludes(actual: string, expected: string, msg?: string): void {
      if (actual.includes(expected)) return;
      throw new Error(msg || `Expected "${actual}" to include "${expected}"`);
    },

    assertMatch(actual: string, expected: RegExp, msg?: string): void {
      if (expected.test(actual)) return;
      throw new Error(msg || `Expected "${actual}" to match ${expected}`);
    },

    assertInstanceOf<T>(
      actual: unknown,
      expectedType: new (...args: unknown[]) => T,
      msg?: string,
    ): void {
      if (actual instanceof expectedType) return;
      throw new Error(msg || `Expected instance of ${expectedType.name}, got ${typeof actual}`);
    },

    fail(msg?: string): never {
      throw new Error(msg || "Test failed");
    },

    assertNotStrictEquals<T>(actual: T, expected: T, msg?: string): void {
      if (actual !== expected) return;
      throw new Error(msg || "Expected values to not be strictly equal");
    },

    assertObjectMatch,

    assertGreater(actual: number, expected: number, msg?: string): void {
      if (actual > expected) return;
      throw new Error(msg || `Expected ${actual} to be greater than ${expected}`);
    },

    assertGreaterOrEqual(actual: number, expected: number, msg?: string): void {
      if (actual >= expected) return;
      throw new Error(msg || `Expected ${actual} to be greater than or equal to ${expected}`);
    },

    assertLess(actual: number, expected: number, msg?: string): void {
      if (actual < expected) return;
      throw new Error(msg || `Expected ${actual} to be less than ${expected}`);
    },

    assertLessOrEqual(actual: number, expected: number, msg?: string): void {
      if (actual <= expected) return;
      throw new Error(msg || `Expected ${actual} to be less than or equal to ${expected}`);
    },
  };
}

let impl: AssertImpl;

if (isDeno) {
  const denoAssert = await import("#std/assert.ts");
  impl = {
    assertEquals: denoAssert.assertEquals,
    assertNotEquals: denoAssert.assertNotEquals,
    assertStrictEquals: denoAssert.assertStrictEquals,
    assert: denoAssert.assert,
    assertExists: denoAssert.assertExists,
    assertThrows: denoAssert.assertThrows,
    assertRejects: denoAssert.assertRejects,
    assertStringIncludes: denoAssert.assertStringIncludes,
    assertMatch: denoAssert.assertMatch,
    assertInstanceOf: denoAssert.assertInstanceOf,
    fail: denoAssert.fail,
    assertNotStrictEquals: denoAssert.assertNotStrictEquals,
    assertObjectMatch: denoAssert.assertObjectMatch,
    assertGreater: denoAssert.assertGreater,
    assertGreaterOrEqual: denoAssert.assertGreaterOrEqual,
    assertLess: denoAssert.assertLess,
    assertLessOrEqual: denoAssert.assertLessOrEqual,
  };
} else {
  impl = createNodeAssertImpl();
}

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  impl.assertEquals(actual, expected, msg);
}

export function assertNotEquals<T>(actual: T, expected: T, msg?: string): void {
  impl.assertNotEquals(actual, expected, msg);
}

export function assertStrictEquals<T>(actual: T, expected: T, msg?: string): void {
  impl.assertStrictEquals(actual, expected, msg);
}

export function assert(expr: unknown, msg?: string): asserts expr {
  impl.assert(expr, msg);
}

export function assertExists<T>(actual: T, msg?: string): asserts actual is NonNullable<T> {
  impl.assertExists(actual, msg);
}

export function assertThrows(
  fn: () => unknown,
  errorClassOrMsg?: ErrorClass | string,
  msgIncludesOrMsg?: string,
  msg?: string,
): void {
  impl.assertThrows(fn, errorClassOrMsg, msgIncludesOrMsg, msg);
}

export function assertRejects(
  fn: () => Promise<unknown>,
  errorClassOrMsg?: ErrorClass | string,
  msgIncludesOrMsg?: string,
  msg?: string,
): Promise<unknown> {
  return impl.assertRejects(fn, errorClassOrMsg, msgIncludesOrMsg, msg);
}

export function assertStringIncludes(actual: string, expected: string, msg?: string): void {
  impl.assertStringIncludes(actual, expected, msg);
}

export function assertMatch(actual: string, expected: RegExp, msg?: string): void {
  impl.assertMatch(actual, expected, msg);
}

// deno-lint-ignore no-explicit-any
export function assertInstanceOf<T>(
  actual: unknown,
  expectedType: abstract new (...args: any[]) => T,
  msg?: string,
): asserts actual is T {
  impl.assertInstanceOf(actual, expectedType, msg);
}

export function fail(msg?: string): never {
  impl.fail(msg);
}

export function assertNotStrictEquals<T>(actual: T, expected: T, msg?: string): void {
  impl.assertNotStrictEquals(actual, expected, msg);
}

// deno-lint-ignore no-explicit-any
export function assertObjectMatch(
  actual: Record<string, any>,
  expected: Record<string, any>,
  msg?: string,
): void {
  impl.assertObjectMatch(actual, expected, msg);
}

export function assertGreater(actual: number, expected: number, msg?: string): void {
  impl.assertGreater(actual, expected, msg);
}

export function assertGreaterOrEqual(actual: number, expected: number, msg?: string): void {
  impl.assertGreaterOrEqual(actual, expected, msg);
}

export function assertLess(actual: number, expected: number, msg?: string): void {
  impl.assertLess(actual, expected, msg);
}

export function assertLessOrEqual(actual: number, expected: number, msg?: string): void {
  impl.assertLessOrEqual(actual, expected, msg);
}
