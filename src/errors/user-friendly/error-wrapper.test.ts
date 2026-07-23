import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { wrapErrorHandler } from "./error-wrapper.ts";

describe("wrapErrorHandler", () => {
  it("rejects an invalid handler at wrapper creation", () => {
    assertThrows(
      () => wrapErrorHandler(null as never),
      TypeError,
      "fn must be a function",
    );
  });

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
    const wrapped = wrapErrorHandler(fn);

    await assertRejects(() => wrapped(), Error, "test failure");
  });

  it("should re-throw non-Error values", async () => {
    const fn = () => {
      throw "string error";
    };
    const wrapped = wrapErrorHandler(fn);

    try {
      await wrapped();
      throw new Error("Expected wrapped handler to reject");
    } catch (error) {
      assertEquals(error, "string error");
    }
  });

  it("does not log a raw non-Error throw", async () => {
    const originalConsoleError = console.error;
    const output: string[] = [];
    console.error = (...args: unknown[]) => output.push(args.map(String).join(" "));
    try {
      const thrown = { password: "<TOKEN>", path: "/private/project/config.ts" };
      const wrapped = wrapErrorHandler(async () => {
        throw thrown;
      });

      await assertRejects(() => wrapped());
      const serialized = output.join("\n");
      assertEquals(serialized.includes("<TOKEN>"), false);
      assertEquals(serialized.includes("/private/project"), false);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
