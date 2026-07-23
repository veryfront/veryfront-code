import type { PartialErrorCatalog } from "./types.ts";
import { createSimpleError } from "./factory.ts";

/** Immutable error-solution catalog fragment. */
export const AGENT_ERROR_CATALOG: PartialErrorCatalog = Object.freeze({
  "agent-error": createSimpleError(
    "agent-error",
    "Agent operation failed",
    "The agent could not complete the requested operation.",
    [
      "Check the agent definition and provider configuration",
      "Verify that required tools are registered",
      "Review sanitized run diagnostics for the failing step",
    ],
  ),
  "agent-not-found": createSimpleError(
    "agent-not-found",
    "Agent not found",
    "The requested agent is not registered in the project.",
    [
      "Check the agent ID for spelling errors",
      "Export the agent from the project",
      "Restart the runtime after changing project exports",
    ],
  ),
  "agent-timeout": createSimpleError(
    "agent-timeout",
    "Agent operation timed out",
    "The agent did not finish before its deadline.",
    [
      "Check for a stalled tool or provider request",
      "Reduce the amount of work in one agent run",
      "Increase the timeout only after measuring expected latency",
    ],
  ),
  "agent-intent-error": createSimpleError(
    "agent-intent-error",
    "Agent intent is invalid",
    "The agent could not map the request to a supported intent.",
    [
      "Use a direct request that names the intended operation",
      "Check the intents supported by the agent",
      "Update the agent definition if the intent should be supported",
    ],
  ),
  "orchestration-error": createSimpleError(
    "orchestration-error",
    "Agent orchestration failed",
    "An agent coordination step could not complete.",
    [
      "Check the failing agent and delegation step",
      "Verify that delegated agents and tools are available",
      "Retry after resolving the first reported failure",
    ],
  ),
  "cost-limit-exceeded": createSimpleError(
    "cost-limit-exceeded",
    "Cost limit exceeded",
    "The agent run reached its configured cost limit.",
    [
      "Wait for the configured budget period to reset",
      "Reduce model or tool usage for the run",
      "Change the limit only after reviewing the expected cost",
    ],
  ),
  "tool-id-conflict": createSimpleError(
    "tool-id-conflict",
    "Tool ID conflict",
    "More than one tool uses the same ID.",
    [
      "Find the duplicate tool definitions",
      "Assign a unique ID to each tool",
      "Restart the runtime after updating the definitions",
    ],
  ),
});
