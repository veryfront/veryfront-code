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
  readonly resourceDestinations: readonly OffsetSpan[];
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

function markdownTokens(
  value: string,
  extensions: readonly Extension[] = [],
): MarkdownTokens {
  const definitionDestinations: OffsetSpan[] = [];
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
    }
  }
  return { definitionDestinations, resourceDestinations };
}

function containedSpan(
  spans: readonly OffsetSpan[],
  container: OffsetSpan,
): OffsetSpan | undefined {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (spans[middle]!.start < container.start) low = middle + 1;
    else high = middle;
  }
  const span = spans[low];
  return span !== undefined && span.end <= container.end ? span : undefined;
}

function lastContainedSpan(
  spans: readonly OffsetSpan[],
  container: OffsetSpan,
): OffsetSpan | undefined {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (spans[middle]!.end <= container.end) low = middle + 1;
    else high = middle;
  }
  const span = spans[low - 1];
  return span !== undefined && span.start >= container.start ? span : undefined;
}

function linkDestination(
  value: string,
  node: Extract<Nodes, { type: "link" | "image" }>,
  locator: SourceLocator,
  tokens: MarkdownTokens,
  tokenBase: number,
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
  const destination = lastContainedSpan(tokens.resourceDestinations, {
    start: offsets.start - tokenBase,
    end: offsets.end - tokenBase,
  });
  if (destination === undefined || destination.end === destination.start) return undefined;
  const start = tokenBase + destination.start;
  const end = tokenBase + destination.end;
  return {
    kind: node.type === "link" ? "markdown-link" : "markdown-image",
    rawValue: value.slice(start, end),
    range: locator.range(start, end),
    syntax: "markdown",
  };
}

const HTML_DESTINATION_ATTRIBUTES = new Set(["action", "href", "src"]);

type HtmlChildNode = DefaultTreeAdapterMap["childNode"];
type HtmlElement = DefaultTreeAdapterMap["element"];

interface SourceProjection {
  range(start: number, end: number): SourceRange;
}

interface LineContent {
  readonly start: number;
  readonly end: number;
}

function lineContents(value: string): readonly LineContent[] {
  const lines: LineContent[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character !== "\r" && character !== "\n") continue;
    lines.push({ start, end: index });
    if (character === "\r" && value[index + 1] === "\n") index++;
    start = index + 1;
  }
  lines.push({ start, end: value.length });
  return lines;
}

function rawHtmlSourceProjection(
  normalized: string,
  authored: string,
  absoluteStart: number,
  locator: SourceLocator,
): SourceProjection {
  // Remark removes blockquote and list continuation prefixes from `node.value`
  // but keeps node positions in the authored document. Each normalized line is
  // therefore the suffix of its authored line. Preserve that parser-provided
  // relationship instead of rediscovering HTML or container syntax here.
  const normalizedLines = lineContents(normalized);
  const authoredLines = lineContents(authored);
  if (normalizedLines.length !== authoredLines.length) {
    throw new TypeError("Parser-reported raw HTML has inconsistent source lines");
  }

  const segments = normalizedLines.map((normalizedLine, index) => {
    const authoredLine = authoredLines[index]!;
    const normalizedText = normalized.slice(normalizedLine.start, normalizedLine.end);
    const authoredText = authored.slice(authoredLine.start, authoredLine.end);
    if (!authoredText.endsWith(normalizedText)) {
      throw new TypeError("Parser-reported raw HTML does not map to authored source");
    }
    const prefixLength = authoredText.length - normalizedText.length;
    return {
      normalizedStart: normalizedLine.start,
      normalizedEnd: normalizedLine.end,
      authoredStart: absoluteStart + authoredLine.start + prefixLength,
    };
  });

  function projectOffset(offset: number): number {
    let low = 0;
    let high = segments.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (segments[middle]!.normalizedStart <= offset) low = middle + 1;
      else high = middle;
    }
    const segment = segments[low - 1];
    if (segment !== undefined && offset <= segment.normalizedEnd) {
      return segment.authoredStart + offset - segment.normalizedStart;
    }
    throw new RangeError("Raw HTML offset falls outside parser-reported source");
  }

  return {
    range(start, end) {
      return locator.range(projectOffset(start), projectOffset(end));
    },
  };
}

