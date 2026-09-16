import { EVAL_MODEL_ACCESS_DENIED, VeryfrontError } from "#veryfront/errors";
import { parseProviderError } from "#veryfront/chat/provider-errors.ts";
import { registeredProviderFailure } from "#veryfront/chat/provider-error-registry.ts";
import { ProviderError } from "#veryfront/provider/runtime-loader/provider-http.ts";

/** Billing and entitlement denial reported by the model gateway. */
export interface EvalModelAccessDenial {
  code: string;
  message: string;
}

const MODEL_ACCESS_DENIAL_CODES: ReadonlySet<string> = new Set([
  "INSUFFICIENT_CREDITS",
  "RESOURCE_LIMIT_EXCEEDED",
  "AI_PROVIDER_SPEND_LIMIT_EXCEEDED",
]);

const MAX_ERROR_CHAIN_DEPTH = 8;

const GENERIC_PAYMENT_REQUIRED_DENIAL: EvalModelAccessDenial = {
  code: "PAYMENT_REQUIRED",
  message: "The model gateway returned 402 Payment Required",
};

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function classifyProviderError(error: ProviderError): EvalModelAccessDenial | undefined {
  if (error.status !== 402) return undefined;
  const parsed = parseProviderError(error);
  return MODEL_ACCESS_DENIAL_CODES.has(parsed.code)
    ? { code: parsed.code, message: parsed.message }
    : GENERIC_PAYMENT_REQUIRED_DENIAL;
}

function findDenial(
  error: unknown,
  seen: Set<unknown>,
  depth: number,
): EvalModelAccessDenial | undefined {
  if (depth > MAX_ERROR_CHAIN_DEPTH || typeof error !== "object" || error === null) {
    return undefined;
  }
  if (seen.has(error)) return undefined;
  seen.add(error);

  if (error instanceof ProviderError) return classifyProviderError(error);

  const registered = registeredProviderFailure(error);
  if (registered && MODEL_ACCESS_DENIAL_CODES.has(registered.code)) {
    return { code: registered.code, message: registered.message };
  }

  for (const key of ["lastError", "cause"]) {
    const nested = findDenial(readProperty(error, key), seen, depth + 1);
    if (nested) return nested;
  }
  const errors = readProperty(error, "errors");
  if (Array.isArray(errors)) {
    for (const nestedError of errors.slice(0, MAX_ERROR_CHAIN_DEPTH)) {
      const nested = findDenial(nestedError, seen, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Recognize a model request the gateway refused for billing or entitlement
 * reasons. Only typed provider errors and curated provider failures count:
 * free-form error text from project code never classifies as a denial.
 */
export function classifyEvalModelAccessDenial(error: unknown): EvalModelAccessDenial | undefined {
  try {
    return findDenial(error, new Set(), 0);
  } catch {
    return undefined;
  }
}

/** Build the fail-fast error for an eval whose model requests are refused. */
export function createEvalModelAccessDeniedError(
  evalId: string,
  denial: EvalModelAccessDenial,
  cause: unknown,
): VeryfrontError {
  return EVAL_MODEL_ACCESS_DENIED.create({
    detail: `Eval "${evalId}" stopped at its first refused model request: ${denial.message}`,
    context: { evalId, denialCode: denial.code },
    cause,
  });
}

/** Return true when an error is the eval fail-fast model access error. */
export function isEvalModelAccessDeniedError(error: unknown): error is VeryfrontError {
  return error instanceof VeryfrontError && error.slug === EVAL_MODEL_ACCESS_DENIED.slug;
}
