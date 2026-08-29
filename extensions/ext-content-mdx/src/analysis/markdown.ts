import type { Nodes, Root } from "mdast";
import { parse, postprocess, preprocess } from "micromark";
import type { Extension } from "micromark-util-types";
import { type DefaultTreeAdapterMap, parseFragment } from "parse5";
import type { Position } from "unist";
import { unified } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";

import { analyzeFrontmatterSource } from "./frontmatter.ts";
import { createSourceLocator, type SourceLocator } from "./source.ts";
import type { ContentAnalysisResult, ContentDestination, SourceRange } from "./types.ts";

interface OffsetSpan {
  readonly start: number;
  readonly end: number;
}

interface MarkdownTokens {
  readonly definitionDestinations: readonly OffsetSpan[];
  readonly resourceDestinations: readonly OffsetSpan[];
}

type LinkNode = Extract<Nodes, { type: "link" | "image" }>;
type DefinitionNode = Extract<Nodes, { type: "definition" }>;

function positionOffsets(
  position: Position | undefined,
  sourceOffset = 0,
): { readonly start: number; readonly end: number } | undefined {
  const start = position?.start.offset;
  const end = position?.end.offset;
  return start === undefined || end === undefined
    ? undefined
    : { start: sourceOffset + start, end: sourceOffset + end };
}

function childrenOf(node: Nodes): readonly Nodes[] {
  return "children" in node ? node.children : [];
}

function markdownTokens(
  value: string,
  extensions: readonly Extension[] = [],
  sourceOffset = 0,
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
    const span = {
      start: sourceOffset + token.start.offset,
      end: sourceOffset + token.end.offset,
    };
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
  node: LinkNode,
  locator: SourceLocator,
  tokens: MarkdownTokens,
  tokenBase: number,
  offsets: OffsetSpan,
): ContentDestination | undefined {
  const autolink = autolinkDestination(value, node, locator, offsets);
  if (autolink !== undefined) return autolink;

  return resourceLinkDestination(value, node, locator, tokens, tokenBase, offsets);
}

