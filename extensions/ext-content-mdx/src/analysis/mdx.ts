import {
  type Comment,
  type Expression,
  type ObjectExpression,
  type Options as AcornOptions,
  Parser,
} from "acorn";
import acornJsx from "acorn-jsx";
import type { Nodes } from "mdast";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { autolink } from "micromark-core-commonmark";
import { mdxExpression } from "micromark-extension-mdx-expression";
import { mdxJsx } from "micromark-extension-mdx-jsx";
import { mdxMd } from "micromark-extension-mdx-md";
import { mdxjsEsm } from "micromark-extension-mdxjs-esm";
import { combineExtensions } from "micromark-util-combine-extensions";
import type { Construct, Extension, Tokenizer } from "micromark-util-types";
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

function incompleteExpression(position: number): SyntaxError {
  const error = new SyntaxError("Incomplete embedded expression") as SyntaxError & {
    pos: number;
    raisedAt: number;
    loc: { line: number; column: number };
  };
  error.pos = position;
  error.raisedAt = position;
  error.loc = { line: 1, column: position };
  return error;
}

interface LexicalState {
  bracketDepth: number;
  braceDepth: number;
  contextualSlash: boolean;
  jsxElementDepth: number;
  readonly jsxTags: Array<{ closing: boolean }>;
  pendingSlash: boolean;
  parenthesisDepth: number;
  previousLabel: string | undefined;
}

interface LexicalCache {
  grammarRequired: boolean;
  readonly position: number;
  inputLength: number;
  readonly state: LexicalState;
  readonly comments: Comment[];
  terminalError: SyntaxError | undefined;
  readonly tokenizer:
    & ReturnType<typeof LexicalBoundaryParser.tokenizer>
    & LexicalBoundaryParser;
}

let lexicalCache: LexicalCache | undefined;

function consumeLexicalToken(state: LexicalState, label: string): void {
  if (state.pendingSlash) {
    if (label !== "jsxTagEnd") state.contextualSlash = true;
    state.pendingSlash = false;
  }
  if (label === "{" || label === "${") state.braceDepth++;
  else if (label === "}") state.braceDepth--;
  else if (label === "(") state.parenthesisDepth++;
  else if (label === ")") state.parenthesisDepth--;
  else if (label === "[") state.bracketDepth++;
  else if (label === "]") state.bracketDepth--;
  else if (label === "jsxTagStart") state.jsxTags.push({ closing: false });
  else if (
    label === "/" && state.previousLabel === "jsxTagStart" &&
    state.jsxTags.length > 0
  ) {
    state.jsxTags[state.jsxTags.length - 1]!.closing = true;
  } else if (label === "jsxTagEnd") {
    const tag = state.jsxTags.pop();
    if (tag?.closing) state.jsxElementDepth--;
    else if (state.previousLabel !== "/") state.jsxElementDepth++;
  } else if (label === "/" && state.previousLabel !== "jsxTagStart") {
    state.pendingSlash = true;
  }
  state.previousLabel = label;
}

function tokenizerFor(
  input: string,
  position: number,
  options: AcornOptions,
): LexicalCache {
  if (
    lexicalCache !== undefined && lexicalCache.position === position &&
    input.length > lexicalCache.inputLength
  ) {
    if (
      !lexicalCache.grammarRequired && lexicalCache.terminalError === undefined
    ) {
      lexicalCache.tokenizer.extendInput(input.slice(position));
    }
    lexicalCache.inputLength = input.length;
    return lexicalCache;
  }

  const comments: Comment[] = [];
  const cache: LexicalCache = {
    grammarRequired: false,
    position,
    inputLength: input.length,
    state: {
      bracketDepth: 0,
      braceDepth: 0,
      contextualSlash: false,
      jsxElementDepth: 0,
      jsxTags: [],
      pendingSlash: false,
      parenthesisDepth: 0,
      previousLabel: undefined,
    },
    comments,
    terminalError: undefined,
    tokenizer: createLexicalTokenizer(
      input.slice(position),
      options,
      comments,
    ),
  };
  lexicalCache = cache;
  return cache;
}

function lexicalBoundaryState(
  input: string,
  position: number,
  options: AcornOptions,
): LexicalState {
  const cache = tokenizerFor(input, position, options);
  if (cache.terminalError !== undefined) throw cache.terminalError;
  if (cache.grammarRequired) return cache.state;
  try {
    while (true) {
      const token = cache.tokenizer.getToken();
      consumeLexicalToken(cache.state, token.type.label);
      if (token.type.label === "eof") break;
    }
  } catch (error) {
    // Micromark probes every `}` before the complete expression is available.
    // An unfinished regular-expression token fixes slash handling to Acorn's
    // grammar for the remaining probes; it is not a failure of the full input.
    if (isIncompleteRegularExpression(error)) {
      cache.grammarRequired = true;
      cache.state.contextualSlash = true;
      throw error;
    }
    // A `}` encountered as JSX text cannot become valid by appending more
    // source. Preserve that lexical result so later probes do not retokenize
    // the same invalid prefix.
    if (isTerminalJsxBoundaryError(error)) {
      cache.terminalError = error;
      throw error;
    }
    lexicalCache = undefined;
    throw error;
  }

  const trailingComment = cache.comments[cache.comments.length - 1];
  if (
    trailingComment?.type === "Line" &&
    trailingComment.end === input.length - position
  ) {
    lexicalCache = undefined;
    throw incompleteExpression(input.length);
  }

  return cache.state;
}

