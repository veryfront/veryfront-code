import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  checkRunOutputLimit,
  measureRunOutputBytes,
  OUTPUT_TOO_LARGE_CODE,
  RUN_OUTPUT_LIMIT_BYTES,
} from "./run-output-limit.ts";

// The same vectors are in veryfront-api src/lib/types/run-output-limit.test.ts
// (veryfront/veryfront-issue-inbox#2113).
const AT_LIMIT = "x".repeat(1_048_574); // 1,048,574 characters + 2 quotes = 1,048,576 bytes
const OVER_LIMIT = "x".repeat(1_048_575); // 1,048,577 bytes
const MULTI_BYTE = "€".repeat(349_524); // 3 bytes each + 2 quotes = 1,048,574 bytes
const MULTI_BYTE_OVER = "€".repeat(349_525); // 1,048,577 bytes

describe("task/run-output-limit", () => {
  it("is 1 MiB", () => {
    assertEquals(RUN_OUTPUT_LIMIT_BYTES, 1_048_576);
  });

  it("measures the UTF-8 bytes of the JSON serialization", () => {
    assertEquals(measureRunOutputBytes(AT_LIMIT), 1_048_576);
    assertEquals(measureRunOutputBytes(OVER_LIMIT), 1_048_577);
    assertEquals(measureRunOutputBytes(MULTI_BYTE), 1_048_574);
    assertEquals(measureRunOutputBytes(MULTI_BYTE_OVER), 1_048_577);
    assertEquals(measureRunOutputBytes({ a: 1 }), 7);
    assertEquals(measureRunOutputBytes("\u{1F600}"), 6); // surrogate pair: 4 bytes + 2 quotes
    assertEquals(measureRunOutputBytes(null), 4);
    assertEquals(measureRunOutputBytes(undefined), 4);
  });

  it("allows an output of exactly 1 MiB", () => {
    assertEquals(checkRunOutputLimit(AT_LIMIT), null);
    assertEquals(checkRunOutputLimit(MULTI_BYTE), null);
  });

  it("fails an output of 1 MiB + 1 byte with OUTPUT_TOO_LARGE naming both sizes", () => {
    assertEquals(checkRunOutputLimit(OVER_LIMIT), {
      code: OUTPUT_TOO_LARGE_CODE,
      message: "Run output is 1048577 bytes, over the limit of 1048576 bytes",
      detail: { size_bytes: 1_048_577, limit_bytes: 1_048_576 },
    });
    assertEquals(checkRunOutputLimit(MULTI_BYTE_OVER)?.detail.size_bytes, 1_048_577);
  });
});
