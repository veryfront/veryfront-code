import type { AgentContext, AgentResponse, Message } from "../../types.ts";
import { createError, toError } from "#veryfront/errors";
import { getOutputSchemaParser } from "../../output-schema.ts";

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
    /(^|\n)\s*system:\s*/i,
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
const PII_REPLACEMENTS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, label: "[EMAIL]" },
  {
    pattern: /\b(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    label: "[PHONE]",
  },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, label: "[SSN]" },
  { pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, label: "[CREDIT_CARD]" },
];

function freshStatefulPattern(pattern: RegExp): RegExp {
  if (!pattern.global && !pattern.sticky) return pattern;

  const matcher = new RegExp(pattern.source, pattern.flags);
  if (pattern.sticky) matcher.lastIndex = pattern.lastIndex;
  return matcher;
}

function advanceStringIndex(input: string, index: number, unicode: boolean): number {
  if (!unicode) return index + 1;
  return index + ((input.codePointAt(index) ?? 0) > 0xffff ? 2 : 1);
}

function redactBlockedPattern(input: string, pattern: RegExp): string {
  const matcher = freshStatefulPattern(pattern);
  if (!matcher.sticky) return input.replace(matcher, "[REDACTED]");

  // replace() resets global sticky regexes to index 0, and Bun does not
  // currently honor lastIndex for non-global sticky replacements. Use exec and
  // splice matches so every supported runtime starts at the caller-configured
  // position without mutating the caller-owned pattern.
  let redacted = "";
  let cursor = 0;
  let matched = false;

  for (let match = matcher.exec(input); match; match = matcher.exec(input)) {
    redacted += `${input.slice(cursor, match.index)}[REDACTED]`;
    cursor = match.index + match[0].length;
    matched = true;
    if (!matcher.global) break;
    if (match[0].length === 0) {
      matcher.lastIndex = advanceStringIndex(
        input,
        cursor,
        matcher.unicode || matcher.unicodeSets,
      );
    }
  }

  return matched ? redacted + input.slice(cursor) : input;
}

/**
 * Input Validator
 */
export class InputValidator {
  private config: NonNullable<SecurityConfig["input"]>;

  constructor(config?: SecurityConfig["input"]) {
    this.config = config ?? {};
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

    const maxLength = this.config.maxLength;
    if (maxLength != null && input.length > maxLength) {
      violations.push({
        type: "input",
        reason: `Input exceeds maximum length of ${maxLength}`,
        content: `${input.substring(0, 100)}...`,
      });
    }

    for (const pattern of this.config.blockedPatterns ?? []) {
      // Blocked pattern groups are shared module-level objects reused across
      // requests. Test stateful patterns through a fresh matcher so lastIndex
      // cannot skip a repeat match and caller-owned patterns remain untouched.
      if (!freshStatefulPattern(pattern).test(input)) continue;

      violations.push({
        type: "input",
        reason: "Input matches blocked pattern",
        content: input,
        pattern,
      });
    }

    const customValidate = this.config.validate;
    if (customValidate) {
      const customValid = await customValidate(input);
      if (!customValid) {
        violations.push({
          type: "input",
          reason: "Custom validation failed",
          content: input,
        });
      }
    }

    const sanitized = this.sanitize(input);

    return {
      valid: violations.length === 0,
      sanitized,
      violations,
    };
  }

  /**
   * Sanitize a single text value, or return `undefined` when sanitization is
   * disabled.
   *
   * Exposed so callers holding structured input can sanitize each text part in
   * place instead of collapsing a `Message[]` into one scalar string.
   */
  sanitize(input: string): string | undefined {
    return this.config.sanitize ? this.sanitizeInput(input) : undefined;
  }

  /** Sanitization patterns to remove harmful content */
  private static readonly SANITIZE_PATTERNS: RegExp[] = [
    /<script[^>]*>.*?<\/script>/gi, // Script tags
    /on\w+\s*=\s*["'][^"']*["']/gi, // Event handlers
    /javascript:/gi, // JavaScript protocol
  ];

