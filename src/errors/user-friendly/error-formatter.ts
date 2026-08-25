import { bold, cyan, dim, red, yellow } from "#veryfront/compat/console";
import { box } from "#veryfront/utils/box.ts";
import { isProduction } from "#veryfront/platform/environment.ts";
import { ERROR_SOLUTIONS } from "./error-catalog.ts";
import { identifyError } from "./error-identifier.ts";
import {
  detachThrowableForBoundary,
  limitRenderedErrorOutput,
  sanitizeTerminalDiagnosticText,
  snapshotErrorForBoundary,
} from "../safe-diagnostics.ts";

const errorColor = "\x1b[38;2;239;68;68m"; // Red
const objectHasOwn = Object.hasOwn;
const reflectApply = Reflect.apply;
const regExpPrototypeExec = RegExp.prototype.exec;
const regExpPrototypeTest = RegExp.prototype.test;
const stringPrototypeEndsWith = String.prototype.endsWith;
const stringPrototypeIncludes = String.prototype.includes;
const stringPrototypeIndexOf = String.prototype.indexOf;
const stringPrototypeLastIndexOf = String.prototype.lastIndexOf;
const stringPrototypeSlice = String.prototype.slice;
const stringPrototypeSplit = String.prototype.split;
const stringPrototypeStartsWith = String.prototype.startsWith;
const stringPrototypeTrim = String.prototype.trim;

function execRegExp(pattern: RegExp, value: string): RegExpExecArray | null {
  return reflectApply(regExpPrototypeExec, pattern, [value]);
}

function testRegExp(pattern: RegExp, value: string): boolean {
  return reflectApply(regExpPrototypeTest, pattern, [value]);
}

function endsWithString(value: string, search: string): boolean {
  return reflectApply(stringPrototypeEndsWith, value, [search]);
}

function includesString(value: string, search: string): boolean {
  return reflectApply(stringPrototypeIncludes, value, [search]);
}

function indexOfString(value: string, search: string, position?: number): number {
  return reflectApply(
    stringPrototypeIndexOf,
    value,
    position === undefined ? [search] : [search, position],
  );
}

function lastIndexOfString(value: string, search: string): number {
  return reflectApply(stringPrototypeLastIndexOf, value, [search]);
}

function sliceString(value: string, start?: number, end?: number): string {
  return reflectApply(stringPrototypeSlice, value, [start, end]);
}

function splitString(value: string, separator: string | RegExp): string[] {
  return reflectApply(stringPrototypeSplit, value, [separator]);
}

function startsWithString(value: string, search: string): boolean {
  return reflectApply(stringPrototypeStartsWith, value, [search]);
}

function trimString(value: string): string {
  return reflectApply(stringPrototypeTrim, value, []);
}

function getSolution(errorKey: string): (typeof ERROR_SOLUTIONS)[string] | undefined {
  return objectHasOwn(ERROR_SOLUTIONS, errorKey) ? ERROR_SOLUTIONS[errorKey] : undefined;
}

function buildSolutionDetailsLines(
  solution: (typeof ERROR_SOLUTIONS)[string],
  options?: {
    exampleLabel?: string;
  },
): string[] {
  const lines: string[] = [];

  if (solution.steps?.length) {
    lines.push("", cyan("How to fix:"));
    for (const [i, step] of solution.steps.entries()) {
      lines.push(`  ${dim(`${i + 1}.`)} ${step}`);
    }
  }

  if (solution.example) {
    lines.push("", options?.exampleLabel ?? cyan("Example:"));
    for (const line of solution.example.split("\n")) {
      lines.push(`  ${dim(line)}`);
    }
  }

  if (solution.docs) {
    lines.push("", dim("Learn more: ") + cyan(solution.docs));
  }

  return lines;
}

/**
 * A URI scheme opening a source location. Opaque schemes carry no `//`, so a
 * `data:` module or a `node:internal/...` builtin is a location just as much as
 * a `file://` URL is, and its remainder is never safe to echo back.
 */
const URI_SCHEME_LOCATION = /^[a-zA-Z][\w+.-]*:/;

/**
 * Any path separator a source location can carry: POSIX, UNC, or drive. A
 * callable label carries no legitimate separator, so a separator marks a source
 * location wherever it appears — an absolute path, a UNC share, or the
 * project-relative path a source map or custom formatter emits.
 */
const PATH_SEPARATOR = /[\\/]/;

/** A single path segment followed by its source line and optional column. */
// Spaces stay allowed in the segment: a source map or custom formatter can
// emit `at private source.ts:1:1`, and a genuine callable label ending in
// line:column digits is indistinguishable from a location, so withholding is
// the safe reading either way.
const FILE_LINE_COLUMN_LOCATION = /^[^\\/@]+:\d+(?::\d+)?$/;

