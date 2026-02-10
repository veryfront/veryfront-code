import { parse, type ParserPlugin } from "@babel/parser";
import { BASE_TS_PLUGINS } from "./config.ts";
import type { AstNodeLike } from "./types.ts";

function isAstNodeLike(value: unknown): value is AstNodeLike {
  return typeof value === "object" && value !== null && "type" in value;
}

export function parseSource(file: string, source: string): AstNodeLike {
  const plugins: ParserPlugin[] = file.endsWith(".tsx")
    ? [...BASE_TS_PLUGINS, "jsx"]
    : [...BASE_TS_PLUGINS];

  return parse(source, {
    sourceType: "module",
    plugins,
  }) as unknown as AstNodeLike;
}

export function walkAst(
  node: unknown,
  visit: (node: AstNodeLike) => void,
): void {
  if (!isAstNodeLike(node)) return;
  visit(node);

  for (const [key, value] of Object.entries(node)) {
    if (
      key === "loc" ||
      key === "start" ||
      key === "end" ||
      key === "leadingComments" ||
      key === "trailingComments" ||
      key === "innerComments"
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walkAst(item, visit);
      }
      continue;
    }

    if (typeof value === "object" && value !== null) {
      walkAst(value, visit);
    }
  }
}

export function getLine(node: AstNodeLike): number {
  return node.loc?.start?.line ?? 1;
}

export function getColumn(node: AstNodeLike): number {
  return (node.loc?.start?.column ?? 0) + 1;
}