function isLexicallyComplete(state: LexicalState): boolean {
  return state.bracketDepth === 0 && state.braceDepth === 0 &&
    state.jsxElementDepth === 0 && state.jsxTags.length === 0 &&
    state.parenthesisDepth === 0;
}

function isIncompleteRegularExpression(error: unknown): error is SyntaxError {
  return error instanceof SyntaxError &&
    error.message.startsWith("Unterminated regular expression");
}

function isTerminalJsxBoundaryError(error: unknown): error is SyntaxError {
  return error instanceof SyntaxError &&
    (error.message.startsWith("Unterminated JSX contents") ||
      error.message.startsWith("Unexpected token `}`."));
}

/**
 * Micromark needs a lexical answer at each possible expression-closing brace.
 * Building an Acorn AST here would recurse through arbitrarily deep JSX before
 * the analyzer can reduce it. Tokenization gives micromark the same boundary
 * answer without claiming to validate grammar; bounded Babel parsing below
 * owns that validation for every accepted boundary. A slash token is the one
 * context-sensitive case: JavaScript grammar, not a token label, distinguishes
 * division from a regular expression, so those expressions take the Acorn
 * grammar path deterministically before micromark accepts a closing brace.
 * JSX closing and self-closing slashes are lexical tag punctuation and do not
 * select that path.
 */
class LexicalBoundaryParser extends AcornJsxParser {
  extendInput(input: string): void {
    this.input = input;
  }

  static override parseExpressionAt(
    input: string,
    position: number,
    options: AcornOptions,
  ): Expression {
    const state = lexicalBoundaryState(input, position, options);
    if (state.contextualSlash) {
      if (lexicalCache !== undefined) lexicalCache.grammarRequired = true;
      const expression = AcornJsxParser.parseExpressionAt(
        input,
        position,
        options,
      );
      lexicalCache = undefined;
      return expression;
    }
    if (!isLexicallyComplete(state)) {
      throw incompleteExpression(input.length);
    }
    lexicalCache = undefined;

    if (/^\(\{\s*\.\.\./.test(input.slice(position)) && input.endsWith("})")) {
      const expression: ObjectExpression = {
        type: "ObjectExpression",
        start: position,
        end: input.length,
        properties: [{
          type: "SpreadElement",
          start: position + 2,
          end: input.length - 2,
          argument: {
            type: "Identifier",
            name: "_veryfront_spread",
            start: position + 5,
            end: input.length - 2,
          },
        }],
      };
      return expression;
    }

    return {
      type: "Identifier",
      name: "_veryfront_expression",
      start: position,
      end: input.length,
    };
  }
}

function createLexicalTokenizer(
  input: string,
  options: AcornOptions,
  comments: Comment[],
): ReturnType<typeof LexicalBoundaryParser.tokenizer> & LexicalBoundaryParser {
  const tokenizer = LexicalBoundaryParser.tokenizer(input, {
    ...options,
    onComment: comments,
    onToken: undefined,
  });
  if (!(tokenizer instanceof LexicalBoundaryParser)) {
    throw new TypeError("Acorn did not create the configured lexical tokenizer");
  }
  return tokenizer;
}

function autolinkAwareJsx(
  extension: Extension,
): Extension {
  const flowValue = extension.flow?.[60];
  const flow = Array.isArray(flowValue) ? flowValue[0] : flowValue;
  if (flow === undefined) {
    throw new TypeError("The MDX JSX extension has no flow construct");
  }
  const tokenize: Tokenizer = function (effects, ok, nok) {
    const jsxStart = flow.tokenize.call(this, effects, ok, nok);
    return effects.check(autolink, nok, jsxStart);
  };
  const guardedFlow: Construct = { ...flow, tokenize };
  return { ...extension, flow: { ...extension.flow, 60: guardedFlow } };
}

const mdxMarkdownSyntax = {
  disable: { null: ["codeIndented", "htmlFlow", "htmlText"] },
} satisfies ReturnType<typeof mdxMd>;
const lexicalJsx = autolinkAwareJsx(
  mdxJsx({ acorn: LexicalBoundaryParser, addResult: false }),
);

const lexicalMdx = combineExtensions([
  mdxjsEsm({ acorn: AcornJsxParser, addResult: false }),
  mdxExpression({ acorn: LexicalBoundaryParser, addResult: false }),
  lexicalJsx,
  { text: { 60: autolink } },
  mdxMarkdownSyntax,
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
  lexicalCache = undefined;
  try {
    root = processor.parse(options.value);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const diagnostic = parserDiagnostic(error, locator);
    if (diagnostic === undefined) throw error;
    return { kind: "syntax-error", diagnostic };
  } finally {
    lexicalCache = undefined;
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

  return {
    kind: "document",
    renderedRanges: markdown.renderedRanges,
    destinations,
  };
}
