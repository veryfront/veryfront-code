import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runInNewContext } from "node:vm";
import {
  buildErrorDocsUrl,
  ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS,
  ERROR_DOCS_BASE_URL,
  ERROR_DOCS_SLUG_MAX_LENGTH_CHARS,
  ERROR_STACK_MAX_LENGTH_CHARS,
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
  sanitizeDiagnosticText,
  sanitizeStackDiagnosticText,
  sanitizeTerminalDiagnosticText,
  snapshotErrorForBoundary,
  snapshotErrorForLoggingBoundary,
  snapshotThrowableDiagnostic,
} from "./safe-diagnostics.ts";
import { VeryfrontError } from "./types.ts";

describe("safe-diagnostics", () => {
  it("should neutralize terminal controls and line injection in one diagnostic field", () => {
    const malicious = "before\x1b]2;owned\x07\x1b[2J\nFAKE SUCCESS";

    assertEquals(
      sanitizeTerminalDiagnosticText(malicious),
      "before FAKE SUCCESS",
    );
  });

  it("should redact credentials while neutralizing terminal controls", () => {
    const malicious = "Authorization: Bearer secret\x1b[2J\rforged";
    const sanitized = sanitizeTerminalDiagnosticText(malicious);

    assertEquals(sanitized.includes("secret"), false);
    assertEquals(sanitized.includes("\x1b[2J"), false);
    assertEquals(sanitized.includes("\r"), false);
  });

  it("should encode a hostile slug as one credential-scrubbed docs path segment", () => {
    const docsUrl = buildErrorDocsUrl(
      "../admin/path?token=secret#fragment%value\ud800",
    );
    const parsed = new URL(docsUrl);

    assertEquals(
      docsUrl,
      `${ERROR_DOCS_BASE_URL}..%2Fadmin%2Fpath%3Ftoken%3D%5BREDACTED%5D%23fragment%25value%EF%BF%BD`,
    );
    assertEquals(parsed.search, "");
    assertEquals(parsed.hash, "");
    assert(parsed.pathname.startsWith("/docs/errors/"));
    assertEquals(docsUrl.includes("secret"), false);
  });

  it("should keep exact dot segments under the error-docs path", () => {
    for (const slug of [".", ".."]) {
      const docsUrl = buildErrorDocsUrl(slug);
      const parsed = new URL(docsUrl);

      assertEquals(
        docsUrl,
        `${ERROR_DOCS_BASE_URL}unknown-error`,
      );
      assert(parsed.pathname.startsWith("/docs/errors/"));
    }
  });

  it("should align the bounded boundary slug with its docs path segment", () => {
    const error = new VeryfrontError("Vendor error", {
      slug: `vendor-${"x".repeat(ERROR_DOCS_SLUG_MAX_LENGTH_CHARS + 100)}`,
      category: "GENERAL",
      status: 500,
      title: "Vendor error",
    });
    const snapshot = snapshotErrorForBoundary(error);
    const docsSegment = new URL(buildErrorDocsUrl(error.slug)).pathname.slice(
      "/docs/errors/".length,
    );

    assertEquals(snapshot.slug.length, ERROR_DOCS_SLUG_MAX_LENGTH_CHARS);
    assertEquals(decodeURIComponent(docsSegment), snapshot.slug);
  });

  it("should replace either kind of lone surrogate without throwing", () => {
    for (const slug of ["high-\ud800", "low-\udfff"]) {
      assertEquals(buildErrorDocsUrl(slug).endsWith("%EF%BF%BD"), true);
    }
  });

  it("should redact the complete diagnostic before applying its field bound", () => {
    const prefix = "x".repeat(ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS - 96);
    const value = `${prefix} postgres://admin:super-secret-value@db.internal/app${"z".repeat(100)}`;
    const sanitized = sanitizeDiagnosticText(value);

    assertEquals(sanitized.length, ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
    assert(sanitized.includes("postgres://admin:[REDACTED]@db.internal/app"));
    assertEquals(sanitized.includes("super-secret-value"), false);
    assert(sanitized.endsWith("...[truncated]"));
  });

  it("should neutralize an escape sequence cut by the terminal field bound", () => {
    const prefix = "x".repeat(ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS - 20);
    const sanitized = sanitizeTerminalDiagnosticText(
      `${prefix}\x1b[38;2;255;0;0m${"y".repeat(100)}`,
    );

    assert(sanitized.length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
    assertEquals(sanitized.includes("\x1b"), false);
    assert(sanitized.endsWith("...[truncated]"));
  });

  it("should apply the separate shared stack bound", () => {
    const stack = sanitizeStackDiagnosticText(
      `Error: failed\n${"x".repeat(ERROR_STACK_MAX_LENGTH_CHARS + 100)}`,
    );

    assertEquals(stack.length, ERROR_STACK_MAX_LENGTH_CHARS);
    assert(stack.endsWith("...[truncated]"));
  });

  it("snapshots throwable diagnostics without invoking object conversion hooks", () => {
    let messageReads = 0;
    let coercionCalls = 0;
    let proxyTrapCalls = 0;
    let errorMessageReads = 0;
    const hostile = Object.defineProperties({}, {
      message: {
        get() {
          messageReads++;
          throw new Error("message getter must not run");
        },
      },
      [Symbol.toPrimitive]: {
        value() {
          coercionCalls++;
          throw new Error("coercion hook must not run");
        },
      },
    });
    const proxiedError = new Proxy(new Error("must stay private"), {
      get(target, property, receiver) {
        proxyTrapCalls++;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        proxyTrapCalls++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf(target) {
        proxyTrapCalls++;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        proxyTrapCalls++;
        return Reflect.ownKeys(target);
      },
    });
    const accessorError = new Error("must stay private");
    Object.defineProperty(accessorError, "message", {
      get() {
        errorMessageReads++;
        throw new Error("Error message getter must not run");
      },
    });

    assertEquals(isNativeErrorWithoutHooks(proxiedError), false);
    assertEquals(isProxyWithoutHooks(proxiedError), true);
    assertEquals(snapshotThrowableDiagnostic(hostile), "Unknown error");
    assertEquals(snapshotThrowableDiagnostic(proxiedError), "Unknown error");
    assertEquals(snapshotThrowableDiagnostic(accessorError), "Unknown error");
    assertEquals(snapshotThrowableDiagnostic(new DOMException("DOM failure")), "DOM failure");
    assertEquals(snapshotThrowableDiagnostic("primitive failure"), "primitive failure");
    assertEquals(snapshotThrowableDiagnostic(42), "42");
    assertEquals(snapshotThrowableDiagnostic(null), "null");
    assertEquals(messageReads, 0);
    assertEquals(coercionCalls, 0);
    assertEquals(proxyTrapCalls, 0);
    assertEquals(errorMessageReads, 0);
  });

  it("bounds a safely snapshotted Error message", () => {
    const diagnostic = snapshotThrowableDiagnostic(
      new Error("x".repeat(ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS * 2)),
    );

    assertEquals(diagnostic.length, ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
    assert(diagnostic.endsWith("...[truncated]"));
  });

  it("keeps generic snapshots context-free and detaches redacted logging context", () => {
    let toJSONCalls = 0;
    const context = {
      source: "runtime",
      toJSON() {
        toJSONCalls++;
        return {
          source: "serialized",
          token: "raw-context-token",
        };
      },
    };
    const error = new VeryfrontError("Vendor error", {
      slug: "vendor-error",
      category: "GENERAL",
      status: 500,
      title: "Vendor error",
      context,
    });
    const snapshot = snapshotErrorForBoundary(error);
    const serializedSnapshot = JSON.stringify(snapshot);

    assertEquals(Object.hasOwn(snapshot, "context"), false);
    assertEquals(toJSONCalls, 0);
    assertEquals(serializedSnapshot.includes("raw-context-token"), false);

    const loggingSnapshot = snapshotErrorForLoggingBoundary(error);
    const serializedLoggingSnapshot = JSON.stringify(loggingSnapshot);

    assertEquals(toJSONCalls, 1);
    assertEquals(Object.is(loggingSnapshot.context, context), false);
    assertEquals(loggingSnapshot.context, {
      source: "serialized",
      token: "[REDACTED]",
    });
    assertEquals(serializedLoggingSnapshot.includes("raw-context-token"), false);

    let contextReads = 0;
    Object.defineProperty(error, "context", {
      configurable: true,
      get() {
        contextReads++;
        return { secret: "must-not-run" };
      },
    });

    assertEquals(snapshotErrorForBoundary(error).context, undefined);
    assertEquals(contextReads, 0);
  });

  it("reads only an own data stack and never invokes a stack accessor", () => {
    const dataStackError = new Error("data failure");
    Object.defineProperty(dataStackError, "stack", {
      configurable: true,
      value: "Error: data failure",
      writable: true,
    });

    assertEquals(
      snapshotErrorForBoundary(dataStackError).stack,
      "Error: data failure",
    );

    let stackReads = 0;
    const accessorError = new Error("hostile stack");
    Object.defineProperty(accessorError, "stack", {
      configurable: true,
      get() {
        stackReads++;
        return "private stack";
      },
    });

    assertEquals(snapshotErrorForBoundary(accessorError).stack, undefined);
    assertEquals(stackReads, 0);
  });

  it("does not invoke error field accessors or Error.prepareStackTrace", () => {
    const originalPrepareStackTrace = Object.getOwnPropertyDescriptor(
      Error,
      "prepareStackTrace",
    );
    let nameReads = 0;
    let messageReads = 0;
    let prepareStackTraceCalls = 0;
    const accessorError = new Error("hostile fields");
    Object.defineProperty(accessorError, "name", {
      configurable: true,
      get() {
        nameReads++;
        return "private-name";
      },
    });
    Object.defineProperty(accessorError, "message", {
      configurable: true,
      get() {
        messageReads++;
        return "private-message";
      },
    });
    Object.defineProperty(Error, "prepareStackTrace", {
      configurable: true,
      value() {
        prepareStackTraceCalls++;
        return "private-stack";
      },
      writable: true,
    });

    try {
      const snapshot = snapshotErrorForBoundary(accessorError);

      assertEquals(snapshot.stack, undefined);
      assertEquals(snapshot.message, "Unknown/unclassified error");
      assertEquals(snapshot.detail, "Unknown error");
      assertEquals(nameReads, 0);
      assertEquals(messageReads, 0);
      assertEquals(prepareStackTraceCalls, 0);
    } finally {
      if (originalPrepareStackTrace) {
        Object.defineProperty(
          Error,
          "prepareStackTrace",
          originalPrepareStackTrace,
        );
      } else {
        Reflect.deleteProperty(Error, "prepareStackTrace");
      }
    }
  });

  it("handles cross-realm stacks according to their own descriptor shape", () => {
    const foreignError = runInNewContext(
      'new Error("foreign failure")',
    ) as Error;
    const descriptor = Object.getOwnPropertyDescriptor(
      foreignError,
      "stack",
    );

    assert(isNativeErrorWithoutHooks(foreignError));
    const expectedStack = descriptor && "value" in descriptor &&
        typeof descriptor.value === "string"
      ? sanitizeStackDiagnosticText(descriptor.value)
      : undefined;
    assertEquals(snapshotErrorForBoundary(foreignError).stack, expectedStack);
  });
});
