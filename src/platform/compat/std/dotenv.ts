/**
 * Bounded, cross-runtime dotenv parsing and loading.
 *
 * The parser intentionally fails closed on malformed assignments. This keeps
 * configuration behavior identical across Deno, Node.js, and Bun and avoids
 * silently starting a service with only part of its intended configuration.
 *
 * @module
 */

import { deleteEnv, getHostEnv, setEnv } from "../process/env.ts";
import { getDenoRuntime, isBun, isNode } from "../runtime.ts";
import {
  MAX_ENV_FILE_CHARACTERS,
  MAX_ENV_FILE_LINES,
  MAX_ENV_FILE_VARIABLES,
  MAX_ENV_KEY_CHARACTERS,
  MAX_ENV_VALUE_CHARACTERS,
} from "./dotenv-limits.ts";

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BLOCKED_ENV_KEYS = new Set(["__proto__"]);
const MAX_INTERPOLATION_DEPTH = 32;
const MAX_EXPANDED_ENV_CHARACTERS = 4 * MAX_ENV_FILE_CHARACTERS;

interface ParsedValue {
  value: string;
  interpolate: boolean;
  line: number;
}

/** Options for {@link load}. */
export interface LoadOptions {
  /**
   * Path to the dotenv file. Pass `null` to disable file loading.
   *
   * @default ".env"
   */
  envPath?: string | URL | null;
  /** Export values that are not already present in the host environment. */
  export?: boolean;
  /**
   * Empty values are always retained. Kept for source compatibility with the
   * previous shim.
   *
   * @deprecated Empty values no longer require an option.
   */
  allowEmptyValues?: boolean;
  /**
   * Retained only so callers of the former shim continue to type-check.
   *
   * @deprecated The current dotenv contract does not load example files.
   */
  examplePath?: string | URL | null;
  /**
   * Retained only so callers of the former shim continue to type-check.
   *
   * @deprecated The current dotenv contract does not load defaults files.
   */
  defaultsPath?: string | URL | null;
}

/**
 * Parse dotenv content into a null-prototype record.
 *
 * Unquoted values support `$KEY`, `${KEY}`, and `${KEY:-default}`
 * interpolation. Single- and double-quoted values are not interpolated;
 * double-quoted `\n`, `\r`, and `\t` escapes are expanded.
 */
export function parse(content: string): Record<string, string> {
  if (typeof content !== "string") {
    throw new TypeError("Dotenv content must be a string");
  }
  if (content.includes("\0")) {
    throw new SyntaxError("Dotenv content must not contain null bytes");
  }
  if (content.length > MAX_ENV_FILE_CHARACTERS) {
    throw new RangeError(
      `Dotenv file exceeds ${MAX_ENV_FILE_CHARACTERS} characters`,
    );
  }

  const lines = content.split("\n");
  if (lines.length > MAX_ENV_FILE_LINES) {
    throw new RangeError(`Dotenv file exceeds ${MAX_ENV_FILE_LINES} lines`);
  }

  const parsed = new Map<string, ParsedValue>();
  let assignmentCount = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const physicalLine = stripCarriageReturn(lines[lineIndex] ?? "");
    let statement = physicalLine.trimStart();
    if (statement.length === 0 || statement.startsWith("#")) continue;

    if (/^export[ \t]+/.test(statement)) {
      statement = statement.replace(/^export[ \t]+/, "");
    }

    const equalsIndex = statement.indexOf("=");
    if (equalsIndex === -1) {
      throw syntaxError("Expected an environment assignment", lineIndex + 1);
    }

    assignmentCount++;
    if (assignmentCount > MAX_ENV_FILE_VARIABLES) {
      throw new RangeError(
        `Dotenv file exceeds ${MAX_ENV_FILE_VARIABLES} assignments`,
      );
    }

    const key = statement.slice(0, equalsIndex).trim();
    validateKey(key, lineIndex + 1);

    const valueSource = statement.slice(equalsIndex + 1).trimStart();
    const quote = valueSource[0];
    if (quote === `"` || quote === `'`) {
      const assignmentLine = lineIndex + 1;
      const quoted = parseQuotedValue(
        lines,
        lineIndex,
        valueSource.slice(1),
        quote,
      );
      lineIndex = quoted.endLineIndex;
      parsed.set(key, {
        value: quote === `"` ? expandDoubleQuotedCharacters(quoted.value) : quoted.value,
        interpolate: false,
        line: assignmentLine,
      });
      continue;
    }

    const commentIndex = valueSource.indexOf("#");
    const value = (commentIndex === -1 ? valueSource : valueSource.slice(0, commentIndex)).trim();
    requireValueLength(value.length);
    parsed.set(key, {
      value,
      interpolate: true,
      line: lineIndex + 1,
    });
  }

  return resolveParsedValues(parsed);
}

