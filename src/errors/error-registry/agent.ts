import { defineError, type ErrorRegistryFragment, type RegisteredError } from "../types.ts";

/** Registered error definition for the agent-error slug. */
export const AGENT_ERROR: RegisteredError = defineError({
  slug: "agent-error",
  category: "AGENT",
  status: 500,
  title: "Agent operation error",
  suggestion: "Check agent configuration and logs",
});

/** Registered error definition for the agent-not-found slug. */
export const AGENT_NOT_FOUND: RegisteredError = defineError({
  slug: "agent-not-found",
  category: "AGENT",
  status: 404,
  title: "Agent not found",
  suggestion: "Verify the agent ID exists",
});

/** Registered error definition for the agent-timeout slug. */
export const AGENT_TIMEOUT: RegisteredError = defineError({
  slug: "agent-timeout",
  category: "AGENT",
  status: 408,
  title: "Agent operation timed out",
  suggestion: "Increase timeout or simplify the request",
});

/** Registered error definition for the agent-intent-error slug. */
export const AGENT_INTENT_ERROR: RegisteredError = defineError({
  slug: "agent-intent-error",
  category: "AGENT",
  status: 400,
  title: "Agent intent parsing error",
  suggestion: "Rephrase the request more clearly",
});

/** Registered error definition for the orchestration-error slug. */
export const ORCHESTRATION_ERROR: RegisteredError = defineError({
  slug: "orchestration-error",
  category: "AGENT",
  status: 500,
  title: "Multi-agent orchestration error",
  suggestion: "Check agent coordination logic",
});

/** Registered error definition for the cost-limit-exceeded slug. */
export const COST_LIMIT_EXCEEDED: RegisteredError = defineError({
  slug: "cost-limit-exceeded",
  category: "AGENT",
  status: 429,
  title: "Cost limit exceeded",
  suggestion: "Wait for the budget period to reset or increase the limit",
});

/** Registered error definition for the tool-id-conflict slug. */
export const TOOL_ID_CONFLICT: RegisteredError = defineError({
  slug: "tool-id-conflict",
  category: "AGENT",
  status: 409,
  title: "Tool ID conflict",
  suggestion: "Use a unique tool ID or rename one of the conflicting tools",
});

/** Registry fragment for AGENT errors (slug → definition). */
export const AGENT_REGISTRY: ErrorRegistryFragment<
  | "agent-error"
  | "agent-not-found"
  | "agent-timeout"
  | "agent-intent-error"
  | "orchestration-error"
  | "cost-limit-exceeded"
  | "tool-id-conflict"
> = Object.freeze(
  {
    "agent-error": AGENT_ERROR,
    "agent-not-found": AGENT_NOT_FOUND,
    "agent-timeout": AGENT_TIMEOUT,
    "agent-intent-error": AGENT_INTENT_ERROR,
    "orchestration-error": ORCHESTRATION_ERROR,
    "cost-limit-exceeded": COST_LIMIT_EXCEEDED,
    "tool-id-conflict": TOOL_ID_CONFLICT,
  } as const,
);
