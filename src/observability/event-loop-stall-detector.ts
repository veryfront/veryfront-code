/**
 * Event-loop stall detector.
 *
 * A synchronous task that holds the main thread starves every timer, probe
 * and request on the pod. The process cannot log while it is blocked, so the
 * detector samples a fixed cadence and, on the first tick after the loop
 * resumes, reports how long it was blocked and which requests were already in
 * flight before the block began. Those requests are the candidates for the
 * work that held the thread.
 */

import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { unrefTimer } from "#veryfront/compat/process.ts";

const logger = serverLogger.component("event-loop");

const DEFAULT_INTERVAL_MS = 1_000;
/** Below the 1s liveness probe timeouts we are trying to explain, above GC noise. */
const DEFAULT_STALL_THRESHOLD_MS = 2_000;
const MAX_REPORTED_REQUESTS = 20;

export interface InFlightRequestSample {
  requestId: string;
  projectSlug?: string;
  path: string;
  method: string;
  startTime: number;
}

export interface EventLoopStall {
  lagMs: number;
  /** Monotonic time of the last on-time tick, i.e. when the block began at the latest. */
  stalledFromMs: number;
  inFlight: Array<InFlightRequestSample & { ageMs: number }>;
}

export interface EventLoopStallDetectorOptions {
  intervalMs?: number;
  stallThresholdMs?: number;
  now?: () => number;
  /** Schedules a repeating tick and returns a cancel function. */
  schedule?: (tick: () => void, intervalMs: number) => () => void;
  getInFlightRequests?: () => readonly InFlightRequestSample[];
  onStall?: (stall: EventLoopStall) => void;
}

export interface EventLoopStallDetector {
  start(): void;
  stop(): void;
  /** Largest lag seen since the previous call; resets to 0. */
  takeMaxLagMs(): number;
}

function defaultSchedule(tick: () => void, intervalMs: number): () => void {
  const handle = setInterval(tick, intervalMs);
  unrefTimer(handle);
  return () => clearInterval(handle);
}

function logStall(stall: EventLoopStall): void {
  logger.error("Event loop stalled", {
    lagMs: stall.lagMs,
    inFlightCount: stall.inFlight.length,
    inFlight: stall.inFlight,
  });
}

export function createEventLoopStallDetector(
  options: EventLoopStallDetectorOptions = {},
): EventLoopStallDetector {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const thresholdMs = options.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? defaultSchedule;
  const getInFlight = options.getInFlightRequests ?? (() => []);
  const onStall = options.onStall ?? logStall;

  let cancel: (() => void) | undefined;
  let lastTick = 0;
  let maxLagMs = 0;

  const tick = () => {
    const current = now();
    const lagMs = Math.max(0, current - lastTick - intervalMs);
    const stalledFromMs = lastTick;
    lastTick = current;
    if (lagMs > maxLagMs) maxLagMs = lagMs;
    if (lagMs < thresholdMs) return;

    const inFlight = getInFlight()
      .filter((r) => r.startTime <= stalledFromMs)
      .sort((a, b) => a.startTime - b.startTime)
      .slice(0, MAX_REPORTED_REQUESTS)
      .map((r) => ({
        requestId: r.requestId,
        projectSlug: r.projectSlug,
        path: r.path,
        method: r.method,
        startTime: r.startTime,
        ageMs: Math.round(current - r.startTime),
      }));
    try {
      onStall({ lagMs: Math.round(lagMs), stalledFromMs, inFlight });
    } catch {
      // Observability must never break the sampler.
    }
  };

  return {
    start() {
      if (cancel) return;
      lastTick = now();
      cancel = schedule(tick, intervalMs);
    },
    stop() {
      cancel?.();
      cancel = undefined;
    },
    takeMaxLagMs() {
      const value = Math.round(maxLagMs);
      maxLagMs = 0;
      return value;
    },
  };
}

let processDetector: EventLoopStallDetector | undefined;

/**
 * Starts the process-wide detector read by the `event_loop.max_lag` gauge.
 * The server passes its request tracker so a stall names its requests.
 */
export function startProcessEventLoopStallDetector(
  options: Pick<EventLoopStallDetectorOptions, "getInFlightRequests"> = {},
): EventLoopStallDetector {
  processDetector?.stop();
  processDetector = createEventLoopStallDetector(options);
  processDetector.start();
  return processDetector;
}

/** Largest lag of the process detector since the last read; 0 when not running. */
export function takeProcessEventLoopMaxLagMs(): number {
  return processDetector?.takeMaxLagMs() ?? 0;
}
