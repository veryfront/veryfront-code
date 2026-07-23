import type { ParsedImport } from "./types.ts";
import { invalidArgument, validateRemoteUrl } from "./validation.ts";

type ModuleTokenType =
  | "identifier"
  | "string"
  | "template"
  | "dynamic-template"
  | "punctuator"
  | "literal";

interface ModuleToken {
  type: ModuleTokenType;
  value: string;
  allowsRegexAfter?: boolean;
}

const CONTROL_HEADER_KEYWORDS = new Set(["catch", "for", "if", "switch", "while", "with"]);
const BLOCK_BODY_PREFIX_KEYWORDS = new Set(["catch", "do", "else", "finally", "try"]);
const DECLARATION_PREFIX_KEYWORDS = new Set(["abstract", "async", "declare", "default", "export"]);
const MAX_MODULE_SOURCE_LENGTH = 16 * 1024 * 1024;
const MAX_MODULE_TOKENS = 250_000;
const MAX_TEMPLATE_EXPRESSION_DEPTH = 64;
const MAX_DECLARATION_SCAN_STEPS = 1_000_000;
const MAX_EXTRACTED_IMPORTS = 10_000;

const REGEX_PREFIX_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
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
const REGEX_PREFIX_PUNCTUATORS = new Set([
  "(",
  "[",
  "{",
  ",",
  ";",
  ":",
  "=",
  "==",
  "===",
  "!=",
  "!==",
  "=>",
  "!",
  "~",
  "?",
  "?.",
  "+",
  "-",
  "*",
  "%",
  "&",
  "&&",
  "|",
  "||",
  "^",
  "??",
  "<",
  ">",
  "<=",
  ">=",
]);
const MULTI_CHARACTER_PUNCTUATORS = [
  "===",
  "!==",
  ">>>",
  "**=",
  "&&=",
  "||=",
  "??=",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "++",
  "--",
  "&&",
  "||",
  "??",
  "?.",
  "+=",
  "-=",
  "*=",
  "%=",
  "&=",
  "|=",
  "^=",
  "**",
  "<<",
  ">>",
];

