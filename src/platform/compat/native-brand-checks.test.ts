import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isProxy } from "node:util/types";
import { runInNewContext } from "node:vm";
import { snapshotNativeBrandChecks } from "./native-brand-checks.ts";

describe("native brand checks", () => {
  it("does not capture replaced primary-realm Error brand hooks", async () => {
    const previousIsError = Object.getOwnPropertyDescriptor(Error, "isError");
    const previousToString = Object.getOwnPropertyDescriptor(Object.prototype, "toString");
    let isErrorHookCalls = 0;
    let toStringHookCalls = 0;
    let isolated: typeof import("./native-brand-checks.ts") | undefined;
    Object.defineProperty(Error, "isError", {
      configurable: true,
      value: () => {
        isErrorHookCalls++;
        return true;
      },
      writable: true,
    });
    Object.defineProperty(Object.prototype, "toString", {
      configurable: true,
      value: () => {
        toStringHookCalls++;
        return "[object Error]";
      },
      writable: true,
    });

    try {
      isolated = await import("./native-brand-checks.ts?poisoned-primary-realm-error-hooks");
    } finally {
      if (previousToString) {
        Object.defineProperty(Object.prototype, "toString", previousToString);
      }
      if (previousIsError) {
        Object.defineProperty(Error, "isError", previousIsError);
      } else {
        Reflect.deleteProperty(Error, "isError");
      }
    }

    assertEquals(isolated?.nativeBrandChecks?.isNativeError(new Error("native")), true);
    assertEquals(isolated?.nativeBrandChecks?.isNativeError({}), false);
    assertEquals(isErrorHookCalls, 0);
    assertEquals(toStringHookCalls, 0);
  });

  it("falls back to an isolated Error brand check when the host check misses", () => {
    let tagReads = 0;
    let proxyTrapCalls = 0;
    const tagged = Object.defineProperty({}, Symbol.toStringTag, {
      get() {
        tagReads++;
        return "Error";
      },
    });
    const proxied = new Proxy(new Error("proxied"), {
      getOwnPropertyDescriptor(target, key) {
        proxyTrapCalls++;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      getPrototypeOf(target) {
        proxyTrapCalls++;
        return Reflect.getPrototypeOf(target);
      },
    });
    const checks = snapshotNativeBrandChecks({
      isAsyncFunction: () => false,
      isNativeError: () => false,
      isPromise: () => false,
      isProxy,
      isUint8Array: () => false,
    });

    assertEquals(checks?.isNativeError(new Error("native")), true);
    assertEquals(checks?.isNativeError(runInNewContext("new Error('cross realm')")), true);
    assertEquals(checks?.isNativeError({ name: "Error", message: "shaped" }), false);
    assertEquals(checks?.isNativeError(Object.create(Error.prototype)), false);
    assertEquals(checks?.isNativeError(tagged), false);
    assertEquals(checks?.isNativeError(proxied), false);
    assertEquals(tagReads, 0);
    assertEquals(proxyTrapCalls, 0);
  });

  it("does not consult a replaced Error.isError hook", () => {
    const previous = Object.getOwnPropertyDescriptor(Error, "isError");
    let hookCalls = 0;
    Object.defineProperty(Error, "isError", {
      configurable: true,
      value: () => {
        hookCalls++;
        return true;
      },
      writable: true,
    });

    try {
      const checks = snapshotNativeBrandChecks({
        isAsyncFunction: () => false,
        isNativeError: () => false,
        isPromise: () => false,
        isProxy,
        isUint8Array: () => false,
      });

      assertEquals(checks?.isNativeError(new Error("native")), true);
      assertEquals(checks?.isNativeError({ name: "Error", message: "shaped" }), false);
      assertEquals(hookCalls, 0);
    } finally {
      if (previous) {
        Object.defineProperty(Error, "isError", previous);
      } else {
        Reflect.deleteProperty(Error, "isError");
      }
    }
  });
});
