import { performanceMonotonicClock } from "./clock.ts";
import type { StreamLifecyclePolicy } from "./types.ts";

export const DEFAULT_STREAM_LIFECYCLE_POLICY: StreamLifecyclePolicy = {
  clock: performanceMonotonicClock,
  firstProgressTimeoutMs: 60_000,
  semanticIdleTimeoutMs: 15_000,
  toolInputIdleTimeoutMs: 15_000,
  toolCommitGraceMs: 250,
  statusIntervalMs: 5_000,
  attemptTimeoutMs: 300_000,
};

export function resolveStreamLifecyclePolicy(
  input: Partial<StreamLifecyclePolicy> = {},
): StreamLifecyclePolicy {
  return { ...DEFAULT_STREAM_LIFECYCLE_POLICY, ...input };
}
