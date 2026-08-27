/**
 * CSS Strip Stage - removes CSS import statements from compiled code.
 *
 * CSS files are not valid JS modules and will crash both the SSR module
 * loader and browser module system if left in compiled code. This plugin
 * strips them and records the CSS specifiers in pipeline metadata for
 * downstream collection (used by the SSR rendering pipeline to include
 * the CSS content in the HTML output).
 *
 * For CSS Module imports (`import styles from "./X.module.css"`), the
 * import is replaced with a Proxy stub that returns the property name
 * as the class name. This matches the Next.js convention where
 * `styles.container` → `"container"` (identity mapping), which works
 * correctly with Tailwind CSS class-based styling.
 */

import type { TransformPlugin } from "../types.ts";
import { TransformStage } from "../types.ts";
import { parseImports, rewriteImports } from "../../esm/lexer.ts";
import { splitSpecifierSuffix } from "#veryfront/transforms/shared/specifier-suffix.ts";
import { defineError } from "#veryfront/errors";
import {
  getCssModuleScope,
  resolveCssModuleKey,
  toScopedCssModuleClass,
} from "#veryfront/transforms/css-modules/naming.ts";

const CSS_COMMENT_MASK_SENTINEL_EXHAUSTED = defineError({
  slug: "css-comment-mask-sentinel-exhausted",
  category: "BUILD",
  status: 500,
  title: "CSS import comment masking failed",
  suggestion: "Reduce private-use characters in the transformed module.",
});

function isCSSImport(specifier: string | undefined): boolean {
  return specifier !== undefined && splitSpecifierSuffix(specifier).path.endsWith(".css");
}

function isCssModuleImport(specifier: string | undefined): boolean {
  return specifier !== undefined && splitSpecifierSuffix(specifier).path.endsWith(".module.css");
}

/**
 * Whether source text can decode to the suffix of a CSS module specifier.
 *
 * Module specifiers are string literals, so the raw source does not have to
 * contain `.css`: `"./theme\\x2ecss"` names the same module. Decode only the
 * escape forms that can contribute to this suffix (plus line continuations)
 * before taking the expensive masking path. False positives outside strings
 * are harmless; avoiding false negatives here is what keeps escaped CSS
 * imports from bypassing the transform.
 */
function mayContainCSSSpecifier(code: string): boolean {
  if (code.includes(".css")) return true;
  if (!code.includes("\\")) return false;
  const decoded = code.replace(
    /\\(?:x([\da-fA-F]{2})|u\{([\da-fA-F]{1,6})\}|u([\da-fA-F]{4})|(\r\n|[\n\r\u2028\u2029])|([.cs]))/g,
    (
      match,
      hex: string | undefined,
      braced: string | undefined,
      unicode: string | undefined,
      continuation: string | undefined,
      identity: string | undefined,
    ) => {
      if (continuation !== undefined) return "";
      if (identity !== undefined) return identity;
      const codePoint = Number.parseInt(hex ?? braced ?? unicode ?? "", 16);
      if (!Number.isInteger(codePoint) || codePoint > 0x10ffff) return match;
      return String.fromCodePoint(codePoint);
    },
  );
  return decoded.includes(".css");
}

function cssModuleProxyExpression(): string {
  return "new Proxy({}, { get: (_, p) => String(p) })";
}

function cssComment(label: string, specifier: string): string {
  return `/* css ${label}: ${specifier.replaceAll("*/", "*\\/")} */`;
}

/** Serialize data embedded in generated JavaScript without leaving HTML raw-text delimiters. */
function serializeJavaScriptString(value: string): string {
  return JSON.stringify(value).replace(
    /[<>\u2028\u2029]/g,
    (char) => `\\u${char.codePointAt(0)?.toString(16).padStart(4, "0")}`,
  );
}

function scopedCssModuleProxyExpression(moduleKey: string): string {
  const scope = getCssModuleScope(moduleKey);
  const base = serializeJavaScriptString(`${scope.base}_`);
  const hash = serializeJavaScriptString(`__${scope.hash}`);
  return `new Proxy({}, { get: (_, p) => typeof p === "string" ? ${base} + String(p).replace(/[^\\w-]/g, "_") + ${hash} : "" })`;
}

type NamedImportBinding = { imported: string; local: string };
type StringQuote = '"' | "'";
type JavaScriptQuote = StringQuote | "`";

function parseNamedImportBindings(
  namedClause: string,
  allowQuotedAlias = false,
): NamedImportBinding[] {
  const bindings: NamedImportBinding[] = [];

  for (const rawPart of splitNamedImportBindings(namedClause)) {
    const part = rawPart.trim();
    if (!part) continue;

    const aliasMatch = part.match(
      /^(?:([_$a-zA-Z][\w$-]*)|("(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'))\s+as\s+(?:([_$a-zA-Z][\w$]*)|("(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'))$/,
    );
    if (aliasMatch) {
      const imported = aliasMatch[1] ?? parseQuotedExportName(aliasMatch[2]);
      const local = aliasMatch[3] ??
        (allowQuotedAlias ? parseQuotedExportName(aliasMatch[4]) : undefined);
      if (imported === undefined || local === undefined) continue;
      bindings.push({ imported, local });
      continue;
    }

    if (/^[_$a-zA-Z][\w$]*$/.test(part)) {
      bindings.push({ imported: part, local: part });
      continue;
    }

    const quotedName = allowQuotedAlias ? parseQuotedExportName(part) : undefined;
    if (quotedName !== undefined) {
      bindings.push({ imported: quotedName, local: quotedName });
    }
  }

  return bindings;
}

function splitNamedImportBindings(namedClause: string): string[] {
  const bindings: string[] = [];
  let start = 0;
  let quote: StringQuote | undefined;
  let escaped = false;

  for (let index = 0; index < namedClause.length; index++) {
    const char = namedClause[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ",") {
      bindings.push(namedClause.slice(start, index));
      start = index + 1;
    }
  }

  bindings.push(namedClause.slice(start));
  return bindings;
}

function extractNamedImportClause(clause: string): string | undefined {
  const trimmed = clause.trim();
  if (!trimmed.startsWith("{")) return undefined;

  let quote: StringQuote | undefined;
  let escaped = false;
  for (let index = 1; index < trimmed.length; index++) {
    const char = trimmed[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "}") {
      return trimmed.slice(index + 1).trim().length === 0 ? trimmed.slice(1, index) : undefined;
    }
  }

  return undefined;
}

/**
 * ECMAScript ends a line comment at any of four line terminators, not just LF:
 * CR (U+000D), LS (U+2028) and PS (U+2029) close one as well. Scanning for
 * `\n` alone makes `import styles // decoy\r from "./x.module.css"` look like a
 * comment that runs to end of input, which drops the binding the statement
 * introduces and leaves its uses undefined.
 */
function isLineTerminator(char: string | undefined): boolean {
  return char === "\n" || char === "\r" || char === "\u2028" || char === "\u2029";
}

function findLineTerminatorIndex(value: string, from: number): number {
  for (let index = from; index < value.length; index++) {
    if (isLineTerminator(value[index])) return index;
  }
  return -1;
}

function findCommentEndIndex(value: string, index: number): number | undefined {
  if (value[index] !== "/") return undefined;
  if (value[index + 1] === "/") {
    const lineEnd = findLineTerminatorIndex(value, index + 2);
    return lineEnd === -1 ? -1 : lineEnd + 1;
  }
  if (value[index + 1] === "*") {
    const blockEnd = value.indexOf("*/", index + 2);
    return blockEnd === -1 ? -1 : blockEnd + 2;
  }
  return undefined;
}

function scanQuotedImportClauseCharacter(
  char: string,
  quote: StringQuote,
  escaped: boolean,
): { quote: StringQuote | undefined; escaped: boolean } {
  if (escaped) return { quote, escaped: false };
  if (char === "\\") return { quote, escaped: true };
  return { quote: char === quote ? undefined : quote, escaped: false };
}

function stripImportClauseComments(clause: string): string {
  let stripped = "";
  let quote: StringQuote | undefined;
  let escaped = false;
  let index = 0;

  while (index < clause.length) {
    const char = clause[index]!;
    if (quote) {
      stripped += char;
      ({ quote, escaped } = scanQuotedImportClauseCharacter(char, quote, escaped));
      index++;
      continue;
    }

    const commentEnd = findCommentEndIndex(clause, index);
    if (commentEnd !== undefined) {
      if (commentEnd === -1) return stripped;
      stripped += " ";
      index = commentEnd;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      stripped += char;
    } else {
      stripped += char;
    }
    index++;
  }

  return stripped;
}

function parseQuotedExportName(token: string | undefined): string | undefined {
  if (!token || token.length < 2) return undefined;
  const quote = token[0];
  if ((quote !== '"' && quote !== "'") || token.at(-1) !== quote) return undefined;

  let decoded = "";
  for (let index = 1; index < token.length - 1; index++) {
    const char = token[index];
    if (char !== "\\") {
      decoded += char;
      continue;
    }

    const escaped = token[++index];
    if (escaped === undefined || index >= token.length - 1) return undefined;
    const simpleEscapes: Record<string, string> = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "0": "\0",
      "\\": "\\",
      '"': '"',
      "'": "'",
    };
    if (escaped in simpleEscapes) {
      decoded += simpleEscapes[escaped];
      continue;
    }

    if (escaped === "\n" || escaped === "\u2028" || escaped === "\u2029") continue;
    if (escaped === "\r") {
      if (token[index + 1] === "\n") index++;
      continue;
    }

    if (escaped === "x") {
      const hex = token.slice(index + 1, index + 3);
      if (!/^[\da-fA-F]{2}$/.test(hex)) return undefined;
      decoded += String.fromCodePoint(Number.parseInt(hex, 16));
      index += 2;
      continue;
    }

    if (escaped === "u") {
      const braced = token[index + 1] === "{";
      const end = braced ? token.indexOf("}", index + 2) : index + 5;
      const hex = braced ? token.slice(index + 2, end) : token.slice(index + 1, end);
      if (end === -1 || !/^[\da-fA-F]+$/.test(hex) || (!braced && hex.length !== 4)) {
        return undefined;
      }
      const codePoint = Number.parseInt(hex, 16);
      if (codePoint > 0x10ffff) return undefined;
      decoded += String.fromCodePoint(codePoint);
      index = braced ? end : end - 1;
      continue;
    }

    decoded += escaped;
  }

  return decoded;
}

function parseExportNameToken(token: string | undefined): string | undefined {
  const trimmed = token?.trim();
  if (!trimmed) return undefined;
  return /^[_$a-zA-Z][\w$]*$/.test(trimmed) ? trimmed : parseQuotedExportName(trimmed);
}

function cssBindingValue(imported: string, cssModuleKey: string | undefined): string {
  if (imported === "default") {
    return cssModuleKey ? scopedCssModuleProxyExpression(cssModuleKey) : cssModuleProxyExpression();
  }
  const className = cssModuleKey ? toScopedCssModuleClass(cssModuleKey, imported) : imported;
  return serializeJavaScriptString(className);
}

/**
 * A namespace-shaped stub for `export * as styles from "./X.module.css"`.
 *
 * A namespace re-export binds the whole module namespace, not its default
 * export, so importers reach the class map through `styles.default.container`
 * as well as `styles.container`. Exporting the bare default proxy answers
 * `styles.default` with a synthesized class string and breaks the first form,
 * so the stub keeps both: `default` yields the proxy, every other key yields
 * the class name the proxy would have produced.
 */
function cssNamespaceExpression(cssModuleKey: string | undefined): string {
  const defaultExpr = cssBindingValue("default", cssModuleKey);
  return `(() => { const d = ${defaultExpr}; return new Proxy({}, { get: (_, p) => p === "default" ? d : d[p] }); })()`;
}

const CSS_EXPORT_LOCAL_PREFIX = "__vfCssExport_";
type AllocateCssExportLocal = () => string;

/**
 * An identifier may spell any of its characters as a Unicode escape, so
 * `__vfCssExport_\\u0030` and `__vfCssExport_0` name the same binding. A textual
 * identifier scan sees only the second form, so the allocator would hand out a
 * local the module already declares and the stub would fail to parse with a
 * duplicate declaration. Decoding first makes both spellings collide in the set.
 *
 * Decoding is deliberately unconditional rather than restricted to identifier
 * positions: a decoded escape inside a string or comment can only *add* an
 * occupied name, which makes allocation more conservative, never less.
 */
function decodeUnicodeEscapes(code: string): string {
  return code.replace(
    /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})/g,
    (match, braced: string | undefined, plain: string | undefined) => {
      const codePoint = Number.parseInt(braced ?? plain ?? "", 16);
      if (!Number.isInteger(codePoint) || codePoint > 0x10ffff) return match;
      return String.fromCodePoint(codePoint);
    },
  );
}

