import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createError,
  ensureBrowserError,
  snapshotBrowserThrowableDiagnostic,
  toError,
} from "./browser-error.ts";

describe("browser error normalization", () => {
  it("snapshots primitive browser throwables through the bounded diagnostic policy", () => {
    assertEquals(snapshotBrowserThrowableDiagnostic("failure"), "failure");
    assertEquals(snapshotBrowserThrowableDiagnostic(42), "42");
    assertEquals(
      snapshotBrowserThrowableDiagnostic(
        "postgres://admin:super-secret-value@db.internal/app",
      ),
      "postgres://admin:[REDACTED]@db.internal/app",
    );

    const bounded = snapshotBrowserThrowableDiagnostic("x".repeat(4_096));
    assertEquals(bounded.length, 2_048);
    assert(bounded.endsWith("...[truncated]"));
  });

  it("snapshots browser Errors only through the safe captured brand", () => {
    assertEquals(
      snapshotBrowserThrowableDiagnostic(new TypeError("invalid value")),
      typeof Error.isError === "function" ? "invalid value" : "Unknown error",
    );
  });

  it("does not invoke object hooks while snapshotting a browser throwable", () => {
    let coercionCalls = 0;
    let messageReads = 0;
    const hostile = Object.defineProperties({}, {
      message: {
        get(): never {
          messageReads += 1;
          throw new Error("message getter must not run");
        },
      },
      [Symbol.toPrimitive]: {
        value(): never {
          coercionCalls += 1;
          throw new Error("conversion hook must not run");
        },
      },
    });

    assertEquals(snapshotBrowserThrowableDiagnostic(hostile), "Unknown error");
    assertEquals(messageReads, 0);
    assertEquals(coercionCalls, 0);
  });

  it("detaches ordinary Errors and constructs legacy Veryfront errors", () => {
    const source = new TypeError("invalid value");
    const normalized = ensureBrowserError(source);
    assert(normalized !== source);
    assertEquals(normalized.name, "Error");
    assertEquals(
      normalized.message,
      typeof Error.isError === "function" ? "invalid value" : "Unknown error",
    );

    const data = createError({ type: "agent", message: "agent failed" });
    const constructed = toError(data);
    assertEquals(constructed.name, "VeryfrontError[agent]");
    assertEquals(constructed.message, "agent failed");
    assertEquals(
      Object.getOwnPropertyDescriptor(constructed, "context"),
      {
        configurable: true,
        enumerable: false,
        value: data,
        writable: false,
      },
    );
  });

  it("does not invoke object conversion hooks while normalizing", () => {
    let coercionCalls = 0;
    const hostile = {
      [Symbol.toPrimitive](): never {
        coercionCalls += 1;
        throw new Error("conversion hook must not run");
      },
    };

    const normalized = ensureBrowserError(hostile);

    assertEquals(normalized.message, "Unknown error");
    assertEquals(coercionCalls, 0);
  });

  it("does not retain accessor-backed fields or inherited descriptor values", () => {
    const source = new Error("private");
    let messageReads = 0;
    Object.defineProperty(source, "message", {
      configurable: true,
      get(): never {
        messageReads += 1;
        throw new Error("message accessor must not run");
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

    let normalized: Error | undefined;
    try {
      normalized = ensureBrowserError(source);
    } finally {
      if (previousValue) {
        Object.defineProperty(Object.prototype, "value", previousValue);
      } else {
        Reflect.deleteProperty(Object.prototype, "value");
      }
    }

    assert(normalized !== source);
    assertEquals(normalized?.name, "Error");
    assertEquals(normalized?.message, "Unknown error");
    assertEquals(messageReads, 0);
    assertEquals(inheritedValueReads, 0);
  });

  it("treats proxied Errors as opaque when Error.isError is available", () => {
    if (typeof Error.isError !== "function") return;
    let trapCalls = 0;
    const proxied = new Proxy(new Error("private"), {
      getPrototypeOf(): never {
        trapCalls += 1;
        throw new Error("prototype trap must not run");
      },
    });

    const normalized = ensureBrowserError(proxied);

    assert(normalized !== proxied);
    assertEquals(normalized.message, "Unknown error");
    assertEquals(trapCalls, 0);
  });

  it("fails closed without Error.isError instead of traversing Error proxies", async () => {
    const previous = Object.getOwnPropertyDescriptor(Error, "isError");
    Object.defineProperty(Error, "isError", {
      configurable: true,
      value: undefined,
      writable: true,
    });

    let isolated: typeof import("./browser-error.ts") | undefined;
    try {
      isolated = await import("./browser-error.ts?without-error-is-error");
    } finally {
      if (previous) {
        Object.defineProperty(Error, "isError", previous);
      } else {
        Reflect.deleteProperty(Error, "isError");
      }
    }

    let trapCalls = 0;
    const proxied = new Proxy(new Error("private"), {
      getPrototypeOf(): never {
        trapCalls += 1;
        throw new Error("prototype trap must not run");
      },
    });
    const normalized = isolated?.ensureBrowserError(proxied);

    assertEquals(normalized?.message, "Unknown error");
    assertEquals(trapCalls, 0);
  });

  it("does not invoke a replaced Error.captureStackTrace accessor", async () => {
    const previous = Object.getOwnPropertyDescriptor(Error, "captureStackTrace");
    let accessorCalls = 0;
    Object.defineProperty(Error, "captureStackTrace", {
      configurable: true,
      get(): never {
        accessorCalls += 1;
        throw new Error("captureStackTrace accessor must not run");
      },
    });

    let isolated: typeof import("./legacy-error-construction.ts") | undefined;
    try {
      isolated = await import(
        "./legacy-error-construction.ts?hostile-capture-stack-trace"
      );
    } finally {
      if (previous) {
        Object.defineProperty(Error, "captureStackTrace", previous);
      } else {
        Reflect.deleteProperty(Error, "captureStackTrace");
      }
    }

    const constructed = isolated?.toError({
      type: "agent",
      message: "agent failed",
    });
    assertEquals(constructed?.name, "VeryfrontError[agent]");
    assertEquals(accessorCalls, 0);
  });
});
