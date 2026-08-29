import { parse } from "@std/yaml/parse";
import type { Root } from "mdast";
import type { Position } from "unist";

import type { SourceLocator } from "./source.ts";
import type { ContentSyntaxDiagnostic } from "./types.ts";

interface YamlFrontmatterNode {
  readonly type: "yaml";
  readonly value: string;
  readonly position?: Position;
}

function isYamlFrontmatterNode(node: unknown): node is YamlFrontmatterNode {
  if (typeof node !== "object" || node === null) return false;
  return Object.getOwnPropertyDescriptor(node, "type")?.value === "yaml" &&
    typeof Object.getOwnPropertyDescriptor(node, "value")?.value === "string";
}

function contentStart(value: string, node: YamlFrontmatterNode): number {
  const start = node.position?.start.offset ?? 0;
  for (let index = start; index < value.length; index++) {
    if (value[index] === "\n") return index + 1;
    if (value[index] === "\r") {
      return value[index + 1] === "\n" ? index + 2 : index + 1;
    }
  }
  return start;
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
  if (
    !Number.isSafeInteger(targetLine) || targetLine < 1 ||
    !Number.isSafeInteger(targetColumn) || targetColumn < 1
  ) return undefined;

  let offset = 0;
  let line = 1;
  while (line < targetLine && offset < value.length) {
    if (value[offset] === "\r") {
      offset += value[offset + 1] === "\n" ? 2 : 1;
      line++;
    } else if (value[offset] === "\n") {
      offset++;
      line++;
    } else {
      offset++;
    }
  }
  if (line < targetLine) return value.length;

  let remaining = targetColumn - 1;
  while (
    remaining > 0 && offset < value.length && value[offset] !== "\r" &&
    value[offset] !== "\n"
  ) {
    const codePoint = value.codePointAt(offset);
    offset += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    remaining--;
  }
  return offset;
}

function yamlErrorOffset(error: SyntaxError, yaml: string): number | undefined {
  // The core YAML adapter retains an exact parser offset. The permissionless
  // JSR entry exposes only the parser's line and column in its message.
  const positions = ownValue(ownValue(error, "cause"), "pos");
  if (Array.isArray(positions)) {
    const offset = ownValue(positions, "0");
    if (
      typeof offset === "number" && Number.isSafeInteger(offset) && offset >= 0 &&
      offset <= yaml.length
    ) return offset;
  }

  const match = / at line (\d+), column (\d+):/.exec(error.message);
  return match === null ? undefined : lineColumnOffset(yaml, Number(match[1]), Number(match[2]));
}

export function yamlFrontmatterDiagnostic(
  value: string,
  root: Root,
  locator: SourceLocator,
): ContentSyntaxDiagnostic | undefined {
  for (const node of root.children) {
    if (!isYamlFrontmatterNode(node)) continue;
    try {
      if (node.value.trim() !== "") parse(node.value);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      const firstLine = error.message.split("\n", 1)[0]?.trim() || error.name;
      const start = contentStart(value, node);
      const point = locator.point(start + (yamlErrorOffset(error, node.value) ?? 0));
      return {
        message: `Invalid YAML frontmatter: ${firstLine}`,
        range: { start: point, end: point },
      };
    }
  }
  return undefined;
}
