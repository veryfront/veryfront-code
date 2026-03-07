import { isBun, isDeno } from "../runtime.ts";
import { deepEquals, safeStringify } from "#veryfront/testing/utils.ts";

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

type ExternalExpectFn = (actual: unknown) => unknown;
// deno-lint-ignore no-explicit-any -- external matchers (Deno std, Bun) may expose additional methods beyond our Matchers<T> interface
type ExpectFn = <T>(actual: T) => Matchers<T> & Record<string, any>;

function createNodeExpect(): ExpectFn {
  function createMatchers<T>(actual: T, isNot = false): Matchers<T> {
    function check(condition: boolean, message: string): void {
      const result = isNot ? !condition : condition;
      if (!result) throw new Error(message);
    }

    function getMessage(positive: string, negative: string): string {
      return isNot ? negative : positive;
    }

    function assertDeepEquality(expected: T, comparison: "equal" | "strictly equal"): void {
      check(
        deepEquals(actual, expected),
        getMessage(
          `Expected ${safeStringify(actual)} to ${comparison} ${safeStringify(expected)}`,
          `Expected ${safeStringify(actual)} not to ${comparison} ${safeStringify(expected)}`,
        ),
      );
    }

    function getRejection(): Promise<{ rejected: boolean; error: unknown }> {
      return (async () => {
        try {
          await (actual as Promise<unknown>);
          return { rejected: false, error: undefined };
        } catch (e) {
          return { rejected: true, error: e };
        }
      })();
    }

    const matchers: Matchers<T> = {
      toBe(expected: T) {
        check(
          Object.is(actual, expected),
          getMessage(
            `Expected ${safeStringify(actual)} to be ${safeStringify(expected)}`,
            `Expected ${safeStringify(actual)} not to be ${safeStringify(expected)}`,
          ),
        );
      },

      toEqual(expected: T) {
        assertDeepEquality(expected, "equal");
      },

      toStrictEqual(expected: T) {
        assertDeepEquality(expected, "strictly equal");
      },

      toBeTruthy() {
        check(
          Boolean(actual),
          getMessage(
            `Expected ${safeStringify(actual)} to be truthy`,
            `Expected ${safeStringify(actual)} not to be truthy`,
          ),
        );
      },

      toBeFalsy() {
        check(
          !actual,
          getMessage(
            `Expected ${safeStringify(actual)} to be falsy`,
            `Expected ${safeStringify(actual)} not to be falsy`,
          ),
        );
      },

      toBeNull() {
        check(
          actual === null,
          getMessage(
            `Expected ${safeStringify(actual)} to be null`,
            `Expected ${safeStringify(actual)} not to be null`,
          ),
        );
      },

      toBeUndefined() {
        check(
          actual === undefined,
          getMessage(
            `Expected ${safeStringify(actual)} to be undefined`,
            `Expected ${safeStringify(actual)} not to be undefined`,
          ),
        );
      },

      toBeDefined() {
        check(
          actual !== undefined,
          getMessage(
            `Expected ${safeStringify(actual)} to be defined`,
            `Expected ${safeStringify(actual)} not to be defined`,
          ),
        );
      },

      toBeNaN() {
        check(
          Number.isNaN(actual),
          getMessage(
            `Expected ${safeStringify(actual)} to be NaN`,
            `Expected ${safeStringify(actual)} not to be NaN`,
          ),
        );
      },

      toBeGreaterThan(expected: number) {
        check(
          (actual as number) > expected,
          getMessage(
            `Expected ${actual} to be greater than ${expected}`,
            `Expected ${actual} not to be greater than ${expected}`,
          ),
        );
      },

      toBeGreaterThanOrEqual(expected: number) {
        check(
          (actual as number) >= expected,
          getMessage(
            `Expected ${actual} to be greater than or equal to ${expected}`,
            `Expected ${actual} not to be greater than or equal to ${expected}`,
          ),
        );
      },

      toBeLessThan(expected: number) {
        check(
          (actual as number) < expected,
          getMessage(
            `Expected ${actual} to be less than ${expected}`,
            `Expected ${actual} not to be less than ${expected}`,
          ),
        );
      },

      toBeLessThanOrEqual(expected: number) {
        check(
          (actual as number) <= expected,
          getMessage(
            `Expected ${actual} to be less than or equal to ${expected}`,
            `Expected ${actual} not to be less than or equal to ${expected}`,
          ),
        );
      },

      toBeCloseTo(expected: number, precision = 2) {
        const diff = Math.abs((actual as number) - expected);
        const threshold = Math.pow(10, -precision) / 2;
        check(
          diff < threshold,
          getMessage(
            `Expected ${actual} to be close to ${expected} (precision: ${precision})`,
            `Expected ${actual} not to be close to ${expected} (precision: ${precision})`,
          ),
        );
      },

      toBeInstanceOf(expected: new (...args: unknown[]) => unknown) {
        check(
          actual instanceof expected,
          getMessage(
            `Expected ${actual} to be an instance of ${expected.name}`,
            `Expected ${actual} not to be an instance of ${expected.name}`,
          ),
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
          getMessage(
            `Expected ${safeStringify(actual)} to contain ${safeStringify(expected)}`,
            `Expected ${safeStringify(actual)} not to contain ${safeStringify(expected)}`,
          ),
        );
      },

      toContainEqual(expected: unknown) {
        const contains = Array.isArray(actual) && actual.some((item) => deepEquals(item, expected));
        check(
          contains,
          getMessage(
            `Expected ${safeStringify(actual)} to contain equal ${safeStringify(expected)}`,
            `Expected ${safeStringify(actual)} not to contain equal ${safeStringify(expected)}`,
          ),
        );
      },

      toHaveLength(expected: number) {
        const length = (actual as unknown[] | string).length;
        check(
          length === expected,
          getMessage(
            `Expected length to be ${expected}, but got ${length}`,
            `Expected length not to be ${expected}, but got ${length}`,
          ),
        );
      },

      toHaveProperty(keyPath: string | string[], value?: unknown) {
        const keys = Array.isArray(keyPath) ? keyPath : keyPath.split(".");
        let current: unknown = actual;
        let hasProperty = true;

        for (const key of keys) {
          if (current && typeof current === "object" && key in (current as object)) {
            current = (current as Record<string, unknown>)[key];
            continue;
          }
          hasProperty = false;
          break;
        }

        if (value !== undefined && hasProperty) {
          hasProperty = deepEquals(current, value);
        }

        check(
          hasProperty,
          getMessage(
            `Expected ${safeStringify(actual)} to have property ${JSON.stringify(keyPath)}`,
            `Expected ${safeStringify(actual)} not to have property ${JSON.stringify(keyPath)}`,
          ),
        );
      },

      toMatch(expected: string | RegExp) {
        const str = actual as string;
        const matches = typeof expected === "string" ? str.includes(expected) : expected.test(str);

        check(
          matches,
          getMessage(
            `Expected "${actual}" to match ${expected}`,
            `Expected "${actual}" not to match ${expected}`,
          ),
        );
      },

      toMatchObject(expected: Record<string, unknown>) {
        const actualObj = actual as Record<string, unknown>;
        const matches = Object.keys(expected).every((key) =>
          deepEquals(actualObj[key], expected[key])
        );

        check(
          matches,
          getMessage(
            `Expected ${safeStringify(actual)} to match object ${safeStringify(expected)}`,
            `Expected ${safeStringify(actual)} not to match object ${safeStringify(expected)}`,
          ),
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
          check(threw, isNot ? "Expected function not to throw" : "Expected function to throw");
          return;
        }

        if (typeof expected === "string") {
          check(
            threw && thrownError instanceof Error && thrownError.message.includes(expected),
            getMessage(
              `Expected function to throw with message "${expected}"`,
              `Expected function not to throw with message "${expected}"`,
            ),
          );
          return;
        }

        if (expected instanceof RegExp) {
          check(
            threw && thrownError instanceof Error && expected.test(thrownError.message),
            getMessage(
              `Expected function to throw matching ${expected}`,
              `Expected function not to throw matching ${expected}`,
            ),
          );
          return;
        }

        if (expected instanceof Error) {
          check(
            threw && thrownError instanceof Error && thrownError.message === expected.message,
            getMessage(
              `Expected function to throw ${expected}`,
              `Expected function not to throw ${expected}`,
            ),
          );
          return;
        }

        check(
          threw && thrownError instanceof expected,
          getMessage(
            `Expected function to throw ${expected.name}`,
            `Expected function not to throw ${expected.name}`,
          ),
        );
      },

      toThrowError(expected?: string | RegExp | Error | (new (...args: unknown[]) => Error)) {
        matchers.toThrow(expected);
      },

      get resolves(): AsyncMatchers<Awaited<T>> {
        const resolveValue = async (): Promise<Awaited<T>> => {
          return await (actual as Promise<Awaited<T>>);
        };

        return {
          async toBe(expected: Awaited<T>) {
            createMatchers(await resolveValue(), isNot).toBe(expected);
          },
          async toEqual(expected: Awaited<T>) {
            createMatchers(await resolveValue(), isNot).toEqual(expected);
          },
          async toStrictEqual(expected: Awaited<T>) {
            createMatchers(await resolveValue(), isNot).toStrictEqual(expected);
          },
          async toBeTruthy() {
            createMatchers(await resolveValue(), isNot).toBeTruthy();
          },
          async toBeFalsy() {
            createMatchers(await resolveValue(), isNot).toBeFalsy();
          },
          async toBeNull() {
            createMatchers(await resolveValue(), isNot).toBeNull();
          },
          async toBeUndefined() {
            createMatchers(await resolveValue(), isNot).toBeUndefined();
          },
          async toBeDefined() {
            createMatchers(await resolveValue(), isNot).toBeDefined();
          },
          async toBeInstanceOf(expected: new (...args: unknown[]) => unknown) {
            createMatchers(await resolveValue(), isNot).toBeInstanceOf(expected);
          },
          async toContain(expected: unknown) {
            createMatchers(await resolveValue(), isNot).toContain(expected);
          },
          async toHaveLength(expected: number) {
            createMatchers(await resolveValue(), isNot).toHaveLength(expected);
          },
          async toMatch(expected: string | RegExp) {
            createMatchers(await resolveValue(), isNot).toMatch(expected);
          },
          async toThrow() {
            createMatchers(await resolveValue(), isNot).toThrow();
          },
          get not(): AsyncMatchers<Awaited<T>> {
            return createMatchers(actual, !isNot).resolves;
          },
        };
      },

      get rejects(): AsyncMatchers<unknown> {
        return {
          async toBe(expected: unknown) {
            const { rejected, error } = await getRejection();

            if (!rejected) {
              if (!isNot) throw new Error("Expected promise to reject");
              return;
            }

            if (isNot) {
              if (Object.is(error, expected)) {
                throw new Error(`Expected promise not to reject with ${safeStringify(expected)}`);
              }
              return;
            }

            if (!Object.is(error, expected)) {
              throw new Error(
                `Expected promise to reject with ${safeStringify(expected)}, got ${
                  safeStringify(error)
                }`,
              );
            }
          },

          async toEqual(expected: unknown) {
            const { rejected, error } = await getRejection();

            if (!rejected) {
              if (!isNot) throw new Error("Expected promise to reject");
              return;
            }

            if (isNot) {
              if (deepEquals(error, expected)) {
                throw new Error(`Expected promise not to reject with ${safeStringify(expected)}`);
              }
              return;
            }

            if (!deepEquals(error, expected)) {
              throw new Error(
                `Expected promise to reject with ${safeStringify(expected)}, got ${
                  safeStringify(error)
                }`,
              );
            }
          },

          async toStrictEqual(expected: unknown) {
            await this.toEqual(expected);
          },

          async toBeTruthy() {
            const { rejected, error } = await getRejection();

            if (!rejected) {
              if (!isNot) throw new Error("Expected promise to reject");
              return;
            }

            if (isNot) {
              if (error) throw new Error("Expected promise not to reject with truthy value");
              return;
            }

            if (!error) throw new Error("Expected promise to reject with truthy value");
          },

          async toBeFalsy() {
            const { rejected, error } = await getRejection();

            if (!rejected) {
              if (!isNot) throw new Error("Expected promise to reject");
              return;
            }

            if (isNot) {
              if (!error) throw new Error("Expected promise not to reject with falsy value");
              return;
            }

            if (error) throw new Error("Expected promise to reject with falsy value");
          },

          async toBeNull() {
            const { rejected, error } = await getRejection();

            if (!rejected) {
              if (!isNot) throw new Error("Expected promise to reject");
              return;
            }

            if (isNot) {
              if (error === null) throw new Error("Expected promise not to reject with null");
              return;
            }

            if (error !== null) throw new Error("Expected promise to reject with null");
          },

          async toBeUndefined() {
            const { rejected, error } = await getRejection();

            if (!rejected) {
              if (!isNot) throw new Error("Expected promise to reject");
              return;
            }

            if (isNot) {
              if (error === undefined) {
                throw new Error("Expected promise not to reject with undefined");
              }
              return;
            }

            if (error !== undefined) throw new Error("Expected promise to reject with undefined");
          },

          async toBeDefined() {
            const { rejected, error } = await getRejection();

            if (!rejected) {
              if (!isNot) throw new Error("Expected promise to reject");
              return;
            }

            if (isNot) {
              if (error !== undefined) {
                throw new Error("Expected promise not to reject with defined value");
              }
              return;
            }

            if (error === undefined) {
              throw new Error("Expected promise to reject with defined value");
            }
          },

          async toBeInstanceOf(expected: new (...args: unknown[]) => unknown) {
            const { rejected, error } = await getRejection();

            if (!rejected) {
              if (!isNot) throw new Error("Expected promise to reject");
              return;
            }

            if (isNot) {
              if (error instanceof expected) {
                throw new Error(`Expected promise not to reject with instance of ${expected.name}`);
              }
              return;
            }

            if (!(error instanceof expected)) {
              throw new Error(`Expected promise to reject with instance of ${expected.name}`);
            }
          },

          async toContain(expected: unknown) {
            const { rejected, error } = await getRejection();

            if (!rejected) {
              if (!isNot) throw new Error("Expected promise to reject");
              return;
            }

            const contains = typeof error === "string" && error.includes(expected as string);

            if (isNot) {
              if (contains) {
                throw new Error(
                  `Expected promise not to reject containing ${safeStringify(expected)}`,
                );
              }
              return;
            }

            if (!contains) {
              throw new Error(`Expected promise to reject containing ${safeStringify(expected)}`);
            }
          },

          async toHaveLength(expected: number) {
            const { rejected, error } = await getRejection();

            if (!rejected) {
              if (!isNot) throw new Error("Expected promise to reject");
              return;
            }

            const length = (error as { length?: number })?.length;

            if (isNot) {
              if (length === expected) {
                throw new Error(`Expected rejected value not to have length ${expected}`);
              }
              return;
            }

            if (length !== expected) {
              throw new Error(`Expected rejected value to have length ${expected}, got ${length}`);
            }
          },

          async toMatch(expected: string | RegExp) {
            const { rejected, error } = await getRejection();

            if (!rejected) {
              if (!isNot) throw new Error("Expected promise to reject");
              return;
            }

            const str = error instanceof Error ? error.message : String(error);
            const matches = typeof expected === "string"
              ? str.includes(expected)
              : expected.test(str);

            if (isNot) {
              if (matches) throw new Error(`Expected promise not to reject matching ${expected}`);
              return;
            }

            if (!matches) throw new Error(`Expected promise to reject matching ${expected}`);
          },

          async toThrow(expected?: string | RegExp | Error | (new (...args: unknown[]) => Error)) {
            const { rejected, error } = await getRejection();

            if (expected === undefined) {
              if (!(isNot ? !rejected : rejected)) {
                throw new Error(
                  isNot ? "Expected promise not to reject" : "Expected promise to reject",
                );
              }
              return;
            }

            if (typeof expected === "string") {
              const matches = rejected && error instanceof Error &&
                error.message.includes(expected);
              if (isNot) {
                if (matches) {
                  throw new Error(`Expected promise not to reject with message "${expected}"`);
                }
                return;
              }
              if (!matches) {
                throw new Error(`Expected promise to reject with message "${expected}"`);
              }
              return;
            }

            if (expected instanceof RegExp) {
              const matches = rejected && error instanceof Error && expected.test(error.message);
              if (isNot) {
                if (matches) throw new Error(`Expected promise not to reject matching ${expected}`);
                return;
              }
              if (!matches) throw new Error(`Expected promise to reject matching ${expected}`);
              return;
            }

            if (expected instanceof Error) {
              const matches = rejected && error instanceof Error &&
                error.message === expected.message;
              if (isNot) {
                if (matches) {
                  throw new Error(`Expected promise not to reject with ${expected.message}`);
                }
                return;
              }
              if (!matches) throw new Error(`Expected promise to reject with ${expected.message}`);
              return;
            }

            const matches = rejected && error instanceof expected;
            if (isNot) {
              if (matches) throw new Error(`Expected promise not to reject with ${expected.name}`);
              return;
            }
            if (!matches) throw new Error(`Expected promise to reject with ${expected.name}`);
          },

          get not(): AsyncMatchers<unknown> {
            return createMatchers(actual, !isNot).rejects;
          },
        };
      },

      get not(): Matchers<T> {
        return createMatchers(actual, !isNot);
      },
    };

    return matchers;
  }

  return function expectFn<T>(actual: T): Matchers<T> {
    return createMatchers(actual);
  };
}

let expect: ExpectFn;

if (isDeno) {
  const stdExpect = await import("#std/expect.ts");
  expect = stdExpect.expect as unknown as ExpectFn;
} else if (isBun) {
  const importBunTest = new Function("return import('bun:test')") as () => Promise<{
    expect?: ExternalExpectFn;
    default?: { expect?: ExternalExpectFn };
  }>;
  const bunTestModule = await importBunTest();
  expect = (bunTestModule.expect ?? bunTestModule.default?.expect) as unknown as ExpectFn;
} else {
  expect = createNodeExpect();
}

export { expect };
