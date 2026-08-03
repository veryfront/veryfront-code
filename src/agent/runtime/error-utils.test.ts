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