function isHtmlElement(node: HtmlChildNode): node is HtmlElement {
  return "attrs" in node && "tagName" in node;
}

function htmlAttributeDestination(
  raw: string,
  authoredNode: string,
  absoluteStart: number,
  location: { readonly startOffset: number; readonly endOffset: number },
  projection: SourceProjection,
): ContentDestination | undefined {
  const normalizedAttribute = raw.slice(location.startOffset, location.endOffset);
  const equals = normalizedAttribute.indexOf("=");
  if (equals === -1) return undefined;
  let start = equals + 1;
  while (/[\t\n\f\r ]/.test(normalizedAttribute[start] ?? "")) start++;
  let end = normalizedAttribute.length;
  const quote = normalizedAttribute[start];
  if (quote === '"' || quote === "'") {
    start++;
    if (normalizedAttribute[end - 1] === quote) end--;
  }
  if (end <= start) return undefined;
  const normalizedValue = normalizedAttribute.slice(start, end);
  const range = projection.range(
    location.startOffset + start,
    location.startOffset + end,
  );
  const rawValue = authoredNode.slice(
    range.start.offset - absoluteStart,
    range.end.offset - absoluteStart,
  );
  const destination: ContentDestination = {
    kind: "html-attribute",
    rawValue,
    range,
    syntax: "html-attribute",
  };
  return normalizedValue === rawValue ? destination : { ...destination, normalizedValue };
}

function rawHtmlAnalysis(
  raw: string,
  authored: string,
  absoluteStart: number,
  locator: SourceLocator,
): readonly ContentDestination[] {
  const destinations: ContentDestination[] = [];
  const projection = rawHtmlSourceProjection(raw, authored, absoluteStart, locator);
  const root = parseFragment(raw, { sourceCodeLocationInfo: true });
  const pending: HtmlChildNode[] = [];
  for (let index = root.childNodes.length - 1; index >= 0; index--) {
    pending.push(root.childNodes[index]!);
  }

  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (isHtmlElement(node)) {
      const attributeLocations = node.sourceCodeLocation?.attrs;
      for (const attribute of node.attrs) {
        if (!HTML_DESTINATION_ATTRIBUTES.has(attribute.name)) continue;
        const location = attributeLocations?.[attribute.name];
        if (location === undefined) continue;
        const destination = htmlAttributeDestination(
          raw,
          authored,
          absoluteStart,
          location,
          projection,
        );
        if (destination !== undefined) destinations.push(destination);
      }
      for (let index = node.childNodes.length - 1; index >= 0; index--) {
        pending.push(node.childNodes[index]!);
      }
    }
  }
  return destinations;
}

export function analyzeMarkdown(value: string, frontmatter: boolean): {
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
  readonly destinations: readonly ContentDestination[];
} {
  const locator = createSourceLocator(value);
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
    if (node.type === "link" || node.type === "image") {
      const offsets = positionOffsets(node.position);
      if (offsets === undefined) continue;
      const authored = value.slice(offsets.start, offsets.end);
      const multiline = /[\r\n]/.test(authored);
      const tokenBase = multiline ? 0 : offsets.start;
      const tokens = multiline
        ? getDocumentTokens()
        : markdownTokens(authored, options.micromarkExtensions);
      const destination = linkDestination(value, node, locator, tokens, tokenBase);
      if (destination !== undefined) destinations.push(destination);
    } else if (
      node.type === "linkReference" || node.type === "imageReference"
    ) {
      usedDefinitions.add(node.identifier);
    } else if (node.type === "definition") {
      definitions.push(node);
    } else if (node.type === "html") {
      const offsets = positionOffsets(node.position);
      if (offsets !== undefined) {
        destinations.push(...rawHtmlAnalysis(
          node.value,
          value.slice(offsets.start, offsets.end),
          offsets.start,
          locator,
        ));
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

  return { destinations };
}
