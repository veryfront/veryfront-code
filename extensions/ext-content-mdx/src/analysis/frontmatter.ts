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
      const point = locator.point(contentStart(value, node));
      return {
        message: `Invalid YAML frontmatter: ${firstLine}`,
        range: { start: point, end: point },
      };
    }
  }
  return undefined;
}
