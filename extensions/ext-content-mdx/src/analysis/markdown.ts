import type { Nodes, Root } from "mdast";
import { parse, postprocess, preprocess } from "micromark";
import type { Extension } from "micromark-util-types";
import { type DefaultTreeAdapterMap, parseFragment } from "parse5";
import type { Position } from "unist";
import { unified } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";

import { createSourceLocator, type SourceLocator } from "./source.ts";
import type { ContentDestination, SourceRange } from "./types.ts";

interface OffsetSpan {
  readonly start: number;
  readonly end: number;
}

interface MarkdownTokens {
  readonly definitionDestinations: readonly OffsetSpan[];
  readonly imageLabels: readonly OffsetSpan[];
  readonly resourceDestinations: readonly OffsetSpan[];
}

function positionOffsets(
  position: Position | undefined,
): { readonly start: number; readonly end: number } | undefined {
  const start = position?.start.offset;
  const end = position?.end.offset;
  return start === undefined || end === undefined ? undefined : { start, end };
}

function rangeFromPosition(
  position: Position | undefined,
  locator: SourceLocator,
): SourceRange | undefined {
  const offsets = positionOffsets(position);
  return offsets === undefined ? undefined : locator.range(offsets.start, offsets.end);
}

function childrenOf(node: Nodes): readonly Nodes[] {
  return "children" in node ? node.children : [];
}

function markdownTokens(
  value: string,
  extensions: readonly Extension[] = [],
): MarkdownTokens {
  const definitionDestinations: OffsetSpan[] = [];
  const imageLabels: OffsetSpan[] = [];
  const resourceDestinations: OffsetSpan[] = [];
  const events = postprocess(
    parse({ extensions: [...extensions] }).document().write(
      preprocess()(value, undefined, true),
    ),
  );
  for (const [event, token] of events) {
    if (event !== "enter") continue;
    const span = { start: token.start.offset, end: token.end.offset };
    if (token.type === "definitionDestinationString") {
      definitionDestinations.push(span);
    } else if (token.type === "resourceDestinationString") {
      resourceDestinations.push(span);
    } else if (
      token.type === "labelText" && value.slice(token.start.offset - 2, token.start.offset) === "!["
    ) {
      imageLabels.push(span);
    }
  }
  return { definitionDestinations, imageLabels, resourceDestinations };
}

function containedSpan(
  spans: readonly OffsetSpan[],
  container: OffsetSpan,
): OffsetSpan | undefined {
  return spans.find((span) => span.start >= container.start && span.end <= container.end);
}

function linkDestination(
  value: string,
  node: Extract<Nodes, { type: "link" | "image" }>,
  locator: SourceLocator,
  tokens: MarkdownTokens,
): ContentDestination | undefined {
  const offsets = positionOffsets(node.position);
  if (offsets === undefined) return undefined;
  const authored = value.slice(offsets.start, offsets.end);
  const autolink = node.type === "link" &&
    (authored === node.url || authored === `<${node.url}>`);
  if (autolink) {
    if (
      authored === node.url && value[offsets.start - 1] === "<" &&
      value[offsets.start - 2] === "\\"
    ) return undefined;
    const start = authored[0] === "<" ? offsets.start + 1 : offsets.start;
    const end = authored[0] === "<" ? offsets.end - 1 : offsets.end;
    return {
      kind: "autolink",
      rawValue: value.slice(start, end),
      range: locator.range(start, end),
      syntax: "autolink",
    };
  }
  const destination = tokens.resourceDestinations[tokens.resourceDestinations.length - 1];
  if (destination === undefined || destination.end === destination.start) return undefined;
  return {
    kind: node.type === "link" ? "markdown-link" : "markdown-image",
    rawValue: authored.slice(destination.start, destination.end),
    range: locator.range(
      offsets.start + destination.start,
      offsets.start + destination.end,
    ),
    syntax: "markdown",
  };
}

function imageAltRange(
  position: Position | undefined,
  locator: SourceLocator,
  tokens: MarkdownTokens,
  tokenBase: number,
): SourceRange | undefined {
  const offsets = positionOffsets(position);
  if (offsets === undefined) return undefined;
  const label = tokens.imageLabels.find((span) => tokenBase + span.start === offsets.start + 2);
  return label === undefined || label.end <= label.start
    ? undefined
    : locator.range(tokenBase + label.start, tokenBase + label.end);
}

const HTML_DESTINATION_ATTRIBUTES = new Set(["action", "href", "src"]);
const OPAQUE_HTML_ELEMENTS = new Set([
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "script",
  "style",
  "template",
  "textarea",
  "title",
  "xmp",
]);

type HtmlChildNode = DefaultTreeAdapterMap["childNode"];
type HtmlElement = DefaultTreeAdapterMap["element"];
type HtmlText = DefaultTreeAdapterMap["textNode"];

function isHtmlElement(node: HtmlChildNode): node is HtmlElement {
  return "attrs" in node && "tagName" in node;
}

function isHtmlText(node: HtmlChildNode): node is HtmlText {
  return node.nodeName === "#text" && "value" in node;
}

function htmlAttributeDestination(
  raw: string,
  absoluteStart: number,
  location: { readonly startOffset: number; readonly endOffset: number },
  locator: SourceLocator,
): ContentDestination | undefined {
  const authored = raw.slice(location.startOffset, location.endOffset);
  const equals = authored.indexOf("=");
  if (equals === -1) return undefined;
  let start = equals + 1;
  while (/[\t\n\f\r ]/.test(authored[start] ?? "")) start++;
  let end = authored.length;
  const quote = authored[start];
  if (quote === '"' || quote === "'") {
    start++;
    if (authored[end - 1] === quote) end--;
  }
  if (end <= start) return undefined;
  return {
    kind: "html-attribute",
    rawValue: authored.slice(start, end),
    range: locator.range(
      absoluteStart + location.startOffset + start,
      absoluteStart + location.startOffset + end,
    ),
    syntax: "html-attribute",
  };
}

