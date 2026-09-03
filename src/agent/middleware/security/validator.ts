import type { AgentContext, AgentResponse, Message } from "../../types.ts";
import { createError, toError } from "#veryfront/errors";
import { getOutputSchemaParser } from "../../output-schema.ts";
import { createProviderDroppedMessageTracker } from "#veryfront/agent/runtime/text-generation-runtime-message-converter.ts";

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

/**
 * Assembled text for each run of adjacent system messages.
 *
 * `toOpenAICompatibleMessages` (src/provider/runtime-loader.ts) folds adjacent
 * system messages into one instruction joined with a blank line, after
 * `convertToTextGenerationRuntimeMessage` has already assembled each message's
 * parts (`getTextFromParts` concatenates with no separator; other adapters use
 * a blank line). A blocked phrase split across sibling system messages
 * therefore reassembles at the provider, so each merged run is validated in
 * both per-message assembled forms the converters can produce. Only a message
 * that actually survives provider conversion ends a run: dropped ones (blank
 * system layers, assistant messages with no sendable content, tool messages
 * with no surviving results, including results the provider itself executed)
 * leave their neighbours adjacent.
 */
function extractAdjacentSystemRuns(messages: Message[]): Message[][] {
  const runs: Message[][] = [];
  let run: Message[] = [];
  const isProviderDropped = createProviderDroppedMessageTracker();

  const flushRun = () => {
    // Runs of a single message are already covered by the per-message
    // extraction, including its own assembled forms.
    if (run.length > 1) runs.push(run);
    run = [];
  };

  for (const message of messages) {
    if (message.role !== "system") {
      // A message the converter drops entirely leaves the system messages on
      // either side of it adjacent, so it must not end the run.
      if (!isProviderDropped(message)) flushRun();
      continue;
    }
    // Conversion clears its provider-executed id window on every system
    // message before deciding what to drop, so the mirrored walk must route
    // system messages through the tracker too. A stale id would otherwise
    // mark a tool result conversion keeps as dropped and merge system runs
    // the provider keeps apart.
    isProviderDropped(message);
    const textParts = message.parts.filter(isTextPart).map((part) => part.text);
    // The converter drops blank system layers outright, leaving the messages
    // on either side of them adjacent, so a blank one must not end the run.
    if (textParts.join("").trim().length === 0) continue;
    run.push(message);
  }
  flushRun();

  return runs;
}

function messageTextParts(message: Message): string[] {
  return message.parts.filter(isTextPart).map((part) => part.text);
}

function extractAdjacentSystemRunTexts(messages: Message[]): string[] {
  const runTexts = new Set<string>();
  for (const run of extractAdjacentSystemRuns(messages)) {
    for (const separator of ASSEMBLED_TEXT_SEPARATORS) {
      runTexts.add(
        run.map((message) => messageTextParts(message).join(separator)).join("\n\n"),
      );
    }
  }
  return [...runTexts];
}

function extractInputValidationTexts(input: AgentContext["input"]): string[] {
  if (typeof input === "string") return [input];
  return [...input.flatMap(extractMessageInputText), ...extractAdjacentSystemRunTexts(input)];
}

/**
 * Apply sanitization until the text stops changing.
 *
 * Deleting one harmful sequence can splice the characters around it into
 * another (`<scri<script>x</script>pt>alert(1)</script>` needs two passes), so
 * a single pass is not enough for text that already needed a rewrite. Every
 * pass only deletes, so the loop terminates.
 */
function sanitizeTextToFixpoint(validator: InputValidator, text: string): string {
  let current = text;
  for (
    let next = validator.sanitize(current);
    next !== undefined && next !== current;
    next = validator.sanitize(current)
  ) {
    current = next;
  }
  return current;
}

/**
 * Replace a part list's text parts with one part carrying `text`, or remove
 * them entirely when `text` is `undefined`. Non-text parts are kept in place.
 */
