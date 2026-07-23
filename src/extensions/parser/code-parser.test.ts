import type { ASTNode, NodePath } from "./code-parser.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

function createPath(
  node: ASTNode,
  parent: ASTNode | null,
  parentPath: NodePath | null,
): NodePath {
  return {
    node,
    parent,
    parentPath,
    replaceWith: () => {},
    remove: () => {},
  };
}

describe("NodePath", () => {
  it("keeps the parent node separate from the parent traversal path", () => {
    const program: ASTNode = { type: "Program" };
    const declaration: ASTNode = { type: "VariableDeclaration" };
    const rootPath = createPath(program, null, null);
    const declarationPath = createPath(declaration, program, rootPath);

    assertEquals(declarationPath.parent?.type, "Program");
    assertEquals(declarationPath.parentPath?.node.type, "Program");
  });
});