/**
 * The generated locals share the module scope with the module's own bindings,
 * so a source that already declares `__vfCssExport_0` must be skipped. Collect
 * identifiers once, then allocate against the set so attacker-controlled source
 * length cannot turn collision avoidance into repeated full-source scans.
 */
function createCssExportLocalAllocator(code: string): AllocateCssExportLocal {
  const occupied = new Set(decodeUnicodeEscapes(code).match(/[_$a-zA-Z][\w$]*/g) ?? []);
  let nextLocal = 0;
  return () => {
    let candidate: string;
    do candidate = `${CSS_EXPORT_LOCAL_PREFIX}${nextLocal++}`; while (occupied.has(candidate));
    occupied.add(candidate);
    return candidate;
  };
}

/**
 * Export `value` under `exportName` without declaring `exportName` locally.
 *
 * A re-export never introduces a local binding, so the stub must not either:
 * `const styles = fallback; export { default as styles } from "./x.module.css"`
 * is a valid module, and emitting `export const styles` would redeclare it.
 * Reserved words such as `class` are legal export names but illegal `const`
 * names, so the same indirection keeps those parseable as well. A transform-wide
 * allocator keeps the local independent of attacker-controlled export text and
 * collision-free across every rewritten statement in the module.
 */
function exportBindingStatement(
  allocateLocal: AllocateCssExportLocal,
  exportName: string,
  value: string,
): string {
  if (exportName === "default") return `export default ${value};`;
  const identifierName = /^[_$a-zA-Z][\w$]*$/.test(exportName);
  const exportedName = identifierName ? exportName : serializeJavaScriptString(exportName);
  const localName = allocateLocal();
  return `const ${localName} = ${value}; export { ${localName} as ${exportedName} };`;
}

/**
 * Index of the `from` keyword that introduces the module specifier.
 *
 * esbuild minifies this code immediately before this stage whenever `dev` is
 * false, so production statements arrive without spaces around the keyword
 * (`export{default as styles}from"./x.module.css"`). Matching the literal
 * `" from "` misses every one of those, strips the statement to a bare comment
 * and leaves the module's own `export {...}` clause referencing bindings that
 * no longer exist, which fails to link. The keyword is therefore matched on its
 * identifier boundary while quoted regions are skipped. This excludes `from`
 * text inside either an arbitrary export name or the CSS specifier.
 */
/**
 * Index of the first character at or after `index` that is neither whitespace
 * nor a comment, or -1 when the trivia is unterminated or runs to the end.
 */
function skipTriviaIndex(statement: string, index: number): number {
  let cursor = index;
  while (cursor < statement.length) {
    const char = statement[cursor];
    if (char !== undefined && /\s/.test(char)) {
      cursor++;
      continue;
    }
    const commentEnd = findCommentEndIndex(statement, cursor);
    if (commentEnd === undefined) return cursor;
    if (commentEnd === -1) return -1;
    cursor = commentEnd;
  }
  return -1;
}

function findQuotedRegionEndIndex(
  value: string,
  index: number,
  quote: JavaScriptQuote,
): number {
  let cursor = index + 1;
  let escaped = false;
  while (cursor < value.length) {
    const char = value[cursor++];
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === quote) return cursor;
  }
  return cursor;
}

function findFromKeywordIndex(statement: string): number {
  let index = 0;
  while (index < statement.length) {
    const char = statement[index];
    const commentEnd = findCommentEndIndex(statement, index);
    if (commentEnd !== undefined) {
      if (commentEnd === -1) return -1;
      index = commentEnd;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      index = findQuotedRegionEndIndex(statement, index, char);
      continue;
    }

    if (
      statement.startsWith("from", index) &&
      !/[\w$]/.test(statement[index - 1] ?? "")
    ) {
      // A comment may sit between `from` and the specifier, so skip trivia
      // rather than requiring the quote to follow immediately.
      const specifierIndex = skipTriviaIndex(statement, index + "from".length);
      if (specifierIndex !== -1 && /['"`]/.test(statement[specifierIndex] ?? "")) {
        return index;
      }
    }
    index++;
  }

  return -1;
}

/**
 * Code points the comment mask may borrow as stand-ins for quotes.
 *
 * Only a character absent from the module can serve, so a module that occupies
 * the whole BMP private use area — a generated icon-font table does exactly
 * that — would otherwise leave masking disabled and hand the decoy-comment
 * pattern straight back to the module lexer. The supplementary private use
 * planes add 131,068 further candidates, so exhausting the pool now requires a
 * module containing essentially every private-use code point. The BMP range is
 * listed first so ordinary modules keep picking the same single-UTF-16-unit
 * sentinels they always have.
 */
const SENTINEL_CODE_POINT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0xe000, 0xf8ff],
  [0xf0000, 0xffffd],
  [0x100000, 0x10fffd],
];

