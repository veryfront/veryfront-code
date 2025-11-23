import type { AgentContext, AgentResponse } from "../../types/agent.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
/**
 * Input Validation and Output Filtering
 *
 * Security features to prevent prompt injection, data leakage, and harmful content.
 */

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
export const COMMON_BLOCKED_PATTERNS = {
  /** Prompt injection attempts */
  promptInjection: [
    /ignore\s+previous\s+instructions/i,
    /ignore\s+all\s+previous\s+prompts/i,
    /you\s+are\s+now\s+a/i,
    /pretend\s+you\s+are/i,
    /system:\s*/i,
    /<\|im_start\|>/i,
    /<\|im_end\|>/i,
  ],

  /** Potential data exfiltration */
  dataExfiltration: [
    /password/i,
    /api[_\s-]?key/i,
    /secret/i,
    /token/i,
    /credit\s+card/i,
  ],

  /** SQL injection patterns */
  sqlInjection: [
    /(\bUNION\b|\bSELECT\b).*\bFROM\b/i,
    /;\s*(DROP|DELETE|UPDATE|INSERT)/i,
  ],

  /** XSS patterns */
  xss: [
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/i,
    /on\w+\s*=/i, // Event handlers
  ],
};

/**
 * PII patterns (email, phone, SSN, etc.)
 */
const PII_PATTERNS = {
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  phone: /\b(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
};

/**
 * Input Validator
 */
export class InputValidator {
  private config: SecurityConfig["input"];

  constructor(config?: SecurityConfig["input"]) {
    this.config = config || {};
  }

  /**
   * Validate input
   */
  async validate(input: string): Promise<{
    valid: boolean;
    sanitized?: string;
    violations: SecurityViolation[];
  }> {
    const violations: SecurityViolation[] = [];

    // Check length
    if (this.config?.maxLength && input.length > this.config.maxLength) {
      violations.push({
        type: "input",
        reason: `Input exceeds maximum length of ${this.config.maxLength}`,
        content: input.substring(0, 100) + "...",
      });
    }

    // Check blocked patterns
    if (this.config?.blockedPatterns) {
      for (const pattern of this.config.blockedPatterns) {
        if (pattern.test(input)) {
          violations.push({
            type: "input",
            reason: "Input matches blocked pattern",
            content: input,
            pattern,
          });
        }
      }
    }

    // Custom validation
    if (this.config?.validate) {
      const customValid = await this.config.validate(input);
      if (!customValid) {
        violations.push({
          type: "input",
          reason: "Custom validation failed",
          content: input,
        });
      }
    }

    // Sanitize if requested
    let sanitized = input;
    if (this.config?.sanitize) {
      sanitized = this.sanitizeInput(input);
    }

    return {
      valid: violations.length === 0,
      sanitized: this.config?.sanitize ? sanitized : undefined,
      violations,
    };
  }

  /**
   * Sanitize input (remove potentially harmful content)
   */
  private sanitizeInput(input: string): string {
    let sanitized = input;

    // Remove script tags
    sanitized = sanitized.replace(/<script[^>]*>.*?<\/script>/gi, "");

    // Remove event handlers
    sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, "");

    // Remove javascript: protocol
    sanitized = sanitized.replace(/javascript:/gi, "");

    return sanitized;
  }
}

/**
 * Output Filter
 */
export class OutputFilter {
  private config: SecurityConfig["output"];

  constructor(config?: SecurityConfig["output"]) {
    this.config = config || {};
  }

  /**
   * Filter output
   */
  async filter(output: string): Promise<{
    filtered: string;
    violations: SecurityViolation[];
  }> {
    const violations: SecurityViolation[] = [];
    let filtered = output;

    // Check blocked patterns
    if (this.config?.blockedPatterns) {
      for (const pattern of this.config.blockedPatterns) {
        if (pattern.test(filtered)) {
          violations.push({
            type: "output",
            reason: "Output contains blocked pattern",
            content: filtered,
            pattern,
          });

          // Redact matched content
          filtered = filtered.replace(pattern, "[REDACTED]");
        }
      }
    }

    // Filter PII
    if (this.config?.filterPII) {
      filtered = this.filterPII(filtered);
    }

    // Custom filter
    if (this.config?.filter) {
      filtered = await this.config.filter(filtered);
    }

    return { filtered, violations };
  }

  /**
   * Filter PII from output
   */
  private filterPII(output: string): string {
    let filtered = output;

    // Replace email addresses
    filtered = filtered.replace(PII_PATTERNS.email, "[EMAIL]");

    // Replace phone numbers
    filtered = filtered.replace(PII_PATTERNS.phone, "[PHONE]");

    // Replace SSN
    filtered = filtered.replace(PII_PATTERNS.ssn, "[SSN]");

    // Replace credit card numbers
    filtered = filtered.replace(PII_PATTERNS.creditCard, "[CREDIT_CARD]");

    return filtered;
  }
}

/**
 * Create security middleware for agents
 */
export function securityMiddleware(config: SecurityConfig) {
  const inputValidator = new InputValidator(config.input);
  const outputFilter = new OutputFilter(config.output);

  return async (
    context: AgentContext,
    next: () => Promise<AgentResponse>,
  ): Promise<AgentResponse> => {
    // Validate input
    const inputString = typeof context.input === "string"
      ? context.input
      : JSON.stringify(context.input);

    const inputValidation = await inputValidator.validate(inputString);

    if (!inputValidation.valid) {
      // Report violations
      inputValidation.violations.forEach((v) => {
        if (config.onViolation) {
          config.onViolation(v);
        }
      });

      const firstViolation = inputValidation.violations[0];
      throw toError(createError({
        type: "agent",
        message: `Input validation failed: ${firstViolation?.reason || "Unknown reason"}`,
      }));
    }

    // Execute with sanitized input if applicable
    if (inputValidation.sanitized) {
      context.input = inputValidation.sanitized;
    }

    // Execute
    const result = await next();

    // Filter output
    const outputFiltering = await outputFilter.filter(result.text);

    if (outputFiltering.violations.length > 0) {
      // Report violations
      outputFiltering.violations.forEach((v) => {
        if (config.onViolation) {
          config.onViolation(v);
        }
      });
    }

    // Return filtered result
    return {
      ...result,
      text: outputFiltering.filtered,
    };
  };
}
