import {
  IDENTIFIER_CASING_REPLACEMENTS,
  type IdentifierCasingReplacement,
} from "../config.ts";
import type { AstNodeLike, StyleRule } from "../types.ts";

const IDENTIFIER_DECL_NODE_TYPES = new Set([
  "ClassDeclaration",
  "ClassExpression",
  "FunctionDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSEnumDeclaration",
]);

interface NamedIdentifierNode extends AstNodeLike {
  id?: {
    name?: string;
    loc?: {
      start?: {
        line?: number;
        column?: number;
      };
    };
  } | null;
}

interface IdentifierCasingMismatch {
  replacement: IdentifierCasingReplacement;
  suggestedName: string;
}

function findCasingMismatch(
  identifierName: string,
): IdentifierCasingMismatch | null {
  for (const replacement of IDENTIFIER_CASING_REPLACEMENTS) {
    if (!identifierName.includes(replacement.from)) continue;

    const suggestedName = identifierName.replaceAll(
      replacement.from,
      replacement.to,
    );

    if (suggestedName === identifierName) continue;
    return { replacement, suggestedName };
  }

  return null;
}

export const identifierCasingRule: StyleRule = {
  id: "identifier-casing",
  visit(node, context): void {
    if (!IDENTIFIER_DECL_NODE_TYPES.has(node.type ?? "")) return;

    const namedNode = node as NamedIdentifierNode;
    const name = namedNode.id?.name;
    if (!name) return;

    const mismatch = findCasingMismatch(name);
    if (!mismatch) return;

    const idLoc = namedNode.id?.loc?.start;
    const location = idLoc
      ? { line: idLoc.line ?? 1, column: (idLoc.column ?? 0) + 1 }
      : undefined;

    const { replacement, suggestedName } = mismatch;
    context.report(
      node,
      `Use configured identifier casing: replace \`${replacement.from}\` with \`${replacement.to}\` in \`${name}\` (e.g. \`${suggestedName}\`).`,
      location,
    );
  },
};
