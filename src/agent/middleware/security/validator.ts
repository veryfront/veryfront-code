import { privateTextTrim, privateTextTrimStart } from "#veryfront/security/private-text.ts";
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import {
  appendPrivateArray,
  concatPrivateArrays,
  everyPrivateArray,
  filterPrivateArray,
  findLastPrivateArrayIndex,
  flatMapPrivateArray,
  joinPrivateArray,
  mapPrivateArray,
  pushPrivateArray,
  somePrivateArray,
} from "#veryfront/security/private-array.ts";
import { isDeepStrictEqual } from "node:util";
import type {
  AgentContext,
  AgentResponse,
  AgentSystem,
  Message,
  MessagePart,
} from "#veryfront/agent/types.ts";
import { createError, toError } from "#veryfront/errors";
import { getOutputSchemaParser } from "#veryfront/agent/output-schema.ts";
import { propagateSyntheticMessageMarks } from "#veryfront/agent/runtime/input-utils.ts";
import {
  buildAttachmentContextFromParts,
  getAnthropicCompactedAssistantMessages,
  getProviderAttachmentMetadata,
  getProviderSendableAssistantMessages,
  getProviderSendableToolMessages,
  getUserTextWithAttachmentContext,
} from "#veryfront/agent/runtime/text-generation-runtime-message-converter.ts";
import {
  registerTurnInputValidator,
  registerTurnMessageProjectionValidator,
  registerTurnMessageValidator,
  registerTurnProviderRequestValidator,
} from "#veryfront/agent/middleware/turn-validation.ts";
import { isSummaryMemoryProjectionMessage } from "#veryfront/agent/memory/memory.ts";

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

const RegExpConstructor = RegExp;
const regexpExec = RegExp.prototype.exec;
const regexpReplace = RegExp.prototype[Symbol.replace];
const applyRegExp = Reflect.apply;

function replacePrivatePattern(input: string, pattern: RegExp, replacement: string): string {
  const matcher = new RegExpConstructor(pattern.source, pattern.flags);
  matcher.lastIndex = pattern.lastIndex;
  defineOwnDataProperty(matcher, "exec", regexpExec);
  return applyRegExp(regexpReplace, matcher, [input, replacement]) as string;
}

function testBlockedPattern(pattern: RegExp, input: string): boolean {
  return applyRegExp(regexpExec, freshStatefulPattern(pattern), [input]) !== null;
}

function freshStatefulPattern(pattern: RegExp): RegExp {
  if (!pattern.global && !pattern.sticky) return pattern;

  const matcher = new RegExpConstructor(pattern.source, pattern.flags);
  if (pattern.sticky) matcher.lastIndex = pattern.lastIndex;
  return matcher;
}

function advanceStringIndex(input: string, index: number, unicode: boolean): number {
  if (!unicode) return index + 1;
  return index + ((input.codePointAt(index) ?? 0) > 0xffff ? 2 : 1);
}

