import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeResponse, RuntimeWindow } from "./env.ts";
import type { RuntimeLogging } from "./shared.ts";
import {
  createRouteTimingRecorder,
  extractResourceTiming,
  MAX_ROUTE_TIMINGS,
  MAX_SERVER_TIMING_LENGTH,
  parseServerTimingMetrics,
  readResponseServerTiming,
  type RouteTimingRecorder,
  sanitizeServerTimingHeader,
  sanitizeServerTimingMetricName,
} from "./route-timing.ts";

function silentLogging(): RuntimeLogging {
  return {
    DEBUG: false,
    log: () => {},
    logError: () => {},
    logBackgroundFetchFailure: () => {},
    perfStart: () => {},
    perfEnd: () => 0,
  };
}

interface RecorderHarness {
  recorder: RouteTimingRecorder;
  window: RuntimeWindow;
  dispatched: CustomEvent[];
}

function createRecorderHarness(options: { throwOnDispatch?: boolean } = {}): RecorderHarness {
  const dispatched: CustomEvent[] = [];
  const window = {
    location: { href: "https://example.test/docs" },
    dispatchEvent: (event: unknown) => {
      if (options.throwOnDispatch) throw new Error("dispatch is unavailable");
      dispatched.push(event as CustomEvent);
      return true;
    },
  } as unknown as RuntimeWindow;

  return { recorder: createRouteTimingRecorder(window, silentLogging()), window, dispatched };
}

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
      let requested: string | undefined;
      const response = {
        headers: {
          get: (name: string) => {
            requested = name;
            return "db;dur=2";
          },
        },
      } as unknown as RuntimeResponse;

      assertEquals(
        readResponseServerTiming(response),
        "db;dur=2.00",
        "the header value must come back sanitized",
      );
      assertEquals(
        requested,
        "server-timing",
        "the Server-Timing header must be read by its standard name",
      );
    });

    it("returns null when the response carries no Server-Timing header", () => {
      const response = {
        headers: { get: () => null },
      } as unknown as RuntimeResponse;

      assertEquals(
        readResponseServerTiming(response),
        null,
        "a response without the header must report no server timing",
      );
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

  describe("createRouteTimingRecorder", () => {
    it("caps the route timing buffer and drops the oldest entries first", () => {
      const { recorder, window } = createRecorderHarness();

      for (let index = 0; index < MAX_ROUTE_TIMINGS + 5; index++) {
        recorder.emitRouteTiming("page-data", "p" + index, 0);
      }

      assertEquals(
        window.__veryfrontRouteTimings?.length,
        MAX_ROUTE_TIMINGS,
        "the route timing buffer must stay capped",
      );
      assertEquals(
        window.__veryfrontRouteTimings?.[0]?.path,
        "p5",
        "the oldest entries must be dropped first",
      );
    });

    it("dispatches the documented route timing event for every entry", () => {
      const { recorder, dispatched } = createRecorderHarness();

      const entry = recorder.emitRouteTiming("page-data", "/docs", 0, { source: "network" });

      assertEquals(dispatched.length, 1, "each timing must dispatch exactly one event");
      assertEquals(
        dispatched[0]?.type,
        "veryfront:route-timing",
        "each timing must dispatch the documented event",
      );
      assertEquals(
        dispatched[0]?.detail,
        entry,
        "the entry must ride on the event detail",
      );
      assertEquals(entry.phase, "page-data", "the entry must carry the emitted phase");
      assertEquals(entry.source, "network", "the caller detail must be merged into the entry");
    });

    it("still records the entry when the event dispatch throws", () => {
      const { recorder, window } = createRecorderHarness({ throwOnDispatch: true });

      const entry = recorder.emitRouteTiming("page-data", "/docs", 0);

      assertEquals(
        window.__veryfrontRouteTimings,
        [entry],
        "a failing dispatch must not lose the recorded timing",
      );
    });
  });

  describe("buildPageDataTimingDetail", () => {
    it("attaches the sanitized server timing and its parsed metrics", () => {
      const { recorder } = createRecorderHarness();
      const response = {
        status: 200,
        url: "",
        headers: { get: () => "db;dur=2" },
      } as unknown as RuntimeResponse;

      const detail = recorder.buildPageDataTimingDetail(
        response,
        "/_vf/page-data/docs",
        0,
        "network",
      );

      assertEquals(detail.source, "network", "the detail must record the fetch source");
      assertEquals(detail.status, 200, "the detail must record the response status");
      assertEquals(
        detail.serverTiming,
        "db;dur=2.00",
        "the sanitized Server-Timing header must reach the detail",
      );
      assertEquals(
        detail.serverTimingMetrics,
        { db: 2 },
        "the parsed Server-Timing metrics must reach the detail",
      );
    });
  });
});
