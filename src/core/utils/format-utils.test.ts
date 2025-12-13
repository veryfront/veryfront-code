import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  formatBytes,
  estimateSize,
  estimateSizeWithCircularHandling,
  formatDuration,
  formatNumber,
  truncateString,
} from "./format-utils.ts";

describe("utils/format-utils", () => {
  describe("formatBytes", () => {
    it("should format zero bytes", () => {
      assertEquals(formatBytes(0), "0 Bytes");
    });

    it("should format bytes", () => {
      assertEquals(formatBytes(100), "100 Bytes");
      assertEquals(formatBytes(512), "512 Bytes");
      assertEquals(formatBytes(1000), "1000 Bytes");
    });

    it("should format kilobytes", () => {
      assertEquals(formatBytes(1024), "1 KB");
      assertEquals(formatBytes(2048), "2 KB");
      assertEquals(formatBytes(1536), "1.5 KB");
    });

    it("should format megabytes", () => {
      assertEquals(formatBytes(1048576), "1 MB");
      assertEquals(formatBytes(2097152), "2 MB");
      assertEquals(formatBytes(1572864), "1.5 MB");
    });

    it("should format gigabytes", () => {
      assertEquals(formatBytes(1073741824), "1 GB");
      assertEquals(formatBytes(2147483648), "2 GB");
    });

    it("should handle very small values", () => {
      const result = formatBytes(0.5);
      assert(result.includes("Bytes"));
    });

    it("should handle negative values", () => {
      const result = formatBytes(-1024);
      assert(result.includes("KB"));
    });
  });

  describe("estimateSize", () => {
    it("should estimate null and undefined", () => {
      assertEquals(estimateSize(null), 8);
      assertEquals(estimateSize(undefined), 8);
    });

    it("should estimate boolean", () => {
      assertEquals(estimateSize(true), 4);
      assertEquals(estimateSize(false), 4);
    });

    it("should estimate number", () => {
      assertEquals(estimateSize(42), 8);
      assertEquals(estimateSize(3.14), 8);
    });

    it("should estimate string", () => {
      assertEquals(estimateSize(""), 0);
      assertEquals(estimateSize("a"), 2);
      assertEquals(estimateSize("hello"), 10);
    });

    it("should estimate function as 0", () => {
      assertEquals(estimateSize(() => {}), 0);
    });

    it("should estimate objects", () => {
      const size = estimateSize({ key: "value" });
      assert(size > 0);
    });

    it("should estimate arrays", () => {
      const size = estimateSize([1, 2, 3]);
      assert(size > 0);
    });
  });

  describe("estimateSizeWithCircularHandling", () => {
    it("should handle simple values", () => {
      const size = estimateSizeWithCircularHandling({ key: "value" });
      assert(size > 0);
    });

    it("should handle circular references", () => {
      const obj: any = { key: "value" };
      obj.self = obj;
      const size = estimateSizeWithCircularHandling(obj);
      assert(size > 0);
    });

    it("should handle Maps", () => {
      const map = new Map([["key", "value"]]);
      const size = estimateSizeWithCircularHandling(map);
      assert(size > 0);
    });

    it("should handle Sets", () => {
      const set = new Set([1, 2, 3]);
      const size = estimateSizeWithCircularHandling(set);
      assert(size > 0);
    });

    it("should handle Uint8Array", () => {
      const arr = new Uint8Array([1, 2, 3]);
      const size = estimateSizeWithCircularHandling(arr);
      assert(size > 0);
    });

    it("should handle functions by excluding them", () => {
      const obj = { fn: () => {}, value: "test" };
      const size = estimateSizeWithCircularHandling(obj);
      assert(size > 0);
    });
  });

  describe("formatDuration", () => {
    it("should format milliseconds", () => {
      assertEquals(formatDuration(100), "100ms");
      assertEquals(formatDuration(500), "500ms");
      assertEquals(formatDuration(999), "999ms");
    });

    it("should format seconds", () => {
      assertEquals(formatDuration(1000), "1.0s");
      assertEquals(formatDuration(2500), "2.5s");
      assertEquals(formatDuration(5000), "5.0s");
    });

    it("should format minutes", () => {
      assertEquals(formatDuration(60000), "1m 0s");
      assertEquals(formatDuration(90000), "1m 30s");
      assertEquals(formatDuration(120000), "2m 0s");
    });

    it("should format hours", () => {
      assertEquals(formatDuration(3600000), "1h 0m");
      assertEquals(formatDuration(3660000), "1h 1m");
      assertEquals(formatDuration(7200000), "2h 0m");
    });

    it("should handle zero", () => {
      assertEquals(formatDuration(0), "0ms");
    });
  });

  describe("formatNumber", () => {
    it("should format small numbers without commas", () => {
      assertEquals(formatNumber(100), "100");
      assertEquals(formatNumber(999), "999");
    });

    it("should format thousands with commas", () => {
      assertEquals(formatNumber(1000), "1,000");
      assertEquals(formatNumber(5000), "5,000");
      assertEquals(formatNumber(10000), "10,000");
    });

    it("should format millions with commas", () => {
      assertEquals(formatNumber(1000000), "1,000,000");
      assertEquals(formatNumber(1234567), "1,234,567");
    });

    it("should handle zero", () => {
      assertEquals(formatNumber(0), "0");
    });

    it("should handle negative numbers", () => {
      assertEquals(formatNumber(-1000), "-1,000");
      assertEquals(formatNumber(-1234567), "-1,234,567");
    });
  });

  describe("truncateString", () => {
    it("should not truncate short strings", () => {
      assertEquals(truncateString("hello", 10), "hello");
      assertEquals(truncateString("test", 10), "test");
    });

    it("should truncate long strings", () => {
      assertEquals(truncateString("hello world", 8), "hello...");
      assertEquals(truncateString("this is a long string", 10), "this is...");
    });

    it("should handle exact length", () => {
      assertEquals(truncateString("hello", 5), "hello");
    });

    it("should handle maxLength smaller than ellipsis", () => {
      const result = truncateString("hello world", 3);
      assertEquals(result, "...");
    });

    it("should handle empty strings", () => {
      assertEquals(truncateString("", 10), "");
    });

    it("should add ellipsis correctly", () => {
      const result = truncateString("1234567890", 7);
      assertEquals(result, "1234...");
      assertEquals(result.length, 7);
    });
  });

  describe("integration tests", () => {
    it("should format bytes and numbers consistently", () => {
      const bytes = 1234567;
      const formatted = formatBytes(bytes);
      assert(formatted.includes("MB"));
    });

    it("should handle duration and formatting together", () => {
      const duration = 123456;
      const formatted = formatDuration(duration);
      assert(formatted.includes("m") || formatted.includes("s"));
    });
  });
});
