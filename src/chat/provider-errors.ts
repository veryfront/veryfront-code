import { safeJsonParse } from "#veryfront/utils/json.ts";
import {
  ProviderOverloadedError,
  ProviderQuotaError,
} from "#veryfront/provider/runtime-loader/provider-http.ts";
export { safeJsonParse };
export type { SafeJsonParseResult } from "#veryfront/utils/json.ts";

/** Error shape for parsed provider. */
export interface ParsedProviderError {
  code: string;
  message: string;
  status?: number;
}

const DEFAULT_EXTERNAL_SERVICE_ERROR = {
  code: "EXTERNAL_SERVICE_ERROR",
  message: "LLM provider service error",
} as const;

const PROJECT_SCHEMA_ERROR = {
  code: "PROJECT_SCHEMA_ERROR",
  message:
    "Project code has an invalid Veryfront schema. Update the schema to use defineSchema(), then run the agent again.",
} as const;

const MODEL_UNSUPPORTED_ASSISTANT_PREFILL_ERROR = {
  code: "MODEL_UNSUPPORTED_ASSISTANT_PREFILL",
  message:
    "The selected model does not support assistant-message prefill. Start a new user message or choose a compatible model.",
} as const;

const OUTPUT_SCHEMA_NOT_CLOSED_ERROR = {
  code: "OUTPUT_SCHEMA_NOT_CLOSED",
  message:
    "The provider rejected the output schema because an object in it allows additional properties. " +
    "Set additionalProperties: false on that object -- add .strict() if the outputSchema was " +
    "built with defineSchema(), or set the property directly on a raw JSON Schema.",
} as const;

const AI_PROVIDER_SPEND_LIMIT_ERROR = {
  code: "AI_PROVIDER_SPEND_LIMIT_EXCEEDED",
  message:
    "The AI provider spend limit has been reached. Try again later or ask an administrator to raise the AI provider spend limit.",
  status: 402,
} as const;

const AI_PROVIDER_BILLING_ERROR = {
  code: "AI_PROVIDER_BILLING_ERROR",
  message:
    "The configured AI provider account cannot process this request. Try a different model, or ask an administrator to check provider billing.",
  status: 502,
} as const;

const MAX_PROVIDER_ERROR_DEPTH = 64;
const MAX_PROVIDER_ERROR_TEXT_CHARS = 256 * 1024;
const MAX_EMBEDDED_JSON_CANDIDATES = 32;

function isErrorRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseErrorJson(value: string): unknown | null {
  if (value.length > MAX_PROVIDER_ERROR_TEXT_CHARS) {
    return null;
  }
  const parsed = safeJsonParse(value);
  return parsed.ok ? parsed.value : null;
}

function findJsonObjectEnd(value: string, startIndex: number): number | null {
  const closingTokens: string[] = ["}"];
  let inString = false;
  let escaped = false;

  for (let index = startIndex + 1; index < value.length; index++) {
    const character = value[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      closingTokens.push("}");
    } else if (character === "[") {
      closingTokens.push("]");
    } else if (character === "}" || character === "]") {
      if (closingTokens.at(-1) !== character) {
        return null;
      }
      closingTokens.pop();
      if (closingTokens.length === 0) {
        return index + 1;
      }
    }
  }

  return null;
}

