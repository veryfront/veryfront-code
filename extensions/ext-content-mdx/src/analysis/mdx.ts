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

import {
  analyzeEmbeddedExpression,
  EMBEDDED_CODE_LIMIT_MESSAGE,
  isDestinationAttribute,
  MAX_EMBEDDED_CODE_UNITS,
} from "./embedded-code.ts";
import { yamlFrontmatterDiagnostic } from "./frontmatter.ts";
import { analyzeMarkdownTree } from "./markdown.ts";
import { createSourceLocator, type SourceLocator } from "./source.ts";
import type {
  ContentAnalysisResult,
  ContentDestination,
  ContentSyntaxDiagnostic,
} from "./types.ts";

const AcornJsxParser = Parser.extend(acornJsx());
// micromark's acorn bridge rescans every still-open expression, so unbounded nesting is quadratic.
const MAX_MDX_EXPRESSION_DEPTH = 64;
const MDX_STRUCTURE_LIMIT_MESSAGE = "Parser capacity exceeded for MDX structure";

type PositionedSyntaxError = SyntaxError & {
  pos: number;
  raisedAt: number;
  loc: { line: number; column: number };
};

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

function embeddedCodeLimitError(position: number): SyntaxError {
  const error = new SyntaxError(EMBEDDED_CODE_LIMIT_MESSAGE) as SyntaxError & {
    pos: number;
    raisedAt: number;
    loc: { line: number; column: number };
  };
  error.pos = position;
  error.raisedAt = position;
  error.loc = { line: 1, column: position };
  return error;
}

