import type { Pluggable } from "unified";
import type { CompilationTarget } from "veryfront/extensions/content";
import {
  type ImportRewriterConfig,
  rewriteImportSpecifier,
} from "veryfront/transforms/import-rewriter";

interface EstreeNode {
  type: string;
  [key: string]: unknown;
}

interface LiteralNode extends EstreeNode {
  type: "Literal";
  value: unknown;
  raw?: string;
}

function isNode(value: unknown): value is EstreeNode {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

function isStringLiteral(value: unknown): value is LiteralNode {
  return isNode(value) && value.type === "Literal" && typeof value.value === "string";
}

function rewriteLiteral(
  source: LiteralNode,
  config: ImportRewriterConfig | undefined,
): void {
  const specifier = source.value as string;
  const resolvedSpecifier = config ? rewriteImportSpecifier(specifier, config) : specifier;

  source.value = resolvedSpecifier;
  delete source.raw;
}

function visitProgram(
  value: unknown,
  config: ImportRewriterConfig | undefined,
  visited: WeakSet<object>,
): void {
  if (typeof value !== "object" || value === null || visited.has(value)) return;
  visited.add(value);

  if (isNode(value)) {
    if (
      value.type === "ImportDeclaration" ||
      value.type === "ExportNamedDeclaration" ||
      value.type === "ExportAllDeclaration"
    ) {
      if (isStringLiteral(value.source)) {
        rewriteLiteral(value.source, config);
      }
    } else if (value.type === "ImportExpression" && isStringLiteral(value.source)) {
      rewriteLiteral(value.source, config);
    }
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const entry of child) {
        visitProgram(entry, config, visited);
      }
      continue;
    }
    visitProgram(child, config, visited);
  }
}

export function createModuleImportRewriter(options: {
  filePath?: string;
  target: CompilationTarget;
  baseUrl?: string;
  projectDir: string;
}): Pluggable {
  const config: ImportRewriterConfig | undefined = options.filePath
    ? {
      filePath: options.filePath,
      target: options.target,
      baseUrl: options.baseUrl,
      projectDir: options.projectDir,
    }
    : undefined;

  const plugin = (() => (tree: EstreeNode) => {
    visitProgram(tree, config, new WeakSet());
  }) as unknown as Pluggable;

  return plugin;
}
