import { Parser } from "acorn";
import acornJsx from "acorn-jsx";
import type { Nodes } from "mdast";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { mdxExpression } from "micromark-extension-mdx-expression";
import { mdxJsx } from "micromark-extension-mdx-jsx";
import { mdxMd } from "micromark-extension-mdx-md";
import { mdxjsEsm } from "micromark-extension-mdxjs-esm";
import { combineExtensions } from "micromark-util-combine-extensions";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Position } from "unist";

import { analyzeEmbeddedExpression } from "./embedded-code.ts";
import { analyzeMarkdownTree } from "./markdown.ts";
import { createSourceLocator, type SourceLocator } from "./source.ts";
import type {
  ContentAnalysisResult,
  ContentDestination,
  ContentSyntaxDiagnostic,
} from "./types.ts";

const AcornJsxParser = Parser.extend(acornJsx());
const lexicalMdx = combineExtensions([
  mdxjsEsm({ acorn: AcornJsxParser, addResult: false }),
  mdxExpression(),
  mdxJsx(),
  mdxMd(),
]);

interface EmbeddedInput {
  readonly source: string;
  readonly absoluteStart: number;
  readonly attributeName: string | undefined;
}

function own(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function parserMessage(error: Error): string {
  const reason = own(error, "reason");
  const message = typeof reason === "string" ? reason : error.message;
  const firstLine = message.split("\n", 1)[0]?.trim() || error.name;
  return firstLine.length <= 240 ? firstLine : `${firstLine.slice(0, 237)}...`;
}

function parserDiagnostic(
  error: Error,
  locator: SourceLocator,
): ContentSyntaxDiagnostic | undefined {
  const place = own(error, "place");
  const start = own(place, "start") ?? place;
  const offset = own(start, "offset");
  if (typeof offset === "number") {
    const point = locator.point(offset);
    return { message: parserMessage(error), range: { start: point, end: point } };
  }
  if (error instanceof RangeError) {
    const point = locator.point(0);
    return {
      message: "Parser capacity exceeded for MDX structure",
      range: { start: point, end: point },
    };
  }
  return undefined;
}

function positionOffsets(
  position: Position | undefined,
): { readonly start: number; readonly end: number } | undefined {
  const start = position?.start.offset;
  const end = position?.end.offset;
  return start === undefined || end === undefined ? undefined : { start, end };
}

function childrenOf(node: Nodes): readonly Nodes[] {
  return "children" in node ? node.children : [];
}

function isDestinationAttribute(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "href" || normalized === "src" ||
    normalized === "action";
}

function quotedAttributeDestination(
  value: string,
  position: Position | undefined,
  locator: SourceLocator,
): ContentDestination | undefined {
  const offsets = positionOffsets(position);
  if (offsets === undefined) return undefined;
  const authored = value.slice(offsets.start, offsets.end);
  const equals = authored.indexOf("=");
  if (equals === -1) return undefined;
  let start = equals + 1;
  while (/\s/.test(authored[start] ?? "")) start++;
  const quote = authored[start];
  if (quote !== '"' && quote !== "'") return undefined;
  const end = authored.lastIndexOf(quote);
  if (end <= start) return undefined;
  start++;
  return {
    kind: "mdx-jsx-attribute",
    rawValue: authored.slice(start, end),
    range: locator.range(offsets.start + start, offsets.start + end),
    syntax: "html-attribute",
  };
}

function embeddedInput(
  value: string,
  expression: { readonly value: string; readonly position?: Position },
  attributeName: string | undefined,
): EmbeddedInput | undefined {
  const offsets = positionOffsets(expression.position);
  if (offsets === undefined) return undefined;
  const authored = value.slice(offsets.start, offsets.end);
  const brace = authored.indexOf("{");
  return {
    source: expression.value,
    absoluteStart: brace === -1 ? offsets.start : offsets.start + brace + 1,
    attributeName,
  };
}

function documentExpressionInput(
  node: Extract<Nodes, { type: "mdxFlowExpression" | "mdxTextExpression" }>,
): EmbeddedInput | undefined {
  const offsets = positionOffsets(node.position);
  return offsets === undefined ? undefined : {
    source: node.value,
    absoluteStart: offsets.start + 1,
    attributeName: undefined,
  };
}

export async function analyzeMdx(options: {
  readonly value: string;
  readonly frontmatter: boolean;
  readonly filePath: string | undefined;
}): Promise<ContentAnalysisResult> {
  const processor = unified().use(remarkParse).use(remarkGfm);
  if (options.frontmatter) processor.use(remarkFrontmatter, ["yaml"]);
  processor.data("micromarkExtensions", [lexicalMdx]);
  processor.data("fromMarkdownExtensions", [mdxFromMarkdown()]);
  const locator = createSourceLocator(options.value);
  let root: ReturnType<typeof processor.parse>;
  try {
    root = processor.parse(options.value);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const diagnostic = parserDiagnostic(error, locator);
    if (diagnostic === undefined) throw error;
    return { kind: "syntax-error", diagnostic };
  }

  const markdown = analyzeMarkdownTree(options.value, root);
  const destinations = [...markdown.destinations];
  const embedded: EmbeddedInput[] = [];
  const pending: Nodes[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (
      node.type === "mdxFlowExpression" || node.type === "mdxTextExpression"
    ) {
      const input = documentExpressionInput(node);
      if (input !== undefined) embedded.push(input);
    } else if (
      node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement"
    ) {
      for (const attribute of node.attributes) {
        if (attribute.type === "mdxJsxExpressionAttribute") {
          const input = embeddedInput(options.value, attribute, undefined);
          if (input !== undefined) embedded.push(input);
          continue;
        }
        if (typeof attribute.value === "string") {
          if (!isDestinationAttribute(attribute.name)) continue;
          const destination = quotedAttributeDestination(
            options.value,
            attribute.position,
            locator,
          );
          if (destination !== undefined) destinations.push(destination);
        } else if (
          attribute.value !== null && attribute.value !== undefined
        ) {
          const input = embeddedInput(
            options.value,
            {
              value: attribute.value.value,
              position: attribute.position,
            },
            attribute.name,
          );
          if (input !== undefined) embedded.push(input);
        }
      }
    }
    const children = childrenOf(node);
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      if (child !== undefined) pending.push(child);
    }
  }

  embedded.sort((left, right) => left.absoluteStart - right.absoluteStart);
  for (const input of embedded) {
    const analysis = await analyzeEmbeddedExpression({
      ...input,
      locator,
      filePath: options.filePath,
    });
    if (analysis.kind === "syntax-error") return analysis;
    destinations.push(...analysis.destinations);
    if (analysis.staticDestination !== undefined) {
      destinations.push(analysis.staticDestination);
    }
  }

  destinations.sort((left, right) => left.range.start.offset - right.range.start.offset);
  return {
    kind: "document",
    renderedRanges: markdown.renderedRanges,
    destinations,
  };
}
