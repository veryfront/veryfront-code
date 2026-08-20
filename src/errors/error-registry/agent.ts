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
} as const;