function mdxStructureLimitError(position: number): SyntaxError {
  const error = new SyntaxError(MDX_STRUCTURE_LIMIT_MESSAGE) as SyntaxError & {
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
let lexicalCapacityError: PositionedSyntaxError | undefined;

function currentLexicalCapacityError(): PositionedSyntaxError | undefined {
  return lexicalCapacityError;
}

function consumeBalancedToken(state: LexicalState, label: string): boolean {
  if (label === "{" || label === "${") state.braceDepth++;
  else if (label === "}") state.braceDepth--;
  else if (label === "(") state.parenthesisDepth++;
  else if (label === ")") state.parenthesisDepth--;
  else if (label === "[") state.bracketDepth++;
  else if (label === "]") state.bracketDepth--;
  else return false;
  return true;
}

function consumeJsxToken(state: LexicalState, label: string): boolean {
  if (label === "jsxTagStart") {
    state.jsxTags.push({ closing: false });
    return true;
  }
  if (label === "/" && state.previousLabel === "jsxTagStart") {
    return markCurrentJsxTagClosing(state);
  }
  if (label === "jsxTagEnd") {
    closeCurrentJsxTag(state);
    return true;
  }
  return false;
}

function markCurrentJsxTagClosing(state: LexicalState): boolean {
  const tag = state.jsxTags.at(-1);
  if (tag === undefined) return false;
  tag.closing = true;
  return true;
}

function closeCurrentJsxTag(state: LexicalState): void {
  const tag = state.jsxTags.pop();
  if (tag?.closing) {
    state.jsxElementDepth--;
    return;
  }
  if (state.previousLabel !== "/") state.jsxElementDepth++;
}

function consumePendingSlash(state: LexicalState, label: string): void {
  if (!state.pendingSlash) return;
  if (label !== "jsxTagEnd") state.contextualSlash = true;
  state.pendingSlash = false;
}

function queuePotentialContextualSlash(state: LexicalState, label: string): void {
  if (label === "/" && state.previousLabel !== "jsxTagStart") {
    state.pendingSlash = true;
  }
}

function consumeLexicalToken(state: LexicalState, label: string): void {
  consumePendingSlash(state, label);
  if (consumeBalancedToken(state, label) || consumeJsxToken(state, label)) {
    state.previousLabel = label;
    return;
  }
  queuePotentialContextualSlash(state, label);
  state.previousLabel = label;
}

function tokenizerFor(
  input: string,
  position: number,
  options: AcornOptions,
): LexicalCache {
  if (
    lexicalCache?.position === position &&
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
  if (input.length - position > MAX_EMBEDDED_CODE_UNITS) {
    throw embeddedCodeLimitError(position);
  }
  const cache = tokenizerFor(input, position, options);
  if (cache.terminalError !== undefined) throw cache.terminalError;
  if (cache.grammarRequired) return cache.state;
  try {
    while (true) {
      const token = cache.tokenizer.getToken();
      consumeLexicalToken(cache.state, token.type.label);
      if (cache.state.braceDepth > MAX_MDX_EXPRESSION_DEPTH) {
        throw mdxStructureLimitError(cache.position + token.start);
      }
      if (cache.state.contextualSlash) {
        cache.grammarRequired = true;
        return cache.state;
      }
      if (token.type.label === "eof") break;
    }
  } catch (error) {
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

  const trailingComment = cache.comments.at(-1);
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

function isTerminalJsxBoundaryError(error: unknown): error is SyntaxError {
  return error instanceof SyntaxError &&
    (error.message.startsWith("Unterminated JSX contents") ||
      error.message.startsWith("Unexpected token `}`."));
}

function isMdxStructureLimitError(
  error: unknown,
): error is PositionedSyntaxError {
  return error instanceof SyntaxError &&
    error.message === MDX_STRUCTURE_LIMIT_MESSAGE &&
    "pos" in error && typeof error.pos === "number" &&
    "raisedAt" in error && typeof error.raisedAt === "number" &&
    "loc" in error && typeof error.loc === "object" && error.loc !== null;
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
    // The micromark bridge treats an Acorn error as a possibly incomplete
    // expression and retries it at each later `}`. The first capacity error is
    // allowed through so the bridge maps its position back to authored source.
    // A later probe receives the same lexical boundary sentinel used for valid
    // expressions, and parseMdxRoot surfaces the recorded terminal error.
    if (lexicalCapacityError !== undefined) {
      return lexicalPlaceholder(position, input.length);
    }
    let state: LexicalState;
    try {
      state = lexicalBoundaryState(input, position, options);
    } catch (error) {
      if (isMdxStructureLimitError(error)) lexicalCapacityError = error;
      throw error;
    }
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

    return lexicalPlaceholder(position, input.length);
  }
}

function lexicalPlaceholder(position: number, end: number): Expression {
  return {
    type: "Identifier",
    name: "_veryfront_expression",
    start: position,
    end,
  };
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

function createMdxProcessor(frontmatter: boolean) {
  const processor = unified().use(remarkParse).use(remarkGfm);
  if (frontmatter) processor.use(remarkFrontmatter, ["yaml"]);
  processor.data("micromarkExtensions", [lexicalMdx]);
  processor.data("fromMarkdownExtensions", [mdxFromMarkdown()]);
  return processor;
}

type MdxProcessor = ReturnType<typeof createMdxProcessor>;
type MdxRoot = ReturnType<MdxProcessor["parse"]>;

interface EmbeddedInput {
  readonly source: string;
  readonly absoluteStart: number;
  readonly attributeName: string | undefined;
  readonly fragmentKind: "expression" | "jsx-spread-attribute";
}

type MdxJsxElement = Extract<Nodes, { type: "mdxJsxFlowElement" | "mdxJsxTextElement" }>;
type MdxJsxAttribute = MdxJsxElement["attributes"][number];

function own(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function parserMessage(error: Error): string {
  const causeMessage = own(own(error, "cause"), "message");
  if (
    causeMessage === EMBEDDED_CODE_LIMIT_MESSAGE ||
    causeMessage === MDX_STRUCTURE_LIMIT_MESSAGE
  ) {
    return causeMessage;
  }
  const reason = own(error, "reason");
  const message = typeof reason === "string" ? reason : error.message;
  const firstLine = message.split("\n", 1)[0]?.trim() || error.name;
  return firstLine.length <= 240 ? firstLine : `${firstLine.slice(0, 237)}...`;
}

function capacityDiagnostic(
  locator: SourceLocator,
  offset: number,
): ContentSyntaxDiagnostic {
  const point = locator.point(offset);
  return {
    message: MDX_STRUCTURE_LIMIT_MESSAGE,
    range: { start: point, end: point },
  };
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
  if (error instanceof RangeError) return capacityDiagnostic(locator, 0);
  return undefined;
}

function parseMdxRoot(
  value: string,
  frontmatter: boolean,
  locator: SourceLocator,
): { readonly kind: "root"; readonly root: MdxRoot } | ContentAnalysisResult {
  const processor = createMdxProcessor(frontmatter);
  lexicalCache = undefined;
  lexicalCapacityError = undefined;
  try {
    const root = processor.parse(value);
    const capacityError = currentLexicalCapacityError();
    if (capacityError !== undefined) {
      return {
        kind: "syntax-error",
        diagnostic: capacityDiagnostic(locator, capacityError.pos),
      };
    }
    return { kind: "root", root };
  } catch (error) {
    const capacityError = currentLexicalCapacityError();
    if (capacityError !== undefined) {
      return {
        kind: "syntax-error",
        diagnostic: capacityDiagnostic(locator, capacityError.pos),
      };
    }
    if (!(error instanceof Error)) throw error;
    const diagnostic = parserDiagnostic(error, locator);
    if (diagnostic === undefined) throw error;
    return { kind: "syntax-error", diagnostic };
  } finally {
    lexicalCache = undefined;
    lexicalCapacityError = undefined;
  }
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
  fragmentKind: EmbeddedInput["fragmentKind"],
): EmbeddedInput | undefined {
  const offsets = positionOffsets(expression.position);
  if (offsets === undefined) return undefined;
  const authored = value.slice(offsets.start, offsets.end);
  const brace = authored.indexOf("{");
  return {
    source: expression.value,
    absoluteStart: brace === -1 ? offsets.start : offsets.start + brace + 1,
    attributeName,
    fragmentKind,
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
    fragmentKind: "expression",
  };
}

function appendChildren(pending: Nodes[], node: Nodes): void {
  const children = childrenOf(node);
  for (let index = children.length - 1; index >= 0; index--) {
    const child = children[index];
    if (child !== undefined) pending.push(child);
  }
}

function collectMdxNodeInputs(
  value: string,
  node: Nodes,
  locator: SourceLocator,
  destinations: ContentDestination[],
  embedded: EmbeddedInput[],
): void {
  if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") {
    const input = documentExpressionInput(node);
    if (input !== undefined) embedded.push(input);
    return;
  }

  if (node.type !== "mdxJsxFlowElement" && node.type !== "mdxJsxTextElement") {
    return;
  }

  for (const attribute of node.attributes) {
    collectMdxAttribute(value, attribute, locator, destinations, embedded);
  }
}

function collectMdxAttribute(
  value: string,
  attribute: MdxJsxAttribute,
  locator: SourceLocator,
  destinations: ContentDestination[],
  embedded: EmbeddedInput[],
): void {
  if (attribute.type === "mdxJsxExpressionAttribute") {
    const input = embeddedInput(value, attribute, undefined, "jsx-spread-attribute");
    if (input !== undefined) embedded.push(input);
    return;
  }

  if (typeof attribute.value === "string") {
    if (!isDestinationAttribute(attribute.name)) return;
    const destination = quotedAttributeDestination(value, attribute.position, locator);
    if (destination !== undefined) destinations.push(destination);
    return;
  }

  if (attribute.value === null || attribute.value === undefined) return;
  const input = embeddedInput(
    value,
    { value: attribute.value.value, position: attribute.position },
    attribute.name,
    "expression",
  );
  if (input !== undefined) embedded.push(input);
}

function collectMdxEmbeddedInputs(
  value: string,
  root: Nodes,
  locator: SourceLocator,
): {
  readonly destinations: readonly ContentDestination[];
  readonly embedded: readonly EmbeddedInput[];
} {
  const destinations: ContentDestination[] = [];
  const embedded: EmbeddedInput[] = [];
  const pending: Nodes[] = [root];

  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    collectMdxNodeInputs(value, node, locator, destinations, embedded);
    appendChildren(pending, node);
  }

  return { destinations, embedded };
}

async function appendEmbeddedAnalysisDestinations(options: {
  readonly embedded: readonly EmbeddedInput[];
  readonly destinations: ContentDestination[];
  readonly locator: SourceLocator;
  readonly filePath: string | undefined;
}): Promise<ContentAnalysisResult | undefined> {
  const embedded = [...options.embedded].sort((left, right) =>
    left.absoluteStart - right.absoluteStart
  );

  for (const input of embedded) {
    const analysis = await analyzeEmbeddedExpression({
      ...input,
      locator: options.locator,
      filePath: options.filePath,
    });
    if (analysis.kind === "syntax-error") return analysis;
    options.destinations.push(...analysis.destinations);
    if (analysis.staticDestination !== undefined) {
      options.destinations.push(analysis.staticDestination);
    }
  }

  return undefined;
}

export async function analyzeMdx(options: {
  readonly value: string;
  readonly frontmatter: boolean;
  readonly filePath: string | undefined;
}): Promise<ContentAnalysisResult> {
  const locator = createSourceLocator(options.value);
  const parsed = parseMdxRoot(options.value, options.frontmatter, locator);
  if (parsed.kind !== "root") return parsed;

  const frontmatterDiagnostic = yamlFrontmatterDiagnostic(
    options.value,
    parsed.root,
    locator,
  );
  if (frontmatterDiagnostic !== undefined) {
    return { kind: "syntax-error", diagnostic: frontmatterDiagnostic };
  }

  const markdown = analyzeMarkdownTree(options.value, parsed.root, {
    micromarkExtensions: [lexicalMdx],
  });
  const mdx = collectMdxEmbeddedInputs(options.value, parsed.root, locator);
  const destinations = [...markdown.destinations, ...mdx.destinations];
  const embeddedError = await appendEmbeddedAnalysisDestinations({
    embedded: mdx.embedded,
    destinations,
    locator,
    filePath: options.filePath,
  });
  if (embeddedError !== undefined) return embeddedError;

  return {
    kind: "document",
    destinations,
  };
}