/**
 * A bare source filename carrying no coordinates. A custom
 * `Error.prepareStackTrace` can emit `at private.ts`, which has no separator,
 * no URI scheme, and no `:line` suffix, yet still names a source file. The
 * extension set is the one a JavaScript stack can actually name, so a callable
 * label only collides with it when it is itself spelled like a module file.
 */
const SOURCE_FILE_BASENAME_LOCATION =
  /\.(?:[cm]?[jt]sx?|json[c5]?|wasm|node|vue|svelte|astro|mdx?)(?:[?#].*)?$/i;

/** A dot-separated callable label can be indistinguishable from a hostname. */
const HOSTNAME_SHAPED_CALLABLE_LABEL =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z](?:[a-z0-9-]*[a-z0-9])?|\d{1,3})\.?$/i;

/** A bracketed IPv6 literal can be emitted as a custom callable label. */
const BRACKETED_IPV6_CALLABLE_LABEL = /^\[[0-9a-f:.]*:[0-9a-f:.]*(?:%[a-z0-9._~-]+)?\]$/i;

/** An unbracketed IPv6 literal can likewise be emitted as a callable label. */
const UNBRACKETED_IPV6_CALLABLE_LABEL = /^(?=(?:[^:]*:){2})[0-9a-f:.]+(?:%[a-z0-9._~-]+)?$/i;

/**
 * Preserve well-known built-in receiver method labels despite their DNS-like
 * shape. Only this fixed receiver set is exempt: DNS names are case-insensitive,
 * so capitalization alone cannot prove a hostname-shaped label such as
 * `PrivateControl.example` names a callable rather than a private hostname.
 */
const SAFE_RECEIVER_QUALIFIED_CALLABLE_LABEL =
  /^(?:Object|Array|Boolean|Date|Error|Function|JSON|Map|Math|Number|Promise|Reflect|RegExp|Set|String|Symbol|WeakMap|WeakSet)\.[a-z_$][A-Za-z0-9_$]*$/;

/** Standard V8 modifiers are syntax around the callable label, not part of it. */
const CALLABLE_LABEL_PREFIX = /^(?:(?:async|new)\s+)+/;

/** Standard V8 property aliases must be safe independently of their function name. */
const CALLABLE_ALIAS_SUFFIX = /^(.+)\s+\[as\s+([^\]\r\n]+)\]$/;

/** Capture one whitespace-delimited display token without using live string hooks. */
const CALLABLE_LABEL_TOKEN_SEQUENCE = /^(\S+)(?:\s+([\s\S]*))?$/;

/** Captures a frame whose text after `at ` can be a bare source location. */
const LOCATION_ONLY_FRAME = /^at\s+(.+)$/;

/** Whether a frame's trailing segment is a source location rather than more label. */
function isSourceLocationText(text: string): boolean {
  const trimmed = trimString(text);
  return testRegExp(URI_SCHEME_LOCATION, trimmed) || testRegExp(PATH_SEPARATOR, trimmed) ||
    testRegExp(FILE_LINE_COLUMN_LOCATION, trimmed) ||
    testRegExp(SOURCE_FILE_BASENAME_LOCATION, trimmed);
}

function isRetainableCallableLabel(label: string): boolean {
  // A method can be named like a location ("123-app.ts:3:3" on Node 24), so a
  // label gets the same source-location validation as location text itself.
  return !!label && !isSourceLocationText(label) &&
    !testRegExp(BRACKETED_IPV6_CALLABLE_LABEL, label) &&
    !testRegExp(UNBRACKETED_IPV6_CALLABLE_LABEL, label) &&
    (!testRegExp(HOSTNAME_SHAPED_CALLABLE_LABEL, label) ||
      testRegExp(SAFE_RECEIVER_QUALIFIED_CALLABLE_LABEL, label));
}

function isRetainableCallableLabelTokens(label: string): boolean {
  if (!isRetainableCallableLabel(label)) return false;
  let remaining = label;
  while (remaining) {
    const token = execRegExp(CALLABLE_LABEL_TOKEN_SEQUENCE, remaining);
    if (!token || !isRetainableCallableLabel(token[1] ?? "")) return false;
    remaining = token[2] ?? "";
  }
  return true;
}

