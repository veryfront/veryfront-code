import "./_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getAbsolutePathSchema,
  getFilePathSchema,
  getHexColorSchema,
  getJsonValueSchema,
  getNonEmptyStringSchema,
  getNonNegativeIntSchema,
  getPortNumberSchema,
  getPositiveIntSchema,
  getSemverSchema,
  getTimestampSchema,
} from "./index.ts";
import { MAX_PATH_LENGTH_CHARS } from "../utils/constants/index.ts";

function assertParseSuccess(result: { success: boolean }): void {
  assertEquals(result.success, true);
}

function assertParseFailure(result: { success: boolean }): void {
  assertEquals(result.success, false);
}

describe("primitive schemas", () => {
  describe("nonEmptyString", () => {
    it("accepts non-empty strings", () => {
      assertParseSuccess(getNonEmptyStringSchema().safeParse("value"));
    });

    it("rejects empty strings", () => {
      assertParseFailure(getNonEmptyStringSchema().safeParse(""));
    });
  });

  describe("positiveInt", () => {
    it("accepts positive integers", () => {
      assertParseSuccess(getPositiveIntSchema().safeParse(1));
    });

    it("rejects zero and decimals", () => {
      assertParseFailure(getPositiveIntSchema().safeParse(0));
      assertParseFailure(getPositiveIntSchema().safeParse(1.5));
    });
  });

  describe("nonNegativeInt", () => {
    it("accepts zero", () => {
      assertParseSuccess(getNonNegativeIntSchema().safeParse(0));
    });

    it("rejects negative numbers and decimals", () => {
      assertParseFailure(getNonNegativeIntSchema().safeParse(-1));
      assertParseFailure(getNonNegativeIntSchema().safeParse(0.5));
    });
  });

  describe("portNumber", () => {
    it("accepts boundary port numbers", () => {
      assertParseSuccess(getPortNumberSchema().safeParse(1));
      assertParseSuccess(getPortNumberSchema().safeParse(65535));
    });

    it("rejects out-of-range values", () => {
      assertParseFailure(getPortNumberSchema().safeParse(0));
      assertParseFailure(getPortNumberSchema().safeParse(65536));
    });
  });

  describe("timestamp", () => {
    it("accepts ISO datetime strings", () => {
      assertParseSuccess(getTimestampSchema().safeParse("2024-01-01T00:00:00Z"));
    });

    it("rejects non-datetime strings", () => {
      assertParseFailure(getTimestampSchema().safeParse("not-a-timestamp"));
    });
  });

  describe("jsonValue", () => {
    it("accepts nested JSON-compatible values", () => {
      assertParseSuccess(
        getJsonValueSchema().safeParse({
          name: "test",
          count: 2,
          enabled: true,
          items: [null, { nested: ["value"] }],
        }),
      );
    });

    it("rejects undefined values", () => {
      assertParseFailure(getJsonValueSchema().safeParse({ invalid: undefined }));
    });

    it("rejects cyclic values without throwing", () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      assertParseFailure(getJsonValueSchema().safeParse(cyclic));
    });

    it("rejects values deeper than the validation limit without throwing", () => {
      let value: unknown = null;
      for (let depth = 0; depth < 256; depth++) value = [value];

      assertParseFailure(getJsonValueSchema().safeParse(value));
    });

    it("rejects oversized strings", () => {
      assertParseFailure(getJsonValueSchema().safeParse("x".repeat(1_048_577)));
    });

    it("rejects accessors without invoking them", () => {
      let reads = 0;
      const value: Record<string, unknown> = {};
      Object.defineProperty(value, "field", {
        enumerable: true,
        get() {
          reads += 1;
          return "value";
        },
      });

      assertParseFailure(getJsonValueSchema().safeParse(value));
      assertEquals(reads, 0);
    });

    it("consumes one data-only snapshot of a stateful Proxy", () => {
      let descriptorReads = 0;
      let valueReads = 0;
      const target = { field: "target" };
      const value = new Proxy(target, {
        getOwnPropertyDescriptor(_target, property) {
          if (property !== "field") return undefined;
          descriptorReads += 1;
          return {
            configurable: true,
            enumerable: true,
            writable: true,
            value: "snapshot",
          };
        },
        get(_target, property, receiver) {
          if (property === "field") {
            valueReads += 1;
            return () => "not-json";
          }
          return Reflect.get(_target, property, receiver);
        },
      });

      const result = getJsonValueSchema().safeParse(value);

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(result.data, { field: "snapshot" });
      assertEquals(result.data === value, false);
      assertEquals(descriptorReads, 1);
      assertEquals(valueReads, 0);
    });

    it("rejects objects with custom prototypes or symbol keys", () => {
      const inherited = Object.assign(Object.create({ inherited: true }), { own: true });
      const symbolKeyed = { value: true, [Symbol("hidden")]: true };

      assertParseFailure(getJsonValueSchema().safeParse(inherited));
      assertParseFailure(getJsonValueSchema().safeParse(symbolKeyed));
    });

    it("preserves __proto__ as data without changing the output prototype", () => {
      const value: Record<string, unknown> = {};
      Object.defineProperty(value, "__proto__", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: { polluted: true },
      });

      const result = getJsonValueSchema().safeParse(value);

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(Object.hasOwn(result.data as object, "__proto__"), true);
      assertEquals((result.data as Record<string, unknown>)["__proto__"], {
        polluted: true,
      });
      assertEquals(Object.getPrototypeOf(result.data as object), Object.prototype);
      assertEquals((result.data as { polluted?: unknown }).polluted, undefined);
    });
  });

  describe("hexColor", () => {
    it("accepts short and long hex colors", () => {
      assertParseSuccess(getHexColorSchema().safeParse("#fff"));
      assertParseSuccess(getHexColorSchema().safeParse("#A1b2C3"));
    });

    it("rejects invalid hex colors", () => {
      assertParseFailure(getHexColorSchema().safeParse("123456"));
      assertParseFailure(getHexColorSchema().safeParse("#abcd"));
    });
  });

  describe("semver", () => {
    it("accepts standard semantic versions", () => {
      assertParseSuccess(getSemverSchema().safeParse("1.2.3"));
      assertParseSuccess(getSemverSchema().safeParse("1.2.3-beta.1+build.5"));
    });

    it("rejects invalid semantic versions", () => {
      assertParseFailure(getSemverSchema().safeParse("1.2"));
      assertParseFailure(getSemverSchema().safeParse("01.2.3"));
    });
  });

  describe("filePath", () => {
    it("accepts non-empty file paths", () => {
      assertParseSuccess(getFilePathSchema().safeParse("src/main.ts"));
      assertParseSuccess(getFilePathSchema().safeParse("/tmp/main.ts"));
    });

    it("rejects empty file paths", () => {
      assertParseFailure(getFilePathSchema().safeParse(""));
    });

    it("rejects file paths containing null bytes", () => {
      assertParseFailure(getFilePathSchema().safeParse("src/main\0.ts"));
    });

    it("rejects file paths exceeding the shared path limit", () => {
      assertParseSuccess(getFilePathSchema().safeParse("a".repeat(MAX_PATH_LENGTH_CHARS)));
      assertParseFailure(getFilePathSchema().safeParse("a".repeat(MAX_PATH_LENGTH_CHARS + 1)));
    });
  });

  describe("absolutePath", () => {
    it("accepts unix and windows absolute paths", () => {
      assertParseSuccess(getAbsolutePathSchema().safeParse("/usr/local/bin"));
      assertParseSuccess(getAbsolutePathSchema().safeParse(String.raw`C:\Projects\veryfront`));
      assertParseSuccess(getAbsolutePathSchema().safeParse("C:/Projects/veryfront"));
      assertParseSuccess(getAbsolutePathSchema().safeParse(String.raw`\Projects\veryfront`));
      assertParseSuccess(
        getAbsolutePathSchema().safeParse(String.raw`\\server\share\veryfront`),
      );
    });

    it("rejects relative paths", () => {
      assertParseFailure(getAbsolutePathSchema().safeParse("relative/path"));
      assertParseFailure(getAbsolutePathSchema().safeParse("C:relative\\path"));
      assertParseFailure(getAbsolutePathSchema().safeParse(String.raw`\\server`));
    });

    it("rejects absolute paths containing null bytes", () => {
      assertParseFailure(getAbsolutePathSchema().safeParse("/tmp/main\0.ts"));
    });

    it("rejects absolute paths exceeding the shared path limit", () => {
      assertParseSuccess(
        getAbsolutePathSchema().safeParse(`/${"a".repeat(MAX_PATH_LENGTH_CHARS - 1)}`),
      );
      assertParseFailure(
        getAbsolutePathSchema().safeParse(`/${"a".repeat(MAX_PATH_LENGTH_CHARS)}`),
      );
    });
  });
});
