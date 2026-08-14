import "#veryfront/schemas/_test-setup.ts";
import { types as nodeUtilTypes } from "node:util";
import { isNativeError as nodeNativeErrorBrandCheck } from "node:util/types";
import { runInNewContext } from "node:vm";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  canInspectErrorStackDescriptorWithoutHooks,
  isErrorAcrossRealms,
  isNativeAsyncFunctionWithoutHooks,
  isNativeErrorWithoutHooks,
  isNativePromiseWithoutHooks,
  isProxyWithoutHooks,
  isUint8ArrayWithoutHooks,
  readNativeErrorNameWithoutHooks,
} from "./error-introspection.ts";

describe("platform error introspection", () => {
  it("does not consult mutable Error.isError during module initialization", async () => {
    const previousIsError = Object.getOwnPropertyDescriptor(Error, "isError");
    const previousValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    let isErrorAccessorCalls = 0;
    let inheritedValueCalls = 0;
    let isolated: typeof import("./error-introspection.ts") | undefined;
    let failure: unknown;

    Object.defineProperty(Error, "isError", {
      configurable: true,
      get(): never {
        isErrorAccessorCalls += 1;
        throw new Error("Error.isError accessor must not run");
      },
    });
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      get(): never {
        inheritedValueCalls += 1;
        throw new Error("inherited descriptor value must not run");
      },
    });

    try {
      isolated = await import("./error-introspection.ts?descriptor-value-poisoning");
    } catch (error) {
      failure = error;
    } finally {
      if (previousValue) {
        Object.defineProperty(Object.prototype, "value", previousValue);
      } else {
        delete (Object.prototype as Record<string, unknown>).value;
      }
      if (previousIsError) {
        Object.defineProperty(Error, "isError", previousIsError);
      } else {
        delete (Error as unknown as { isError?: unknown }).isError;
      }
    }

    assertEquals(failure, undefined);
    assertEquals(isErrorAccessorCalls, 0);
    assertEquals(inheritedValueCalls, 0);
    assertEquals(isolated?.isNativeErrorWithoutHooks(new Error("failure")), true);
  });

  it("does not execute a data-valued Error.isError replacement", async () => {
    const previous = Object.getOwnPropertyDescriptor(Error, "isError");
    let hookCalls = 0;
    let isolated: typeof import("./error-introspection.ts") | undefined;
    Object.defineProperty(Error, "isError", {
      configurable: true,
      value: () => {
        hookCalls += 1;
        return false;
      },
      writable: true,
    });

    try {
      isolated = await import("./error-introspection.ts?data-error-is-error-replacement");
    } finally {
      if (previous) {
        Object.defineProperty(Error, "isError", previous);
      } else {
        Reflect.deleteProperty(Error, "isError");
      }
    }

    assertEquals(isolated?.isNativeErrorWithoutHooks(new Error("failure")), true);
    assertEquals(hookCalls, 0);
  });

  it("does not capture replaced DOMException getters or false-brand objects", async () => {
    const nameDescriptor = Object.getOwnPropertyDescriptor(
      DOMException.prototype,
      "name",
    );
    const messageDescriptor = Object.getOwnPropertyDescriptor(
      DOMException.prototype,
      "message",
    );
    let getterCalls = 0;
    let isolated: typeof import("./error-introspection.ts") | undefined;
    Object.defineProperty(DOMException.prototype, "name", {
      configurable: true,
      get() {
        getterCalls += 1;
        return "FakeName";
      },
    });
    Object.defineProperty(DOMException.prototype, "message", {
      configurable: true,
      get() {
        getterCalls += 1;
        return "FakeMessage";
      },
    });

    try {
      isolated = await import("./error-introspection.ts?poisoned-domexception-getters");
    } finally {
      if (nameDescriptor) {
        Object.defineProperty(DOMException.prototype, "name", nameDescriptor);
      }
      if (messageDescriptor) {
        Object.defineProperty(
          DOMException.prototype,
          "message",
          messageDescriptor,
        );
      }
    }

    assertEquals(isolated?.isNativeErrorWithoutHooks({}), false);
    assertEquals(getterCalls, 0);
  });

  it("does not read a mutable node:util types property during module initialization", async () => {
    const previous = Object.getOwnPropertyDescriptor(nodeUtilTypes, "isNativeError");
    let getterCalls = 0;
    let isolated: typeof import("./error-introspection.ts") | undefined;
    let failure: unknown;
    Object.defineProperty(nodeUtilTypes, "isNativeError", {
      configurable: true,
      get(): never {
        getterCalls += 1;
        throw new Error("node:util types getter must not run");
      },
    });

    try {
      isolated = await import("./error-introspection.ts?mutable-node-util-types-getter");
    } catch (error) {
      failure = error;
    } finally {
      if (previous) Object.defineProperty(nodeUtilTypes, "isNativeError", previous);
    }

    assertEquals(failure, undefined);
    assertEquals(isolated?.isNativeErrorWithoutHooks(new Error("failure")), true);
    assertEquals(getterCalls, 0);
  });

  it("does not capture a data replacement from the mutable node:util types object", async () => {
    const previous = Object.getOwnPropertyDescriptor(nodeUtilTypes, "isNativeError");
    let hookCalls = 0;
    let isolated: typeof import("./error-introspection.ts") | undefined;
    Object.defineProperty(nodeUtilTypes, "isNativeError", {
      configurable: true,
      value: () => {
        hookCalls += 1;
        throw new Error("node:util replacement must not run");
      },
      writable: true,
    });

    try {
      isolated = await import("./error-introspection.ts?mutable-node-util-types-value");
    } finally {
      if (previous) Object.defineProperty(nodeUtilTypes, "isNativeError", previous);
    }

    assertEquals(isolated?.isNativeErrorWithoutHooks(new Error("failure")), true);
    assertEquals(hookCalls, 0);
  });

  it("probes stack descriptors without invoking or replacing a project formatter", async () => {
    const ErrorWithStackFormatter = Error as ErrorConstructor & {
      prepareStackTrace?: (error: Error, callSites: unknown[]) => unknown;
    };
    const previousFormatter = Object.getOwnPropertyDescriptor(
      ErrorWithStackFormatter,
      "prepareStackTrace",
    );
    const previousValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    let formatterCalls = 0;
    let inheritedValueCalls = 0;
    const hostileFormatter = () => {
      formatterCalls += 1;
      throw new Error("prepareStackTrace must not run");
    };
    Object.defineProperty(ErrorWithStackFormatter, "prepareStackTrace", {
      configurable: true,
      value: hostileFormatter,
      writable: true,
    });
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      get(): never {
        inheritedValueCalls += 1;
        throw new Error("inherited descriptor value must not run");
      },
    });

    let isolated: typeof import("./error-introspection.ts") | undefined;
    let restoredFormatter: unknown;
    try {
      isolated = await import("./error-introspection.ts?hostile-stack-formatter");
      restoredFormatter = Object.getOwnPropertyDescriptor(
        ErrorWithStackFormatter,
        "prepareStackTrace",
      )?.value;
    } finally {
      if (previousValue) {
        Object.defineProperty(Object.prototype, "value", previousValue);
      } else {
        delete (Object.prototype as Record<string, unknown>).value;
      }
      if (previousFormatter) {
        Object.defineProperty(ErrorWithStackFormatter, "prepareStackTrace", previousFormatter);
      } else {
        delete ErrorWithStackFormatter.prepareStackTrace;
      }
    }

    assertEquals(
      isolated?.canInspectErrorStackDescriptorWithoutHooks,
      canInspectErrorStackDescriptorWithoutHooks,
    );
    assertEquals(restoredFormatter, hostileFormatter);
    assertEquals(formatterCalls, 0);
    assertEquals(inheritedValueCalls, 0);
  });

  it("captures the native-error fallback before later property replacement", async () => {
    const previousIsError = Object.getOwnPropertyDescriptor(Error, "isError");
    Object.defineProperty(Error, "isError", {
      configurable: true,
      value: undefined,
      writable: true,
    });

    let isolated: typeof import("./error-introspection.ts") | undefined;
    try {
      isolated = await import("./error-introspection.ts?captured-node-util-fallback");
    } finally {
      if (previousIsError) {
        Object.defineProperty(Error, "isError", previousIsError);
      } else {
        Reflect.deleteProperty(Error, "isError");
      }
    }

    const previousNativeCheck = Object.getOwnPropertyDescriptor(
      nodeUtilTypes,
      "isNativeError",
    );
    let hookCalls = 0;
    Object.defineProperty(nodeUtilTypes, "isNativeError", {
      configurable: true,
      value: () => {
        hookCalls += 1;
        return false;
      },
      writable: true,
    });

    let result: boolean | undefined;
    try {
      result = isolated?.isNativeErrorWithoutHooks(new Error("failure"));
    } finally {
      if (previousNativeCheck) {
        Object.defineProperty(nodeUtilTypes, "isNativeError", previousNativeCheck);
      }
    }

    assertEquals(result, true);
    assertEquals(hookCalls, 0);
  });

  it("recognizes native errors and treats Error proxies as opaque", () => {
    let trapCalls = 0;
    const proxied = new Proxy(new Error("private"), {
      getPrototypeOf(target) {
        trapCalls++;
        return Reflect.getPrototypeOf(target);
      },
    });

    assertEquals(isNativeErrorWithoutHooks(new Error("failure")), true);
    assertEquals(
      isNativeErrorWithoutHooks(new DOMException("failure")),
      nodeNativeErrorBrandCheck(new DOMException("failure")),
    );
    assertEquals(isNativeErrorWithoutHooks(proxied), false);
    assertEquals(isProxyWithoutHooks(proxied), true);
    assertEquals(trapCalls, 0);
  });

  it("recognizes Errors from another realm and rejects error-shaped objects", () => {
    const crossRealmError = runInNewContext("new Error('from another realm')") as unknown;
    const detachedError = Object.setPrototypeOf(new Error("detached"), { name: "Detached" });

    // Both shapes are what a real cross-realm Error looks like to `instanceof`.
    assertEquals(crossRealmError instanceof Error, false);
    assertEquals(detachedError instanceof Error, false);

    assertEquals(isErrorAcrossRealms(crossRealmError), true);
    assertEquals(isErrorAcrossRealms(detachedError), true);
    assertEquals(isErrorAcrossRealms(new Error("same realm")), true);
    assertEquals(isErrorAcrossRealms(new TypeError("same realm subclass")), true);
    assertEquals(isErrorAcrossRealms(new DOMException("aborted", "AbortError")), true);

    assertEquals(isErrorAcrossRealms({ name: "Error", message: "shaped like one" }), false);
    assertEquals(
      isErrorAcrossRealms({ name: "Error", message: "tagged", [Symbol.toStringTag]: "Error" }),
      false,
    );
    assertEquals(isErrorAcrossRealms("aborted"), false);
    assertEquals(isErrorAcrossRealms(undefined), false);
    assertEquals(isErrorAcrossRealms(null), false);
  });

  it("recognizes Uint8Array values without invoking proxy traps", () => {
    let trapCalls = 0;
    const bytes = new Uint8Array([1, 2, 3]);
    const proxied = new Proxy(bytes, {
      getPrototypeOf(target) {
        trapCalls++;
        return Reflect.getPrototypeOf(target);
      },
    });

    assertEquals(isUint8ArrayWithoutHooks(bytes), true);
    assertEquals(isUint8ArrayWithoutHooks(new Uint16Array([1])), false);
    assertEquals(isUint8ArrayWithoutHooks(proxied), false);
    assertEquals(trapCalls, 0);
  });

  it("reads built-in and custom error names without prototype hooks", () => {
    class CustomError extends Error {}
    class HostileConstructorError extends Error {}
    let constructorReads = 0;
    Object.defineProperty(HostileConstructorError.prototype, "constructor", {
      configurable: true,
      get(): never {
        constructorReads += 1;
        throw new Error("constructor accessor must not run");
      },
    });

    const previousValue = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "value",
    );
    let inheritedValueReads = 0;
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      get(): never {
        inheritedValueReads += 1;
        throw new Error("inherited descriptor value must not run");
      },
    });

    let names: string[] = [];
    try {
      names = [
        readNativeErrorNameWithoutHooks(new Error("failure")),
        readNativeErrorNameWithoutHooks(new TypeError("failure")),
        readNativeErrorNameWithoutHooks(new CustomError("failure")),
        readNativeErrorNameWithoutHooks(
          new HostileConstructorError("failure"),
        ),
      ];
    } finally {
      if (previousValue) {
        Object.defineProperty(Object.prototype, "value", previousValue);
      } else {
        Reflect.deleteProperty(Object.prototype, "value");
      }
    }

    assertEquals(names, ["Error", "TypeError", "CustomError", "Error"]);
    assertEquals(constructorReads, 0);
    assertEquals(inheritedValueReads, 0);
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

  it("recognizes async functions across realms without invoking hooks", () => {
    let hookCalls = 0;
    const hostile = Object.defineProperty(function () {}, Symbol.toStringTag, {
      configurable: true,
      get() {
        hookCalls += 1;
        throw new Error("toStringTag must not be read");
      },
    });
    const asyncFunction = async () => undefined;
    const boundAsyncFunction = asyncFunction.bind(undefined);
    const asyncProxy = new Proxy(asyncFunction, {
      getPrototypeOf(target) {
        hookCalls += 1;
        return Reflect.getPrototypeOf(target);
      },
    });
    const crossRealmAsync = runInNewContext("(async function crossRealm() {})") as unknown;
    const crossRealmBoundAsync = runInNewContext(
      "(async function crossRealmBound() {}).bind(undefined)",
    ) as unknown;

    assertEquals(isNativeAsyncFunctionWithoutHooks(asyncFunction), true);
    assertEquals(isNativeAsyncFunctionWithoutHooks(boundAsyncFunction), true);
    assertEquals(isNativeAsyncFunctionWithoutHooks(crossRealmAsync), true);
    assertEquals(isNativeAsyncFunctionWithoutHooks(crossRealmBoundAsync), true);
    assertEquals(isNativeAsyncFunctionWithoutHooks(() => Promise.resolve()), false);
    assertEquals(isNativeAsyncFunctionWithoutHooks(hostile), false);
    assertEquals(isNativeAsyncFunctionWithoutHooks(asyncProxy), false);
    assertEquals(hookCalls, 0);
  });
});
