import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createStreamRetentionBudget,
  reserveStreamRetention,
  STREAM_FRAGMENT_COMPACTION_SIZE,
  StreamFragmentBuffer,
} from "./stream-retention.ts";

const LIMITS = { maxBytes: 16, maxEmptyFragments: 2 };

describe("reserveStreamRetention", () => {
  it("bounds non-empty fragments by bytes, not by fragment count", () => {
    const budget = createStreamRetentionBudget();
    const limits = { maxBytes: 100_000, maxEmptyFragments: 1 };
    for (let index = 0; index < 100_000; index++) {
      assertEquals(reserveStreamRetention(budget, "x", limits), undefined);
    }
    assertEquals(budget, { bytes: 100_000, emptyFragments: 0 });
    assertEquals(reserveStreamRetention(budget, "x", limits), "bytes");
  });

  it("accepts the exact byte limit and rejects limit plus one without charging it", () => {
    const budget = createStreamRetentionBudget();
    assertEquals(reserveStreamRetention(budget, "é".repeat(7), LIMITS), undefined);
    assertEquals(reserveStreamRetention(budget, "ab", LIMITS), undefined);
    assertEquals(budget.bytes, 16);
    assertEquals(reserveStreamRetention(budget, "c", LIMITS), "bytes");
    assertEquals(budget.bytes, 16);
  });

  it("counts only zero-byte fragments against the fragment limit", () => {
    const budget = createStreamRetentionBudget();
    assertEquals(reserveStreamRetention(budget, "", LIMITS), undefined);
    assertEquals(reserveStreamRetention(budget, "a", LIMITS), undefined);
    assertEquals(reserveStreamRetention(budget, "", LIMITS), undefined);
    assertEquals(reserveStreamRetention(budget, "", LIMITS), "empty-fragments");
    assertEquals(budget, { bytes: 1, emptyFragments: 2 });
  });
});

describe("StreamFragmentBuffer", () => {
  it("reassembles fragments in order, including the initial value", () => {
    const buffer = new StreamFragmentBuffer("start:");
    for (const fragment of ["a", "", "bc", "d"]) buffer.append(fragment);
    assertEquals(buffer.toString(), "start:abcd");
  });

  it("keeps storage proportional to content for many one-byte fragments", () => {
    const buffer = new StreamFragmentBuffer();
    const count = 100_000;
    for (let index = 0; index < count; index++) buffer.append(String(index % 10));
    const expected = Array.from({ length: count }, (_, index) => String(index % 10)).join("");
    assertEquals(buffer.toString(), expected);
    assertEquals(
      buffer.storageEntries <= Math.ceil(count / STREAM_FRAGMENT_COMPACTION_SIZE) +
          STREAM_FRAGMENT_COMPACTION_SIZE,
      true,
    );
  });
});
