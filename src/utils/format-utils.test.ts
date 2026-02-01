import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";
import {
  estimateSize,
  estimateSizeWithCircularHandling,
  formatBytes,
  formatDuration,
  formatNumber,
  truncateString,
} from "./format-utils.ts";

describe("format-utils", () => {
  describe("formatBytes", () => {
    it("should format 0 bytes", () => {
      assertEquals(formatBytes(0), "0 Bytes");
    });

    it("should format bytes", () => {
      assertEquals(formatBytes(500), "500 Bytes");
    });

    it("should format kilobytes", () => {
      assertEquals(formatBytes(1024), "1 KB");
      assertEquals(formatBytes(1536), "1.5 KB");
    });

    it("should format megabytes", () => {
      assertEquals(formatBytes(1048576), "1 MB");
    });

    it("should format gigabytes", () => {
      assertEquals(formatBytes(1073741824), "1 GB");
    });

    it("should handle negative values with absolute", () => {
      assertEquals(formatBytes(-1024), "1 KB");
    });
  });

  describe("formatDuration", () => {
    it("should format milliseconds", () => {
      assertEquals(formatDuration(500), "500ms");
    });

    it("should format seconds", () => {
      assertEquals(formatDuration(1000), "1.0s");
      assertEquals(formatDuration(2500), "2.5s");
    });

    it("should format minutes", () => {
      assertEquals(formatDuration(65000), "1m 5s");
    });

    it("should format hours", () => {
      assertEquals(formatDuration(3661000), "1h 1m");
    });
  });

  describe("formatNumber", () => {
    it("should format small numbers", () => {
      assertEquals(formatNumber(123), "123");
    });

    it("should add commas for thousands", () => {
      assertEquals(formatNumber(1234), "1,234");
      assertEquals(formatNumber(1234567), "1,234,567");
    });
  });

  describe("truncateString", () => {
    it("should return string if under max length", () => {
      assertEquals(truncateString("hello", 10), "hello");
    });

    it("should truncate and add ellipsis", () => {
      assertEquals(truncateString("hello world", 8), "hello...");
    });

    it("should handle exact max length", () => {
      assertEquals(truncateString("hello", 5), "hello");
    });
  });

  describe("estimateSize", () => {
    it("should estimate null/undefined as 8 bytes", () => {
      assertEquals(estimateSize(null), 8);
      assertEquals(estimateSize(undefined), 8);
    });

    it("should estimate boolean as 4 bytes", () => {
      assertEquals(estimateSize(true), 4);
      assertEquals(estimateSize(false), 4);
    });

    it("should estimate number as 8 bytes", () => {
      assertEquals(estimateSize(42), 8);
      assertEquals(estimateSize(3.14), 8);
    });

    it("should estimate string by length * 2 (UTF-16)", () => {
      assertEquals(estimateSize("hello"), 10);
    });

    it("should estimate function as 0 bytes", () => {
      assertEquals(estimateSize(() => {}), 0);
    });
  });

  describe("estimateSizeWithCircularHandling", () => {
    it("should estimate simple objects", () => {
      assertEquals(estimateSizeWithCircularHandling({ a: 1, b: 2 }) > 0, true);
    });

    it("should handle circular references", () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;
      assertEquals(estimateSizeWithCircularHandling(obj) > 0, true);
    });

    it("should handle Map", () => {
      assertEquals(
        estimateSizeWithCircularHandling(new Map([["key", "value"]])) > 0,
        true,
      );
    });

    it("should handle Set", () => {
      assertEquals(
        estimateSizeWithCircularHandling(new Set([1, 2, 3])) > 0,
        true,
      );
    });
  });
});
