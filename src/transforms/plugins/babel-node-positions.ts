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

// Local type definitions for Babel traverse/generate (they don't bundle types)
interface BabelNodePath<T = t.Node> {
  node: T;
  parent: t.Node;
  parentPath: BabelNodePath | null;
  scope: unknown;
  type: string;
  skip(): void;
  stop(): void;
}

interface BabelGeneratorResult {
  code: string;
  map?: unknown;
}

type TraverseFunction = (ast: t.Node, opts: Record<string, unknown>) => void;
type GenerateFunction = (ast: t.Node, opts?: Record<string, unknown>) => BabelGeneratorResult;

interface ModuleWithDefault<T> {
  default: T | { default: T };
}

function resolveDefaultExport<T>(mod: unknown): T {
  const m = mod as ModuleWithDefault<T>;
  if (typeof m.default === "function") return m.default as T;

  const nested = m.default as { default?: T } | undefined;
  if (typeof nested?.default === "function") return nested.default as T;

  return mod as T;
}

const traverse: TraverseFunction = resolveDefaultExport<TraverseFunction>(traverseModule);
const generate: GenerateFunction = resolveDefaultExport<GenerateFunction>(generateModule);

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
  const { name } = openingElement;

  if (t.isJSXIdentifier(name)) return name.name;

  if (!t.isJSXMemberExpression(name)) return "DynamicComponent";

  const parts: string[] = [];
  let current: t.JSXMemberExpression | t.JSXIdentifier = name;

  while (t.isJSXMemberExpression(current)) {
    if (t.isJSXIdentifier(current.property)) parts.unshift(current.property.name);
    current = current.object;
  }

  if (t.isJSXIdentifier(current)) parts.unshift(current.name);

  return parts.length ? parts.join(".") : "MemberExpression";
}

function isFragment(openingElement: t.JSXOpeningElement): boolean {
  const { name } = openingElement;

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
  return attributes.some((attr) => {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) return false;
    return attr.name.name === "data-node-line" || attr.name.name === "data-vf-id";
  });
}

/**
 * Transform TSX source to inject position data attributes into JSX elements.
 * This enables Studio Navigator to map rendered elements back to source positions.
 */
export function injectNodePositions(source: string, options: TransformOptions): string {
  if (!source.trim()) return source;
  if (!options.filePath) return source;

  try {
    const ast = parser.parse(source, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });

    let nodeCounter = 0;

    traverse(ast as t.Node, {
      JSXElement: {
        enter(path: BabelNodePath<t.JSXElement>) {
          const openingElement = path.node.openingElement;
          const elementName = getElementName(openingElement);

          if (SKIPPED_ELEMENTS.has(elementName.toLowerCase())) return;
          if (isFragment(openingElement)) return;
          if (hasPositionAttribute(openingElement.attributes)) return;

          const loc = openingElement.loc;
          if (!loc) return;

          const nodeId = `node-${nodeCounter++}`;
          openingElement.attributes.push(
            t.jsxAttribute(t.jsxIdentifier("data-node-id"), t.stringLiteral(nodeId)),
            t.jsxAttribute(
              t.jsxIdentifier("data-node-file"),
              t.stringLiteral(options.filePath),
            ),
            t.jsxAttribute(t.jsxIdentifier("data-node-name"), t.stringLiteral(elementName)),
            t.jsxAttribute(
              t.jsxIdentifier("data-node-line"),
              t.stringLiteral(String(loc.start.line)),
            ),
            t.jsxAttribute(
              t.jsxIdentifier("data-node-column"),
              t.stringLiteral(String(loc.start.column)),
            ),
          );
        },
      },
    });

    return generate(ast as t.Node, {
      retainLines: true,
      compact: false,
    }).code;
  } catch {
    return source;
  }
}