function parseEmbeddedErrorJson(value: string): unknown | null {
  const boundedValue = value.slice(0, MAX_PROVIDER_ERROR_TEXT_CHARS);
  let candidateCount = 0;

  for (let startIndex = 0; startIndex < boundedValue.length; startIndex++) {
    if (boundedValue[startIndex] !== "{") {
      continue;
    }
    candidateCount += 1;
    if (candidateCount > MAX_EMBEDDED_JSON_CANDIDATES) {
      return null;
    }

    const endIndex = findJsonObjectEnd(boundedValue, startIndex);
    if (endIndex === null) {
      continue;
    }

    const parsed = parseErrorJson(boundedValue.slice(startIndex, endIndex));
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function formatCreditProblemMessage(
  body: Record<string, unknown>,
  error: string | null,
  hasSuggestion: boolean,
): string {
  const balance = body.balance;
  const required = body.required;
  const isRunLimit = error?.toLowerCase().includes("agent run credit limit") ?? false;
  const fallback = isRunLimit ? "Agent run credit limit exceeded" : "Insufficient AI credits";
  const suggestion = isRunLimit
    ? "Start a new reviewed run or reduce the scope of this run."
    : "Purchase additional credits or upgrade your subscription plan.";
  if (
    typeof balance !== "number" || !Number.isFinite(balance) || balance < 0 ||
    typeof required !== "number" || !Number.isFinite(required) || required < 0
  ) {
    return hasSuggestion ? `${fallback}. ${suggestion}` : fallback;
  }

  const summary = error === "AI credit limit exceeded" ? "AI credit limit exceeded" : fallback;
  const availability = isRunLimit ? "remaining" : "available";
  return `${summary}: ${required} credits required, ${balance} ${availability}.${
    hasSuggestion ? ` ${suggestion}` : ""
  }`;
}

/** Parses known problem bodies without exposing provider-controlled text. */
export function parseKnownProblemBody(body: unknown): ParsedProviderError | null {
  if (!isErrorRecord(body)) {
    return null;
  }

  const slug = typeof body.slug === "string" ? body.slug : null;
  const error = typeof body.error === "string" ? body.error : null;
  const suggestion = typeof body.suggestion === "string" ? body.suggestion : null;
  const normalizedProblemText = `${error ?? ""} ${suggestion ?? ""}`.toLowerCase();

  if (normalizedProblemText.includes("ai provider spend limit")) {
    return AI_PROVIDER_SPEND_LIMIT_ERROR;
  }

  if (slug === "insufficient-credits" || error === "AI credit limit exceeded") {
    return {
      code: "INSUFFICIENT_CREDITS",
      message: formatCreditProblemMessage(body, error, Boolean(suggestion)),
      status: 402,
    };
  }

  if (slug === "resource-limit-exceeded") {
    return {
      code: "RESOURCE_LIMIT_EXCEEDED",
      message: "Resource limit exceeded",
      status: 402,
    };
  }

  return null;
}

// ─── Message-text heuristics ─────────────────────────────────────────────────
// The functions below classify provider errors by matching natural-language
// substrings in error messages. This is intentional: providers often do not
// include structured error codes in all response shapes, so text matching is
// the only reliable signal. Keep these as the fallback path — wherever the
// provider DOES return a structured `type` field (e.g. Anthropic's `body.type`)
// the structured code is preferred (handled above in parseKnownProviderBody).
//
// MAINTENANCE: If a provider rewords an error message, the affected check will
// silently fall back to EXTERNAL_SERVICE_ERROR. Update the relevant substring
// list and add a test case when that happens.

/** Returns true when the normalizedMessage indicates a credit or spend limit error. */
export function isCreditLimitMessage(normalizedMessage: string): boolean {
  return (
    normalizedMessage.includes("credit limit") ||
    normalizedMessage.includes("insufficient credits") ||
    normalizedMessage.includes("insufficient-credits") ||
    normalizedMessage.includes("payment required")
  );
}

/**
 * Wordings that identify a rejection as being about the *structured output*
 * schema rather than a tool or function schema. Providers reject open objects
 * in both, with near-identical sentences:
 *
 *   output_config.format.schema: For 'object' type, 'additionalProperties'
 *     must be explicitly set to false                              (Anthropic)
 *   Invalid schema for response_format 'X': ... 'additionalProperties' is
 *     required to be supplied and to be false                         (OpenAI)
 *   Invalid schema for function 'X': ... 'additionalProperties' is
 *     required to be supplied and to be false            (OpenAI, tool schema)
 *
 * Only the first two are about `outputSchema`. Without this discriminator the
 * third is mislabeled and the caller is sent to fix the wrong schema.
 */
const STRUCTURED_OUTPUT_MARKERS = ["output_config", "response_format", "output schema"];

/**
 * Detects a provider rejecting the structured-output schema because an object
 * in it does not set `additionalProperties: false`.
 *
 * The caller's own `outputSchema` is what has to change, so this is worth
 * naming rather than collapsing into a generic service error. Matched on the
 * pieces the wording is built from -- the property name, the closure
 * requirement, and a structured-output marker -- rather than a fixed sentence,
 * which providers reword.
 */
function isOpenObjectSchemaRejection(message: string): boolean {
  const normalizedMessage = message.toLowerCase();
  if (!normalizedMessage.includes("additionalproperties")) return false;
  if (!normalizedMessage.includes("false") && !normalizedMessage.includes("required")) return false;
  return STRUCTURED_OUTPUT_MARKERS.some((marker) => normalizedMessage.includes(marker));
}

function isAssistantPrefillUnsupportedMessage(message: string): boolean {
  const normalizedMessage = message.toLowerCase();
  const mentionsAssistantPrefill = normalizedMessage.includes("assistant message prefill") ||
    normalizedMessage.includes("assistant-message prefill") ||
    (
      normalizedMessage.includes("assistant") &&
      normalizedMessage.includes("prefill")
    );
  const rejectsAssistantPrefill = normalizedMessage.includes("does not support") ||
    normalizedMessage.includes("unsupported") ||
    normalizedMessage.includes("conversation must end with a user message");
  return mentionsAssistantPrefill && rejectsAssistantPrefill;
}

// Detects provider-side billing errors reported via invalid_request_error messages.
// Requires three independent signals to reduce false positives: the message must
// mention (a) a known provider API, (b) billing/account, and (c) low credit balance.
// If any provider stops including all three signals, this silently returns false —
// the call site falls through to EXTERNAL_SERVICE_ERROR, which is the safe default.
function isProviderBillingMessage(normalizedMessage: string): boolean {
  const mentionsProviderApi = normalizedMessage.includes("anthropic api") ||
    normalizedMessage.includes("openai api") ||
    normalizedMessage.includes("google api") ||
    normalizedMessage.includes("mistral api");
  const mentionsProviderBilling = normalizedMessage.includes("plans & billing") ||
    normalizedMessage.includes("provider billing") ||
    normalizedMessage.includes("provider account");
  const mentionsProviderCredits = normalizedMessage.includes("credit balance is too low") ||
    normalizedMessage.includes("provider credits");

  return mentionsProviderApi && mentionsProviderCredits && mentionsProviderBilling;
}

/**
 * Google's canonical `google.rpc.Code` for a request the API rejected as
 * malformed. Its envelope is `{error:{code,status,message}}` and carries no
 * `type` at all, so without this the whole curated mapping below -- billing,
 * assistant prefill, output schema, context length -- is unreachable for
 * Google, and every one of its 400s reports as a generic service error
 * whatever actually went wrong.
 *
 * Mirrored by the preservation criteria in
 * `src/provider/runtime-loader/provider-http.ts`, which decides whether the
 * body reaches this function at all.
 */
const GOOGLE_INVALID_ARGUMENT_STATUS = "INVALID_ARGUMENT";

/** Whether an error record says the request itself was rejected as invalid. */
function isInvalidRequestEnvelope(body: Record<string, unknown>): boolean {
  return body.type === "invalid_request_error" ||
    body.status === GOOGLE_INVALID_ARGUMENT_STATUS;
}

/**
 * Maps the wording of a rejected request onto a curated error.
 *
 * Shared by every envelope that carries that meaning, whichever key it uses to
 * say so, so a provider is reachable by all of these mappings or none of them
 * -- never the per-mapping patchwork that made the same rejection legible from
 * Anthropic and opaque from Google.
 */
function classifyInvalidRequestMessage(message: string): ParsedProviderError | null {
  const normalizedMessage = message.toLowerCase();
  if (isProviderBillingMessage(normalizedMessage)) {
    return AI_PROVIDER_BILLING_ERROR;
  }
  if (isAssistantPrefillUnsupportedMessage(message)) {
    return MODEL_UNSUPPORTED_ASSISTANT_PREFILL_ERROR;
  }
  if (isOpenObjectSchemaRejection(message)) {
    return OUTPUT_SCHEMA_NOT_CLOSED_ERROR;
  }
  if (normalizedMessage.includes("too long")) {
    return { code: "CONTEXT_LENGTH_EXCEEDED", message: "Conversation is too long" };
  }
  return null;
}

function parseKnownProviderBody(
  body: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): ParsedProviderError | null {
  if (depth >= MAX_PROVIDER_ERROR_DEPTH) {
    return null;
  }

  const problemMatch = parseKnownProblemBody(body);
  if (problemMatch) {
    return problemMatch;
  }

  if (!isErrorRecord(body)) {
    return null;
  }

  if (seen.has(body)) {
    return null;
  }
  seen.add(body);

  if (isErrorRecord(body.error)) {
    const nestedError = parseKnownProviderBody(body.error, seen, depth + 1);
    if (nestedError) {
      return nestedError;
    }
  }

  if (body.type === "overloaded_error") {
    return {
      code: "OVERLOADED_ERROR",
      message: "The LLM provider is currently overloaded",
    };
  }

  if (body.type === "rate_limit_error") {
    return {
      code: "RATE_LIMITED",
      message: "Too many requests. Please wait a moment and try again.",
      status: 429,
    };
  }

  if (body.type === "api_error") {
    return DEFAULT_EXTERNAL_SERVICE_ERROR;
  }

  if (typeof body.message === "string" && isInvalidRequestEnvelope(body)) {
    const classified = classifyInvalidRequestMessage(body.message);
    if (classified) {
      return classified;
    }
  }

  return null;
}

function getErrorMessage(error: unknown): string | null {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (isErrorRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return null;
}

function extractResponseBody(error: unknown): string | undefined {
  if (!isErrorRecord(error)) {
    return undefined;
  }

  if (typeof error.responseBody === "string") return error.responseBody;

  if (isErrorRecord(error.lastError)) {
    if (typeof error.lastError.responseBody === "string") return error.lastError.responseBody;
  }

  return undefined;
}

/** Error shape for parse provider. */
export function parseProviderError(error: unknown): ParsedProviderError {
  try {
    return parseProviderErrorInner(error, new WeakSet(), 0);
  } catch {
    return DEFAULT_EXTERNAL_SERVICE_ERROR;
  }
}

function parseProviderErrorInner(
  error: unknown,
  seen: WeakSet<object>,
  depth: number,
): ParsedProviderError {
  if (depth >= MAX_PROVIDER_ERROR_DEPTH) {
    return DEFAULT_EXTERNAL_SERVICE_ERROR;
  }

  if (error instanceof ProviderQuotaError) {
    return AI_PROVIDER_BILLING_ERROR;
  }
  if (error instanceof ProviderOverloadedError) {
    return {
      code: "OVERLOADED_ERROR",
      message: "The LLM provider is currently overloaded",
    };
  }

  if (isErrorRecord(error)) {
    if (seen.has(error)) {
      return DEFAULT_EXTERNAL_SERVICE_ERROR;
    }
    seen.add(error);
  }

  const responseBody = extractResponseBody(error);
  if (responseBody) {
    const normalizedResponseBody = responseBody.toLowerCase();
    if (normalizedResponseBody.includes("invalid veryfront schema")) {
      return PROJECT_SCHEMA_ERROR;
    }

    const parsedBody = parseErrorJson(responseBody);
    const parsedError = parseKnownProviderBody(parsedBody);
    if (parsedError) {
      return parsedError;
    }
  }

  if (isErrorRecord(error) && "lastError" in error) {
    const nested = parseProviderErrorInner(error.lastError, seen, depth + 1);
    if (
      nested.code !== DEFAULT_EXTERNAL_SERVICE_ERROR.code ||
      nested.message !== DEFAULT_EXTERNAL_SERVICE_ERROR.message
    ) {
      return nested;
    }
  }

  const parsedDirectError = parseKnownProviderBody(error);
  if (parsedDirectError) {
    return parsedDirectError;
  }

  const message = getErrorMessage(error);
  if (message) {
    const parsedMessage = parseErrorJson(message);
    const parsedMessageError = parseKnownProviderBody(parsedMessage);
    if (parsedMessageError) {
      return parsedMessageError;
    }

    const parsedEmbeddedMessage = parseEmbeddedErrorJson(message);
    const parsedEmbeddedMessageError = parseKnownProviderBody(parsedEmbeddedMessage);
    if (parsedEmbeddedMessageError) {
      return parsedEmbeddedMessageError;
    }

    const normalizedMessage = message.toLowerCase();
    if (isAssistantPrefillUnsupportedMessage(message)) {
      return MODEL_UNSUPPORTED_ASSISTANT_PREFILL_ERROR;
    }
    // Also matched here, not only on the structured-body path: the same
    // rejection reaches this function as a bare `Error` whenever the body was
    // never preserved -- an unparsed shape, a truncated read, or a provider
    // whose envelope carries no `invalid_request_error` type at all.
    if (isOpenObjectSchemaRejection(message)) {
      return OUTPUT_SCHEMA_NOT_CLOSED_ERROR;
    }
    if (isProviderBillingMessage(normalizedMessage)) {
      return AI_PROVIDER_BILLING_ERROR;
    }
    if (isCreditLimitMessage(normalizedMessage)) {
      return { code: "INSUFFICIENT_CREDITS", message: "Insufficient AI credits", status: 402 };
    }
    if (normalizedMessage.includes("overload") || normalizedMessage.includes("capacity")) {
      return { code: "OVERLOADED_ERROR", message: "The LLM provider is currently overloaded" };
    }
    if (
      normalizedMessage.includes("rate limit") ||
      normalizedMessage.includes("too many requests") ||
      normalizedMessage.includes("429")
    ) {
      return {
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait a moment and try again.",
        status: 429,
      };
    }
    if (
      normalizedMessage.includes("prompt is too long") ||
      normalizedMessage.includes("too many tokens")
    ) {
      return { code: "CONTEXT_LENGTH_EXCEEDED", message: "Conversation is too long" };
    }
    if (normalizedMessage.includes("invalid veryfront schema")) {
      return PROJECT_SCHEMA_ERROR;
    }
  }

  return DEFAULT_EXTERNAL_SERVICE_ERROR;
}
