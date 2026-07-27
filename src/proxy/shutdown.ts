import { MAX_PROXY_TIMER_DELAY_MS } from "./timing.ts";

export interface ProxyShutdownStep {
  readonly name: string;
  readonly run: () => void | Promise<void>;
}

export type ProxyShutdownStepFailure =
  | Readonly<{
    step: string;
    status: "failed";
    error: unknown;
  }>
  | Readonly<{
    step: string;
    status: "timeout";
  }>;

function validateCleanupTimeout(timeoutMs: number): void {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > MAX_PROXY_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `Proxy shutdown cleanup timeout must be an integer between 0 and ${MAX_PROXY_TIMER_DELAY_MS}`,
    );
  }
}

function validateStep(step: ProxyShutdownStep): void {
  if (
    !step ||
    typeof step !== "object" ||
    typeof step.name !== "string" ||
    step.name.length === 0 ||
    step.name !== step.name.trim() ||
    typeof step.run !== "function"
  ) {
    throw new TypeError("Proxy shutdown steps must have a canonical name and run function");
  }
}

/**
 * Run every cleanup step in order within one shared deadline.
 *
 * A rejected or timed-out step never prevents later steps from starting. The
 * returned failures let the process choose its exit status after best-effort
 * cleanup has completed.
 */
export async function runProxyShutdownSteps(
  steps: readonly ProxyShutdownStep[],
  timeoutMs: number,
): Promise<readonly ProxyShutdownStepFailure[]> {
  if (!Array.isArray(steps)) {
    throw new TypeError("Proxy shutdown steps must be an array");
  }
  validateCleanupTimeout(timeoutMs);
  for (const step of steps) validateStep(step);

  const deadline = performance.now() + timeoutMs;
  const failures: ProxyShutdownStepFailure[] = [];

  for (const step of steps) {
    let result: void | Promise<void>;
    try {
      result = step.run();
    } catch (error) {
      failures.push(Object.freeze({
        step: step.name,
        status: "failed",
        error,
      }));
      continue;
    }

    if (!result) continue;

    let operation: Promise<void>;
    try {
      if (typeof result.then !== "function") continue;
      operation = Promise.resolve(result);
    } catch (error) {
      failures.push(Object.freeze({
        step: step.name,
        status: "failed",
        error,
      }));
      continue;
    }
    const remainingMs = Math.max(0, deadline - performance.now());
    if (remainingMs === 0) {
      void operation.catch(() => undefined);
      failures.push(Object.freeze({
        step: step.name,
        status: "timeout",
      }));
      continue;
    }

    type Outcome =
      | { readonly status: "completed" }
      | { readonly status: "failed"; readonly error: unknown }
      | { readonly status: "timeout" };
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race<Outcome>([
      operation.then(
        () => ({ status: "completed" }),
        (error) => ({ status: "failed", error }),
      ),
      new Promise<Outcome>((resolve) => {
        timeoutId = setTimeout(
          () => resolve({ status: "timeout" }),
          remainingMs,
        );
      }),
    ]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);

    if (outcome.status === "failed") {
      failures.push(Object.freeze({
        step: step.name,
        status: "failed",
        error: outcome.error,
      }));
    } else if (outcome.status === "timeout") {
      failures.push(Object.freeze({
        step: step.name,
        status: "timeout",
      }));
    }
  }

  return Object.freeze(failures);
}
