import type { StyleRule } from "../types.ts";

export const noDefaultExportRule: StyleRule = {
  id: "no-default-export",
  visit(node, context): void {
    if (node.type !== "ExportDefaultDeclaration") return;

    context.report(node, "Default export is disallowed. Prefer named exports.");
  },
};