const IDENTIFIER_START = /[$_\p{ID_Start}]/u;
const IDENTIFIER_CONTINUE = /[$\u200c\u200d\p{ID_Continue}]/u;

/**
 * Keywords whose parenthesised head is followed by a *statement* or a statement
 * block, not an operand. The `/` after such a closing parenthesis therefore
 * opens a regex literal (`if (enabled) /re/.test(value);`) rather than a
 * division operator, so the closing parenthesis must leave regex context open,
 * and the `{` it introduces opens a statement block whose `}` does the same
 * (`switch (value) {} /re/.test(value);`).
 */
const CONTROL_FLOW_HEAD_KEYWORD = /^(?:catch|for|if|switch|while|with)$/;

/**
 * Keywords whose brace body is a statement block, so the `}` closing it sits in
 * statement position and a following `/` opens a regex literal. `catch` is
 * listed because its binding is optional, so `catch {}` reaches the `{` with no
 * head parenthesis to have flagged the block. `static` is listed because a `{`
 * directly after it is a class static initialization block; modules are strict
 * code, where `static` cannot be a plain identifier, so no operand brace can
 * follow the bare token.
 */
const STATEMENT_BLOCK_KEYWORD = /^(?:catch|do|else|finally|static|try)$/;
const STATEMENT_BODY_KEYWORD = /^(?:do|else)$/;

/** What an open parenthesis introduced, for `)` and contextual-`of` handling. */
type ParenthesisKind = "for-head" | "switch-head" | "control-flow-head" | "operand";
type BraceKind =
  | "switch-block"
  | "statement-block"
  | "module-attributes"
  | "module-specifiers"
  | "expression-body"
  | "operand";

function classifyParenthesisKind(
  precedingToken: string | undefined,
  tokenBeforePreceding: string | undefined,
): ParenthesisKind {
  if (
    precedingToken === "for" ||
    (precedingToken === "await" && tokenBeforePreceding === "for")
  ) {
    return "for-head";
  }
  if (precedingToken === "switch") return "switch-head";
  if (CONTROL_FLOW_HEAD_KEYWORD.test(precedingToken ?? "")) return "control-flow-head";
  return "operand";
}

/**
 * Keywords that can only be followed by an operand, so a `/` after them opens a
 * regex literal. `do` and `else` lead an unbraced statement body
 * (`else /re/.test(value);`), and `default` covers `export default /re/`; the
 * `default` of a switch clause is followed by `:`, which opens regex context
 * anyway. `of` is deliberately absent: it is contextual, and
 * `const of = 4; of / 2` is division, so it is only an operator in a for-of head.
 */
// `extends` is included for correctness but is not reachable end-to-end: the
// module lexer rejects a regex literal in a heritage clause on its own, with or
// without this scanner.
const REGEX_PRECEDING_KEYWORD =
  /^(?:await|case|default|delete|do|else|extends|in|instanceof|new|return|throw|typeof|void|yield)$/;
const FOR_HEAD_DECLARATION_KEYWORD = /^(?:const|let|using|var)$/;

/**
 * Keywords that end their statement at a line terminator through automatic
 * semicolon insertion, leaving the next line in statement position where a `/`
 * opens a regex literal (`debugger\n/re/.test(value);`). `break` and
 * `continue` carry an optional label, but the label is a restricted production
 * that must sit on the same line, so a line terminator ends them too. A bare
 * `yield` likewise finishes before the next line starts a statement.
 */
const ASI_TERMINATED_KEYWORD = /^(?:break|continue|debugger|return|yield)$/;

/**
 * A string line continuation produces no characters, so escapes separated only
 * by continuations still combine into one code point at runtime.
 */
const STRING_LINE_CONTINUATIONS = /^(?:\\(?:\r\n|[\n\r\u2028\u2029]))*$/;

function occupiedCodePoints(code: string): Set<number> {
  const occupied = new Set(Array.from(code, (char) => char.codePointAt(0)!));
  const unicodeEscape = /\\u\{([\da-f]{1,6})\}|\\u([\da-f]{4})/gi;
  let previousHighSurrogate: { codeUnit: number; end: number } | undefined;
  let cursor = 0;

  const recordSurrogateCodeUnit = (codeUnit: number, start: number, end: number): void => {
    if (
      codeUnit >= 0xdc00 && codeUnit <= 0xdfff && previousHighSurrogate &&
      STRING_LINE_CONTINUATIONS.test(
        code.slice(previousHighSurrogate.end, start),
      )
    ) {
      occupied.add(
        0x10000 + ((previousHighSurrogate.codeUnit - 0xd800) << 10) +
          (codeUnit - 0xdc00),
      );
    }
    previousHighSurrogate = codeUnit >= 0xd800 && codeUnit <= 0xdbff
      ? { codeUnit, end }
      : undefined;
  };

  const recordLiteralSurrogates = (end: number): void => {
    while (cursor < end) {
      if (code[cursor] === "\\") {
        const continuation = /^(?:\\(?:\r\n|[\n\r\u2028\u2029]))/.exec(
          code.slice(cursor, end),
        );
        if (continuation) {
          cursor += continuation[0].length;
          continue;
        }
      }
      const codeUnit = code.codePointAt(cursor)!;
      recordSurrogateCodeUnit(codeUnit, cursor, cursor + 1);
      cursor++;
    }
  };

  for (const match of code.matchAll(unicodeEscape)) {
    recordLiteralSurrogates(match.index);
    const escapedValue = Number.parseInt(match[1] ?? match[2]!, 16);
    if (escapedValue > 0x10ffff) {
      previousHighSurrogate = undefined;
      cursor = match.index + match[0].length;
      continue;
    }

    occupied.add(escapedValue);
    // Braced escapes normally spell a full code point, but JavaScript also
    // permits a surrogate code unit in braces. Treat those exactly like the
    // four-digit form so mixed/braced adjacent pairs reserve their combined
    // supplementary character before sentinel allocation.
    if (escapedValue > 0xffff) {
      previousHighSurrogate = undefined;
      cursor = match.index + match[0].length;
      continue;
    }

    recordSurrogateCodeUnit(
      escapedValue,
      match.index,
      match.index + match[0].length,
    );
    cursor = match.index + match[0].length;
  }
  recordLiteralSurrogates(code.length);

  return occupied;
}

type MaskMode =
  | "code"
  | "single"
  | "double"
  | "template"
  | "regex"
  | "line-comment"
  | "block-comment";
type PendingBodyKind = "declaration" | "expression";
type PendingBody = {
  syntax: "function" | "class";
  kind: PendingBodyKind;
  parenthesisDepth: number;
  bracketDepth: number;
  braceDepth: number;
  templateExpressionDepth: number;
  parametersClosed: boolean;
};
type ScannerDepth = {
  parenthesisDepth: number;
  bracketDepth: number;
  braceDepth: number;
};
type PendingSwitchClause = ScannerDepth & { conditionalDepths: ScannerDepth[] };
type TokenContext = {
  followsPropertyAccess: boolean;
  followsModuleSource: boolean;
  precedingToken: string | undefined;
  tokenBeforePreceding: string | undefined;
  precedingLabelCandidate: boolean;
  closedHeadParenthesis: boolean;
  closedSwitchHead: boolean;
  isIdentifierStart: boolean;
  startsModuleAttributes: boolean;
  startsModuleSpecifiers: boolean;
  startsStatement: boolean;
};

function selectMaskSentinels(code: string): [string, string, string, string] | undefined {
  const occupied = occupiedCodePoints(code);
  const sentinels: string[] = [];
  for (const [first, last] of SENTINEL_CODE_POINT_RANGES) {
    let codePoint = first;
    while (codePoint <= last && sentinels.length < 4) {
      if (!occupied.has(codePoint)) sentinels.push(String.fromCodePoint(codePoint));
      codePoint++;
    }
    if (sentinels.length === 4) {
      return sentinels as [string, string, string, string];
    }
  }
  return undefined;
}

function identifierUnitAt(
  value: string,
  index: number,
): { decoded: string; width: number } | undefined {
  const unicodeEscape = /^\\u(?:\{([\da-fA-F]{1,6})\}|([\da-fA-F]{4}))/.exec(
    value.slice(index),
  );
  if (unicodeEscape) {
    const codePoint = Number.parseInt(unicodeEscape[1] ?? unicodeEscape[2]!, 16);
    if (codePoint > 0x10ffff) return undefined;
    return { decoded: String.fromCodePoint(codePoint), width: unicodeEscape[0].length };
  }
  const codePoint = value.codePointAt(index);
  if (codePoint === undefined) return undefined;
  const decoded = String.fromCodePoint(codePoint);
  return { decoded, width: decoded.length };
}

