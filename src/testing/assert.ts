import "./init.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { deepEquals, safeStringify } from "./utils.ts";

// deno-lint-ignore no-explicit-any -- any[] required: constructor params are contravariant
/** Public API contract for error class. */
export type ErrorClass<E extends Error = Error> = abstract new (...args: any[]) => E;

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
    fn: () => PromiseLike<unknown>,
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
    actual: Record<PropertyKey, unknown>,
    expected: Record<PropertyKey, unknown>,
    msg?: string,
  ): void;
  assertGreater(actual: number, expected: number, msg?: string): void;
  assertGreaterOrEqual(actual: number, expected: number, msg?: string): void;
  assertLess(actual: number, expected: number, msg?: string): void;
  assertLessOrEqual(actual: number, expected: number, msg?: string): void;
}

type ObjectMatchState = {
  comparisons: number;
  depth: number;
  seen: Map<object, object>;
};

const MAX_OBJECT_MATCH_COMPARISONS = 100_000;
const MAX_OBJECT_MATCH_DEPTH = 512;
const MAP_SIZE_GETTER = Object.getOwnPropertyDescriptor(Map.prototype, "size")?.get;
const SET_SIZE_GETTER = Object.getOwnPropertyDescriptor(Set.prototype, "size")?.get;

class AssertionError extends Error {
  override name = "AssertionError";
}

