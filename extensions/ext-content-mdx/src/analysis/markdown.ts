import type { Nodes, Root } from "mdast";
import type { Position } from "unist";
import { unified } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";

import { createSourceLocator, type SourceLocator } from "./source.ts";
import type { ContentDestination, SourceRange } from "./types.ts";

interface AuthoredDestination {
  readonly rawValue: string;
  readonly range: SourceRange;
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

function skipMarkdownWhitespace(value: string, start: number): number {
  let cursor = start;
  while (/\s/.test(value[cursor] ?? "")) cursor++;
  return cursor;
}

function resourceDestination(
  authored: string,
  absoluteStart: number,
  locator: SourceLocator,
): AuthoredDestination | undefined {
  const labelEnd = authored.lastIndexOf("](");
  if (labelEnd === -1) return undefined;
  let start = skipMarkdownWhitespace(authored, labelEnd + 2);
  if (authored[start] === "<") {
    const end = authored.indexOf(">", start + 1);
    if (end === -1) return undefined;
    start++;
    return {
      rawValue: authored.slice(start, end),
      range: locator.range(absoluteStart + start, absoluteStart + end),
    };
  }

  let cursor = start;
  let parentheses = 0;
  while (cursor < authored.length) {
    const character = authored[cursor];
    if (character === "\\" && cursor + 1 < authored.length) {
      cursor += 2;
      continue;
    }
    if (character === "(") parentheses++;
    else if (character === ")") {
      if (parentheses === 0) break;
      parentheses--;
    } else if (/\s/.test(character ?? "") && parentheses === 0) break;
    cursor++;
  }
  return cursor === start ? undefined : {
    rawValue: authored.slice(start, cursor),
    range: locator.range(absoluteStart + start, absoluteStart + cursor),
  };
}

function definitionDestination(
  authored: string,
  absoluteStart: number,
  locator: SourceLocator,
): AuthoredDestination | undefined {
  let labelEnd = 1;
  while (labelEnd < authored.length) {
    if (authored[labelEnd] === "\\") labelEnd++;
    else if (authored[labelEnd] === "]" && authored[labelEnd + 1] === ":") {
      break;
    }
    labelEnd++;
  }
  if (labelEnd >= authored.length) return undefined;

  let start = labelEnd + 2;
  while (start < authored.length) {
    const character = authored[start];
    if (character === " " || character === "\t" || character === "\r") {
      start++;
      continue;
    }
    if (character !== "\n") break;
    start++;
    while (authored[start] === " " || authored[start] === "\t") start++;
    while (authored[start] === ">") {
      start++;
      if (authored[start] === " ") start++;
      while (authored[start] === "\t") start++;
    }
  }
  if (authored[start] === "<") {
    const end = authored.indexOf(">", start + 1);
    if (end <= start + 1) return undefined;
    start++;
    return {
      rawValue: authored.slice(start, end),
      range: locator.range(absoluteStart + start, absoluteStart + end),
    };
  }
  let end = start;
  while (end < authored.length && !/\s/.test(authored[end] ?? "")) {
    if (authored[end] === "\\" && end + 1 < authored.length) end++;
    end++;
  }
  return end === start ? undefined : {
    rawValue: authored.slice(start, end),
    range: locator.range(absoluteStart + start, absoluteStart + end),
  };
}

function linkDestination(
  value: string,
  node: Extract<Nodes, { type: "link" | "image" }>,
  locator: SourceLocator,
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
  const destination = resourceDestination(authored, offsets.start, locator);
  if (destination === undefined || destination.rawValue === "") return undefined;
  return {
    kind: node.type === "link" ? "markdown-link" : "markdown-image",
    ...destination,
    syntax: "markdown",
  };
}

function imageAltRange(
  value: string,
  position: Position | undefined,
  locator: SourceLocator,
): SourceRange | undefined {
  const offsets = positionOffsets(position);
  if (offsets === undefined) return undefined;
  const authored = value.slice(offsets.start, offsets.end);
  const end = authored.indexOf("]", 2);
  return authored.startsWith("![") && end > 2
    ? locator.range(offsets.start + 2, offsets.start + end)
    : undefined;
}

const HTML_DESTINATION_ATTRIBUTE =
  /\b(?:href|src|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

function htmlTagEnd(value: string, start: number): number | undefined {
  let quote: '"' | "'" | undefined;
  for (let cursor = start + 1; cursor < value.length; cursor++) {
    const character = value[cursor];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ">") return cursor + 1;
  }
  return undefined;
}

const RAW_TEXT_HTML_ELEMENTS = new Set(["script", "style", "textarea"]);

function htmlTagName(tag: string): {
  readonly closing: boolean;
  readonly name: string;
  readonly selfClosing: boolean;
} | undefined {
  const match = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9-]*)/.exec(tag);
  if (match === null) return undefined;
  return {
    closing: match[1] === "/",
    name: match[2]!.toLowerCase(),
    selfClosing: /\/\s*>$/.test(tag),
  };
}

