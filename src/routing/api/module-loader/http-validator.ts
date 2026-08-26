import { createError, toError } from "#veryfront/errors";
import { analyzeSourceCapabilities } from "./source-capability-analyzer.ts";

export function isAllowedRemoteHost(url: URL, allowedHosts: string[]): boolean {
  return allowedHosts.some((host) => {
    try {
      return new URL(host).origin === url.origin;
    } catch (_) {
      return false;
    }
  });
}

/**
 * ECMAScript identifier-continue, not just ASCII: a name may end in a letter
 * such as `é`, and treating that as a non-identifier character would read the
 * `import` in `caféimport(...)` as a standalone keyword.
 */
const IDENTIFIER_PART = /[\p{ID_Continue}$\u200C\u200D]/u;

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && IDENTIFIER_PART.test(char);
}

function skipLineComment(source: string, index: number): number {
  const newline = source.indexOf("\n", index + 2);
  return newline === -1 ? source.length : newline + 1;
}

function skipBlockComment(source: string, index: number): number {
  const end = source.indexOf("*/", index + 2);
  return end === -1 ? source.length : end + 2;
}

function isKeywordBoundary(source: string, index: number, keyword: string): boolean {
  return !isIdentifierChar(source[index - 1]) &&
    source[index - 1] !== "." &&
    source[index - 1] !== "#" &&
    !isIdentifierChar(source[index + keyword.length]);
}

function readEscapedCharacter(
  source: string,
  index: number,
): { value: string; end: number } | null {
  const char = source[index];
  if (char === undefined) return null;
  const lineEscape = readEscapedLineTerminator(source, index);
  if (lineEscape !== null) return lineEscape;
  const simpleEscape = readSimpleEscape(char, index);
  if (simpleEscape !== null) return simpleEscape;
  if (char === "x") return readFixedHexEscape(source, index + 1, 2);
  if (char === "u" && source[index + 1] === "{") {
    return readBracedUnicodeEscape(source, index + 2);
  }
  if (char === "u") return readFixedHexEscape(source, index + 1, 4);

  return { value: char, end: index + 1 };
}

function readEscapedLineTerminator(
  source: string,
  index: number,
): { value: string; end: number } | null {
  const char = source[index];
  if (char === "\n") return { value: "", end: index + 1 };
  if (char !== "\r") return null;
  const end = source[index + 1] === "\n" ? index + 2 : index + 1;
  return { value: "", end };
}

const SIMPLE_ESCAPES: Record<string, string> = {
  "0": "\0",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

function readSimpleEscape(
  char: string,
  index: number,
): { value: string; end: number } | null {
  const value = SIMPLE_ESCAPES[char];
  return value === undefined ? null : { value, end: index + 1 };
}

function readFixedHexEscape(
  source: string,
  start: number,
  length: number,
): { value: string; end: number } | null {
  const hex = source.slice(start, start + length);
  if (!/^[\dA-Fa-f]+$/.test(hex) || hex.length !== length) return null;
  return { value: String.fromCodePoint(Number.parseInt(hex, 16)), end: start + length };
}

function readBracedUnicodeEscape(
  source: string,
  start: number,
): { value: string; end: number } | null {
  const close = source.indexOf("}", start);
  if (close === -1) return null;
  const hex = source.slice(start, close);
  if (!/^[\dA-Fa-f]+$/.test(hex)) return null;
  const codePoint = Number.parseInt(hex, 16);
  if (codePoint > 0x10FFFF) return null;
  return { value: String.fromCodePoint(codePoint), end: close + 1 };
}

function readStringLiteral(source: string, index: number): { value: string; end: number } | null {
  const quote = source[index];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;

  let value = "";
  let i = index + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\") {
      const escaped = readEscapedCharacter(source, i + 1);
      if (escaped === null) return null;
      value += escaped.value;
      i = escaped.end;
      continue;
    } else if (char === quote) {
      return { value, end: i + 1 };
    } else {
      value += char;
    }
    i++;
  }

  return null;
}

function skipStringLiteral(source: string, index: number): number {
  return readStringLiteral(source, index)?.end ?? source.length;
}

function readTemplateExpression(
  source: string,
  openBraceIndex: number,
): { body: string; end: number; scan: ModuleSpecifierScan } | null {
  const scan: MutableScanAccumulator = {
    specifiers: [],
    hasUnconstrainedDynamicImport: false,
    requiresBundling: false,
  };
  const bodyStart = openBraceIndex + 1;
  let depth = 1;

  let i = bodyStart;
  while (i < source.length) {
    const char = source[i];

    const skipped = skipTemplateExpressionToken(source, i);
    if (skipped === null) return null;
    if (skipped !== undefined) {
      mergeModuleSpecifierScan(scan, skipped.scan);
      scan.requiresBundling ||= skipped.requiresBundling;
      i = skipped.end;
      continue;
    }

    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return {
          body: source.slice(bodyStart, i),
          end: i + 1,
          scan: {
            specifiers: scan.specifiers,
            hasUnconstrainedDynamicImport: scan.hasUnconstrainedDynamicImport,
            requiresBundling: scan.requiresBundling,
            hasDynamicCodeGeneration: containsDynamicCodeGenerationIdentifier(
              source.slice(bodyStart, i),
            ),
          },
        };
      }
    }
    i++;
  }

  return null;
}

type MutableScanAccumulator = {
  specifiers: string[];
  hasUnconstrainedDynamicImport: boolean;
  requiresBundling: boolean;
};

function mergeModuleSpecifierScan(
  target: MutableScanAccumulator,
  scan: ModuleSpecifierScan,
): void {
  target.specifiers.push(...scan.specifiers);
  target.hasUnconstrainedDynamicImport ||= scan.hasUnconstrainedDynamicImport;
  target.requiresBundling ||= scan.requiresBundling;
}

function skipTemplateExpressionToken(
  source: string,
  index: number,
): { end: number; requiresBundling: boolean; scan: ModuleSpecifierScan } | null | undefined {
  const char = source[index];
  const next = source[index + 1];

  if (char === "/" && next === "/") {
    return { end: skipLineComment(source, index), requiresBundling: false, scan: emptyScan() };
  }
  if (char === "/" && next === "*") {
    return { end: skipBlockComment(source, index), requiresBundling: false, scan: emptyScan() };
  }
  if (char === "/") {
    const regexEnd = canStartRegularExpression(source, index)
      ? skipRegularExpressionLiteral(source, index)
      : null;
    return {
      end: regexEnd ?? index + 1,
      requiresBundling: true,
      scan: emptyScan(),
    };
  }
  if (char === '"' || char === "'") {
    return { end: skipStringLiteral(source, index), requiresBundling: false, scan: emptyScan() };
  }
  if (char !== "`") return undefined;

  const template = readTemplateLiteral(source, index);
  if (template === null) return null;
  return { end: template.end, requiresBundling: false, scan: template.scan };
}

