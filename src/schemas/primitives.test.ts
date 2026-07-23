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
      assertParseFailure(getPositiveIntSchema().safeParse(Number.MAX_SAFE_INTEGER + 1));
    });
  });

  describe("nonNegativeInt", () => {
    it("accepts zero", () => {
      assertParseSuccess(getNonNegativeIntSchema().safeParse(0));
    });

    it("rejects negative numbers and decimals", () => {
      assertParseFailure(getNonNegativeIntSchema().safeParse(-1));
      assertParseFailure(getNonNegativeIntSchema().safeParse(0.5));
      assertParseFailure(getNonNegativeIntSchema().safeParse(Number.MAX_SAFE_INTEGER + 1));
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

    it("rejects cyclic and excessively deep values without throwing", () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      assertParseFailure(getJsonValueSchema().safeParse(cyclic));

      let deeplyNested: unknown = null;
      for (let depth = 0; depth < 5_000; depth++) deeplyNested = [deeplyNested];
      assertParseFailure(getJsonValueSchema().safeParse(deeplyNested));
    });

    it("enforces the documented depth and node boundaries", () => {
      let maximumDepth: unknown = null;
      for (let depth = 0; depth < 100; depth++) maximumDepth = [maximumDepth];
      assertParseSuccess(getJsonValueSchema().safeParse(maximumDepth));

      let excessiveDepth: unknown = null;
      for (let depth = 0; depth < 101; depth++) excessiveDepth = [excessiveDepth];
      assertParseFailure(getJsonValueSchema().safeParse(excessiveDepth));

      assertParseFailure(
        getJsonValueSchema().safeParse(Array.from({ length: 100_000 }, () => null)),
      );
    });

    it("rejects non-JSON primitives, exotic objects, and sparse arrays", () => {
      for (
        const value of [
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.NEGATIVE_INFINITY,
          1n,
          Symbol("value"),
          () => undefined,
          new Date(),
          new Map(),
          new Array(1),
        ]
      ) {
        assertParseFailure(getJsonValueSchema().safeParse(value));
      }
    });

    it("accepts null-prototype objects and repeated acyclic references", () => {
      const shared = { value: true };
      const nullPrototype = Object.assign(Object.create(null), { shared });

      assertParseSuccess(
        getJsonValueSchema().safeParse({ first: shared, second: shared, nullPrototype }),
      );
    });

    it("returns a sanitized failure when input mutates during validation", () => {
      const canary = "private-validation-canary";
      let reads = 0;
      const unstable = new Proxy({ value: "ok" }, {
        get(target, property, receiver) {
          if (property === "value" && ++reads > 1) throw new Error(canary);
          return Reflect.get(target, property, receiver);
        },
      });

      const result = getJsonValueSchema().safeParse(unstable);
      assertParseFailure(result);
      assertEquals(JSON.stringify(result).includes(canary), false);
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

    it("rejects NUL bytes and unbounded paths", () => {
      assertParseFailure(getFilePathSchema().safeParse("src/unsafe\0name.ts"));
      assertParseFailure(getFilePathSchema().safeParse("x".repeat(4_097)));
    });
  });

  describe("absolutePath", () => {
    it("accepts unix and windows absolute paths", () => {
      assertParseSuccess(getAbsolutePathSchema().safeParse("/usr/local/bin"));
      assertParseSuccess(getAbsolutePathSchema().safeParse(String.raw`C:\Projects\veryfront`));
      assertParseSuccess(getAbsolutePathSchema().safeParse("C:/Projects/veryfront"));
      assertParseSuccess(getAbsolutePathSchema().safeParse(String.raw`\\server\share\project`));
    });

    it("rejects relative paths", () => {
      assertParseFailure(getAbsolutePathSchema().safeParse("relative/path"));
    });

    it("rejects malformed and unsafe absolute paths", () => {
      assertParseFailure(getAbsolutePathSchema().safeParse(String.raw`\\server`));
      assertParseFailure(getAbsolutePathSchema().safeParse("/unsafe\0path"));
      assertParseFailure(getAbsolutePathSchema().safeParse("/" + "x".repeat(4_097)));
    });
  });
});
