import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { captureHostBuiltinModuleLoader } from "./native-brand-checks.ts";

describe("native brand checks", () => {
  it("captures only an own host loader and calls its getter once with the host receiver", () => {
    const loader = () => ({});
    assertEquals(captureHostBuiltinModuleLoader({ getBuiltinModule: loader }), loader);
    let accesses = 0;
    const host = Object.defineProperty({}, "getBuiltinModule", {
      get() {
        accesses++;
        assertEquals(this, host);
        return loader;
      },
    });
    assertEquals(captureHostBuiltinModuleLoader(host), loader);
    assertEquals(accesses, 1);
    assertEquals(captureHostBuiltinModuleLoader({}), undefined);
    assertEquals(captureHostBuiltinModuleLoader({ getBuiltinModule: undefined }), undefined);
    assertEquals(
      captureHostBuiltinModuleLoader(Object.create({ getBuiltinModule: loader })),
      undefined,
    );
    const invalid = {};
    assertEquals(
      captureHostBuiltinModuleLoader(Object.defineProperty({}, "getBuiltinModule", {
        get: () => invalid,
      })),
      invalid,
    );
  });

  it("captures brand predicates from a lazy host builtin loader once", async () => {
    const hostProcess = (globalThis as typeof globalThis & {
      process?: { getBuiltinModule?: (specifier: string) => unknown };
    }).process;
    if (!hostProcess) throw new Error("host process must be available in server tests");
    const previous = Object.getOwnPropertyDescriptor(hostProcess, "getBuiltinModule");
    const loader = hostProcess.getBuiltinModule;
    if (!previous || typeof loader !== "function") {
      throw new Error("host builtin loader must be available in server tests");
    }
    let accesses = 0;
    let isolated: typeof import("./native-brand-checks.ts") | undefined;
    try {
      Object.defineProperty(hostProcess, "getBuiltinModule", {
        configurable: true,
        get() {
          accesses++;
          return loader;
        },
      });
      isolated = await import("./native-brand-checks.ts?lazy-host-builtin-loader");
      assertEquals(accesses, 1);
      Object.defineProperty(hostProcess, "getBuiltinModule", {
        configurable: true,
        get() {
          throw new Error("captured predicates must not reload the host module");
        },
      });
      assertEquals(isolated.nativeBrandChecks?.isNativeError(new Error("fixture")), true);
      assertEquals(isolated.nativeBrandChecks?.isNativeError({}), false);
      let trapCalls = 0;
      const proxy = new Proxy({}, {
        get() {
          trapCalls++;
          return undefined;
        },
        ownKeys() {
          trapCalls++;
          return [];
        },
      });
      assertEquals(isolated.nativeBrandChecks?.isProxy(proxy), true);
      assertEquals(isolated.nativeBrandChecks?.isNonPlainBuiltin(proxy), false);
      assertEquals(trapCalls, 0);
      assertEquals(accesses, 1);
    } finally {
      Object.defineProperty(hostProcess, "getBuiltinModule", previous);
    }
  });

  it("fails closed when the host loader is missing or does not return a function", async () => {
    const hostProcess = (globalThis as typeof globalThis & {
      process?: { getBuiltinModule?: (specifier: string) => unknown };
    }).process;
    if (!hostProcess) throw new Error("host process must be available in server tests");
    const previous = Object.getOwnPropertyDescriptor(hostProcess, "getBuiltinModule");
    if (!previous) throw new Error("host builtin loader must be available in server tests");
    const hasBunFallback = (globalThis as typeof globalThis & { Bun?: unknown }).Bun != null;
    try {
      for (const shape of ["missing", "empty", "invalid-accessor"]) {
        if (shape === "missing") {
          Reflect.deleteProperty(hostProcess, "getBuiltinModule");
        } else {
          Object.defineProperty(
            hostProcess,
            "getBuiltinModule",
            shape === "empty"
              ? { configurable: true, value: undefined }
              : { configurable: true, get: () => ({}) },
          );
        }
        const load = () => import(`./native-brand-checks.ts?unavailable-host-loader-${shape}`);
        if (hasBunFallback) {
          // Bun's lexical require still provides its host builtin module.
          const isolated = await load();
          assertEquals(isolated.nativeBrandChecks?.isNativeError(new Error("fixture")), true);
        } else {
          await assertRejects(
            load,
            Error,
            "does not expose complete node:util/types brand checks",
          );
        }
      }
    } finally {
      Object.defineProperty(hostProcess, "getBuiltinModule", previous);
    }
  });

  it("propagates a failing host resolver accessor without falling back", async () => {
    const hostProcess = (globalThis as typeof globalThis & { process: object }).process;
    const previous = Object.getOwnPropertyDescriptor(hostProcess, "getBuiltinModule");
    const expected = new Error("synthetic host resolver failure");
    let reads = 0;
    let failure: unknown;
    Object.defineProperty(hostProcess, "getBuiltinModule", {
      configurable: true,
      get() {
        reads++;
        throw expected;
      },
    });
    try {
      await import("./native-brand-checks.ts?throwing-host-resolver-accessor");
    } catch (error) {
      failure = error;
    } finally {
      if (previous) Object.defineProperty(hostProcess, "getBuiltinModule", previous);
      else Reflect.deleteProperty(hostProcess, "getBuiltinModule");
    }
    assertEquals(failure, expected);
    assertEquals(reads, 1);
  });

  it("rejects accessor predicates in an untrusted module without invoking them", async () => {
    const hostProcess = (globalThis as typeof globalThis & { process: object }).process;
    const previous = Object.getOwnPropertyDescriptor(hostProcess, "getBuiltinModule");
    const predicates = { ...await import("node:util/types") };
    let reads = 0;
    let failure: unknown;
    Object.defineProperty(predicates, "isProxy", {
      get() {
        reads++;
        throw new Error("untrusted predicate getter");
      },
    });
    Object.defineProperty(hostProcess, "getBuiltinModule", {
      configurable: true,
      value: () => predicates,
    });
    try {
      await import("./native-brand-checks.ts?untrusted-predicate-accessor");
    } catch (error) {
      failure = error;
    } finally {
      if (previous) Object.defineProperty(hostProcess, "getBuiltinModule", previous);
      else Reflect.deleteProperty(hostProcess, "getBuiltinModule");
    }
    assertEquals(failure instanceof Error, true);
    assertEquals(reads, 0);
  });

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
      new URLSearchParams({ a: "1" }),
      new Headers({ "x-test": "1" }),
      new Request("https://example.com"),
      new Response("ok"),
      new AbortController(),
      new FormData(),
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

  it("checks non-plain builtins when Array iteration is patched", async () => {
    const isolated = await import("./native-brand-checks.ts?patched-array-iterator");
    const previousIterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
    let iteratorCalls = 0;
    let plainResult: boolean | undefined;
    let nativeResult: boolean | undefined;
    const disguisedUrl = new URL("https://example.com");
    Object.setPrototypeOf(disguisedUrl, Object.prototype);

    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      value() {
        iteratorCalls++;
        return {
          next: () => ({ done: true, value: undefined }),
        };
      },
      writable: true,
    });
    try {
      plainResult = isolated.nativeBrandChecks?.isNonPlainBuiltin({});
      nativeResult = isolated.nativeBrandChecks?.isNonPlainBuiltin(disguisedUrl);
    } finally {
      if (previousIterator) {
        Object.defineProperty(Array.prototype, Symbol.iterator, previousIterator);
      } else {
        Reflect.deleteProperty(Array.prototype, Symbol.iterator);
      }
    }

    assertEquals(plainResult, false);
    assertEquals(nativeResult, true);
    assertEquals(iteratorCalls, 0);
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

  it("does not invoke own accessors while checking non-plain builtins", async () => {
    const isolated = await import("./native-brand-checks.ts?non-plain-accessor");
    let accessorCalls = 0;
    const candidate = {};
    Object.defineProperty(candidate, "metadata", {
      configurable: true,
      enumerable: true,
      get() {
        accessorCalls++;
        return "ordinary accessor";
      },
    });

    assertEquals(isolated.nativeBrandChecks?.isNonPlainBuiltin(candidate), false);
    assertEquals(accessorCalls, 0);
  });

  it("does not invoke nested accessors held by own data properties", async () => {
    const isolated = await import("./native-brand-checks.ts?non-plain-nested-accessor");
    let accessorCalls = 0;
    const metadata = {};
    Object.defineProperty(metadata, "nested", {
      configurable: true,
      enumerable: true,
      get() {
        accessorCalls++;
        return "nested accessor";
      },
    });
    const candidate = { metadata };

    assertEquals(isolated.nativeBrandChecks?.isNonPlainBuiltin(candidate), false);
    assertEquals(accessorCalls, 0);
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
