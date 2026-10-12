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
import { unrefTimer } from "#veryfront/compat/process/lifecycle.ts";

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
  /** Set when the request completed; a request that finished during the block is still a candidate. */
  endTime?: number;
}

export interface EventLoopStall {
  lagMs: number;
  /** Monotonic time of the last on-time tick, i.e. the earliest the block can have begun. */
  stalledFromMs: number;
  inFlight: Array<InFlightRequestSample & { ageMs: number }>;
}

export interface EventLoopStallDetectorOptions {
  intervalMs?: number;
  stallThresholdMs?: number;
  now?: () => number;
  /** Schedules a repeating tick and returns a cancel function. */
  schedule?: (tick: () => void, intervalMs: number) => () => void;
  /**
   * Requests in flight, plus requests that completed at or after `sinceMs`
   * (the last on-time tick), so a handler that blocked and then returned
   * before the overdue tick ran is still reported.
   */
  getInFlightRequests?: (sinceMs: number) => readonly InFlightRequestSample[];
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

    // The block ended at `current` and lasted at least `lagMs`, so it began no
    // later than `current - lagMs`. A request that arrived after the last
    // on-time tick but before that point is the likeliest culprit; newest
    // first so long-lived streams cannot push it past the report cap.
    const blockStartedByMs = current - lagMs;
    const inFlight = getInFlight(stalledFromMs)
      .filter((r) =>
        r.startTime <= blockStartedByMs && (r.endTime === undefined || r.endTime >= stalledFromMs)
      )
      .sort((a, b) => b.startTime - a.startTime)
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
const processSources = new Set<(sinceMs: number) => readonly InFlightRequestSample[]>();

/** Handle for one server's registration with the process-wide detector. */
export interface ProcessEventLoopStallRegistration {
  /** Unregisters this server; the detector stops when no server remains. */
  stop(): void;
}

/**
 * Registers a server with the process-wide detector read by the
 * `event_loop.max_lag` gauge, starting it on the first registration. Each
 * server passes its request tracker so a stall names requests from every
 * server sharing the process.
 */
export function startProcessEventLoopStallDetector(
  options: Pick<EventLoopStallDetectorOptions, "getInFlightRequests"> = {},
): ProcessEventLoopStallRegistration {
  const source = options.getInFlightRequests ?? (() => []);
  processSources.add(source);
  if (!processDetector) {
    processDetector = createEventLoopStallDetector({
      // Servers in one process can share a tracker; report each request once.
      getInFlightRequests: (sinceMs) => {
        const byId = new Map<string, InFlightRequestSample>();
        for (const get of processSources) {
          for (const request of get(sinceMs)) byId.set(request.requestId, request);
        }
        return [...byId.values()];
      },
    });
    processDetector.start();
  }
  let active = true;
  return {
    stop() {
      if (!active) return;
      active = false;
      processSources.delete(source);
      if (processSources.size > 0) return;
      processDetector?.stop();
      processDetector = undefined;
    },
  };
}

/** Largest lag of the process detector since the last read; 0 when not running. */
export function takeProcessEventLoopMaxLagMs(): number {
  return processDetector?.takeMaxLagMs() ?? 0;
}

/** True while at least one server is registered with the process detector. */
export function isProcessEventLoopStallDetectorRunning(): boolean {
  return processDetector !== undefined;
}