function emptyScan(): ModuleSpecifierScan {
  return {
    specifiers: [],
    hasUnconstrainedDynamicImport: false,
    requiresBundling: false,
    hasDynamicCodeGeneration: false,
  };
}

function readTemplateLiteral(
  source: string,
  index: number,
): { end: number; scan: ModuleSpecifierScan } | null {
  const specifiers: string[] = [];
  let hasUnconstrainedDynamicImport = false;
  let requiresBundling = false;
  if (source[index] !== "`") return null;

  let i = index + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\") {
      i++;
    } else if (char === "`") {
      return {
        end: i + 1,
        scan: {
          specifiers,
          hasUnconstrainedDynamicImport,
          requiresBundling,
          hasDynamicCodeGeneration: containsDynamicCodeGenerationIdentifier(
            source.slice(index, i + 1),
          ),
        },
      };
    } else if (char === "$" && source[i + 1] === "{") {
      const expression = readTemplateExpression(source, i + 1);
      if (expression === null) return null;
      const expressionScan = scanModuleSpecifiers(expression.body);
      const accumulator: MutableScanAccumulator = {
        specifiers,
        hasUnconstrainedDynamicImport,
        requiresBundling,
      };
      mergeModuleSpecifierScan(accumulator, expressionScan);
      mergeModuleSpecifierScan(accumulator, expression.scan);
      hasUnconstrainedDynamicImport = accumulator.hasUnconstrainedDynamicImport;
      requiresBundling = accumulator.requiresBundling;
      i = expression.end;
      continue;
    }
    i++;
  }

  return null;
}

function skipWhitespaceAndComments(source: string, index: number): number {
  let i = index;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (/\s/.test(char ?? "")) {
      i++;
      continue;
    }
    if (char === "/" && next === "/") {
      i = skipLineComment(source, i);
      continue;
    }
    if (char === "/" && next === "*") {
      i = skipBlockComment(source, i);
      continue;
    }
    break;
  }
  return i;
}

function readStaticImportAttributesArgument(source: string, index: number): number | null {
  let i = skipWhitespaceAndComments(source, index);
  if (source[i] !== "{") return null;

  const states: ImportAttributeState[] = [];
  while (i < source.length) {
    i = skipWhitespaceAndComments(source, i);
    const next = readStaticImportAttributeToken(source, i, states);
    if (next === null) return null;
    if (typeof next === "number") return next;
    i = next.index;
  }

  return null;
}

type ImportAttributeState = "key" | "colon" | "value" | "commaOrClose";

type AttributeTokenRead = { index: number } | number | null;

function readStaticImportAttributeToken(
  source: string,
  index: number,
  states: ImportAttributeState[],
): AttributeTokenRead {
  const char = source[index];
  if (char === undefined) return null;
  if (char === '"' || char === "'") return readImportAttributeStringToken(source, index, states);
  if (char === "{") return startImportAttributeObjectToken(states, index);
  if (char === "}") return finishImportAttributeObjectToken(states, index);
  if (char === ":") return readImportAttributeColonToken(states, index);
  if (char === ",") return readImportAttributeCommaToken(states, index);
  if (/[A-Za-z_$]/.test(char)) return readImportAttributeIdentifierToken(source, index, states);
  if (/\s/.test(char)) return { index: index + 1 };
  return null;
}

function readImportAttributeStringToken(
  source: string,
  index: number,
  states: ImportAttributeState[],
): AttributeTokenRead {
  const literal = readStringLiteral(source, index);
  if (literal === null || !advanceImportAttributeStringState(states)) return null;
  return { index: literal.end };
}

function startImportAttributeObjectToken(
  states: ImportAttributeState[],
  index: number,
): AttributeTokenRead {
  if (!startImportAttributeObjectState(states)) return null;
  states.push("key");
  return { index: index + 1 };
}

function finishImportAttributeObjectToken(
  states: ImportAttributeState[],
  index: number,
): AttributeTokenRead {
  const state = states.pop();
  if (state === undefined || state === "colon" || state === "value") return null;
  return states.length === 0 ? index + 1 : { index: index + 1 };
}

function readImportAttributeColonToken(
  states: ImportAttributeState[],
  index: number,
): AttributeTokenRead {
  if (states.at(-1) !== "colon") return null;
  states[states.length - 1] = "value";
  return { index: index + 1 };
}

function readImportAttributeCommaToken(
  states: ImportAttributeState[],
  index: number,
): AttributeTokenRead {
  if (states.at(-1) !== "commaOrClose") return null;
  states[states.length - 1] = "key";
  return { index: index + 1 };
}

function readImportAttributeIdentifierToken(
  source: string,
  index: number,
  states: ImportAttributeState[],
): AttributeTokenRead {
  if (states.at(-1) !== "key") return null;
  const end = readIdentifierEnd(source, index + 1);
  states[states.length - 1] = "colon";
  return { index: end };
}

function readIdentifierEnd(source: string, index: number): number {
  let end = index;
  while (isIdentifierChar(source[end])) end++;
  return end;
}

function advanceImportAttributeStringState(
  states: ImportAttributeState[],
): boolean {
  const state = states.at(-1);
  if (state === "colon") return false;
  if (state === "key") {
    states[states.length - 1] = "colon";
    return true;
  }
  if (state === "value") {
    states[states.length - 1] = "commaOrClose";
    return true;
  }
  return false;
}

function startImportAttributeObjectState(
  states: ImportAttributeState[],
): boolean {
  const state = states.at(-1);
  if (state === "colon" || state === "commaOrClose") return false;
  if (state === "value") states[states.length - 1] = "commaOrClose";
  return true;
}

function previousSignificantCharacter(source: string, index: number): string | undefined {
  let i = index - 1;
  while (i >= 0) {
    const char = source[i];
    if (!/\s/.test(char ?? "")) return char;
    i--;
  }
  return undefined;
}

function canStartRegularExpression(source: string, slashIndex: number): boolean {
  const previous = previousSignificantCharacter(source, slashIndex);
  if (previous === undefined || "([{=,:;!&|?+-*~^%<>".includes(previous)) return true;
  if (previous === ")" && closesControlFlowHeader(source, slashIndex - 1)) return true;
  if (!isIdentifierChar(previous)) return false;

  let end = slashIndex;
  while (/\s/.test(source[end - 1] ?? "")) end--;
  let start = end;
  while (isIdentifierChar(source[start - 1])) start--;
  const previousToken = source.slice(start, end);
  return REGULAR_EXPRESSION_PREFIX_KEYWORDS.has(previousToken);
}