function findIdentifierEndIndex(value: string, start: number): number {
  let end = start;
  while (end < value.length) {
    const unit = identifierUnitAt(value, end);
    if (!unit) break;
    const valid = end === start
      ? IDENTIFIER_START.test(unit.decoded)
      : IDENTIFIER_CONTINUE.test(unit.decoded);
    if (!valid) break;
    end += unit.width;
  }
  return end;
}

function findRegexLiteralEndIndex(code: string, start: number): number | undefined {
  let escaped = false;
  let inCharacterClass = false;
  let index = start + 1;
  while (index < code.length) {
    const char = code[index++];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "[") {
      inCharacterClass = true;
    } else if (char === "]") {
      inCharacterClass = false;
    } else if (char === "/" && !inCharacterClass) {
      while (index < code.length && IDENTIFIER_CONTINUE.test(code[index]!)) index++;
      return index;
    } else if (isLineTerminator(char)) {
      return undefined;
    }
  }
  return undefined;
}

function classifyBraceKind(
  context: TokenContext,
  pendingBodyKind: PendingBodyKind | undefined,
): BraceKind {
  if (context.closedSwitchHead) return "switch-block";
  if (context.startsModuleAttributes) return "module-attributes";
  if (
    context.precedingToken === "default" &&
    context.tokenBeforePreceding === "export"
  ) {
    return "operand";
  }
  if (context.startsModuleSpecifiers) return "module-specifiers";
  if (pendingBodyKind === "expression") return "expression-body";
  if (
    context.startsStatement || context.closedHeadParenthesis ||
    pendingBodyKind === "declaration" ||
    STATEMENT_BLOCK_KEYWORD.test(context.precedingToken ?? "")
  ) {
    return "statement-block";
  }
  return "operand";
}

/**
 * Track just enough JavaScript lexical state to hide quotes inside comments
 * from es-module-lexer without changing import-statement offsets.
 *
 * es-module-lexer also treats a slash after an unparenthesized function or
 * class expression body as a regex opener. In that one context the scanner
 * emits a modulus operator plus a collision-free marker comment. Both parses
 * then see an ordinary binary expression, and restoreCommentMask changes the
 * marker back to the source slash after CSS imports have been rewritten.
 */
class CommentQuoteMasker {
  private index = 0;
  private mode: MaskMode = "code";
  private escaped = false;
  private regexClass = false;
  private canStartRegex = true;
  private canStartDeclaration = true;
  private afterPropertyAccess = false;
  private precedingLabelCandidate = false;
  private precedingIdentifier: string | undefined;
  private identifierBeforePreceding: string | undefined;
  private readonly parenthesisKinds: ParenthesisKind[] = [];
  private readonly braceKinds: BraceKind[] = [];
  private readonly classBodyDepths: number[] = [];
  private readonly pendingBodies: PendingBody[] = [];
  private readonly pendingSwitchClauses: PendingSwitchClause[] = [];
  private bracketDepth = 0;
  private lastClosedHeadParenthesis = false;
  private lastClosedSwitchHead = false;
  private lastClosedExpressionBody = false;
  private lastClosedStatementBlock = false;
  private lineTerminatorAfterOperand = false;
  private pendingArrowBody = false;
  private pendingImportSpecifiers = false;
  private pendingModuleSource = false;
  private pendingNamedExportSpecifiers = false;
  private pendingLocalExportSource = false;
  private pendingModuleAttributes = false;
  private afterModuleSource = false;
  private nextStringIsModuleSource = false;
  private currentStringIsModuleSource = false;
  private pendingAsiStatement: { labelAllowed: boolean } | undefined;
  private readonly templateExpressionDepths: number[] = [];
  private readonly regexMasks = new Map<string, string>();
  private masked = "";

  constructor(
    private readonly code: string,
    private readonly quoteToSentinel: ReadonlyMap<string, string>,
    private readonly divisionMask: string,
    private readonly markerSentinel: string,
  ) {}

  mask(): string {
    while (this.index < this.code.length) {
      switch (this.mode) {
        case "line-comment":
          this.scanLineComment();
          break;
        case "block-comment":
          this.scanBlockComment();
          break;
        case "regex":
          this.scanRegex();
          break;
        case "template":
          this.scanTemplate();
          break;
        case "single":
        case "double":
          this.scanString();
          break;
        default:
          this.scanCode();
      }
    }
    return this.masked;
  }

  getRegexMasks(): ReadonlyMap<string, string> {
    return this.regexMasks;
  }

  private currentChar(): string {
    return this.code[this.index]!;
  }

  private nextChar(): string | undefined {
    return this.code[this.index + 1];
  }

  private append(value: string, width = 1): void {
    this.masked += value;
    this.index += width;
  }

  private scanLineComment(): void {
    const char = this.currentChar();
    if (isLineTerminator(char)) {
      this.mode = "code";
      this.recordLineTerminator();
    }
    this.append(this.quoteToSentinel.get(char) ?? char);
  }

  private scanBlockComment(): void {
    const char = this.currentChar();
    if (char === "*" && this.nextChar() === "/") {
      this.append("*/", 2);
      this.mode = "code";
      return;
    }
    if (isLineTerminator(char)) this.recordLineTerminator();
    this.append(this.quoteToSentinel.get(char) ?? char);
  }

  private scanRegex(): void {
    const char = this.currentChar();
    this.append(char);
    if (this.escaped) {
      this.escaped = false;
      return;
    }
    if (char === "\\") {
      this.escaped = true;
      return;
    }
    if (char === "[") this.regexClass = true;
    else if (char === "]") this.regexClass = false;
    else if (char === "/" && !this.regexClass) {
      this.mode = "code";
      this.canStartRegex = false;
      this.canStartDeclaration = false;
    }
  }

  private scanTemplate(): void {
    const char = this.currentChar();
    if (this.escaped) {
      this.append(char);
      this.escaped = false;
      return;
    }
    if (char === "\\") {
      this.append(char);
      this.escaped = true;
      return;
    }
    if (char === "$" && this.nextChar() === "{") {
      this.append("${", 2);
      this.templateExpressionDepths.push(0);
      this.mode = "code";
      this.canStartRegex = true;
      this.canStartDeclaration = false;
      return;
    }
    this.append(char);
    if (char === "`") {
      this.mode = "code";
      this.canStartRegex = false;
      this.canStartDeclaration = false;
    }
  }

  private scanString(): void {
    const char = this.currentChar();
    this.append(char);
    if (this.escaped) {
      this.escaped = false;
      return;
    }
    if (char === "\\") {
      this.escaped = true;
      return;
    }
    if (
      (this.mode === "single" && char === "'") ||
      (this.mode === "double" && char === '"')
    ) {
      this.mode = "code";
      // A static import or re-export necessarily ends at its source string, so
      // the closing quote leaves the scanner in statement position where a
      // following `/` opens a regex literal even without a semicolon
      // (`import dep from "./dep.js"\n/re/.test(dep)`). es-module-lexer scans
      // that slash as division after the quote, so the regex is masked through
      // the same marker path a closed statement block uses. Every other string
      // is an ordinary operand.
      this.canStartRegex = this.currentStringIsModuleSource;
      this.canStartDeclaration = this.currentStringIsModuleSource;
      this.lastClosedStatementBlock = this.currentStringIsModuleSource;
      this.afterModuleSource = this.currentStringIsModuleSource;
      this.currentStringIsModuleSource = false;
    }
  }

  private scanCode(): void {
    const char = this.currentChar();
    if (/\s/.test(char)) {
      this.scanWhitespace(char);
      return;
    }
    if (char === "}" && this.templateExpressionDepths.length > 0) {
      this.scanTemplateExpressionClose();
      return;
    }
    if (this.isHashbang()) {
      this.append("#!", 2);
      this.mode = "line-comment";
      return;
    }
    if (char === "/" && this.nextChar() === "/") {
      this.append("//", 2);
      this.mode = "line-comment";
      return;
    }
    if (char === "/" && this.nextChar() === "*") {
      this.append("/*", 2);
      this.mode = "block-comment";
      return;
    }
    if (char === "/" && this.lastClosedStatementBlock && this.maskRegexLiteral()) return;
    if (char === "/" && this.lastClosedExpressionBody) {
      this.append(this.divisionMask);
      this.lastClosedExpressionBody = false;
      this.canStartRegex = true;
      this.canStartDeclaration = false;
      return;
    }
    if (char === "/" && this.canStartRegex) {
      this.append(char);
      this.mode = "regex";
      this.regexClass = false;
      this.escaped = false;
      return;
    }
    this.scanCodeToken();
  }

