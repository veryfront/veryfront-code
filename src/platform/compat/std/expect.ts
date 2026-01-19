/**
 * Portable @std/expect shim for Node.js and Bun.
 *
 * In Deno: Uses @std/expect
 * In Node.js/Bun: Provides Jest-like expect() wrapper around node:assert
 *
 * @module
 */

import { isBun, isDeno } from "../runtime.ts";
import { deepEquals, safeStringify } from "#veryfront/testing/utils.ts";

// ============================================================================
// Types
// ============================================================================

/** Async matchers for promise resolution/rejection */
interface AsyncMatchers<T> {
  toBe(expected: T): Promise<void>;
  toEqual(expected: T): Promise<void>;
  toStrictEqual(expected: T): Promise<void>;
  toBeTruthy(): Promise<void>;
  toBeFalsy(): Promise<void>;
  toBeNull(): Promise<void>;
  toBeUndefined(): Promise<void>;
  toBeDefined(): Promise<void>;
  toBeInstanceOf(expected: new (...args: unknown[]) => unknown): Promise<void>;
  toContain(expected: unknown): Promise<void>;
  toHaveLength(expected: number): Promise<void>;
  toMatch(expected: string | RegExp): Promise<void>;
  toThrow(expected?: string | RegExp | Error | (new (...args: unknown[]) => Error)): Promise<void>;
  not: AsyncMatchers<T>;
}

interface Matchers<T> {
  toBe(expected: T): void;
  toEqual(expected: T): void;
  toStrictEqual(expected: T): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeNaN(): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toBeCloseTo(expected: number, precision?: number): void;
  toBeInstanceOf(expected: new (...args: unknown[]) => unknown): void;
  toContain(expected: unknown): void;
  toContainEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
  toHaveProperty(keyPath: string | string[], value?: unknown): void;
  toMatch(expected: string | RegExp): void;
  toMatchObject(expected: Record<string, unknown>): void;
  toThrow(expected?: string | RegExp | Error | (new (...args: unknown[]) => Error)): void;
  toThrowError(expected?: string | RegExp | Error | (new (...args: unknown[]) => Error)): void;
  resolves: AsyncMatchers<Awaited<T>>;
  rejects: AsyncMatchers<unknown>;
  not: Matchers<T>;
}

// Type for external expect libraries that may have different signatures
// deno-lint-ignore no-explicit-any
type ExternalExpectFn = (actual: any) => any;

// deno-lint-ignore no-explicit-any
type ExpectFn = <T>(actual: T) => Matchers<T> & Record<string, any>;

// ============================================================================
// Node.js/Bun implementation
// ============================================================================