function closesControlFlowHeader(source: string, closeParenIndex: number): boolean {
  let depth = 0;
  for (let index = closeParenIndex; index >= 0; index--) {
    const char = source[index];
    if (char === ")") {
      depth++;
      continue;
    }
    if (char !== "(") continue;
    depth--;
    if (depth !== 0) continue;

    let end = index;
    while (/\s/.test(source[end - 1] ?? "")) end--;
    let start = end;
    while (isIdentifierChar(source[start - 1])) start--;
    return REGULAR_EXPRESSION_CONTROL_FLOW_KEYWORDS.has(source.slice(start, end));
  }
  return false;
}

const REGULAR_EXPRESSION_CONTROL_FLOW_KEYWORDS = new Set([
  "for",
  "if",
  "while",
  "with",
]);

const REGULAR_EXPRESSION_PREFIX_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

function skipRegularExpressionLiteral(source: string, index: number): number | null {
  let inCharacterClass = false;

  let i = index + 1;
  while (i < source.length) {
    const char = source[i];

    if (char === "\\") {
      i++;
    } else if (char === "\n" || char === "\r") {
      return null;
    } else if (char === "[") {
      inCharacterClass = true;
    } else if (char === "]") {
      inCharacterClass = false;
    } else if (char === "/" && !inCharacterClass) {
      let end = i + 1;
      while (/[A-Za-z]/.test(source[end] ?? "")) end++;
      return end;
    }
    i++;
  }

  return null;
}

function readSpecifierAfterFrom(source: string, index: number): string | null {
  let i = index;
  while (i < source.length) {
    i = skipWhitespaceAndComments(source, i);
    const token = readSpecifierFromToken(source, i);
    if (token.kind === "done") return null;
    if (token.kind === "specifier") return token.value;
    i = token.next;
  }
  return null;
}

type SpecifierFromToken =
  | { kind: "continue"; next: number }
  | { kind: "specifier"; value: string }
  | { kind: "done" };

function readSpecifierFromToken(source: string, index: number): SpecifierFromToken {
  const char = source[index];
  const next = source[index + 1];

  if (char === '"' || char === "'" || char === "`") {
    return { kind: "continue", next: skipStringLiteral(source, index) };
  }
  if (char === "/" && next === "/") {
    return { kind: "continue", next: skipLineComment(source, index) };
  }
  if (char === "/" && next === "*") {
    return { kind: "continue", next: skipBlockComment(source, index) };
  }
  if (char === ";" || char === undefined) return { kind: "done" };
  if (!source.startsWith("from", index) || !isKeywordBoundary(source, index, "from")) {
    return { kind: "continue", next: index + 1 };
  }

  const specifierIndex = skipWhitespaceAndComments(source, index + "from".length);
  const specifier = readStringLiteral(source, specifierIndex);
  // `from` is a legal binding name, as in `import { from as value } from
  // "..."`. Only the occurrence a string literal follows is the module clause;
  // keep scanning past any other so the real specifier is read.
  return specifier === null
    ? { kind: "continue", next: index + "from".length }
    : { kind: "specifier", value: specifier.value };
}

export type ModuleSpecifierScan = {
  specifiers: string[];
  hasUnconstrainedDynamicImport: boolean;
  /** Slash syntax needs a real parser before the source can execute directly. */
  requiresBundling: boolean;
  /** Dynamic code generation can synthesize imports after static validation. */
  hasDynamicCodeGeneration: boolean;
};

const DYNAMIC_CODE_GENERATION_IDENTIFIERS = ["eval", "Function"] as const;
const DYNAMIC_CODE_GENERATION_NAMES = ["eval", "Function", "constructor"] as const;
const IDENTIFIER_UNICODE_ESCAPE = /\\u\{([0-9A-Fa-f]{1,6})\}|\\u([0-9A-Fa-f]{4})/g;
const CONSTRUCTOR_PROPERTY_REFERENCE =
  /(?:\.\s*constructor\b|\[\s*(?:"constructor"|'constructor')\s*\])/;
const DESTRUCTURED_CONSTRUCTOR_REFERENCE =
  /[,{]\s*(?:constructor|"constructor"|'constructor')\s*(?::|[,}])/;

function containsComputedDynamicCodeGenerationProperty(source: string): boolean {
  let openBracket = source.indexOf("[");
  while (openBracket !== -1) {
    const property = readBracketedStaticStringProperty(source, openBracket);
    if (property !== null && dynamicCodeGenerationNamesProperty(property)) return true;
    openBracket = source.indexOf("[", openBracket + 1);
  }
  return false;
}

function readBracketedStaticStringProperty(source: string, openBracket: number): string | null {
  const valueStart = skipWhitespaceAndComments(source, openBracket + 1);
  const property = readConcatenatedStringLiteral(source, valueStart);
  if (property === null || property.parts <= 1) return null;
  const closeBracket = skipWhitespaceAndComments(source, property.end);
  return source[closeBracket] === "]" ? property.value : null;
}

function dynamicCodeGenerationNamesProperty(name: string): boolean {
  return DYNAMIC_CODE_GENERATION_NAMES.includes(
    name as (typeof DYNAMIC_CODE_GENERATION_NAMES)[number],
  );
}

/**
 * Whether a template literal carries no `${...}` substitution, and therefore
 * spells one fixed string the way a quoted literal does.
 */
function isSubstitutionFreeTemplate(source: string, index: number, end: number): boolean {
  let i = index + 1;
  while (i < end - 1) {
    if (source[i] === "\\") {
      i++;
    } else if (source[i] === "$" && source[i + 1] === "{") {
      return false;
    }
    i++;
  }
  return true;
}

function readConcatenatedStringLiteral(
  source: string,
  index: number,
): { value: string; end: number; parts: number } | null {
  let i = skipWhitespaceAndComments(source, index);
  let value = "";
  let parts = 0;

  while (i < source.length) {
    const quote = source[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") break;
    const literal = readStringLiteral(source, i);
    if (literal === null) return null;
    // A template that interpolates has no single static value, so the name it
    // resolves to cannot be decided here.
    if (quote === "`" && !isSubstitutionFreeTemplate(source, i, literal.end)) return null;
    parts++;
    value += literal.value;
    i = skipWhitespaceAndComments(source, literal.end);
    if (source[i] !== "+") break;
    i = skipWhitespaceAndComments(source, i + 1);
  }

  return parts > 0 ? { value, end: i, parts } : null;
}

/** The identifiers that name the global object directly, before aliasing. */
const GLOBAL_OBJECT_ROOTS = ["globalThis", "self", "window"] as const;

/**
 * Every identifier that names the global object: the built-in roots plus any
 * variable assigned one of them, transitively.
 *
 * `const g = globalThis; g[name]` reaches the same property as
 * `globalThis[name]`, so alias-blind analysis would miss the lookup. Binding an
 * alias from an alias (`const h = g`) is followed to a fixed point. The scan is
 * textual, so an assignment quoted inside a string can add an inert name; that
 * only over-approximates the alias set, which fails closed.
 */
function collectGlobalObjectAliases(source: string): Set<string> {
  const names = new Set<string>(GLOBAL_OBJECT_ROOTS);
  // `const|let|var IDENT = ROOT` where ROOT is a bare global reference, not a
  // property (`globalThis.foo`) or an index (`globalThis[x]`) of one.
  const declaration =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*(?![\w$.[])/g;
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of source.matchAll(declaration)) {
      const alias = match[1];
      const rhs = match[2];
      if (alias && rhs && names.has(rhs) && !names.has(alias)) {
        names.add(alias);
        changed = true;
      }
    }
  }
  return names;
}

