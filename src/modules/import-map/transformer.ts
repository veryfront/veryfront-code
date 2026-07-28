import type { ImportMapConfig, TransformOptions } from "./types.ts";
import { resolveImport } from "./resolver.ts";

function shouldResolve(specifier: string, options?: TransformOptions): boolean {
  if (specifier.startsWith("https://esm.sh/") || specifier.startsWith("http://esm.sh/")) {
    return true;
  }

  const isBare = !/^[A-Za-z][A-Za-z\d+.-]*:/.test(specifier) &&
    !specifier.startsWith("/") &&
    !specifier.startsWith(".");

  if (isBare && !options?.resolveBare) return false;

  return true;
}

interface SourceMask {
  structuralCode: string;
  executable: Uint8Array;
}

interface SourceEdit {
  start: number;
  end: number;
  replacement: string;
}

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

function canStartRegexLiteral(code: string, slashIndex: number): boolean {
  let index = slashIndex - 1;
  while (index >= 0 && /\s/.test(code[index]!)) index--;
  if (index < 0) return true;

  const previous = code[index]!;
  if ("([{=,:;!?&|+-*%^~<>".includes(previous)) return true;
  if (!/[A-Za-z0-9_$]/.test(previous)) return false;

  const end = index + 1;
  while (index >= 0 && /[A-Za-z0-9_$]/.test(code[index]!)) index--;
  return REGEX_PREFIX_KEYWORDS.has(code.slice(index + 1, end));
}

function buildSourceMask(code: string): SourceMask {
  const executable = new Uint8Array(code.length);
  executable.fill(1);
  const structural = [...code];

  const hide = (
    start: number,
    end: number,
    replaceWithSpaces = false,
  ): void => {
    executable.fill(0, start, end);
    if (!replaceWithSpaces) return;
    for (let index = start; index < end; index++) {
      if (structural[index] !== "\n" && structural[index] !== "\r") {
        structural[index] = " ";
      }
    }
  };

  let index = 0;
  while (index < code.length) {
    const char = code[index]!;

    if (char === "'" || char === '"') {
      const start = index++;
      while (index < code.length) {
        if (code[index] === "\\") {
          index += 2;
          continue;
        }
        const current = code[index++];
        if (current === char) break;
      }
      hide(start, Math.min(index, code.length));
      continue;
    }

    if (char === "`") {
      const start = index++;
      while (index < code.length) {
        if (code[index] === "\\") {
          index += 2;
          continue;
        }
        const current = code[index++];
        if (current === "`") break;
      }
      hide(start, Math.min(index, code.length));
      continue;
    }

    if (char !== "/") {
      index++;
      continue;
    }

    const next = code[index + 1];
    if (next === "/") {
      const start = index;
      index += 2;
      while (
        index < code.length &&
        code[index] !== "\n" &&
        code[index] !== "\r"
      ) {
        index++;
      }
      hide(start, index, true);
      continue;
    }

    if (next === "*") {
      const start = index;
      index += 2;
      while (
        index < code.length &&
        !(code[index] === "*" && code[index + 1] === "/")
      ) {
        index++;
      }
      index = Math.min(code.length, index + 2);
      hide(start, index, true);
      continue;
    }

    if (!canStartRegexLiteral(code, index)) {
      index++;
      continue;
    }

    const start = index++;
    let inCharacterClass = false;
    while (index < code.length) {
      const current = code[index]!;
      if (current === "\\") {
        index += 2;
        continue;
      }
      if (current === "[") {
        inCharacterClass = true;
      } else if (current === "]") {
        inCharacterClass = false;
      } else if (current === "/" && !inCharacterClass) {
        index++;
        while (index < code.length && /[A-Za-z]/.test(code[index]!)) index++;
        break;
      } else if (current === "\n" || current === "\r") {
        break;
      }
      index++;
    }
    hide(start, index);
  }

  return {
    structuralCode: structural.join(""),
    executable,
  };
}

function addSpecifierEdit(
  edits: SourceEdit[],
  code: string,
  matchOffset: number,
  match: string,
  specifier: string,
  replacement: string,
): void {
  if (replacement === specifier) return;

  const contentOffset = match.lastIndexOf(specifier);
  if (contentOffset <= 0) return;
  const quoteStart = matchOffset + contentOffset - 1;
  const quoteEnd = matchOffset + contentOffset + specifier.length + 1;
  const openingQuote = code[quoteStart];
  const closingQuote = code[quoteEnd - 1];
  if (
    (openingQuote !== '"' && openingQuote !== "'") ||
    closingQuote !== openingQuote
  ) {
    return;
  }
  edits.push({
    start: quoteStart,
    end: quoteEnd,
    replacement: JSON.stringify(replacement),
  });
}

function applyEdits(code: string, edits: SourceEdit[]): string {
  let transformed = code;
  edits.sort((left, right) => right.start - left.start);
  for (const edit of edits) {
    transformed = transformed.slice(0, edit.start) +
      edit.replacement +
      transformed.slice(edit.end);
  }
  return transformed;
}

export function transformImportsWithMap(
  code: string,
  importMap: ImportMapConfig,
  scope?: string,
  options?: TransformOptions,
): string {
  const resolve = (specifier: string): string => resolveImport(specifier, importMap, scope);
  const { structuralCode, executable } = buildSourceMask(code);
  const edits: SourceEdit[] = [];

  structuralCode.replace(
    /((?:import|export)\s+(?:[\w,{}\s*]+\s+from\s+)?|export\s+(?:\*|\{[^}]+\})\s+from\s+)["']([^"']+)["']/g,
    (match, _prefix: string, specifier: string, offset: number) => {
      if (
        executable[offset] === 1 &&
        shouldResolve(specifier, options)
      ) {
        addSpecifierEdit(
          edits,
          code,
          offset,
          match,
          specifier,
          resolve(specifier),
        );
      }
      return match;
    },
  );

  structuralCode.replace(
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    (match, specifier: string, offset: number) => {
      if (
        executable[offset] === 1 &&
        shouldResolve(specifier, options)
      ) {
        addSpecifierEdit(
          edits,
          code,
          offset,
          match,
          specifier,
          resolve(specifier),
        );
      }
      return match;
    },
  );

  return applyEdits(code, edits);
}
