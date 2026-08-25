import { MAX_PROXY_TIMER_DELAY_MS } from "./timing.ts";
import {
  continueProxyShutdownPromise,
  createProxyShutdownPromise,
  resolveProxyShutdownValue,
} from "./shutdown-intrinsics.ts";

export const DEFAULT_PROXY_SHUTDOWN_CLEANUP_TIMEOUT_MS = 4_000;

export interface ProxyShutdownStep {
  readonly name: string;
  readonly run: () => void | PromiseLike<void>;
  /** Earlier steps that must complete before this owner can be released. */
  readonly requires?: readonly string[];
}

export interface ProxyShutdownFailure {
  readonly step: string;
  readonly error: unknown;
  readonly timedOut: boolean;
}

export interface RunProxyShutdownStepsOptions {
  readonly timeoutMs: number;
  readonly onFailure?: (failure: ProxyShutdownFailure) => void;
}

// This module is evaluated by shutdown-hooks before extension activation.
// Capture every mutable host intrinsic used by the later shutdown path now.
const NativeDOMException = DOMException;
const NativeError = Error;
const NativeMath = Math;
const NativeNumber = Number;
const NativeRangeError = RangeError;
const NativeString = String;
const NativeTypeError = TypeError;
const apply = Reflect.apply;
const clearTimer = clearTimeout;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const isArray = Array.isArray;
const isSafeInteger = Number.isSafeInteger;
const mathMax = Math.max;
const monotonicClock = performance;
const monotonicNow = performance.now;
const setTimer = setTimeout;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringTrim = String.prototype.trim;

function appendArrayValue<T>(array: T[], value: T): void {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = true;
  descriptor.enumerable = true;
  descriptor.value = value;
  descriptor.writable = true;
  defineProperty(array, array.length, descriptor);
}

function defineRecordValue(
  record: Record<string, true>,
  key: string,
): void {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = true;
  descriptor.enumerable = true;
  descriptor.value = true;
  descriptor.writable = true;
  defineProperty(record, key, descriptor);
}

function hasOwn(object: Record<string, true>, key: PropertyKey): boolean {
  return apply(hasOwnProperty, object, [key]) as boolean;
}

function isInteger(value: unknown): value is number {
  return apply(isSafeInteger, NativeNumber, [value]) as boolean;
}

function now(): number {
  return apply(monotonicNow, monotonicClock, []) as number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" &&
    (apply(stringTrim, value, []) as string).length > 0;
}

function isAsciiDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index++) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    if (code < 48 || code > 57) return false;
  }
  return true;
}

export function parseProxyShutdownCleanupTimeoutMs(
  rawValue: string | undefined,
  defaultValue = DEFAULT_PROXY_SHUTDOWN_CLEANUP_TIMEOUT_MS,
): number {
  if (
    !isInteger(defaultValue) || defaultValue < 0 ||
    defaultValue > MAX_PROXY_TIMER_DELAY_MS
  ) {
    throw new NativeRangeError(
      `Default proxy shutdown cleanup timeout must be an integer between 0 and ${MAX_PROXY_TIMER_DELAY_MS}`,
    );
  }
  if (rawValue === undefined || rawValue === "") return defaultValue;
  if (!isAsciiDigits(rawValue)) {
    throw new NativeTypeError(
      "SHUTDOWN_CLEANUP_TIMEOUT_MS must be a non-negative decimal integer",
    );
  }
  const parsed = NativeNumber(rawValue);
  if (
    !isInteger(parsed) || parsed < 0 ||
    parsed > MAX_PROXY_TIMER_DELAY_MS
  ) {
    throw new NativeRangeError(
      `SHUTDOWN_CLEANUP_TIMEOUT_MS must be between 0 and ${MAX_PROXY_TIMER_DELAY_MS}`,
    );
  }
  return parsed;
}

function validateShutdownSteps(steps: readonly ProxyShutdownStep[]): void {
  const configured = createObject(null) as Record<string, true>;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (
      typeof step !== "object" || step === null ||
      !isNonEmptyString(step.name) || typeof step.run !== "function"
    ) {
      throw new NativeTypeError("Each proxy shutdown step must have a name and run function");
    }
    if (hasOwn(configured, step.name)) {
      throw new NativeTypeError(`Duplicate proxy shutdown step: ${step.name}`);
    }
    if (step.requires !== undefined) {
      if (!isArray(step.requires)) {
        throw new NativeTypeError("Proxy shutdown step prerequisites must be an array");
      }
      for (let requirementIndex = 0; requirementIndex < step.requires.length; requirementIndex++) {
        const requirement = step.requires[requirementIndex];
        if (!isNonEmptyString(requirement) || !hasOwn(configured, requirement)) {
          throw new NativeTypeError(
            `Proxy shutdown prerequisite must name an earlier step: ${NativeString(requirement)}`,
          );
        }
      }
    }
    defineRecordValue(configured, step.name);
  }
}