/**
 * Whether the text reads a property off the global object under a name this
 * scanner cannot decide.
 *
 * `globalThis["ev" + "al"]` is resolved and reported by name, but
 * `globalThis[name]` — with `name` computed at runtime, as
 * `["e","v","a","l"].join("")` does — names nothing static. The property it
 * reaches may be `eval` or `Function`, so an undecidable lookup is reported
 * rather than assumed inert: this scanner's whole contract is that a module it
 * passes cannot synthesize an import after validation. The same lookup through
 * a `self`/`window` reference or an alias of the global object is read the same
 * way.
 */
function containsComputedGlobalDynamicCodeGeneration(source: string): boolean {
  for (const globalName of collectGlobalObjectAliases(source)) {
    if (containsComputedGlobalDynamicCodeGenerationForName(source, globalName)) return true;
  }
  return false;
}

function containsComputedGlobalDynamicCodeGenerationForName(
  source: string,
  globalName: string,
): boolean {
  let i = source.indexOf(globalName);
  while (i !== -1) {
    const property = readComputedGlobalProperty(source, i, globalName);
    if (property.kind === "dynamic" || dynamicCodeGenerationIdentifiersProperty(property)) {
      return true;
    }
    i = source.indexOf(globalName, i + globalName.length);
  }
  return false;
}

type ComputedGlobalProperty =
  | { kind: "static"; value: string }
  | { kind: "dynamic" }
  | { kind: "absent" };

function readComputedGlobalProperty(
  source: string,
  index: number,
  globalName: string,
): ComputedGlobalProperty {
  if (!isKeywordBoundary(source, index, globalName)) return { kind: "absent" };
  const openBracket = readComputedPropertyOpenBracket(source, index + globalName.length);
  if (openBracket === null) return { kind: "absent" };
  const property = readConcatenatedStringLiteral(source, openBracket + 1);
  const closeBracket = property === null ? null : skipWhitespaceAndComments(source, property.end);
  if (property === null || source[closeBracket ?? 0] !== "]") return { kind: "dynamic" };
  return { kind: "static", value: property.value };
}

function readComputedPropertyOpenBracket(source: string, index: number): number | null {
  let openBracket = skipWhitespaceAndComments(source, index);
  // `globalThis?.[name]` reads the same property as `globalThis[name]`.
  if (source[openBracket] === "?" && source[openBracket + 1] === ".") {
    openBracket = skipWhitespaceAndComments(source, openBracket + 2);
  }
  return source[openBracket] === "[" ? openBracket : null;
}

function dynamicCodeGenerationIdentifiersProperty(property: ComputedGlobalProperty): boolean {
  return property.kind === "static" &&
    DYNAMIC_CODE_GENERATION_IDENTIFIERS.includes(
      property.value as (typeof DYNAMIC_CODE_GENERATION_IDENTIFIERS)[number],
    );
}

/**
 * A generator name a string literal never spells outright — split across a
 * concatenation as `"ev" + "al"`, or buried in character escapes as
 * `"\x65val"` — survives the raw-identifier scan wherever it appears, so a
 * reflective lookup such as `Reflect.get(globalThis, "ev" + "al")` reaches
 * `eval` without the text ever containing it. Rejoin every static
 * concatenation, decode its escapes, and test the name the lookup will
 * actually resolve.
 *
 * A substitution-free template literal spells a fixed string exactly as a
 * quoted one does, so `` Reflect.get(globalThis, `\x65val`) `` is read the
 * same way; a template that interpolates names nothing static and is skipped.
 *
 * A literal whose own text already spells the name is left to the raw-text
 * scan, which reports it wherever it sits.
 */
function containsConcatenatedDynamicCodeGenerationName(source: string): boolean {
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char !== '"' && char !== "'" && char !== "`") {
      i++;
      continue;
    }

    const concatenated = readConcatenatedStringLiteral(source, i);
    if (concatenated === null || concatenated.end <= i) {
      i++;
      continue;
    }
    if (containsIdentifierName(concatenated.value, DYNAMIC_CODE_GENERATION_NAMES)) {
      const raw = source.slice(i, concatenated.end);
      // Concatenation hides the name by construction; a lone literal only
      // hides it when escapes kept the raw text from spelling it.
      if (
        concatenated.parts > 1 ||
        !containsIdentifierName(raw, DYNAMIC_CODE_GENERATION_NAMES)
      ) return true;
    }
    i = concatenated.end;
  }
  return false;
}

/**
 * `globalThis.\u0065val(...)` binds `eval` even though the raw text never
 * spells it, so decode identifier escapes before scanning for the generator.
 */
function decodeIdentifierEscapes(source: string): string {
  return source.replace(
    IDENTIFIER_UNICODE_ESCAPE,
    (match: string, braced?: string, plain?: string) => {
      const hex = braced ?? plain;
      if (hex === undefined) return match;
      const codePoint = Number.parseInt(hex, 16);
      if (!Number.isInteger(codePoint) || codePoint > 0x10FFFF) return match;
      return String.fromCodePoint(codePoint);
    },
  );
}

function textNamesDynamicCodeGenerator(source: string): boolean {
  return containsIdentifierName(source, DYNAMIC_CODE_GENERATION_IDENTIFIERS) ||
    containsComputedDynamicCodeGenerationProperty(source) ||
    containsComputedGlobalDynamicCodeGeneration(source) ||
    containsConcatenatedDynamicCodeGenerationName(source) ||
    CONSTRUCTOR_PROPERTY_REFERENCE.test(source) ||
    DESTRUCTURED_CONSTRUCTOR_REFERENCE.test(source);
}

function containsIdentifierName(source: string, names: readonly string[]): boolean {
  return names.some((name) => hasIdentifierName(source, name));
}

function hasIdentifierName(source: string, name: string): boolean {
  return countIdentifierName(source, name) > 0;
}

function countIdentifierName(source: string, name: string): number {
  let count = 0;
  let index = source.indexOf(name);
  while (index !== -1) {
    if (isIdentifierNameBoundary(source, index, name)) count++;
    index = source.indexOf(name, index + name.length);
  }
  return count;
}

