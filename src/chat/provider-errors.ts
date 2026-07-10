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

function isErrorRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Result returned from safe JSON parse. */
export type SafeJsonParseResult = { ok: true; value: unknown } | { ok: false; error: Error };

/** Parse JSON safely without throwing. */
export function safeJsonParse(value: string): SafeJsonParseResult {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

function parseErrorJson(value: string): unknown | null {
  const parsed = safeJsonParse(value);
  return parsed.ok ? parsed.value : null;
}

function parseEmbeddedErrorJson(value: string): unknown | null {
  const jsonStart = value.indexOf("{");
  if (jsonStart < 0) {
    return null;
  }

  return parseErrorJson(value.slice(jsonStart));
}

/** Parses known problem body. */
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
      message: suggestion ?? error ?? "Insufficient AI credits",
      status: 402,
    };
  }

  if (slug === "resource-limit-exceeded") {
    return {
      code: "RESOURCE_LIMIT_EXCEEDED",
      message: suggestion ?? error ?? "Resource limit exceeded",
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

function parseKnownProviderBody(
  body: unknown,
  seen: WeakSet<object> = new WeakSet(),
): ParsedProviderError | null {
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
    const nestedError = parseKnownProviderBody(body.error, seen);
    if (nestedError) {
      return nestedError;
    }
  }

  if (body.type === "overloaded_error") {
    return {
      code: "OVERLOADED_ERROR",
      message: typeof body.message === "string"
        ? body.message
        : "The LLM provider is currently overloaded",
    };
  }

  if (body.type === "rate_limit_error") {
    return {
      code: "RATE_LIMITED",
      message: typeof body.message === "string"
        ? body.message
        : "Too many requests. Please wait a moment and try again.",
      status: 429,
    };
  }

  if (body.type === "api_error") {
    return {
      code: "EXTERNAL_SERVICE_ERROR",
      message: typeof body.message === "string"
        ? body.message
        : DEFAULT_EXTERNAL_SERVICE_ERROR.message,
    };
  }

  if (body.type === "invalid_request_error" && typeof body.message === "string") {
    const normalizedMessage = body.message.toLowerCase();
    if (isProviderBillingMessage(normalizedMessage)) {
      return AI_PROVIDER_BILLING_ERROR;
    }
    if (isAssistantPrefillUnsupportedMessage(body.message)) {
      return MODEL_UNSUPPORTED_ASSISTANT_PREFILL_ERROR;
    }
    if (normalizedMessage.includes("too long")) {
      return { code: "CONTEXT_LENGTH_EXCEEDED", message: "Conversation is too long" };
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
  return parseProviderErrorInner(error, new WeakSet());
}

function parseProviderErrorInner(error: unknown, seen: WeakSet<object>): ParsedProviderError {
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
    const nested = parseProviderErrorInner(error.lastError, seen);
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
