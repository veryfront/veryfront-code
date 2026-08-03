import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAbortError,
  MAX_TOOL_ERROR_TEXT_BYTES,
  stringifyToolError,
  throwIfAborted,
} from "./error-utils.ts";

describe("agent/runtime/error-utils", () => {
  describe("createAbortError", () => {
    it("returns the original Error instance when the reason is already an Error", () => {
      const reason = new Error("boom");
      assertStrictEquals(createAbortError(reason), reason);
    });

    it("creates an AbortError DOMException from a string reason", () => {
      const error = createAbortError("stop now");
      assertEquals(error instanceof DOMException, true);
      assertEquals(error.name, "AbortError");
      assertEquals(error.message, "stop now");
    });

    it("uses a default abort message when the reason is empty", () => {
      const error = createAbortError();
      assertEquals(error instanceof DOMException, true);
      assertEquals(error.name, "AbortError");
      assertEquals(error.message, "The operation was aborted");
    });
  });

  describe("throwIfAborted", () => {
    it("does nothing when the signal is not aborted", () => {
      const controller = new AbortController();
      assertEquals(throwIfAborted(controller.signal), undefined);
    });

    it("throws an AbortError when the signal has been aborted", () => {
      const controller = new AbortController();
      controller.abort("cancelled");

      assertThrows(
        () => throwIfAborted(controller.signal),
        DOMException,
        "cancelled",
      );
    });
  });

  describe("stringifyToolError", () => {
    it("returns non-empty strings unchanged", () => {
      assertEquals(stringifyToolError("tool failed"), "tool failed");
    });

    it("returns an Error message when available", () => {
      assertEquals(stringifyToolError(new Error("tool exploded")), "tool exploded");
    });

    it("preserves native abort and timeout DOMException messages", () => {
      assertEquals(
        stringifyToolError(new DOMException("client disconnected", "AbortError")),
        "client disconnected",
      );
      assertEquals(
        stringifyToolError(new DOMException("provider timed out", "TimeoutError")),
        "provider timed out",
      );
    });

    it("stringifies structured values as JSON", () => {
      assertEquals(
        stringifyToolError({ code: "E_TOOL", retryable: true }),
        '{"code":"E_TOOL","retryable":true}',
      );
    });

    it("retains safe fields when structured diagnostics contain unsupported values", () => {
      assertEquals(
        stringifyToolError({
          code: "E_TOOL",
          detail: undefined,
          occurredAt: new Date("2026-08-03T00:00:00.000Z"),
        }),
        '{"code":"E_TOOL","occurredAt":"2026-08-03T00:00:00.000Z"}',
      );
    });

    it("bounds serialized structured values after JSON escaping", () => {
      const value = { details: "\u0000".repeat(MAX_TOOL_ERROR_TEXT_BYTES) };
      const result = stringifyToolError(value);

      assertEquals(
        new TextEncoder().encode(result).byteLength <= MAX_TOOL_ERROR_TEXT_BYTES,
        true,
      );
      assertStringIncludes(result, '"details"');
    });

    it("bounds best-effort string leaves before JSON serialization", () => {
      const result = stringifyToolError({
        code: "E_TOOL",
        detail: "x".repeat(MAX_TOOL_ERROR_TEXT_BYTES * 1_024),
        unsupported: undefined,
      });

      assertEquals(new TextEncoder().encode(result).byteLength <= MAX_TOOL_ERROR_TEXT_BYTES, true);
      assertStringIncludes(result, '"code":"E_TOOL"');
      assertStringIncludes(result, "…");
    });

    it("uses a stable fallback when safe JSON serialization fails", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      assertEquals(stringifyToolError(circular), "Unknown error");
    });

    it("does not invoke getters or custom serialization and coercion hooks", () => {
      let calls = 0;
      const hostile = {
        get message(): string {
          calls += 1;
          return "getter executed";
        },
        toJSON(): string {
          calls += 1;
          return "serializer executed";
        },
        [Symbol.toPrimitive](): string {
          calls += 1;
          return "coercion executed";
        },
      };

      assertEquals(stringifyToolError(hostile), "Unknown error");
      assertEquals(calls, 0);
    });

    it("retains safe siblings without invoking unsupported diagnostic branches", () => {
      let calls = 0;
      const diagnostic = Object.defineProperty({ code: "E_TOOL" }, "detail", {
        enumerable: true,
        get() {
          calls += 1;
          return "private";
        },
      });

      assertEquals(stringifyToolError(diagnostic), '{"code":"E_TOOL"}');
      assertEquals(calls, 0);
    });

    it("shadows inherited array toJSON in best-effort diagnostics", () => {
      const defineProperty = Object.defineProperty;
      const deleteProperty = Reflect.deleteProperty;
      const original = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
      let calls = 0;
      let result: string | undefined;

      try {
        defineProperty(Array.prototype, "toJSON", {
          configurable: true,
          value() {
            calls += 1;
            return "mutated-array";
          },
          writable: true,
        });

        result = stringifyToolError({
          code: "E_TOOL",
          details: ["safe", 1],
          skipped: undefined,
        });
      } finally {
        if (original) {
          defineProperty(Array.prototype, "toJSON", original);
        } else {
          deleteProperty(Array.prototype, "toJSON");
        }
      }

      assertEquals(result, '{"code":"E_TOOL","details":["safe",1]}');
      assertEquals(calls, 0);
    });

    it("fails closed for revoked proxies", () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();

      assertEquals(stringifyToolError(proxy), "Unknown error");
    });

    it("fails closed for active proxies without invoking traps", () => {
      let calls = 0;
      const proxy = new Proxy({}, {
        get(target, property, receiver) {
          calls += 1;
          return Reflect.get(target, property, receiver);
        },
        getOwnPropertyDescriptor(target, property) {
          calls += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
        getPrototypeOf(target) {
          calls += 1;
          return Reflect.getPrototypeOf(target);
        },
        ownKeys(target) {
          calls += 1;
          return Reflect.ownKeys(target);
        },
      });

      assertEquals(stringifyToolError(proxy), "Unknown error");
      assertEquals(calls, 0);
    });

    it("fails closed without Proxy introspection in a fresh Cloudflare process", async () => {
      const script = `
        Object.defineProperty(globalThis, "caches", {
          configurable: true,
          value: {},
        });
        Object.defineProperty(globalThis, "WebSocketPair", {
          configurable: true,
          value: function WebSocketPair() {},
        });

        const { runtimeKind } = await import("./src/platform/compat/runtime.ts");
        const {
          canIdentifyProxyWithoutHooks,
          isNativeErrorWithoutHooks,
        } = await import("./src/platform/compat/error-introspection.ts");
        const { stringifyToolError } = await import("./src/agent/runtime/error-utils.ts");

        let calls = 0;
        const handler = {
          get(target, property, receiver) {
            calls += 1;
            return Reflect.get(target, property, receiver);
          },
          getOwnPropertyDescriptor(target, property) {
            calls += 1;
            return Reflect.getOwnPropertyDescriptor(target, property);
          },
          getPrototypeOf(target) {
            calls += 1;
            return Reflect.getPrototypeOf(target);
          },
          ownKeys(target) {
            calls += 1;
            return Reflect.ownKeys(target);
          },
        };
        const proxy = new Proxy({}, handler);
        const errorProxy = new Proxy(new Error("private"), handler);

        const result = {
          runtimeKind,
          canIdentifyProxyWithoutHooks,
          proxy: stringifyToolError(proxy),
          errorProxy: stringifyToolError(errorProxy),
          calls,
          nativeError: isNativeErrorWithoutHooks(new Error("native")),
          error: stringifyToolError(new Error("tool exploded")),
          domException: stringifyToolError(
            new DOMException("provider timed out", "TimeoutError"),
          ),
          object: stringifyToolError({ code: "E_TOOL" }),
          callable: stringifyToolError(() => undefined),
          nullValue: stringifyToolError(null),
          booleanValue: stringifyToolError(true),
          numberValue: stringifyToolError(42),
          undefinedValue: stringifyToolError(undefined),
          bigintValue: stringifyToolError(1n),
          symbolValue: stringifyToolError(Symbol("private")),
        };
        console.log(JSON.stringify(result));
      `;
      const output = await new Deno.Command(Deno.execPath(), {
        args: ["eval", "--config=deno.json", script],
        cwd: new URL("../../../", import.meta.url),
        stdout: "piped",
        stderr: "piped",
      }).output();
      const stderr = new TextDecoder().decode(output.stderr);
      assertEquals(output.code, 0, stderr);

      const result = JSON.parse(new TextDecoder().decode(output.stdout));
      assertEquals(result, {
        runtimeKind: "cloudflare",
        canIdentifyProxyWithoutHooks: false,
        proxy: "Unknown error",
        errorProxy: "Unknown error",
        calls: 0,
        nativeError: true,
        error: "tool exploded",
        domException: "provider timed out",
        object: "Unknown error",
        callable: "Unknown error",
        nullValue: "null",
        booleanValue: "true",
        numberValue: "42",
        undefinedValue: "undefined",
        bigintValue: "bigint",
        symbolValue: "symbol",
      });
    });

    it("uses captured primordials for native and primitive diagnostics", () => {
      const defineProperty = Object.defineProperty;
      const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
      const descriptors = {
        apply: getOwnPropertyDescriptor(Reflect, "apply")!,
        charCodeAt: getOwnPropertyDescriptor(String.prototype, "charCodeAt")!,
        domMessage: getOwnPropertyDescriptor(DOMException.prototype, "message")!,
        getOwnPropertyDescriptor: getOwnPropertyDescriptor(
          Object,
          "getOwnPropertyDescriptor",
        )!,
        hasOwnProperty: getOwnPropertyDescriptor(
          Object.prototype,
          "hasOwnProperty",
        )!,
        jsonStringify: getOwnPropertyDescriptor(JSON, "stringify")!,
        slice: getOwnPropertyDescriptor(String.prototype, "slice")!,
      };
      const domException = new DOMException("provider timed out", "TimeoutError");
      const oversized = "é".repeat(MAX_TOOL_ERROR_TEXT_BYTES);
      let hookCalls = 0;
      const hostile = () => {
        hookCalls += 1;
        throw new Error("mutable primordial must not run");
      };
      let result:
        | {
          bounded: string;
          domException: string;
          error: string;
          nullValue: string;
        }
        | undefined;

      try {
        for (
          const [owner, key] of [
            [Reflect, "apply"],
            [String.prototype, "charCodeAt"],
            [DOMException.prototype, "message"],
            [Object, "getOwnPropertyDescriptor"],
            [Object.prototype, "hasOwnProperty"],
            [JSON, "stringify"],
            [String.prototype, "slice"],
          ] as const
        ) {
          defineProperty(owner, key, {
            configurable: true,
            value: hostile,
            writable: true,
          });
        }

        result = {
          bounded: stringifyToolError(oversized),
          domException: stringifyToolError(domException),
          error: stringifyToolError(new Error("tool exploded")),
          nullValue: stringifyToolError(null),
        };
      } finally {
        defineProperty(Reflect, "apply", descriptors.apply);
        defineProperty(String.prototype, "charCodeAt", descriptors.charCodeAt);
        defineProperty(DOMException.prototype, "message", descriptors.domMessage);
        defineProperty(
          Object,
          "getOwnPropertyDescriptor",
          descriptors.getOwnPropertyDescriptor,
        );
        defineProperty(
          Object.prototype,
          "hasOwnProperty",
          descriptors.hasOwnProperty,
        );
        defineProperty(JSON, "stringify", descriptors.jsonStringify);
        defineProperty(String.prototype, "slice", descriptors.slice);
      }

      assertEquals(result?.error, "tool exploded");
      assertEquals(result?.domException, "provider timed out");
      assertEquals(result?.nullValue, "null");
      assertEquals(
        new TextEncoder().encode(result?.bounded).byteLength <= MAX_TOOL_ERROR_TEXT_BYTES,
        true,
      );
      assertEquals(hookCalls, 0);
    });

    it("does not consult mutable primordials while snapshotting structured errors", () => {
      const defineProperty = Object.defineProperty;
      const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
      const targets: ReadonlyArray<readonly [object, PropertyKey]> = [
        [Array, "isArray"],
        [Array.prototype, "push"],
        [Array.prototype, "sort"],
        [JSON, "stringify"],
        [Number, "isFinite"],
        [Number, "isInteger"],
        [Number, "isSafeInteger"],
        [Object, "create"],
        [Object, "defineProperty"],
        [Object, "freeze"],
        [Object, "getOwnPropertyDescriptor"],
        [Object, "getPrototypeOf"],
        [Object, "is"],
        [Object, "keys"],
        [Object.prototype, "hasOwnProperty"],
        [Reflect, "apply"],
        [Reflect, "ownKeys"],
        [String.prototype, "charCodeAt"],
        [WeakSet.prototype, "add"],
        [WeakSet.prototype, "delete"],
        [WeakSet.prototype, "has"],
        [globalThis, "Array"],
        [globalThis, "Number"],
        [globalThis, "String"],
        [globalThis, "TypeError"],
        [globalThis, "WeakSet"],
      ];
      const originals = targets.map(([owner, key]) => ({
        key,
        owner,
        descriptor: getOwnPropertyDescriptor(owner, key)!,
      }));
      const structuredError = {
        retryable: true,
        details: ["safe", 1],
        code: "E_TOOL",
      };
      let hookCalls = 0;
      let result: string | undefined;

      try {
        for (let index = 0; index < originals.length; index += 1) {
          const { owner, key } = originals[index]!;
          const label = typeof key === "string" ? key : "Symbol.iterator";
          defineProperty(owner, key, {
            configurable: true,
            value: () => {
              hookCalls += 1;
              throw new Error(`mutable primordial ${label} must not run`);
            },
            writable: true,
          });
        }
        result = stringifyToolError(structuredError);
      } finally {
        for (let index = 0; index < originals.length; index += 1) {
          const { owner, key, descriptor } = originals[index]!;
          defineProperty(owner, key, descriptor);
        }
      }

      assertEquals(
        result,
        '{"code":"E_TOOL","details":["safe",1],"retryable":true}',
      );
      assertEquals(hookCalls, 0);
    });

    it("avoids Array iterators and inherited numeric setters in a fresh process", async () => {
      const script = `
        const { stringifyToolError } = await import(
          "./src/agent/runtime/error-utils.ts"
        );
        const defineProperty = Object.defineProperty;
        const deleteProperty = Reflect.deleteProperty;
        const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
        const iteratorDescriptor = getOwnPropertyDescriptor(
          Array.prototype,
          Symbol.iterator,
        );
        const indexDescriptor = getOwnPropertyDescriptor(Array.prototype, "0");
        const structuredError = {
          retryable: true,
          details: ["safe", 1],
          code: "E_TOOL",
        };
        let iteratorCalls = 0;
        let inheritedSetterCalls = 0;
        let result;

        try {
          defineProperty(Array.prototype, Symbol.iterator, {
            configurable: true,
            value() {
              iteratorCalls += 1;
              throw new Error("Array iterator must not run");
            },
            writable: true,
          });
          defineProperty(Array.prototype, "0", {
            configurable: true,
            set() {
              inheritedSetterCalls += 1;
            },
          });
          result = stringifyToolError(structuredError);
        } finally {
          if (iteratorDescriptor) {
            defineProperty(Array.prototype, Symbol.iterator, iteratorDescriptor);
          }
          if (indexDescriptor) {
            defineProperty(Array.prototype, "0", indexDescriptor);
          } else {
            deleteProperty(Array.prototype, "0");
          }
        }

        console.log(JSON.stringify({
          inheritedSetterCalls,
          iteratorCalls,
          result,
        }));
      `;
      const output = await new Deno.Command(Deno.execPath(), {
        args: ["eval", "--config=deno.json", script],
        cwd: new URL("../../../", import.meta.url),
        stdout: "piped",
        stderr: "piped",
      }).output();
      const stderr = new TextDecoder().decode(output.stderr);
      assertEquals(output.code, 0, stderr);
      assertEquals(
        JSON.parse(new TextDecoder().decode(output.stdout)),
        {
          inheritedSetterCalls: 0,
          iteratorCalls: 0,
          result: '{"code":"E_TOOL","details":["safe",1],"retryable":true}',
        },
      );
    });

    it("bounds direct and Error diagnostic text by UTF-8 byte length", () => {
      const oversized = "é".repeat(MAX_TOOL_ERROR_TEXT_BYTES);
      const direct = stringifyToolError(oversized);
      const fromError = stringifyToolError(new Error(oversized));

      assertEquals(new TextEncoder().encode(direct).byteLength <= MAX_TOOL_ERROR_TEXT_BYTES, true);
      assertEquals(
        new TextEncoder().encode(fromError).byteLength <= MAX_TOOL_ERROR_TEXT_BYTES,
        true,
      );
      assertStringIncludes(direct, "…");
      assertStringIncludes(fromError, "…");
    });
  });
});
