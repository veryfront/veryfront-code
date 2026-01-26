import { createError, toError } from "../../../errors/veryfront-error.js";
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
 * PII patterns with replacement labels
 */
const PII_REPLACEMENTS = [
    { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, label: "[EMAIL]" },
    { pattern: /\b(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, label: "[PHONE]" },
    { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, label: "[SSN]" },
    { pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, label: "[CREDIT_CARD]" },
];
/**
 * Input Validator
 */
export class InputValidator {
    config;
    constructor(config) {
        this.config = config ?? {};
    }
    /**
     * Validate input
     */
    async validate(input) {
        const violations = [];
        const maxLength = this.config.maxLength;
        if (maxLength && input.length > maxLength) {
            violations.push({
                type: "input",
                reason: `Input exceeds maximum length of ${maxLength}`,
                content: input.substring(0, 100) + "...",
            });
        }
        const blockedPatterns = this.config.blockedPatterns;
        if (blockedPatterns) {
            for (const pattern of blockedPatterns) {
                if (!pattern.test(input))
                    continue;
                violations.push({
                    type: "input",
                    reason: "Input matches blocked pattern",
                    content: input,
                    pattern,
                });
            }
        }
        const validate = this.config.validate;
        if (validate) {
            const customValid = await validate(input);
            if (!customValid) {
                violations.push({
                    type: "input",
                    reason: "Custom validation failed",
                    content: input,
                });
            }
        }
        const sanitized = this.config.sanitize ? this.sanitizeInput(input) : undefined;
        return {
            valid: violations.length === 0,
            sanitized,
            violations,
        };
    }
    /** Sanitization patterns to remove harmful content */
    static SANITIZE_PATTERNS = [
        /<script[^>]*>.*?<\/script>/gi, // Script tags
        /on\w+\s*=\s*["'][^"']*["']/gi, // Event handlers
        /javascript:/gi, // JavaScript protocol
    ];
    /**
     * Sanitize input (remove potentially harmful content)
     */
    sanitizeInput(input) {
        return InputValidator.SANITIZE_PATTERNS.reduce((text, pattern) => text.replace(pattern, ""), input);
    }
}
/**
 * Output Filter
 */
export class OutputFilter {
    config;
    constructor(config) {
        this.config = config ?? {};
    }
    /**
     * Filter output
     */
    async filter(output) {
        const violations = [];
        let filtered = output;
        const blockedPatterns = this.config.blockedPatterns;
        if (blockedPatterns) {
            for (const pattern of blockedPatterns) {
                if (!pattern.test(filtered))
                    continue;
                violations.push({
                    type: "output",
                    reason: "Output contains blocked pattern",
                    content: filtered,
                    pattern,
                });
                filtered = filtered.replace(pattern, "[REDACTED]");
            }
        }
        if (this.config.filterPII) {
            filtered = this.filterPII(filtered);
        }
        const customFilter = this.config.filter;
        if (customFilter) {
            filtered = await customFilter(filtered);
        }
        return { filtered, violations };
    }
    /**
     * Filter PII from output
     */
    filterPII(output) {
        return PII_REPLACEMENTS.reduce((text, { pattern, label }) => text.replace(pattern, label), output);
    }
}
/**
 * Report violations to the configured handler
 */
function reportViolations(violations, onViolation) {
    if (!onViolation)
        return;
    for (const violation of violations)
        onViolation(violation);
}
/**
 * Create security middleware for agents
 */
export function securityMiddleware(config) {
    const inputValidator = new InputValidator(config.input);
    const outputFilter = new OutputFilter(config.output);
    return async (context, next) => {
        const inputString = typeof context.input === "string"
            ? context.input
            : JSON.stringify(context.input);
        const inputValidation = await inputValidator.validate(inputString);
        if (!inputValidation.valid) {
            reportViolations(inputValidation.violations, config.onViolation);
            const firstViolation = inputValidation.violations[0];
            throw toError(createError({
                type: "agent",
                message: `Input validation failed: ${firstViolation?.reason ?? "Unknown reason"}`,
            }));
        }
        if (inputValidation.sanitized) {
            context.input = inputValidation.sanitized;
        }
        const result = await next();
        const outputFiltering = await outputFilter.filter(result.text);
        reportViolations(outputFiltering.violations, config.onViolation);
        return { ...result, text: outputFiltering.filtered };
    };
}
