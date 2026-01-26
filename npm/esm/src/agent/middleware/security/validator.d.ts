import type { AgentContext, AgentResponse } from "../../types.js";
export interface SecurityConfig {
    /** Input validation rules */
    input?: {
        /** Maximum input length */
        maxLength?: number;
        /** Blocked patterns (regex) */
        blockedPatterns?: RegExp[];
        /** Sanitize input */
        sanitize?: boolean;
        /** Custom validator */
        validate?: (input: string) => boolean | Promise<boolean>;
    };
    /** Output filtering rules */
    output?: {
        /** Blocked patterns in output */
        blockedPatterns?: RegExp[];
        /** Filter PII (Personal Identifiable Information) */
        filterPII?: boolean;
        /** Custom filter */
        filter?: (output: string) => string | Promise<string>;
    };
    /** Action when violation detected */
    onViolation?: (violation: SecurityViolation) => void;
}
export interface SecurityViolation {
    /** Violation type */
    type: "input" | "output";
    /** Violation reason */
    reason: string;
    /** Original content */
    content: string;
    /** Matched pattern (if any) */
    pattern?: RegExp;
}
/**
 * Common blocked patterns
 */
export declare const COMMON_BLOCKED_PATTERNS: {
    /** Prompt injection attempts */
    promptInjection: RegExp[];
    /** Potential data exfiltration */
    dataExfiltration: RegExp[];
    /** SQL injection patterns */
    sqlInjection: RegExp[];
    /** XSS patterns */
    xss: RegExp[];
};
/**
 * Input Validator
 */
export declare class InputValidator {
    private config;
    constructor(config?: SecurityConfig["input"]);
    /**
     * Validate input
     */
    validate(input: string): Promise<{
        valid: boolean;
        sanitized?: string;
        violations: SecurityViolation[];
    }>;
    /** Sanitization patterns to remove harmful content */
    private static readonly SANITIZE_PATTERNS;
    /**
     * Sanitize input (remove potentially harmful content)
     */
    private sanitizeInput;
}
/**
 * Output Filter
 */
export declare class OutputFilter {
    private config;
    constructor(config?: SecurityConfig["output"]);
    /**
     * Filter output
     */
    filter(output: string): Promise<{
        filtered: string;
        violations: SecurityViolation[];
    }>;
    /**
     * Filter PII from output
     */
    private filterPII;
}
/**
 * Create security middleware for agents
 */
export declare function securityMiddleware(config: SecurityConfig): (context: AgentContext, next: () => Promise<AgentResponse>) => Promise<AgentResponse>;
//# sourceMappingURL=validator.d.ts.map