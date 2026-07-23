/** A string-literal module specifier and its source range. */
export interface ModuleSpecifierSpan {
  /** Start of the specifier contents, excluding the quote. */
  start: number;
  /** End of the specifier contents, excluding the quote. */
  end: number;
  /** Specifier text as written in the source. */
  specifier: string;
  /** Whether this is a dynamic `import()` expression. */
  dynamic: boolean;
}

export interface JavaScriptSourceToken {
  type: "identifier" | "string" | "punctuation";
  start: number;
  end: number;
  value: string;
}

const REGEX_PREFIX_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_$]/.test(character);
}

function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_$]/.test(character);
}

function skipQuotedString(source: string, start: number): number {
  const quote = source[start];
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source[cursor] === quote) return cursor + 1;
    cursor++;
  }
  return source.length;
}

function canStartRegex(previous: JavaScriptSourceToken | undefined): boolean {
  if (!previous) return true;
  if (previous.type === "identifier") return REGEX_PREFIX_KEYWORDS.has(previous.value);
  return /[([{,:;=!?&|+\-*%^~<>]/.test(previous.value);
}

function skipRegexLiteral(source: string, start: number): number {
  let cursor = start + 1;
  let inCharacterClass = false;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === "\\") {
      cursor += 2;
      continue;
    }
    if (character === "\n" || character === "\r") return start + 1;
    if (character === "[") inCharacterClass = true;
    if (character === "]") inCharacterClass = false;
    if (character === "/" && !inCharacterClass) {
      cursor++;
      while (/[A-Za-z]/.test(source[cursor] ?? "")) cursor++;
      return cursor;
    }
    cursor++;
  }
  return start + 1;
}

function scanTemplateLiteral(
  source: string,
  start: number,
  tokens: JavaScriptSourceToken[],
): number {
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source[cursor] === "`") return cursor + 1;
    if (source[cursor] === "$" && source[cursor + 1] === "{") {
      cursor = scanCode(source, cursor + 2, tokens, true);
      continue;
    }
    cursor++;
  }
  return source.length;
}

function scanCode(
  source: string,
  start: number,
  tokens: JavaScriptSourceToken[],
  stopAtTemplateExpressionEnd: boolean,
): number {
  let cursor = start;
  let braceDepth = stopAtTemplateExpressionEnd ? 1 : 0;
  let previous: JavaScriptSourceToken | undefined;

  while (cursor < source.length) {
    const character = source[cursor];
    const next = source[cursor + 1];

    if (/\s/.test(character ?? "")) {
      cursor++;
      continue;
    }

    if (character === "/" && next === "/") {
      const newline = source.indexOf("\n", cursor + 2);
      cursor = newline === -1 ? source.length : newline + 1;
      continue;
    }

    if (character === "/" && next === "*") {
      const end = source.indexOf("*/", cursor + 2);
      cursor = end === -1 ? source.length : end + 2;
      continue;
    }

    if (character === '"' || character === "'") {
      const end = skipQuotedString(source, cursor);
      const closed = end <= source.length && source[end - 1] === character;
      if (closed) {
        previous = {
          type: "string",
          start: cursor + 1,
          end: end - 1,
          value: source.slice(cursor + 1, end - 1),
        };
        tokens.push(previous);
      }
      cursor = end;
      continue;
    }

    if (character === "`") {
      const templateStart = cursor;
      cursor = scanTemplateLiteral(source, cursor, tokens);
      previous = {
        type: "identifier",
        start: templateStart,
        end: cursor,
        value: "__template_literal__",
      };
      tokens.push(previous);
      continue;
    }

    if (character === "/" && canStartRegex(previous)) {
      const regexEnd = skipRegexLiteral(source, cursor);
      if (regexEnd > cursor + 1) {
        previous = {
          type: "identifier",
          start: cursor,
          end: regexEnd,
          value: "__regex_literal__",
        };
        cursor = regexEnd;
        continue;
      }
    }

    if (isIdentifierStart(character)) {
      const start = cursor++;
      while (isIdentifierPart(source[cursor])) cursor++;
      previous = {
        type: "identifier",
        start,
        end: cursor,
        value: source.slice(start, cursor),
      };
      tokens.push(previous);
      continue;
    }

    if (stopAtTemplateExpressionEnd) {
      if (character === "{") braceDepth++;
      if (character === "}") {
        braceDepth--;
        if (braceDepth === 0) return cursor + 1;
      }
    }

    previous = {
      type: "punctuation",
      start: cursor,
      end: cursor + 1,
      value: character ?? "",
    };
    tokens.push(previous);
    cursor++;
  }

  return cursor;
}

