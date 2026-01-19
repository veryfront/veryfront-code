/**
 * Portable assertion utilities for cross-runtime testing.
 *
 * In Deno: Uses @std/assert
 * In Node.js/Bun: Uses custom implementations
 *
 * IMPORTANT: Import from @veryfront/testing (index.ts) to ensure init.ts runs first.
 *
 * @module
 */

import "./init.ts";
import { isDeno } from "../platform/compat/runtime.ts";
import { deepEquals, safeStringify } from "./utils.ts";

// ============================================================================
// Type definitions
// ============================================================================

/** Error class constructor (works with Error, TypeError, etc.) */
// deno-lint-ignore no-explicit-any
type ErrorClass = new (...args: any[]) => Error;

// ============================================================================
// Runtime-specific assertion modules (loaded at import time)
// ============================================================================

// Deno: Use @std/assert
// Node/Bun: Use custom implementations

/** Internal assertion implementation */
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
  ): Promise<void>;
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

// ============================================================================
// Node.js/Bun Implementation
// ============================================================================

function createNodeAssertImpl(): AssertImpl {
  // For Node/Bun we use synchronous implementations that don't require node:assert
  return {
    assertEquals<T>(actual: T, expected: T, msg?: string): void {
      // Use deep equality comparison that handles circular references
      if (!deepEquals(actual, expected)) {
        throw new Error(
          msg || `Expected ${safeStringify(expected)}, got ${safeStringify(actual)}`,
        );
      }
    },
    assertNotEquals<T>(actual: T, expected: T, msg?: string): void {
      if (deepEquals(actual, expected)) {
        throw new Error(msg || `Expected values to not be equal: ${safeStringify(actual)}`);
      }
    },
    assertStrictEquals<T>(actual: T, expected: T, msg?: string): void {
      if (actual !== expected) {
        throw new Error(msg || `Expected ${expected}, got ${actual}`);
      }
    },
    assert(expr: unknown, msg?: string): void {
      if (!expr) {
        throw new Error(msg || `Assertion failed: expected truthy value`);
      }
    },
    assertExists<T>(actual: T, msg?: string): void {
      if (actual === null || actual === undefined) {
        throw new Error(msg || `Expected value to exist, but got ${actual}`);
      }
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
      if (!threw) {
        throw new Error(
          typeof errorClassOrMsg === "string" ? errorClassOrMsg : "Expected function to throw",
        );
      }
      if (typeof errorClassOrMsg === "function") {
        if (!(error instanceof errorClassOrMsg)) {
          throw new Error(
            `Expected error to be instance of ${errorClassOrMsg.name}, got ${
              (error as Error)?.name ?? typeof error
            }`,
          );
        }
        // Validate error message includes msgIncludesOrMsg if provided
        if (msgIncludesOrMsg && error instanceof Error) {
          if (!error.message.includes(msgIncludesOrMsg)) {
            throw new Error(
              `Expected error message to include "${msgIncludesOrMsg}", got "${error.message}"`,
            );
          }
        }
      }
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
      if (!threw) {
        throw new Error(
          typeof errorClassOrMsg === "string" ? errorClassOrMsg : "Expected function to reject",
        );
      }
      if (typeof errorClassOrMsg === "function") {
        if (!(error instanceof errorClassOrMsg)) {
          throw new Error(
            `Expected error to be instance of ${errorClassOrMsg.name}, got ${
              (error as Error)?.name ?? typeof error
            }`,
          );
        }
        // Validate error message includes msgIncludesOrMsg if provided
        if (msgIncludesOrMsg && error instanceof Error) {
          if (!error.message.includes(msgIncludesOrMsg)) {
            throw new Error(
              `Expected error message to include "${msgIncludesOrMsg}", got "${error.message}"`,
            );
          }
        }
      }
    },
    assertStringIncludes(actual: string, expected: string, msg?: string): void {
      if (!actual.includes(expected)) {
        throw new Error(msg || `Expected "${actual}" to include "${expected}"`);
      }
    },
    assertMatch(actual: string, expected: RegExp, msg?: string): void {
      if (!expected.test(actual)) {
        throw new Error(msg || `Expected "${actual}" to match ${expected}`);
      }
    },
    assertInstanceOf<T>(
      actual: unknown,
      expectedType: new (...args: unknown[]) => T,
      msg?: string,
    ): void {
      if (!(actual instanceof expectedType)) {
        throw new Error(msg || `Expected instance of ${expectedType.name}, got ${typeof actual}`);
      }
    },
    fail(msg?: string): never {
      throw new Error(msg || "Test failed");
    },
    assertNotStrictEquals<T>(actual: T, expected: T, msg?: string): void {
      if (actual === expected) {
        throw new Error(msg || `Expected values to not be strictly equal`);
      }
    },
    // deno-lint-ignore no-explicit-any
    assertObjectMatch(
      actual: Record<string, any>,
      expected: Record<string, any>,
      msg?: string,
    ): void {
      // Check that all expected keys exist in actual with matching values
      for (const key of Object.keys(expected)) {
        const actualVal = actual[key];
        const expectedVal = expected[key];
        if (typeof expectedVal === "object" && expectedVal !== null) {
          if (typeof actualVal !== "object" || actualVal === null) {
            throw new Error(msg || `Expected ${key} to be an object`);
          }
          // Recursive check for nested objects
          this.assertObjectMatch(
            actualVal as Record<string, any>,
            expectedVal as Record<string, any>,
            msg,
          );
        } else if (actualVal !== expectedVal) {
          throw new Error(
            msg ||
              `Expected ${key} to be ${JSON.stringify(expectedVal)}, got ${
                JSON.stringify(actualVal)
              }`,
          );
        }
      }
    },
    assertGreater(actual: number, expected: number, msg?: string): void {
      if (actual <= expected) {
        throw new Error(msg || `Expected ${actual} to be greater than ${expected}`);
      }
    },
    assertGreaterOrEqual(actual: number, expected: number, msg?: string): void {
      if (actual < expected) {
        throw new Error(msg || `Expected ${actual} to be greater than or equal to ${expected}`);
      }
    },
    assertLess(actual: number, expected: number, msg?: string): void {
      if (actual >= expected) {
        throw new Error(msg || `Expected ${actual} to be less than ${expected}`);
      }
    },
    assertLessOrEqual(actual: number, expected: number, msg?: string): void {
      if (actual > expected) {
        throw new Error(msg || `Expected ${actual} to be less than or equal to ${expected}`);
      }
    },
  };
}

