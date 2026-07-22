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
  });
});
