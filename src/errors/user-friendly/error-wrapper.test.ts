import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
    const wrapped = wrapErrorHandler(fn);

    await assertRejects(() => wrapped(), Error, "test failure");
  });

  it("should re-throw non-Error values", async () => {
    const fn = () => {
      throw "string error";
    };
    const wrapped = wrapErrorHandler(fn);

    await assertRejects(() => wrapped(), undefined, "string error");
  });
});