function isIdentifierNameBoundary(source: string, index: number, name: string): boolean {
  return !isIdentifierChar(source[index - 1]) && source[index - 1] !== "$" &&
    !isIdentifierChar(source[index + name.length]) &&
    source[index + name.length] !== "$";
}

function containsDynamicCodeGenerationIdentifier(source: string): boolean {
  // This intentionally scans the original text instead of trusting the
  // lightweight import scanner's lexical state. A quote inside a regular
  // expression must not hide a later eval or Function reference. Rejecting an
  // inert occurrence is safer than allowing generated code to synthesize a
  // network import after validation.
  if (textNamesDynamicCodeGenerator(source)) return true;

  const decoded = decodeIdentifierEscapes(source);
  return decoded !== source && textNamesDynamicCodeGenerator(decoded);
}

/** How many parallel slash readings the ambiguity search follows before it gives up. */
const SLASH_AMBIGUITY_READING_BUDGET = 64;

/**
 * Whether the text can reach a dynamic `import()` this scanner cannot pin to a
 * literal specifier.
 *
 * Telling a regular-expression literal from division needs a real parser, and
 * guessing wrong lets a quote inside the mis-read literal swallow the rest of
 * the file — `if (ready) {} /"/.test("")` hid a later `import(target)` that
 * way. Where the heuristic picks division but a regular expression would also
 * parse, follow both readings and report the import if either one exposes it.
 */
function containsPotentialUnconstrainedDynamicImport(source: string): boolean {
  // Text that cannot name a dynamic import at all hides nothing, and skipping
  // it keeps slash-heavy arithmetic out of the ambiguity search below.
  if (!source.includes("import")) return false;

  const visited = new Set<number>();
  const pending: number[] = [0];
  let readings = 0;

  while (pending.length > 0) {
    const start = pending.pop() as number;
    if (start >= source.length || visited.has(start)) continue;
    visited.add(start);

    // Slash syntax needing this many parallel readings cannot be classified
    // soundly here, so report the import rather than guess.
    if (++readings > SLASH_AMBIGUITY_READING_BUDGET) return true;

    if (scanForUnconstrainedDynamicImport(source, start, pending)) return true;
  }

  return false;
}

function scanForUnconstrainedDynamicImport(
  source: string,
  start: number,
  alternativeReadings: number[],
): boolean {
  let i = start;
  while (i < source.length) {
    const result = readUnconstrainedDynamicImportScanStep(source, i, alternativeReadings);
    if (result.kind === "found") return true;
    i = result.next;
  }
  return false;
}

type DynamicImportScanStep =
  | { kind: "continue"; next: number }
  | { kind: "found" };

function readUnconstrainedDynamicImportScanStep(
  source: string,
  index: number,
  alternativeReadings: number[],
): DynamicImportScanStep {
  const skipped = skipDynamicImportScanToken(source, index, alternativeReadings);
  if (skipped === null) return { kind: "found" };
  if (skipped !== undefined) return { kind: "continue", next: skipped };
  return readDynamicImportKeywordStep(source, index);
}

function readDynamicImportKeywordStep(
  source: string,
  index: number,
): DynamicImportScanStep {
  const keyword = "import";
  if (!source.startsWith(keyword, index) || !isKeywordBoundary(source, index, keyword)) {
    return { kind: "continue", next: index + 1 };
  }
  const outcome = readDynamicImportLiteralOutcome(source, index + keyword.length);
  if (outcome === "dynamic") return { kind: "found" };
  return {
    kind: "continue",
    next: outcome === "absent" ? index + 1 : outcome,
  };
}

function skipDynamicImportScanToken(
  source: string,
  index: number,
  alternativeReadings: number[],
): number | null | undefined {
  const char = source[index];
  const next = source[index + 1];

  if (char === "/" && next === "/") return skipLineComment(source, index);
  if (char === "/" && next === "*") return skipBlockComment(source, index);
  if (char === "/") return skipSlashInDynamicImportScan(source, index, alternativeReadings);
  if (char === '"' || char === "'") return skipStringLiteral(source, index);
  if (char !== "`") return undefined;

  const template = readTemplateLiteral(source, index);
  if (template === null || template.scan.hasUnconstrainedDynamicImport) return null;
  return template.end;
}

function skipSlashInDynamicImportScan(
  source: string,
  index: number,
  alternativeReadings: number[],
): number | undefined {
  const regexEnd = skipRegularExpressionLiteral(source, index);
  if (regexEnd === null) return undefined;
  if (canStartRegularExpression(source, index)) return regexEnd;
  // Division is the likelier reading of this slash, but a regular expression
  // also parses here; queue that reading so a quote inside the literal cannot
  // hide a later import.
  alternativeReadings.push(regexEnd);
  return undefined;
}

function readDynamicImportLiteralOutcome(
  source: string,
  index: number,
): number | "absent" | "dynamic" {
  const openParen = skipWhitespaceAndComments(source, index);
  if (source[openParen] !== "(") return "absent";

  const literal = readQuotedStringLiteralAt(
    source,
    skipWhitespaceAndComments(source, openParen + 1),
  );
  if (literal === null) return "dynamic";

  const delimiter = source[skipWhitespaceAndComments(source, literal.end)];
  return delimiter === ")" || delimiter === "," ? literal.end : "dynamic";
}

function readQuotedStringLiteralAt(
  source: string,
  index: number,
): { value: string; end: number } | null {
  const quote = source[index];
  return quote === '"' || quote === "'" ? readStringLiteral(source, index) : null;
}

export function scanModuleSpecifiers(source: string): ModuleSpecifierScan {
  const hasDynamicCodeGeneration = containsDynamicCodeGenerationIdentifier(source);
  const accumulator: MutableScanAccumulator = {
    specifiers: [],
    hasUnconstrainedDynamicImport: false,
    requiresBundling: false,
  };

  let i = 0;
  while (i < source.length) {
    const result = readModuleSpecifierScanStep(source, i, accumulator);
    if (result.kind === "unreadable") {
      return unreadableModuleSpecifierScan(accumulator, hasDynamicCodeGeneration);
    }
    i = result.next;
  }

  return {
    specifiers: accumulator.specifiers,
    hasUnconstrainedDynamicImport: accumulator.hasUnconstrainedDynamicImport ||
      (accumulator.requiresBundling && containsPotentialUnconstrainedDynamicImport(source)),
    requiresBundling: accumulator.requiresBundling,
    hasDynamicCodeGeneration,
  };
}

type ModuleSpecifierScanStep =
  | { kind: "continue"; next: number }
  | { kind: "unreadable" };

