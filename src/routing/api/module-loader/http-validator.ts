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

  if (char === "\n") return { value: "", end: index + 1 };
  if (char === "\r") {
    const end = source[index + 1] === "\n" ? index + 2 : index + 1;
    return { value: "", end };
  }

  const simpleEscapes: Record<string, string> = {
    "0": "\0",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
  };
  if (simpleEscapes[char] !== undefined) return { value: simpleEscapes[char], end: index + 1 };

  if (char === "x") {
    const hex = source.slice(index + 1, index + 3);
    if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return null;
    return { value: String.fromCodePoint(Number.parseInt(hex, 16)), end: index + 3 };
  }

  if (char === "u" && source[index + 1] === "{") {
    const close = source.indexOf("}", index + 2);
    if (close === -1) return null;
    const hex = source.slice(index + 2, close);
    if (!/^[0-9A-Fa-f]+$/.test(hex)) return null;
    const codePoint = Number.parseInt(hex, 16);
    if (codePoint > 0x10FFFF) return null;
    return { value: String.fromCodePoint(codePoint), end: close + 1 };
  }

  if (char === "u") {
    const hex = source.slice(index + 1, index + 5);
    if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return null;
    return { value: String.fromCodePoint(Number.parseInt(hex, 16)), end: index + 5 };
  }

  return { value: char, end: index + 1 };
}

function readStringLiteral(source: string, index: number): { value: string; end: number } | null {
  const quote = source[index];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;

  let value = "";
  for (let i = index + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      const escaped = readEscapedCharacter(source, i + 1);
      if (escaped === null) return null;
      value += escaped.value;
      i = escaped.end - 1;
      continue;
    }
    if (char === quote) return { value, end: i + 1 };
    value += char;
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
  const specifiers: string[] = [];
  let hasUnconstrainedDynamicImport = false;
  let requiresBundling = false;
  const bodyStart = openBraceIndex + 1;
  let depth = 1;

  for (let i = bodyStart; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (char === "/" && next === "/") {
      i = skipLineComment(source, i) - 1;
      continue;
    }
    if (char === "/" && next === "*") {
      i = skipBlockComment(source, i) - 1;
      continue;
    }
    if (char === "/") {
      // Slash syntax still routes the graph through esbuild, but the brace
      // walk cannot stop here: a `}` inside a regular-expression literal —
      // `${/[}]/.test("}") ? import(target) : ""}` — would close the
      // interpolation early and leave the rest of the executable expression
      // read as template text. Skip the literal so the whole body is scanned.
      requiresBundling = true;
      if (canStartRegularExpression(source, i)) {
        const regexEnd = skipRegularExpressionLiteral(source, i);
        if (regexEnd !== null) i = regexEnd - 1;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      i = skipStringLiteral(source, i) - 1;
      continue;
    }
    if (char === "`") {
      const template = readTemplateLiteral(source, i);
      if (template === null) return null;
      specifiers.push(...template.scan.specifiers);
      hasUnconstrainedDynamicImport ||= template.scan.hasUnconstrainedDynamicImport;
      requiresBundling ||= template.scan.requiresBundling;
      i = template.end - 1;
      continue;
    }
    if (char === "{") {
      depth++;
      continue;
    }
    if (char === "}") {
      depth--;
      if (depth === 0) {
        return {
          body: source.slice(bodyStart, i),
          end: i + 1,
          scan: {
            specifiers,
            hasUnconstrainedDynamicImport,
            requiresBundling,
            hasDynamicCodeGeneration: containsDynamicCodeGenerationIdentifier(
              source.slice(bodyStart, i),
            ),
          },
        };
      }
    }
  }

  return null;
}

function readTemplateLiteral(
  source: string,
  index: number,
): { end: number; scan: ModuleSpecifierScan } | null {
  const specifiers: string[] = [];
  let hasUnconstrainedDynamicImport = false;
  let requiresBundling = false;
  if (source[index] !== "`") return null;

  for (let i = index + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === "`") {
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
    }
    if (char === "$" && source[i + 1] === "{") {
      const expression = readTemplateExpression(source, i + 1);
      if (expression === null) return null;
      const expressionScan = scanModuleSpecifiers(expression.body);
      specifiers.push(...expressionScan.specifiers);
      specifiers.push(...expression.scan.specifiers);
      hasUnconstrainedDynamicImport ||= expressionScan.hasUnconstrainedDynamicImport ||
        expression.scan.hasUnconstrainedDynamicImport;
      requiresBundling ||= expressionScan.requiresBundling || expression.scan.requiresBundling;
      i = expression.end - 1;
    }
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

  const states: Array<"key" | "colon" | "value" | "commaOrClose"> = [];
  for (; i < source.length; i++) {
    i = skipWhitespaceAndComments(source, i);
    const char = source[i];
    if (char === undefined) return null;

    if (char === '"' || char === "'") {
      const literal = readStringLiteral(source, i);
      if (literal === null) return null;
      const state = states.at(-1);
      if (state === "colon") return null;
      if (state === "key") {
        states[states.length - 1] = "colon";
      } else if (state === "value") {
        states[states.length - 1] = "commaOrClose";
      } else {
        return null;
      }
      i = literal.end - 1;
      continue;
    }

    if (char === "{") {
      const state = states.at(-1);
      if (state === "colon" || state === "commaOrClose") return null;
      if (state === "value") states[states.length - 1] = "commaOrClose";
      states.push("key");
      continue;
    }

    if (char === "}") {
      const state = states.pop();
      if (state === undefined || state === "colon" || state === "value") return null;
      if (states.length === 0) return i + 1;
      continue;
    }

    if (char === ":") {
      if (states.at(-1) !== "colon") return null;
      states[states.length - 1] = "value";
      continue;
    }

    if (char === ",") {
      if (states.at(-1) !== "commaOrClose") return null;
      states[states.length - 1] = "key";
      continue;
    }

    if (/[A-Za-z_$]/.test(char)) {
      if (states.at(-1) !== "key") return null;
      let end = i + 1;
      while (isIdentifierChar(source[end])) end++;
      states[states.length - 1] = "colon";
      i = end - 1;
      continue;
    }

    if (/\s/.test(char)) continue;

    return null;
  }

  return null;
}

function previousSignificantCharacter(source: string, index: number): string | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const char = source[i];
    if (!/\s/.test(char ?? "")) return char;
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

  for (let i = index + 1; i < source.length; i++) {
    const char = source[i];

    if (char === "\\") {
      i++;
      continue;
    }
    if (char === "\n" || char === "\r") return null;
    if (char === "[") {
      inCharacterClass = true;
      continue;
    }
    if (char === "]") {
      inCharacterClass = false;
      continue;
    }
    if (char === "/" && !inCharacterClass) {
      let end = i + 1;
      while (/[A-Za-z]/.test(source[end] ?? "")) end++;
      return end;
    }
  }

  return null;
}

