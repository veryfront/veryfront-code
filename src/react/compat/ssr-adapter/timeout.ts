import { SSR_TIMEOUT_MS } from "#veryfront/config/defaults.ts";

let timeoutOverrideMs: number | undefined;

export function getSSRAdapterTimeoutMs(): number {
  return timeoutOverrideMs ?? SSR_TIMEOUT_MS;
}

export function setSSRAdapterTimeoutForTests(timeoutMs: number): void {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("SSR adapter timeout must be a positive safe integer");
  }
  timeoutOverrideMs = timeoutMs;
}

export function resetSSRAdapterTimeoutForTests(): void {
  timeoutOverrideMs = undefined;
}