function readModuleSpecifierScanStep(
  source: string,
  index: number,
  accumulator: MutableScanAccumulator,
): ModuleSpecifierScanStep {
  const skipped = skipModuleScanToken(source, index, accumulator);
  if (skipped === null) return { kind: "unreadable" };
  if (skipped !== undefined) return { kind: "continue", next: skipped };
  if (source.startsWith("import", index) && isKeywordBoundary(source, index, "import")) {
    readImportSpecifierInto(source, index, accumulator);
    return { kind: "continue", next: index + 1 };
  }
  readExportSpecifierInto(source, index, accumulator);
  return { kind: "continue", next: index + 1 };
}

function readExportSpecifierInto(
  source: string,
  index: number,
  accumulator: MutableScanAccumulator,
): void {
  if (!source.startsWith("export", index) || !isKeywordBoundary(source, index, "export")) return;
  const specifier = readSpecifierAfterFrom(source, index + "export".length);
  if (specifier !== null) accumulator.specifiers.push(specifier);
}

function unreadableModuleSpecifierScan(
  accumulator: MutableScanAccumulator,
  hasDynamicCodeGeneration: boolean,
): ModuleSpecifierScan {
  return {
    specifiers: accumulator.specifiers,
    // An unreadable template hides whatever follows it, so this scan cannot
    // claim the source names no unconstrained import.
    hasUnconstrainedDynamicImport: true,
    requiresBundling: accumulator.requiresBundling,
    hasDynamicCodeGeneration,
  };
}

function skipModuleScanToken(
  source: string,
  index: number,
  accumulator: MutableScanAccumulator,
): number | null | undefined {
  const char = source[index];
  const next = source[index + 1];

  if (char === "/" && next === "/") return skipLineComment(source, index);
  if (char === "/" && next === "*") return skipBlockComment(source, index);
  if (char === "/") return skipSlashInModuleScan(source, index, accumulator);
  if (char === '"' || char === "'") return skipStringLiteral(source, index);
  if (char !== "`") return undefined;

  const template = readTemplateLiteral(source, index);
  if (template === null) return null;
  mergeModuleSpecifierScan(accumulator, template.scan);
  return template.end;
}

function skipSlashInModuleScan(
  source: string,
  index: number,
  accumulator: MutableScanAccumulator,
): number {
  // Distinguishing a regular-expression literal from division requires a full
  // JavaScript parser. The direct Deno loader bypasses the HTTP plugin, so any
  // non-comment slash routes this graph through esbuild, whose parser and HTTP
  // plugin enforce the actual import edges.
  accumulator.requiresBundling = true;
  if (!canStartRegularExpression(source, index)) return index + 1;
  return skipRegularExpressionLiteral(source, index) ?? index + 1;
}

function readImportSpecifierInto(
  source: string,
  index: number,
  accumulator: MutableScanAccumulator,
): void {
  const afterImport = skipWhitespaceAndComments(source, index + "import".length);
  if (source[afterImport] === "(") {
    readDynamicImportSpecifierInto(source, afterImport + 1, accumulator);
    return;
  }

  const sideEffectSpecifier = readStringLiteral(source, afterImport)?.value;
  if (sideEffectSpecifier !== undefined) {
    accumulator.specifiers.push(sideEffectSpecifier);
    return;
  }

  const specifier = readSpecifierAfterFrom(source, afterImport);
  if (specifier !== null) accumulator.specifiers.push(specifier);
}

function readDynamicImportSpecifierInto(
  source: string,
  index: number,
  accumulator: MutableScanAccumulator,
): void {
  const literal = readQuotedStringLiteralAt(source, skipWhitespaceAndComments(source, index));
  if (literal === null) {
    accumulator.hasUnconstrainedDynamicImport = true;
    return;
  }

  const afterLiteral = skipWhitespaceAndComments(source, literal.end);
  if (source[afterLiteral] === ")") {
    accumulator.specifiers.push(literal.value);
    return;
  }
  if (source[afterLiteral] !== ",") {
    accumulator.hasUnconstrainedDynamicImport = true;
    return;
  }

  const argumentIndex = skipWhitespaceAndComments(source, afterLiteral + 1);
  if (source[argumentIndex] === ")") {
    accumulator.specifiers.push(literal.value);
    return;
  }
  const attributesEnd = readStaticImportAttributesArgument(source, argumentIndex);
  if (attributesEnd !== null && source[skipWhitespaceAndComments(source, attributesEnd)] === ")") {
    accumulator.specifiers.push(literal.value);
    return;
  }
  accumulator.hasUnconstrainedDynamicImport = true;
}

/**
 * Every string-literal specifier a module's static text can name: static
 * imports, `export ... from`, side-effect imports, and dynamic `import()`
 * calls whose argument is a literal.
 */
export function extractModuleSpecifiers(source: string): string[] {
  return scanModuleSpecifiers(source).specifiers;
}

export function validateModuleSpecifierHosts(specifiers: string[], allowedHosts: string[]): void {
  for (const url of specifiers) {
    if (/^(?:data|blob):/i.test(url)) {
      throw toError(
        createError({
          type: "api",
          message:
            "[API] handler build failed: inline module URLs cannot be checked against the remote import allow-list.",
        }),
      );
    }
    if (!/^https?:\/\//i.test(url)) continue;
    if (!url) continue;

    let u: URL;
    try {
      u = new URL(url);
    } catch (_) {
      /* expected: URL may be malformed */
      continue;
    }

    if (isAllowedRemoteHost(u, allowedHosts)) continue;

    const remediation =
      `Add "${u.origin}" to security.remoteHosts in veryfront.config.(ts|js) or replace with an approved CDN (e.g., https://esm.sh).`;

    throw toError(
      createError({
        type: "api",
        message:
          `[API] handler build failed: Remote import blocked by allow-list: ${u.origin}. ${remediation}`,
      }),
    );
  }
}

/**
 * Runtime modules whose exports evaluate source text: code handed to them
 * exists only inside strings, so a vetted module can run a `new Worker(...)`
 * or `import(...)` this validator never saw.
 */
const CODE_EVALUATION_MODULES = new Set(["node:vm", "vm"]);

/**
 * Runtime modules whose exports load other modules outside the graph this
 * validator walks: `createRequire` from `node:module` executes a CommonJS
 * module neither the graph walk nor the bundler's HTTP plugin ever reads.
 */
const UNVALIDATED_LOADER_MODULES = new Set(["node:module", "module"]);

/**
 * Runtime worker modules load an entry in a separate module graph that this
 * validator and its HTTP bundler plugin cannot inspect transitively.
 */
const UNVALIDATED_WORKER_LOADER_MODULES = new Set([
  "node:worker_threads",
  "worker_threads",
]);

/**
 * Child-process modules can launch another JavaScript runtime with broader
 * arguments than this module graph was validated for.
 */
const UNVALIDATED_SUBPROCESS_LOADER_MODULES = new Set([
  "node:child_process",
  "child_process",
  "node:cluster",
  "cluster",
]);

/**
 * Why importing `specifier` cannot be checked against the allow-list, or null
 * when the module is not restricted. URL schemes are case-insensitive, so the
 * comparison is too.
 */
export function restrictedRuntimeModuleReason(specifier: string): string | null {
  const normalized = specifier.toLowerCase();
  if (CODE_EVALUATION_MODULES.has(normalized)) {
    return `importing "${specifier}" enables code evaluation that cannot be checked against the remote import allow-list`;
  }
  if (UNVALIDATED_LOADER_MODULES.has(normalized)) {
    return `importing "${specifier}" enables module loading (createRequire) that cannot be checked against the remote import allow-list`;
  }
  if (UNVALIDATED_WORKER_LOADER_MODULES.has(normalized)) {
    return `importing "${specifier}" enables Worker module loading that cannot be checked against the remote import allow-list`;
  }
  if (UNVALIDATED_SUBPROCESS_LOADER_MODULES.has(normalized)) {
    return `importing "${specifier}" enables subprocess module loading that cannot be checked against the remote import allow-list`;
  }
  return null;
}

function assertNoRestrictedRuntimeModules(specifiers: readonly string[]): void {
  for (const specifier of specifiers) {
    const reason = restrictedRuntimeModuleReason(specifier);
    if (reason === null) continue;
    throw toError(
      createError({
        type: "api",
        message: `[API] handler build failed: ${reason}.`,
      }),
    );
  }
}

/** A worker URL that reaches the network or an inline payload the walk cannot vet. */
const REMOTE_OR_INLINE_WORKER_URL = /^(?:https?|data|blob):/i;
const FILE_WORKER_URL = /^file:/i;

/** `import.meta.url`, the only non-literal base a worker URL may resolve against. */
const IMPORT_META_URL_BASE = /^import\s*\.\s*meta\s*\.\s*url\s*[,)]/;

