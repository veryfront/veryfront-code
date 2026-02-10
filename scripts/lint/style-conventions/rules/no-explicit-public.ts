import type { StyleRule } from "../types.ts";

const ACCESSIBILITY_NODE_TYPES = new Set([
  "ClassMethod",
  "ClassProperty",
  "ClassAccessorProperty",
  "TSDeclareMethod",
  "TSParameterProperty",
]);

export const noExplicitPublicRule: StyleRule = {
  id: "no-explicit-public",
  visit(node, context): void {
    if (!ACCESSIBILITY_NODE_TYPES.has(node.type ?? "")) return;
    if (node.accessibility !== "public") return;

    context.report(
      node,
      "Explicit `public` is disallowed. Omit the modifier (public is default).",
    );
  },
};