function createNodeExpect(): ExpectFn {
  function createMatchers<T>(actual: T, isNot = false, isAsync = false): Matchers<T> {
    const check = (condition: boolean, message: string) => {
      const result = isNot ? !condition : condition;
      if (!result) {
        throw new Error(message);
      }
    };

    const matchers: Matchers<T> = {
      toBe(expected: T) {
        check(
          Object.is(actual, expected),
          isNot
            ? `Expected ${safeStringify(actual)} not to be ${safeStringify(expected)}`
            : `Expected ${safeStringify(actual)} to be ${safeStringify(expected)}`,
        );
      },

      toEqual(expected: T) {
        check(
          deepEquals(actual, expected),
          isNot
            ? `Expected ${safeStringify(actual)} not to equal ${safeStringify(expected)}`
            : `Expected ${safeStringify(actual)} to equal ${safeStringify(expected)}`,
        );
      },

      toStrictEqual(expected: T) {
        check(
          deepEquals(actual, expected),
          isNot
            ? `Expected ${safeStringify(actual)} not to strictly equal ${safeStringify(expected)}`
            : `Expected ${safeStringify(actual)} to strictly equal ${safeStringify(expected)}`,
        );
      },

      toBeTruthy() {
        check(
          Boolean(actual),
          isNot
            ? `Expected ${safeStringify(actual)} not to be truthy`
            : `Expected ${safeStringify(actual)} to be truthy`,
        );
      },

      toBeFalsy() {
        check(
          !actual,
          isNot
            ? `Expected ${safeStringify(actual)} not to be falsy`
            : `Expected ${safeStringify(actual)} to be falsy`,
        );
      },

      toBeNull() {
        check(
          actual === null,
          isNot
            ? `Expected ${safeStringify(actual)} not to be null`
            : `Expected ${safeStringify(actual)} to be null`,
        );
      },

      toBeUndefined() {
        check(
          actual === undefined,
          isNot
            ? `Expected ${safeStringify(actual)} not to be undefined`
            : `Expected ${safeStringify(actual)} to be undefined`,
        );
      },

      toBeDefined() {
        check(
          actual !== undefined,
          isNot
            ? `Expected ${safeStringify(actual)} not to be defined`
            : `Expected ${safeStringify(actual)} to be defined`,
        );
      },

      toBeNaN() {
        check(
          Number.isNaN(actual),
          isNot
            ? `Expected ${safeStringify(actual)} not to be NaN`
            : `Expected ${safeStringify(actual)} to be NaN`,
        );
      },

      toBeGreaterThan(expected: number) {
        check(
          (actual as number) > expected,
          isNot
            ? `Expected ${actual} not to be greater than ${expected}`
            : `Expected ${actual} to be greater than ${expected}`,
        );
      },

      toBeGreaterThanOrEqual(expected: number) {
        check(
          (actual as number) >= expected,
          isNot
            ? `Expected ${actual} not to be greater than or equal to ${expected}`
            : `Expected ${actual} to be greater than or equal to ${expected}`,
        );
      },

      toBeLessThan(expected: number) {
        check(
          (actual as number) < expected,
          isNot
            ? `Expected ${actual} not to be less than ${expected}`
            : `Expected ${actual} to be less than ${expected}`,
        );
      },

      toBeLessThanOrEqual(expected: number) {
        check(
          (actual as number) <= expected,
          isNot
            ? `Expected ${actual} not to be less than or equal to ${expected}`
            : `Expected ${actual} to be less than or equal to ${expected}`,
        );
      },

      toBeCloseTo(expected: number, precision = 2) {
        const diff = Math.abs((actual as number) - expected);
        const threshold = Math.pow(10, -precision) / 2;
        check(
          diff < threshold,
          isNot
            ? `Expected ${actual} not to be close to ${expected} (precision: ${precision})`
            : `Expected ${actual} to be close to ${expected} (precision: ${precision})`,
        );
      },

      toBeInstanceOf(expected: new (...args: unknown[]) => unknown) {
        check(
          actual instanceof expected,
          isNot
            ? `Expected ${actual} not to be an instance of ${expected.name}`
            : `Expected ${actual} to be an instance of ${expected.name}`,
        );
      },

      toContain(expected: unknown) {
        let contains = false;
        if (Array.isArray(actual)) {
          contains = actual.includes(expected);
        } else if (typeof actual === "string") {
          contains = actual.includes(expected as string);
        }
        check(
          contains,
          isNot
            ? `Expected ${safeStringify(actual)} not to contain ${safeStringify(expected)}`
            : `Expected ${safeStringify(actual)} to contain ${safeStringify(expected)}`,
        );
      },

      toContainEqual(expected: unknown) {
        const contains = Array.isArray(actual) &&
          actual.some((item) => deepEquals(item, expected));
        check(
          contains,
          isNot
            ? `Expected ${safeStringify(actual)} not to contain equal ${safeStringify(expected)}`
            : `Expected ${safeStringify(actual)} to contain equal ${safeStringify(expected)}`,
        );
      },

      toHaveLength(expected: number) {
        const length = (actual as unknown[] | string).length;
        check(
          length === expected,
          isNot
            ? `Expected length not to be ${expected}, but got ${length}`
            : `Expected length to be ${expected}, but got ${length}`,
        );
      },

      toHaveProperty(keyPath: string | string[], value?: unknown) {
        const keys = Array.isArray(keyPath) ? keyPath : keyPath.split(".");
        let current: unknown = actual;
        let hasProperty = true;

        for (const key of keys) {
          if (current && typeof current === "object" && key in (current as object)) {
            current = (current as Record<string, unknown>)[key];
          } else {
            hasProperty = false;
            break;
          }
        }

        if (value !== undefined && hasProperty) {
          hasProperty = deepEquals(current, value);
        }

        check(
          hasProperty,
          isNot
            ? `Expected ${safeStringify(actual)} not to have property ${JSON.stringify(keyPath)}`
            : `Expected ${safeStringify(actual)} to have property ${JSON.stringify(keyPath)}`,
        );
      },

      toMatch(expected: string | RegExp) {
        const matches = typeof expected === "string"
          ? (actual as string).includes(expected)
          : expected.test(actual as string);
        check(
          matches,
          isNot
            ? `Expected "${actual}" not to match ${expected}`
            : `Expected "${actual}" to match ${expected}`,
        );
      },

      toMatchObject(expected: Record<string, unknown>) {
        const actualObj = actual as Record<string, unknown>;
        const matches = Object.keys(expected).every((key) =>
          deepEquals(actualObj[key], expected[key])
        );
        check(
          matches,
          isNot
            ? `Expected ${safeStringify(actual)} not to match object ${safeStringify(expected)}`
            : `Expected ${safeStringify(actual)} to match object ${safeStringify(expected)}`,
        );
      },

      toThrow(expected?: string | RegExp | Error | (new (...args: unknown[]) => Error)) {
        let threw = false;
        let thrownError: unknown;

        try {
          (actual as () => void)();
        } catch (e) {
          threw = true;
          thrownError = e;
        }

        if (expected === undefined) {
          check(threw, isNot ? `Expected function not to throw` : `Expected function to throw`);
        } else if (typeof expected === "string") {
          check(
            threw && thrownError instanceof Error && thrownError.message.includes(expected),
            isNot
              ? `Expected function not to throw with message "${expected}"`
              : `Expected function to throw with message "${expected}"`,
          );
        } else if (expected instanceof RegExp) {
          check(
            threw && thrownError instanceof Error && expected.test(thrownError.message),
            isNot
              ? `Expected function not to throw matching ${expected}`
              : `Expected function to throw matching ${expected}`,
          );
        } else if (expected instanceof Error) {
          check(
            threw && thrownError instanceof Error && thrownError.message === expected.message,
            isNot
              ? `Expected function not to throw ${expected}`
              : `Expected function to throw ${expected}`,
          );
        } else {
          check(
            threw && thrownError instanceof expected,
            isNot
              ? `Expected function not to throw ${expected.name}`
              : `Expected function to throw ${expected.name}`,
          );
        }
      },

      toThrowError(expected?: string | RegExp | Error | (new (...args: unknown[]) => Error)) {
        matchers.toThrow(expected);
      },

      get resolves(): AsyncMatchers<Awaited<T>> {
        const promiseMatchers: AsyncMatchers<Awaited<T>> = {
          async toBe(expected: Awaited<T>) {
            const result = await (actual as Promise<Awaited<T>>);
            createMatchers(result, isNot).toBe(expected);
          },
          async toEqual(expected: Awaited<T>) {
            const result = await (actual as Promise<Awaited<T>>);
            createMatchers(result, isNot).toEqual(expected);
          },
          async toStrictEqual(expected: Awaited<T>) {
            const result = await (actual as Promise<Awaited<T>>);
            createMatchers(result, isNot).toStrictEqual(expected);
          },
          async toBeTruthy() {
            const result = await (actual as Promise<Awaited<T>>);
            createMatchers(result, isNot).toBeTruthy();
          },
          async toBeFalsy() {
            const result = await (actual as Promise<Awaited<T>>);
            createMatchers(result, isNot).toBeFalsy();
          },
          async toBeNull() {
            const result = await (actual as Promise<Awaited<T>>);
            createMatchers(result, isNot).toBeNull();
          },
          async toBeUndefined() {
            const result = await (actual as Promise<Awaited<T>>);
            createMatchers(result, isNot).toBeUndefined();
          },
          async toBeDefined() {
            const result = await (actual as Promise<Awaited<T>>);
            createMatchers(result, isNot).toBeDefined();
          },
          async toBeInstanceOf(expected: new (...args: unknown[]) => unknown) {
            const result = await (actual as Promise<Awaited<T>>);
            createMatchers(result, isNot).toBeInstanceOf(expected);
          },
          async toContain(expected: unknown) {
            const result = await (actual as Promise<Awaited<T>>);
            createMatchers(result, isNot).toContain(expected);
          },
          async toHaveLength(expected: number) {
            const result = await (actual as Promise<Awaited<T>>);
            createMatchers(result, isNot).toHaveLength(expected);
          },
          async toMatch(expected: string | RegExp) {
            const result = await (actual as Promise<Awaited<T>>);
            createMatchers(result, isNot).toMatch(expected);
          },
          async toThrow() {
            // For resolves.toThrow - expect the resolved value to throw when called
            const result = await (actual as Promise<Awaited<T>>);
            createMatchers(result, isNot).toThrow();
          },
          get not(): AsyncMatchers<Awaited<T>> {
            return createMatchers(actual, !isNot).resolves;
          },
        };
        return promiseMatchers;
      },

      get rejects(): AsyncMatchers<unknown> {
        const rejectMatchers: AsyncMatchers<unknown> = {
          async toBe(expected: unknown) {
            try {
              await (actual as Promise<unknown>);
              if (!isNot) throw new Error(`Expected promise to reject`);
            } catch (e) {
              if (isNot) {
                if (Object.is(e, expected)) {
                  throw new Error(`Expected promise not to reject with ${safeStringify(expected)}`);
                }
              } else if (!Object.is(e, expected)) {
                throw new Error(
                  `Expected promise to reject with ${safeStringify(expected)}, got ${
                    safeStringify(e)
                  }`,
                );
              }
            }
          },
          async toEqual(expected: unknown) {
            try {
              await (actual as Promise<unknown>);
              if (!isNot) throw new Error(`Expected promise to reject`);
            } catch (e) {
              if (isNot) {
                if (deepEquals(e, expected)) {
                  throw new Error(`Expected promise not to reject with ${safeStringify(expected)}`);
                }
              } else if (!deepEquals(e, expected)) {
                throw new Error(
                  `Expected promise to reject with ${safeStringify(expected)}, got ${
                    safeStringify(e)
                  }`,
                );
              }
            }
          },
          async toStrictEqual(expected: unknown) {
            await rejectMatchers.toEqual(expected);
          },
          async toBeTruthy() {
            try {
              await (actual as Promise<unknown>);
              if (!isNot) throw new Error(`Expected promise to reject`);
            } catch (e) {
              if (isNot && e) {
                throw new Error(`Expected promise not to reject with truthy value`);
              } else if (!isNot && !e) {
                throw new Error(`Expected promise to reject with truthy value`);
              }
            }
          },
          async toBeFalsy() {
            try {
              await (actual as Promise<unknown>);
              if (!isNot) throw new Error(`Expected promise to reject`);
            } catch (e) {
              if (isNot && !e) {
                throw new Error(`Expected promise not to reject with falsy value`);
              } else if (!isNot && e) {
                throw new Error(`Expected promise to reject with falsy value`);
              }
            }
          },
          async toBeNull() {
            try {
              await (actual as Promise<unknown>);
              if (!isNot) throw new Error(`Expected promise to reject`);
            } catch (e) {
              if (isNot && e === null) {
                throw new Error(`Expected promise not to reject with null`);
              } else if (!isNot && e !== null) {
                throw new Error(`Expected promise to reject with null`);
              }
            }
          },
          async toBeUndefined() {
            try {
              await (actual as Promise<unknown>);
              if (!isNot) throw new Error(`Expected promise to reject`);
            } catch (e) {
              if (isNot && e === undefined) {
                throw new Error(`Expected promise not to reject with undefined`);
              } else if (!isNot && e !== undefined) {
                throw new Error(`Expected promise to reject with undefined`);
              }
            }
          },
          async toBeDefined() {
            try {
              await (actual as Promise<unknown>);
              if (!isNot) throw new Error(`Expected promise to reject`);
            } catch (e) {
              if (isNot && e !== undefined) {
                throw new Error(`Expected promise not to reject with defined value`);
              } else if (!isNot && e === undefined) {
                throw new Error(`Expected promise to reject with defined value`);
              }
            }
          },
          async toBeInstanceOf(expected: new (...args: unknown[]) => unknown) {
            try {
              await (actual as Promise<unknown>);
              if (!isNot) throw new Error(`Expected promise to reject`);
            } catch (e) {
              if (isNot && e instanceof expected) {
                throw new Error(`Expected promise not to reject with instance of ${expected.name}`);
              } else if (!isNot && !(e instanceof expected)) {
                throw new Error(`Expected promise to reject with instance of ${expected.name}`);
              }
            }
          },
          async toContain(expected: unknown) {
            try {
              await (actual as Promise<unknown>);
              if (!isNot) throw new Error(`Expected promise to reject`);
            } catch (e) {
              const contains = typeof e === "string" && e.includes(expected as string);
              if (isNot && contains) {
                throw new Error(
                  `Expected promise not to reject containing ${safeStringify(expected)}`,
                );
              } else if (!isNot && !contains) {
                throw new Error(`Expected promise to reject containing ${safeStringify(expected)}`);
              }
            }
          },
          async toHaveLength(expected: number) {
            try {
              await (actual as Promise<unknown>);
              if (!isNot) throw new Error(`Expected promise to reject`);
            } catch (e) {
              const length = (e as { length?: number })?.length;
              if (isNot && length === expected) {
                throw new Error(`Expected rejected value not to have length ${expected}`);
              } else if (!isNot && length !== expected) {
                throw new Error(
                  `Expected rejected value to have length ${expected}, got ${length}`,
                );
              }
            }
          },
          async toMatch(expected: string | RegExp) {
            try {
              await (actual as Promise<unknown>);
              if (!isNot) throw new Error(`Expected promise to reject`);
            } catch (e) {
              const str = e instanceof Error ? e.message : String(e);
              const matches = typeof expected === "string"
                ? str.includes(expected)
                : expected.test(str);
              if (isNot && matches) {
                throw new Error(`Expected promise not to reject matching ${expected}`);
              } else if (!isNot && !matches) {
                throw new Error(`Expected promise to reject matching ${expected}`);
              }
            }
          },
          async toThrow(expected?: string | RegExp | Error | (new (...args: unknown[]) => Error)) {
            let threw = false;
            let thrownError: unknown;

            try {
              await (actual as Promise<unknown>);
            } catch (e) {
              threw = true;
              thrownError = e;
            }

            if (expected === undefined) {
              if (!(isNot ? !threw : threw)) {
                throw new Error(
                  isNot ? `Expected promise not to reject` : `Expected promise to reject`,
                );
              }
            } else if (typeof expected === "string") {
              const matches = threw && thrownError instanceof Error &&
                thrownError.message.includes(expected);
              if (isNot && matches) {
                throw new Error(`Expected promise not to reject with message "${expected}"`);
              } else if (!isNot && !matches) {
                throw new Error(`Expected promise to reject with message "${expected}"`);
              }
            } else if (expected instanceof RegExp) {
              const matches = threw && thrownError instanceof Error &&
                expected.test(thrownError.message);
              if (isNot && matches) {
                throw new Error(`Expected promise not to reject matching ${expected}`);
              } else if (!isNot && !matches) {
                throw new Error(`Expected promise to reject matching ${expected}`);
              }
            } else if (expected instanceof Error) {
              const matches = threw && thrownError instanceof Error &&
                thrownError.message === expected.message;
              if (isNot && matches) {
                throw new Error(`Expected promise not to reject with ${expected.message}`);
              } else if (!isNot && !matches) {
                throw new Error(`Expected promise to reject with ${expected.message}`);
              }
            } else {
              const matches = threw && thrownError instanceof expected;
              if (isNot && matches) {
                throw new Error(`Expected promise not to reject with ${expected.name}`);
              } else if (!isNot && !matches) {
                throw new Error(`Expected promise to reject with ${expected.name}`);
              }
            }
          },
          get not(): AsyncMatchers<unknown> {
            return createMatchers(actual, !isNot).rejects;
          },
        };
        return rejectMatchers;
      },

      get not(): Matchers<T> {
        return createMatchers(actual, !isNot, isAsync);
      },
    };

    return matchers;
  }

  return <T>(actual: T): Matchers<T> => createMatchers(actual);
}

// ============================================================================
// Export
// ============================================================================

let expect: ExpectFn;

if (isDeno) {
  // Deno: Use @std/expect
  const stdExpect = await import("#std/expect.ts");
  // Cast to our ExpectFn type - @std/expect is compatible at runtime
  expect = stdExpect.expect as unknown as ExpectFn;
} else if (isBun) {
  // Bun: Use bun:test expect
  // Use Function constructor to prevent Deno/Node from statically analyzing the import
  const importBunTest = new Function("return import('bun:test')") as () => Promise<{
    expect?: ExternalExpectFn;
    default?: { expect?: ExternalExpectFn };
  }>;
  const bunTestModule = await importBunTest();
  // Bun exports expect directly, not under .default
  const bunExpect = bunTestModule.expect ?? bunTestModule.default?.expect;
  expect = bunExpect as unknown as ExpectFn;
} else {
  // Node.js: Use our wrapper
  expect = createNodeExpect();
}

export { expect };