/**
 * How a worker's first constructor argument names its module: `"remote"` for a
 * network or inline URL, `"local"` for one that stays in the project, and
 * `"dynamic"` when this scanner cannot read it as a literal. A local URL
 * carries the specifier when it resolves against the importing module, and null
 * when it resolves against some other base this scanner will not follow.
 */
type WorkerUrlClassification =
  | { kind: "remote" | "dynamic" }
  | { kind: "file"; specifier: null }
  | {
    kind: "local";
    specifier: string | null;
    requiresUnqualifiedWorkerShim?: boolean;
  };

const REMOTE_WORKER: WorkerUrlClassification = { kind: "remote" };
const DYNAMIC_WORKER: WorkerUrlClassification = { kind: "dynamic" };
const FILE_WORKER: WorkerUrlClassification = { kind: "file", specifier: null };

function classifyWorkerUrlLiteral(
  value: string,
  specifier: string | null,
): WorkerUrlClassification {
  if (REMOTE_OR_INLINE_WORKER_URL.test(value)) return REMOTE_WORKER;
  if (FILE_WORKER_URL.test(value)) return FILE_WORKER;
  return { kind: "local", specifier };
}

/**
 * The classification the second argument of a URL construction implies, given a
 * first argument that is already a local literal.
 *
 * A relative first argument means nothing on its own: the base decides where it
 * lands, so a remote base makes the whole URL remote. An absent base and
 * `import.meta.url` both resolve against the importing module, which is the
 * only case whose specifier the graph walk can follow; any other base is either
 * a literal this scanner will not resolve or an expression it cannot read.
 */
function classifyWorkerUrlBase(
  source: string,
  index: number,
  specifier: string,
): WorkerUrlClassification {
  let i = skipWhitespaceAndComments(source, index);
  if (source[i] === ")" || source[i] === undefined) return { kind: "local", specifier };
  if (source[i] !== ",") return DYNAMIC_WORKER;

  i = skipWhitespaceAndComments(source, i + 1);
  if (source[i] === ")") return { kind: "local", specifier };
  if (IMPORT_META_URL_BASE.test(source.slice(i))) return { kind: "local", specifier };

  const base = readConcatenatedStringLiteral(source, i);
  if (base === null) return DYNAMIC_WORKER;
  if (REMOTE_OR_INLINE_WORKER_URL.test(base.value)) return REMOTE_WORKER;
  if (FILE_WORKER_URL.test(base.value)) return FILE_WORKER;
  // A literal base this scanner does not resolve leaves the worker entry
  // unknown: the URL constructor may still read it as remote (it trims
  // whitespace, and accepts schemes these patterns do not name), and a
  // relative base names an entry the graph walk cannot follow. Fail closed
  // rather than report a local worker with no specifier to vet.
  return DYNAMIC_WORKER;
}

/**
 * Whether the first argument at `index` names a fixed URL, and where that URL
 * points. The `new URL(<relative path>, import.meta.url)` idiom is read through
 * to its literal first argument so the common local case stays allowed, and its
 * base is classified too, since a remote base makes a relative first argument
 * remote.
 */
function classifyWorkerUrlArgument(source: string, index: number): WorkerUrlClassification {
  const quote = source[index];
  if (quote === '"' || quote === "'" || quote === "`") {
    const literal = readConcatenatedStringLiteral(source, index);
    if (literal === null) return DYNAMIC_WORKER;
    return classifyWorkerUrlLiteral(literal.value, literal.value);
  }
  return classifyNewWorkerUrlArgument(source, index);
}

function classifyNewWorkerUrlArgument(source: string, index: number): WorkerUrlClassification {
  const urlCallOpenParen = readNewUrlOpenParen(source, index);
  if (urlCallOpenParen === null) return DYNAMIC_WORKER;

  const inner = skipWhitespaceAndComments(source, urlCallOpenParen + 1);
  const literal = readConcatenatedStringLiteral(source, inner);
  if (literal === null) return DYNAMIC_WORKER;
  if (REMOTE_OR_INLINE_WORKER_URL.test(literal.value)) return REMOTE_WORKER;
  return classifyWorkerUrlBase(source, literal.end, literal.value);
}

function readNewUrlOpenParen(source: string, index: number): number | null {
  if (!source.startsWith("new", index) || !isKeywordBoundary(source, index, "new")) return null;
  const urlIndex = skipWhitespaceAndComments(source, index + "new".length);
  if (!source.startsWith("URL", urlIndex) || !isKeywordBoundary(source, urlIndex, "URL")) {
    return null;
  }
  const openParen = skipWhitespaceAndComments(source, urlIndex + "URL".length);
  return source[openParen] === "(" ? openParen : null;
}

