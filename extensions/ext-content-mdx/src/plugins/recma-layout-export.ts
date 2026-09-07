import type { Program } from "acorn";

/** Expose MDX's private layout binding before downstream minification. */
export function recmaLayoutExport(): (program: Program) => void {
  return (program) => {
    const hasPrivateLayout = program.body.some((node) =>
      node.type === "VariableDeclaration" &&
      node.declarations.some((declaration) =>
        declaration.id.type === "Identifier" && declaration.id.name === "MDXLayout"
      )
    );
    if (!hasPrivateLayout) return;
    const hasLayoutExport = program.body.some((node) =>
      node.type === "ExportNamedDeclaration" &&
      node.specifiers.some((specifier) =>
        specifier.exported.type === "Identifier"
          ? specifier.exported.name === "MDXLayout"
          : specifier.exported.value === "MDXLayout"
      )
    );
    if (hasLayoutExport) return;
    program.body.push({
      type: "ExportNamedDeclaration",
      declaration: null,
      source: null,
      attributes: [],
      specifiers: [{
        type: "ExportSpecifier",
        local: { type: "Identifier", name: "MDXLayout", start: 0, end: 0 },
        exported: { type: "Identifier", name: "MDXLayout", start: 0, end: 0 },
        start: 0,
        end: 0,
      }],
      start: 0,
      end: 0,
    });
  };
}