/**
 * Run cleanup steps in ownership order while ensuring one failure cannot skip
 * independent later owners. A shared deadline bounds total asynchronous
 * cleanup. Steps whose declared owner prerequisite did not complete are
 * skipped rather than tearing that owner down underneath an active borrower.
 */
export function runProxyShutdownSteps(
  steps: readonly ProxyShutdownStep[],
  options: RunProxyShutdownStepsOptions,
): Promise<readonly ProxyShutdownFailure[]> {
  return createProxyShutdownPromise<readonly ProxyShutdownFailure[]>((resolve, reject) => {
    void (async () => {
      try {
        if (!isArray(steps)) {
          throw new NativeTypeError("Proxy shutdown steps must be an array");
        }
        if (
          !isInteger(options.timeoutMs) || options.timeoutMs < 0 ||
          options.timeoutMs > MAX_PROXY_TIMER_DELAY_MS
        ) {
          throw new NativeRangeError(
            `Proxy shutdown timeout must be an integer between 0 and ${MAX_PROXY_TIMER_DELAY_MS}`,
          );
        }
        if (options.onFailure !== undefined && typeof options.onFailure !== "function") {
          throw new NativeTypeError("Proxy shutdown failure reporter must be a function");
        }
        validateShutdownSteps(steps);

        const onFailure = options.onFailure;
        const deadline = now() + options.timeoutMs;
        const failures: ProxyShutdownFailure[] = [];
        const completed = createObject(null) as Record<string, true>;

        const notifyLateFailure = (failure: ProxyShutdownFailure): void => {
          try {
            onFailure?.(freeze(failure));
          } catch {
            // The timeout is already recorded; late diagnostics remain best effort.
          }
        };
        const report = (failure: ProxyShutdownFailure): void => {
          const frozenFailure = freeze(failure);
          appendArrayValue(failures, frozenFailure);
          try {
            onFailure?.(frozenFailure);
          } catch {
            // Diagnostics must not prevent later owners from releasing resources.
          }
        };

        for (let index = 0; index < steps.length; index++) {
          const step = steps[index]!;
          let missingRequirement: string | undefined;
          if (step.requires) {
            for (
              let requirementIndex = 0;
              requirementIndex < step.requires.length;
              requirementIndex++
            ) {
              const requirement = step.requires[requirementIndex]!;
              if (!hasOwn(completed, requirement)) {
                missingRequirement = requirement;
                break;
              }
            }
          }
          if (missingRequirement !== undefined) {
            report({
              step: step.name,
              error: new NativeError(
                `Skipped ${step.name}: prerequisite ${missingRequirement} did not complete`,
              ),
              timedOut: false,
            });
            continue;
          }

          let result: void | PromiseLike<void>;
          try {
            result = step.run();
          } catch (error) {
            report({ step: step.name, error, timedOut: false });
            continue;
          }

          type StepOutcome =
            | { readonly status: "completed" }
            | { readonly status: "failed"; readonly error: unknown }
            | { readonly status: "timed-out" };
          const operation = resolveProxyShutdownValue(result);
          let deadlineExceeded = false;
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const outcomePromise = createProxyShutdownPromise<StepOutcome>((resolveOutcome) => {
            try {
              continueProxyShutdownPromise(
                operation,
                () => resolveOutcome({ status: "completed" }),
                (error) => {
                  if (deadlineExceeded) {
                    notifyLateFailure({ step: step.name, error, timedOut: false });
                    return;
                  }
                  resolveOutcome({ status: "failed", error });
                },
              );
            } catch (error) {
              resolveOutcome({ status: "failed", error });
              return;
            }

            const remainingMs = apply(mathMax, NativeMath, [0, deadline - now()]) as number;
            try {
              timeoutId = setTimer(() => {
                deadlineExceeded = true;
                resolveOutcome({ status: "timed-out" });
              }, remainingMs);
            } catch (error) {
              resolveOutcome({ status: "failed", error });
            }
          });
          const outcome = await outcomePromise;
          if (timeoutId !== undefined) clearTimer(timeoutId);

          if (outcome.status === "completed") {
            defineRecordValue(completed, step.name);
          } else if (outcome.status === "failed") {
            report({ step: step.name, error: outcome.error, timedOut: false });
          } else {
            report({
              step: step.name,
              error: new NativeDOMException(
                `Proxy shutdown cleanup deadline exceeded during ${step.name}`,
                "TimeoutError",
              ),
              timedOut: true,
            });
          }
        }

        resolve(freeze(failures));
      } catch (error) {
        reject(error);
      }
    })();
  });
}