/** Tokenize executable JavaScript while excluding comments and literal contents. */
export function tokenizeJavaScriptSource(source: string): JavaScriptSourceToken[] {
  const tokens: JavaScriptSourceToken[] = [];
  scanCode(source, 0, tokens, false);
  return tokens;
}

function toSpecifierSpan(
  token: JavaScriptSourceToken,
  dynamic: boolean,
): ModuleSpecifierSpan {
  return {
    start: token.start,
    end: token.end,
    specifier: token.value,
    dynamic,
  };
}

/** Find static and string-literal dynamic module specifiers without matching comments or data. */
export function findModuleSpecifierSpans(source: string): ModuleSpecifierSpan[] {
  const tokens = tokenizeJavaScriptSource(source);
  const spans: ModuleSpecifierSpan[] = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token?.type !== "identifier") continue;
    if (tokens[index - 1]?.value === ".") continue;

    if (token.value === "import") {
      const next = tokens[index + 1];
      if (!next || next.value === ".") continue;
      if (next.value === "(") {
        const argument = tokens[index + 2];
        if (argument?.type === "string") spans.push(toSpecifierSpan(argument, true));
        continue;
      }
      if (next.type === "string") {
        spans.push(toSpecifierSpan(next, false));
        continue;
      }

      for (let candidate = index + 1; candidate < tokens.length; candidate++) {
        const current = tokens[candidate];
        if (!current || current.value === ";") break;
        if (
          candidate > index + 1 && current.type === "identifier" &&
          (current.value === "import" || current.value === "export")
        ) break;
        if (current.type !== "identifier" || current.value !== "from") continue;
        const specifier = tokens[candidate + 1];
        if (specifier?.type === "string") spans.push(toSpecifierSpan(specifier, false));
        break;
      }
      continue;
    }

    if (token.value !== "export") continue;
    let nextIndex = index + 1;
    if (tokens[nextIndex]?.value === "type") nextIndex++;
    const next = tokens[nextIndex];
    if (next?.value !== "*" && next?.value !== "{") continue;

    for (let candidate = nextIndex + 1; candidate < tokens.length; candidate++) {
      const current = tokens[candidate];
      if (!current || current.value === ";") break;
      if (current.type !== "identifier" || current.value !== "from") continue;
      const specifier = tokens[candidate + 1];
      if (specifier?.type === "string") spans.push(toSpecifierSpan(specifier, false));
      break;
    }
  }

  return spans;
}

function escapeSpecifierForQuote(specifier: string, quote: string): string {
  const quotePattern = quote === '"' ? /"/g : /'/g;
  return specifier
    .replace(/\\/g, "\\\\")
    .replace(quotePattern, `\\${quote}`)
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Rewrite module specifiers while preserving all non-specifier source text. */
export function rewriteModuleSpecifiers(
  source: string,
  rewriter: (specifier: string, dynamic: boolean) => string | null | undefined,
): string {
  let result = source;
  const spans = findModuleSpecifierSpans(source);
  for (let index = spans.length - 1; index >= 0; index--) {
    const span = spans[index]!;
    const replacement = rewriter(span.specifier, span.dynamic);
    if (replacement === null || replacement === undefined || replacement === span.specifier) {
      continue;
    }
    const quote = source[span.start - 1] ?? '"';
    const escaped = escapeSpecifierForQuote(replacement, quote);
    result = result.slice(0, span.start) + escaped + result.slice(span.end);
  }
  return result;
}

/** Rewrite module specifiers with an asynchronous resolver. */
export async function rewriteModuleSpecifiersAsync(
  source: string,
  rewriter: (
    specifier: string,
    dynamic: boolean,
  ) => string | null | undefined | Promise<string | null | undefined>,
): Promise<string> {
  const replacements: Array<{ span: ModuleSpecifierSpan; replacement: string }> = [];
  for (const span of findModuleSpecifierSpans(source)) {
    const replacement = await rewriter(span.specifier, span.dynamic);
    if (replacement === null || replacement === undefined || replacement === span.specifier) {
      continue;
    }
    replacements.push({ span, replacement });
  }

  let result = source;
  for (let index = replacements.length - 1; index >= 0; index--) {
    const { span, replacement } = replacements[index]!;
    const quote = source[span.start - 1] ?? '"';
    const escaped = escapeSpecifierForQuote(replacement, quote);
    result = result.slice(0, span.start) + escaped + result.slice(span.end);
  }
  return result;
}
