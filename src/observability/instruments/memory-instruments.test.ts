import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseV8HeapLimitBytes } from "./memory-instruments.ts";

describe("observability/instruments/memory-instruments", () => {
  it("parses explicit V8 heap limits without deployment-specific defaults", () => {
    assertEquals(
      parseV8HeapLimitBytes("--max-old-space-size=4096"),
      4096 * 1024 * 1024,
    );
    assertEquals(parseV8HeapLimitBytes("--max_old_space_size 2048"), 2048 * 1024 * 1024);
    assertEquals(parseV8HeapLimitBytes(""), undefined);
    assertEquals(parseV8HeapLimitBytes("--max-old-space-size=0"), undefined);
    assertEquals(parseV8HeapLimitBytes("--max-old-space-size=invalid"), undefined);
  });
});
