import "#veryfront/schemas/_test-setup.ts";
import { API_CLIENT_ERROR } from "#veryfront/errors";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  MAX_STRING_DISPLAY_LENGTH,
  MAX_TRACE_ATTRIBUTE_VALUE_SIZE,
} from "#veryfront/utils/constants/index.ts";
import {
  MAX_STRUCTURED_TELEMETRY_CONTAINER_ENTRIES,
  MAX_TELEMETRY_ATTRIBUTE_COUNT,
  MAX_TELEMETRY_ATTRIBUTE_KEY_LENGTH,
} from "./limits.ts";
import {
  sanitizeErrorForTelemetry,
  sanitizeStructuredTelemetryData,
  sanitizeTelemetryAttributes,
  type TelemetryAttributeValue,
  telemetryErrorType,
} from "./telemetry-error.ts";
import { isNativeErrorWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

describe("observability/telemetry-error", () => {
  it("sanitizes hostile flattened attributes without throwing", () => {
    const attributes: Record<string, string> = { safe: "value" };
    Object.defineProperty(attributes, "detail", {
      enumerable: true,
      get() {
        throw new Error("hostile attribute getter");
      },
    });
    Object.defineProperty(attributes, "apiKey", {
      enumerable: true,
      get() {
        throw new Error("secret getter must not run");
      },
    });

    assertEquals(sanitizeTelemetryAttributes(attributes), {
      safe: "value",
      detail: "[REDACTED]",
      apiKey: "[REDACTED]",
    });
  });

  it("returns an empty safe attribute record when enumeration is hostile", () => {
    const attributes = new Proxy({}, {
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });

    assertEquals(sanitizeTelemetryAttributes(attributes), {});
  });

  it("preserves numeric semantic token counts while redacting token secrets", () => {
    const attributes: Record<string, TelemetryAttributeValue> = {
      "gen_ai.usage.input_tokens": 2,
      "gen_ai.usage.output_tokens": 3,
      "gen_ai.usage.total_tokens": 5,
      token: 12345,
      "gen_ai.usage.prompt_tokens": "secret",
    };

    assertEquals(
      sanitizeTelemetryAttributes(attributes),
      {
        "gen_ai.usage.input_tokens": 2,
        "gen_ai.usage.output_tokens": 3,
        "gen_ai.usage.total_tokens": 5,
        token: "[REDACTED]",
        "gen_ai.usage.prompt_tokens": "[REDACTED]",
      },
    );
  });

  it("sanitizes values with hostile prototype inspection without throwing", () => {
    let proxyTrapCalls = 0;
    const hostile = new Proxy({}, {
      getPrototypeOf() {
        proxyTrapCalls++;
        throw new Error("prototype unavailable");
      },
      get() {
        proxyTrapCalls++;
        throw new Error("property unavailable");
      },
      getOwnPropertyDescriptor() {
        proxyTrapCalls++;
        throw new Error("descriptor unavailable");
      },
      ownKeys() {
        proxyTrapCalls++;
        throw new Error("keys unavailable");
      },
    });

    const sanitized = sanitizeErrorForTelemetry(hostile);

    assertEquals(sanitized.name, "Unknown");
    assertEquals(sanitized.message, "Unknown error");
    assertEquals(proxyTrapCalls, 0);
  });

  it("snapshots native errors without invoking project-owned accessors", () => {
    let accessorCalls = 0;
    const hostile = new Error("must stay private");
    Reflect.deleteProperty(hostile, "stack");
    for (const key of ["stack", "message", "name"] as const) {
      Object.defineProperty(hostile, key, {
        configurable: true,
        get(): never {
          accessorCalls += 1;
          throw new Error(`${key} accessor must not run`);
        },
      });
    }

    const sanitized = sanitizeErrorForTelemetry(hostile);

    assertEquals(sanitized.name, "Error");
    assertEquals(sanitized.message, "Unknown error");
    assertEquals(accessorCalls, 0);
  });

  it("classifies only own data error codes without invoking accessors", () => {
    const coded = new Error("temporary network failure");
    Object.defineProperty(coded, "code", {
      configurable: true,
      value: "ECONNRESET",
      writable: true,
    });

    assertEquals(telemetryErrorType(coded), "ECONNRESET");

    let accessorCalls = 0;
    const accessorBacked = new Error("private failure");
    Object.defineProperty(accessorBacked, "code", {
      configurable: true,
      get(): never {
        accessorCalls += 1;
        throw new Error("private code accessor must not run");
      },
    });

    assertEquals(telemetryErrorType(accessorBacked), "Error");
    assertEquals(accessorCalls, 0);
  });

  it("classifies VeryfrontError status through a safe snapshot", () => {
    assertEquals(
      telemetryErrorType(API_CLIENT_ERROR.create({ detail: "request failed" })),
      "VeryfrontError:500",
    );

    let statusReads = 0;
    const accessorBacked = API_CLIENT_ERROR.create({ detail: "private detail" });
    Object.defineProperty(accessorBacked, "status", {
      configurable: true,
      get(): never {
        statusReads += 1;
        throw new Error("private status accessor must not run");
      },
    });

    assertEquals(telemetryErrorType(accessorBacked), "Error");
    assertEquals(statusReads, 0);
  });

  it("ignores inherited descriptor values without invoking accessors", () => {
    const hostile = new Error("must stay private");
    let errorAccessorCalls = 0;
    Object.defineProperty(hostile, "message", {
      configurable: true,
      get(): never {
        errorAccessorCalls += 1;
        throw new Error("error accessor must not run");
      },
    });

    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    let inheritedValueCalls = 0;
    let sanitized: Error | undefined;
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      get(): never {
        inheritedValueCalls += 1;
        throw new Error("inherited descriptor value must not run");
      },
    });

    try {
      sanitized = sanitizeErrorForTelemetry(hostile);
    } finally {
      if (previous) {
        Object.defineProperty(Object.prototype, "value", previous);
      } else {
        delete (Object.prototype as Record<string, unknown>).value;
      }
    }

    assertEquals(sanitized?.name, "Error");
    assertEquals(sanitized?.message, "Unknown error");
    assertEquals(errorAccessorCalls, 0);
    assertEquals(inheritedValueCalls, 0);
  });

  it("survives inherited property-descriptor poisoning without running the getter", () => {
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "enumerable");
    let getterCalls = 0;
    let sanitized: Error | undefined;
    let failure: unknown;
    Object.defineProperty(Object.prototype, "enumerable", {
      configurable: true,
      get(): never {
        getterCalls += 1;
        throw new Error("inherited descriptor getter must not run");
      },
    });

    try {
      sanitized = sanitizeErrorForTelemetry(new Error("application failure"));
    } catch (error) {
      failure = error;
    } finally {
      if (previous) {
        Object.defineProperty(Object.prototype, "enumerable", previous);
      } else {
        delete (Object.prototype as Record<string, unknown>).enumerable;
      }
    }

    assertEquals(failure, undefined);
    assertEquals(getterCalls, 0);
    assertEquals(sanitized?.name, "Error");
    assertEquals(sanitized?.message, "application failure");
  });

  it("uses captured string slicing while redacting and bounding error messages", () => {
    const previous = Object.getOwnPropertyDescriptor(String.prototype, "slice");
    let sliceCalls = 0;
    let sanitized: Error | undefined;
    let failure: unknown;
    Object.defineProperty(String.prototype, "slice", {
      configurable: true,
      value: () => {
        sliceCalls += 1;
        throw new Error("poisoned String.prototype.slice");
      },
      writable: true,
    });

    try {
      sanitized = sanitizeErrorForTelemetry(
        new Error(
          `https://user:password@example.test/${"x".repeat(MAX_STRING_DISPLAY_LENGTH + 1)}`,
        ),
      );
    } catch (error) {
      failure = error;
    } finally {
      if (previous) Object.defineProperty(String.prototype, "slice", previous);
    }

    assertEquals(failure, undefined);
    assertEquals(sliceCalls, 0);
    assertEquals(sanitized?.name, "Error");
    assertEquals(sanitized?.message.length, MAX_STRING_DISPLAY_LENGTH);
    assertEquals(sanitized?.message.includes("password"), false);
  });

  it("uses captured slicing while bounding flattened attribute keys", () => {
    const previousStringSlice = Object.getOwnPropertyDescriptor(String.prototype, "slice");
    const previousArraySlice = Object.getOwnPropertyDescriptor(Array.prototype, "slice");
    const key = "k".repeat(MAX_TELEMETRY_ATTRIBUTE_KEY_LENGTH + 1);
    let sliceCalls = 0;
    let snapshot: Record<string, TelemetryAttributeValue> | undefined;
    let failure: unknown;
    const poisonedSlice = () => {
      sliceCalls += 1;
      throw new Error("poisoned slice must not run");
    };
    Object.defineProperty(String.prototype, "slice", {
      configurable: true,
      value: poisonedSlice,
      writable: true,
    });
    Object.defineProperty(Array.prototype, "slice", {
      configurable: true,
      value: poisonedSlice,
      writable: true,
    });

    try {
      snapshot = sanitizeTelemetryAttributes({ [key]: "value" });
    } catch (error) {
      failure = error;
    } finally {
      if (previousStringSlice) {
        Object.defineProperty(String.prototype, "slice", previousStringSlice);
      }
      if (previousArraySlice) {
        Object.defineProperty(Array.prototype, "slice", previousArraySlice);
      }
    }

    const retainedKeys = Object.keys(snapshot ?? {});
    assertEquals(failure, undefined);
    assertEquals(sliceCalls, 0);
    assertEquals(retainedKeys.length, 1);
    assertEquals(retainedKeys[0]?.length, MAX_TELEMETRY_ATTRIBUTE_KEY_LENGTH);
    assertEquals(snapshot?.[retainedKeys[0] ?? ""], "value");
  });

  it("never materializes a stack through Error.prepareStackTrace", () => {
    const ErrorWithStackFormatter = Error as ErrorConstructor & {
      prepareStackTrace?: (error: Error, callSites: unknown[]) => unknown;
    };
    const previous = Object.getOwnPropertyDescriptor(ErrorWithStackFormatter, "prepareStackTrace");
    let formatterCalls = 0;
    let sanitized: Error | undefined;
    Object.defineProperty(ErrorWithStackFormatter, "prepareStackTrace", {
      configurable: true,
      value: () => {
        formatterCalls += 1;
        throw new Error("prepareStackTrace must not run");
      },
      writable: true,
    });

    try {
      sanitized = sanitizeErrorForTelemetry(new Error("application failure"));
    } finally {
      if (previous) {
        Object.defineProperty(ErrorWithStackFormatter, "prepareStackTrace", previous);
      } else {
        delete ErrorWithStackFormatter.prepareStackTrace;
      }
    }

    assertEquals(formatterCalls, 0);
    assertEquals(sanitized?.message, "application failure");
    assertEquals(typeof sanitized?.stack, "string");
    assertEquals(sanitized?.stack?.includes("application failure"), true);
    assertEquals(sanitized instanceof Error, true);
  });

  it("preserves a real thrown error's stack", () => {
    function telemetryStackProbeFrame(): never {
      throw new Error("stack round trip");
    }

    let thrown: unknown;
    try {
      telemetryStackProbeFrame();
    } catch (error) {
      thrown = error;
    }

    const sanitized = sanitizeErrorForTelemetry(thrown);

    assertEquals(sanitized.message, "stack round trip");
    assertEquals(typeof sanitized.stack, "string");
    assertEquals(sanitized.stack?.includes("telemetryStackProbeFrame"), true);
  });

  it("bounds a real thrown error's stack", () => {
    const source = new Error("bounded stack");
    const nativeStack = source.stack ?? "";
    Object.defineProperty(source, "message", {
      configurable: true,
      value: "bounded stack",
      writable: true,
    });

    const sanitized = sanitizeErrorForTelemetry(source);

    assertEquals(typeof sanitized.stack, "string");
    assertEquals((sanitized.stack ?? "").length <= MAX_STRING_DISPLAY_LENGTH, true);
    assertEquals(nativeStack.length > 0, true);
  });

  it("fails closed for a stack accessor it did not install", () => {
    const source = new Error("hostile stack accessor");
    let getterCalls = 0;
    Object.defineProperty(source, "stack", {
      configurable: true,
      get() {
        getterCalls += 1;
        return "attacker controlled stack";
      },
    });

    const sanitized = sanitizeErrorForTelemetry(source);

    assertEquals(getterCalls, 0);
    assertEquals(sanitized.message, "hostile stack accessor");
    assertEquals(sanitized.stack, undefined);
  });

  it("skips the stack rather than let header formatting run a message accessor", () => {
    const source = new Error("formatting trigger");
    let messageCalls = 0;
    Object.defineProperty(source, "message", {
      configurable: true,
      get(): never {
        messageCalls += 1;
        throw new Error("message accessor must not run");
      },
    });

    const sanitized = sanitizeErrorForTelemetry(source);

    assertEquals(messageCalls, 0);
    assertEquals(sanitized.stack, undefined);
  });

  it("does not trust Error.isError when probing stack descriptor behavior", async () => {
    const ErrorWithStackFormatter = Error as ErrorConstructor & {
      isError?: unknown;
      prepareStackTrace?: (error: Error, callSites: unknown[]) => unknown;
    };
    const previousIsError = Object.getOwnPropertyDescriptor(ErrorWithStackFormatter, "isError");
    const previousFormatter = Object.getOwnPropertyDescriptor(
      ErrorWithStackFormatter,
      "prepareStackTrace",
    );
    const previousValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    let isErrorCalls = 0;
    let formatterCalls = 0;
    let inheritedValueCalls = 0;
    const fakeIsError = () => {
      isErrorCalls += 1;
      return true;
    };
    const hostileFormatter = () => {
      formatterCalls += 1;
      throw new Error("prepareStackTrace must not run");
    };
    Object.defineProperty(ErrorWithStackFormatter, "isError", {
      configurable: true,
      value: fakeIsError,
      writable: true,
    });
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

    let sanitized: Error | undefined;
    let restoredFormatter: unknown;
    try {
      const isolated = await import("./telemetry-error.ts?hostile-stack-capability-flags");
      restoredFormatter = Object.getOwnPropertyDescriptor(
        ErrorWithStackFormatter,
        "prepareStackTrace",
      )?.value;
      sanitized = isolated.sanitizeErrorForTelemetry(new Error("application failure"));
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
      if (previousIsError) {
        Object.defineProperty(ErrorWithStackFormatter, "isError", previousIsError);
      } else {
        delete (ErrorWithStackFormatter as unknown as { isError?: unknown }).isError;
      }
    }

    assertEquals(restoredFormatter, hostileFormatter);
    assertEquals(isErrorCalls, 0);
    assertEquals(formatterCalls, 0);
    assertEquals(inheritedValueCalls, 0);
    assertEquals(sanitized?.name, "Error");
    assertEquals(sanitized?.message, "application failure");
  });

  it("groups safe built-in, DOM, custom, and framework errors", () => {
    class CustomError extends Error {}
    class HostileConstructorError extends Error {}
    class NamedCustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "NamedCustomError";
      }
    }

    let constructorReads = 0;
    Object.defineProperty(HostileConstructorError.prototype, "constructor", {
      configurable: true,
      get(): never {
        constructorReads += 1;
        throw new Error("custom constructor getter must not run");
      },
    });

    const aggregate = sanitizeErrorForTelemetry(
      new AggregateError([new Error("nested secret")], "aggregate failure"),
    );
    const custom = sanitizeErrorForTelemetry(new CustomError("custom failure"));
    const hostileConstructor = sanitizeErrorForTelemetry(
      new HostileConstructorError("hostile constructor failure"),
    );
    const named = sanitizeErrorForTelemetry(new NamedCustomError("named failure"));
    const dom = sanitizeErrorForTelemetry(new DOMException("request stopped", "AbortError"));
    const framework = sanitizeErrorForTelemetry(
      API_CLIENT_ERROR.create({ detail: "upstream unavailable" }),
    );

    assertEquals(aggregate.name, "AggregateError");
    assertEquals(aggregate.message, "aggregate failure");
    assertEquals(custom.name, "CustomError");
    assertEquals(custom.message, "custom failure");
    assertEquals(hostileConstructor.name, "Error");
    assertEquals(hostileConstructor.message, "hostile constructor failure");
    assertEquals(named.name, "NamedCustomError");
    assertEquals(named.message, "named failure");
    assertEquals(
      dom.name,
      isNativeErrorWithoutHooks(new DOMException()) ? "DOMException" : "Unknown",
    );
    assertEquals(
      dom.message,
      isNativeErrorWithoutHooks(new DOMException()) ? "" : "Unknown error",
    );
    assertEquals(framework.name, "VeryfrontError");
    assertEquals(framework.message, "upstream unavailable");
    assertEquals(constructorReads, 0);
  });

  it("preserves native errors when the standard Error.isError entry point is unavailable", async () => {
    const previous = Object.getOwnPropertyDescriptor(Error, "isError");
    let proxyTrapCalls = 0;
    Object.defineProperty(Error, "isError", {
      configurable: true,
      value: undefined,
      writable: true,
    });

    try {
      const isolated = await import("./telemetry-error.ts?without-hook-free-error-brand-check");
      const native = isolated.sanitizeErrorForTelemetry(new Error("must stay opaque"));
      const proxy = isolated.sanitizeErrorForTelemetry(
        new Proxy({}, {
          get(): never {
            proxyTrapCalls += 1;
            throw new Error("get trap must not run");
          },
          getOwnPropertyDescriptor(): never {
            proxyTrapCalls += 1;
            throw new Error("descriptor trap must not run");
          },
          getPrototypeOf(): never {
            proxyTrapCalls += 1;
            throw new Error("prototype trap must not run");
          },
          ownKeys(): never {
            proxyTrapCalls += 1;
            throw new Error("keys trap must not run");
          },
        }),
      );

      assertEquals(native.name, "Error");
      assertEquals(native.message, "must stay opaque");
      assertEquals(proxy.name, "Unknown");
      assertEquals(proxy.message, "Unknown error");
      assertEquals(proxyTrapCalls, 0);
    } finally {
      if (previous) {
        Object.defineProperty(Error, "isError", previous);
      } else {
        delete (Error as unknown as { isError?: unknown }).isError;
      }
    }
  });

  it("deeply detaches structured data and sanitizes every serialized string", () => {
    const date = new Date("2025-01-02T03:04:05.000Z");
    const url = new URL("https://user:password@example.test/path?token=secret");
    const cycle: Record<string, unknown> = { safe: "cycle" };
    cycle.self = cycle;
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, "value", {
      enumerable: true,
      get() {
        throw new Error("hostile getter");
      },
    });

    const snapshot = sanitizeStructuredTelemetryData({
      message: "failed https://user:password@example.test/path?access_token=secret",
      apiKey: "must-not-be-read",
      date,
      url,
      scalarJson: {
        toJSON: () => "https://example.test/path?token=secret",
      },
      cycle,
      hostile,
    }) as Record<string, unknown>;

    assertEquals(String(snapshot.message).includes("secret"), false);
    assertEquals(snapshot.apiKey, "[REDACTED]");
    assertEquals(snapshot.date instanceof Date, true);
    assertEquals(snapshot.date === date, false);
    assertEquals(snapshot.url instanceof URL, true);
    assertEquals(snapshot.url === url, false);
    assertEquals((snapshot.url as URL).href.includes("secret"), false);
    assertEquals(String(snapshot.scalarJson).includes("secret"), false);
    assertEquals((snapshot.cycle as Record<string, unknown>).self, "[REDACTED]");
    assertEquals((snapshot.hostile as Record<string, unknown>).value, "[REDACTED]");

    const snapshotDate = snapshot.date as Date;
    snapshotDate.setUTCFullYear(2030);
    assertEquals(date.getUTCFullYear(), 2025);
    assertExists(snapshot.scalarJson);
  });

  it("redacts structured Error proxies without invoking traps", () => {
    let trapCalls = 0;
    const proxy = new Proxy(new Error("must stay private"), {
      get(): never {
        trapCalls += 1;
        throw new Error("get trap must not run");
      },
      getOwnPropertyDescriptor(): never {
        trapCalls += 1;
        throw new Error("descriptor trap must not run");
      },
      getPrototypeOf(): never {
        trapCalls += 1;
        throw new Error("prototype trap must not run");
      },
      ownKeys(): never {
        trapCalls += 1;
        throw new Error("ownKeys trap must not run");
      },
    });

    assertEquals(sanitizeStructuredTelemetryData(proxy) as unknown, "[REDACTED]");
    assertEquals(trapCalls, 0);
  });

  it("snapshots structured native errors without invoking field accessors", () => {
    const hostile = new Error("must stay private");
    Reflect.deleteProperty(hostile, "stack");
    let accessorCalls = 0;
    for (const key of ["message", "name", "stack"] as const) {
      Object.defineProperty(hostile, key, {
        configurable: true,
        get(): never {
          accessorCalls += 1;
          throw new Error(`${key} accessor must not run`);
        },
      });
    }

    assertEquals(sanitizeStructuredTelemetryData(hostile), {
      message: "Unknown error",
      name: "Error",
      stack: undefined,
    });
    assertEquals(accessorCalls, 0);
  });

  it("bounds flattened attribute count, keys, strings, and arrays", () => {
    const attributes: Record<string, TelemetryAttributeValue> = {
      first: "x".repeat(MAX_TRACE_ATTRIBUTE_VALUE_SIZE + 100),
      array: Array.from({ length: 200 }, () => "value"),
    };
    for (let index = 0; index < MAX_TELEMETRY_ATTRIBUTE_COUNT + 20; index++) {
      attributes[`attribute.${index}`] = index;
    }

    const snapshot = sanitizeTelemetryAttributes(attributes);
    assertEquals(Object.keys(snapshot).length, MAX_TELEMETRY_ATTRIBUTE_COUNT);
    assertEquals(
      (snapshot.first as string).length,
      MAX_TRACE_ATTRIBUTE_VALUE_SIZE,
    );
    assertEquals(snapshot.array, "[REDACTED]");
  });

  it("bounds structured telemetry returned by custom serializers", () => {
    let calls = 0;
    const wide = {
      toJSON() {
        calls++;
        return Array.from(
          { length: MAX_STRUCTURED_TELEMETRY_CONTAINER_ENTRIES + 1 },
          (_, index) => index,
        );
      },
    };

    assertEquals(sanitizeStructuredTelemetryData(wide) as unknown, "[REDACTED]");
    assertEquals(calls, 1);
    assertEquals(
      sanitizeStructuredTelemetryData("x".repeat(MAX_STRING_DISPLAY_LENGTH + 100)).length,
      MAX_STRING_DISPLAY_LENGTH,
    );
  });

  it("bounds own string-valued error messages and stacks", () => {
    const source = new Error("x".repeat(MAX_STRING_DISPLAY_LENGTH + 100));
    Object.defineProperty(source, "stack", {
      configurable: true,
      value: "s".repeat(MAX_STRING_DISPLAY_LENGTH + 100),
      writable: true,
    });

    const snapshot = sanitizeErrorForTelemetry(source);

    assertEquals(snapshot.message.length, MAX_STRING_DISPLAY_LENGTH);
    assertEquals(snapshot.stack?.length, MAX_STRING_DISPLAY_LENGTH);
  });
});