  private maskRegexLiteral(): boolean {
    const end = findRegexLiteralEndIndex(this.code, this.index);
    if (end === undefined) return false;
    const marker = `;/*${this.markerSentinel}${this.regexMasks.size}*/0`;
    const literal = this.code.slice(this.index, end);
    this.regexMasks.set(marker, literal);
    this.append(marker, literal.length);
    this.lastClosedStatementBlock = false;
    this.canStartRegex = false;
    this.canStartDeclaration = false;
    return true;
  }

  private scanWhitespace(char: string): void {
    this.append(char);
    if (isLineTerminator(char)) this.recordLineTerminator();
  }

  private recordLineTerminator(): void {
    this.lineTerminatorAfterOperand ||= !this.canStartRegex;
    this.finishAsiStatement();
  }

  private finishAsiStatement(): void {
    if (!this.pendingAsiStatement) return;
    this.canStartRegex = true;
    this.canStartDeclaration = true;
    this.pendingAsiStatement = undefined;
    this.precedingIdentifier = undefined;
    this.identifierBeforePreceding = undefined;
  }

  private scanTemplateExpressionClose(): void {
    const depthIndex = this.templateExpressionDepths.length - 1;
    this.append("}");
    if (this.templateExpressionDepths[depthIndex] === 0) {
      this.templateExpressionDepths.pop();
      this.mode = "template";
      this.canStartRegex = false;
      this.canStartDeclaration = false;
      this.lastClosedExpressionBody = false;
      return;
    }
    this.templateExpressionDepths[depthIndex] = this.templateExpressionDepths[depthIndex]! - 1;
    this.recordClosedBrace();
  }

  private isHashbang(): boolean {
    return this.currentChar() === "#" && this.nextChar() === "!" &&
      (this.index === 0 || (this.index === 1 && this.code.startsWith("\ufeff")));
  }

  private scanCodeToken(): void {
    const char = this.currentChar();
    const context = this.takeTokenContext();
    this.finishLocalExportBeforeToken(context);
    if (this.scanQuoteStart(char)) return;
    if (this.scanNestedTemplateBrace(char, context)) return;
    if (this.scanSpread(char)) return;
    if (this.scanUpdateOperator(char)) return;
    if (this.scanPrivateName(char)) return;
    if (context.isIdentifierStart) {
      this.scanIdentifier(context);
      return;
    }
    if (this.scanParenthesis(char, context)) return;
    if (this.scanClosingOperand(char)) return;
    this.scanPunctuator(char, context);
  }

  private finishLocalExportBeforeToken(context: TokenContext): void {
    if (!this.pendingLocalExportSource) return;
    if (context.isIdentifierStart) {
      const end = findIdentifierEndIndex(this.code, this.index);
      const token = decodeUnicodeEscapes(this.code.slice(this.index, end));
      const nextCodeIndex = skipTriviaIndex(this.code, end);
      const nextCodeChar = nextCodeIndex === -1 ? undefined : this.code[nextCodeIndex];
      if (
        token === "from" && this.isTopLevel() &&
        (nextCodeChar === "'" || nextCodeChar === '"')
      ) {
        return;
      }
    }

    // A named export may be followed by `from "source"`; any other next token
    // proves the closed list was local. Do not let a later ordinary identifier
    // named `from` turn an unrelated string into a module source.
    this.pendingLocalExportSource = false;
    this.pendingModuleSource = false;
  }

  private takeTokenContext(): TokenContext {
    const char = this.currentChar();
    const startsArrowBody = char === "{" && this.pendingArrowBody;
    const context: TokenContext = {
      followsPropertyAccess: this.afterPropertyAccess,
      followsModuleSource: this.afterModuleSource,
      precedingToken: this.precedingIdentifier,
      tokenBeforePreceding: this.identifierBeforePreceding,
      precedingLabelCandidate: this.precedingLabelCandidate,
      closedHeadParenthesis: this.lastClosedHeadParenthesis,
      closedSwitchHead: this.lastClosedSwitchHead,
      isIdentifierStart: this.isIdentifierStartAt(this.index),
      startsModuleAttributes: this.pendingModuleAttributes,
      startsModuleSpecifiers: this.pendingImportSpecifiers ||
        this.precedingIdentifier === "export",
      startsStatement: this.canStartDeclaration || this.startsAsiBlock(char) ||
        startsArrowBody,
    };
    this.pendingArrowBody = false;
    this.lastClosedExpressionBody = false;
    this.lastClosedStatementBlock = false;
    this.lastClosedHeadParenthesis = false;
    this.lastClosedSwitchHead = false;
    if (char !== ".") this.afterPropertyAccess = false;
    this.precedingIdentifier = undefined;
    this.identifierBeforePreceding = undefined;
    this.precedingLabelCandidate = false;
    this.lineTerminatorAfterOperand = false;
    this.afterModuleSource = false;
    if (!context.isIdentifierStart) this.pendingAsiStatement = undefined;
    return context;
  }

  private startsAsiBlock(char: string): boolean {
    if (!this.lineTerminatorAfterOperand) return false;
    if (char === "{") return true;
    if (this.startsAsiDeclaration()) return true;
    const identifierEnd = findIdentifierEndIndex(this.code, this.index);
    return identifierEnd > this.index &&
      this.code[skipTriviaIndex(this.code, identifierEnd)] === ":";
  }

  private startsAsiDeclaration(): boolean {
    const tokens: string[] = [];
    let cursor = this.index;
    while (cursor !== -1 && tokens.length < 4) {
      const end = findIdentifierEndIndex(this.code, cursor);
      if (end === cursor) break;
      tokens.push(decodeUnicodeEscapes(this.code.slice(cursor, end)));
      cursor = skipTriviaIndex(this.code, end);
    }
    if (tokens[0] === "function" || tokens[0] === "class") return true;
    if (tokens[0] === "async") return tokens[1] === "function";
    if (tokens[0] !== "export") return false;
    if (tokens[1] === "function" || tokens[1] === "class") return true;
    if (tokens[1] === "async") return tokens[2] === "function";
    if (tokens[1] !== "default") return false;
    return tokens[2] === "function" || tokens[2] === "class" ||
      (tokens[2] === "async" && tokens[3] === "function");
  }

  private scanQuoteStart(char: string): boolean {
    if (char !== "'" && char !== '"' && char !== "`") return false;
    this.currentStringIsModuleSource = char !== "`" && this.nextStringIsModuleSource;
    this.append(char);
    this.pendingImportSpecifiers = false;
    this.nextStringIsModuleSource = false;
    if (this.currentStringIsModuleSource) this.pendingModuleSource = false;
    if (char === "'") this.mode = "single";
    else if (char === '"') this.mode = "double";
    else this.mode = "template";
    this.canStartDeclaration = false;
    return true;
  }

  private scanNestedTemplateBrace(char: string, context: TokenContext): boolean {
    if (char !== "{" || this.templateExpressionDepths.length === 0) return false;
    const depthIndex = this.templateExpressionDepths.length - 1;
    const pendingBody = this.startsClassHeritageObject(context)
      ? undefined
      : this.takePendingBody();
    const braceKind = classifyBraceKind(context, pendingBody?.kind);
    this.append(char);
    this.templateExpressionDepths[depthIndex] = this.templateExpressionDepths[depthIndex]! + 1;
    this.braceKinds.push(braceKind);
    if (pendingBody?.syntax === "class") {
      this.classBodyDepths.push(this.braceKinds.length);
    }
    this.canStartRegex = true;
    this.canStartDeclaration = braceKind !== "operand" && braceKind !== "module-specifiers";
    return true;
  }

  private scanSpread(char: string): boolean {
    if (char !== "." || !this.code.startsWith("...", this.index)) return false;
    this.append("...", 3);
    this.canStartRegex = true;
    this.canStartDeclaration = false;
    return true;
  }

  private scanUpdateOperator(char: string): boolean {
    if ((char !== "+" && char !== "-") || this.nextChar() !== char) return false;
    this.append(char.repeat(2), 2);
    this.canStartDeclaration = false;
    return true;
  }

  private scanPrivateName(char: string): boolean {
    if (char !== "#" || !this.isIdentifierStartAt(this.index + 1)) return false;
    const end = findIdentifierEndIndex(this.code, this.index + 1);
    this.append(this.code.slice(this.index, end), end - this.index);
    this.canStartRegex = false;
    this.canStartDeclaration = false;
    return true;
  }

  private isIdentifierStartAt(index: number): boolean {
    return findIdentifierEndIndex(this.code, index) > index;
  }

