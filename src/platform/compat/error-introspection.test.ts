import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isNativeErrorWithoutHooks, isProxyWithoutHooks } from "./error-introspection.ts";

describe("platform error introspection", () => {
  it("recognizes native errors and treats Error proxies as opaque", () => {
    let trapCalls = 0;
    const proxied = new Proxy(new Error("private"), {
      getPrototypeOf(target) {
        trapCalls++;
        return Reflect.getPrototypeOf(target);
      },
    });

    assertEquals(isNativeErrorWithoutHooks(new Error("failure")), true);
    assertEquals(isNativeErrorWithoutHooks(proxied), false);
    assertEquals(isProxyWithoutHooks(proxied), true);
    assertEquals(trapCalls, 0);
  });

  it("does not execute conversion hooks on arbitrary values", () => {
    let coercions = 0;
    const hostile = {
      [Symbol.toPrimitive](): never {
        coercions++;
        throw new Error("conversion hook must not run");
      },
    };

    assertEquals(isNativeErrorWithoutHooks(hostile), false);
    assertEquals(isProxyWithoutHooks(hostile), false);
    assertEquals(coercions, 0);
  });
});
