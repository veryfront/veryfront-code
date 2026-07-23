import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { sanitizeErrorContext, sanitizeErrorInstance, sanitizeErrorText } from "./sanitization.ts";

describe("errors/sanitization", () => {
  it("keeps truncated diagnostic text within the requested bound", () => {
    assertEquals(sanitizeErrorText("x".repeat(100), 16).length, 16);
    assertEquals(sanitizeErrorText("x".repeat(100), 4).length, 4);
  });

  it("redacts Windows UNC and device paths from diagnostic text", () => {
    const diagnostic = String
      .raw`Failure at \\example.invalid\share\project\source.ts:1:1 and \\?\C:\project\source.ts:2:2`;

    assertEquals(
      sanitizeErrorText(diagnostic),
      "Failure at <LOCAL_PATH> and <LOCAL_PATH>",
    );
  });

  it("redacts local and hosted file URLs from diagnostic text", () => {
    assertEquals(
      sanitizeErrorText(
        "Failure at file:///private/project/source.ts and file://private-host/share/source.ts",
      ),
      "Failure at <LOCAL_PATH> and <LOCAL_PATH>",
    );
  });

  it("returns JSON-safe context without prototype mutation", () => {
    const input = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(input, "__proto__", {
      enumerable: true,
      value: { polluted: true },
    });
    input.callback = () => "secret";
    input.symbol = Symbol("secret");
    input.invalidNumber = Number.POSITIVE_INFINITY;

    const sanitized = sanitizeErrorContext(input);

    assertEquals(Object.getPrototypeOf(sanitized), null);
    assertEquals(Object.hasOwn(sanitized ?? {}, "__proto__"), true);
    assertEquals(JSON.stringify(sanitized).includes("secret"), false);
    assertEquals(JSON.stringify(sanitized).includes("Infinity"), false);
  });

  it("sanitizes hostile context keys as well as values", () => {
    const input = {
      "password=<TOKEN>": "safe",
      "/private/project/file.ts": "safe",
    };

    const serialized = JSON.stringify(sanitizeErrorContext(input));

    assertEquals(serialized.includes("<TOKEN>"), false);
    assertEquals(serialized.includes("/private/project"), false);
  });

  it("redacts local-file instance values after removing unsafe controls", () => {
    assertEquals(
      sanitizeErrorInstance("\u202Efile:///private/project/server.ts?token=<TOKEN>"),
      "<LOCAL_PATH>",
    );
    assertEquals(sanitizeErrorInstance("C:\\private\\project\\server.ts"), "<LOCAL_PATH>");
    assertEquals(
      sanitizeErrorInstance(String.raw`\\example.invalid\share\project\server.ts`),
      "<LOCAL_PATH>",
    );
    assertEquals(
      sanitizeErrorInstance(String.raw`\\?\C:\project\server.ts`),
      "<LOCAL_PATH>",
    );
    assertEquals(
      sanitizeErrorInstance("/api/projects/example?token=<TOKEN>"),
      "/api/projects/example",
    );
  });
});