function readSpecifierAfterFrom(source: string, index: number): string | null {
  let i = index;
  while (i < source.length) {
    i = skipWhitespaceAndComments(source, i);
    const char = source[i];
    const next = source[i + 1];

    if (char === '"' || char === "'" || char === "`") {
      i = skipStringLiteral(source, i);
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
    if (char === ";" || char === undefined) return null;

    if (
      source.startsWith("from", i) &&
      isKeywordBoundary(source, i, "from")
    ) {
      const specifierIndex = skipWhitespaceAndComments(source, i + "from".length);
      const specifier = readStringLiteral(source, specifierIndex);
      // `from` is a legal binding name, as in `import { from as value } from
      // "..."`. Only the occurrence a string literal follows is the module
      // clause; keep scanning past any other so the real specifier is read.
      if (specifier !== null) return specifier.value;
      i += "from".length;
      continue;
    }

    i++;
  }
  return null;
}

export type ModuleSpecifierScan = {
  specifiers: string[];
  hasUnconstrainedDynamicImport: boolean;
  /** Slash syntax needs a real parser before the source can execute directly. */
  requiresBundling: boolean;
  /** Dynamic code generation can synthesize imports after static validation. */
  hasDynamicCodeGeneration: boolean;
};

const DYNAMIC_CODE_GENERATION_IDENTIFIER = /(^|[^A-Za-z0-9_$])(eval|Function)(?![A-Za-z0-9_$])/;
const DYNAMIC_CODE_GENERATION_NAME =
  /(^|[^A-Za-z0-9_$])(eval|Function|constructor)(?![A-Za-z0-9_$])/;
const IDENTIFIER_UNICODE_ESCAPE = /\\u\{([0-9A-Fa-f]{1,6})\}|\\u([0-9A-Fa-f]{4})/g;
const COMPUTED_STRING_PROPERTY =
  /\[((?:"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')\s*(?:\+\s*(?:"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')\s*)+)\]/g;
const CONSTRUCTOR_PROPERTY_REFERENCE =
  /(?:\.\s*constructor\b|\[\s*(?:"constructor"|'constructor')\s*\])/;
const DESTRUCTURED_CONSTRUCTOR_REFERENCE =
  /(?:\{|,)\s*(?:constructor|"constructor"|'constructor')\s*(?::|[,}])/;

function readStaticStringParts(expression: string): string | null {
  let value = "";
  let i = 0;
  while (i < expression.length) {
    i = skipWhitespaceAndComments(expression, i);
    const literal = readStringLiteral(expression, i);
    if (literal === null) return null;
    value += literal.value;
    i = skipWhitespaceAndComments(expression, literal.end);
    if (i >= expression.length) return value;
    if (expression[i] !== "+") return null;
    i++;
  }
  return value;
}

function containsComputedDynamicCodeGenerationProperty(source: string): boolean {
  for (const match of source.matchAll(COMPUTED_STRING_PROPERTY)) {
    const property = readStaticStringParts(match[1] ?? "");
    if (property === "eval" || property === "Function" || property === "constructor") return true;
  }
  return false;
}

/**
 * Whether a template literal carries no `${...}` substitution, and therefore
 * spells one fixed string the way a quoted literal does.
 */
function isSubstitutionFreeTemplate(source: string, index: number, end: number): boolean {
  for (let i = index + 1; i < end - 1; i++) {
    if (source[i] === "\\") {
      i++;
      continue;
    }
    if (source[i] === "$" && source[i + 1] === "{") return false;
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
    for (let i = source.indexOf(globalName); i !== -1; i = source.indexOf(globalName, i + 1)) {
      if (!isKeywordBoundary(source, i, globalName)) continue;
      let openBracket = skipWhitespaceAndComments(source, i + globalName.length);
      // `globalThis?.[name]` reads the same property as `globalThis[name]`.
      if (source[openBracket] === "?" && source[openBracket + 1] === ".") {
        openBracket = skipWhitespaceAndComments(source, openBracket + 2);
      }
      if (source[openBracket] !== "[") continue;
      const property = readConcatenatedStringLiteral(source, openBracket + 1);
      if (property === null || source[skipWhitespaceAndComments(source, property.end)] !== "]") {
        return true;
      }
      if (property.value === "eval" || property.value === "Function") return true;
    }
  }
  return false;
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
    if (DYNAMIC_CODE_GENERATION_NAME.test(concatenated.value)) {
      const raw = source.slice(i, concatenated.end);
      // Concatenation hides the name by construction; a lone literal only
      // hides it when escapes kept the raw text from spelling it.
      if (concatenated.parts > 1 || !DYNAMIC_CODE_GENERATION_NAME.test(raw)) return true;
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
  return DYNAMIC_CODE_GENERATION_IDENTIFIER.test(source) ||
    containsComputedDynamicCodeGenerationProperty(source) ||
    containsComputedGlobalDynamicCodeGeneration(source) ||
    containsConcatenatedDynamicCodeGenerationName(source) ||
    CONSTRUCTOR_PROPERTY_REFERENCE.test(source) ||
    DESTRUCTURED_CONSTRUCTOR_REFERENCE.test(source);
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
  const keyword = "import";
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (char === "/" && next === "/") {
      i = skipLineComment(source, i) - 1;
      continue;
    }
    if (char === "/" && next === "*") {
      i = skipBlockComment(source, i) - 1;
      continue;
    }
    if (char === "/") {
      const regexEnd = skipRegularExpressionLiteral(source, i);
      if (regexEnd !== null) {
        if (canStartRegularExpression(source, i)) {
          i = regexEnd - 1;
          continue;
        }
        // Division is the likelier reading of this slash, but a regular
        // expression also parses here; queue that reading so a quote inside
        // the literal cannot hide a later import.
        alternativeReadings.push(regexEnd);
      }
    }
    if (char === '"' || char === "'") {
      i = skipStringLiteral(source, i) - 1;
      continue;
    }
    if (char === "`") {
      const template = readTemplateLiteral(source, i);
      if (template === null) return true;
      if (template.scan.hasUnconstrainedDynamicImport) return true;
      i = template.end - 1;
      continue;
    }

    if (!source.startsWith(keyword, i) || !isKeywordBoundary(source, i, keyword)) continue;
    const openParen = skipWhitespaceAndComments(source, i + keyword.length);
    if (source[openParen] !== "(") continue;

    const specifierIndex = skipWhitespaceAndComments(source, openParen + 1);
    const quote = source[specifierIndex];
    const literal = quote === '"' || quote === "'"
      ? readStringLiteral(source, specifierIndex)
      : null;
    if (literal === null) return true;

    const delimiter = source[skipWhitespaceAndComments(source, literal.end)];
    if (delimiter !== ")" && delimiter !== ",") return true;
  }
  return false;
}

export function scanModuleSpecifiers(source: string): ModuleSpecifierScan {
  const specifiers: string[] = [];
  let hasUnconstrainedDynamicImport = false;
  let requiresBundling = false;
  const hasDynamicCodeGeneration = containsDynamicCodeGenerationIdentifier(source);

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (char === "/" && next === "/") {
      i = skipLineComment(source, i) - 1;
      continue;
    }
    if (char === "/" && next === "*") {
      i = skipBlockComment(source, i) - 1;
      continue;
    }
    if (char === "/") {
      // Distinguishing a regular-expression literal from division requires a
      // full JavaScript parser. The direct Deno loader bypasses the HTTP
      // plugin, so any non-comment slash routes this graph through esbuild,
      // whose parser and HTTP plugin enforce the actual import edges.
      requiresBundling = true;
      if (canStartRegularExpression(source, i)) {
        const regexEnd = skipRegularExpressionLiteral(source, i);
        if (regexEnd !== null) i = regexEnd - 1;
      }
      continue;
    }
    if (char === "`") {
      const template = readTemplateLiteral(source, i);
      if (template === null) {
        return {
          specifiers,
          hasUnconstrainedDynamicImport,
          requiresBundling,
          hasDynamicCodeGeneration,
        };
      }
      specifiers.push(...template.scan.specifiers);
      hasUnconstrainedDynamicImport ||= template.scan.hasUnconstrainedDynamicImport;
      requiresBundling ||= template.scan.requiresBundling;
      i = template.end - 1;
      continue;
    }
    if (char === '"' || char === "'") {
      i = skipStringLiteral(source, i) - 1;
      continue;
    }

    if (source.startsWith("import", i) && isKeywordBoundary(source, i, "import")) {
      const afterImport = skipWhitespaceAndComments(source, i + "import".length);
      if (source[afterImport] === "(") {
        const specifierIndex = skipWhitespaceAndComments(source, afterImport + 1);
        const specifierQuote = source[specifierIndex];
        const literal = specifierQuote === '"' || specifierQuote === "'"
          ? readStringLiteral(source, specifierIndex)
          : null;
        if (literal !== null) {
          const afterLiteral = skipWhitespaceAndComments(source, literal.end);
          if (source[afterLiteral] === ")") {
            specifiers.push(literal.value);
            continue;
          }
          if (source[afterLiteral] === ",") {
            const argumentIndex = skipWhitespaceAndComments(source, afterLiteral + 1);
            if (source[argumentIndex] === ")") {
              specifiers.push(literal.value);
              continue;
            }
            const attributesEnd = readStaticImportAttributesArgument(source, argumentIndex);
            if (
              attributesEnd !== null &&
              source[skipWhitespaceAndComments(source, attributesEnd)] === ")"
            ) {
              specifiers.push(literal.value);
              continue;
            }
          }
          hasUnconstrainedDynamicImport = true;
        } else {
          hasUnconstrainedDynamicImport = true;
        }
        continue;
      }

      const sideEffectSpecifier = readStringLiteral(source, afterImport)?.value;
      if (sideEffectSpecifier !== undefined) {
        specifiers.push(sideEffectSpecifier);
        continue;
      }

      const specifier = readSpecifierAfterFrom(source, afterImport);
      if (specifier !== null) specifiers.push(specifier);
      continue;
    }

    if (source.startsWith("export", i) && isKeywordBoundary(source, i, "export")) {
      const specifier = readSpecifierAfterFrom(source, i + "export".length);
      if (specifier !== null) specifiers.push(specifier);
    }
  }

  return {
    specifiers,
    hasUnconstrainedDynamicImport: hasUnconstrainedDynamicImport ||
      (requiresBundling && containsPotentialUnconstrainedDynamicImport(source)),
    requiresBundling,
    hasDynamicCodeGeneration,
  };
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
  | { kind: "local"; specifier: string | null };

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
  return classifyWorkerUrlLiteral(base.value, null);
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
  if (source.startsWith("new", index) && isKeywordBoundary(source, index, "new")) {
    let j = skipWhitespaceAndComments(source, index + "new".length);
    if (source.startsWith("URL", j) && isKeywordBoundary(source, j, "URL")) {
      j = skipWhitespaceAndComments(source, j + "URL".length);
      if (source[j] === "(") {
        const inner = skipWhitespaceAndComments(source, j + 1);
        const literal = readConcatenatedStringLiteral(source, inner);
        if (literal !== null) {
          if (REMOTE_OR_INLINE_WORKER_URL.test(literal.value)) return REMOTE_WORKER;
          return classifyWorkerUrlBase(source, literal.end, literal.value);
        }
      }
    }
  }
  return DYNAMIC_WORKER;
}

/** Every worker construction in `source`, in source order. */
function* textualWorkerUrlClassifications(source: string): Generator<WorkerUrlClassification> {
  const keyword = "new";
  for (let i = source.indexOf(keyword); i !== -1; i = source.indexOf(keyword, i + 1)) {
    if (!isKeywordBoundary(source, i, keyword)) continue;
    let j = skipWhitespaceAndComments(source, i + keyword.length);
    if (!source.startsWith("Worker", j) || !isKeywordBoundary(source, j, "Worker")) continue;
    j = skipWhitespaceAndComments(source, j + "Worker".length);
    if (source[j] !== "(") continue;
    yield classifyWorkerUrlArgument(source, skipWhitespaceAndComments(source, j + 1));
  }
}

function containsFallbackCapabilityName(source: string, names: readonly string[]): boolean {
  const decoded = decodeIdentifierEscapes(source);
  return names.some((name) => {
    const pattern = new RegExp(`(^|[^\\p{ID_Continue}$])${name}(?![\\p{ID_Continue}$])`, "u");
    return pattern.test(decoded);
  });
}

function fallbackWorkerUrlClassifications(source: string): WorkerUrlClassification[] {
  const workers = [...textualWorkerUrlClassifications(source)];
  if (workers.length === 0 && containsFallbackCapabilityName(source, ["Worker"])) {
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
): Promise<"remote" | "dynamic" | null> {
  for (const classification of await workerUrlClassifications(source)) {
    if (classification.kind === "file") return "remote";
    if (classification.kind !== "local") return classification.kind;
  }
  return null;
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
  const detail = violation === "remote"
    ? "a Worker() loading a remote, inline, or file URL bypasses the remote import allow-list"
    : "a Worker() with a non-literal URL cannot be checked against the remote import allow-list";
  throw toError(
    createError({
      type: "api",
      message: `[API] handler build failed: ${detail}.`,
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
  const workers = analysis?.workers ?? fallbackWorkerUrlClassifications(source);
  const workerViolation = workers.find((worker) => worker.kind !== "local");
  if (workerViolation) {
    const detail = workerViolation.kind === "remote" || workerViolation.kind === "file"
      ? "a Worker() loading a remote, inline, or file URL bypasses the remote import allow-list"
      : "a Worker() with a non-literal URL cannot be checked against the remote import allow-list";
    throw toError(
      createError({
        type: "api",
        message: `[API] handler build failed: ${detail}.`,
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