function resourceLinkDestination(
  value: string,
  node: LinkNode,
  locator: SourceLocator,
  tokens: MarkdownTokens,
  tokenBase: number,
  offsets: OffsetSpan,
): ContentDestination | undefined {
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

function autolinkDestination(
  value: string,
  node: LinkNode,
  locator: SourceLocator,
  offsets: OffsetSpan,
): ContentDestination | undefined {
  const authored = value.slice(offsets.start, offsets.end);
  const angleDelimited = authored.startsWith("<") && authored.endsWith(">");
  const autolinkValue = angleDelimited ? authored.slice(1, -1) : authored;
  const normalized = node.type === "link" &&
    (autolinkValue === node.url ||
      `mailto:${autolinkValue}` === node.url ||
      `http://${autolinkValue}` === node.url);
  if (!normalized) return undefined;
  if (
    !angleDelimited && authored === node.url && value[offsets.start - 1] === "<" &&
    value[offsets.start - 2] === "\\"
  ) return undefined;

  const start = angleDelimited ? offsets.start + 1 : offsets.start;
  const end = angleDelimited ? offsets.end - 1 : offsets.end;
  const destination: ContentDestination = {
    kind: "autolink",
    rawValue: value.slice(start, end),
    range: locator.range(start, end),
    syntax: "autolink",
  };
  return autolinkValue === node.url ? destination : { ...destination, normalizedValue: node.url };
}

const HTML_DESTINATION_ATTRIBUTES = new Set(["action", "formaction", "href", "src"]);

type HtmlChildNode = DefaultTreeAdapterMap["childNode"];
type HtmlElement = DefaultTreeAdapterMap["element"];
type HtmlAttribute = HtmlElement["attrs"][number];

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
  // and CommonMark replaces NUL with U+FFFD, while node positions stay in the
  // authored document. Each normalized line is therefore a same-width suffix
  // of its authored line. Preserve that parser-provided relationship instead
  // of rediscovering HTML or container syntax here.
  const normalizedLines = lineContents(normalized);
  const authoredLines = lineContents(authored);
  if (normalizedLines.length !== authoredLines.length) {
    throw new TypeError("Parser-reported raw HTML has inconsistent source lines");
  }

  const segments = normalizedLines.map((normalizedLine, index) => {
    const authoredLine = authoredLines[index]!;
    const normalizedText = normalized.slice(normalizedLine.start, normalizedLine.end);
    const authoredText = authored.slice(authoredLine.start, authoredLine.end);
    const prefixLength = authoredText.length - normalizedText.length;
    if (
      prefixLength < 0 ||
      !matchesCommonMarkPreprocessing(
        normalizedText,
        authoredText.slice(prefixLength),
      )
    ) {
      throw new TypeError("Parser-reported raw HTML does not map to authored source");
    }
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

function matchesCommonMarkPreprocessing(
  normalized: string,
  authored: string,
): boolean {
  if (normalized.length !== authored.length) return false;
  for (let index = 0; index < normalized.length; index++) {
    if (normalized[index] === authored[index]) continue;
    if (normalized[index] !== "\uFFFD" || authored[index] !== "\0") return false;
  }
  return true;
}

function isHtmlElement(node: HtmlChildNode): node is HtmlElement {
  return "attrs" in node && "tagName" in node;
}

function htmlAttributeLocationName(attribute: HtmlAttribute): string {
  const prefix = Object.getOwnPropertyDescriptor(attribute, "prefix")?.value;
  return typeof prefix === "string" && prefix.length > 0
    ? `${prefix}:${attribute.name}`
    : attribute.name;
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

function appendHtmlChildNodes(
  pending: HtmlChildNode[],
  children: readonly HtmlChildNode[],
): void {
  for (let index = children.length - 1; index >= 0; index--) {
    pending.push(children[index]!);
  }
}

function appendHtmlAttributeDestinations(
  destinations: ContentDestination[],
  node: HtmlElement,
  raw: string,
  authored: string,
  absoluteStart: number,
  projection: SourceProjection,
): void {
  const attributeLocations = node.sourceCodeLocation?.attrs;
  for (const attribute of node.attrs) {
    const locationName = htmlAttributeLocationName(attribute);
    const destinationName = locationName === "xlink:href" ? "href" : attribute.name;
    if (!HTML_DESTINATION_ATTRIBUTES.has(destinationName)) continue;
    const location = attributeLocations?.[locationName];
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
  appendHtmlChildNodes(pending, root.childNodes);

  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (isHtmlElement(node)) {
      appendHtmlAttributeDestinations(destinations, node, raw, authored, absoluteStart, projection);
      appendHtmlChildNodes(pending, node.childNodes);
    }
  }
  return destinations;
}

export function analyzeMarkdown(
  value: string,
  frontmatter: boolean,
): ContentAnalysisResult {
  const locator = createSourceLocator(value);
  const source = analyzeFrontmatterSource(value, frontmatter, locator);
  if (source.kind === "syntax-error") return source;
  const processor = unified().use(remarkParse).use(remarkGfm);
  if (frontmatter) processor.use(remarkFrontmatter, ["yaml"]);
  const root = processor.parse(source.value);
  return {
    kind: "document",
    ...analyzeMarkdownTree(value, root, {
      sourceOffset: source.offset,
      sourceValue: source.value,
    }),
  };
}

function appendMarkdownChildren(pending: Nodes[], node: Nodes): void {
  const children = childrenOf(node);
  for (let index = children.length - 1; index >= 0; index--) {
    const child = children[index];
    if (child !== undefined) pending.push(child);
  }
}

function markdownLinkDestination(
  value: string,
  node: LinkNode,
  locator: SourceLocator,
  options: MarkdownAnalysisOptions,
  documentTokens: () => MarkdownTokens,
): ContentDestination | undefined {
  const offsets = positionOffsets(node.position, options.sourceOffset);
  if (offsets === undefined) return undefined;
  const authored = value.slice(offsets.start, offsets.end);
  const multiline = /[\r\n]/.test(authored);
  const tokenBase = multiline ? 0 : offsets.start;
  const tokens = multiline
    ? documentTokens()
    : markdownTokens(authored, options.micromarkExtensions);
  return linkDestination(value, node, locator, tokens, tokenBase, offsets);
}

function appendMarkdownHtmlDestinations(
  value: string,
  node: Extract<Nodes, { type: "html" }>,
  locator: SourceLocator,
  destinations: ContentDestination[],
  sourceOffset: number,
): void {
  const offsets = positionOffsets(node.position, sourceOffset);
  if (offsets === undefined) return;
  destinations.push(...rawHtmlAnalysis(
    node.value,
    value.slice(offsets.start, offsets.end),
    offsets.start,
    locator,
  ));
}

function appendDefinitionDestinations(
  value: string,
  definitions: readonly DefinitionNode[],
  usedDefinitions: ReadonlySet<string>,
  definitionTokens: MarkdownTokens | undefined,
  locator: SourceLocator,
  destinations: ContentDestination[],
  sourceOffset: number,
): void {
  const resolvedDefinitions = new Set<string>();
  for (const definition of definitions) {
    if (resolvedDefinitions.has(definition.identifier)) continue;
    resolvedDefinitions.add(definition.identifier);
    if (!usedDefinitions.has(definition.identifier)) continue;
    const offsets = positionOffsets(definition.position, sourceOffset);
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
}

function appendMarkdownNodeDestinations(
  value: string,
  node: Nodes,
  locator: SourceLocator,
  options: MarkdownAnalysisOptions,
  documentTokens: () => MarkdownTokens,
  destinations: ContentDestination[],
): void {
  if (node.type === "link" || node.type === "image") {
    const destination = markdownLinkDestination(value, node, locator, options, documentTokens);
    if (destination !== undefined) destinations.push(destination);
    return;
  }
  if (node.type === "html") {
    appendMarkdownHtmlDestinations(
      value,
      node,
      locator,
      destinations,
      options.sourceOffset,
    );
  }
}

interface MarkdownAnalysisOptions {
  readonly micromarkExtensions?: readonly Extension[];
  readonly sourceOffset: number;
  readonly sourceValue: string;
}

interface MarkdownCollectionContext {
  readonly value: string;
  readonly locator: SourceLocator;
  readonly options: MarkdownAnalysisOptions;
  readonly documentTokens: () => MarkdownTokens;
  readonly destinations: ContentDestination[];
  readonly usedDefinitions: Set<string>;
  readonly definitions: DefinitionNode[];
}

function collectMarkdownNode(
  context: MarkdownCollectionContext,
  node: Nodes,
): void {
  appendMarkdownNodeDestinations(
    context.value,
    node,
    context.locator,
    context.options,
    context.documentTokens,
    context.destinations,
  );
  if (node.type === "linkReference" || node.type === "imageReference") {
    context.usedDefinitions.add(node.identifier);
    return;
  }
  if (node.type === "definition") context.definitions.push(node);
}

export function analyzeMarkdownTree(
  value: string,
  root: Root,
  options: Partial<MarkdownAnalysisOptions> = {},
): {
  readonly destinations: readonly ContentDestination[];
} {
  const resolvedOptions: MarkdownAnalysisOptions = {
    micromarkExtensions: options.micromarkExtensions,
    sourceOffset: options.sourceOffset ?? 0,
    sourceValue: options.sourceValue ?? value,
  };
  const locator = createSourceLocator(value);
  const destinations: ContentDestination[] = [];
  const usedDefinitions = new Set<string>();
  const definitions: DefinitionNode[] = [];
  const pending: Nodes[] = [root];
  let documentTokens: MarkdownTokens | undefined;

  function getDocumentTokens(): MarkdownTokens {
    documentTokens ??= markdownTokens(
      resolvedOptions.sourceValue,
      resolvedOptions.micromarkExtensions,
      resolvedOptions.sourceOffset,
    );
    return documentTokens;
  }

  const collection: MarkdownCollectionContext = {
    value,
    locator,
    options: resolvedOptions,
    documentTokens: getDocumentTokens,
    destinations,
    usedDefinitions,
    definitions,
  };

  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    collectMarkdownNode(collection, node);
    appendMarkdownChildren(pending, node);
  }

  const definitionTokens = definitions.length > 0 && usedDefinitions.size > 0
    ? getDocumentTokens()
    : undefined;
  appendDefinitionDestinations(
    value,
    definitions,
    usedDefinitions,
    definitionTokens,
    locator,
    destinations,
    resolvedOptions.sourceOffset,
  );

  return { destinations };
}
