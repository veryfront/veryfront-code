import { ErrorCode, VeryfrontError } from "./types.ts";

export class AgentError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, ErrorCode.AGENT_ERROR, context);
    this.name = "AgentError";
  }
}

export class AgentNotFoundError extends VeryfrontError {
  constructor(agentId: string, context?: unknown) {
    super(`Agent with ID '${agentId}' not found`, ErrorCode.AGENT_NOT_FOUND, {
      agentId,
      ...(context as Record<string, unknown> | undefined),
    });
    this.name = "AgentNotFoundError";
  }
}

export class AgentTimeoutError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, ErrorCode.AGENT_TIMEOUT, context);
    this.name = "AgentTimeoutError";
  }
}

export class AgentIntentError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, ErrorCode.AGENT_INTENT_ERROR, context);
    this.name = "AgentIntentError";
  }
}

export class OrchestrationError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, ErrorCode.ORCHESTRATION_ERROR, context);
    this.name = "OrchestrationError";
  }
}