/** Every worker construction in `source`, in source order. */
function* textualWorkerUrlClassifications(source: string): Generator<WorkerUrlClassification> {
  const keyword = "new";
  let i = source.indexOf(keyword);
  while (i !== -1) {
    const argumentIndex = readWorkerConstructorArgumentIndex(source, i);
    if (argumentIndex !== null) yield classifyWorkerUrlArgument(source, argumentIndex);
    i = source.indexOf(keyword, i + keyword.length);
  }
}

function readWorkerConstructorArgumentIndex(source: string, index: number): number | null {
  if (!isKeywordBoundary(source, index, "new")) return null;
  let workerIndex = skipWhitespaceAndComments(source, index + "new".length);
  if (
    !source.startsWith("Worker", workerIndex) ||
    !isKeywordBoundary(source, workerIndex, "Worker")
  ) return null;
  workerIndex = skipWhitespaceAndComments(source, workerIndex + "Worker".length);
  return source[workerIndex] === "(" ? skipWhitespaceAndComments(source, workerIndex + 1) : null;
}

function containsFallbackCapabilityName(source: string, names: readonly string[]): boolean {
  const decoded = decodeIdentifierEscapes(source);
  return containsIdentifierName(decoded, names);
}

function fallbackWorkerUrlClassifications(source: string): WorkerUrlClassification[] {
  const workers = [...textualWorkerUrlClassifications(source)];
  const decoded = decodeIdentifierEscapes(source);
  if (countIdentifierName(decoded, "Worker") > workers.length) {
    workers.push(DYNAMIC_WORKER);
  }
  return workers;
}

/** Prefer parser-backed lexical binding semantics, retaining fail-closed text scanning on parse failure. */
async function workerUrlClassifications(
  source: string,
): Promise<readonly WorkerUrlClassification[]> {
  const analysis = await analyzeSourceCapabilities(source);
  return analysis?.workers ?? fallbackWorkerUrlClassifications(source);
}

/**
 * The first worker construction whose first argument escapes what this scanner
 * can vet, or null when every worker names a local literal URL.
 *
 * A worker's own loader fetches and executes its entry outside the HTTP bundler
 * plugin, so `security.remoteHosts` never sees it and bundling cannot constrain
 * it. A remote, inline, or file URL is therefore reported as `"remote"`, and a URL this
 * scanner cannot read as a literal fails closed as `"dynamic"`.
 */
async function findModuleWorkerViolation(
  source: string,
): Promise<WorkerViolation | null> {
  return firstWorkerViolation(await workerUrlClassifications(source));
}

function firstWorkerViolation(
  workers: readonly WorkerUrlClassification[],
): WorkerViolation | null {
  for (const worker of workers) {
    if (worker.kind === "file") return "remote";
    if (worker.kind !== "local") return worker.kind;
    // A local worker without a specifier names an entry no graph walk can vet.
    if (worker.specifier === null) return "dynamic";
    if (worker.requiresUnqualifiedWorkerShim === true) return "shim";
  }
  return null;
}

type WorkerViolation = "remote" | "dynamic" | "shim";

function workerViolationDetail(violation: WorkerViolation): string {
  if (violation === "remote") {
    return "a Worker() loading a remote, inline, or file URL bypasses the remote import allow-list";
  }
  if (violation === "shim") {
    return "a relative string Worker constructor cannot be preserved while bundling";
  }
  return "a Worker() with a non-literal URL cannot be checked against the remote import allow-list";
}

/**
 * The module specifiers of every local worker this source starts, resolved
 * against the importing module, and null for a local worker whose base this
 * scanner does not follow.
 *
 * A worker entry is executed by the worker's own loader, which the HTTP plugin
 * never sees, so a caller that vets a module graph must vet these entries too.
 */
export async function collectLocalWorkerSpecifiers(
  source: string,
): Promise<Array<string | null>> {
  const specifiers: Array<string | null> = [];
  for (const classification of await workerUrlClassifications(source)) {
    if (classification.kind === "local") specifiers.push(classification.specifier);
    else if (classification.kind === "file") specifiers.push(null);
  }
  return specifiers;
}

/**
 * Refuse a worker whose module cannot be checked against the allow-list.
 * A remote, inline, or file worker URL is rejected outright — even an allow-listed
 * origin, since the worker loader bypasses the HTTP plugin and bundling cannot
 * help — and a non-literal worker URL fails closed.
 */
export async function validateModuleWorkers(source: string): Promise<void> {
  const violation = await findModuleWorkerViolation(source);
  if (violation === null) return;
  throw toError(
    createError({
      type: "api",
      message: `[API] handler build failed: ${workerViolationDetail(violation)}.`,
    }),
  );
}

export interface ValidatedModuleScan {
  readonly specifiers: readonly string[];
  readonly hasUnconstrainedDynamicImport: boolean;
  readonly requiresBundling: boolean;
  readonly parserBacked: boolean;
  readonly localWorkerSpecifiers: readonly string[];
}

export async function validateHTTPImports(
  source: string,
  allowedHosts: string[],
): Promise<ValidatedModuleScan> {
  const scan = scanModuleSpecifiers(source);
  const analysis = await analyzeSourceCapabilities(source);
  const specifiers = analysis?.moduleSpecifiers ?? scan.specifiers;
  validateModuleSpecifierHosts([...specifiers], allowedHosts);
  assertNoRestrictedRuntimeModules(specifiers);
  const workers = analysis?.workers ?? fallbackWorkerUrlClassifications(source);
  const workerViolation = firstWorkerViolation(workers);
  if (workerViolation !== null) {
    throw toError(
      createError({
        type: "api",
        message: `[API] handler build failed: ${workerViolationDetail(workerViolation)}.`,
      }),
    );
  }

  const fallbackHasDynamicCodeGeneration = scan.hasDynamicCodeGeneration ||
    containsFallbackCapabilityName(source, [
      "eval",
      "Function",
      "constructor",
      "globalThis",
      "self",
      "window",
      "Reflect",
    ]);
  if (analysis?.hasDynamicCodeGeneration ?? fallbackHasDynamicCodeGeneration) {
    throw toError(
      createError({
        type: "api",
        message:
          "[API] handler build failed: dynamic code generation cannot be checked against the remote import allow-list.",
      }),
    );
  }

  const hasUnconstrainedDynamicImport = analysis?.hasUnconstrainedDynamicImport ??
    scan.hasUnconstrainedDynamicImport;
  if (hasUnconstrainedDynamicImport) {
    throw toError(
      createError({
        type: "api",
        message:
          "[API] handler build failed: unconstrained dynamic import cannot be allow-listed statically.",
      }),
    );
  }

  return {
    specifiers,
    hasUnconstrainedDynamicImport,
    requiresBundling: scan.requiresBundling,
    parserBacked: analysis !== null,
    localWorkerSpecifiers: workers.flatMap((worker) =>
      worker.kind === "local" && worker.specifier !== null ? [worker.specifier] : []
    ),
  };
}
