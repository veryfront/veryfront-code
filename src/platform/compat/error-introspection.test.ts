import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isNativeErrorWithoutHooks,
  isNativePromiseWithoutHooks,
  isProxyWithoutHooks,
} from "./error-introspection.ts";

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

  it("recognizes promises without consulting an instance then field", () => {
    let thenReads = 0;
    const promised = Promise.resolve("value");
    Object.defineProperty(promised, "then", {
      configurable: true,
      get() {
        thenReads++;
        throw new Error("then must not be read");
      },
    });
    const proxy = new Proxy(promised, {});

    assertEquals(isNativePromiseWithoutHooks(promised), true);
    assertEquals(isNativePromiseWithoutHooks(proxy), false);
    assertEquals(isNativePromiseWithoutHooks({ then: () => undefined }), false);
    assertEquals(thenReads, 0);
  });
});