/**
 * Load and parse a dotenv file.
 *
 * Missing files produce an empty null-prototype record. Other I/O and parsing
 * failures are propagated.
 */
export async function load(
  options: LoadOptions = {},
): Promise<Record<string, string>> {
  const envPath = options.envPath === undefined ? ".env" : options.envPath;
  const result = envPath === null || envPath === ""
    ? createEnvRecord()
    : parse(await readEnvFile(envPath) ?? "");

  if (options.export === true) {
    exportMissingValues(result);
  }

  return result;
}

function parseQuotedValue(
  lines: string[],
  startLineIndex: number,
  firstLine: string,
  quote: `"` | `'`,
): { value: string; endLineIndex: number } {
  const parts: string[] = [];
  let valueLength = 0;

  for (let lineIndex = startLineIndex; lineIndex < lines.length; lineIndex++) {
    const line = lineIndex === startLineIndex
      ? firstLine
      : stripCarriageReturn(lines[lineIndex] ?? "");
    const closing = findClosingQuote(line, quote);

    if (closing.index !== -1) {
      if (lineIndex !== startLineIndex) append("\n");
      append(line.slice(0, closing.index));
      return { value: parts.join(""), endLineIndex: lineIndex };
    }

    if (closing.sawQuote) {
      throw syntaxError(
        "Unexpected content after a quoted environment value",
        lineIndex + 1,
      );
    }
    if (lineIndex !== startLineIndex) append("\n");
    append(line);
  }

  throw syntaxError(
    "Unterminated quoted environment value",
    startLineIndex + 1,
  );

  function append(part: string): void {
    valueLength += part.length;
    requireValueLength(valueLength);
    parts.push(part);
  }
}

function findClosingQuote(
  line: string,
  quote: `"` | `'`,
): { index: number; sawQuote: boolean } {
  let sawQuote = false;

  for (let index = 0; index < line.length; index++) {
    if (line[index] !== quote || isEscaped(line, index)) continue;
    sawQuote = true;

    const trailing = line.slice(index + 1).trimStart();
    if (trailing.length === 0 || trailing.startsWith("#")) {
      return { index, sawQuote };
    }
  }

  return { index: -1, sawQuote };
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

function expandDoubleQuotedCharacters(value: string): string {
  return value.replace(/\\([nrt\\])/g, (_match, character: string) => {
    if (character === "n") return "\n";
    if (character === "r") return "\r";
    if (character === "\\") return "\\";
    return "\t";
  });
}

function resolveParsedValues(
  parsed: ReadonlyMap<string, ParsedValue>,
): Record<string, string> {
  const result = createEnvRecord();
  const resolved = new Map<string, string>();
  const resolving: string[] = [];
  let expandedCharacters = 0;

  for (const key of parsed.keys()) {
    result[key] = resolveLocalValue(key, 0);
  }
  return result;

  function resolveLocalValue(key: string, depth: number): string {
    const cached = resolved.get(key);
    if (cached !== undefined) return cached;

    const cycleIndex = resolving.indexOf(key);
    if (cycleIndex !== -1) {
      const cycle = [...resolving.slice(cycleIndex), key].join(" -> ");
      throw new Error(`Circular dotenv interpolation: ${cycle}`);
    }
    if (depth > MAX_INTERPOLATION_DEPTH) {
      throw new RangeError(
        `Dotenv interpolation exceeds ${MAX_INTERPOLATION_DEPTH} levels`,
      );
    }

    const entry = parsed.get(key);
    if (!entry) {
      throw new Error(`Missing parsed dotenv value for ${key}`);
    }

    resolving.push(key);
    try {
      const value = entry.interpolate
        ? expandValue(entry.value, entry.line, depth + 1, resolveVariable)
        : entry.value;
      requireValueLength(value.length);
      expandedCharacters += value.length;
      if (expandedCharacters > MAX_EXPANDED_ENV_CHARACTERS) {
        throw new RangeError(
          `Expanded dotenv output exceeds ${MAX_EXPANDED_ENV_CHARACTERS} characters`,
        );
      }
      resolved.set(key, value);
      return value;
    } finally {
      resolving.pop();
    }
  }

  function resolveVariable(key: string, depth: number): string | undefined {
    if (parsed.has(key)) return resolveLocalValue(key, depth);
    return getHostEnv(key);
  }
}

function expandValue(
  source: string,
  line: number,
  depth: number,
  resolve: (key: string, depth: number) => string | undefined,
): string {
  if (depth > MAX_INTERPOLATION_DEPTH) {
    throw new RangeError(
      `Dotenv interpolation exceeds ${MAX_INTERPOLATION_DEPTH} levels`,
    );
  }

  const parts: string[] = [];
  let outputLength = 0;
  let literalStart = 0;

  for (let index = 0; index < source.length;) {
    if (source[index] !== "$" || isEscaped(source, index)) {
      index++;
      continue;
    }

    append(source.slice(literalStart, index));

    if (source[index + 1] === "{") {
      const closingIndex = findInterpolationEnd(source, index + 1, line);
      const expression = source.slice(index + 2, closingIndex);
      const { key, defaultValue } = parseInterpolationExpression(expression, line);
      const resolvedValue = resolve(key, depth);
      append(
        resolvedValue ??
          (defaultValue === undefined ? "" : expandValue(defaultValue, line, depth + 1, resolve)),
      );
      index = closingIndex + 1;
      literalStart = index;
      continue;
    }

    const keyStart = index + 1;
    if (!isEnvKeyStart(source[keyStart])) {
      append("$");
      index++;
      literalStart = index;
      continue;
    }

    let keyEnd = keyStart + 1;
    while (keyEnd < source.length && isEnvKeyCharacter(source[keyEnd])) keyEnd++;
    const key = source.slice(keyStart, keyEnd);
    append(resolve(key, depth) ?? "");
    index = keyEnd;
    literalStart = index;
  }

  append(source.slice(literalStart));
  return parts.join("");

  function append(part: string): void {
    outputLength += part.length;
    requireValueLength(outputLength);
    parts.push(part);
  }
}

function findInterpolationEnd(source: string, openingBrace: number, line: number): number {
  let depth = 1;

  for (let index = openingBrace + 1; index < source.length; index++) {
    if (source[index] === "$" && source[index + 1] === "{") {
      depth++;
      index++;
      continue;
    }
    if (source[index] !== "}") continue;
    depth--;
    if (depth === 0) return index;
  }

  throw syntaxError("Unterminated dotenv interpolation", line);
}

function parseInterpolationExpression(
  expression: string,
  line: number,
): { key: string; defaultValue?: string } {
  let nestedDepth = 0;
  let defaultIndex = -1;

  for (let index = 0; index < expression.length - 1; index++) {
    if (expression[index] === "$" && expression[index + 1] === "{") {
      nestedDepth++;
      index++;
      continue;
    }
    if (expression[index] === "}" && nestedDepth > 0) {
      nestedDepth--;
      continue;
    }
    if (
      nestedDepth === 0 &&
      expression[index] === ":" &&
      expression[index + 1] === "-"
    ) {
      defaultIndex = index;
      break;
    }
  }

  const key = (defaultIndex === -1 ? expression : expression.slice(0, defaultIndex)).trim();
  validateKey(key, line);
  return defaultIndex === -1 ? { key } : { key, defaultValue: expression.slice(defaultIndex + 2) };
}

function validateKey(key: string, line: number): void {
  if (BLOCKED_ENV_KEYS.has(key)) {
    throw syntaxError(`Environment variable name "${key}" is not allowed`, line);
  }
  if (
    key.length === 0 ||
    key.length > MAX_ENV_KEY_CHARACTERS ||
    !ENV_KEY_PATTERN.test(key)
  ) {
    throw syntaxError(
      `Environment variable name must match ${ENV_KEY_PATTERN}`,
      line,
    );
  }
}

function isEnvKeyStart(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z_]/.test(value);
}

function isEnvKeyCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_]/.test(value);
}

function requireValueLength(length: number): void {
  if (length > MAX_ENV_VALUE_CHARACTERS) {
    throw new RangeError(
      `Environment variable value exceeds ${MAX_ENV_VALUE_CHARACTERS} characters`,
    );
  }
}

async function readEnvFile(path: string | URL): Promise<string | null> {
  try {
    const deno = getDenoRuntime();
    if (deno) return await deno.readTextFile(path);

    if (isNode || isBun) {
      const { readFile } = await import("node:fs/promises");
      return await readFile(path, "utf8");
    }

    throw new Error(
      "Dotenv file loading is only supported in Deno, Node.js, and Bun",
    );
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

function isNotFoundError(error: unknown, seen = new Set<unknown>()): boolean {
  if (typeof error !== "object" || error === null || seen.has(error)) return false;
  seen.add(error);

  const deno = getDenoRuntime();
  if (deno && error instanceof deno.errors.NotFound) return true;
  if (Reflect.get(error, "code") === "ENOENT") return true;

  return isNotFoundError(Reflect.get(error, "cause"), seen);
}

function exportMissingValues(values: Readonly<Record<string, string>>): void {
  const exported: string[] = [];
  try {
    for (const [key, value] of Object.entries(values)) {
      if (getHostEnv(key) !== undefined) continue;
      setEnv(key, value);
      exported.push(key);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (let index = exported.length - 1; index >= 0; index--) {
      try {
        deleteEnv(exported[index]!);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Could not export dotenv values or fully roll back partial changes",
        { cause: error },
      );
    }
    throw error;
  }
}

function createEnvRecord(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function syntaxError(message: string, line: number): SyntaxError {
  return new SyntaxError(`${message} at line ${line}`);
}
