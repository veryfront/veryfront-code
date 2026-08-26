import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { cliLogger } from "#veryfront/utils/logger/logger.ts";
import { wrapErrorHandler } from "./error-wrapper.ts";

describe("wrapErrorHandler", () => {
  it("should return result on success", async () => {
    const fn = (x: number) => Promise.resolve(x * 2);
    const wrapped = wrapErrorHandler(fn);

    assertEquals(await wrapped(5), 10);
  });

  it("should preserve function arguments", async () => {
    const fn = (a: string, b: string) => Promise.resolve(`${a}-${b}`);
    const wrapped = wrapErrorHandler(fn);

    assertEquals(await wrapped("hello", "world"), "hello-world");
  });

  it("should re-throw errors after logging", async () => {
    const fn = () => {
      throw new Error("test failure");
    };
    const calls: unknown[][] = [];
    const originalLogError = cliLogger.error;
    cliLogger.error = (...args: unknown[]) => {
      calls.push(args);
    };

    try {
      const wrapped = wrapErrorHandler(fn);

      await assertRejects(() => wrapped(), Error, "test failure");

      assertEquals(calls.length, 1, "the boundary logs the caught error exactly once");
      assert(
        calls[0]!.join(" ").includes("test failure"),
        "the logged output carries the formatted user error message",
      );
      assert(
        calls[0]!.join(" ").includes("veryfront doctor"),
        "native Errors are logged through formatUserError",
      );
    } finally {
      cliLogger.error = originalLogError;
    }
  });

  it("should re-throw non-Error values", async () => {
    const fn = () => {
      throw "string error";
    };
    const calls: unknown[][] = [];
    const originalLogError = cliLogger.error;
    cliLogger.error = (...args: unknown[]) => {
      calls.push(args);
    };

    try {
      const wrapped = wrapErrorHandler(fn);

      const thrown = await assertRejects(() => wrapped());

      assertEquals(thrown, "string error", "non-Error throwables must be re-thrown unchanged");
      assertEquals(calls.length, 1, "the boundary logs the caught throwable exactly once");
      assert(
        calls[0]!.join(" ").includes("Unknown error"),
        "non-Error throwables are logged through the sanitized snapshot branch",
      );
    } finally {
      cliLogger.error = originalLogError;
    }
  });

  it("should preserve the original error when logging fails", async () => {
    const original = new Error("operation failed");
    const originalLogError = cliLogger.error;
    cliLogger.error = () => {
      throw new Error("log sink failed");
    };

    try {
      const wrapped = wrapErrorHandler(async () => {
        throw original;
      });
      const thrown = await assertRejects(() => wrapped());

      assertEquals(thrown, original);
    } finally {
      cliLogger.error = originalLogError;
    }
  });

  it("should not invoke conversion hooks on non-Error throws", async () => {
    let coercions = 0;
    const hostile = {
      [Symbol.toPrimitive](): never {
        coercions++;
        throw new Error("conversion hook must not run");
      },
    };
    const wrapped = wrapErrorHandler(async () => {
      throw hostile;
    });

    const thrown = await assertRejects(() => wrapped());

    assertEquals(thrown, hostile);
    assertEquals(coercions, 0);
  });
});