  private scanIdentifier(context: TokenContext): void {
    const end = findIdentifierEndIndex(this.code, this.index);
    const sourceToken = this.code.slice(this.index, end);
    const token = decodeUnicodeEscapes(sourceToken);
    this.append(sourceToken, end - this.index);
    const operandMayStart = this.canStartRegex;
    this.canStartRegex = !context.followsPropertyAccess &&
      (REGEX_PRECEDING_KEYWORD.test(token) ||
        this.isForOfSeparator(token, context, operandMayStart));
    const nextCodeIndex = skipTriviaIndex(this.code, end);
    const nextCodeChar = nextCodeIndex === -1 ? undefined : this.code[nextCodeIndex];
    this.trackImportSpecifiers(token, context, nextCodeChar);
    this.trackModuleAttributes(token, context, nextCodeChar);
    this.trackPendingBody(token, context, nextCodeChar, nextCodeIndex, operandMayStart);
    this.trackPendingSwitchClause(token, context.followsPropertyAccess);
    this.updateAsiStatement(token, context.followsPropertyAccess);
    this.precedingIdentifier = context.followsPropertyAccess ? undefined : token;
    this.identifierBeforePreceding = context.followsPropertyAccess
      ? undefined
      : context.precedingToken;
    this.precedingLabelCandidate = !context.followsPropertyAccess && context.startsStatement;
    this.canStartDeclaration =
      (!context.followsPropertyAccess && STATEMENT_BODY_KEYWORD.test(token)) ||
      ((this.canStartDeclaration || context.startsStatement) &&
        /^(?:async|default|export)$/.test(token));
  }

  private trackImportSpecifiers(
    token: string,
    context: TokenContext,
    nextCodeChar: string | undefined,
  ): void {
    if (
      token === "import" && context.startsStatement && this.isTopLevel() &&
      nextCodeChar !== "(" && nextCodeChar !== "."
    ) {
      this.pendingImportSpecifiers = true;
      this.pendingModuleSource = true;
      this.nextStringIsModuleSource = nextCodeChar === "'" || nextCodeChar === '"';
    } else if (
      token === "export" && context.startsStatement && this.isTopLevel() &&
      (nextCodeChar === "{" || nextCodeChar === "*")
    ) {
      this.pendingModuleSource = true;
      this.pendingNamedExportSpecifiers = nextCodeChar === "{";
    } else if (
      token === "from" && this.pendingModuleSource && this.isTopLevel() &&
      (nextCodeChar === "'" || nextCodeChar === '"')
    ) {
      this.pendingImportSpecifiers = false;
      // `from` directly before a string only occurs in a static import or
      // re-export, so the string that follows is a module source whose closing
      // quote ends the declaration and restores statement context.
      this.nextStringIsModuleSource = true;
      this.pendingLocalExportSource = false;
    }
  }

  private isForOfSeparator(
    token: string,
    context: TokenContext,
    operandMayStart: boolean,
  ): boolean {
    return token === "of" && this.parenthesisKinds.at(-1) === "for-head" &&
      !operandMayStart &&
      !FOR_HEAD_DECLARATION_KEYWORD.test(context.precedingToken ?? "");
  }

  private isTopLevel(): boolean {
    return this.parenthesisKinds.length === 0 && this.bracketDepth === 0 &&
      this.braceKinds.length === 0 && this.templateExpressionDepths.length === 0;
  }

  private trackModuleAttributes(
    token: string,
    context: TokenContext,
    nextCodeChar: string | undefined,
  ): void {
    this.pendingModuleAttributes = context.followsModuleSource &&
      (token === "with" || token === "assert") && nextCodeChar === "{" &&
      this.isTopLevel();
  }

  private trackPendingBody(
    token: string,
    context: TokenContext,
    nextCodeChar: string | undefined,
    nextCodeIndex: number,
    operandMayStart: boolean,
  ): void {
    const isPropertyName = nextCodeChar === ":" || nextCodeChar === "=" ||
      nextCodeChar === ";";
    const isBodyKeyword = token === "function" || token === "class";
    const isDirectClassElement = this.classBodyDepths.at(-1) === this.braceKinds.length;
    const isClassElementName = isBodyKeyword && isDirectClassElement &&
      !context.followsPropertyAccess &&
      (context.startsStatement || !operandMayStart) &&
      !(token === "function" && context.precedingToken === "async");
    if (isClassElementName) {
      if (!isPropertyName && nextCodeChar !== "(") {
        this.maskSemicolonlessClassElement();
      }
      return;
    }
    if (
      !context.followsPropertyAccess && !isPropertyName &&
      this.braceKinds.at(-1) !== "module-specifiers" &&
      ((token === "function" && this.continuesFunctionHeadAt(nextCodeIndex)) ||
        (token === "class" && this.continuesClassHeadAt(nextCodeIndex)))
    ) {
      this.pendingBodies.push({
        syntax: token,
        kind: context.startsStatement ? "declaration" : "expression",
        parenthesisDepth: this.parenthesisKinds.length,
        bracketDepth: this.bracketDepth,
        braceDepth: this.braceKinds.length,
        templateExpressionDepth: this.templateExpressionDepths.length,
        parametersClosed: token === "class",
      });
    }
  }

  /** Whether a `function` token continues with an optional star/name and a parameter list. */
  private continuesFunctionHeadAt(index: number): boolean {
    if (index === -1) return false;
    let cursor = index;
    if (this.code[cursor] === "*") {
      cursor = skipTriviaIndex(this.code, cursor + 1);
      if (cursor === -1) return false;
    }
    if (this.code[cursor] === "(") return true;
    const nameEnd = findIdentifierEndIndex(this.code, cursor);
    if (nameEnd === cursor) return false;
    const afterName = skipTriviaIndex(this.code, nameEnd);
    return afterName !== -1 && this.code[afterName] === "(";
  }

  /**
   * Whether the code at `index` continues a `class` token as a class head: an
   * optional binding identifier and an optional `extends` heritage clause lead
   * to the `{` body. Any other shape means the token was a class-element or
   * property name (`class C { class\nvalue = {} }` declares two fields), and a
   * pending body for it would make the next initializer brace scan as a
   * statement block. A keyword spelled with Unicode escapes never opens a
   * heritage clause, so the raw-text `extends` comparison matches exactly the
   * occurrences the grammar accepts.
   */
  private continuesClassHeadAt(index: number): boolean {
    if (index === -1) return false;
    if (this.code[index] === "{") return true;
    const nameEnd = findIdentifierEndIndex(this.code, index);
    if (nameEnd === index) return false;
    if (this.code.slice(index, nameEnd) === "extends") return true;
    const afterName = skipTriviaIndex(this.code, nameEnd);
    if (afterName === -1) return false;
    if (this.code[afterName] === "{") return true;
    const keywordEnd = findIdentifierEndIndex(this.code, afterName);
    return this.code.slice(afterName, keywordEnd) === "extends";
  }

  private maskSemicolonlessClassElement(): void {
    const marker = `;/*${this.markerSentinel}f${this.regexMasks.size}*/`;
    this.regexMasks.set(marker, "");
    this.masked += marker;
  }

  private trackPendingSwitchClause(token: string, followsPropertyAccess: boolean): void {
    if (
      !followsPropertyAccess &&
      (token === "case" || token === "default") &&
      this.braceKinds.at(-1) === "switch-block"
    ) {
      this.pendingSwitchClauses.push({
        parenthesisDepth: this.parenthesisKinds.length,
        bracketDepth: this.bracketDepth,
        braceDepth: this.braceKinds.length,
        conditionalDepths: [],
      });
    }
  }

  private updateAsiStatement(token: string, followsPropertyAccess: boolean): void {
    if (!followsPropertyAccess && ASI_TERMINATED_KEYWORD.test(token)) {
      this.pendingAsiStatement = { labelAllowed: /^(?:break|continue)$/.test(token) };
      return;
    }
    if (this.pendingAsiStatement?.labelAllowed) {
      this.pendingAsiStatement.labelAllowed = false;
      return;
    }
    this.pendingAsiStatement = undefined;
  }

