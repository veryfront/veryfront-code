import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  absolutePath,
  filePath,
  hexColor,
  jsonValue,
  nonEmptyString,
  nonNegativeInt,
  portNumber,
  positiveInt,
  semver,
  timestamp,
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
      assertParseSuccess(nonEmptyString.safeParse("value"));
    });

    it("rejects empty strings", () => {
      assertParseFailure(nonEmptyString.safeParse(""));
    });
  });

  describe("positiveInt", () => {
    it("accepts positive integers", () => {
      assertParseSuccess(positiveInt.safeParse(1));
    });

    it("rejects zero and decimals", () => {
      assertParseFailure(positiveInt.safeParse(0));
      assertParseFailure(positiveInt.safeParse(1.5));
    });
  });

  describe("nonNegativeInt", () => {
    it("accepts zero", () => {
      assertParseSuccess(nonNegativeInt.safeParse(0));
    });

    it("rejects negative numbers and decimals", () => {
      assertParseFailure(nonNegativeInt.safeParse(-1));
      assertParseFailure(nonNegativeInt.safeParse(0.5));
    });
  });

  describe("portNumber", () => {
    it("accepts boundary port numbers", () => {
      assertParseSuccess(portNumber.safeParse(1));
      assertParseSuccess(portNumber.safeParse(65535));
    });

    it("rejects out-of-range values", () => {
      assertParseFailure(portNumber.safeParse(0));
      assertParseFailure(portNumber.safeParse(65536));
    });
  });

  describe("timestamp", () => {
    it("accepts ISO datetime strings", () => {
      assertParseSuccess(timestamp.safeParse("2024-01-01T00:00:00Z"));
    });

    it("rejects non-datetime strings", () => {
      assertParseFailure(timestamp.safeParse("not-a-timestamp"));
    });
  });

  describe("jsonValue", () => {
    it("accepts nested JSON-compatible values", () => {
      assertParseSuccess(
        jsonValue.safeParse({
          name: "test",
          count: 2,
          enabled: true,
          items: [null, { nested: ["value"] }],
        }),
      );
    });

    it("rejects undefined values", () => {
      assertParseFailure(jsonValue.safeParse({ invalid: undefined }));
    });
  });

  describe("hexColor", () => {
    it("accepts short and long hex colors", () => {
      assertParseSuccess(hexColor.safeParse("#fff"));
      assertParseSuccess(hexColor.safeParse("#A1b2C3"));
    });

    it("rejects invalid hex colors", () => {
      assertParseFailure(hexColor.safeParse("123456"));
      assertParseFailure(hexColor.safeParse("#abcd"));
    });
  });

  describe("semver", () => {
    it("accepts standard semantic versions", () => {
      assertParseSuccess(semver.safeParse("1.2.3"));
      assertParseSuccess(semver.safeParse("1.2.3-beta.1+build.5"));
    });

    it("rejects invalid semantic versions", () => {
      assertParseFailure(semver.safeParse("1.2"));
      assertParseFailure(semver.safeParse("01.2.3"));
    });
  });

  describe("filePath", () => {
    it("accepts non-empty file paths", () => {
      assertParseSuccess(filePath.safeParse("src/main.ts"));
      assertParseSuccess(filePath.safeParse("/tmp/main.ts"));
    });

    it("rejects empty file paths", () => {
      assertParseFailure(filePath.safeParse(""));
    });
  });

  describe("absolutePath", () => {
    it("accepts unix and windows absolute paths", () => {
      assertParseSuccess(absolutePath.safeParse("/usr/local/bin"));
      assertParseSuccess(absolutePath.safeParse(String.raw`C:\Projects\veryfront`));
    });

    it("rejects relative paths", () => {
      assertParseFailure(absolutePath.safeParse("relative/path"));
    });
  });
});