// ============================================================================
// Create implementation based on runtime
// ============================================================================

let impl: AssertImpl;

if (isDeno) {
  // Deno: Use @std/assert
  const denoAssert = await import("@std/assert");
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
  // Node.js/Bun: Use custom implementations
  impl = createNodeAssertImpl();
}

// ============================================================================
// Public exports
// ============================================================================

/**
 * Asserts that `actual` and `expected` are strictly equal using deep comparison.
 */
export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  impl.assertEquals(actual, expected, msg);
}

/**
 * Asserts that `actual` and `expected` are not strictly equal.
 */
export function assertNotEquals<T>(actual: T, expected: T, msg?: string): void {
  impl.assertNotEquals(actual, expected, msg);
}

/**
 * Asserts that `actual` is strictly equal to `expected` (using ===).
 */
export function assertStrictEquals<T>(actual: T, expected: T, msg?: string): void {
  impl.assertStrictEquals(actual, expected, msg);
}

/**
 * Asserts that `expr` is truthy.
 */
export function assert(expr: unknown, msg?: string): asserts expr {
  impl.assert(expr, msg);
}

/**
 * Asserts that `actual` is not null or undefined.
 */
export function assertExists<T>(actual: T, msg?: string): asserts actual is NonNullable<T> {
  impl.assertExists(actual, msg);
}

/**
 * Asserts that a function throws an error.
 */
export function assertThrows(
  fn: () => unknown,
  errorClassOrMsg?: ErrorClass | string,
  msgIncludesOrMsg?: string,
  msg?: string,
): void {
  impl.assertThrows(fn, errorClassOrMsg, msgIncludesOrMsg, msg);
}

/**
 * Asserts that an async function rejects with an error.
 */
export function assertRejects(
  fn: () => Promise<unknown>,
  errorClassOrMsg?: ErrorClass | string,
  msgIncludesOrMsg?: string,
  msg?: string,
): Promise<void> {
  return impl.assertRejects(fn, errorClassOrMsg, msgIncludesOrMsg, msg);
}

/**
 * Asserts that `actual` string includes the `expected` substring.
 */
export function assertStringIncludes(actual: string, expected: string, msg?: string): void {
  impl.assertStringIncludes(actual, expected, msg);
}

/**
 * Asserts that `actual` string matches the `expected` RegExp.
 */
export function assertMatch(actual: string, expected: RegExp, msg?: string): void {
  impl.assertMatch(actual, expected, msg);
}

/**
 * Asserts that `actual` is an instance of `expectedType`.
 */
// deno-lint-ignore no-explicit-any
export function assertInstanceOf<T>(
  actual: unknown,
  expectedType: abstract new (...args: any[]) => T,
  msg?: string,
): asserts actual is T {
  impl.assertInstanceOf(actual, expectedType, msg);
}

/**
 * Fails the test with an optional message.
 */
export function fail(msg?: string): never {
  impl.fail(msg);
}

/**
 * Asserts that `actual` is not strictly equal to `expected` (using !==).
 */
export function assertNotStrictEquals<T>(actual: T, expected: T, msg?: string): void {
  impl.assertNotStrictEquals(actual, expected, msg);
}

/**
 * Asserts that `actual` object contains all properties from `expected` with matching values.
 */
// deno-lint-ignore no-explicit-any
export function assertObjectMatch(
  actual: Record<string, any>,
  expected: Record<string, any>,
  msg?: string,
): void {
  impl.assertObjectMatch(actual, expected, msg);
}

/**
 * Asserts that `actual` is greater than `expected`.
 */
export function assertGreater(actual: number, expected: number, msg?: string): void {
  impl.assertGreater(actual, expected, msg);
}

/**
 * Asserts that `actual` is greater than or equal to `expected`.
 */
export function assertGreaterOrEqual(actual: number, expected: number, msg?: string): void {
  impl.assertGreaterOrEqual(actual, expected, msg);
}

/**
 * Asserts that `actual` is less than `expected`.
 */
export function assertLess(actual: number, expected: number, msg?: string): void {
  impl.assertLess(actual, expected, msg);
}

/**
 * Asserts that `actual` is less than or equal to `expected`.
 */
export function assertLessOrEqual(actual: number, expected: number, msg?: string): void {
  impl.assertLessOrEqual(actual, expected, msg);
}