  private scanParenthesis(char: string, context: TokenContext): boolean {
    if (char === "(") {
      this.append(char);
      this.pendingImportSpecifiers = false;
      this.parenthesisKinds.push(
        classifyParenthesisKind(context.precedingToken, context.tokenBeforePreceding),
      );
      this.canStartRegex = true;
      this.canStartDeclaration = false;
      return true;
    }
    if (char !== ")") return false;
    this.append(char);
    const closedKind = this.parenthesisKinds.pop() ?? "operand";
    const nextCodeIndex = skipTriviaIndex(this.code, this.index);
    const closedConciseMethodHead = closedKind === "operand" && nextCodeIndex !== -1 &&
      this.code[nextCodeIndex] === "{";
    this.lastClosedHeadParenthesis = closedKind !== "operand" || closedConciseMethodHead;
    this.lastClosedSwitchHead = closedKind === "switch-head";
    const pendingBody = this.pendingBodies.at(-1);
    if (
      pendingBody?.syntax === "function" &&
      this.parenthesisKinds.length === pendingBody.parenthesisDepth &&
      this.bracketDepth === pendingBody.bracketDepth &&
      this.braceKinds.length === pendingBody.braceDepth &&
      this.templateExpressionDepths.length === pendingBody.templateExpressionDepth
    ) {
      pendingBody.parametersClosed = true;
    }
    this.canStartRegex = this.lastClosedHeadParenthesis;
    this.canStartDeclaration = this.lastClosedHeadParenthesis;
    return true;
  }

  private scanClosingOperand(char: string): boolean {
    if (char === "}") {
      this.append(char);
      this.recordClosedBrace();
      return true;
    }
    if (!/\d/.test(char) && char !== "]") return false;
    this.append(char);
    if (char === "]") this.bracketDepth = Math.max(0, this.bracketDepth - 1);
    this.canStartRegex = false;
    this.canStartDeclaration = false;
    return true;
  }

  private recordClosedBrace(): void {
    const closedBraceKind = this.braceKinds.pop() ?? "operand";
    if (closedBraceKind === "module-specifiers" && this.pendingNamedExportSpecifiers) {
      this.pendingNamedExportSpecifiers = false;
      this.pendingLocalExportSource = true;
    }
    this.canStartRegex = closedBraceKind === "statement-block" ||
      closedBraceKind === "switch-block" || closedBraceKind === "module-attributes" ||
      closedBraceKind === "module-specifiers";
    this.canStartDeclaration = this.canStartRegex;
    this.lastClosedExpressionBody = closedBraceKind === "expression-body";
    this.lastClosedStatementBlock = this.canStartRegex;
    while ((this.classBodyDepths.at(-1) ?? 0) > this.braceKinds.length) {
      this.classBodyDepths.pop();
    }
    while ((this.pendingBodies.at(-1)?.braceDepth ?? 0) > this.braceKinds.length) {
      this.pendingBodies.pop();
    }
    let pendingClause = this.pendingSwitchClauses.at(-1);
    while (pendingClause && pendingClause.braceDepth > this.braceKinds.length) {
      this.pendingSwitchClauses.pop();
      pendingClause = this.pendingSwitchClauses.at(-1);
    }
  }

  private takePendingBody(): PendingBody | undefined {
    const pendingBody = this.pendingBodies.at(-1);
    if (
      !pendingBody?.parametersClosed ||
      this.parenthesisKinds.length !== pendingBody.parenthesisDepth ||
      this.bracketDepth !== pendingBody.bracketDepth ||
      this.braceKinds.length !== pendingBody.braceDepth ||
      this.templateExpressionDepths.length !== pendingBody.templateExpressionDepth
    ) {
      return undefined;
    }
    return this.pendingBodies.pop();
  }

  private scanPunctuator(char: string, context: TokenContext): void {
    if (char === "=" && this.nextChar() === ">") {
      this.append("=>", 2);
      this.pendingArrowBody = true;
      this.canStartDeclaration = false;
      this.canStartRegex = true;
      this.afterPropertyAccess = false;
      return;
    }
    if (char === "?" && this.nextChar() === "?") {
      this.append("??", 2);
      this.canStartDeclaration = false;
      this.canStartRegex = true;
      this.afterPropertyAccess = false;
      return;
    }
    const optionalChainQuestion = char === "?" && this.nextChar() === "." &&
      !/\d/.test(this.code[this.index + 2] ?? "");
    this.append(char);
    this.updatePunctuatorDeclarationState(char, context, optionalChainQuestion);
    if (char === ";" || char === ".") this.pendingImportSpecifiers = false;
    if (char === ";") {
      this.pendingModuleSource = false;
      this.pendingNamedExportSpecifiers = false;
      this.pendingLocalExportSource = false;
    }
    this.canStartRegex = char !== ".";
    this.afterPropertyAccess = char === ".";
  }

  private updatePunctuatorDeclarationState(
    char: string,
    context: TokenContext,
    optionalChainQuestion: boolean,
  ): void {
    switch (char) {
      case "{":
        this.recordOpeningBrace(context);
        return;
      case "[":
        this.bracketDepth++;
        this.canStartDeclaration = false;
        return;
      case "?":
        if (this.recordSwitchConditional(optionalChainQuestion)) return;
        break;
      case ":":
        this.recordColon(context);
        return;
    }
    this.canStartDeclaration = char === ";" && this.parenthesisKinds.length === 0;
  }

  private recordOpeningBrace(context: TokenContext): void {
    const pendingBody = this.startsClassHeritageObject(context)
      ? undefined
      : this.takePendingBody();
    const braceKind = classifyBraceKind(context, pendingBody?.kind);
    this.braceKinds.push(braceKind);
    if (pendingBody?.syntax === "class") {
      this.classBodyDepths.push(this.braceKinds.length);
    }
    if (braceKind === "module-attributes") this.pendingModuleAttributes = false;
    if (braceKind === "module-specifiers") this.pendingImportSpecifiers = false;
    this.canStartDeclaration = braceKind !== "operand" && braceKind !== "module-specifiers";
  }

  private startsClassHeritageObject(context: TokenContext): boolean {
    const pendingBody = this.pendingBodies.at(-1);
    return pendingBody?.syntax === "class" && context.precedingToken === "extends" &&
      pendingBody.parametersClosed &&
      this.parenthesisKinds.length === pendingBody.parenthesisDepth &&
      this.bracketDepth === pendingBody.bracketDepth &&
      this.braceKinds.length === pendingBody.braceDepth &&
      this.templateExpressionDepths.length === pendingBody.templateExpressionDepth;
  }

  private recordSwitchConditional(optionalChainQuestion: boolean): boolean {
    if (optionalChainQuestion || this.pendingSwitchClauses.length === 0) return false;
    this.pendingSwitchClauses.at(-1)!.conditionalDepths.push({
      parenthesisDepth: this.parenthesisKinds.length,
      bracketDepth: this.bracketDepth,
      braceDepth: this.braceKinds.length,
    });
    this.canStartDeclaration = false;
    return true;
  }

  private recordColon(context: TokenContext): void {
    if (this.finishesSwitchClause()) {
      this.pendingSwitchClauses.pop();
      this.canStartDeclaration = true;
      return;
    }
    this.canStartDeclaration = context.precedingLabelCandidate;
  }

  private finishesSwitchClause(): boolean {
    const clause = this.pendingSwitchClauses.at(-1);
    if (!clause) return false;
    const conditional = clause.conditionalDepths.at(-1);
    if (conditional) {
      if (
        this.parenthesisKinds.length === conditional.parenthesisDepth &&
        this.bracketDepth === conditional.bracketDepth &&
        this.braceKinds.length === conditional.braceDepth
      ) {
        clause.conditionalDepths.pop();
      }
      return false;
    }
    return this.parenthesisKinds.length === clause.parenthesisDepth &&
      this.bracketDepth === clause.bracketDepth &&
      this.braceKinds.length === clause.braceDepth;
  }
}

function restoreCommentMask(
  value: string,
  divisionMask: string,
  markerSentinel: string,
  quoteToSentinel: ReadonlyMap<string, string>,
  regexMasks: ReadonlyMap<string, string>,
): string {
  let restored = value.replaceAll(divisionMask, "/");
  const regexMaskPattern = new RegExp(
    String.raw`;/\*${markerSentinel}(?:f\d+\*/|\d+\*/0)`,
    "g",
  );
  restored = restored.replace(
    regexMaskPattern,
    (marker) => regexMasks.get(marker) ?? marker,
  );
  for (const [quote, sentinel] of quoteToSentinel) {
    restored = restored.replaceAll(sentinel, quote);
  }
  return restored;
}

const IMPORT_DETECTION_QUOTE_MASKS = new Map<string, string>([
  ['"', " "],
  ["'", " "],
  ["`", " "],
]);

function maskCommentQuotesForImportDetection(code: string): string {
  return new CommentQuoteMasker(
    code,
    IMPORT_DETECTION_QUOTE_MASKS,
    "%/**/",
    "_",
  ).mask();
}