function isHtmlDataBlock(raw: string): boolean {
  const trimmed = raw.trimStart();
  return trimmed.startsWith("<!--") || trimmed.startsWith("<?") ||
    trimmed.startsWith("<![") || /^<![A-Za-z]/.test(trimmed);
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
  if (isHtmlDataBlock(raw)) return { destinations, renderedRanges };
  const lowercase = raw.toLowerCase();
  let cursor = 0;
  while (cursor < raw.length) {
    const tagStart = raw.indexOf("<", cursor);
    const textEnd = tagStart === -1 ? raw.length : tagStart;
    if (raw.slice(cursor, textEnd).trim() !== "") {
      renderedRanges.push(
        locator.range(absoluteStart + cursor, absoluteStart + textEnd),
      );
    }
    if (tagStart === -1) break;
    const tagEnd = htmlTagEnd(raw, tagStart);
    if (tagEnd === undefined) break;
    const tag = raw.slice(tagStart, tagEnd);
    const tagName = htmlTagName(tag);
    HTML_DESTINATION_ATTRIBUTE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HTML_DESTINATION_ATTRIBUTE.exec(tag)) !== null) {
      const rawValue = match[1] ?? match[2] ?? match[3];
      if (rawValue === undefined) continue;
      const relativeValueStart = tagStart + match.index +
        match[0].lastIndexOf(rawValue);
      destinations.push({
        kind: "html-attribute",
        rawValue,
        range: locator.range(
          absoluteStart + relativeValueStart,
          absoluteStart + relativeValueStart + rawValue.length,
        ),
        syntax: "html-attribute",
      });
    }
    if (
      tagName !== undefined && !tagName.closing && !tagName.selfClosing &&
      RAW_TEXT_HTML_ELEMENTS.has(tagName.name)
    ) {
      const closingStart = lowercase.indexOf(`</${tagName.name}`, tagEnd);
      if (closingStart === -1) break;
      cursor = closingStart;
      continue;
    }
    cursor = tagEnd;
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

export function analyzeMarkdownTree(value: string, root: Root): {
  readonly renderedRanges: readonly SourceRange[];
  readonly destinations: readonly ContentDestination[];
} {
  const locator = createSourceLocator(value);
  const renderedRanges: SourceRange[] = [];
  const destinations: ContentDestination[] = [];
  const usedDefinitions = new Set<string>();
  const definitions: Array<Extract<Nodes, { type: "definition" }>> = [];
  const pending: Nodes[] = [root];

  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (node.type === "text") {
      const range = rangeFromPosition(node.position, locator);
      if (range !== undefined) renderedRanges.push(range);
    } else if (node.type === "link" || node.type === "image") {
      const destination = linkDestination(value, node, locator);
      if (destination !== undefined) destinations.push(destination);
      if (node.type === "image") {
        const range = imageAltRange(value, node.position, locator);
        if (range !== undefined) renderedRanges.push(range);
      }
    } else if (
      node.type === "linkReference" || node.type === "imageReference"
    ) {
      usedDefinitions.add(node.identifier);
      if (node.type === "imageReference") {
        const range = imageAltRange(value, node.position, locator);
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

  for (const definition of definitions) {
    if (!usedDefinitions.has(definition.identifier)) continue;
    const offsets = positionOffsets(definition.position);
    if (offsets === undefined) continue;
    const authored = value.slice(offsets.start, offsets.end);
    const destination = definitionDestination(
      authored,
      offsets.start,
      locator,
    );
    if (destination !== undefined) {
      destinations.push({
        kind: "markdown-definition",
        ...destination,
        syntax: "markdown",
      });
    }
  }

  renderedRanges.sort((left, right) => left.start.offset - right.start.offset);
  return { renderedRanges, destinations };
}
