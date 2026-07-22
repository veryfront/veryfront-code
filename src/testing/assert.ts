import "./init.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { deepEquals, safeStringify } from "./utils.ts";

// deno-lint-ignore no-explicit-any -- any[] required: constructor params are contravariant
/** Public API contract for error class. */
type ErrorClass<E extends Error = Error> = abstract new (...args: any[]) => E;

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
  ): unknown;
  assertRejects(
    fn: () => Promise<unknown>,
    errorClassOrMsg?: ErrorClass | string,
    msgIncludesOrMsg?: string,
    msg?: string,
  ): Promise<unknown>;
  assertStringIncludes(actual: string, expected: string, msg?: string): void;
  assertMatch(actual: string, expected: RegExp, msg?: string): void;
  assertInstanceOf<T>(
    actual: unknown,
    // deno-lint-ignore no-explicit-any -- any[] required: constructor params are contravariant
    expectedType: abstract new (...args: any[]) => T,
    msg?: string,
  ): void;
  fail(msg?: string): never;
  assertNotStrictEquals<T>(actual: T, expected: T, msg?: string): void;
  assertObjectMatch(
    actual: Record<string, unknown>,
    expected: Record<string, unknown>,
    msg?: string,
  ): void;
  assertGreater(actual: number, expected: number, msg?: string): void;
  assertGreaterOrEqual(actual: number, expected: number, msg?: string): void;
  assertLess(actual: number, expected: number, msg?: string): void;
  assertLessOrEqual(actual: number, expected: number, msg?: string): void;
}

function createNodeAssertImpl(): AssertImpl {
  function withAssertionMessage(message: string, assertionMessage?: string): string {
    return assertionMessage ? `${message}: ${assertionMessage}` : message;
  }

  function assertErrorMessageIncludes(
    error: unknown,
    includes?: string,
    assertionMessage?: string,
  ): void {
    if (!includes) return;
    if (!(error instanceof Error)) return;

    if (error.message.includes(includes)) return;
    throw new Error(
      withAssertionMessage(
        `Expected error message to include "${includes}", got "${error.message}"`,
        assertionMessage,
      ),
    );
  }

  function assertThrowsOrRejects(
    threw: boolean,
    error: unknown,
    errorClassOrMsg?: ErrorClass | string,
    msgIncludesOrMsg?: string,
    defaultMsg?: string,
    assertionMessage?: string,
  ): void {
    if (!threw) {
      throw new Error(withAssertionMessage(defaultMsg ?? "Assertion failed", assertionMessage));
    }

    if (typeof errorClassOrMsg !== "function") return;

    if (!(error instanceof errorClassOrMsg)) {
      throw new Error(
        withAssertionMessage(
          `Expected error to be instance of ${errorClassOrMsg.name}, got ${
            (error as Error | undefined)?.name ?? typeof error
          }`,
          assertionMessage,
        ),
      );
    }

    assertErrorMessageIncludes(error, msgIncludesOrMsg, assertionMessage);
  }

  function assertObjectMatch(
    actual: Record<string, unknown>,
    expected: Record<string, unknown>,
    msg?: string,
  ): void {
    for (const key of Object.keys(expected)) {
      const actualVal = actual[key];
      const expectedVal = expected[key];

      if (typeof expectedVal === "object" && expectedVal !== null) {
        if (typeof actualVal !== "object" || actualVal === null) {
          throw new Error(msg || `Expected ${key} to be an object`);
        }

        assertObjectMatch(
          actualVal as Record<string, unknown>,
          expectedVal as Record<string, unknown>,
          msg,
        );
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
    ): unknown {
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
        typeof errorClassOrMsg === "string" ? errorClassOrMsg : _msg,
      );
      return error;
    },

    async assertRejects(
      fn: () => Promise<unknown>,
      errorClassOrMsg?: ErrorClass | string,
      msgIncludesOrMsg?: string,
      _msg?: string,
    ): Promise<unknown> {
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
        typeof errorClassOrMsg === "string" ? errorClassOrMsg : _msg,
      );
      return error;
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

/** Assert that two values are deeply equal. */
export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  impl.assertEquals(actual, expected, msg);
}

/** Assert that two values are not deeply equal. */
export function assertNotEquals<T>(actual: T, expected: T, msg?: string): void {
  impl.assertNotEquals(actual, expected, msg);
}

/** Assert that two values are strictly equal. */
export function assertStrictEquals<T>(actual: T, expected: T, msg?: string): void {
  impl.assertStrictEquals(actual, expected, msg);
}

/** Assert that a value is truthy. */
export function assert(expr: unknown, msg?: string): asserts expr {
  impl.assert(expr, msg);
}

/** Assert that a value is not null or undefined. */
export function assertExists<T>(actual: T, msg?: string): asserts actual is NonNullable<T> {
  impl.assertExists(actual, msg);
}

/** Assert that a synchronous function throws and return its captured value. */
export function assertThrows(fn: () => unknown, msg?: string): unknown;
export function assertThrows<E extends Error>(
  fn: () => unknown,
  errorClass: ErrorClass<E>,
  msgIncludes?: string,
  msg?: string,
): E;
export function assertThrows(
  fn: () => unknown,
  errorClassOrMsg?: ErrorClass | string,
  msgIncludesOrMsg?: string,
  msg?: string,
): unknown {
  return impl.assertThrows(fn, errorClassOrMsg, msgIncludesOrMsg, msg);
}

/** Assert that an async function rejects. */
export function assertRejects(
  fn: () => Promise<unknown>,
  errorClassOrMsg?: ErrorClass | string,
  msgIncludesOrMsg?: string,
  msg?: string,
): Promise<unknown> {
  return impl.assertRejects(fn, errorClassOrMsg, msgIncludesOrMsg, msg);
}

/** Assert that a string contains another string. */
export function assertStringIncludes(actual: string, expected: string, msg?: string): void {
  impl.assertStringIncludes(actual, expected, msg);
}

/** Assert that a string matches a regular expression. */
export function assertMatch(actual: string, expected: RegExp, msg?: string): void {
  impl.assertMatch(actual, expected, msg);
}

/** Assert that a value is an instance of a constructor. */
export function assertInstanceOf<T>(
  actual: unknown,
  // deno-lint-ignore no-explicit-any -- any[] required: constructor params are contravariant
  expectedType: abstract new (...args: any[]) => T,
  msg?: string,
): asserts actual is T {
  impl.assertInstanceOf(actual, expectedType, msg);
}

/** Fail the current assertion immediately. */
export function fail(msg?: string): never {
  impl.fail(msg);
}

/** Assert that two values are not strictly equal. */
export function assertNotStrictEquals<T>(actual: T, expected: T, msg?: string): void {
  impl.assertNotStrictEquals(actual, expected, msg);
}

/** Assert that an object contains matching properties. */
export function assertObjectMatch(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  msg?: string,
): void {
  impl.assertObjectMatch(actual, expected, msg);
}

/** Assert that a number is greater than another number. */
export function assertGreater(actual: number, expected: number, msg?: string): void {
  impl.assertGreater(actual, expected, msg);
}

/** Assert that a number is greater than or equal to another number. */
export function assertGreaterOrEqual(actual: number, expected: number, msg?: string): void {
  impl.assertGreaterOrEqual(actual, expected, msg);
}

/** Assert that a number is less than another number. */
export function assertLess(actual: number, expected: number, msg?: string): void {
  impl.assertLess(actual, expected, msg);
}

/** Assert that a number is less than or equal to another number. */
export function assertLessOrEqual(actual: number, expected: number, msg?: string): void {
  impl.assertLessOrEqual(actual, expected, msg);
}
