import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("native brand checks", () => {
  it("identifies native-slot objects without trusting their prototype", async () => {
    const isolated = await import("./native-brand-checks.ts?non-plain-builtins");
    const values: object[] = [
      new WeakMap(),
      new WeakSet(),
      new WeakRef({}),
      new FinalizationRegistry(() => {}),
      Promise.resolve(),
      Object(Symbol("boxed")),
      Object(1n),
    ];

    const disguisedUrl = new URL("https://example.com");
    Object.setPrototypeOf(disguisedUrl, Object.prototype);
    if (Reflect.ownKeys(disguisedUrl).length === 0) values.push(disguisedUrl);

    for (const value of values) {
      Object.setPrototypeOf(value, Object.prototype);
      assertEquals(isolated.nativeBrandChecks?.isNonPlainBuiltin(value), true);
    }
    assertEquals(isolated.nativeBrandChecks?.isNonPlainBuiltin({}), false);
  });

  it("identifies prototype-disguised native slots with ordinary own properties", async () => {
    const isolated = await import("./native-brand-checks.ts?non-plain-own-properties");
    const values: object[] = [
      new WeakRef({}),
      new FinalizationRegistry(() => {}),
      new URL("https://example.com"),
    ];

    for (const value of values) {
      Object.setPrototypeOf(value, Object.prototype);
      Object.defineProperty(value, "metadata", {
        configurable: true,
        enumerable: true,
        value: "ordinary data",
        writable: true,
      });
      assertEquals(isolated.nativeBrandChecks?.isNonPlainBuiltin(value), true);
    }
  });

  it("does not invoke proxy traps while checking non-plain builtins", async () => {
    const isolated = await import("./native-brand-checks.ts?non-plain-proxy");
    let trapCalls = 0;
    const proxy = new Proxy({}, {
      get() {
        trapCalls++;
        return undefined;
      },
      getOwnPropertyDescriptor() {
        trapCalls++;
        return undefined;
      },
      getPrototypeOf() {
        trapCalls++;
        return Object.prototype;
      },
      ownKeys() {
        trapCalls++;
        return [];
      },
    });

    assertEquals(isolated.nativeBrandChecks?.isNonPlainBuiltin(proxy), false);
    assertEquals(trapCalls, 0);
  });

  it("does not invoke a replaced node:vm export during initialization", async () => {
    const hostProcess = (globalThis as typeof globalThis & {
      process?: { getBuiltinModule?: (specifier: string) => unknown };
    }).process;
    const vmModule = hostProcess?.getBuiltinModule?.("node:vm") as
      | Record<string, unknown>
      | undefined;
    const previous = vmModule && Object.getOwnPropertyDescriptor(vmModule, "runInNewContext");
    let hookCalls = 0;
    let isolated: typeof import("./native-brand-checks.ts") | undefined;
    let failure: unknown;

    if (!vmModule || !previous) throw new Error("node:vm must be available in host tests");
    Object.defineProperty(vmModule, "runInNewContext", {
      configurable: true,
      value: () => {
        hookCalls++;
        return () => true;
      },
      writable: true,
    });

    try {
      isolated = await import("./native-brand-checks.ts?poisoned-node-vm-export");
    } catch (error) {
      failure = error;
    } finally {
      Object.defineProperty(vmModule, "runInNewContext", previous);
    }

    assertEquals(failure, undefined);
    assertEquals(isolated?.nativeBrandChecks?.isNativeError({}), false);
    assertEquals(hookCalls, 0);
  });

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
});
