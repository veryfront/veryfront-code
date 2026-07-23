import { extract } from "#std/front-matter/yaml.ts";
import { BUILD_FAILED } from "#veryfront/errors";
import type { MDXFrontmatter } from "./types.ts";
import { normalizeMDXFrontmatter } from "../frontmatter.ts";

interface ParsedContent {
  frontmatter: MDXFrontmatter;
  content: string;
}

export async function parseFrontmatter(content: string): Promise<ParsedContent> {
  if (!content.trimStart().startsWith("---")) {
    return { frontmatter: {}, content };
  }

  try {
    const result = extract(content);
    return {
      frontmatter: normalizeMDXFrontmatter(result.attrs ?? {}),
      content: result.body,
    };
  } catch (error) {
    throw BUILD_FAILED.create({ detail: "Invalid MDX frontmatter", cause: error });
  }
}

export function extractExports(
  content: string,
): { frontmatter: MDXFrontmatter; content: string } {
  const frontmatter = Object.create(null) as MDXFrontmatter;
  const declarationPattern = /^[\t ]*export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*/gm;
  const removedRanges: Array<{ start: number; end: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = declarationPattern.exec(content)) !== null) {
    const key = match[1];
    if (!key) continue;
    const expression = scanExportExpression(content, declarationPattern.lastIndex);
    declarationPattern.lastIndex = expression.declarationEnd;
    const parsed = parseSerializableExport(expression.value);
    if (!parsed.matched) continue;
    if (Object.hasOwn(frontmatter, key)) {
      throw BUILD_FAILED.create({ detail: `Duplicate MDX metadata export: ${key}` });
    }
    frontmatter[key] = parsed.value;
    removedRanges.push({ start: match.index, end: expression.declarationEnd });
  }

  if (removedRanges.length === 0) return { frontmatter, content };

  let cursor = 0;
  let remainingContent = "";
  for (const range of removedRanges) {
    remainingContent += content.slice(cursor, range.start);
    cursor = range.end;
  }
  remainingContent += content.slice(cursor);
  return { frontmatter, content: remainingContent };
}

function parseSerializableExport(
  value: string,
): { matched: true; value: unknown } | { matched: false } {
  const trimmed = value.trim().replace(/;$/, "").trim();
  if (!trimmed) return { matched: false };
  try {
    if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
      if (trimmed.startsWith("'")) {
        return { matched: true, value: parseSingleQuotedString(trimmed) };
      }
      return { matched: true, value: JSON.parse(trimmed) };
    }
    if (
      !/^(?:\{|\[|true$|false$|null$|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$)/.test(trimmed)
    ) {
      return { matched: false };
    }
    return { matched: true, value: JSON.parse(trimmed) };
  } catch {
    return { matched: false };
  }
}

function parseSingleQuotedString(value: string): string {
  if (value.length < 2 || !value.endsWith("'")) throw new SyntaxError("Unclosed string");
  let result = "";
  for (let index = 1; index < value.length - 1; index++) {
    const character = value[index];
    if (character !== "\\") {
      if (character === "\n" || character === "\r") throw new SyntaxError("Invalid string");
      result += character;
      continue;
    }
    const escaped = value[++index];
    if (escaped === undefined) throw new SyntaxError("Invalid escape");
    const simpleEscape: Record<string, string> = {
      "'": "'",
      '"': '"',
      "\\": "\\",
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
      v: "\v",
      "0": "\0",
    };
    if (Object.hasOwn(simpleEscape, escaped)) {
      result += simpleEscape[escaped];
      continue;
    }
    throw new SyntaxError("Unsupported string escape");
  }
  return result;
}

function scanExportExpression(
  content: string,
  expressionStart: number,
): { value: string; declarationEnd: number } {
  const closingTokens: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (let index = expressionStart; index < content.length; index++) {
    const character = content[index]!;
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (Object.hasOwn(closingTokens, character)) {
      stack.push(closingTokens[character]!);
      continue;
    }
    if (stack.at(-1) === character) {
      stack.pop();
      continue;
    }
    if (stack.length === 0 && (character === ";" || character === "\n" || character === "\r")) {
      const declarationEnd = character === ";" ? index + 1 : index;
      return {
        value: content.slice(expressionStart, declarationEnd),
        declarationEnd,
      };
    }
  }

  return { value: content.slice(expressionStart), declarationEnd: content.length };
}
