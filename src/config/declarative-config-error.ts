/** Typed declarative-configuration errors shared without loading the evaluator or worker protocol. */
import type {
  DeclarativeConfigErrorCode,
  DeclarativeConfigErrorPhase,
  DeclarativeConfigErrorReason,
  DeclarativeConfigSourceLocation,
} from "./declarative-evaluator.ts";

/** Typed failure emitted for every rejected source or bounded-resource case. */
export class DeclarativeConfigEvaluationError extends Error {
  readonly code: DeclarativeConfigErrorCode;
  readonly phase: DeclarativeConfigErrorPhase;
  readonly reason: DeclarativeConfigErrorReason;
  readonly location: DeclarativeConfigSourceLocation | null;
  readonly retryable: boolean;

  constructor(options: {
    code: DeclarativeConfigErrorCode;
    phase: DeclarativeConfigErrorPhase;
    reason: DeclarativeConfigErrorReason;
    location?: DeclarativeConfigSourceLocation | null;
    retryable?: boolean;
  }) {
    super(
      `Hosted configuration rejected (${options.code}: ${options.reason})`,
    );
    this.name = "DeclarativeConfigEvaluationError";
    this.code = options.code;
    this.phase = options.phase;
    this.reason = options.reason;
    this.location = options.location ?? null;
    this.retryable = options.retryable ?? false;
  }
}

/** Infrastructure failures that can be created outside the evaluator. */
export type DeclarativeConfigWorkerInfrastructureReason =
  | "worker-aborted"
  | "worker-overloaded"
  | "worker-protocol"
  | "worker-memory-limit-unavailable"
  | "worker-timeout"
  | "worker-unavailable";

export function isDeclarativeConfigWorkerInfrastructureReason(
  value: DeclarativeConfigErrorReason,
): value is DeclarativeConfigWorkerInfrastructureReason {
  return value === "worker-aborted" ||
    value === "worker-overloaded" ||
    value === "worker-protocol" ||
    value === "worker-memory-limit-unavailable" ||
    value === "worker-timeout" ||
    value === "worker-unavailable";
}

/**
 * Build a typed failure for worker lifecycle and protocol errors.
 *
 * The caller owns the retry policy because aborts and host availability have
 * different retry semantics.
 */
export function createDeclarativeConfigWorkerInfrastructureError(
  reason: DeclarativeConfigWorkerInfrastructureReason,
): DeclarativeConfigEvaluationError {
  if (!isDeclarativeConfigWorkerInfrastructureReason(reason)) {
    throw new TypeError("Invalid declarative configuration worker failure");
  }
  const retryable = reason !== "worker-aborted" &&
    reason !== "worker-protocol";
  return new DeclarativeConfigEvaluationError({
    code: "evaluator-unavailable",
    phase: "worker",
    reason,
    location: null,
    retryable,
  });
}