function createNodeAssertImpl(): AssertImpl {
  function assertErrorMessageIncludes(error: unknown, includes?: string): void {
    if (!includes) return;
    if (!(error instanceof Error)) {
      throw new AssertionError("Expected an Error object when checking its message");
    }

    if (error.message.includes(includes)) return;
    throw new AssertionError(
      `Expected error message to include "${includes}", got "${error.message}"`,
    );
  }

  function assertThrowsOrRejects(
    threw: boolean,
    error: unknown,
    errorClassOrMsg?: ErrorClass | string,
    msgIncludesOrMsg?: string,
    defaultMsg?: string,
    msg?: string,
  ): unknown {
    if (!threw) {
      const detail = typeof errorClassOrMsg === "string" ? errorClassOrMsg : msg;
      throw new AssertionError(detail ? `${defaultMsg}: ${detail}` : defaultMsg);
    }

    if (typeof errorClassOrMsg !== "function") return error;

    if (!(error instanceof errorClassOrMsg)) {
      const detail = `Expected error to be instance of ${errorClassOrMsg.name}, got ${
        (error as Error | undefined)?.name ?? typeof error
      }`;
      throw new AssertionError(
        msg ? `${detail}: ${msg}` : detail,
      );
    }

    try {
      assertErrorMessageIncludes(error, msgIncludesOrMsg);
    } catch (messageError) {
      if (!msg || !(messageError instanceof Error)) throw messageError;
      throw new AssertionError(`${messageError.message}: ${msg}`);
    }
    return error;
  }

  function objectMatchesSubset(
    actual: unknown,
    expected: unknown,
    state: ObjectMatchState = { comparisons: 0, depth: 0, seen: new Map() },
  ): boolean {
    state.comparisons++;
    if (
      state.comparisons > MAX_OBJECT_MATCH_COMPARISONS ||
      state.depth >= MAX_OBJECT_MATCH_DEPTH
    ) {
      return false;
    }

    state.depth++;
    try {
      return objectMatchesSubsetAtDepth(actual, expected, state);
    } finally {
      state.depth--;
    }
  }

  function objectMatchesSubsetAtDepth(
    actual: unknown,
    expected: unknown,
    state: ObjectMatchState,
  ): boolean {
    if (Object.is(actual, expected)) return true;
    if (
      actual === null || expected === null || typeof actual !== "object" ||
      typeof expected !== "object"
    ) {
      return false;
    }

    const priorActual = state.seen.get(expected);
    if (priorActual) return priorActual === actual;
    state.seen.set(expected, actual);

    if (
      expected instanceof Date || expected instanceof RegExp || expected instanceof Error ||
      ArrayBuffer.isView(expected)
    ) {
      return deepEquals(actual, expected);
    }
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual) || actual.length < expected.length) return false;
      for (let index = 0; index < expected.length; index++) {
        if (!objectMatchesSubset(actual[index], expected[index], state)) return false;
      }
      return true;
    }
    if (expected instanceof Map) {
      if (!(actual instanceof Map) || !MAP_SIZE_GETTER) return false;
      try {
        const actualSize = Reflect.apply(MAP_SIZE_GETTER, actual, []) as number;
        const expectedSize = Reflect.apply(MAP_SIZE_GETTER, expected, []) as number;
        if (actualSize < expectedSize) return false;
        const expectedEntries = Reflect.apply(Map.prototype.entries, expected, []) as MapIterator<[
          unknown,
          unknown,
        ]>;
        for (const [expectedKey, expectedValue] of expectedEntries) {
          const hasKey = Reflect.apply(Map.prototype.has, actual, [expectedKey]) as boolean;
          if (!hasKey) return false;
          const actualValue = Reflect.apply(Map.prototype.get, actual, [expectedKey]);
          if (!objectMatchesSubset(actualValue, expectedValue, state)) return false;
        }
        return true;
      } catch {
        return false;
      }
    }
    if (expected instanceof Set) {
      if (!(actual instanceof Set) || !SET_SIZE_GETTER) return false;
      try {
        const actualSize = Reflect.apply(SET_SIZE_GETTER, actual, []) as number;
        const expectedSize = Reflect.apply(SET_SIZE_GETTER, expected, []) as number;
        if (expectedSize > actualSize) return false;
        const expectedValues = Reflect.apply(Set.prototype.values, expected, []) as SetIterator<
          unknown
        >;
        for (const expectedValue of expectedValues) {
          if (!Reflect.apply(Set.prototype.has, actual, [expectedValue])) return false;
        }
        return true;
      } catch {
        return false;
      }
    }

    let expectedKeys: PropertyKey[];
    try {
      expectedKeys = Reflect.ownKeys(expected);
    } catch {
      return false;
    }

    return expectedKeys.every((key) => {
      try {
        return Object.hasOwn(actual, key) &&
          objectMatchesSubset(Reflect.get(actual, key), Reflect.get(expected, key), state);
      } catch {
        return false;
      }
    });
  }

  function assertObjectMatch(
    actual: Record<PropertyKey, unknown>,
    expected: Record<PropertyKey, unknown>,
    msg?: string,
  ): void {
    if (objectMatchesSubset(actual, expected)) return;
    throw new AssertionError(
      msg || `Expected ${safeStringify(actual)} to contain ${safeStringify(expected)}`,
    );
  }

  return {
    assertEquals<T>(actual: T, expected: T, msg?: string): void {
      if (deepEquals(actual, expected)) return;
      throw new AssertionError(
        msg || `Expected ${safeStringify(expected)}, got ${safeStringify(actual)}`,
      );
    },

    assertNotEquals<T>(actual: T, expected: T, msg?: string): void {
      if (!deepEquals(actual, expected)) return;
      throw new AssertionError(msg || `Expected values to not be equal: ${safeStringify(actual)}`);
    },

    assertStrictEquals<T>(actual: T, expected: T, msg?: string): void {
      if (Object.is(actual, expected)) return;
      throw new AssertionError(
        msg || `Expected ${safeStringify(expected)}, got ${safeStringify(actual)}`,
      );
    },

    assert(expr: unknown, msg?: string): void {
      if (expr) return;
      throw new AssertionError(msg || "Assertion failed: expected truthy value");
    },

    assertExists<T>(actual: T, msg?: string): void {
      if (actual !== null && actual !== undefined) return;
      throw new AssertionError(
        msg || `Expected value to exist, but got ${safeStringify(actual)}`,
      );
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

      return assertThrowsOrRejects(
        threw,
        error,
        errorClassOrMsg,
        msgIncludesOrMsg,
        "Expected function to throw",
        _msg,
      );
    },

    async assertRejects(
      fn: () => PromiseLike<unknown>,
      errorClassOrMsg?: ErrorClass | string,
      msgIncludesOrMsg?: string,
      _msg?: string,
    ): Promise<unknown> {
      let promise: PromiseLike<unknown>;

      try {
        const result = fn();
        if (
          !result || (typeof result !== "object" && typeof result !== "function") ||
          typeof result.then !== "function"
        ) {
          throw new TypeError("Expected a promise-like result");
        }
        promise = result;
      } catch {
        throw new AssertionError(
          _msg
            ? `Function throws when expected to reject: ${_msg}`
            : "Function throws when expected to reject",
        );
      }

      try {
        await promise;
      } catch (error) {
        return assertThrowsOrRejects(
          true,
          error,
          errorClassOrMsg,
          msgIncludesOrMsg,
          "Expected function to reject",
          _msg,
        );
      }

      return assertThrowsOrRejects(
        false,
        undefined,
        errorClassOrMsg,
        msgIncludesOrMsg,
        "Expected function to reject",
        _msg,
      );
    },

    assertStringIncludes(actual: string, expected: string, msg?: string): void {
      if (actual.includes(expected)) return;
      throw new AssertionError(msg || `Expected "${actual}" to include "${expected}"`);
    },

    assertMatch(actual: string, expected: RegExp, msg?: string): void {
      if (expected.test(actual)) return;
      throw new AssertionError(msg || `Expected "${actual}" to match ${expected}`);
    },

    assertInstanceOf<T>(
      actual: unknown,
      expectedType: new (...args: unknown[]) => T,
      msg?: string,
    ): void {
      if (actual instanceof expectedType) return;
      throw new AssertionError(
        msg || `Expected instance of ${expectedType.name}, got ${typeof actual}`,
      );
    },

    fail(msg?: string): never {
      throw new AssertionError(msg || "Test failed");
    },

    assertNotStrictEquals<T>(actual: T, expected: T, msg?: string): void {
      if (!Object.is(actual, expected)) return;
      throw new AssertionError(msg || "Expected values to not be strictly equal");
    },

    assertObjectMatch,

    assertGreater(actual: number, expected: number, msg?: string): void {
      if (actual > expected) return;
      throw new AssertionError(msg || `Expected ${actual} to be greater than ${expected}`);
    },

    assertGreaterOrEqual(actual: number, expected: number, msg?: string): void {
      if (actual >= expected) return;
      throw new AssertionError(
        msg || `Expected ${actual} to be greater than or equal to ${expected}`,
      );
    },

    assertLess(actual: number, expected: number, msg?: string): void {
      if (actual < expected) return;
      throw new AssertionError(msg || `Expected ${actual} to be less than ${expected}`);
    },

    assertLessOrEqual(actual: number, expected: number, msg?: string): void {
      if (actual <= expected) return;
      throw new AssertionError(msg || `Expected ${actual} to be less than or equal to ${expected}`);
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

/** Assert that a synchronous function throws. */
export function assertThrows(
  fn: () => unknown,
  msg?: string,
): unknown;
/** Assert that a synchronous function throws the expected error type and message. */
export function assertThrows<E extends Error = Error>(
  fn: () => unknown,
  errorClass: ErrorClass<E>,
  msgIncludes?: string,
  msg?: string,
): E;
/** Assert that a synchronous function throws. */
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
  fn: () => PromiseLike<unknown>,
  msg?: string,
): Promise<unknown>;
/** Assert that an async function rejects with the expected error type and message. */
export function assertRejects<E extends Error = Error>(
  fn: () => PromiseLike<unknown>,
  errorClass: ErrorClass<E>,
  msgIncludes?: string,
  msg?: string,
): Promise<E>;
/** Assert that an async function rejects. */
export function assertRejects(
  fn: () => PromiseLike<unknown>,
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
  actual: Record<PropertyKey, unknown>,
  expected: Record<PropertyKey, unknown>,
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
