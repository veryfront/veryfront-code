import type { ModelStreamTimeouts } from "../types.ts";
import type { AgentServiceConfig } from "../service/config.ts";
import type { AgentRuntimeInternalOptions } from "../runtime/index.ts";
import { DEFAULT_STREAM_LIFECYCLE_POLICY } from "../streaming/lifecycle/policy.ts";
import { RUNTIME_PROVIDER_STREAM_ATTEMPTS } from "../runtime/provider-stream-retry-policy.ts";

/**
 * Worst-case wait an effective first-progress budget can produce. Active
 * lifecycle mode replays a stream that timed out before any output, so the
 * deadline can run once per attempt before the failure surfaces.
 */
export function hostedFirstProgressWindowMs(firstProgressTimeoutMs: number): number {
  return firstProgressTimeoutMs * RUNTIME_PROVIDER_STREAM_ATTEMPTS;
}

/** Resolve only host-owned model stream budgets, leaving omitted fields at framework defaults. */
export function resolveHostedModelStreamTimeouts(
  config: Pick<
    AgentServiceConfig,
    | "VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS"
    | "VERYFRONT_MODEL_STREAM_SEMANTIC_IDLE_TIMEOUT_MS"
  >,
  outerIdleTimeoutMs: number,
): ModelStreamTimeouts | undefined {
  const firstProgressTimeoutMs = config.VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS;
  const semanticIdleTimeoutMs = config.VERYFRONT_MODEL_STREAM_SEMANTIC_IDLE_TIMEOUT_MS;
  for (
    const [name, timeoutMs] of [
      [
        "first progress",
        hostedFirstProgressWindowMs(
          firstProgressTimeoutMs ?? DEFAULT_STREAM_LIFECYCLE_POLICY.firstProgressTimeoutMs,
        ),
      ],
      [
        "semantic idle",
        semanticIdleTimeoutMs ?? DEFAULT_STREAM_LIFECYCLE_POLICY.semanticIdleTimeoutMs,
      ],
    ] as const
  ) {
    if (timeoutMs >= outerIdleTimeoutMs) {
      throw new TypeError(
        `Hosted model ${name} timeout window must be shorter than the chat stream idle timeout`,
      );
    }
  }
  if (firstProgressTimeoutMs === undefined && semanticIdleTimeoutMs === undefined) {
    return undefined;
  }
  return {
    ...(firstProgressTimeoutMs === undefined ? {} : { firstProgressTimeoutMs }),
    ...(semanticIdleTimeoutMs === undefined ? {} : { semanticIdleTimeoutMs }),
  };
}

/** Combine a parsed host policy with private runtime options without replacing model authority. */
export function resolveHostedModelRuntimeOptions(
  config: Pick<
    AgentServiceConfig,
    | "VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS"
    | "VERYFRONT_MODEL_STREAM_SEMANTIC_IDLE_TIMEOUT_MS"
  >,
  runtimeOptions: AgentRuntimeInternalOptions | undefined,
  outerIdleTimeoutMs: number,
): AgentRuntimeInternalOptions | undefined {
  const modelStreamTimeouts = resolveHostedModelStreamTimeouts(config, outerIdleTimeoutMs);
  if (modelStreamTimeouts === undefined) return runtimeOptions;
  return { ...runtimeOptions, modelStreamTimeouts };
}
