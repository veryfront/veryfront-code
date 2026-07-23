import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { Prompt, PromptArgument, PromptRenderContext } from "./types.ts";

export const MAX_PROMPT_ID_LENGTH = 128;
export const MAX_PROMPT_DESCRIPTION_LENGTH = 4_096;
export const MAX_PROMPT_SUGGESTION_LENGTH = 4_096;
export const MAX_PROMPT_ARGUMENT_DESCRIPTION_LENGTH = 4_096;
export const MAX_PROMPT_CONTENT_BYTES = 1_048_576;
export const MAX_PROMPT_VARIABLES = 128;
export const MAX_PROMPT_VARIABLE_KEY_LENGTH = 128;
export const MAX_PROMPT_PLACEHOLDERS = 1_024;

const MAX_PROMPT_CONTENT_CODE_UNITS = MAX_PROMPT_CONTENT_BYTES;
const BIDI_CONTROL_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const PROMPT_PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_]+)\}/g;
const textEncoder = new TextEncoder();
const promptSnapshots = new WeakMap<object, Prompt>();
const validatedPromptDefinitions = new WeakSet<object>();
const EMPTY_PROMPT_VARIABLES = Object.freeze({}) as Readonly<Record<string, unknown>>;
const EMPTY_PROMPT_RENDER_CONTEXT = Object.freeze({}) as PromptRenderContext;

function invalidPrompt(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function hasUnsafeControlCharacters(value: string, allowFormattingWhitespace: boolean): boolean {
  if (BIDI_CONTROL_PATTERN.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 127) return true;
    if (
      code < 32 &&
      !(allowFormattingWhitespace && (code === 9 || code === 10 || code === 13))
    ) {
      return true;
    }
  }
  return false;
}

function hasVisibleText(value: string): boolean {
  return value.trim().length > 0;
}

export function isSafePromptIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= MAX_PROMPT_ID_LENGTH && value.trim() === value &&
    !hasUnsafeControlCharacters(value, false);
}

export function isSafePromptVariableName(value: string): boolean {
  return value.length > 0 && value.length <= MAX_PROMPT_VARIABLE_KEY_LENGTH &&
    /^[A-Za-z0-9_]+$/.test(value);
}

export function isSafePromptText(value: string, maximumLength: number): boolean {
  return value.length <= maximumLength && hasVisibleText(value) &&
    !hasUnsafeControlCharacters(value, true);
}

export function isSafePromptContent(value: string): boolean {
  return hasVisibleText(value) && !hasUnsafeControlCharacters(value, true) &&
    promptContentByteLength(value) <= MAX_PROMPT_CONTENT_BYTES;
}

export interface PromptTemplatePlaceholder {
  readonly index: number;
  readonly key: string;
  readonly source: string;
}

export interface PromptTemplateAnalysis {
  readonly exceedsPlaceholderLimit: boolean;
  readonly placeholders: readonly PromptTemplatePlaceholder[];
  readonly placeholderNames: readonly string[];
}

/** Analyze bounded static-template placeholders without evaluating caller values. */
export function analyzePromptTemplate(content: string): PromptTemplateAnalysis {
  const placeholders: PromptTemplatePlaceholder[] = [];
  const placeholderNames: string[] = [];
  const knownNames = new Set<string>();

  for (const match of content.matchAll(PROMPT_PLACEHOLDER_PATTERN)) {
    if (placeholders.length >= MAX_PROMPT_PLACEHOLDERS) {
      return Object.freeze({
        exceedsPlaceholderLimit: true,
        placeholders: Object.freeze(placeholders),
        placeholderNames: Object.freeze(placeholderNames),
      });
    }
    const index = match.index;
    const source = match[0];
    const key = match[1];
    if (index === undefined || source === undefined || key === undefined) continue;
    if (key.length > MAX_PROMPT_VARIABLE_KEY_LENGTH) continue;
    placeholders.push(Object.freeze({ index, key, source }));
    if (!knownNames.has(key)) {
      knownNames.add(key);
      placeholderNames.push(key);
    }
  }

  return Object.freeze({
    exceedsPlaceholderLimit: false,
    placeholders: Object.freeze(placeholders),
    placeholderNames: Object.freeze(placeholderNames),
  });
}

export function assertPromptId(value: unknown, label = "Prompt id"): string {
  if (typeof value !== "string" || !isSafePromptIdentifier(value)) {
    invalidPrompt(
      `${label} must be a non-empty string of at most ${MAX_PROMPT_ID_LENGTH} characters without unsafe control characters`,
    );
  }
  return value;
}

