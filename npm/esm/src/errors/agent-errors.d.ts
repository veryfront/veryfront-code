import { VeryfrontError } from "./types.js";
export declare class AgentError extends VeryfrontError {
    constructor(message: string, context?: unknown);
}
export declare class AgentNotFoundError extends VeryfrontError {
    constructor(agentId: string, context?: unknown);
}
export declare class AgentTimeoutError extends VeryfrontError {
    constructor(message: string, context?: unknown);
}
export declare class AgentIntentError extends VeryfrontError {
    constructor(message: string, context?: unknown);
}
export declare class OrchestrationError extends VeryfrontError {
    constructor(message: string, context?: unknown);
}
//# sourceMappingURL=agent-errors.d.ts.map