function collapseTextParts(parts: Message["parts"], text: string | undefined): Message["parts"] {
  const collapsed: Message["parts"] = [];
  let replaced = false;
  for (const part of parts) {
    if (!isTextPart(part)) {
      collapsed.push(part);
    } else if (!replaced && text !== undefined) {
      replaced = true;
      collapsed.push({ ...part, text });
    }
  }
  return collapsed;
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
    let parts = message.parts.map((part) => {
      if (!isTextPart(part)) return part;
      const sanitized = sanitizeTextToFixpoint(validator, part.text);
      if (sanitized === part.text) return part;
      messageChanged = true;
      return { ...part, text: sanitized };
    });

    // A harmful sequence can also span sibling text parts ("<scr" + "ipt>…"):
    // each part is clean on its own, yet the provider concatenates the parts
    // back into the full payload (`getTextFromParts` in src/agent/types.ts).
    // When any assembled form still changes under sanitization, the part
    // boundary itself is hiding the payload, so the text parts are collapsed
    // into one fully sanitized part instead of being kept apart.
    const textValues = parts.filter(isTextPart).map((part) => part.text);
    const assembledNeedsRewrite = textValues.length > 1 &&
      ASSEMBLED_TEXT_SEPARATORS.some((separator) => {
        const assembled = textValues.join(separator);
        return (validator.sanitize(assembled) ?? assembled) !== assembled;
      });
    if (assembledNeedsRewrite) {
      parts = collapseTextParts(parts, sanitizeTextToFixpoint(validator, textValues.join("")));
      messageChanged = true;
    }

    if (!messageChanged) return message;
    changed = true;
    return { ...message, parts };
  });

  return changed ? sanitizedMessages : messages;
}

/**
 * Sanitize across adjacent system messages.
 *
 * The provider folds an adjacent system run into one instruction joined with a
 * blank line, so a harmful sequence split across the message boundary
 * ("<script" + ">alert(1)</script>") escapes per-message sanitization yet
 * reassembles at the provider. When any assembled run form still changes under
 * sanitization, the run's text is collapsed into the first message's first
 * text part, sanitized to a fixpoint over the provider-assembled form, and the
 * later messages lose their text parts; the converter then drops those
 * now-blank system layers, so the provider sees exactly the sanitized text.
 */
