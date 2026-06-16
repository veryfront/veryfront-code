import { resolve } from "#veryfront/extensions/contracts.ts";
import type { CodeParser, NodePath } from "#veryfront/extensions/parser/index.ts";

interface IdentifierLike {
  name?: unknown;
  value?: unknown;
}

interface ExportSpecifierNode {
  exported?: IdentifierLike;
  local?: IdentifierLike;
  exportKind?: string;
}

interface VariableDeclaratorNode {
  id?: IdentifierLike;
}

interface ExportDeclarationNode {
  type?: string;
  id?: IdentifierLike;
  declarations?: VariableDeclaratorNode[];
  declare?: boolean;
}

interface ExportNamedDeclarationNode {
  declaration?: ExportDeclarationNode;
  specifiers?: ExportSpecifierNode[];
  exportKind?: string;
}

function readName(node: IdentifierLike | undefined): string | null {
  if (typeof node?.name === "string") return node.name;
  if (typeof node?.value === "string") return node.value;
  return null;
}

function isTypeOnlyDeclaration(declaration: ExportDeclarationNode | undefined): boolean {
  if (!declaration) return false;
  if (declaration.declare === true) return true;
  return declaration.type === "TSInterfaceDeclaration" ||
    declaration.type === "TSTypeAliasDeclaration";
}

function addDeclarationNames(names: Set<string>, declaration: ExportDeclarationNode | undefined) {
  if (!declaration || isTypeOnlyDeclaration(declaration)) return;

  if (
    declaration.type === "FunctionDeclaration" ||
    declaration.type === "ClassDeclaration" ||
    declaration.type === "TSEnumDeclaration"
  ) {
    const name = readName(declaration.id);
    if (name) names.add(name);
    return;
  }

  if (declaration.type !== "VariableDeclaration") return;

  for (const declarator of declaration.declarations ?? []) {
    const name = readName(declarator.id);
    if (name) names.add(name);
  }
}

/**
 * Extract runtime export names from source code.
 *
 * Uses the CodeParser AST contract so export-looking strings, comments, and
 * type-only exports do not enter RSC manifests.
 */
export async function extractExportNames(
  source: string,
  filePath = "component.tsx",
): Promise<string[]> {
  const parser = resolve<CodeParser>("CodeParser");
  const ast = await parser.parse({ code: source, filePath });
  const names = new Set<string>();

  parser.traverse(ast, {
    ExportDefaultDeclaration() {
      names.add("default");
    },
    ExportNamedDeclaration(path: NodePath) {
      const node = path.node as ExportNamedDeclarationNode;
      if (node.exportKind === "type") return;

      addDeclarationNames(names, node.declaration);

      for (const specifier of node.specifiers ?? []) {
        if (specifier.exportKind === "type") continue;
        const name = readName(specifier.exported) ?? readName(specifier.local);
        if (name) names.add(name);
      }
    },
  });

  return [...names];
}
