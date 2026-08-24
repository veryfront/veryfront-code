import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SERVICE_OVERLOADED, VeryfrontError } from "#veryfront/errors";
import { ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS } from "#veryfront/errors/safe-diagnostics.ts";
import { deserializeWorkerError } from "./worker-error-boundary.ts";

describe("worker error boundary", () => {
  it("preserves registered identity and sanitized diagnostics", () => {
    const error = deserializeWorkerError({
      message: "dependency overloaded",
      name: "VeryfrontError",
      stack:
        "VeryfrontError: dependency overloaded\n    at postgres://admin:secret@db.internal/query:1:1",
      problem: {
        slug: SERVICE_OVERLOADED.slug,
        category: SERVICE_OVERLOADED.category,
        status: 429,
        title: SERVICE_OVERLOADED.title,
        suggestion: SERVICE_OVERLOADED.suggestion,
        detail: "upstream capacity exhausted",
        cause: "queue is full",
        instance: "/requests/data-1",
      },
    });

    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, SERVICE_OVERLOADED.slug);
    assertEquals(error.status, 429);
    assertEquals(error.detail, "upstream capacity exhausted");
    assertEquals(error.cause, "queue is full");
    assertEquals(error.instance, "/requests/data-1");
    assertEquals(error.message, "dependency overloaded");
    assert(error.stack?.includes("postgres://admin:[REDACTED]@db.internal/query"));
    assertEquals(error.stack?.includes("secret"), false);
  });

  it("redacts and bounds every worker-controlled diagnostic field", () => {
    const tainted = `postgres://admin:secret@db.internal/query ${
      "x".repeat(ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS + 100)
    }`;
    const error = deserializeWorkerError({
      message: tainted,
      name: "VeryfrontError",
      problem: {
        slug: SERVICE_OVERLOADED.slug,
        category: SERVICE_OVERLOADED.category,
        status: 429,
        title: SERVICE_OVERLOADED.title,
        suggestion: SERVICE_OVERLOADED.suggestion,
        detail: tainted,
        cause: tainted,
        instance: tainted,
      },
    });

    assertInstanceOf(error, VeryfrontError);
    const fields: readonly (readonly [string, unknown])[] = [
      ["message", error.message],
      ["detail", error.detail],
      ["cause", error.cause],
      ["instance", error.instance],
    ];

    for (const [name, value] of fields) {
      assertEquals(typeof value, "string", `${name} must be decoded as a string`);
      const text = value as string;
      assert(
        text.includes("[REDACTED]"),
        `${name} must be sanitized before it reaches the problem document`,
      );
      assertEquals(
        text.includes("secret"),
        false,
        `${name} must not carry the credential`,
      );
      assert(
        text.length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS,
        `${name} must be bounded by ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS`,
      );
    }
  });

  it("fails closed on an out-of-range or non-integer status", () => {
    for (
      const status of [200, 999, 429.5, "429", Number.NaN, Number.MAX_SAFE_INTEGER + 2]
    ) {
      const error = deserializeWorkerError({
        message: "project failure",
        name: "VeryfrontError",
        problem: {
          slug: SERVICE_OVERLOADED.slug,
          category: SERVICE_OVERLOADED.category,
          title: SERVICE_OVERLOADED.title,
          suggestion: SERVICE_OVERLOADED.suggestion,
          status,
        },
      });

      assertEquals(
        error instanceof VeryfrontError,
        false,
        `status ${String(status)} must not yield a registered error`,
      );
      assertEquals(
        error.message,
        "project failure",
        "the decoded error falls back to a plain Error",
      );
    }

    const inRange = deserializeWorkerError({
      message: "project failure",
      name: "VeryfrontError",
      problem: {
        slug: SERVICE_OVERLOADED.slug,
        category: SERVICE_OVERLOADED.category,
        title: SERVICE_OVERLOADED.title,
        suggestion: SERVICE_OVERLOADED.suggestion,
        status: 429,
      },
    });

    assertInstanceOf(inRange, VeryfrontError);
    assertEquals(inRange.status, 429, "an in-range status must still be accepted");
  });

  it("fails closed on forged registered metadata", () => {
    const error = deserializeWorkerError({
      message: "project failure",
      name: "VeryfrontError",
      stack: "VeryfrontError: project failure",
      problem: {
        slug: SERVICE_OVERLOADED.slug,
        category: "GENERAL",
        status: 418,
        title: "Forged title",
        suggestion: "Trust project metadata",
        detail: "forged detail",
      },
    });

    assertInstanceOf(error, Error);
    assertEquals(error instanceof VeryfrontError, false);
    assertEquals(error.name, "VeryfrontError");
    assertEquals(error.message, "project failure");
  });

  it("does not invoke serialized error accessors", () => {
    let accessorCalls = 0;
    const serialized = Object.defineProperties({}, {
      message: {
        enumerable: true,
        get() {
          accessorCalls++;
          throw new Error("message accessor must not run");
        },
      },
      name: {
        enumerable: true,
        value: "VeryfrontError",
      },
      problem: {
        enumerable: true,
        get() {
          accessorCalls++;
          throw new Error("problem accessor must not run");
        },
      },
    });

    const error = deserializeWorkerError(serialized);

    assertEquals(accessorCalls, 0);
    assertEquals(error instanceof VeryfrontError, false);
    assertEquals(error.name, "VeryfrontError");
    assertEquals(error.message, "Unknown error");
  });

  it("does not invoke registered metadata accessors", () => {
    let accessorCalls = 0;
    const problem = Object.defineProperties({}, {
      slug: {
        enumerable: true,
        get() {
          accessorCalls++;
          throw new Error("slug accessor must not run");
        },
      },
      category: { enumerable: true, value: SERVICE_OVERLOADED.category },
      status: { enumerable: true, value: SERVICE_OVERLOADED.status },
      title: { enumerable: true, value: SERVICE_OVERLOADED.title },
      suggestion: { enumerable: true, value: SERVICE_OVERLOADED.suggestion },
      detail: { enumerable: true, value: "must not be trusted" },
    });

    const error = deserializeWorkerError({
      message: "project failure",
      name: "VeryfrontError",
      problem,
    });

    assertEquals(accessorCalls, 0);
    assertEquals(error instanceof VeryfrontError, false);
    assertEquals(error.message, "project failure");
  });

  it("fails closed on a revoked serialized-error proxy", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    const error = deserializeWorkerError(proxy);

    assertEquals(error.name, "Error");
    assertEquals(error.message, "Unknown error");
  });

  it("does not read inherited descriptor-map entries", () => {
    const originalMessage = Object.getOwnPropertyDescriptor(Object.prototype, "message");
    let prototypeGetterCalls = 0;
    let error = new Error("decoder did not run");

    try {
      Object.defineProperty(Object.prototype, "message", {
        configurable: true,
        get() {
          prototypeGetterCalls++;
          return { value: "prototype-forged-message" };
        },
      });
      error = deserializeWorkerError({});
    } finally {
      if (originalMessage) {
        Object.defineProperty(Object.prototype, "message", originalMessage);
      } else {
        delete (Object.prototype as { message?: unknown }).message;
      }
    }

    assertEquals(prototypeGetterCalls, 0);
    assertEquals(error.message, "Unknown error");
  });

  it("does not read an inherited value from an accessor descriptor", () => {
    const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    let serializedAccessorCalls = 0;
    let prototypeGetterCalls = 0;
    const serialized = Object.defineProperty({}, "message", {
      enumerable: true,
      get() {
        serializedAccessorCalls++;
        return "accessor-backed-message";
      },
    });
    let error = new Error("decoder did not run");

    try {
      Object.defineProperty(Object.prototype, "value", {
        configurable: true,
        get() {
          prototypeGetterCalls++;
          return "prototype-forged-message";
        },
      });
      error = deserializeWorkerError(serialized);
    } finally {
      if (originalValue) {
        Object.defineProperty(Object.prototype, "value", originalValue);
      } else {
        delete (Object.prototype as { value?: unknown }).value;
      }
    }

    assertEquals(serializedAccessorCalls, 0);
    assertEquals(prototypeGetterCalls, 0);
    assertEquals(error.message, "Unknown error");
  });

  it("does not forge registered identity from descriptor-map prototypes", () => {
    const poisonedFields: readonly (readonly [string, unknown])[] = [
      ["slug", SERVICE_OVERLOADED.slug],
      ["category", SERVICE_OVERLOADED.category],
      ["status", 429],
      ["title", SERVICE_OVERLOADED.title],
      ["suggestion", SERVICE_OVERLOADED.suggestion],
    ];
    const originals = poisonedFields.map(([key]) =>
      Object.getOwnPropertyDescriptor(Object.prototype, key)
    );
    let error = new Error("decoder did not run");

    try {
      for (const [key, value] of poisonedFields) {
        Object.defineProperty(Object.prototype, key, {
          configurable: true,
          value: { value },
          writable: true,
        });
      }
      error = deserializeWorkerError({
        message: "project failure",
        name: "VeryfrontError",
        problem: {},
      });
    } finally {
      poisonedFields.forEach(([key], index) => {
        const original = originals[index];
        if (original) {
          Object.defineProperty(Object.prototype, key, original);
        } else {
          delete (Object.prototype as Record<string, unknown>)[key];
        }
      });
    }

    assertEquals(error instanceof VeryfrontError, false);
    assertEquals(error.message, "project failure");
  });
});