export function assertPromptText(
  value: unknown,
  label: string,
  maximumLength: number,
  optional = false,
): string | undefined {
  if (optional && value === undefined) return undefined;
  if (typeof value !== "string" || !isSafePromptText(value, maximumLength)) {
    invalidPrompt(
      `${label} must contain visible text within the supported length and without unsafe control characters`,
    );
  }
  return value;
}

function promptContentByteLength(value: string): number {
  if (value.length > MAX_PROMPT_CONTENT_CODE_UNITS) return MAX_PROMPT_CONTENT_BYTES + 1;
  return textEncoder.encode(value).byteLength;
}

export function assertPromptContent(value: unknown, source: string): string {
  if (typeof value !== "string" || !isSafePromptContent(value)) {
    invalidPrompt(
      `${source} must be visible text no larger than ${MAX_PROMPT_CONTENT_BYTES} bytes without unsafe control characters`,
    );
  }
  return value;
}

function safeOwnKeys(value: object, label: string): readonly PropertyKey[] {
  try {
    return Reflect.ownKeys(value);
  } catch {
    invalidPrompt(`${label} properties must be readable`);
  }
}

function safeRead(value: object, key: PropertyKey, label: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    invalidPrompt(`${label} properties must be readable`);
  }
}

function validateVariableValue(value: unknown): void {
  if (value === null || value === undefined || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    invalidPrompt("Prompt variable numbers must be finite");
  }
  if (typeof value === "bigint") return;
  if (typeof value === "string") {
    if (
      !hasUnsafeControlCharacters(value, true) &&
      promptContentByteLength(value) <= MAX_PROMPT_CONTENT_BYTES
    ) {
      return;
    }
    invalidPrompt("Prompt variable strings exceed the supported text boundary");
  }
  invalidPrompt(
    "Prompt variables must be strings, finite numbers, booleans, bigints, null, or undefined",
  );
}

export function snapshotPromptVariables(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (value === undefined) return EMPTY_PROMPT_VARIABLES;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalidPrompt("Prompt variables must be an object");
  }

  const keys = safeOwnKeys(value, "Prompt variables");
  if (keys.length > MAX_PROMPT_VARIABLES) {
    invalidPrompt(`Prompt variables must contain at most ${MAX_PROMPT_VARIABLES} entries`);
  }

  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    if (
      typeof key !== "string" || key.length === 0 ||
      key.length > MAX_PROMPT_VARIABLE_KEY_LENGTH ||
      hasUnsafeControlCharacters(key, false)
    ) {
      invalidPrompt("Prompt variable names must be bounded strings without control characters");
    }
    const variableValue = safeRead(value, key, "Prompt variables");
    validateVariableValue(variableValue);
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: variableValue,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

export function snapshotPromptArguments(
  value: unknown,
  inferredNames?: readonly string[],
): PromptArgument[] | undefined {
  if (value === undefined) {
    if (!inferredNames || inferredNames.length === 0) return undefined;
    return Object.freeze(
      inferredNames.map((name) => Object.freeze({ name, required: false })),
    ) as PromptArgument[];
  }
  if (!Array.isArray(value)) {
    invalidPrompt("Prompt arguments must be an array");
  }
  if (value.length > MAX_PROMPT_VARIABLES) {
    invalidPrompt(`Prompt arguments must contain at most ${MAX_PROMPT_VARIABLES} entries`);
  }

  const names = new Set<string>();
  const snapshot = value.map((argument): PromptArgument => {
    if (argument === null || typeof argument !== "object" || Array.isArray(argument)) {
      invalidPrompt("Prompt argument definitions must be objects");
    }
    const keys = safeOwnKeys(argument, "Prompt argument definition");
    for (const key of keys) {
      if (key !== "name" && key !== "description" && key !== "required") {
        invalidPrompt("Prompt argument definition contains an unsupported property");
      }
    }
    const name = safeRead(argument, "name", "Prompt argument definition");
    if (typeof name !== "string" || !isSafePromptVariableName(name)) {
      invalidPrompt("Prompt argument name must match a template variable name");
    }
    if (names.has(name)) invalidPrompt("Prompt argument names must be unique");
    names.add(name);
    const description = assertPromptText(
      safeRead(argument, "description", "Prompt argument definition"),
      "Prompt argument description",
      MAX_PROMPT_ARGUMENT_DESCRIPTION_LENGTH,
      true,
    );
    const required = safeRead(argument, "required", "Prompt argument definition");
    if (required !== undefined && typeof required !== "boolean") {
      invalidPrompt("Prompt argument required must be a boolean");
    }
    return Object.freeze({
      name,
      ...(description === undefined ? {} : { description }),
      required: required ?? false,
    });
  });

  if (
    inferredNames &&
    (inferredNames.length !== names.size || inferredNames.some((name) => !names.has(name)))
  ) {
    invalidPrompt("Prompt argument definitions must match the static template placeholders");
  }
  return Object.freeze(snapshot) as PromptArgument[];
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (value === null || typeof value !== "object") return false;
  try {
    return typeof Reflect.get(value, "aborted") === "boolean" &&
      typeof Reflect.get(value, "addEventListener") === "function" &&
      typeof Reflect.get(value, "removeEventListener") === "function";
  } catch {
    return false;
  }
}

