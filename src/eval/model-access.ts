import { EVAL_MODEL_ACCESS_DENIED, EVAL_PROJECT_REQUIRED, VeryfrontError } from "#veryfront/errors";
import { parseKnownProblemBody } from "#veryfront/chat/provider-errors.ts";
import {
  CURATED_PROVIDER_FAILURE_CODES,
  curatedProviderFailure,
  type CuratedProviderFailureCode,
  registeredProviderFailure,
} from "#veryfront/chat/provider-error-registry.ts";
import { ProviderError } from "#veryfront/provider/runtime-loader/provider-http.ts";

/** Why the model gateway refused an eval's model requests. */
export type EvalModelAccessDenialKind = "billing" | "project-required";

/** Refusal that every later eval record would hit the same way. */
export interface EvalModelAccessDenial {
  kind: EvalModelAccessDenialKind;
  code: string;
  message: string;
}

const DENIAL_ERRORS = {
  billing: EVAL_MODEL_ACCESS_DENIED,
  "project-required": EVAL_PROJECT_REQUIRED,
} as const;

const GATEWAY_PROJECT_REQUIRED_CODE = "gateway_project_required";
const GATEWAY_PROJECT_REQUIRED_FALLBACK_MESSAGE =
  "A project is required to use Veryfront-managed AI inference";
const MAX_GATEWAY_MESSAGE_LENGTH = 200;

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
  return { kind: "billing", code: failure.code, message: failure.message };
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
/**
 * The gateway's project-required rejection, identified by its structured
 * `code` in the preserved response body. The gateway's own `error` text is kept
 * when it is a short string, so the user sees the gateway's wording.
 */
function classifyProjectRequired(
  responseBody: string,
  options: { useGatewayMessage: boolean },
): EvalModelAccessDenial | undefined {
  const body = parseJsonBody(responseBody);
  if (readProperty(body, "code") !== GATEWAY_PROJECT_REQUIRED_CODE) return undefined;
  const gatewayMessage = options.useGatewayMessage ? readProperty(body, "error") : undefined;
  return {
    kind: "project-required",
    code: GATEWAY_PROJECT_REQUIRED_CODE,
    message: typeof gatewayMessage === "string" && gatewayMessage.trim() &&
        gatewayMessage.length <= MAX_GATEWAY_MESSAGE_LENGTH
      ? gatewayMessage.trim()
      : GATEWAY_PROJECT_REQUIRED_FALLBACK_MESSAGE,
  };
}

function classifyProviderError(error: ProviderError): EvalModelAccessDenial | undefined {
  if (typeof error.responseBody !== "string") return undefined;
  if (error.status === 400) {
    return classifyProjectRequired(error.responseBody, { useGatewayMessage: true });
  }
  if (error.status !== 402) return undefined;
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
    if (input.status === 400 && input.body) {
      // The endpoint's own text is not trusted for user-facing output.
      const projectRequired = classifyProjectRequired(input.body, { useGatewayMessage: false });
      if (projectRequired) return projectRequired;
    }
    if (input.status === 402 && input.body) {
      const parsed = parseKnownProblemBody(parseJsonBody(input.body));
      if (parsed) return toDenial(parsed);
    }
    if (isCuratedProviderFailureCode(input.runErrorCode)) {
      // The run error message is read only to recognize a run-scoped credit
      // cap. The user-facing message is rebuilt from the curated code, so an
      // endpoint cannot place arbitrary text in the CLI error.
      if (
        typeof input.runErrorMessage === "string" && isAgentRunCreditLimit(input.runErrorMessage)
      ) {
        return undefined;
      }
      return toDenial(curatedProviderFailure(input.runErrorCode));
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isCuratedProviderFailureCode(value: unknown): value is CuratedProviderFailureCode {
  return typeof value === "string" &&
    (CURATED_PROVIDER_FAILURE_CODES as readonly string[]).includes(value);
}

/** Build the fail-fast error for an eval whose model requests are refused. */
export function createEvalModelAccessDeniedError(
  evalId: string,
  denial: EvalModelAccessDenial,
  cause: unknown,
): VeryfrontError {
  return DENIAL_ERRORS[denial.kind].create({
    detail: `Eval "${evalId}" stopped at its first refused model request: ${denial.message}`,
    context: { evalId, denialCode: denial.code },
    cause,
  });
}

/** Return the denial kind when an error is one of the eval fail-fast errors. */
export function getEvalModelAccessDenialKind(
  error: unknown,
): EvalModelAccessDenialKind | undefined {
  try {
    if (!(error instanceof VeryfrontError)) return undefined;
    for (const [kind, definition] of Object.entries(DENIAL_ERRORS)) {
      if (error.slug === definition.slug) return kind as EvalModelAccessDenialKind;
    }
  } catch {
    // Hostile thrown values (revoked proxies) are never the fail-fast error.
  }
  return undefined;
}

/** Return true when an error is one of the eval fail-fast model access errors. */
export function isEvalModelAccessDeniedError(error: unknown): error is VeryfrontError {
  return getEvalModelAccessDenialKind(error) !== undefined;
}
