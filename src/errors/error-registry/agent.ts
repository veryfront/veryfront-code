import { defineError } from "../types.ts";

export const AGENT_ERROR = defineError({
  slug: "agent-error",
  category: "AGENT",
  status: 500,
  title: "Agent operation error",
  suggestion: "Check agent configuration and logs",
});

export const AGENT_NOT_FOUND = defineError({
  slug: "agent-not-found",
  category: "AGENT",
  status: 404,
  title: "Agent not found",
  suggestion: "Verify the agent ID exists",
});

export const AGENT_TIMEOUT = defineError({
  slug: "agent-timeout",
  category: "AGENT",
  status: 408,
  title: "Agent operation timed out",
  suggestion: "Increase timeout or simplify the request",
});

export const AGENT_INTENT_ERROR = defineError({
  slug: "agent-intent-error",
  category: "AGENT",
  status: 400,
  title: "Agent intent parsing error",
  suggestion: "Rephrase the request more clearly",
});

export const ORCHESTRATION_ERROR = defineError({
  slug: "orchestration-error",
  category: "AGENT",
  status: 500,
  title: "Multi-agent orchestration error",
  suggestion: "Check agent coordination logic",
});

export const COST_LIMIT_EXCEEDED = defineError({
  slug: "cost-limit-exceeded",
  category: "AGENT",
  status: 429,
  title: "Cost limit exceeded",
  suggestion: "Wait for the budget period to reset or increase the limit",
});

export const TOOL_ID_CONFLICT = defineError({
  slug: "tool-id-conflict",
  category: "AGENT",
  status: 409,
  title: "Tool ID conflict",
  suggestion: "Use a unique tool ID or rename one of the conflicting tools",
});

export const DURABLE_RUN_EVENT_PERSISTENCE_FAILED = defineError({
  slug: "durable-run-event-persistence-failed",
  category: "AGENT",
  status: 500,
  title: "Durable run event persistence failed",
  suggestion:
    "Correct invalid or oversized event data, or retry after durable event storage recovers",
});

/**
 * The default model's provider has no credential while a different provider
 * does. Resolution stays deterministic rather than silently substituting
 * whichever key happens to be present on this machine.
 */
export const DEFAULT_MODEL_CREDENTIAL_MISMATCH = defineError({
  slug: "default-model-credential-mismatch",
  category: "AGENT",
  status: 400,
  title: "Default model has no matching provider credential",
  suggestion: 'Set the agent\'s model to a provider you have a key for, or use model: "auto"',
});

/**
 * Provider replay checkpoint state failed validation at a consumer boundary.
 * Replay state guards provider protocol correctness on resume, so malformed
 * or unappliable state fails closed instead of degrading into an unsigned
 * replay. Details never include checkpoint contents: provider blocks carry
 * signed reasoning material that must stay out of logs and error text.
 */
export const PROVIDER_REPLAY_CHECKPOINT_INVALID = defineError({
  slug: "provider-replay-checkpoint-invalid",
  category: "AGENT",
  status: 500,
  title: "Provider replay checkpoint is invalid",
  suggestion:
    "Verify the trusted source that resolved the run's provider replay checkpoints; do not retry with the same replay state",
});

/**
 * An eval stopped because the model gateway refused to serve its model
 * requests for billing or entitlement reasons (HTTP 402). Every later record
 * would fail the same way, so the run fails fast with one actionable error
 * instead of grading empty outputs.
 */
export const EVAL_MODEL_ACCESS_DENIED = defineError({
  slug: "eval-model-access-denied",
  category: "AGENT",
  status: 402,
  title: "No model access for eval run",
  suggestion:
    "Veryfront Cloud refused the model request for billing or entitlement reasons, not authentication. Add AI credits or upgrade the plan for the account that owns the linked project at https://veryfront.com/settings/billing, then run the eval again. See https://veryfront.com/docs/api/errors/insufficient-credits",
});

/**
 * An eval stopped because the Veryfront Cloud gateway rejected its model
 * requests for naming no project (HTTP 400, `gateway_project_required`).
 */
