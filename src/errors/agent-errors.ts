import { VeryfrontError } from "./types.ts";
import {
  AGENT_ERROR,
  AGENT_NOT_FOUND,
  AGENT_TIMEOUT,
  AGENT_INTENT_ERROR,
  ORCHESTRATION_ERROR,
} from "./error-registry.ts";

export class AgentError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, {
      slug: AGENT_ERROR.slug,
      category: AGENT_ERROR.category,
      status: AGENT_ERROR.status,
      title: AGENT_ERROR.title,
      suggestion: AGENT_ERROR.suggestion,
      detail: message,
      context,
    });
    this.name = "AgentError";
  }
}

export class AgentNotFoundError extends VeryfrontError {
  constructor(agentId: string, context?: unknown) {
    const extraContext = context && typeof context === "object"
      ? (context as Record<string, unknown>)
      : undefined;

    super(`Agent with ID '${agentId}' not found`, {
      slug: AGENT_NOT_FOUND.slug,
      category: AGENT_NOT_FOUND.category,
      status: AGENT_NOT_FOUND.status,
      title: AGENT_NOT_FOUND.title,
      suggestion: AGENT_NOT_FOUND.suggestion,
      detail: `Agent with ID '${agentId}' not found`,
      context: { agentId, ...extraContext },
    });
    this.name = "AgentNotFoundError";
  }
}

export class AgentTimeoutError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, {
      slug: AGENT_TIMEOUT.slug,
      category: AGENT_TIMEOUT.category,
      status: AGENT_TIMEOUT.status,
      title: AGENT_TIMEOUT.title,
      suggestion: AGENT_TIMEOUT.suggestion,
      detail: message,
      context,
    });
    this.name = "AgentTimeoutError";
  }
}

export class AgentIntentError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, {
      slug: AGENT_INTENT_ERROR.slug,
      category: AGENT_INTENT_ERROR.category,
      status: AGENT_INTENT_ERROR.status,
      title: AGENT_INTENT_ERROR.title,
      suggestion: AGENT_INTENT_ERROR.suggestion,
      detail: message,
      context,
    });
    this.name = "AgentIntentError";
  }
}

export class OrchestrationError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, {
      slug: ORCHESTRATION_ERROR.slug,
      category: ORCHESTRATION_ERROR.category,
      status: ORCHESTRATION_ERROR.status,
      title: ORCHESTRATION_ERROR.title,
      suggestion: ORCHESTRATION_ERROR.suggestion,
      detail: message,
      context,
    });
    this.name = "OrchestrationError";
  }
}
