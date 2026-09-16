import { EVAL_MODEL_ACCESS_DENIED, VeryfrontError } from "#veryfront/errors";
import { parseKnownProblemBody } from "#veryfront/chat/provider-errors.ts";
import { registeredProviderFailure } from "#veryfront/chat/provider-error-registry.ts";
import { ProviderError } from "#veryfront/provider/runtime-loader/provider-http.ts";

/** Billing and entitlement denial reported by the model gateway. */
export interface EvalModelAccessDenial {
  code: string;
  message: string;
}

/**
 * Account-wide billing or entitlement denials. `RESOURCE_LIMIT_EXCEEDED` is
 * left out on purpose: it also covers per-request limits (output tokens,
 * concurrency, model-call counts) that a later record can stay within.
 */
const MODEL_ACCESS_DENIAL_CODES: ReadonlySet<string> = new Set([
  "INSUFFICIENT_CREDITS",
  "AI_PROVIDER_SPEND_LIMIT_EXCEEDED",
]);

/** Run-scoped credit cap: a later record starts a new run with its own budget. */
function isAgentRunCreditLimit(message: string): boolean {
  return message.toLowerCase().startsWith("agent run credit limit");
}

const MAX_ERROR_CHAIN_DEPTH = 8;

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function toDenial(failure: { code: string; message: string }): EvalModelAccessDenial | undefined {
  if (!MODEL_ACCESS_DENIAL_CODES.has(failure.code)) return undefined;
  if (isAgentRunCreditLimit(failure.message)) return undefined;
  return { code: failure.code, message: failure.message };
}

function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * Gateway provenance comes from the Veryfront Cloud problem body the gateway
 * returns with a 402 (`slug: "insufficient-credits"`), which the provider
 * runtime keeps as the typed `responseBody`. A 402 from a direct or BYOK
 * provider carries no such body and stays a record failure, so it never gets
 * Veryfront billing advice. Message text is never consulted.
 */
function classifyProviderError(error: ProviderError): EvalModelAccessDenial | undefined {
  if (error.status !== 402 || typeof error.responseBody !== "string") return undefined;
  const parsed = parseKnownProblemBody(parseJsonBody(error.responseBody));
  return parsed ? toDenial(parsed) : undefined;
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
  if (registered) return toDenial(registered);

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

/**
 * Recognize an account-wide billing denial in a failed agent service response:
 * an HTTP 402 problem body, or a curated provider code on the AG-UI run error.
 */
export function classifyAgentServiceModelAccessDenial(input: {
  status: number;
  body: string | null;
  runErrorCode?: unknown;
  runErrorMessage?: unknown;
}): EvalModelAccessDenial | undefined {
  try {
    if (input.status === 402 && input.body) {
      const parsed = parseKnownProblemBody(parseJsonBody(input.body));
      if (parsed) return toDenial(parsed);
    }
    if (typeof input.runErrorCode === "string") {
      const message = typeof input.runErrorMessage === "string"
        ? input.runErrorMessage
        : input.runErrorCode;
      return toDenial({ code: input.runErrorCode, message });
    }
  } catch {
    return undefined;
  }
  return undefined;
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
  try {
    return error instanceof VeryfrontError && error.slug === EVAL_MODEL_ACCESS_DENIED.slug;
  } catch {
    // Hostile thrown values (revoked proxies) are never the fail-fast error.
    return false;
  }
}
