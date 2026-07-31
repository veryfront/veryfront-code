import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeResponse } from "./env.ts";
import {
  extractResourceTiming,
  MAX_SERVER_TIMING_LENGTH,
  parseServerTimingMetrics,
  readResponseServerTiming,
  sanitizeServerTimingHeader,
  sanitizeServerTimingMetricName,
} from "./route-timing.ts";

describe("hydration-script-builder/runtime/route-timing", () => {
  describe("sanitizeServerTimingHeader", () => {
    it("returns null for empty or absent input", () => {
      assertEquals(sanitizeServerTimingHeader(null), null);
      assertEquals(sanitizeServerTimingHeader(undefined), null);
      assertEquals(sanitizeServerTimingHeader(""), null);
      assertEquals(sanitizeServerTimingHeader("   "), null);
    });

    it("strips non-printable characters", () => {
      assertEquals(sanitizeServerTimingHeader("cache\u0000;dur=5"), "cache;dur=5.00");
      assertEquals(sanitizeServerTimingHeader("db\u0007query;dur=5"), "db_query;dur=5.00");
    });

    it("keeps only well-formed name;dur= metrics", () => {
      assertEquals(
        sanitizeServerTimingHeader('miss, db;dur=2, app;desc="render"'),
        "db;dur=2.00",
      );
    });

    it("rejects negative and non-finite durations", () => {
      assertEquals(sanitizeServerTimingHeader("db;dur=-1"), null);
      assertEquals(sanitizeServerTimingHeader("db;dur=abc"), null);
      assertEquals(sanitizeServerTimingHeader("db;dur=Infinity"), null);
    });

    it("rounds durations to two decimals", () => {
      assertEquals(sanitizeServerTimingHeader("db;dur=1.234"), "db;dur=1.23");
      assertEquals(sanitizeServerTimingHeader('db;dur="2.567"'), "db;dur=2.57");
    });

    it("caps the sanitized header at MAX_SERVER_TIMING_LENGTH", () => {
      const header = Array.from({ length: 200 }, (_, index) => `m${index};dur=1`).join(",");
      const sanitized = sanitizeServerTimingHeader(header);

      assertEquals(sanitized?.length, MAX_SERVER_TIMING_LENGTH);
    });
  });

  describe("sanitizeServerTimingMetricName", () => {
    it("replaces disallowed characters with underscores", () => {
      assertEquals(sanitizeServerTimingMetricName(" db query! "), "db_query_");
      assertEquals(sanitizeServerTimingMetricName("app.render-1_x"), "app.render-1_x");
      assertEquals(sanitizeServerTimingMetricName(undefined), "");
    });

    it("caps the name at 128 characters", () => {
      assertEquals(sanitizeServerTimingMetricName("x".repeat(200)).length, 128);
    });
  });

  describe("parseServerTimingMetrics", () => {
    it("returns a numeric record of the metrics", () => {
      assertEquals(parseServerTimingMetrics("db;dur=1.5, cache;dur=2"), { db: 1.5, cache: 2 });
    });

    it("returns null when there are no metrics", () => {
      assertEquals(parseServerTimingMetrics("db"), null);
      assertEquals(parseServerTimingMetrics(null), null);
    });
  });

  describe("extractResourceTiming", () => {
    it("keeps only finite non-negative numeric fields from the known field list", () => {
      assertEquals(
        extractResourceTiming({
          startTime: 1.234,
          requestStart: -1,
          responseStart: Number.NaN,
          responseEnd: 5,
          duration: Number.POSITIVE_INFINITY,
          transferSize: 0,
          encodedBodySize: "12",
          unrelatedField: 9,
        }),
        { startTime: 1.23, responseEnd: 5, transferSize: 0 },
      );
    });

    it("returns null when nothing qualifies", () => {
      assertEquals(extractResourceTiming({ duration: -1, unrelatedField: 9 }), null);
      assertEquals(extractResourceTiming({}), null);
      assertEquals(extractResourceTiming(null), null);
      assertEquals(extractResourceTiming(undefined), null);
    });
  });

  describe("readResponseServerTiming", () => {
    it("returns the sanitized header", () => {
      const response = {
        headers: { get: () => "db;dur=2" },
      } as unknown as RuntimeResponse;

      assertEquals(readResponseServerTiming(response), "db;dur=2.00");
    });

    it("returns null when headers.get throws", () => {
      const response = {
        headers: {
          get: () => {
            throw new Error("headers are unavailable");
          },
        },
      } as unknown as RuntimeResponse;

      assertEquals(readResponseServerTiming(response), null);
    });
  });
});
