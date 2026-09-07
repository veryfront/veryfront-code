import { snapshotVeryfrontError } from "#veryfront/errors/types.ts";

export const PROJECT_SCHEMA_ERROR = {
  code: "PROJECT_SCHEMA_ERROR",
  message:
    "Project code has an invalid Veryfront schema. Update the schema to use defineSchema(), then run the agent again.",
} as const;

export const MODEL_UNSUPPORTED_ASSISTANT_PREFILL_ERROR = {
  code: "MODEL_UNSUPPORTED_ASSISTANT_PREFILL",
  message:
    "The selected model does not support assistant-message prefill. Start a new user message or choose a compatible model.",
} as const;

export const OUTPUT_SCHEMA_NOT_CLOSED_ERROR = {
  code: "OUTPUT_SCHEMA_NOT_CLOSED",
  message:
    "The provider rejected the output schema because an object in it allows additional properties. " +
    "Set additionalProperties: false on that object -- add .strict() if the outputSchema was " +
    "built with defineSchema(), or set the property directly on a raw JSON Schema.",
} as const;

export const AI_PROVIDER_SPEND_LIMIT_ERROR = {
  code: "AI_PROVIDER_SPEND_LIMIT_EXCEEDED",
  message:
    "The AI provider spend limit has been reached. Try again later or ask an administrator to raise the AI provider spend limit.",
  status: 402,
} as const;

export const AI_PROVIDER_WORKSPACE_LIMIT_ERROR = {
  code: "AI_PROVIDER_WORKSPACE_LIMIT_EXCEEDED",
  message:
    "The AI provider workspace API usage limit has been reached. Wait for the limit to reset, or ask an administrator to raise the workspace limit.",
  status: 502,
} as const;

export const AI_PROVIDER_BILLING_ERROR = {
  code: "AI_PROVIDER_BILLING_ERROR",
  message:
    "The configured AI provider account cannot process this request. Try a different model, or ask an administrator to check provider billing.",
  status: 502,
} as const;

/** Codes transported across model boundaries; diagnostics are reconstructed locally. */
export const CURATED_PROVIDER_FAILURE_CODES = [
  "OVERLOADED_ERROR",
  "CONTEXT_LENGTH_EXCEEDED",
  "INSUFFICIENT_CREDITS",
  "RESOURCE_LIMIT_EXCEEDED",
  "RATE_LIMITED",
  "PROJECT_SCHEMA_ERROR",
  "MODEL_UNSUPPORTED_ASSISTANT_PREFILL",
  "OUTPUT_SCHEMA_NOT_CLOSED",
  "AI_PROVIDER_SPEND_LIMIT_EXCEEDED",
  "AI_PROVIDER_WORKSPACE_LIMIT_EXCEEDED",
  "AI_PROVIDER_BILLING_ERROR",
] as const;
export type CuratedProviderFailureCode = typeof CURATED_PROVIDER_FAILURE_CODES[number];

const failures = {
  OVERLOADED_ERROR: {
    code: "OVERLOADED_ERROR",
    message: "The LLM provider is currently overloaded",
    status: 503,
  },
  CONTEXT_LENGTH_EXCEEDED: {
    code: "CONTEXT_LENGTH_EXCEEDED",
    message: "Conversation is too long",
    status: 413,
  },
  INSUFFICIENT_CREDITS: {
    code: "INSUFFICIENT_CREDITS",
    message: "Insufficient AI credits",
    status: 402,
  },
  RESOURCE_LIMIT_EXCEEDED: {
    code: "RESOURCE_LIMIT_EXCEEDED",
    message: "Resource limit exceeded",
    status: 402,
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    message: "Too many requests. Please wait a moment and try again.",
    status: 429,
  },
  PROJECT_SCHEMA_ERROR: { ...PROJECT_SCHEMA_ERROR, status: 400 },
  MODEL_UNSUPPORTED_ASSISTANT_PREFILL: {
    ...MODEL_UNSUPPORTED_ASSISTANT_PREFILL_ERROR,
    status: 400,
  },
  OUTPUT_SCHEMA_NOT_CLOSED: { ...OUTPUT_SCHEMA_NOT_CLOSED_ERROR, status: 400 },
  AI_PROVIDER_SPEND_LIMIT_EXCEEDED: AI_PROVIDER_SPEND_LIMIT_ERROR,
  AI_PROVIDER_WORKSPACE_LIMIT_EXCEEDED: AI_PROVIDER_WORKSPACE_LIMIT_ERROR,
  AI_PROVIDER_BILLING_ERROR: AI_PROVIDER_BILLING_ERROR,
} as const;

/** Return fixed local diagnostics; provider payload/status values are never forwarded. */
export function curatedProviderFailure(code: CuratedProviderFailureCode) {
  return { ...failures[code] };
}

/** Recognize only registered curated slugs, ignoring arbitrary code/status properties. */
export function registeredProviderFailure(error: unknown) {
  const snapshot = snapshotVeryfrontError(error);
  if (!snapshot) return undefined;
  const code = CURATED_PROVIDER_FAILURE_CODES.find((value) =>
    value.toLowerCase().replaceAll("_", "-") === snapshot.slug
  );
  return code ? curatedProviderFailure(code) : undefined;
}
