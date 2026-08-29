import { parse } from "@std/yaml/parse";
import { matchFrontMatterSource } from "#veryfront/platform/compat/std/front-matter-source.ts";

import type { SourceLocator } from "./source.ts";
import type { ContentSyntaxDiagnostic } from "./types.ts";

export type FrontmatterAnalysis =
  | {
    readonly kind: "source";
    readonly offset: number;
    readonly value: string;
  }
  | {
    readonly kind: "syntax-error";
    readonly diagnostic: ContentSyntaxDiagnostic;
  };

function source(value: string, offset = 0): FrontmatterAnalysis {
  return { kind: "source", offset, value };
}

function ownValue(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return Reflect.getOwnPropertyDescriptor(value, key)?.value;
  } catch {
    return undefined;
  }
}

function lineColumnOffset(
  value: string,
  targetLine: number,
  targetColumn: number,
): number | undefined {
  if (!isPositiveSafeInteger(targetLine) || !isPositiveSafeInteger(targetColumn)) {
    return undefined;
  }

  const lineStart = offsetForLine(value, targetLine);
  if (lineStart === undefined) return value.length;

  return offsetForColumn(value, lineStart, targetColumn);
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

function offsetForLine(value: string, targetLine: number): number | undefined {
  let offset = 0;
  let line = 1;
  while (line < targetLine && offset < value.length) {
    offset = nextLineOffset(value, offset);
    line++;
  }
  return line === targetLine ? offset : undefined;
}

function nextLineOffset(value: string, offset: number): number {
  while (offset < value.length) {
    const codeUnit = value[offset];
    offset++;
    if (codeUnit === "\r") return value[offset] === "\n" ? offset + 1 : offset;
    if (codeUnit === "\n") return offset;
  }
  return offset;
}

function offsetForColumn(value: string, lineStart: number, targetColumn: number): number {
  let offset = lineStart;
  let remaining = targetColumn - 1;
  while (remaining > 0 && isLineContent(value, offset)) {
    const codePoint = value.codePointAt(offset);
    offset += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    remaining--;
  }
  return offset;
}

function isLineContent(value: string, offset: number): boolean {
  return offset < value.length && value[offset] !== "\r" && value[offset] !== "\n";
}

function yamlParserOffset(error: SyntaxError, yamlLength: number): number | undefined {
  // The core YAML adapter retains an exact parser offset. The permissionless
  // JSR entry exposes only the parser's line and column in its message.
  const positions = ownValue(ownValue(error, "cause"), "pos");
  if (!Array.isArray(positions)) return undefined;
  const offset = ownValue(positions, "0");
  const validOffset = typeof offset === "number" && Number.isSafeInteger(offset) &&
    offset >= 0 && offset <= yamlLength;
  return validOffset ? offset : undefined;
}

function yamlErrorOffset(error: SyntaxError, yaml: string): number | undefined {
  const offset = yamlParserOffset(error, yaml.length);
  if (offset !== undefined) return offset;
  const match = / at line (\d+), column (\d+):/.exec(error.message);
  return match === null ? undefined : lineColumnOffset(yaml, Number(match[1]), Number(match[2]));
}

export function analyzeFrontmatterSource(
  value: string,
  enabled: boolean,
  locator: SourceLocator,
): FrontmatterAnalysis {
  if (!enabled) return source(value);
  const matched = matchFrontMatterSource(value);
  if (matched === undefined) return source(value);

  try {
    if (matched.frontMatter.trim() !== "") parse(matched.frontMatter);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const firstLine = error.message.split("\n", 1)[0]?.trim() || error.name;
    const point = locator.point(
      matched.frontMatterStart +
        (yamlErrorOffset(error, matched.frontMatter) ?? 0),
    );
    return {
      kind: "syntax-error",
      diagnostic: {
        message: `Invalid YAML frontmatter: ${firstLine}`,
        range: { start: point, end: point },
      },
    };
  }

  return source(matched.body, matched.bodyStart);
}