export const EVAL_PROJECT_REQUIRED = defineError({
  slug: "eval-project-required",
  category: "AGENT",
  status: 400,
  title: "No project for eval model requests",
  suggestion:
    "Set VERYFRONT_PROJECT_SLUG in .env or projectSlug in veryfront.config.ts to a project you can edit, then run veryfront eval again",
});

/**
 * An eval stopped because Veryfront reached its AI provider spend limit for the
 * current window. Buying credits does not clear this limit.
 */
export const EVAL_MODEL_SPEND_LIMIT_EXCEEDED = defineError({
  slug: "eval-model-spend-limit-exceeded",
  category: "AGENT",
  status: 402,
  title: "AI provider spend limit reached for eval run",
  suggestion:
    "Try again after the spend limit window resets, or ask a Veryfront administrator to raise the AI provider spend limit",
});

/**
 * An eval stopped because the Veryfront Cloud gateway rejected the API
 * credential for its model requests (HTTP 401).
 */
export const EVAL_MODEL_UNAUTHORIZED = defineError({
  slug: "eval-model-unauthorized",
  category: "AGENT",
  status: 401,
  title: "Veryfront Cloud rejected the eval credential",
  suggestion:
    "Run `veryfront login` to refresh your session, or set VERYFRONT_API_TOKEN to a valid token, then run the eval again",
});

/**
 * An eval stopped because the Veryfront Cloud gateway denied the credential
 * access to the linked project (HTTP 403).
 */
export const EVAL_MODEL_PROJECT_ACCESS_DENIED = defineError({
  slug: "eval-model-project-access-denied",
  category: "AGENT",
  status: 403,
  title: "No access to the linked project for eval run",
  suggestion:
    "Ensure your account can access the linked project. Check the project slug in veryfront.json, the project link, or VERYFRONT_PROJECT_SLUG, then run the eval again",
});

/**
 * An eval stopped because the host egress policy blocked its model gateway
 * request: the Veryfront API host resolves to a private network address. The
 * policy blocks every later record the same way.
 */
export const EVAL_MODEL_EGRESS_BLOCKED = defineError({
  slug: "eval-model-egress-blocked",
  category: "AGENT",
  status: 403,
  title: "Veryfront API blocked by network egress policy",
  suggestion:
    "Veryfront blocks requests to hosts that resolve to private network addresses. If the Veryfront API runs on a private network you trust, such as a staging, VPN, or self-hosted deployment, add its exact origin (for example https://api.example.com) to VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS in the environment that runs veryfront eval, then run the eval again",
});

/** Registry fragment for AGENT errors (slug → definition). */
export const AGENT_REGISTRY = {
  "agent-error": AGENT_ERROR,
  "agent-not-found": AGENT_NOT_FOUND,
  "agent-timeout": AGENT_TIMEOUT,
  "agent-intent-error": AGENT_INTENT_ERROR,
  "orchestration-error": ORCHESTRATION_ERROR,
  "cost-limit-exceeded": COST_LIMIT_EXCEEDED,
  "tool-id-conflict": TOOL_ID_CONFLICT,
  "durable-run-event-persistence-failed": DURABLE_RUN_EVENT_PERSISTENCE_FAILED,
  "default-model-credential-mismatch": DEFAULT_MODEL_CREDENTIAL_MISMATCH,
  "provider-replay-checkpoint-invalid": PROVIDER_REPLAY_CHECKPOINT_INVALID,
  "eval-model-access-denied": EVAL_MODEL_ACCESS_DENIED,
  "eval-project-required": EVAL_PROJECT_REQUIRED,
  "eval-model-spend-limit-exceeded": EVAL_MODEL_SPEND_LIMIT_EXCEEDED,
  "eval-model-egress-blocked": EVAL_MODEL_EGRESS_BLOCKED,
  "eval-model-unauthorized": EVAL_MODEL_UNAUTHORIZED,
  "eval-model-project-access-denied": EVAL_MODEL_PROJECT_ACCESS_DENIED,
} as const;