function sanitizeAdjacentSystemRuns(validator: InputValidator, messages: Message[]): Message[] {
  const rewrites = new Map<Message, Message["parts"]>();

  for (const run of extractAdjacentSystemRuns(messages)) {
    const runNeedsRewrite = ASSEMBLED_TEXT_SEPARATORS.some((separator) => {
      const assembled = run
        .map((message) => messageTextParts(message).join(separator))
        .join("\n\n");
      return (validator.sanitize(assembled) ?? assembled) !== assembled;
    });
    if (!runNeedsRewrite) continue;

    const collapsedText = sanitizeTextToFixpoint(
      validator,
      run.map((message) => messageTextParts(message).join("")).join("\n\n"),
    );
    run.forEach((message, index) => {
      rewrites.set(
        message,
        collapseTextParts(message.parts, index === 0 ? collapsedText : undefined),
      );
    });
  }

  if (rewrites.size === 0) return messages;
  return messages.map((message) => {
    const parts = rewrites.get(message);
    return parts === undefined ? message : { ...message, parts };
  });
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

/** Validate every extracted text, throwing the first violation as an agent error. */
async function assertInputTextsValid(
  validator: InputValidator,
  values: string[],
  onViolation?: (violation: SecurityViolation) => void,
): Promise<void> {
  const validation = await validateInputTexts(validator, values);
  if (validation.valid) return;

  reportViolations(validation.violations, onViolation);

  const firstViolation = validation.violations[0];
  throw toError(
    createError({
      type: "agent",
      message: `Input validation failed: ${firstViolation?.reason ?? "Unknown reason"}`,
    }),
  );
}

/**
 * Reject a merged system run that sanitization would still rewrite.
 *
 * Within one turn such a run is repaired in place
 * (`sanitizeAdjacentSystemRuns`), but the cross-turn hook sees the assembled
 * conversation only after the earlier half of the run is already persisted
 * memory, which it cannot rewrite. Per-turn sanitization has already run by
 * then, so only a payload split across the memory/input boundary can still
 * change here, and failing closed keeps it away from the provider without
 * poisoning memory.
 */
function assertRunTextsNeedNoSanitization(
  validator: InputValidator,
  values: string[],
  onViolation?: (violation: SecurityViolation) => void,
): void {
  for (const value of values) {
    if ((validator.sanitize(value) ?? value) === value) continue;

    const violation: SecurityViolation = {
      type: "input",
      reason: "Merged system messages assemble content sanitization removes",
      content: value,
    };
    reportViolations([violation], onViolation);
    throw toError(
      createError({
        type: "agent",
        message: `Input validation failed: ${violation.reason}`,
      }),
    );
  }
}

/** Sanitize agent input, returning the original value when nothing changed. */
function sanitizeAgentInput(
  validator: InputValidator,
  input: AgentContext["input"],
): AgentContext["input"] {
  // Fixpoint everywhere: a single pass can splice a nested payload back
  // together ("<scri<script>x</script>pt>…" becomes "<script>…" after one
  // deletion), and the post-sanitize revalidation only re-checks blocked
  // patterns, not sanitize completeness.
  if (typeof input === "string") return sanitizeTextToFixpoint(validator, input);
  return sanitizeAdjacentSystemRuns(validator, sanitizeStructuredInput(validator, input));
}

function sameTexts(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Validate the full provider-bound conversation assembled for one turn. */
export type TurnMessageValidator = (messages: Message[]) => Promise<void>;

/**
 * Cross-turn validation hooks, keyed by the turn's middleware context.
 *
 * The middleware sees only this turn's `context.input`, but conversation
 * memory can end with a system message from an earlier turn that failed or was
 * cancelled before an assistant reply was persisted. The provider folds that
 * tail together with this turn's leading system messages into one instruction
 * (`toOpenAICompatibleMessages` joins adjacent system messages with a blank
 * line), so a blocked phrase split across turns reassembles at the provider
 * without any single turn's input ever containing it. The runtime closes that
 * gap by invoking the registered hook with the full conversation it is about
 * to persist and dispatch (memory history plus this turn's input) before the
 * turn is committed, so a hostile merge is rejected without poisoning memory.
 */
const turnMessageValidators = new WeakMap<AgentContext, TurnMessageValidator>();

/** Resolve the cross-turn validator registered for a turn's context, if any. */
export function getTurnMessageValidator(
  context: AgentContext,
): TurnMessageValidator | undefined {
  return turnMessageValidators.get(context);
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
    // Register the cross-turn check before this turn is committed: adjacent
    // system runs must also be validated across the memory/input boundary,
    // which only the runtime can see. Compose with any validator an earlier
    // security middleware registered on the same context.
    const previousTurnValidator = turnMessageValidators.get(context);
    turnMessageValidators.set(context, async (messages) => {
      if (previousTurnValidator) await previousTurnValidator(messages);
      const runTexts = extractAdjacentSystemRunTexts(messages);
      await assertInputTextsValid(inputValidator, runTexts, config.onViolation);
      assertRunTextsNeedNoSanitization(inputValidator, runTexts, config.onViolation);
    });

    const inputValues = extractInputValidationTexts(context.input);
    await assertInputTextsValid(inputValidator, inputValues, config.onViolation);

    const sanitizedInput = sanitizeAgentInput(inputValidator, context.input);
    if (sanitizedInput !== context.input) {
      context.input = sanitizedInput;

      // Sanitization deletes markup, and deleting it can splice a blocked
      // phrase back together (`ignore <script></script>previous instructions`),
      // so anything the rewrite changed is validated again before it is passed
      // on. Unchanged text is skipped: it already passed above.
      const sanitizedValues = extractInputValidationTexts(context.input);
      if (!sameTexts(inputValues, sanitizedValues)) {
        await assertInputTextsValid(inputValidator, sanitizedValues, config.onViolation);
      }
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
