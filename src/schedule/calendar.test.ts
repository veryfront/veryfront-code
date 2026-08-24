import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isSupportedIanaTimezone, normalizeCronExpression } from "./calendar.ts";

describe("schedule calendar", () => {
  describe("normalizeCronExpression()", () => {
    it("canonicalizes numeric, named, range, list, and step fields", () => {
      assertEquals(
        normalizeCronExpression("  00  */06  01-15/02  jan,mar  mon-fri  "),
        "0 */6 1-15/2 JAN,MAR MON-FRI",
      );
    });

    it("accepts both portable Sunday numbers", () => {
      assertEquals(normalizeCronExpression("0 0 * * 0,7"), "0 0 * * 0,7");
    });

    it("rejects unsupported or out-of-range syntax", () => {
      for (
        const expression of [
          "0 0 * *",
          "0 0 * * * *",
          "0\t0 * * *",
          "0 0 * * FUNDAY",
          "0 0 * * MON-SUN",
          "*/61 0 * * *",
          "0 0 * * MON/0",
          "0 0 * * MON,,FRI",
        ]
      ) {
        assertEquals(normalizeCronExpression(expression), null);
      }
    });
  });

  describe("isSupportedIanaTimezone()", () => {
    it("accepts UTC and recognized area-based zones", () => {
      assertEquals(isSupportedIanaTimezone("UTC"), true);
      assertEquals(isSupportedIanaTimezone("Europe/Stockholm"), true);
    });

    it("rejects offsets, malformed names, and unknown zones", () => {
      for (const timezone of ["+02:00", "Stockholm", "../UTC", "Mars/Olympus"]) {
        assertEquals(isSupportedIanaTimezone(timezone), false);
      }
    });
  });
});