function rawHtmlAnalysis(
  raw: string,
  absoluteStart: number,
  locator: SourceLocator,
): {
  readonly destinations: readonly ContentDestination[];
  readonly renderedRanges: readonly SourceRange[];
} {
  const destinations: ContentDestination[] = [];
  const renderedRanges: SourceRange[] = [];
  const root = parseFragment(raw, { sourceCodeLocationInfo: true });
  const pending: Array<{ readonly node: HtmlChildNode; readonly opaque: boolean }> = [];
  for (let index = root.childNodes.length - 1; index >= 0; index--) {
    pending.push({ node: root.childNodes[index]!, opaque: false });
  }

  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    const { node } = entry;
    if (isHtmlElement(node)) {
      const attributeLocations = node.sourceCodeLocation?.attrs;
      for (const attribute of node.attrs) {
        if (!HTML_DESTINATION_ATTRIBUTES.has(attribute.name)) continue;
        const location = attributeLocations?.[attribute.name];
        if (location === undefined) continue;
        const destination = htmlAttributeDestination(
          raw,
          absoluteStart,
          location,
          locator,
        );
        if (destination !== undefined) destinations.push(destination);
      }
      const opaque = entry.opaque || OPAQUE_HTML_ELEMENTS.has(node.tagName);
      for (let index = node.childNodes.length - 1; index >= 0; index--) {
        pending.push({ node: node.childNodes[index]!, opaque });
      }
    } else if (isHtmlText(node) && !entry.opaque) {
      const location = node.sourceCodeLocation;
      if (
        location !== undefined && location !== null &&
        raw.slice(location.startOffset, location.endOffset).trim() !== ""
      ) {
        renderedRanges.push(
          locator.range(
            absoluteStart + location.startOffset,
            absoluteStart + location.endOffset,
          ),
        );
      }
    }
  }
  return { destinations, renderedRanges };
}

export function analyzeMarkdown(value: string, frontmatter: boolean): {
  readonly renderedRanges: readonly SourceRange[];
  readonly destinations: readonly ContentDestination[];
} {
  const processor = unified().use(remarkParse).use(remarkGfm);
  if (frontmatter) processor.use(remarkFrontmatter, ["yaml"]);
  const root = processor.parse(value);
  return analyzeMarkdownTree(value, root);
}

export function analyzeMarkdownTree(
  value: string,
  root: Root,
  options: { readonly micromarkExtensions?: readonly Extension[] } = {},
): {
  readonly renderedRanges: readonly SourceRange[];
  readonly destinations: readonly ContentDestination[];
} {
  const locator = createSourceLocator(value);
  const renderedRanges: SourceRange[] = [];
  const destinations: ContentDestination[] = [];
  const usedDefinitions = new Set<string>();
  const definitions: Array<Extract<Nodes, { type: "definition" }>> = [];
  const pending: Nodes[] = [root];
  let documentTokens: MarkdownTokens | undefined;

  function getDocumentTokens(): MarkdownTokens {
    documentTokens ??= markdownTokens(value, options.micromarkExtensions);
    return documentTokens;
  }

  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (node.type === "text") {
      const range = rangeFromPosition(node.position, locator);
      if (range !== undefined) renderedRanges.push(range);
    } else if (node.type === "link" || node.type === "image") {
      const offsets = positionOffsets(node.position);
      if (offsets === undefined) continue;
      const tokens = markdownTokens(
        value.slice(offsets.start, offsets.end),
        options.micromarkExtensions,
      );
      const destination = linkDestination(value, node, locator, tokens);
      if (destination !== undefined) destinations.push(destination);
      if (node.type === "image") {
        const range = imageAltRange(node.position, locator, tokens, offsets.start);
        if (range !== undefined) renderedRanges.push(range);
      }
    } else if (
      node.type === "linkReference" || node.type === "imageReference"
    ) {
      usedDefinitions.add(node.identifier);
      if (node.type === "imageReference") {
        const range = imageAltRange(
          node.position,
          locator,
          getDocumentTokens(),
          0,
        );
        if (range !== undefined) renderedRanges.push(range);
      }
    } else if (node.type === "definition") {
      definitions.push(node);
    } else if (node.type === "html") {
      const offsets = positionOffsets(node.position);
      if (offsets !== undefined) {
        const analysis = rawHtmlAnalysis(node.value, offsets.start, locator);
        destinations.push(...analysis.destinations);
        renderedRanges.push(...analysis.renderedRanges);
      }
    }
    const children = childrenOf(node);
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      if (child !== undefined) pending.push(child);
    }
  }

  const definitionTokens = definitions.length > 0 && usedDefinitions.size > 0
    ? getDocumentTokens()
    : undefined;
  const resolvedDefinitions = new Set<string>();
  for (const definition of definitions) {
    if (resolvedDefinitions.has(definition.identifier)) continue;
    resolvedDefinitions.add(definition.identifier);
    if (!usedDefinitions.has(definition.identifier)) continue;
    const offsets = positionOffsets(definition.position);
    if (offsets === undefined) continue;
    const destination = definitionTokens === undefined
      ? undefined
      : containedSpan(definitionTokens.definitionDestinations, offsets);
    if (destination !== undefined) {
      destinations.push({
        kind: "markdown-definition",
        rawValue: value.slice(destination.start, destination.end),
        range: locator.range(destination.start, destination.end),
        syntax: "markdown",
      });
    }
  }

  renderedRanges.sort((left, right) => left.start.offset - right.start.offset);
  return { renderedRanges, destinations };
}
