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
 * Generic provider metadata could not be preserved through a provider request
 * conversion. The metadata may be provider-specific state unrelated to replay
 * checkpoints, so keep the failure distinct from checkpoint validation.
 */
export const PROVIDER_METADATA_SPLIT_UNSUPPORTED = defineError({
  slug: "provider-metadata-split-unsupported",
  category: "AGENT",
  status: 500,
  title: "Provider metadata cannot be attached after assistant turn splitting",
  suggestion:
    "Avoid converting one provider response into multiple assistant request messages before provider metadata is consumed",
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
  "provider-metadata-split-unsupported": PROVIDER_METADATA_SPLIT_UNSUPPORTED,
} as const;