function maskCommentQuotesForModuleLexer(code: string): {
  masked: string;
  restore: (value: string) => string;
} {
  const sentinels = selectMaskSentinels(code);
  if (!sentinels) {
    throw CSS_COMMENT_MASK_SENTINEL_EXHAUSTED.create({
      message: "CSS import comment masking could not allocate sentinels.",
    });
  }
  const quoteToSentinel = new Map<string, string>([
    ['"', sentinels[0]],
    ["'", sentinels[1]],
    ["`", sentinels[2]],
  ]);
  const markerSentinel = sentinels[3];
  const divisionMask = `%/*${markerSentinel}*/`;
  const masker = new CommentQuoteMasker(
    code,
    quoteToSentinel,
    divisionMask,
    markerSentinel,
  );
  const masked = masker.mask();
  return {
    masked,
    restore: (value) =>
      restoreCommentMask(
        value,
        divisionMask,
        markerSentinel,
        quoteToSentinel,
        masker.getRegexMasks(),
      ),
  };
}

/** @internal Test-only scanner boundary; this module is not a public package entry point. */
export const __maskCommentQuotesForModuleLexer = maskCommentQuotesForModuleLexer;

/**
 * Generate a replacement for a CSS re-export statement.
 *
 * SSR modules are linked as real ES modules, so a re-export that is stripped
 * to a comment silently drops the binding and every importer of it fails to
 * link. Enumerable clauses therefore keep exporting the same names through the
 * stubs the import path already uses. `export * from` carries no static names,
 * so it stays stripped.
 */
function generateCSSReExportStub(
  trimmed: string,
  specifier: string,
  allocateLocal: AllocateCssExportLocal,
): string {
  const stripped = cssComment("re-export stripped", specifier);
  const fromIndex = findFromKeywordIndex(trimmed);
  if (fromIndex === -1) return stripped;

  const cssModuleKey = isCssModuleImport(specifier) ? specifier : undefined;
  const clause = stripImportClauseComments(trimmed.slice("export".length, fromIndex)).trim();

  // Namespace re-export: export * as styles from "./X.module.css"
  const nsMatch = clause.match(/^\*\s*as\s+(.+)$/);
  const namespaceExportName = parseExportNameToken(nsMatch?.[1]);
  if (namespaceExportName !== undefined) {
    return `${
      exportBindingStatement(
        allocateLocal,
        namespaceExportName,
        cssNamespaceExpression(cssModuleKey),
      )
    } ${cssComment("re-export", specifier)}`;
  }

  // Named re-export: export { default as styles, container as c } from "./X.module.css"
  const namedClause = clause.startsWith("{") && clause.endsWith("}")
    ? clause.slice(1, -1)
    : undefined;
  if (!namedClause) return stripped;

  const bindings = parseNamedImportBindings(namedClause, true);
  if (bindings.length === 0) return stripped;

  const statements = bindings.map((binding) =>
    exportBindingStatement(
      allocateLocal,
      binding.local,
      cssBindingValue(binding.imported, cssModuleKey),
    )
  );

  return `${statements.join(" ")} ${cssComment("re-export", specifier)}`;
}

/**
 * Generate a replacement for a static CSS import statement.
 *
 * - Side-effect import: `import "./globals.css"` → comment
 * - Default import: `import styles from "./X.module.css"` → Proxy stub
 * - Named imports: `import { a } from "./X.css"` → null stubs
 */
function generateCSSStub(
  statement: string,
  specifier: string,
  allocateLocal: AllocateCssExportLocal,
): string {
  const trimmed = statement.trim();

  // Re-export from CSS: export { default as styles } from './module.css'
  // Minified output drops the space: `export{default as styles}from"..."`.
  if (/^export(?![\w$])/.test(trimmed)) {
    return generateCSSReExportStub(trimmed, specifier, allocateLocal);
  }

  // Side-effect import: import "./globals.css"
  if (/^import\s*['"`]/.test(trimmed)) {
    return cssComment("import", specifier);
  }

  const fromIndex = findFromKeywordIndex(trimmed);
  if (fromIndex === -1) {
    return cssComment("import", specifier);
  }

  const cssModuleKey = isCssModuleImport(specifier) ? specifier : undefined;
  const importClause = stripImportClauseComments(trimmed.slice(6, fromIndex)).trim();

  // Default import: import styles from "./Button.module.css"
  // → const styles = new Proxy({}, { get: (_, p) => String(p) })
  // This makes styles.container return "container" (identity mapping)
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(importClause)) {
    const expr = cssModuleKey
      ? scopedCssModuleProxyExpression(cssModuleKey)
      : cssModuleProxyExpression();
    return `const ${importClause} = ${expr}; ${cssComment("module", specifier)}`;
  }

  // Namespace import: import * as styles from "./X.module.css"
  // esbuild lowers `export * as styles from "./X.module.css"` to this form, so
  // the stub must carry the same namespace shape the re-export promises.
  const nsMatch = importClause.match(/^\*\s*as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
  if (nsMatch) {
    return `const ${nsMatch[1]} = ${cssNamespaceExpression(cssModuleKey)}; ${
      cssComment("module", specifier)
    }`;
  }

  // Named imports: import { container, header } from "./X.module.css"
  // `default` is a legal named import, and esbuild lowers every CSS re-export
  // to this form, so it must resolve to the class-map proxy rather than to the
  // literal class name `"default"`.
  const namedClause = extractNamedImportClause(importClause);
  if (namedClause) {
    const bindings = parseNamedImportBindings(namedClause);
    if (bindings.length > 0) {
      const stubs = bindings
        .map((binding) => `${binding.local} = ${cssBindingValue(binding.imported, cssModuleKey)}`)
        .join(", ");
      return `const ${stubs}; ${cssComment("module", specifier)}`;
    }
  }

  // Mixed: import styles, { container } from "./X.module.css"
  const mixedMatch = importClause.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,\s*/);
  const mixedNamedClause = mixedMatch
    ? extractNamedImportClause(importClause.slice(mixedMatch[0].length))
    : undefined;
  if (mixedMatch?.[1] && mixedNamedClause) {
    const defaultName = mixedMatch[1];
    const bindings = parseNamedImportBindings(mixedNamedClause);
    const namedStubs = bindings
      .map((binding) => `${binding.local} = ${cssBindingValue(binding.imported, cssModuleKey)}`)
      .join(", ");
    const defaultExpr = cssModuleKey
      ? scopedCssModuleProxyExpression(cssModuleKey)
      : cssModuleProxyExpression();
    return namedStubs.length > 0
      ? `const ${defaultName} = ${defaultExpr}, ${namedStubs}; ${cssComment("module", specifier)}`
      : `const ${defaultName} = ${defaultExpr}; ${cssComment("module", specifier)}`;
  }

  return cssComment("import", specifier);
}

/**
 * Generate a replacement for dynamic CSS imports.
 * Keeps syntax valid in expression position (e.g. await import("./x.css")).
 */
function generateDynamicCSSStub(specifier: string): string {
  if (isCssModuleImport(specifier)) {
    return `Promise.resolve({ default: ${scopedCssModuleProxyExpression(specifier)} }) ${
      cssComment("import", specifier)
    }`;
  }

  return `Promise.resolve({}) ${cssComment("import", specifier)}`;
}

export const cssStripPlugin: TransformPlugin = {
  name: "css-strip",
  stage: TransformStage.COMPILE + 0.5, // Run after esbuild compile, before import resolution

  async transform(ctx) {
    // Skip sentinel allocation entirely for modules that cannot contain a CSS
    // suffix, including one encoded with JavaScript string escapes.
    if (!mayContainCSSSpecifier(ctx.code)) return ctx.code;

    const detectedImports = await parseImports(maskCommentQuotesForImportDetection(ctx.code));
    if (!detectedImports.some((imp) => isCSSImport(imp.n))) return ctx.code;

    const commentMask = maskCommentQuotesForModuleLexer(ctx.code);
    const imports = await parseImports(commentMask.masked);

    const hasCssImports = imports.some((imp) => isCSSImport(imp.n));
    if (!hasCssImports) return ctx.code;

    const cssSpecifiers: string[] = [];
    const allocateExportLocal = createCssExportLocalAllocator(ctx.code);

    const result = await rewriteImports(commentMask.masked, (imp, statement) => {
      if (!isCSSImport(imp.n)) return null;
      cssSpecifiers.push(imp.n!);
      const moduleKey = isCssModuleImport(imp.n)
        ? resolveCssModuleKey(imp.n!, ctx.filePath, ctx.projectDir)
        : undefined;
      const specifierForStub = moduleKey ?? imp.n!;
      if (imp.d > -1) return generateDynamicCSSStub(specifierForStub);
      return generateCSSStub(statement, specifierForStub, allocateExportLocal);
    });

    if (cssSpecifiers.length > 0) {
      ctx.metadata.set("cssImports", cssSpecifiers);
    }

    return commentMask.restore(result);
  },
};
