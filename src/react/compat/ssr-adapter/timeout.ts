import { SSR_MAX_BUFFERED_BYTES, SSR_TIMEOUT_MS } from "#veryfront/config/defaults.ts";

let timeoutOverrideMs: number | undefined;
let deadlineRuntimeOverride: SSRAdapterDeadlineRuntime | undefined;

export interface SSRAdapterDeadlineRuntime {
  now(): number;
  setTimer(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
  clearTimer(handle: ReturnType<typeof setTimeout>): void;
}

const defaultDeadlineRuntime: SSRAdapterDeadlineRuntime = {
  now: () => performance.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle),
};

export function getSSRAdapterTimeoutMs(): number {
  return timeoutOverrideMs ?? SSR_TIMEOUT_MS;
}

export function setSSRAdapterTimeoutForTests(timeoutMs: number): void {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("SSR adapter timeout must be a positive safe integer");
  }
  timeoutOverrideMs = timeoutMs;
}

export function getSSRAdapterDeadlineRuntime(): SSRAdapterDeadlineRuntime {
  return deadlineRuntimeOverride ?? defaultDeadlineRuntime;
}

export function setSSRAdapterDeadlineRuntimeForTests(
  runtime: SSRAdapterDeadlineRuntime,
): void {
  deadlineRuntimeOverride = runtime;
}

export function resetSSRAdapterTimeoutForTests(): void {
  timeoutOverrideMs = undefined;
  deadlineRuntimeOverride = undefined;
}

export function getSSRBufferLimitBytes(override: number | undefined): number {
  const limit = override ?? SSR_MAX_BUFFERED_BYTES;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError("SSR buffered output limit must be a positive safe integer");
  }
  return limit;
}
