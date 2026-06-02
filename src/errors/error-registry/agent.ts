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

/** Registry fragment for AGENT errors (slug → definition). */
export const AGENT_REGISTRY = {
  "agent-error": AGENT_ERROR,
  "agent-not-found": AGENT_NOT_FOUND,
  "agent-timeout": AGENT_TIMEOUT,
  "agent-intent-error": AGENT_INTENT_ERROR,
  "orchestration-error": ORCHESTRATION_ERROR,
  "cost-limit-exceeded": COST_LIMIT_EXCEEDED,
} as const;