function isIdentifierStart(character: string | undefined): boolean {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return character === "$" || character === "_" ||
    (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isIdentifierPart(character: string | undefined): boolean {
  if (isIdentifierStart(character)) return true;
  if (!character) return false;
  const code = character.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isHexDigit(character: string | undefined): boolean {
  return character !== undefined && /^[a-fA-F0-9]$/.test(character);
}

interface EscapeResult {
  nextIndex: number;
  value: string;
}

function readEscapeSequence(source: string, startIndex: number): EscapeResult | null {
  const escaped = source[startIndex];
  if (escaped === undefined) return null;
  if (escaped === "\n") return { nextIndex: startIndex + 1, value: "" };
  if (escaped === "\r") {
    return {
      nextIndex: source[startIndex + 1] === "\n" ? startIndex + 2 : startIndex + 1,
      value: "",
    };
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
  if (Object.hasOwn(simpleEscapes, escaped)) {
    return { nextIndex: startIndex + 1, value: simpleEscapes[escaped]! };
  }

  if (escaped === "x") {
    const digits = source.slice(startIndex + 1, startIndex + 3);
    if (digits.length !== 2 || ![...digits].every(isHexDigit)) return null;
    return { nextIndex: startIndex + 3, value: String.fromCodePoint(Number.parseInt(digits, 16)) };
  }

  if (escaped === "u") {
    if (source[startIndex + 1] === "{") {
      const closingBrace = source.indexOf("}", startIndex + 2);
      if (closingBrace < 0) return null;
      const digits = source.slice(startIndex + 2, closingBrace);
      if (
        digits.length === 0 || digits.length > 6 || ![...digits].every(isHexDigit)
      ) {
        return null;
      }
      const codePoint = Number.parseInt(digits, 16);
      if (codePoint > 0x10ffff) return null;
      return { nextIndex: closingBrace + 1, value: String.fromCodePoint(codePoint) };
    }

    const digits = source.slice(startIndex + 1, startIndex + 5);
    if (digits.length !== 4 || ![...digits].every(isHexDigit)) return null;
    return { nextIndex: startIndex + 5, value: String.fromCodePoint(Number.parseInt(digits, 16)) };
  }

  return { nextIndex: startIndex + 1, value: escaped };
}

function readQuotedString(
  source: string,
  startIndex: number,
  quote: '"' | "'",
): { nextIndex: number; value: string | null } {
  let index = startIndex + 1;
  let value = "";
  let valid = true;
  while (index < source.length) {
    const character = source[index]!;
    if (character === quote) return { nextIndex: index + 1, value: valid ? value : null };
    if (character === "\n" || character === "\r") {
      return { nextIndex: index, value: null };
    }
    if (character === "\\") {
      const escape = readEscapeSequence(source, index + 1);
      if (!escape) {
        valid = false;
        index += 1;
        continue;
      }
      value += escape.value;
      index = escape.nextIndex;
      continue;
    }
    value += character;
    index += 1;
  }
  return { nextIndex: source.length, value: null };
}

function canStartRegularExpression(previous: ModuleToken | undefined): boolean {
  if (!previous) return true;
  if (previous.allowsRegexAfter) return true;
  if (previous.type === "identifier") return REGEX_PREFIX_KEYWORDS.has(previous.value);
  return previous.type === "punctuator" && REGEX_PREFIX_PUNCTUATORS.has(previous.value);
}

function canTerminateStatement(token: ModuleToken | undefined): boolean {
  if (!token) return false;
  if (token.type !== "punctuator") return true;
  return token.value === ")" || token.value === "]" || token.value === "}" ||
    token.value === "++" || token.value === "--";
}

function skipRegularExpression(source: string, startIndex: number): number {
  let index = startIndex + 1;
  let inCharacterClass = false;
  while (index < source.length) {
    const character = source[index]!;
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "\n" || character === "\r") return index;
    if (character === "[") inCharacterClass = true;
    else if (character === "]") inCharacterClass = false;
    else if (character === "/" && !inCharacterClass) {
      index += 1;
      while (isIdentifierPart(source[index])) index += 1;
      return index;
    }
    index += 1;
  }
  return index;
}

function readPunctuator(source: string, index: number): string {
  for (const punctuator of MULTI_CHARACTER_PUNCTUATORS) {
    if (source.startsWith(punctuator, index)) return punctuator;
  }
  return source[index] ?? "";
}

function tokenizeModuleSource(source: string): ModuleToken[] {
  const tokens: ModuleToken[] = [];

  function scan(
    startIndex: number,
    stopAtClosingBrace: boolean,
    templateExpressionDepth: number,
  ): number {
    if (templateExpressionDepth > MAX_TEMPLATE_EXPRESSION_DEPTH) {
      throw invalidArgument("Module source template nesting exceeds the supported limit");
    }
    let index = startIndex;
    let braceDepth = 0;
    let previous: ModuleToken | undefined;
    let atStatementStart = !stopAtClosingBrace;
    let declarationPrefixActive = false;
    let lineBreakBeforeToken = false;
    let pendingDeclaration:
      | {
        kind: "class" | "function";
        parenthesisDepth: number;
        parametersClosed: boolean;
      }
      | null = null;
    const parenthesisContexts: boolean[] = [];
    const statementBlockBraces: boolean[] = [];

    const emit = (type: ModuleTokenType, value: string): ModuleToken => {
      if (tokens.length >= MAX_MODULE_TOKENS) {
        throw invalidArgument("Module source token count exceeds the supported limit");
      }
      const token = { type, value };
      tokens.push(token);
      previous = token;
      return token;
    };

    while (index < source.length) {
      const character = source[index]!;
      if (character === " " || character === "\t" || character === "\v" || character === "\f") {
        index += 1;
        continue;
      }
      if (character === "\n" || character === "\r") {
        lineBreakBeforeToken = true;
        index += character === "\r" && source[index + 1] === "\n" ? 2 : 1;
        continue;
      }

      if (character === "/" && source[index + 1] === "/") {
        index += 2;
        while (index < source.length && source[index] !== "\n" && source[index] !== "\r") {
          index += 1;
        }
        continue;
      }
      if (character === "/" && source[index + 1] === "*") {
        const closingComment = source.indexOf("*/", index + 2);
        const endIndex = closingComment < 0 ? source.length : closingComment + 2;
        if (
          source.slice(index, endIndex).includes("\n") ||
          source.slice(index, endIndex).includes("\r")
        ) {
          lineBreakBeforeToken = true;
        }
        index = endIndex;
        continue;
      }

      if (character === '"' || character === "'") {
        const result = readQuotedString(source, index, character);
        emit(result.value === null ? "literal" : "string", result.value ?? "");
        atStatementStart = false;
        declarationPrefixActive = false;
        lineBreakBeforeToken = false;
        index = result.nextIndex;
        continue;
      }

      if (character === "`") {
        const templateToken = emit("template", "");
        let templateIndex = index + 1;
        let decoded = "";
        let dynamic = false;
        while (templateIndex < source.length) {
          const templateCharacter = source[templateIndex]!;
          if (templateCharacter === "`") {
            templateIndex += 1;
            break;
          }
          if (templateCharacter === "\\") {
            const escape = readEscapeSequence(source, templateIndex + 1);
            if (!escape) {
              templateToken.type = "dynamic-template";
              dynamic = true;
              templateIndex += 1;
              continue;
            }
            if (!dynamic) decoded += escape.value;
            templateIndex = escape.nextIndex;
            continue;
          }
          if (templateCharacter === "$" && source[templateIndex + 1] === "{") {
            dynamic = true;
            templateToken.type = "dynamic-template";
            templateIndex = scan(templateIndex + 2, true, templateExpressionDepth + 1);
            continue;
          }
          if (!dynamic) decoded += templateCharacter;
          templateIndex += 1;
        }
        if (!dynamic) templateToken.value = decoded;
        previous = templateToken;
        atStatementStart = false;
        declarationPrefixActive = false;
        lineBreakBeforeToken = false;
        index = templateIndex;
        continue;
      }

      if (character === "/" && canStartRegularExpression(previous)) {
        index = skipRegularExpression(source, index);
        emit("literal", "regex");
        atStatementStart = false;
        declarationPrefixActive = false;
        lineBreakBeforeToken = false;
        continue;
      }

      if (isIdentifierStart(character)) {
        const identifierStart = index;
        index += 1;
        while (isIdentifierPart(source[index])) index += 1;
        const identifier = source.slice(identifierStart, index);
        const canBeginDeclaration = atStatementStart || declarationPrefixActive ||
          (lineBreakBeforeToken && canTerminateStatement(previous));
        emit("identifier", identifier);
        if (canBeginDeclaration && DECLARATION_PREFIX_KEYWORDS.has(identifier)) {
          declarationPrefixActive = true;
        } else {
          if (canBeginDeclaration && (identifier === "class" || identifier === "function")) {
            pendingDeclaration = {
              kind: identifier,
              parenthesisDepth: parenthesisContexts.length,
              parametersClosed: identifier === "class",
            };
          }
          declarationPrefixActive = false;
        }
        atStatementStart = false;
        lineBreakBeforeToken = false;
        continue;
      }

      const code = character.charCodeAt(0);
      if (code >= 48 && code <= 57) {
        const numberStart = index;
        index += 1;
        while (isIdentifierPart(source[index]) || source[index] === ".") index += 1;
        emit("literal", source.slice(numberStart, index));
        atStatementStart = false;
        declarationPrefixActive = false;
        lineBreakBeforeToken = false;
        continue;
      }

      let closesStatementBlock = false;
      let opensStatementBlock = false;
      if (character === "}") {
        if (stopAtClosingBrace && braceDepth === 0) return index + 1;
        braceDepth = Math.max(0, braceDepth - 1);
        closesStatementBlock = statementBlockBraces.pop() ?? false;
      } else if (character === "{") {
        braceDepth += 1;
        const opensDeclarationBody = pendingDeclaration !== null &&
          parenthesisContexts.length === pendingDeclaration.parenthesisDepth &&
          pendingDeclaration.parametersClosed;
        opensStatementBlock = previous?.allowsRegexAfter === true ||
          (previous?.type === "identifier" && BLOCK_BODY_PREFIX_KEYWORDS.has(previous.value)) ||
          atStatementStart || opensDeclarationBody;
        statementBlockBraces.push(opensStatementBlock);
        if (opensDeclarationBody) pendingDeclaration = null;
      }

      const punctuator = readPunctuator(source, index);
      if (punctuator === "(") {
        parenthesisContexts.push(
          previous?.type === "identifier" && CONTROL_HEADER_KEYWORDS.has(previous.value),
        );
      }
      const punctuationToken = emit("punctuator", punctuator);
      if (punctuator === ")") {
        const closesControlHeader = parenthesisContexts.pop() ?? false;
        if (
          pendingDeclaration?.kind === "function" &&
          parenthesisContexts.length === pendingDeclaration.parenthesisDepth
        ) {
          pendingDeclaration.parametersClosed = true;
        }
        if (closesControlHeader) punctuationToken.allowsRegexAfter = true;
      } else if (punctuator === "}" && closesStatementBlock) {
        punctuationToken.allowsRegexAfter = true;
      }
      if (punctuator === "{") atStatementStart = opensStatementBlock;
      else if (punctuator === ";" || (punctuator === "}" && closesStatementBlock)) {
        atStatementStart = true;
      } else {
        atStatementStart = false;
      }
      if (punctuator === ";") pendingDeclaration = null;
      declarationPrefixActive = false;
      lineBreakBeforeToken = false;
      index += punctuator.length || 1;
    }
    return index;
  }

  scan(0, false, 0);
  return tokens;
}

function isModuleSpecifierToken(token: ModuleToken | undefined): token is ModuleToken {
  return token?.type === "string" || token?.type === "template";
}

function findFromSpecifier(
  tokens: ModuleToken[],
  startIndex: number,
  budget: { remaining: number },
): string | undefined {
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  for (let index = startIndex; index < tokens.length; index += 1) {
    if (budget.remaining-- <= 0) {
      throw invalidArgument("Module import declarations exceed the supported complexity limit");
    }
    const token = tokens[index]!;
    if (
      token.type === "punctuator" && token.value === ";" && braceDepth === 0 &&
      bracketDepth === 0 && parenthesisDepth === 0
    ) {
      return undefined;
    }
    if (
      token.type === "identifier" && token.value === "from" && braceDepth === 0 &&
      bracketDepth === 0 && parenthesisDepth === 0
    ) {
      const specifier = tokens[index + 1];
      if (specifier?.type === "string") return specifier.value;
    }
    if (token.type !== "punctuator") continue;
    if (token.value === "{") braceDepth += 1;
    else if (token.value === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (token.value === "[") bracketDepth += 1;
    else if (token.value === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (token.value === "(") parenthesisDepth += 1;
    else if (token.value === ")") parenthesisDepth = Math.max(0, parenthesisDepth - 1);
  }
  return undefined;
}

/**
 * Extract static and literal dynamic imports from a module source snapshot.
 *
 * The scan rejects sources larger than 16 MiB and declarations that exceed
 * bounded token, nesting, import-count, or scan-work limits.
 */
export function extractImports(content: string): ParsedImport[] {
  if (typeof content !== "string") throw invalidArgument("Module source must be a string");
  if (content.length > MAX_MODULE_SOURCE_LENGTH) {
    throw invalidArgument("Module source exceeds the supported size limit");
  }
  const tokens = tokenizeModuleSource(content);
  const imports: ParsedImport[] = [];
  const seen = new Map<string, number>();
  const declarationScanBudget = { remaining: MAX_DECLARATION_SCAN_STEPS };

  const addImport = (specifier: string | undefined, type: ParsedImport["type"]): void => {
    if (!specifier) return;
    const existingIndex = seen.get(specifier);
    if (existingIndex !== undefined) {
      if (type === "static") imports[existingIndex] = { specifier, type };
      return;
    }
    if (imports.length >= MAX_EXTRACTED_IMPORTS) {
      throw invalidArgument("Module import count exceeds the supported limit");
    }
    seen.set(specifier, imports.length);
    imports.push({ specifier, type });
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.type !== "identifier" || (token.value !== "import" && token.value !== "export")) {
      continue;
    }
    const previous = tokens[index - 1];
    if (previous?.type === "punctuator" && (previous.value === "." || previous.value === "?.")) {
      continue;
    }

    if (token.value === "export") {
      addImport(findFromSpecifier(tokens, index + 1, declarationScanBudget), "static");
      continue;
    }

    const next = tokens[index + 1];
    if (next?.type === "punctuator" && next.value === ".") continue;
    if (next?.type === "punctuator" && next.value === "(") {
      const specifier = tokens[index + 2];
      const afterSpecifier = tokens[index + 3];
      if (
        isModuleSpecifierToken(specifier) && afterSpecifier?.type === "punctuator" &&
        (afterSpecifier.value === ")" || afterSpecifier.value === ",")
      ) {
        addImport(specifier.value, "dynamic");
      }
      continue;
    }
    if (next?.type === "string") {
      addImport(next.value, "static");
      continue;
    }
    addImport(findFromSpecifier(tokens, index + 1, declarationScanBudget), "static");
  }

  return imports;
}

export function resolveImportUrl(specifier: string, baseUrl: string): string | null {
  if (typeof specifier !== "string" || typeof baseUrl !== "string") return null;
  if (specifier.startsWith("http://") || specifier.startsWith("https://")) {
    try {
      return validateRemoteUrl(specifier);
    } catch {
      return null;
    }
  }
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;

  try {
    validateRemoteUrl(baseUrl);
    return validateRemoteUrl(new URL(specifier, baseUrl).toString());
  } catch {
    /* expected: specifier may not be a valid relative URL */
    return null;
  }
}
