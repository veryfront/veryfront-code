import { parse } from "acorn";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { mdxjs } from "micromark-extension-mdxjs";
import type {
  ContentFrontmatterOptions,
  ContentFrontmatterResult,
} from "veryfront/extensions/content";
import {
  extractFrontmatter as extractBaseFrontmatter,
  mergeFrontmatter,
} from "veryfront/transforms/frontmatter";

interface EstreeNode {
  type: string;
  [key: string]: unknown;
}

interface ProgramNode extends EstreeNode {
  type: "Program";
  body: EstreeNode[];
}

function isNode(value: unknown): value is EstreeNode {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

function readStaticPrimitive(node: unknown): { supported: true; value: unknown } | null {
  if (!isNode(node)) return null;
  if (node.type === "Literal") {
    const value = node.value;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      return { supported: true, value };
    }
    return null;
  }

  if (
    node.type === "UnaryExpression" &&
    (node.operator === "-" || node.operator === "+") &&
    isNode(node.argument) &&
    node.argument.type === "Literal" &&
    typeof node.argument.value === "number" &&
    Number.isFinite(node.argument.value)
  ) {
    return {
      supported: true,
      value: node.operator === "-" ? -node.argument.value : node.argument.value,
    };
  }

  if (
    node.type === "TemplateLiteral" &&
    Array.isArray(node.expressions) &&
    node.expressions.length === 0 &&
    Array.isArray(node.quasis) &&
    node.quasis.length === 1
  ) {
    const quasi = node.quasis[0];
    if (
      isNode(quasi) &&
      typeof quasi.value === "object" &&
      quasi.value !== null &&
      typeof (quasi.value as { cooked?: unknown }).cooked === "string"
    ) {
      return {
        supported: true,
        value: (quasi.value as { cooked: string }).cooked,
      };
    }
  }

  return null;
}

function parseStaticExport(line: string): [string, unknown] | null {
  if (!line.startsWith("export")) return null;

  let program: ProgramNode;
  try {
    program = parse(line, {
      ecmaVersion: "latest",
      sourceType: "module",
    }) as unknown as ProgramNode;
  } catch {
    return null;
  }

  if (program.body.length !== 1) return null;
  const exported = program.body[0];
  if (exported?.type !== "ExportNamedDeclaration" || !isNode(exported.declaration)) {
    return null;
  }
  const declaration = exported.declaration;
  if (
    declaration.type !== "VariableDeclaration" ||
    declaration.kind !== "const" ||
    !Array.isArray(declaration.declarations) ||
    declaration.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = declaration.declarations[0];
  if (
    !isNode(declarator) ||
    declarator.type !== "VariableDeclarator" ||
    !isNode(declarator.id) ||
    declarator.id.type !== "Identifier" ||
    typeof declarator.id.name !== "string"
  ) {
    return null;
  }
  const value = readStaticPrimitive(declarator.init);
  return value ? [declarator.id.name, value.value] : null;
}

interface StaticExportCandidate {
  start: number;
  contentEnd: number;
  lineEnd: number;
  name: string;
  value: unknown;
}

interface PositionedNode {
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
}

function splitLinesPreservingEndings(value: string): string[] {
  const lines = value.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function collectStaticExportCandidates(body: string): StaticExportCandidate[] {
  const candidates: StaticExportCandidate[] = [];
  let offset = 0;
  for (const lineWithEnding of splitLinesPreservingEndings(body)) {
    const line = lineWithEnding.replace(/(?:\r\n|\r|\n)$/, "");
    const exported = parseStaticExport(line);
    if (exported) {
      candidates.push({
        start: offset,
        contentEnd: offset + line.length,
        lineEnd: offset + lineWithEnding.length,
        name: exported[0],
        value: exported[1],
      });
    }
    offset += lineWithEnding.length;
  }
  return candidates;
}

function maskStaticExportCandidates(
  body: string,
  candidates: readonly StaticExportCandidate[],
): string {
  let cursor = 0;
  const output: string[] = [];
  for (const candidate of candidates) {
    output.push(body.slice(cursor, candidate.start));
    output.push(body.slice(candidate.start, candidate.contentEnd).replace(/[^\r\n]/g, " "));
    cursor = candidate.contentEnd;
  }
  output.push(body.slice(cursor));
  return output.join("");
}

function getEnclosingNodeRanges(
  body: string,
  syntax: "markdown" | "mdx",
): Array<{ start: number; end: number }> | null {
  try {
    const tree = fromMarkdown(
      body,
      syntax === "mdx"
        ? {
          extensions: [mdxjs()],
          mdastExtensions: [mdxFromMarkdown()],
        }
        : undefined,
    ) as { children: PositionedNode[] };

    const ranges: Array<{ start: number; end: number }> = [];
    for (const child of tree.children) {
      const start = child.position?.start?.offset;
      const end = child.position?.end?.offset;
      if (typeof start === "number" && typeof end === "number") {
        ranges.push({ start, end });
      }
    }
    return ranges.sort((left, right) => left.start - right.start);
  } catch {
    // An invalid document must reach the compiler unchanged so its syntax error
    // remains visible instead of being hidden by metadata preprocessing.
    return null;
  }
}

function extractExportConstants(
  body: string,
  syntax: "markdown" | "mdx",
): { body: string; exports: Record<string, unknown> } {
  const candidates = collectStaticExportCandidates(body);
  if (candidates.length === 0) return { body, exports: {} };

  const ranges = getEnclosingNodeRanges(
    maskStaticExportCandidates(body, candidates),
    syntax,
  );
  if (ranges === null) return { body, exports: {} };

  const exports: Record<string, unknown> = {};
  const output: string[] = [];
  let cursor = 0;
  let rangeIndex = 0;
  for (const candidate of candidates) {
    while (ranges[rangeIndex]?.end !== undefined && ranges[rangeIndex]!.end <= candidate.start) {
      rangeIndex++;
    }
    const range = ranges[rangeIndex];
    if (
      range !== undefined &&
      range.start <= candidate.start &&
      range.end >= candidate.contentEnd
    ) {
      continue;
    }
    output.push(body.slice(cursor, candidate.start));
    cursor = candidate.lineEnd;
    exports[candidate.name] = candidate.value;
  }
  output.push(body.slice(cursor));
  return { body: output.join(""), exports };
}

/** Parse YAML and parser-recognized static metadata exports for one content document. */
export function extractContentFrontmatter(
  options: ContentFrontmatterOptions,
): ContentFrontmatterResult {
  const base = extractBaseFrontmatter(options.content, options.frontmatter);
  const { body, exports } = extractExportConstants(base.body, options.syntax);
  return {
    body,
    frontmatter: mergeFrontmatter(
      [base.frontmatter, "Base frontmatter"],
      [exports, "Exported frontmatter"],
    ),
  };
}