function snapshotPromptRenderContext(value: unknown): PromptRenderContext {
  if (value === undefined) return EMPTY_PROMPT_RENDER_CONTEXT;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalidPrompt("Prompt render context must be an object");
  }
  const keys = safeOwnKeys(value, "Prompt render context");
  for (const key of keys) {
    if (key !== "signal") {
      invalidPrompt("Prompt render context contains an unsupported property");
    }
  }
  const signal = keys.includes("signal")
    ? safeRead(value, "signal", "Prompt render context")
    : undefined;
  if (signal !== undefined && !isAbortSignal(signal)) {
    invalidPrompt("Prompt render signal must be an AbortSignal");
  }
  return signal === undefined ? EMPTY_PROMPT_RENDER_CONTEXT : Object.freeze({ signal });
}

function throwIfPromptAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Prompt rendering was aborted", "AbortError");
  }
}

/** Validate and freeze a prompt definition at a registry boundary. */
export function snapshotPromptDefinition(value: unknown, expectedId?: string): Prompt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalidPrompt("Prompt definition must be an object");
  }

  const expected = expectedId === undefined ? undefined : assertPromptId(expectedId);
  if (validatedPromptDefinitions.has(value)) {
    const prompt = value as Prompt;
    if (expected !== undefined && prompt.id !== expected) {
      invalidPrompt("Prompt registry id must match the prompt definition id");
    }
    return prompt;
  }

  const cached = promptSnapshots.get(value);
  if (cached) {
    if (expected !== undefined && cached.id !== expected) {
      invalidPrompt("Prompt registry id must match the prompt definition id");
    }
    return cached;
  }

  const id = assertPromptId(safeRead(value, "id", "Prompt definition"));
  if (expected !== undefined && id !== expected) {
    invalidPrompt("Prompt registry id must match the prompt definition id");
  }
  const description = assertPromptText(
    safeRead(value, "description", "Prompt definition"),
    "Prompt description",
    MAX_PROMPT_DESCRIPTION_LENGTH,
  ) as string;
  const suggestion = assertPromptText(
    safeRead(value, "suggestion", "Prompt definition"),
    "Prompt suggestion",
    MAX_PROMPT_SUGGESTION_LENGTH,
    true,
  );
  const argumentsList = snapshotPromptArguments(
    safeRead(value, "arguments", "Prompt definition"),
  );
  const getContent = safeRead(value, "getContent", "Prompt definition");
  if (typeof getContent !== "function") {
    invalidPrompt("Prompt getContent must be a function");
  }

  const snapshot: Prompt = Object.freeze({
    id,
    description,
    ...(suggestion === undefined ? {} : { suggestion }),
    ...(argumentsList === undefined ? {} : { arguments: argumentsList }),
    async getContent(
      variables?: Record<string, unknown>,
      context?: PromptRenderContext,
    ): Promise<string> {
      const variableSnapshot = snapshotPromptVariables(variables);
      const contextSnapshot = snapshotPromptRenderContext(context);
      throwIfPromptAborted(contextSnapshot.signal);
      for (const argument of argumentsList ?? []) {
        if (
          argument.required &&
          (!Object.hasOwn(variableSnapshot, argument.name) ||
            variableSnapshot[argument.name] == null)
        ) {
          invalidPrompt(`Required prompt argument "${argument.name}" is missing`);
        }
      }
      const output = await Reflect.apply(getContent, snapshot, [
        variableSnapshot,
        contextSnapshot,
      ]);
      throwIfPromptAborted(contextSnapshot.signal);
      return assertPromptContent(output, `Prompt "${id}" content`);
    },
  });
  promptSnapshots.set(value, snapshot);
  validatedPromptDefinitions.add(snapshot);
  return snapshot;
}
