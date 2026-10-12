import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createEventLoopStallDetector,
  type EventLoopStall,
  type InFlightRequestSample,
  isProcessEventLoopStallDetectorRunning,
  startProcessEventLoopStallDetector,
} from "./event-loop-stall-detector.ts";

function harness(
  inFlight: InFlightRequestSample[] = [],
) {
  let clock = 0;
  let tick: (() => void) | undefined;
  const stalls: EventLoopStall[] = [];
  const detector = createEventLoopStallDetector({
    intervalMs: 1_000,
    stallThresholdMs: 5_000,
    now: () => clock,
    schedule: (fn) => {
      tick = fn;
      return () => (tick = undefined);
    },
    getInFlightRequests: () => inFlight,
    onStall: (stall) => stalls.push(stall),
  });
  return {
    detector,
    stalls,
    advance(ms: number) {
      clock += ms;
      tick?.();
    },
    get scheduled() {
      return tick !== undefined;
    },
  };
}

describe("observability/event-loop-stall-detector", () => {
  it("reports no stall while the loop keeps its cadence", () => {
    const h = harness();
    h.detector.start();
    h.advance(1_000);
    h.advance(1_050);
    assertEquals(h.stalls.length, 0);
    assertEquals(h.detector.takeMaxLagMs(), 50);
    assertEquals(h.detector.takeMaxLagMs(), 0);
  });

  it("names the requests in flight across a 57s block when the loop resumes", () => {
    const h = harness([
      { requestId: "a", path: "/api/articles-2", method: "GET", startTime: 500 },
      { requestId: "b", path: "/late", method: "GET", startTime: 58_500 },
    ]);
    h.detector.start();
    h.advance(1_000);
    h.advance(58_000); // 57s of lag beyond the 1s interval
    assertEquals(h.stalls.length, 1);
    const stall = h.stalls[0]!;
    assertEquals(stall.lagMs, 57_000);
    assertEquals(stall.stalledFromMs, 1_000);
    assertEquals(stall.inFlight.map((r) => r.requestId), ["a"]);
    assertEquals(stall.inFlight[0]!.path, "/api/articles-2");
    assertEquals(h.detector.takeMaxLagMs(), 57_000);
  });

  it("names a request that started after the last on-time tick but before the block", () => {
    const h = harness([
      { requestId: "stream", path: "/sse", method: "GET", startTime: 100 },
      { requestId: "culprit", path: "/api/articles-2", method: "GET", startTime: 1_500 },
    ]);
    h.detector.start();
    h.advance(1_000);
    h.advance(58_000); // tick due at 2_000, block ended at 59_000
    assertEquals(h.stalls[0]!.inFlight.map((r) => r.requestId), ["culprit", "stream"]);
  });

  it("names a request that blocked and completed before the overdue tick ran", () => {
    const h = harness([
      { requestId: "done-early", path: "/old", method: "GET", startTime: 100, endTime: 900 },
      {
        requestId: "before-block",
        path: "/quick",
        method: "GET",
        startTime: 1_100,
        endTime: 1_500,
      },
      { requestId: "sync", path: "/api/block", method: "GET", startTime: 1_500, endTime: 58_900 },
    ]);
    h.detector.start();
    h.advance(1_000);
    h.advance(58_000);
    assertEquals(h.stalls[0]!.inFlight.map((r) => r.requestId), ["sync"]);
  });

  it("stops sampling after stop()", () => {
    const h = harness();
    h.detector.start();
    h.detector.stop();
    assertEquals(h.scheduled, false);
  });

  it("keeps the process detector running until every server stops", () => {
    const first = startProcessEventLoopStallDetector();
    const second = startProcessEventLoopStallDetector();
    second.stop();
    assertEquals(isProcessEventLoopStallDetectorRunning(), true);
    second.stop();
    assertEquals(isProcessEventLoopStallDetectorRunning(), true);
    first.stop();
    assertEquals(isProcessEventLoopStallDetectorRunning(), false);
  });
});