function redactBlockedPattern(input: string, pattern: RegExp): string {
  const matcher = freshStatefulPattern(pattern);
  if (!matcher.sticky) return replacePrivatePattern(input, matcher, "[REDACTED]");

  // replace() resets global sticky regexes to index 0, and Bun does not
  // currently honor lastIndex for non-global sticky replacements. Use exec and
  // splice matches so every supported runtime starts at the caller-configured
  // position without mutating the caller-owned pattern.
  let redacted = "";
  let cursor = 0;
  let matched = false;

  for (
    let match = applyRegExp(regexpExec, matcher, [input]) as RegExpExecArray | null;
    match;
    match = applyRegExp(regexpExec, matcher, [input]) as RegExpExecArray | null
  ) {
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
 * Options for {@link InputValidator.validate}.
 */
export interface InputValidationOptions {
  /**
   * Check `maxLength` against this text. Defaults to `true`.
   *
   * Pass `false` for a provider-assembled string: one message's joined text
   * parts, or a run of messages the provider merges into a single turn. Those
   * are synthetic concatenations built only to catch a blocked phrase split
   * across a boundary, not caller-supplied message text, and a merged run
   * grows with the conversation, so length-checking them would eventually
   * reject every turn on an agent configured with `maxLength`.
   */
  checkMaxLength?: boolean;

  /** Check the caller-defined validator. Defaults to `true`. */
  checkCustomValidation?: boolean;
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
  async validate(input: string, options?: InputValidationOptions): Promise<{
    valid: boolean;
    sanitized?: string;
    violations: SecurityViolation[];
  }> {
    const violations: SecurityViolation[] = [];

    const maxLength = options?.checkMaxLength === false ? undefined : this.config.maxLength;
    if (maxLength != null && input.length > maxLength) {
      pushPrivateArray(violations, {
        type: "input",
        reason: `Input exceeds maximum length of ${maxLength}`,
        content: `${input.substring(0, 100)}...`,
      });
    }

    for (const pattern of this.config.blockedPatterns ?? []) {
      // Blocked pattern groups are shared module-level objects reused across
      // requests. Test stateful patterns through a fresh matcher so lastIndex
      // cannot skip a repeat match and caller-owned patterns remain untouched.
      if (!testBlockedPattern(pattern, input)) continue;

      pushPrivateArray(violations, {
        type: "input",
        reason: "Input matches blocked pattern",
        content: input,
        pattern,
      });
    }

    const customValidate = options?.checkCustomValidation === false
      ? undefined
      : this.config.validate;
    if (customValidate) {
      const customValid = await customValidate(input);
      if (!customValid) {
        pushPrivateArray(violations, {
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
    let sanitized = input;
    for (let index = 0; index < InputValidator.SANITIZE_PATTERNS.length; index++) {
      sanitized = replacePrivatePattern(sanitized, InputValidator.SANITIZE_PATTERNS[index]!, "");
    }
    return sanitized;
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
      if (!testBlockedPattern(pattern, filtered)) continue;

      pushPrivateArray(violations, {
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
    let filtered = output;
    for (let index = 0; index < PII_REPLACEMENTS.length; index++) {
      const { pattern, label } = PII_REPLACEMENTS[index]!;
      filtered = replacePrivatePattern(filtered, pattern, label);
    }
    return filtered;
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
    const filteredItems: unknown[] = [];
    const violations: SecurityViolation[] = [];
    for (const item of value) {
      const result = await filterStructuredOutputValue(item, outputFilter);
      pushPrivateArray(filteredItems, result.value);
      appendPrivateArray(violations, result.violations);
    }
    return { value: filteredItems, violations };
  }

  if (isRecord(value)) {
    const filteredObject: Record<string, unknown> = {};
    const violations: SecurityViolation[] = [];
    for (const [key, item] of Object.entries(value)) {
      const result = await filterStructuredOutputValue(item, outputFilter);
      filteredObject[key] = result.value;
      appendPrivateArray(violations, result.violations);
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
  if (typeof part.inputText === "string") pushPrivateArray(values, part.inputText);
  const appendSerialized = (value: unknown) => {
    if (!isRecord(value)) return;
    try {
      const serialized = JSON.stringify(value);
      if (typeof serialized === "string") pushPrivateArray(values, serialized);
    } catch {
      // Provider converters ignore non-text input on caller-authored user and
      // system messages. Unsupported JSON values must not fail the turn here.
    }
  };
  appendSerialized(part.args);
  appendSerialized(part.input);
  return values;
}

/**
 * Roles whose text is caller-authored instruction and must be validated.
 *
 * `system` belongs here: structured input accepts caller-supplied system
 * messages and the runtime converter forwards them to the provider as system
 * prompts, so they carry more authority than user text, not less. Assistant and
 * tool messages remain exempt for replay compatibility. The host must supply
 * trusted replay: this role-based filter does not authenticate message origin.
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

/**
 * Texts extracted from agent input, split by what they are.
 *
 * `texts` are caller-supplied values (a text part, a tool call's arguments) and
 * get the full check, `maxLength` included. `assembled` are the synthetic
 * concatenations the provider converters produce from several of those values;
 * they exist to catch a blocked phrase split across a part or message boundary,
 * so they are pattern-checked but never length-checked. See
 * {@link InputValidationOptions.checkMaxLength}.
 */
interface InputValidationTexts {
  texts: string[];
  assembled: string[];
}

function extractMessageInputText(message: Message): string[] {
  if (!VALIDATED_INPUT_ROLES.has(message.role)) return [];
  return extractMessageInputTextRegardlessOfRole(message);
}

function extractMessageInputTextRegardlessOfRole(message: Message): string[] {
  return flatMapPrivateArray(message.parts, extractPartInputText);
}

/** The assembled forms of one message's text parts, if it has more than one. */
function extractMessageAssembledTexts(message: Message): string[] {
  if (!VALIDATED_INPUT_ROLES.has(message.role)) return [];
  return extractMessageAssembledTextsRegardlessOfRole(message);
}

function extractMessageAssembledTextsRegardlessOfRole(message: Message): string[] {
  // A single text part already equals every assembled form, so only add the
  // joined variants when the parts could actually hide a split phrase.
  const textParts = messageTextParts(message);
  const attachmentMetadata = message.role === "user"
    ? getProviderAttachmentMetadata(message.parts)
    : [];
  if (textParts.length < 2) {
    return [
      ...(message.role === "user" && buildAttachmentContextFromParts(message.parts)
        ? textParts
        : []),
      ...attachmentMetadata,
    ];
  }

  const assembled = [
    ...mapPrivateArray(
      ASSEMBLED_TEXT_SEPARATORS,
      (separator) => joinPrivateArray(textParts, separator),
    ),
    ...attachmentMetadata,
  ];
  if (message.role === "user" && buildAttachmentContextFromParts(message.parts)) {
    pushPrivateArray(assembled, getUserTextWithAttachmentContext(message.parts));
  }
  return assembled;
}

/**
 * Runs of adjacent same-role messages a provider converter merges into one turn.
 *
 * For `system`, `toOpenAICompatibleMessages` (src/provider/runtime-loader.ts)
 * folds adjacent system messages into one instruction joined with a blank
 * line, after `convertToTextGenerationRuntimeMessage` has already assembled
 * each message's parts (`getTextFromParts` concatenates with no separator;
 * other adapters use a blank line). For `user`, `pushAnthropicUserContent`
 * (extensions/ext-llm-anthropic/src/anthropic-request-builder.ts) appends a
 * user message's content blocks onto the preceding user message, so adjacent
 * user messages reach Anthropic as one turn whose text blocks sit back to
 * back. Either way a blocked phrase split across the message boundary
 * reassembles at the provider, so each run is validated in every assembled
 * form the converters can produce. A truly empty message does not end a run:
 * the converter drops it outright, leaving the messages on either side adjacent.
 *
 * A `tool` message does not end a *user* run. Anthropic has no tool role: a
 * tool result is a `tool_result` block inside a user turn, so the builder
 * either appends it to the run's user turn or, when no pending `tool_use` id
 * matches it (the shape a caller can supply directly, since nothing precedes
 * it that could have opened one), drops it entirely and leaves the two user
 * messages' text blocks back to back. Either way it never emits a turn that
 * separates them. That follows from the Anthropic message format rather than
 * from converter internals, and it costs no false positives: a tool result
 * with a matching id can only follow the assistant `tool_use` that opened it,
 * and that assistant message does end the run.
 *
 * An assistant message the runtime converter drops does not end a *user* run
 * either. `convertToTextGenerationRuntimeMessages`
 * (src/agent/runtime/text-generation-runtime-message-converter.ts) skips an
 * assistant message with no provider-sendable content (empty `parts`, only an
 * empty-string text part, or only reasoning/file parts), so the user messages
 * on either side of it arrive adjacent at the request builder and
 * `pushAnthropicUserContent` merges them. The exported
 * conversation-level sendability helper is reused rather than reimplemented
 * so provider call-ID state cannot drift apart.
 *
 * A system message is transparent to a user run because Anthropic hoists it
 * out of the message list before merging adjacent user blocks. Messages of
 * other roles end the run. For *system* runs that stays true even for a
 * message the converter would drop, because the hoisted run in
 * `extractMergedSystemRuns` already assembles every system message in the
 * conversation, so any pair a dropped message sits between is covered there.
 */
function extractAdjacentRuns(
  messages: Message[],
  role: Message["role"],
  dropWhitespaceOnly = false,
): Message[][] {
  const runs: Message[][] = [];
  let run: Message[] = [];
  const sendableAssistantMessages = role === "user" || role === "system"
    ? getProviderSendableAssistantMessages(messages)
    : undefined;
  const sendableToolMessages = role === "system"
    ? getProviderSendableToolMessages(messages)
    : undefined;
  const anthropicCompactedAssistantMessages = role === "user"
    ? getAnthropicCompactedAssistantMessages(messages)
    : undefined;

  const flushRun = () => {
    // Runs of a single message are already covered by the per-message
    // extraction, including its own assembled forms.
    if (run.length > 1) pushPrivateArray(runs, run);
    run = [];
  };

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex]!;
    if (message.role !== role) {
      if (role === "user" && message.role === "tool") continue;
      if (role === "user" && message.role === "system") continue;
      if (role === "system" && message.role === "tool" && !sendableToolMessages?.has(message)) {
        continue;
      }
      if (
        message.role === "assistant" &&
        (!sendableAssistantMessages?.has(message) ||
          role === "user" && anthropicCompactedAssistantMessages?.has(message))
      ) continue;
      flushRun();
      continue;
    }
    if (isEmptyText(message)) continue;
    if (
      dropWhitespaceOnly &&
      privateTextTrim(joinPrivateArray(messageTextParts(message), "")).length === 0
    ) {
      continue;
    }
    pushPrivateArray(run, message);
  }
  flushRun();

  return runs;
}

function messageTextParts(message: Message, includeAttachments = true): string[] {
  const texts = mapPrivateArray(filterPrivateArray(message.parts, isTextPart), (part) => part.text);
  const attachmentContext = includeAttachments && message.role === "user"
    ? privateTextTrimStart(buildAttachmentContextFromParts(message.parts))
    : "";
  if (attachmentContext) pushPrivateArray(texts, attachmentContext);
  return texts;
}

function isEmptyText(message: Message): boolean {
  return joinPrivateArray(messageTextParts(message), "").length === 0;
}

/**
 * Every grouping of system messages a provider converter can merge into one
 * instruction.
 *
 * `toOpenAICompatibleMessages` folds only *adjacent* system messages
 * (`extractAdjacentRuns` mirrors that walk), but the Anthropic request
 * builder (extensions/ext-llm-anthropic/src/anthropic-request-builder.ts)
 * hoists every system message in the prompt into `systemParts` and joins them
 * all with a blank line into one system string, and the Google request builder
 * (extensions/ext-llm-google/src/google-request-builder.ts) likewise collects
 * every system message into a single `systemInstruction`, regardless of the
 * user, assistant, or tool turns between them. A blocked phrase split across
 * system messages that a surviving turn keeps apart on OpenAI-compatible
 * providers therefore still reassembles on those providers, so the full
 * hoisted sequence is validated and sanitized alongside each adjacent run. The
 * hoisted run comes last so a sanitization rewrite of it supersedes any
 * per-run rewrite of its member messages.
 */
function extractMergedSystemRuns(messages: Message[]): Message[][] {
  const runs = extractAdjacentRuns(messages, "system");
  // OpenAI-compatible conversion drops whitespace-only system messages before
  // merging the remaining adjacent system layers. Anthropic retains those
  // layers, so keep the original runs above and validate this alternate view
  // in addition.
  for (const run of extractAdjacentRuns(messages, "system", true)) {
    const alreadyCovered = somePrivateArray(runs, (candidate) =>
      candidate.length === run.length &&
      everyPrivateArray(candidate, (message, index) => message === run[index]));
    if (!alreadyCovered) pushPrivateArray(runs, run);
  }

  // Anthropic retains whitespace-only system layers and joins each layer with
  // a blank line. It drops only system layers whose assembled text is empty.
  const hoisted = filterPrivateArray(
    messages,
    (message) => message.role === "system" && !isEmptyText(message),
  );
  // A single system message is covered by the per-message extraction.
  if (hoisted.length < 2) return runs;

  const alreadyCovered = somePrivateArray(runs, (run) =>
    run.length === hoisted.length &&
    everyPrivateArray(run, (message, index) => message === hoisted[index]));
  return alreadyCovered ? runs : [...runs, hoisted];
}

/**
 * Every grouping of caller-authored messages a provider converter can merge
 * into one turn: the system runs above, plus each run of adjacent user
 * messages, which `pushAnthropicUserContent` concatenates into a single user
 * turn.
 */
function extractMergedRuns(messages: Message[]): Message[][] {
  return [...extractMergedSystemRuns(messages), ...extractAdjacentRuns(messages, "user")];
}

function sameProviderMessageContent(previous: Message, projected: Message): boolean {
  return previous.role === projected.role && isDeepStrictEqual(previous.parts, projected.parts);
}

function createMessageOccurrenceMatcher(previousMessages: Message[], messages: Message[]) {
  const uniqueById = (values: Message[]): Map<string, Message | undefined> => {
    const unique = new Map<string, Message | undefined>();
    for (const message of values) {
      unique.set(message.id, unique.has(message.id) ? undefined : message);
    }
    return unique;
  };
  const previousById = uniqueById(previousMessages);
  const projectedById = uniqueById(messages);
  const sameOccurrence = (previous: Message, projected: Message | undefined): boolean => {
    if (previous === projected) return true;
    if (!projected || !previous.id || previous.id !== projected.id) return false;
    // Custom transactional memory can deserialize each read. Stable IDs plus
    // provider content equality recover provenance only when neither snapshot
    // contains an ambiguous duplicate occurrence.
    return previousById.get(previous.id) === previous &&
      projectedById.get(projected.id) === projected &&
      sameProviderMessageContent(previous, projected);
  };
  return sameOccurrence;
}

/**
 * Assemble every merged run into the forms the provider can produce.
 *
 * `mustInclude`, when given, keeps only runs with at least one member in it.
 * The cross-turn hook passes this turn's input so a run lying entirely inside
 * already-persisted history is skipped: the middleware cannot rewrite history,
 * so rejecting a turn over a run this turn does not contribute to would reject
 * every later turn on that conversation forever, with no remediation path
 * through the `Memory` interface. Such a run is not left unchecked either, it
 * was validated on the turn that wrote its last member, unless it predates the
 * middleware or was written directly through `memory.add`.
 * `mustAlsoInclude` applies the same requirement to a second ownership set,
 * which lets provider-request validation select only assemblies containing
 * both a trusted runtime layer and a caller-supplied system message.
 */
function extractMergedRunTexts(
  messages: Message[],
  mustInclude?: ReadonlySet<Message>,
  mustAlsoInclude?: ReadonlySet<Message>,
  previousMessages?: Message[],
): string[] {
  const previousRuns = previousMessages && extractMergedRuns(previousMessages);
  const sameOccurrence = previousMessages
    ? createMessageOccurrenceMatcher(previousMessages, messages)
    : undefined;
  const runTexts = createPrivateSet<string>();
  for (const run of extractMergedRuns(messages)) {
    // Only an identical grouping keeps its provenance. Comparing text alone
    // would also exempt a newly joined boundary that happens to duplicate a
    // different historical run, or a run shortened by trimming.
    if (
      previousRuns !== undefined &&
      somePrivateArray(previousRuns, (previous) =>
        previous.length === run.length &&
        everyPrivateArray(previous, (message, index) => sameOccurrence?.(message, run[index])))
    ) continue;
    if (mustInclude && !somePrivateArray(run, (message) => mustInclude.has(message))) continue;
    if (mustAlsoInclude && !somePrivateArray(run, (message) => mustAlsoInclude.has(message))) {
      continue;
    }
    for (const partSeparator of ASSEMBLED_TEXT_SEPARATORS) {
      // The OpenAI-compatible converter and the Anthropic builder join system
      // run members with a blank line, but the Google builder sends each
      // system message as its own `systemInstruction` part and Gemini's
      // server-side part concatenation separator is unspecified, as is
      // Anthropic's between the text blocks of a merged user turn, so the bare
      // concatenation of the run is assembled as well.
      for (const runSeparator of ASSEMBLED_TEXT_SEPARATORS) {
        runTexts.add(
          joinPrivateArray(
            mapPrivateArray(
              run,
              (message) => joinPrivateArray(messageTextParts(message), partSeparator),
            ),
            runSeparator,
          ),
        );
      }
    }
  }
  return [...runTexts];
}

function providerSystemMessages(system: AgentSystem): Message[] {
  const layers = typeof system === "string"
    ? [{ role: "system" as const, content: system }]
    : system;
  return mapPrivateArray(layers, (layer, index) => ({
    id: `provider-system-${index}`,
    role: "system",
    parts: [{ type: "text", text: layer.content }],
  }));
}

function extractInputValidationTexts(input: AgentContext["input"]): InputValidationTexts {
  if (typeof input === "string") return { texts: [input], assembled: [] };
  return {
    texts: flatMapPrivateArray(input, extractMessageInputText),
    assembled: [
      ...flatMapPrivateArray(input, extractMessageAssembledTexts),
      ...extractMergedRunTexts(input),
    ],
  };
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
      pushPrivateArray(collapsed, part);
    } else if (!replaced && text !== undefined) {
      replaced = true;
      pushPrivateArray(collapsed, copySanitizedTextPart(part, text));
    }
  }
  return collapsed;
}

function copySanitizedTextPart(part: MessagePart, text: string): MessagePart {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(part);
    descriptors.type = { value: "text", enumerable: true, configurable: true, writable: true };
    descriptors.text = { value: text, enumerable: true, configurable: true, writable: true };
    return Object.create(Object.prototype, descriptors);
  } catch {
    // Text conversion requires only type and text. A Proxy can deny descriptor
    // enumeration while still exposing those structural fields.
    return { type: "text", text };
  }
}

/**
 * Sanitize caller text while preserving structured roles and message ids.
 */
function sanitizeStructuredInput(validator: InputValidator, messages: Message[]): Message[] {
  let changed = false;

  const sanitizedMessages = mapPrivateArray(messages, (message) => {
    if (!VALIDATED_INPUT_ROLES.has(message.role)) return message;

    let messageChanged = false;
    let parts = mapPrivateArray(message.parts, (part) => {
      if (!isTextPart(part)) return part;
      const sanitized = sanitizeTextToFixpoint(validator, part.text);
      if (sanitized === part.text) return part;
      messageChanged = true;
      return copySanitizedTextPart(part, sanitized);
    });

    // A harmful sequence can also span sibling text parts ("<scr" + "ipt>…"):
    // each part is clean on its own, yet the provider concatenates the parts
    // back into the full payload (`getTextFromParts` in src/agent/types.ts).
    // When any assembled form still changes under sanitization, the part
    // boundary itself is hiding the payload, so the text parts are collapsed
    // into one fully sanitized part instead of being kept apart.
    const textValues = mapPrivateArray(filterPrivateArray(parts, isTextPart), (part) => part.text);
    const assembledNeedsRewrite = textValues.length > 1 &&
      somePrivateArray(ASSEMBLED_TEXT_SEPARATORS, (separator) => {
        const assembled = joinPrivateArray(textValues, separator);
        return (validator.sanitize(assembled) ?? assembled) !== assembled;
      });
    if (assembledNeedsRewrite) {
      parts = collapseTextParts(
        parts,
        sanitizeTextToFixpoint(validator, joinPrivateArray(textValues, "")),
      );
      messageChanged = true;
    }

    if (!messageChanged) return message;
    changed = true;
    const rewritten = { ...message, parts };
    propagateSyntheticMessageMarks(message, rewritten);
    return rewritten;
  });

  return changed ? sanitizedMessages : messages;
}

/**
 * Sanitize across messages the provider merges into one turn.
 *
 * The provider folds a merged system run into one instruction joined with a
 * blank line (adjacent runs on OpenAI-compatible providers; every system
 * message in the prompt on Anthropic and Google, see
 * `extractMergedSystemRuns`) and concatenates adjacent user messages into one
 * Anthropic user turn, so a harmful sequence split across the message boundary
 * ("<script" + ">alert(1)</script>") escapes per-message sanitization yet
 * reassembles at the provider. When any assembled run form still changes under
 * sanitization, the run's text is collapsed into the first message's first
 * text part, sanitized to a fixpoint over the provider-assembled form, and the
 * later messages lose their text parts; the converter then drops those
 * now-blank layers, so the provider sees exactly the sanitized text. The
 * hoisted system run is processed last among the system runs, so when it needs
 * a rewrite its collapse supersedes any per-run rewrite of the same messages.
 *
 * Collapsing relocates text: when the hoisted run spans system messages that
 * user or assistant turns sit between, the sanitized instruction ends up at the
 * position of the first of them. On OpenAI-compatible providers, which merge
 * only adjacent system messages, that moves later caller instructions ahead of
 * the turns they followed. Sanitization already rewrites caller text by
 * definition, and this only happens for input a rewrite was required for
 * (`sanitize: true`), so correctness is preserved at the cost of position.
 * A user run can span system messages that Anthropic hoists, so sanitizing a
 * harmful run can move later user text ahead of those instructions. This only
 * occurs for caller text that already required a security rewrite.
 */
function sanitizeMergedRuns(validator: InputValidator, messages: Message[]): Message[] {
  const rewrites = new Map<Message, Message["parts"]>();

  for (const run of extractMergedRuns(messages)) {
    // The run-level join is "\n\n" on OpenAI-compatible providers and the
    // Anthropic builder, but the Google builder ships each system message as
    // a separate `systemInstruction` part whose server-side concatenation
    // separator is unspecified, as is Anthropic's between the text blocks of a
    // merged user turn, so the bare concatenation must trigger a rewrite too.
    let unsafeAssembly: string | undefined;
    for (const partSeparator of ASSEMBLED_TEXT_SEPARATORS) {
      for (const runSeparator of ASSEMBLED_TEXT_SEPARATORS) {
        const assembled = joinPrivateArray(
          mapPrivateArray(
            run,
            (message) => joinPrivateArray(messageTextParts(message, false), partSeparator),
          ),
          runSeparator,
        );
        if ((validator.sanitize(assembled) ?? assembled) !== assembled) {
          unsafeAssembly = assembled;
          break;
        }
      }
      if (unsafeAssembly !== undefined) break;
    }
    if (unsafeAssembly === undefined) continue;

    // Keep the triggering assembly: introducing a newline before sanitizing
    // can hide a script body from a pattern whose dot does not span lines.
    const collapsedText = sanitizeTextToFixpoint(validator, unsafeAssembly);
    run.forEach((message, index) => {
      rewrites.set(
        message,
        collapseTextParts(message.parts, index === 0 ? collapsedText : undefined),
      );
    });
  }

  if (rewrites.size === 0) return messages;
  return mapPrivateArray(messages, (message) => {
    const parts = rewrites.get(message);
    if (parts === undefined) return message;
    const rewritten = { ...message, parts };
    propagateSyntheticMessageMarks(message, rewritten);
    return rewritten;
  });
}

async function validateInputTexts(
  validator: InputValidator,
  values: InputValidationTexts,
  options?: InputValidationOptions,
): Promise<{ valid: boolean; violations: SecurityViolation[] }> {
  const results = await Promise.all([
    ...mapPrivateArray(values.texts, (value) => validator.validate(value, options)),
    ...mapPrivateArray(
      values.assembled,
      (value) =>
        validator.validate(value, {
          ...options,
          checkMaxLength: false,
          checkCustomValidation: false,
        }),
    ),
  ]);
  return {
    valid: everyPrivateArray(results, (result) => result.valid),
    violations: flatMapPrivateArray(results, (result) => result.violations),
  };
}

/** Validate every extracted text, throwing the first violation as an agent error. */
async function assertInputTextsValid(
  validator: InputValidator,
  values: InputValidationTexts,
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

interface ProviderValidationRun {
  text: string;
  trustedSegments: Array<{ start: number; text: string }>;
}

/** Classify a negative body without changing its capture numbering. */
function negativeAssertionBody(
  pattern: RegExp,
  start: number,
): {
  body: string;
  end: number;
  context: boolean;
  backrefs: boolean;
  nested: boolean;
  nestedNegative: boolean;
} | undefined {
  const source = pattern.source;
  const prefixLength = source.startsWith("(?!", start)
    ? 3
    : source.startsWith("(?<!", start)
    ? 4
    : 0;
  if (prefixLength === 0) return undefined;
  let context = false;
  let backrefs = false;
  let nested = false;
  let nestedNegative = false;
  let groupDepth = 1;
  let classDepth = 0;
  for (let index = start + prefixLength; index < source.length; index++) {
    const character = source[index];
    if (character === "\\") {
      const escaped = source[++index];
      if (classDepth === 0 && (escaped === "b" || escaped === "B")) context = true;
      if (classDepth === 0 && escaped && /[1-9k]/.test(escaped)) backrefs = true;
      continue;
    }
    if (character === "[" && (classDepth === 0 || pattern.unicodeSets)) {
      classDepth++;
      continue;
    }
    if (character === "]" && classDepth > 0) {
      classDepth--;
      continue;
    }
    if (classDepth > 0) continue;
    if (character === "^" || character === "$") context = true;
    if (character === "(") {
      if (
        source.startsWith("(?=", index) || source.startsWith("(?!", index) ||
        source.startsWith("(?<=", index) || source.startsWith("(?<!", index)
      ) nested = true;
      if (source.startsWith("(?!", index) || source.startsWith("(?<!", index)) {
        nestedNegative = true;
      }
      groupDepth++;
    } else if (character === ")" && --groupDepth === 0) {
      return {
        body: source.slice(start + prefixLength, index),
        end: index,
        context,
        backrefs,
        nested,
        nestedNegative,
      };
    }
  }
  return undefined;
}

/** Conservative inspection bound; unbounded quantifiers and backreferences use the guarded path. */
function assertionInspectionWidth(source: string, unicodeSets: boolean): number {
  let width = source.length;
  let classDepth = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === "\\") {
      const escaped = source[++index];
      if (classDepth === 0 && escaped && /[1-9k]/.test(escaped)) return Infinity;
      continue;
    }
    if (character === "[" && (classDepth === 0 || unicodeSets)) classDepth++;
    else if (character === "]" && classDepth > 0) classDepth--;
    else if (classDepth === 0) {
      if (character === "*" || character === "+") return Infinity;
      if (character === "{") {
        const quantifier = /^\{(\d+)(?:,(\d*))?\}/.exec(source.slice(index));
        if (quantifier) {
          if (quantifier[2] === "") return Infinity;
          width *= Math.max(1, Number(quantifier[2] ?? quantifier[1]));
          if (!Number.isSafeInteger(width)) return Infinity;
          index += quantifier[0].length - 1;
        }
      }
    }
  }
  return width;
}

/** Prove an assembly match also has a path using unchanged trusted context. */
function createTrustedMatchPredicate(
  pattern: RegExp,
  segment: { start: number; text: string },
  assembled: string,
): (match: { index: number; text: string }) => boolean {
  const unicode = pattern.unicode || pattern.unicodeSets;
  const splitsCodePoint = (offset: number) =>
    assembled.charCodeAt(offset - 1) >= 0xd800 && assembled.charCodeAt(offset - 1) <= 0xdbff &&
    assembled.charCodeAt(offset) >= 0xdc00 && assembled.charCodeAt(offset) <= 0xdfff;
  // Joining lone surrogates changes Unicode matching even without assertions.
  if (
    unicode &&
    (splitsCodePoint(segment.start) || splitsCodePoint(segment.start + segment.text.length))
  ) {
    return () => false;
  }
  const units = (text: string) => unicode ? [...text].length : text.length;
  const lower = units(assembled.slice(0, segment.start));
  const upper = lower + units(segment.text);
  const lowerGuard = "(?<=[\\s\\S]{" + lower + "})";
  const upperGuard = "(?<![\\s\\S]{" + (upper + 1) + "})";
  const atPosition = (position: number) =>
    "(?<=[\\s\\S]{" + position + "})(?<![\\s\\S]{" + (position + 1) + "})";
  const excludePosition = (position: number) =>
    "(?!(?<=[\\s\\S]{" + position + "})(?<![\\s\\S]{" + (position + 1) + "}))";
  let ignoreCase = pattern.ignoreCase;
  const isWord = (character: string | undefined) =>
    character !== undefined &&
    new RegExp(
      "\\w",
      (pattern.unicodeSets ? "v" : pattern.unicode ? "u" : "") + (ignoreCase ? "i" : ""),
    )
      .test(character);
  const localNegativeBody = (body: string): string => {
    let result = "";
    let depth = 0;
    let localIgnoreCase = ignoreCase;
    const cases: Array<{ ignoreCase: boolean; assertion?: "ahead" | "behind" }> = [];
    const word = (character: string | undefined) =>
      character !== undefined &&
      new RegExp(
        "\\w",
        (pattern.unicodeSets ? "v" : pattern.unicode ? "u" : "") + (localIgnoreCase ? "i" : ""),
      ).test(character);
    for (let index = 0; index < body.length; index++) {
      const character = body[index];
      if (character === "\\") {
        const escaped = body[++index];
        if (depth === 0 && (escaped === "b" || escaped === "B")) {
          const choices = [character + escaped + excludePosition(lower) + excludePosition(upper)];
          if (word(segment.text[0]) === (escaped === "b")) {
            pushPrivateArray(choices, atPosition(lower));
          }
          if (word(segment.text.at(-1)) === (escaped === "b")) {
            pushPrivateArray(choices, atPosition(upper));
          }
          result += "(?:" + joinPrivateArray(choices, "|") + ")";
        } else result += character + escaped;
        continue;
      }
      if (character === "[" && (depth === 0 || pattern.unicodeSets)) depth++;
      else if (character === "]" && depth > 0) depth--;
      else if (depth === 0) {
        if (character === "^" || character === "$") {
          result += "(?:" + character + "|" + atPosition(character === "^" ? lower : upper) + ")";
          continue;
        }
        if (character === "(") {
          const assertion = /^\(\?(<?)=/.exec(body.slice(index));
          if (assertion) {
            const direction = assertion[1] ? "behind" : "ahead";
            pushPrivateArray(cases, { ignoreCase: localIgnoreCase, assertion: direction });
            result += assertion[0] + (direction === "behind" ? lowerGuard : "") + "(?:";
            index += assertion[0].length - 1;
            continue;
          }
          pushPrivateArray(cases, { ignoreCase: localIgnoreCase });
          const named = /^\(\?<[^>]+>/.exec(body.slice(index));
          if (body[index + 1] !== "?" || named) {
            result += "(?:";
            if (named) index += named[0].length - 1;
            continue;
          }
          const flags = /^\(\?([ims]*)(?:-([ims]+))?:/.exec(body.slice(index));
          if (flags?.[1]?.includes("i")) localIgnoreCase = true;
          if (flags?.[2]?.includes("i")) localIgnoreCase = false;
        } else if (character === ")") {
          const group = cases.pop();
          localIgnoreCase = group?.ignoreCase ?? ignoreCase;
          if (group?.assertion) {
            result += ")" + (group.assertion === "ahead" ? upperGuard : "") + ")";
            continue;
          }
        }
      }
      result += character;
    }
    return result;
  };
  const groups: Array<
    { kind: "ahead" | "behind" | "ordinary"; ignoreCase: boolean; bodyStart?: number }
  > = [];
  let inspectionRadius = 0;
  let fastPath = true;
  let source = "";
  let classDepth = 0;
  for (let index = 0; index < pattern.source.length; index++) {
    const character = pattern.source[index];
    if (character === "\\") {
      const escaped = pattern.source[++index];
      source += character + escaped;
      if (classDepth === 0 && (escaped === "b" || escaped === "B")) {
        inspectionRadius = Math.max(inspectionRadius, 1);
        // Only assertions at a segment edge can see different word context.
        const boundary = escaped === "b";
        if (isWord(segment.text[0]) !== boundary) source += excludePosition(lower);
        if (isWord(segment.text.at(-1)) !== boundary) source += excludePosition(upper);
      }
      continue;
    }
    if (character === "[" && (classDepth === 0 || pattern.unicodeSets)) {
      classDepth++;
      source += character;
      continue;
    }
    if (character === "]" && classDepth > 0) {
      classDepth--;
      source += character;
      continue;
    }
    if (classDepth > 0) {
      source += character;
      continue;
    }
    if (character === "(") {
      const negative = negativeAssertionBody(pattern, index);
      if (negative) {
        const original = pattern.source.slice(index, negative.end + 1);
        if (
          negative.nestedNegative || ((negative.nested || negative.context) && negative.backrefs)
        ) {
          // Double negation can turn this into a positive assertion whose
          // alternatives select different trusted and caller-dependent paths.
          // Keep that unproven case closed rather than comparing truth alone.
          source += "(?:(?!)" + original + ")";
          fastPath = false;
        } else if (!negative.context && !negative.nested) {
          source += original;
        } else {
          const body = localNegativeBody(negative.body);
          const local = original.startsWith("(?!")
            ? "(?!(?:" + body + ")" + upperGuard + ")"
            : "(?<!" + lowerGuard + "(?:" + body + "))";
          source += "(?:" + original + local + ")";
          inspectionRadius = Math.max(
            inspectionRadius,
            assertionInspectionWidth(negative.body, pattern.unicodeSets) * (unicode ? 2 : 1),
          );
        }
        index = negative.end;
        continue;
      }
      if (pattern.source.startsWith("(?=", index)) {
        pushPrivateArray(groups, { kind: "ahead", ignoreCase, bodyStart: index + 3 });
        source += "(?=(?:";
        index += 2;
        continue;
      }
      if (pattern.source.startsWith("(?<=", index)) {
        pushPrivateArray(groups, { kind: "behind", ignoreCase, bodyStart: index + 4 });
        source += "(?<=" + lowerGuard + "(?:";
        index += 3;
        continue;
      }
      pushPrivateArray(groups, { kind: "ordinary", ignoreCase });
      const modifiers = /^\(\?([ims]*)(?:-([ims]+))?:/.exec(pattern.source.slice(index));
      if (modifiers?.[1]?.includes("i")) ignoreCase = true;
      if (modifiers?.[2]?.includes("i")) ignoreCase = false;
    } else if (character === ")") {
      const group = groups.pop();
      if (!group) return () => false;
      ignoreCase = group.ignoreCase;
      if (group.bodyStart !== undefined) {
        inspectionRadius = Math.max(
          inspectionRadius,
          assertionInspectionWidth(
            pattern.source.slice(group.bodyStart, index),
            pattern.unicodeSets,
          ) * (unicode ? 2 : 1),
        );
      }
      if (group.kind === "ahead") {
        source += ")" + upperGuard + ")";
        continue;
      }
      if (group.kind === "behind") {
        source += "))";
        continue;
      }
    }
    source += character;
  }
  try {
    // Guard positive assertions' consumed context without adding captures or
    // changing backreference numbers. Contextual negative assertions also
    // check a capture-free body against the trusted segment's own boundaries.
    const matcher = new RegExp(source, pattern.flags.replace(/[gy]/g, "") + "y");
    return (match) => {
      // Interior matches cannot inspect caller text. Avoid prefix scans for
      // each occurrence in long trusted prompts with many boundary matches.
      if (
        fastPath && match.index >= inspectionRadius &&
        match.index + match.text.length + inspectionRadius <= segment.text.length
      ) return true;
      matcher.lastIndex = segment.start + match.index;
      const found = matcher.exec(assembled);
      return found?.index === segment.start + match.index && found[0] === match.text;
    };
  } catch {
    return () => false;
  }
}

/** Reject assembly matches outside unchanged runtime or historical segments. */
async function assertProviderRunsValid(
  validator: InputValidator,
  providerRuns: ProviderValidationRun[],
  onViolation?: (violation: SecurityViolation) => void,
): Promise<void> {
  if (providerRuns.length === 0) return;
  const patternOnly = { checkCustomValidation: false } as const;
  const introducedViolations: SecurityViolation[] = [];
  for (const { text, trustedSegments } of providerRuns) {
    const validation = await validator.validate(text, { ...patternOnly, checkMaxLength: false });
    for (const violation of validation.violations) {
      const pattern = violation.pattern;
      if (pattern === undefined) {
        pushPrivateArray(introducedViolations, violation);
        continue;
      }
      const trustedMatches = flatMapPrivateArray(
        trustedSegments,
        (segment) =>
          mapPrivateArray(
            filterPrivateArray(
              patternOccurrences(segment.text, pattern),
              createTrustedMatchPredicate(pattern, segment, text),
            ),
            (match) => ({
              index: segment.start + match.index,
              text: match.text,
            }),
          ),
      );
      const introduced = somePrivateArray(
        patternOccurrences(text, pattern),
        (match) =>
          !somePrivateArray(
            trustedMatches,
            (trusted) => trusted.index === match.index && trusted.text === match.text,
          ),
      );
      if (introduced) pushPrivateArray(introducedViolations, violation);
    }
  }
  if (introducedViolations.length > 0) {
    reportViolations(introducedViolations, onViolation);
    throw toError(
      createError({
        type: "agent",
        message: `Input validation failed: ${introducedViolations[0]?.reason ?? "Unknown reason"}`,
      }),
    );
  }

  for (const { text, trustedSegments } of providerRuns) {
    let expected = "";
    let cursor = 0;
    for (const segment of trustedSegments) {
      expected += text.slice(cursor, segment.start) +
        (validator.sanitize(segment.text) ?? segment.text);
      cursor = segment.start + segment.text.length;
    }
    expected += text.slice(cursor);
    if ((validator.sanitize(text) ?? text) === expected) continue;
    const violation: SecurityViolation = {
      type: "input",
      reason: "Provider-visible system instructions contain content sanitization removes",
      content: text,
    };
    reportViolations([violation], onViolation);
    throw toError(
      createError({ type: "agent", message: `Input validation failed: ${violation.reason}` }),
    );
  }
}

function patternOccurrences(input: string, pattern: RegExp): { index: number; text: string }[] {
  const matcher = new RegExp(pattern.source, pattern.global ? pattern.flags : `${pattern.flags}g`);
  if (pattern.sticky) matcher.lastIndex = pattern.lastIndex;
  const matches: { index: number; text: string }[] = [];
  for (
    let match = applyRegExp(regexpExec, matcher, [input]) as RegExpExecArray | null;
    match;
    match = applyRegExp(regexpExec, matcher, [input]) as RegExpExecArray | null
  ) {
    pushPrivateArray(matches, { index: match.index, text: match[0] });
    if (match[0].length === 0) {
      matcher.lastIndex = advanceStringIndex(
        input,
        matcher.lastIndex,
        matcher.unicode || matcher.unicodeSets,
      );
    }
  }
  return matches;
}

/**
 * Reject a merged run that sanitization would still rewrite.
 *
 * Within one turn such a run is repaired in place (`sanitizeMergedRuns`),
 * but the cross-turn hook sees the assembled
 * conversation only after the earlier half of the run is already persisted
 * memory, which it cannot rewrite. Per-turn sanitization has already run by
 * then, so only a payload split across the memory/input boundary can still
 * change here, and failing closed keeps it away from the provider without
 * poisoning memory.
 *
 * Failing closed is bounded to runs this turn contributes to: the cross-turn
 * caller filters out runs lying entirely inside history (see
 * `extractMergedRunTexts`), so history seeded before the middleware was
 * enabled, written directly through `memory.add`, or rewritten by summary
 * compaction cannot reject every later turn on the conversation with no way
 * to recover.
 */
function assertTextsNeedNoSanitization(
  validator: InputValidator,
  values: string[],
  reason: string,
  onViolation?: (violation: SecurityViolation) => void,
): void {
  for (const value of values) {
    if ((validator.sanitize(value) ?? value) === value) continue;

    const violation: SecurityViolation = {
      type: "input",
      reason,
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
  return sanitizeMergedRuns(validator, sanitizeStructuredInput(validator, input));
}

function sameTexts(left: InputValidationTexts, right: InputValidationTexts): boolean {
  const sameList = (a: string[], b: string[]) =>
    a.length === b.length && everyPrivateArray(a, (value, index) => value === b[index]);
  return sameList(left.texts, right.texts) && sameList(left.assembled, right.assembled);
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
    if (config.input) {
      const onProviderViolation = (violation: SecurityViolation): void => {
        config.onViolation?.({ ...violation, content: "[REDACTED]" });
      };
      // Register the cross-turn check before this turn is committed: merged
      // system runs and adjacent user runs must also be validated across the
      // memory/input boundary, which only the runtime can see. Only runs this
      // turn contributes a message to are checked; a run lying entirely inside
      // already-persisted history cannot be rewritten here, so rejecting over it
      // would brick the conversation on every later turn (`extractMergedRunTexts`).
      registerTurnProviderRequestValidator(context, async (providerSystem, messages) => {
        const systemMessages = providerSystemMessages(providerSystem);
        const pendingCurrent = typeof context.input === "string"
          ? []
          : filterPrivateArray(context.input, (message) => message.role === "system");
        // Separate occurrences even when a memory adapter returns the same
        // object twice. Current inputs are appended after historical messages.
        const callerMessages = mapPrivateArray(
          messages,
          (message) =>
            message.role === "system"
              ? { id: message.id, role: message.role, parts: message.parts }
              : message,
        );
        const currentSystemMessages = createPrivateSet<Message>();
        for (let index = messages.length - 1; index >= 0; index--) {
          const message = messages[index]!;
          if (message.role !== "system") continue;
          const current = findLastPrivateArrayIndex(
            pendingCurrent,
            (input) =>
              input === message || input.id === message.id && isDeepStrictEqual(input, message),
          );
          if (current < 0) continue;
          pendingCurrent.splice(current, 1);
          currentSystemMessages.add(callerMessages[index]!);
        }
        const callerSystemMessages = filterPrivateArray(
          callerMessages,
          (message) => message.role === "system",
        );
        const trusted = createPrivateSet(systemMessages);
        const callers = createPrivateSet(callerSystemMessages);
        const providerRuns: ProviderValidationRun[] = [];
        for (
          const run of extractMergedSystemRuns(concatPrivateArrays(systemMessages, callerMessages))
        ) {
          if (
            !somePrivateArray(run, (message) => trusted.has(message)) ||
            !somePrivateArray(run, (message) => callers.has(message))
          ) continue;
          // Runtime and historical text have separate exemptions. A new match
          // across their boundary must still be checked when the runtime changes.
          for (const partSeparator of ASSEMBLED_TEXT_SEPARATORS) {
            for (const runSeparator of ASSEMBLED_TEXT_SEPARATORS) {
              const assembled: ProviderValidationRun = { text: "", trustedSegments: [] };
              let previousKind: "runtime" | "history" | "current" | undefined;
              for (const [index, message] of run.entries()) {
                if (index > 0) assembled.text += runSeparator;
                const start = assembled.text.length;
                const text = joinPrivateArray(messageTextParts(message), partSeparator);
                assembled.text += text;
                const kind = trusted.has(message)
                  ? "runtime"
                  : currentSystemMessages.has(message)
                  ? "current"
                  : "history";
                if (kind !== "current") {
                  const previous = assembled.trustedSegments.at(-1);
                  if (previous && kind === previousKind) previous.text += runSeparator + text;
                  else pushPrivateArray(assembled.trustedSegments, { start, text });
                }
                previousKind = kind;
              }
              pushPrivateArray(providerRuns, assembled);
            }
          }
        }
        await assertProviderRunsValid(
          inputValidator,
          providerRuns,
          onProviderViolation,
        );
      });
      registerTurnMessageValidator(context, async (history, turnInput) => {
        const individualValues = history.length === 0
          ? {
            texts: flatMapPrivateArray(
              filterPrivateArray(
                turnInput,
                (message) => !isSummaryMemoryProjectionMessage(message),
              ),
              extractMessageInputText,
            ),
            assembled: [
              ...flatMapPrivateArray(
                filterPrivateArray(turnInput, isSummaryMemoryProjectionMessage),
                extractMessageInputText,
              ),
              ...flatMapPrivateArray(turnInput, extractMessageAssembledTexts),
            ],
          }
          : { texts: [], assembled: [] };
        const runTexts = extractMergedRunTexts(
          concatPrivateArrays(history, turnInput),
          createPrivateSet(turnInput),
        );
        // Merged runs are synthetic assemblies, so they are pattern-checked but
        // never length-checked (`InputValidationOptions.checkMaxLength`).
        await assertInputTextsValid(
          inputValidator,
          {
            texts: individualValues.texts,
            assembled: [...individualValues.assembled, ...runTexts],
          },
          onProviderViolation,
        );
        assertTextsNeedNoSanitization(
          inputValidator,
          [...individualValues.texts, ...individualValues.assembled, ...runTexts],
          "Provider-visible messages contain content sanitization removes",
          onProviderViolation,
        );
      });
      registerTurnMessageProjectionValidator(context, async (messages, previousMessages) => {
        // Consume occurrences, rather than IDs, so duplicate IDs and freshly
        // deserialized messages retain their individual validation provenance.
        const remainingPrevious = previousMessages?.slice() ?? [];
        const changed = filterPrivateArray(messages, (message) => {
          const index = remainingPrevious.findIndex((previous) =>
            previous.id === message.id && sameProviderMessageContent(previous, message)
          );
          if (index < 0) return true;
          remainingPrevious.splice(index, 1);
          return false;
        });
        const texts = flatMapPrivateArray(
          filterPrivateArray(changed, (message) => !isSummaryMemoryProjectionMessage(message)),
          extractMessageInputText,
        );
        const assembled = [
          ...flatMapPrivateArray(
            filterPrivateArray(changed, isSummaryMemoryProjectionMessage),
            extractMessageInputText,
          ),
          ...flatMapPrivateArray(changed, extractMessageAssembledTexts),
        ];
        const runTexts = extractMergedRunTexts(
          messages,
          undefined,
          undefined,
          previousMessages,
        );
        await assertInputTextsValid(
          inputValidator,
          { texts, assembled: [...assembled, ...runTexts] },
          onProviderViolation,
        );
        assertTextsNeedNoSanitization(
          inputValidator,
          [...texts, ...assembled, ...runTexts],
          "Provider-visible messages contain content sanitization removes",
          onProviderViolation,
        );
      });

      const inputValues = extractInputValidationTexts(context.input);
      await assertInputTextsValid(inputValidator, inputValues, config.onViolation);

      // Generated annotations cannot be rewritten as caller text without losing
      // attachment identity or moving content between messages. Reject unsafe
      // annotations before any text rewrite instead.
      if (typeof context.input !== "string") {
        assertTextsNeedNoSanitization(
          inputValidator,
          flatMapPrivateArray(
            filterPrivateArray(context.input, (message) => message.role === "user"),
            (
              message,
            ) => [
              buildAttachmentContextFromParts(message.parts),
              ...getProviderAttachmentMetadata(message.parts),
            ],
          ),
          "Attachment annotations contain content sanitization removes",
          config.onViolation,
        );
      }

      let approvedInputTexts = inputValues;
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
        approvedInputTexts = sanitizedValues;
      }
      const approvedMessages = typeof context.input === "string"
        ? undefined
        : mapPrivateArray(context.input, (message) => ({ id: message.id, role: message.role }));

      // A middleware later in the chain can still replace `context.input` or
      // mutate a message in place after this middleware approved it, and the
      // runtime persists and dispatches that resolved value. Register a hook the
      // runtime invokes with the resolved input before committing the turn:
      // texts identical to what was approved here are skipped, anything else is
      // validated from scratch and must need no sanitization, which can no
      // longer rewrite it at that point.
      registerTurnInputValidator(context, async (messages) => {
        const resolvedTexts = extractInputValidationTexts(messages);
        const sameMessageIdentity = approvedMessages !== undefined &&
          approvedMessages.length === messages.length &&
          everyPrivateArray(
            approvedMessages,
            (message, index) => message.id === messages[index]?.id,
          );
        const roleRewriteCandidates = approvedMessages === undefined
          ? filterPrivateArray(messages, (message) => !VALIDATED_INPUT_ROLES.has(message.role))
          : filterPrivateArray(
            messages,
            (message, index) =>
              !VALIDATED_INPUT_ROLES.has(message.role) &&
              (!sameMessageIdentity || VALIDATED_INPUT_ROLES.has(approvedMessages[index]!.role)),
          );
        const rewrittenRoleTexts: InputValidationTexts = {
          texts: flatMapPrivateArray(
            roleRewriteCandidates,
            extractMessageInputTextRegardlessOfRole,
          ),
          assembled: flatMapPrivateArray(
            roleRewriteCandidates,
            extractMessageAssembledTextsRegardlessOfRole,
          ),
        };
        const completeResolvedTexts: InputValidationTexts = {
          texts: [...resolvedTexts.texts, ...rewrittenRoleTexts.texts],
          assembled: [...resolvedTexts.assembled, ...rewrittenRoleTexts.assembled],
        };
        if (sameTexts(completeResolvedTexts, approvedInputTexts)) return;
        await assertInputTextsValid(inputValidator, completeResolvedTexts, config.onViolation);
        assertTextsNeedNoSanitization(
          inputValidator,
          [...completeResolvedTexts.texts, ...completeResolvedTexts.assembled],
          "Middleware-rewritten input contains content sanitization removes",
          config.onViolation,
        );
      });
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
