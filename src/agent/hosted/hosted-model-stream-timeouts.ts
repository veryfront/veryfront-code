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

const FIRST_PROGRESS_ENV = "VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS";
const SEMANTIC_IDLE_ENV = "VERYFRONT_MODEL_STREAM_SEMANTIC_IDLE_TIMEOUT_MS";
const CHAT_IDLE_ENV = "VERYFRONT_CHAT_STREAM_IDLE_TIMEOUT_MS";

/** Receives the one-time notice emitted when an unset model budget is derived. */
export type HostedModelStreamTimeoutWarn = (
  message: string,
  metadata: Record<string, unknown>,
) => void;

const warnedDerivedBudgets = new Set<string>();

/** @internal Reset one-time derivation notices between tests. */
export function resetHostedModelStreamTimeoutWarningsForTests(): void {
  warnedDerivedBudgets.clear();
}

function warnDerivedBudgetOnce(
  warn: HostedModelStreamTimeoutWarn | undefined,
  key: string,
  message: string,
  metadata: Record<string, unknown>,
): void {
  if (!warn || warnedDerivedBudgets.has(key)) return;
  warnedDerivedBudgets.add(key);
  warn(message, metadata);
}

/**
 * Resolve only host-owned model stream budgets, leaving omitted fields at
 * framework defaults.
 *
 * An explicit model budget whose worst-case window does not fit under the
 * outer chat watchdog is a configuration error. An unset budget whose
 * framework default does not fit (for example a watchdog pinned to the
 * pre-150s default of 120000ms) is instead derived as the largest value that
 * fits, with a one-time warning, so upgrades never reject every request.
 */
export function resolveHostedModelStreamTimeouts(
  config: Pick<
    AgentServiceConfig,
    | "VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS"
    | "VERYFRONT_MODEL_STREAM_SEMANTIC_IDLE_TIMEOUT_MS"
  >,
  outerIdleTimeoutMs: number,
  warn?: HostedModelStreamTimeoutWarn,
): ModelStreamTimeouts | undefined {
  let firstProgressTimeoutMs = config.VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS;
  let semanticIdleTimeoutMs = config.VERYFRONT_MODEL_STREAM_SEMANTIC_IDLE_TIMEOUT_MS;

  if (firstProgressTimeoutMs !== undefined) {
    const windowMs = hostedFirstProgressWindowMs(firstProgressTimeoutMs);
    if (windowMs >= outerIdleTimeoutMs) {
      throw new TypeError(
        `Hosted model first progress timeout window must be shorter than the chat stream idle timeout: ${FIRST_PROGRESS_ENV}=${firstProgressTimeoutMs} x ${RUNTIME_PROVIDER_STREAM_ATTEMPTS} attempts = ${windowMs}ms, effective ${CHAT_IDLE_ENV}=${outerIdleTimeoutMs}ms`,
      );
    }
  } else {
    const defaultMs = DEFAULT_STREAM_LIFECYCLE_POLICY.firstProgressTimeoutMs;
    if (hostedFirstProgressWindowMs(defaultMs) >= outerIdleTimeoutMs) {
      const derivedMs = Math.floor((outerIdleTimeoutMs - 1) / RUNTIME_PROVIDER_STREAM_ATTEMPTS);
      if (derivedMs < 1) {
        throw new TypeError(
          `Hosted chat stream idle timeout is too short for any model first progress budget: effective ${CHAT_IDLE_ENV}=${outerIdleTimeoutMs}ms`,
        );
      }
      firstProgressTimeoutMs = derivedMs;
      warnDerivedBudgetOnce(
        warn,
        `first:${outerIdleTimeoutMs}`,
        `${FIRST_PROGRESS_ENV} is unset and its ${defaultMs}ms default (x ${RUNTIME_PROVIDER_STREAM_ATTEMPTS} attempts) does not fit under ${CHAT_IDLE_ENV}=${outerIdleTimeoutMs}ms; using ${derivedMs}ms. Raise ${CHAT_IDLE_ENV} or set ${FIRST_PROGRESS_ENV} explicitly.`,
        {
          [FIRST_PROGRESS_ENV]: derivedMs,
          [CHAT_IDLE_ENV]: outerIdleTimeoutMs,
          attempts: RUNTIME_PROVIDER_STREAM_ATTEMPTS,
        },
      );
    }
  }

  if (semanticIdleTimeoutMs !== undefined) {
    if (semanticIdleTimeoutMs >= outerIdleTimeoutMs) {
      throw new TypeError(
        `Hosted model semantic idle timeout window must be shorter than the chat stream idle timeout: ${SEMANTIC_IDLE_ENV}=${semanticIdleTimeoutMs}ms, effective ${CHAT_IDLE_ENV}=${outerIdleTimeoutMs}ms`,
      );
    }
  } else {
    const defaultMs = DEFAULT_STREAM_LIFECYCLE_POLICY.semanticIdleTimeoutMs;
    if (defaultMs >= outerIdleTimeoutMs) {
      const derivedMs = outerIdleTimeoutMs - 1;
      if (derivedMs < 1) {
        throw new TypeError(
          `Hosted chat stream idle timeout is too short for any model semantic idle budget: effective ${CHAT_IDLE_ENV}=${outerIdleTimeoutMs}ms`,
        );
      }
      semanticIdleTimeoutMs = derivedMs;
      warnDerivedBudgetOnce(
        warn,
        `idle:${outerIdleTimeoutMs}`,
        `${SEMANTIC_IDLE_ENV} is unset and its ${defaultMs}ms default does not fit under ${CHAT_IDLE_ENV}=${outerIdleTimeoutMs}ms; using ${derivedMs}ms. Raise ${CHAT_IDLE_ENV} or set ${SEMANTIC_IDLE_ENV} explicitly.`,
        { [SEMANTIC_IDLE_ENV]: derivedMs, [CHAT_IDLE_ENV]: outerIdleTimeoutMs },
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
  warn?: HostedModelStreamTimeoutWarn,
): AgentRuntimeInternalOptions | undefined {
  const modelStreamTimeouts = resolveHostedModelStreamTimeouts(config, outerIdleTimeoutMs, warn);
  if (modelStreamTimeouts === undefined) return runtimeOptions;
  return { ...runtimeOptions, modelStreamTimeouts };
}
