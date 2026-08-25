import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { invokeGlobalErrorHandler, normalizeGlobalError } from "./global-error.ts";

describe("platform/compat/process/global-error", () => {
  it("preserves Error instances", () => {
    const expected = new Error("boom");
    assertStrictEquals(normalizeGlobalError(expected), expected);
  });

  it("normalizes primitive rejection reasons", () => {
    assertEquals(normalizeGlobalError("rejected").message, "rejected");
    assertEquals(normalizeGlobalError(42).message, "42");
    assertEquals(normalizeGlobalError(null).message, "null");
    assertEquals(normalizeGlobalError(undefined).message, "undefined");
  });

  it("does not invoke hostile object conversion hooks", () => {
    let conversionCalled = false;
    const hostile = {
      toString(): string {
        conversionCalled = true;
        throw new Error("must not run");
      },
      [Symbol.toPrimitive](): string {
        conversionCalled = true;
        throw new Error("must not run");
      },
    };

    const error = normalizeGlobalError(hostile);
    assertEquals(conversionCalled, false);
    assertEquals(error.message, "A non-Error object was thrown");
  });

  it("returns whether the callback handled the failure", () => {
    const error = new Error("boom");
    assertEquals(
      invokeGlobalErrorHandler(() => true, error, "uncaughtException"),
      true,
    );
    assertEquals(
      invokeGlobalErrorHandler(() => undefined, error, "unhandledRejection"),
      false,
    );
  });

  it("contains callback failures and reports a normalized Error", () => {
    const hostile = Object.create(null);
    let reported: Error | undefined;
    let reportedType: string | undefined;

    const handled = invokeGlobalErrorHandler(
      () => {
        throw hostile;
      },
      new Error("original"),
      "unhandledRejection",
      (error, type) => {
        reported = error;
        reportedType = type;
      },
    );

    assertEquals(handled, false);
    assertEquals(reported?.message, "A non-Error object was thrown");
    assertEquals(reportedType, "unhandledRejection");
  });

  it("default reporter survives a throwing message accessor", () => {
    const hostile = new Error("x");
    Object.defineProperty(hostile, "message", {
      get() {
        throw new Error("nope");
      },
    });
    const originalConsoleError = console.error;
    let captured = "";
    console.error = (msg: unknown) => {
      captured = String(msg);
    };
    try {
      assertEquals(
        invokeGlobalErrorHandler(
          () => {
            throw hostile;
          },
          new Error("original"),
          "uncaughtException",
        ),
        false,
        "a throwing message accessor must not escape the reporter",
      );
    } finally {
      console.error = originalConsoleError;
    }
    assertStringIncludes(
      captured,
      "Unknown handler failure",
      "the reporter falls back to a fixed message",
    );
    assertStringIncludes(captured, "uncaughtException", "the reporter names the global error type");
  });

  it("default reporter survives a replaced console", () => {
    const originalConsoleError = console.error;
    console.error = () => {
      throw new Error("console replaced");
    };
    try {
      assertEquals(
        invokeGlobalErrorHandler(
          () => {
            throw new Error("boom");
          },
          new Error("original"),
          "unhandledRejection",
        ),
        false,
        "a replaced console must not recurse into global error handling",
      );
    } finally {
      console.error = originalConsoleError;
    }
  });
});