/** Keep a frame's callable label only when the label itself carries no source location. */
function retainCallableLabel(label: string): string {
  const trimmed = trimString(label);
  const prefix = execRegExp(CALLABLE_LABEL_PREFIX, trimmed)?.[0] ?? "";
  const callableLabel = prefix ? trimString(sliceString(trimmed, prefix.length)) : trimmed;
  const alias = execRegExp(CALLABLE_ALIAS_SUFFIX, callableLabel);
  const aliasLabel = alias?.[2] === undefined ? undefined : trimString(alias[2]);
  const aliasPrefix = aliasLabel ? execRegExp(CALLABLE_LABEL_PREFIX, aliasLabel)?.[0] : undefined;
  const unprefixedAlias = aliasPrefix
    ? trimString(sliceString(aliasLabel!, aliasPrefix.length))
    : aliasLabel;
  const isSafe = alias
    ? isRetainableCallableLabelTokens(trimString(alias[1]!)) &&
      isRetainableCallableLabelTokens(unprefixedAlias ?? "")
    : isRetainableCallableLabelTokens(callableLabel);
  return isSafe ? `at ${prefix}${callableLabel}` : "at <anonymous>";
}

/** Keep a development stack's callable label without exposing its source location. */
function sanitizeUserFacingStackFrame(line: string): string {
  const frame = trimString(sanitizeTerminalDiagnosticText(line));
  const locationStart = lastIndexOfString(frame, " (");
  if (startsWithString(frame, "at ") && locationStart > 3 && endsWithString(frame, ")")) {
    return retainCallableLabel(sliceString(frame, 3, locationStart));
  }
  const locationOnly = execRegExp(LOCATION_ONLY_FRAME, frame);
  if (locationOnly) {
    return isSourceLocationText(locationOnly[1]!)
      ? "at <anonymous>"
      : retainCallableLabel(locationOnly[1]!);
  }
  // A callable label can itself contain "@" ("handler@alias@app.ts:2:2"), so
  // every delimiter is a candidate split until one exposes a real location.
  for (
    let labelEnd = indexOfString(frame, "@");
    labelEnd !== -1;
    labelEnd = indexOfString(frame, "@", labelEnd + 1)
  ) {
    if (isSourceLocationText(sliceString(frame, labelEnd + 1))) {
      return retainCallableLabel(sliceString(frame, 0, labelEnd));
    }
  }
  // A delimiter whose trailing text matches no known location shape still
  // marks a custom-formatted frame; fail closed instead of echoing it.
  if (includesString(frame, "@") || isSourceLocationText(frame)) {
    return "at <anonymous>";
  }
  return retainCallableLabel(frame) === "at <anonymous>" ? "at <anonymous>" : frame;
}

/**
 * Format error as a polished box with solution
 */
export function formatErrorBox(error: Error): string {
  const stableError = detachThrowableForBoundary(error);
  const errorKey = identifyError(stableError);
  const solution = getSolution(errorKey);

  const content: string[] = [
    sanitizeTerminalDiagnosticText(stableError.message),
  ];

  if (!solution) {
    content.push("", dim("For help, run: ") + cyan("veryfront doctor"));
  } else {
    if (solution.message) {
      content.push("", dim(solution.message));
    }
    content.push(...buildSolutionDetailsLines(solution, { exampleLabel: dim("Example:") }));
  }

  return limitRenderedErrorOutput(
    box(content.join("\n"), {
      style: "rounded",
      title: "Error",
      titleColor: errorColor,
      borderColor: errorColor,
      paddingX: 2,
      paddingY: 1,
    }),
  );
}

/**
 * Format error with plain text (existing behavior)
 */
export function formatUserError(error: Error): string {
  const stableError = detachThrowableForBoundary(error);
  const message = sanitizeTerminalDiagnosticText(stableError.message);
  const output: string[] = ["", red(bold("✖ Error: ")) + bold(message), ""];

  const errorKey = identifyError(stableError);
  const solution = getSolution(errorKey);

  if (solution) {
    if (solution.message) {
      output.push(yellow("Problem: ") + solution.message);
    }
    output.push(...buildSolutionDetailsLines(solution), "");
    return limitRenderedErrorOutput(output.join("\n"));
  }

  const stack = snapshotErrorForBoundary(stableError).stack;
  if (!isProduction() && stack) {
    output.push(yellow("Stack trace:"));
    const stackLines = splitString(stack, /\r\n?|\n/);
    for (let index = 1; index < stackLines.length && index < 4; index++) {
      const line = stackLines[index]!;
      output.push(dim(`  ${sanitizeUserFacingStackFrame(line)}`));
    }
    output.push("");
  }

  output.push(dim("For help, run: ") + cyan("veryfront doctor"), "");

  return limitRenderedErrorOutput(output.join("\n"));
}
