import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createEvalRunId } from "./run-id.ts";

describe("eval/run-id", () => {
  it("keeps timestamp-sortable run ids and adds a collision-resistant suffix", () => {
    const now = new Date("2026-06-21T01:02:03.004Z");

    assertEquals(createEvalRunId(now, () => "abcdef12"), "evalrun_20260621_010203004_abcdef12");
  });

  it("generates unique ids for runs started in the same millisecond", () => {
    const now = new Date("2026-06-21T01:02:03.004Z");
    const first = createEvalRunId(now);
    const second = createEvalRunId(now);

    if (first === second) {
      throw new Error(`Expected unique eval run ids, received ${first}`);
    }
  });

  it("rejects invalid timestamps and unsafe custom suffixes", () => {
    assertThrows(() => createEvalRunId(new Date(Number.NaN)), Error, "date");
    assertThrows(
      () => createEvalRunId(new Date("2026-06-21T01:02:03.004Z"), () => "../unsafe"),
      Error,
      "suffix",
    );
  });
});
