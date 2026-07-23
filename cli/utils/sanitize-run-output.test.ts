import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertLessOrEqual,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { sanitizeRunOutputForLogging } from "./sanitize-run-output.ts";

describe("sanitizeRunOutputForLogging", () => {
  it("removes top-level tenant context", () => {
    assertEquals(
      sanitizeRunOutputForLogging({
        _tenant: { token: "secret", projectSlug: "dreamy-haven" },
        ok: true,
      }),
      { ok: true },
    );
  });

  it("removes nested tenant context recursively", () => {
    assertEquals(
      sanitizeRunOutputForLogging({
        run: {
          step: {
            _tenant: { token: "secret" },
            status: "completed",
          },
        },
      }),
      {
        run: {
          step: {
            status: "completed",
          },
        },
      },
    );
  });

  it("preserves arrays and primitive values", () => {
    assertEquals(
      sanitizeRunOutputForLogging([
        { ok: true, _tenant: { token: "secret" } },
        "done",
        42,
      ]),
      [{ ok: true }, "done", 42],
    );
  });

  it("does not invoke accessors or custom serializers", () => {
    let getterCalls = 0;
    let toJsonCalls = 0;
    const accessorBacked: Record<string, unknown> = {};
    Object.defineProperty(accessorBacked, "value", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "must-not-be-read";
      },
    });
    const customSerializer = {
      toJSON() {
        toJsonCalls += 1;
        return { token: "<TOKEN>" };
      },
    };

    const sanitized = sanitizeRunOutputForLogging({ accessorBacked, customSerializer });
    const serialized = JSON.stringify(sanitized);

    assertEquals(getterCalls, 0);
    assertEquals(toJsonCalls, 0);
    assertEquals(
      Object.getOwnPropertyDescriptor(
        (sanitized as { accessorBacked: object }).accessorBacked,
        "toJSON",
      )?.value,
      null,
    );
    assertStringIncludes(serialized, "[REDACTED]");
    assert(!serialized.includes("must-not-be-read"));
    assert(!serialized.includes("<TOKEN>"));
  });

  it("contains cycles and unreadable proxies", () => {
    const circular: Record<string, unknown> = { ok: true };
    circular.self = circular;
    const unreadable = new Proxy({}, {
      ownKeys() {
        throw new Error("proxy trap must remain contained");
      },
    });

    const sanitized = sanitizeRunOutputForLogging({ circular, unreadable });
    const serialized = JSON.stringify(sanitized);

    assertStringIncludes(serialized, "[REDACTED]");
    assertStringIncludes(serialized, '"ok":true');
  });

  it("bounds inspection of non-enumerable object properties", () => {
    let descriptorReads = 0;
    const keys = Array.from({ length: 10_000 }, (_, index) => `hidden-${index}`);
    const value = new Proxy({}, {
      ownKeys: () => keys,
      getOwnPropertyDescriptor() {
        descriptorReads += 1;
        return { configurable: true, enumerable: false, value: "hidden" };
      },
    });

    const sanitized = sanitizeRunOutputForLogging(value);

    assertLessOrEqual(descriptorReads, 100);
    assertStringIncludes(JSON.stringify(sanitized), "[TRUNCATED]");
  });

  it("bounds depth, collection sizes, node count, and serialized output", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 64; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }

    const sanitizedDeep = sanitizeRunOutputForLogging(deep);
    const sanitizedItems = sanitizeRunOutputForLogging(
      Array.from({ length: 1_000 }, (_, index) => ({
        index,
        text: "x".repeat(4_096),
      })),
    );
    const sanitizedObject = sanitizeRunOutputForLogging(
      Object.fromEntries(
        Array.from({ length: 1_000 }, (_, index) => [`field-${index}`, index]),
      ),
    );
    const sanitizedString = sanitizeRunOutputForLogging("x".repeat(10_000));
    const nodeHeavy = sanitizeRunOutputForLogging(
      Array.from(
        { length: 100 },
        () => Array.from({ length: 100 }, (_, index) => index),
      ),
    );
    const boundedOutput = sanitizeRunOutputForLogging({
      items: Array.from({ length: 1_000 }, (_, index) => ({
        index,
        text: "x".repeat(4_096),
      })),
    });
    const serialized = JSON.stringify(boundedOutput);

    assertLessOrEqual(serialized.length, 65_536);
    assertStringIncludes(JSON.stringify(sanitizedDeep), "[TRUNCATED]");
    assert(
      typeof sanitizedString === "string" && sanitizedString.length <= 4_096,
      "individual strings must stay bounded",
    );
    assertStringIncludes(sanitizedString as string, "[TRUNCATED]");
    assertStringIncludes(JSON.stringify(nodeHeavy), "[TRUNCATED]");
    assert(
      Array.isArray(sanitizedItems) && sanitizedItems.length <= 101,
      "array output must stay bounded",
    );
    assert(
      sanitizedObject !== null && typeof sanitizedObject === "object" &&
        Object.keys(sanitizedObject).length <= 101,
      "object output must stay bounded",
    );
  });

  it("replaces non-JSON primitives with a safe marker", () => {
    const sanitized = sanitizeRunOutputForLogging({
      bigint: 1n,
      fn: () => undefined,
      infinity: Infinity,
      nan: Number.NaN,
      symbol: Symbol("value"),
      undefined,
    });

    assertEquals(sanitized, {
      bigint: "[REDACTED]",
      fn: "[REDACTED]",
      infinity: "[REDACTED]",
      nan: "[REDACTED]",
      symbol: "[REDACTED]",
      undefined: "[REDACTED]",
    });
    assertEquals(typeof JSON.stringify(sanitized), "string");
  });

  it("redacts credential fields, credential text, and local paths", () => {
    const posixPath = "/" + "private/project/task.ts";
    const windowsPath = "C:" + "\\private\\project\\task.ts";
    const sanitized = sanitizeRunOutputForLogging({
      apiKey: "<TOKEN>",
      diagnostic: `Authorization: Bearer <TOKEN> at ${posixPath} and ${windowsPath}`,
      nested: {
        url: "https://user:<TOKEN>@example.test/task?access_token=<TOKEN>",
      },
    });
    const serialized = JSON.stringify(sanitized);

    assertStringIncludes(serialized, "[REDACTED]");
    assertStringIncludes(serialized, "<LOCAL_PATH>");
    assert(!serialized.includes("private/project/task.ts"));
    assert(!serialized.includes("private\\\\project"));
    assert(!serialized.includes("user:<TOKEN>"));
    assert(!serialized.includes("access_token=<TOKEN>"));
  });
});
