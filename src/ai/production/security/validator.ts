import type { AgentContext, AgentResponse } from "../../types/agent.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export interface SecurityConfig {
  input?: {
    maxLength?: number;

    blockedPatterns?: RegExp[];

    sanitize?: boolean;

    validate?: (input: string) => boolean | Promise<boolean>;
  };

  output?: {
    blockedPatterns?: RegExp[];

    filterPII?: boolean;

    filter?: (output: string) => string | Promise<string>;
  };

  onViolation?: (violation: SecurityViolation) => void;
}

export interface SecurityViolation {
  type: "input" | "output";

  reason: string;

  content: string;

  pattern?: RegExp;
}

export const COMMON_BLOCKED_PATTERNS = {
  promptInjection: [
    /ignore\s+previous\s+instructions/i,
    /ignore\s+all\s+previous\s+prompts/i,
    /you\s+are\s+now\s+a/i,
    /pretend\s+you\s+are/i,
    /system:\s*/i,
    /<\|im_start\|>/i,
    /<\|im_end\|>/i,
  ],

  dataExfiltration: [
    /password/i,
    /api[_\s-]?key/i,
    /secret/i,
    /token/i,
    /credit\s+card/i,
  ],

  sqlInjection: [
    /(\bUNION\b|\bSELECT\b).*\bFROM\b/i,
    /;\s*(DROP|DELETE|UPDATE|INSERT)/i,
  ],

  xss: [
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/i,
    /on\w+\s*=/i,
  ],
};

const PII_PATTERNS = {
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  phone: /\b(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
};

export class InputValidator {
  private config: SecurityConfig["input"];

  constructor(config?: SecurityConfig["input"]) {
    this.config = config || {};
  }

  async validate(input: string): Promise<{
    valid: boolean;
    sanitized?: string;
    violations: SecurityViolation[];
  }> {
    const violations: SecurityViolation[] = [];

    if (this.config?.maxLength && input.length > this.config.maxLength) {
      violations.push({
        type: "input",
        reason: `Input exceeds maximum length of ${this.config.maxLength}`,
        content: input.substring(0, 100) + "...",
      });
    }

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

  private sanitizeInput(input: string): string {
    let sanitized = input;

    sanitized = sanitized.replace(/<script[^>]*>.*?<\/script>/gi, "");

    sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, "");

    sanitized = sanitized.replace(/javascript:/gi, "");

    return sanitized;
  }
}

export class OutputFilter {
  private config: SecurityConfig["output"];

  constructor(config?: SecurityConfig["output"]) {
    this.config = config || {};
  }

  async filter(output: string): Promise<{
    filtered: string;
    violations: SecurityViolation[];
  }> {
    const violations: SecurityViolation[] = [];
    let filtered = output;

    if (this.config?.blockedPatterns) {
      for (const pattern of this.config.blockedPatterns) {
        if (pattern.test(filtered)) {
          violations.push({
            type: "output",
            reason: "Output contains blocked pattern",
            content: filtered,
            pattern,
          });

          filtered = filtered.replace(pattern, "[REDACTED]");
        }
      }
    }

    if (this.config?.filterPII) {
      filtered = this.filterPII(filtered);
    }

    if (this.config?.filter) {
      filtered = await this.config.filter(filtered);
    }

    return { filtered, violations };
  }

  private filterPII(output: string): string {
    let filtered = output;

    filtered = filtered.replace(PII_PATTERNS.email, "[EMAIL]");

    filtered = filtered.replace(PII_PATTERNS.phone, "[PHONE]");

    filtered = filtered.replace(PII_PATTERNS.ssn, "[SSN]");

    filtered = filtered.replace(PII_PATTERNS.creditCard, "[CREDIT_CARD]");

    return filtered;
  }
}

export function securityMiddleware(config: SecurityConfig) {
  const inputValidator = new InputValidator(config.input);
  const outputFilter = new OutputFilter(config.output);

  return async (
    context: AgentContext,
    next: () => Promise<AgentResponse>,
  ): Promise<AgentResponse> => {
    const inputString = typeof context.input === "string"
      ? context.input
      : JSON.stringify(context.input);

    const inputValidation = await inputValidator.validate(inputString);

    if (!inputValidation.valid) {
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

    if (inputValidation.sanitized) {
      context.input = inputValidation.sanitized;
    }

    const result = await next();

    const outputFiltering = await outputFilter.filter(result.text);

    if (outputFiltering.violations.length > 0) {
      outputFiltering.violations.forEach((v) => {
        if (config.onViolation) {
          config.onViolation(v);
        }
      });
    }

    return {
      ...result,
      text: outputFiltering.filtered,
    };
  };
}
