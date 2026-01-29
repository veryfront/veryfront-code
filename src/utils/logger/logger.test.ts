import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getDefaultLevel, LogLevel } from "./logger.ts";

describe("logger", () => {
  describe("getDefaultLevel", () => {
    it("should return DEBUG for LOG_LEVEL=DEBUG", () => {
      assertEquals(getDefaultLevel("DEBUG", undefined), LogLevel.DEBUG);
    });

    it("should return INFO for LOG_LEVEL=INFO", () => {
      assertEquals(getDefaultLevel("INFO", undefined), LogLevel.INFO);
    });

    it("should return WARN for LOG_LEVEL=WARN", () => {
      assertEquals(getDefaultLevel("WARN", undefined), LogLevel.WARN);
    });

    it("should return ERROR for LOG_LEVEL=ERROR", () => {
      assertEquals(getDefaultLevel("ERROR", undefined), LogLevel.ERROR);
    });

    it("should be case-insensitive for LOG_LEVEL", () => {
      assertEquals(getDefaultLevel("debug", undefined), LogLevel.DEBUG);
      assertEquals(getDefaultLevel("Info", undefined), LogLevel.INFO);
    });

    it("should return DEBUG when VERYFRONT_DEBUG=1", () => {
      assertEquals(getDefaultLevel(undefined, "1"), LogLevel.DEBUG);
    });

    it("should return DEBUG when VERYFRONT_DEBUG=true", () => {
      assertEquals(getDefaultLevel(undefined, "true"), LogLevel.DEBUG);
    });

    it("should return INFO by default", () => {
      assertEquals(getDefaultLevel(undefined, undefined), LogLevel.INFO);
    });

    it("should prefer LOG_LEVEL over VERYFRONT_DEBUG", () => {
      assertEquals(getDefaultLevel("ERROR", "1"), LogLevel.ERROR);
    });

    it("should return INFO for invalid LOG_LEVEL without debug flag", () => {
      assertEquals(getDefaultLevel("INVALID", undefined), LogLevel.INFO);
    });
  });

  describe("LogLevel enum", () => {
    it("should have correct ordering", () => {
      assertEquals(LogLevel.DEBUG < LogLevel.INFO, true);
      assertEquals(LogLevel.INFO < LogLevel.WARN, true);
      assertEquals(LogLevel.WARN < LogLevel.ERROR, true);
    });
  });
});