  /**
   * Sanitize input (remove potentially harmful content)
   */
  private sanitizeInput(input: string): string {
    return InputValidator.SANITIZE_PATTERNS.reduce(
      (text, pattern) => text.replace(pattern, ""),
      input,
    );
  }
}

/**
 * Output Filter
 */
export class OutputFilter {
  private config: NonNullable<SecurityConfig["output"]>;

  constructor(config?: SecurityConfig["output"]) {
    this.config = config ?? {};
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

    for (const pattern of this.config.blockedPatterns ?? []) {
      // See InputValidator.validate: shared /g patterns must not carry
      // lastIndex across calls or require caller-owned regexes to be mutable.
      if (!freshStatefulPattern(pattern).test(filtered)) continue;

      violations.push({
        type: "output",
        reason: "Output contains blocked pattern",
        content: filtered,
        pattern,
      });

      filtered = redactBlockedPattern(filtered, pattern);
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
  private filterPII(output: string): string {
    return PII_REPLACEMENTS.reduce(
      (text, { pattern, label }) => text.replace(pattern, label),
      output,
    );
  }
}

/**
 * Report violations to the configured handler
 */
function reportViolations(
  violations: SecurityViolation[],
  onViolation?: (violation: SecurityViolation) => void,
): void {
  if (!onViolation) return;
  for (const violation of violations) onViolation(violation);
}

async function filterStructuredOutputValue(
  value: unknown,
  outputFilter: OutputFilter,
): Promise<{
  value: unknown;
  violations: SecurityViolation[];
}> {
  if (typeof value === "string") {
    const result = await outputFilter.filter(value);
    return { value: result.filtered, violations: result.violations };
  }

  if (Array.isArray(value)) {
    const filteredItems = [];
    const violations: SecurityViolation[] = [];
    for (const item of value) {
      const result = await filterStructuredOutputValue(item, outputFilter);
      filteredItems.push(result.value);
      violations.push(...result.violations);
    }
    return { value: filteredItems, violations };
  }

  if (isRecord(value)) {
    const filteredObject: Record<string, unknown> = {};
    const violations: SecurityViolation[] = [];
    for (const [key, item] of Object.entries(value)) {
      const result = await filterStructuredOutputValue(item, outputFilter);
      filteredObject[key] = result.value;
      violations.push(...result.violations);
    }
    return { value: filteredObject, violations };
  }

  return { value, violations: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractPartInputText(part: unknown): string[] {
  if (isRecord(part) && part.type === "text" && typeof part.text === "string") return [part.text];
  if (!isRecord(part) || part.type === "tool-result") return [];

  const values: string[] = [];
  if (typeof part.inputText === "string") values.push(part.inputText);
  if (isRecord(part.args)) values.push(JSON.stringify(part.args));
  if (isRecord(part.input)) values.push(JSON.stringify(part.input));
  return values;
}

/**
 * Roles whose text is caller-authored instruction and must be validated.
 *
 * `system` belongs here: structured input accepts caller-supplied system
 * messages and the runtime converter forwards them to the provider as system
 * prompts, so they carry more authority than user text, not less. Assistant and
 * tool messages stay exempt because they are model-authored replay that would
 * otherwise block a benign follow-up turn.
 */
const VALIDATED_INPUT_ROLES: ReadonlySet<Message["role"]> = new Set(["user", "system"]);

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  return isRecord(part) && part.type === "text" && typeof part.text === "string";
}

/**
 * Text-part separators the provider converters use when they assemble one
 * message into a single prompt string.
 *
 * `getTextFromParts` (src/agent/types.ts) concatenates with no separator while
 * `joinTextParts` (src/agent/runtime/message-adapter.ts) joins with a blank
 * line. Both assembled forms are validated so a blocked phrase cannot be
 * smuggled past validation by splitting it across sibling text parts.
 */
const ASSEMBLED_TEXT_SEPARATORS = ["", "\n\n"] as const;

function extractMessageInputText(message: Message): string[] {
  if (!VALIDATED_INPUT_ROLES.has(message.role)) return [];
  const values = message.parts.flatMap(extractPartInputText);

  // A single text part already equals every assembled form, so only add the
  // joined variants when the parts could actually hide a split phrase.
  const textParts = message.parts.filter(isTextPart).map((part) => part.text);
  if (textParts.length < 2) return values;

  return [...values, ...ASSEMBLED_TEXT_SEPARATORS.map((sep) => textParts.join(sep))];
}

function extractInputValidationTexts(input: AgentContext["input"]): string[] {
  if (typeof input === "string") return [input];
  return input.flatMap(extractMessageInputText);
}

/**
 * Sanitize the text parts of caller-authored messages in place.
 *
 * Structured input must stay structured: replacing a `Message[]` with the
 * sanitized scalar would drop the role, message id, and every other field, so
 * downstream middleware would no longer see the system/user split.
 */
function sanitizeStructuredInput(validator: InputValidator, messages: Message[]): Message[] {
  let changed = false;

  const sanitizedMessages = messages.map((message) => {
    if (!VALIDATED_INPUT_ROLES.has(message.role)) return message;

    let messageChanged = false;
    const parts = message.parts.map((part) => {
      if (!isTextPart(part)) return part;
      const sanitized = validator.sanitize(part.text);
      if (sanitized === undefined || sanitized === part.text) return part;
      messageChanged = true;
      return { ...part, text: sanitized };
    });

    if (!messageChanged) return message;
    changed = true;
    return { ...message, parts };
  });

  return changed ? sanitizedMessages : messages;
}

async function validateInputTexts(
  validator: InputValidator,
  values: string[],
): Promise<{ valid: boolean; violations: SecurityViolation[] }> {
  const results = await Promise.all(values.map((value) => validator.validate(value)));
  return {
    valid: results.every((result) => result.valid),
    violations: results.flatMap((result) => result.violations),
  };
}

/**
 * Create security middleware for agents
 */
export function securityMiddleware(
  config: SecurityConfig,
): (context: AgentContext, next: () => Promise<AgentResponse>) => Promise<AgentResponse> {
  const inputValidator = new InputValidator(config.input);
  const outputFilter = new OutputFilter(config.output);

  return async (
    context: AgentContext,
    next: () => Promise<AgentResponse>,
  ): Promise<AgentResponse> => {
    const inputValues = extractInputValidationTexts(context.input);
    const inputValidation = await validateInputTexts(inputValidator, inputValues);

    if (!inputValidation.valid) {
      reportViolations(inputValidation.violations, config.onViolation);

      const firstViolation = inputValidation.violations[0];
      throw toError(
        createError({
          type: "agent",
          message: `Input validation failed: ${firstViolation?.reason ?? "Unknown reason"}`,
        }),
      );
    }

    if (typeof context.input === "string") {
      const sanitized = inputValidator.sanitize(context.input);
      if (sanitized != null) context.input = sanitized;
    } else {
      context.input = sanitizeStructuredInput(inputValidator, context.input);
    }

    const result = await next();

    const outputFiltering = await outputFilter.filter(result.text);
    reportViolations(outputFiltering.violations, config.onViolation);

    if (!("object" in result) || result.object === undefined) {
      return { ...result, text: outputFiltering.filtered };
    }

    const objectFiltering = await filterStructuredOutputValue(result.object, outputFilter);
    reportViolations(objectFiltering.violations, config.onViolation);
    const parseOutput = getOutputSchemaParser(result);
    if (parseOutput) {
      const object = await parseOutput(outputFiltering.filtered);
      return { ...result, text: outputFiltering.filtered, object };
    }

    return { ...result, text: outputFiltering.filtered, object: objectFiltering.value };
  };
}
