/**
 * Babel Transform for TSX Source Position Injection
 *
 * Injects data-node-* attributes into JSX elements for Studio Navigator integration.
 * This mirrors the position tracking done by remarkAddNodeId for MDX files.
 */

import * as parser from "@babel/parser";
import * as traverseModule from "@babel/traverse";
import * as generateModule from "@babel/generator";
import * as t from "@babel/types";

// ESM/CJS interop for Deno - Babel packages export default as .default.default in some cases
const traverse = typeof (traverseModule as any).default === "function"
  ? (traverseModule as any).default
  : typeof (traverseModule as any).default?.default === "function"
  ? (traverseModule as any).default.default
  : traverseModule;
const generate = typeof (generateModule as any).default === "function"
  ? (generateModule as any).default
  : typeof (generateModule as any).default?.default === "function"
  ? (generateModule as any).default.default
  : generateModule;

type NodePath<T> = traverseModule.NodePath<T>;

const SKIPPED_ELEMENTS = new Set([
  "html",
  "head",
  "title",
  "body",
  "link",
  "base",
  "meta",
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "path",
  "circle",
  "ellipse",
  "line",
  "polygon",
  "polyline",
  "rect",
  "g",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "text",
  "tspan",
  "use",
  "filter",
]);

interface TransformOptions {
  filePath: string;
}

function getElementName(openingElement: t.JSXOpeningElement): string {
  const name = openingElement.name;

  if (t.isJSXIdentifier(name)) {
    return name.name;
  }

  if (t.isJSXMemberExpression(name)) {
    let memberName = "";
    let current: t.JSXMemberExpression | t.JSXIdentifier = name;

    while (t.isJSXMemberExpression(current)) {
      if (t.isJSXIdentifier(current.property)) {
        memberName = current.property.name + (memberName ? "." + memberName : "");
      }
      current = current.object;
    }

    if (t.isJSXIdentifier(current)) {
      memberName = current.name + (memberName ? "." + memberName : "");
    }

    return memberName || "MemberExpression";
  }

  return "DynamicComponent";
}

function isFragment(openingElement: t.JSXOpeningElement): boolean {
  const name = openingElement.name;

  if (t.isJSXMemberExpression(name)) {
    return (
      t.isJSXIdentifier(name.object) &&
      name.object.name === "React" &&
      t.isJSXIdentifier(name.property) &&
      name.property.name === "Fragment"
    );
  }

  return t.isJSXIdentifier(name) && name.name === "Fragment";
}

function hasPositionAttribute(attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[]): boolean {
  return attributes.some(
    (attr) =>
      t.isJSXAttribute(attr) &&
      t.isJSXIdentifier(attr.name) &&
      (attr.name.name === "data-node-line" || attr.name.name === "data-vf-id"),
  );
}

/**
 * Transform TSX source to inject position data attributes into JSX elements.
 * This enables Studio Navigator to map rendered elements back to source positions.
 */
export function injectNodePositions(source: string, options: TransformOptions): string {
  const { filePath: _filePath } = options;

  if (!source.trim()) {
    return source;
  }

  let ast: ReturnType<typeof parser.parse>;

  try {
    ast = parser.parse(source, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });
  } catch {
    return source;
  }

  let nodeCounter = 0;

  try {
    traverse(ast, {
      JSXElement: {
        enter(path: NodePath<t.JSXElement>) {
          const openingElement = path.node.openingElement;
          const elementName = getElementName(openingElement);

          if (SKIPPED_ELEMENTS.has(elementName.toLowerCase())) {
            return;
          }

          if (isFragment(openingElement)) {
            return;
          }

          if (hasPositionAttribute(openingElement.attributes)) {
            return;
          }

          const loc = openingElement.loc;
          if (!loc) {
            return;
          }

          const nodeId = `node-${nodeCounter++}`;

          openingElement.attributes.push(
            t.jsxAttribute(t.jsxIdentifier("data-node-id"), t.stringLiteral(nodeId)),
          );

          openingElement.attributes.push(
            t.jsxAttribute(
              t.jsxIdentifier("data-node-line"),
              t.stringLiteral(String(loc.start.line)),
            ),
          );

          openingElement.attributes.push(
            t.jsxAttribute(
              t.jsxIdentifier("data-node-column"),
              t.stringLiteral(String(loc.start.column)),
            ),
          );

          if (loc.end) {
            openingElement.attributes.push(
              t.jsxAttribute(
                t.jsxIdentifier("data-node-end-line"),
                t.stringLiteral(String(loc.end.line)),
              ),
            );

            openingElement.attributes.push(
              t.jsxAttribute(
                t.jsxIdentifier("data-node-end-column"),
                t.stringLiteral(String(loc.end.column)),
              ),
            );
          }
        },
      },
    });

    const output = generate(ast, {
      retainLines: true,
      compact: false,
    });

    return output.code;
  } catch {
    return source;
  }
}
