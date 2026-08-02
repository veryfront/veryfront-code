import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  hasRevisionedCacheRecordPrefix,
  parseRedisRevisionExchangeResult,
  parseRedisRevisionReadResult,
  parseRevisionedCacheRecord,
} from "./revisioned-cache-record.ts";

const frame = (state: "p" | "a", revision: string, payload = "") =>
  `\0VFCAS1\0${state}\0${revision}\0${payload}`;

describe("Redis revisioned cache records", () => {
  it("decodes present records without altering raw payload bytes", () => {
    const value = "payload\0with\ncontrols";

    assertEquals(parseRevisionedCacheRecord(frame("p", "17", value)), {
      kind: "present",
      revision: "17",
      value,
    });
  });

  it("decodes absent records only when the payload is empty", () => {
    assertEquals(parseRevisionedCacheRecord(frame("a", "18")), {
      kind: "absent",
      revision: "18",
    });
    assertThrows(
      () => parseRevisionedCacheRecord(frame("a", "18", "unexpected")),
      TypeError,
      "absent",
    );
  });

  it("rejects malformed framing and non-canonical revisions", () => {
    for (
      const invalid of [
        "plain-value",
        "\0VFCAS2\0p\0" + "1\0value",
        frame("p", "0", "value"),
        frame("p", "01", "value"),
        frame("p", "9223372036854775808", "value"),
        frame("p", "+1", "value"),
        frame("p", "-1", "value"),
        frame("p", " 1", "value"),
        frame("p", "1 ", "value"),
        frame("p", "1.0", "value"),
        frame("p", "1e3", "value"),
        frame("p", "1x", "value"),
        "\0VFCAS1\0x\0" + "1\0value",
        "\0VFCAS1\0p\0" + "1",
      ]
    ) {
      assertThrows(() => parseRevisionedCacheRecord(invalid), TypeError);
    }
  });

  it("accepts the exact maximum signed 64-bit revision", () => {
    assertEquals(
      parseRevisionedCacheRecord(
        frame("p", "9223372036854775807", "value"),
      ),
      {
        kind: "present",
        revision: "9223372036854775807",
        value: "value",
      },
    );
  });

  it("recognizes only the framed record prefix", () => {
    assertEquals(hasRevisionedCacheRecordPrefix(frame("p", "1", "value")), true);
    assertEquals(hasRevisionedCacheRecordPrefix("\0VFCAS1"), false);
    assertEquals(hasRevisionedCacheRecordPrefix(null), false);
  });

  it("parses only the exact Redis read response variants", () => {
    assertEquals(parseRedisRevisionReadResult([0, "21"]), {
      value: null,
      revision: "21",
    });
    assertEquals(parseRedisRevisionReadResult([1, "22", "raw\0value"]), {
      value: "raw\0value",
      revision: "22",
    });

    for (
      const invalid of [
        null,
        [0],
        [0, "21", "extra"],
        [1, "22"],
        [1, "22", null],
        [2, "22", "value"],
        [0, "01"],
      ]
    ) {
      assertThrows(() => parseRedisRevisionReadResult(invalid), TypeError);
    }
  });

  it("parses exchange results only from Redis integer zero or one", () => {
    assertEquals(parseRedisRevisionExchangeResult(0), false);
    assertEquals(parseRedisRevisionExchangeResult(1), true);

    for (const invalid of [false, true, "0", "1", -1, 2, null]) {
      assertThrows(() => parseRedisRevisionExchangeResult(invalid), TypeError);
    }
  });

  it("returns detached frozen read snapshots", async () => {
    const raw: unknown[] = [1, "23", "value"];
    const result = parseRedisRevisionReadResult(raw);
    raw[1] = "24";

    assertEquals(result, { value: "value", revision: "23" });
    await assertRejects(
      () =>
        Promise.resolve().then(() => {
          (result as { revision: string }).revision = "25";
        }),
      TypeError,
    );
  });
});
