import { BabelParseOnlyParser } from "@veryfront/ext-parser-babel/parser-only";
import { Parser } from "acorn";
import acornJsx from "acorn-jsx";
import type { ASTNode } from "veryfront/extensions/parser";

import type { SourceLocator } from "./source.ts";
import type { ContentDestination, ContentSyntaxDiagnostic } from "./types.ts";

export const MAX_EMBEDDED_CODE_UNITS = 65_536;
export const EMBEDDED_CODE_LIMIT_MESSAGE =
  `Embedded code exceeds the ${MAX_EMBEDDED_CODE_UNITS}-unit parser limit`;

const AcornJsxParser = Parser.extend(acornJsx());
const babelParser = new BabelParseOnlyParser();

interface Span {
  readonly start: number;
  readonly end: number;
}

interface TokenSpan extends Span {
  readonly label: string;
}

interface ReducedSegment {
  readonly reducedStart: number;
  readonly reducedEnd: number;
  readonly sourceStart: number;
  readonly replacement: boolean;
}

interface ReducedFragment {
  readonly value: string;
  readonly segments: readonly ReducedSegment[];
}

interface ExpressionRecord {
  readonly id: number;
  readonly parentId: number | undefined;
  readonly start: number;
  end: number | undefined;
  readonly root: boolean;
  readonly attributeName: string | undefined;
  readonly fragmentKind: "expression" | "jsx-spread-attribute";
  braceDepth: number;
  readonly tokens: TokenSpan[];
}

interface ExpressionMode {
  readonly kind: "expression";
  readonly expressionId: number;
}

interface JsxChildrenMode {
  readonly kind: "jsx-children";
}

interface JsxTagMode {
  readonly kind: "jsx-tag";
  readonly start: number;
  expectedNameOffset: number;
  name: string;
  nameComplete: boolean;
  closing: boolean;
  selfClosing: boolean;
  readonly ownsReductionGroup: boolean;
  reductionOpened: boolean;
  pendingAttributeName: string | undefined;
  pendingAttributeNameEnd: number | undefined;
  awaitingAttributeName: string | undefined;
  readonly expressionIds: number[];
}

type ParseMode = ExpressionMode | JsxChildrenMode | JsxTagMode;

interface ElementFrame {
  readonly name: string;
  readonly ownsReductionGroup: boolean;
}

interface JsxTagRecord {
  readonly start: number;
  readonly end: number;
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  readonly expressionIds: readonly number[];
}

export type EmbeddedCodeAnalysis =
  | {
    readonly kind: "valid";
    readonly destinations: readonly ContentDestination[];
    readonly staticDestination: ContentDestination | undefined;
  }
  | {
    readonly kind: "syntax-error";
    readonly diagnostic: ContentSyntaxDiagnostic;
  };

export function isDestinationAttribute(name: string | undefined): boolean {
  const normalized = name?.toLowerCase();
  return normalized === "href" || normalized === "src" ||
    normalized === "action" || normalized === "xlinkhref";
}

function parserMessage(error: Error): string {
  const firstLine = error.message.split("\n", 1)[0]?.trim() || error.name;
  return firstLine.length <= 240 ? firstLine : `${firstLine.slice(0, 237)}...`;
}

function diagnostic(
  locator: SourceLocator,
  absoluteStart: number,
  relativeOffset: number,
  message: string,
): ContentSyntaxDiagnostic {
  const point = locator.point(absoluteStart + relativeOffset);
  return { message, range: { start: point, end: point } };
}

function embeddedCodeLimitDiagnostic(
  locator: SourceLocator,
  absoluteStart: number,
  relativeOffset: number,
): ContentSyntaxDiagnostic {
  return diagnostic(
    locator,
    absoluteStart,
    relativeOffset,
    EMBEDDED_CODE_LIMIT_MESSAGE,
  );
}

function expressionAt(
  expressions: readonly ExpressionRecord[],
  id: number,
): ExpressionRecord | undefined {
  return expressions[id];
}

function currentMode(modes: readonly ParseMode[]): ParseMode | undefined {
  return modes.at(-1);
}

function beginExpression(
  expressions: ExpressionRecord[],
  modes: ParseMode[],
  activeExpressionId: number,
  start: number,
  attributeName: string | undefined,
  fragmentKind: "expression" | "jsx-spread-attribute",
): number {
  const id = expressions.length;
  expressions.push({
    id,
    parentId: activeExpressionId,
    start,
    end: undefined,
    root: false,
    attributeName,
    fragmentKind,
    braceDepth: 0,
    tokens: [],
  });
  modes.push({ kind: "expression", expressionId: id });
  return id;
}

function reducedSourceBuilder(source: string): {
  readonly authored: (start: number, end: number) => void;
  readonly generated: (value: string, sourceStart: number) => void;
  readonly result: () => ReducedFragment;
} {
  const parts: string[] = [];
  const segments: ReducedSegment[] = [];
  let reducedOffset = 0;

  function append(value: string, sourceStart: number, replacement: boolean): void {
    if (value.length === 0) return;
    parts.push(value);
    segments.push({
      reducedStart: reducedOffset,
      reducedEnd: reducedOffset + value.length,
      sourceStart,
      replacement,
    });
    reducedOffset += value.length;
  }

  return {
    authored(start, end) {
      if (end > start) append(source.slice(start, end), start, false);
    },
    generated(value, sourceStart) {
      append(value, sourceStart, true);
    },
    result() {
      return { value: parts.join(""), segments };
    },
  };
}

function tagValidationFragment(
  source: string,
  expressions: readonly ExpressionRecord[],
  tags: readonly JsxTagRecord[],
): ReducedFragment {
  const builder = reducedSourceBuilder(source);
  for (const tag of tags) {
    appendSyntheticOpeningTag(builder, tag);
    let cursor = tag.start;
    for (const expressionId of tag.expressionIds) {
      cursor = appendTagValidationExpression(builder, expressions, expressionId, cursor);
    }
    builder.authored(cursor, tag.end);
    appendSyntheticClosingTag(builder, tag);
    builder.generated(",", tag.end);
  }
  return builder.result();
}

function syntheticOpeningTag(tag: JsxTagRecord): string {
  return tag.name === "" ? "<>" : `<${tag.name}>`;
}

function syntheticClosingTag(tag: JsxTagRecord): string {
  return tag.name === "" ? "</>" : `</${tag.name}>`;
}

function appendSyntheticOpeningTag(
  builder: ReturnType<typeof reducedSourceBuilder>,
  tag: JsxTagRecord,
): void {
  if (tag.closing) builder.generated(syntheticOpeningTag(tag), tag.start);
}

function appendSyntheticClosingTag(
  builder: ReturnType<typeof reducedSourceBuilder>,
  tag: JsxTagRecord,
): void {
  if (!tag.closing && !tag.selfClosing) {
    builder.generated(syntheticClosingTag(tag), tag.end);
  }
}

function appendTagValidationExpression(
  builder: ReturnType<typeof reducedSourceBuilder>,
  expressions: readonly ExpressionRecord[],
  expressionId: number,
  cursor: number,
): number {
  const expression = expressionAt(expressions, expressionId);
  if (expression?.end === undefined) return cursor;
  const braceStart = expression.start - 1;
  const braceEnd = expression.end + 1;
  builder.authored(cursor, braceStart);
  builder.generated(tagExpressionReplacement(expression), braceStart);
  return braceEnd;
}

function tagExpressionReplacement(expression: ExpressionRecord): string {
  const spread = expression.fragmentKind === "jsx-spread-attribute" &&
    expression.tokens[0]?.label === "...";
  return spread ? "{...{}}" : "{null}";
}

function authoredOffsetAt(
  fragment: ReducedFragment,
  reducedOffset: number,
  fallbackOffset: number,
): number {
  const offset = Math.max(0, Math.min(reducedOffset, fragment.value.length));
  for (const segment of fragment.segments) {
    if (offset >= segment.reducedEnd) continue;
    if (offset < segment.reducedStart) return segment.sourceStart;
    if (segment.replacement) return segment.sourceStart;
    return segment.sourceStart + offset - segment.reducedStart;
  }
  return fallbackOffset;
}

function appendAuthoredThrough(
  builder: ReturnType<typeof reducedSourceBuilder>,
  cursor: { value: number },
  end: number,
): void {
  if (end > cursor.value) {
    builder.authored(cursor.value, end);
  }
  cursor.value = Math.max(cursor.value, end);
}

function discardThrough(cursor: { value: number }, end: number): void {
  cursor.value = Math.max(cursor.value, end);
}

function staticLiteralLabels(expression: ExpressionRecord): readonly string[] {
  const labels = expression.tokens.map((token) => token.label);
  let start = 0;
  let end = labels.length;
  while (labels[start] === "(" && labels[end - 1] === ")") {
    start++;
    end--;
  }
  return labels.slice(start, end);
}

function staticLiteralCandidate(expression: ExpressionRecord): boolean {
  const literalLabels = staticLiteralLabels(expression);
  if (literalLabels.length === 1) {
    return literalLabels[0] === "string";
  }
  return literalLabels[0] === "`" && literalLabels.at(-1) === "`" &&
    !literalLabels.includes("${");
}

function expressionFragment(source: string, expression: ExpressionRecord): ReducedFragment {
  const end = expression.end ?? expression.start;
  const builder = reducedSourceBuilder(source);
  let start = expression.start;
  if (
    expression.fragmentKind === "jsx-spread-attribute" &&
    expression.tokens[0]?.label === "..."
  ) {
    start = expression.tokens[0].end;
  }
  builder.authored(start, end);
  return builder.result();
}

function spreadAttributeFragment(source: string, expression: ExpressionRecord): ReducedFragment {
  const end = expression.end ?? expression.start;
  const builder = reducedSourceBuilder(source);
  builder.authored(expression.start, end);
  return builder.result();
}

function own(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function firstArrayItem(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

function nodeType(value: unknown): string | undefined {
  const type = own(value, "type");
  return typeof type === "string" ? type : undefined;
}

function parsedInitializer(ast: ASTNode): unknown {
  const program = own(ast, "program");
  const statement = firstArrayItem(own(program, "body"));
  const declaration = firstArrayItem(own(statement, "declarations"));
  return own(declaration, "init");
}

interface StaticLiteral {
  readonly kind: "string" | "template";
  readonly cookedValue: string;
}

function staticLiteral(ast: ASTNode): StaticLiteral | undefined {
  const initializer = parsedInitializer(ast);
  if (nodeType(initializer) === "StringLiteral") {
    const cookedValue = own(initializer, "value");
    if (typeof cookedValue !== "string") {
      throw new TypeError("Babel returned an invalid string literal");
    }
    return { kind: "string", cookedValue };
  }
  if (nodeType(initializer) !== "TemplateLiteral") return undefined;
  const expressions = own(initializer, "expressions");
  if (!Array.isArray(expressions)) {
    throw new TypeError("Babel returned an invalid template literal");
  }
  if (expressions.length !== 0) return undefined;
  const quasis = own(initializer, "quasis");
  const quasi = firstArrayItem(quasis);
  const cookedValue = own(own(quasi, "value"), "cooked");
  if (!Array.isArray(quasis) || quasis.length !== 1 || typeof cookedValue !== "string") {
    throw new TypeError("Babel returned an invalid static template literal");
  }
  return { kind: "template", cookedValue };
}

function literalRange(
  expression: ExpressionRecord,
  kind: "string" | "template",
): Span | undefined {
  if (kind === "string") {
    const token = expression.tokens.find((candidate) => candidate.label === "string");
    return token === undefined ? undefined : { start: token.start + 1, end: token.end - 1 };
  }
  const delimiters = expression.tokens.filter((token) => token.label === "`");
  const start = delimiters[0]?.end;
  const end = delimiters.at(-1)?.start;
  return start === undefined || end === undefined || end < start ? undefined : { start, end };
}

function reducedJsxValue(
  ownsReductionGroup: boolean,
  parentMode: ParseMode | undefined,
): string {
  if (ownsReductionGroup) return "null)";
  if (parentMode?.kind === "jsx-children") return "null,";
  return "null";
}

function hasTokens(fragment: string): boolean {
  const tokenizer = AcornJsxParser.tokenizer(fragment, {
    ecmaVersion: 2024,
    sourceType: "module",
  });
  return tokenizer.getToken().type.label !== "eof";
}

/** Tracks a `/` that is division rather than a JSX tag terminator. */
export interface ContextualSlashState {
  contextualSlash: boolean;
  pendingSlash: boolean;
  previousLabel: string | undefined;
}

export function consumeContextualSlashToken(
  state: ContextualSlashState,
  label: string,
): void {
  if (state.pendingSlash) {
    if (label !== "jsxTagEnd") state.contextualSlash = true;
    state.pendingSlash = false;
  }
  if (label === "/" && state.previousLabel !== "jsxTagStart") {
    state.pendingSlash = true;
  }
}

function embeddedLexicalProfile(source: string): {
  readonly contextualSlash: boolean;
} {
  const tokenizer = AcornJsxParser.tokenizer(source, {
    ecmaVersion: 2024,
    sourceType: "module",
  });
  const state: ContextualSlashState = {
    contextualSlash: false,
    pendingSlash: false,
    previousLabel: undefined,
  };
  while (true) {
    const label = tokenizer.getToken().type.label;
    consumeContextualSlashToken(state, label);
    if (state.contextualSlash) return { contextualSlash: true };
    state.previousLabel = label;
    if (label === "eof") break;
  }
  return { contextualSlash: false };
}

function parserErrorIndex(error: SyntaxError): number | undefined {
  const location = own(error, "loc");
  const locationIndex = own(location, "index");
  if (typeof locationIndex === "number") return locationIndex;
  const position = own(error, "pos");
  return typeof position === "number" ? position : undefined;
}

function grammarTokens(source: string): TokenSpan[] {
  const tokens: TokenSpan[] = [];
  AcornJsxParser.parseExpressionAt(source, 0, {
    ecmaVersion: 2024,
    sourceType: "module",
    onToken: (token) => {
      tokens.push({
        label: token.type.label,
        start: token.start,
        end: token.end,
      });
    },
  });
  tokens.push({ label: "eof", start: source.length, end: source.length });
  return tokens;
}

function validateFragment(
  fragment: ReducedFragment,
  prefix: string,
  suffix: string,
  fallbackOffset: number,
  absoluteStart: number,
  locator: SourceLocator,
):
  | { readonly kind: "valid" }
  | { readonly kind: "syntax-error"; readonly diagnostic: ContentSyntaxDiagnostic } {
  if (fragment.value.length > MAX_EMBEDDED_CODE_UNITS) {
    return {
      kind: "syntax-error",
      diagnostic: embeddedCodeLimitDiagnostic(locator, absoluteStart, fallbackOffset),
    };
  }

  try {
    if (!hasTokens(fragment.value)) return { kind: "valid" };
    AcornJsxParser.parse(`${prefix}${fragment.value}${suffix}`, {
      ecmaVersion: 2024,
      sourceType: "module",
    });
    return { kind: "valid" };
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof RangeError)) {
      throw error;
    }
    return {
      kind: "syntax-error",
      diagnostic: diagnostic(
        locator,
        absoluteStart,
        error instanceof SyntaxError
          ? authoredOffsetAt(
            fragment,
            (parserErrorIndex(error) ?? prefix.length) - prefix.length,
            fallbackOffset,
          )
          : fallbackOffset,
        error instanceof RangeError
          ? "Parser capacity exceeded for embedded code"
          : parserMessage(error),
      ),
    };
  }
}

async function decodeStaticLiteral(
  source: string,
  expression: ExpressionRecord,
  filePath: string | undefined,
): Promise<
  | {
    readonly span: Span;
    readonly syntax: "javascript-string" | "javascript-template";
    readonly cookedValue: string;
  }
  | undefined
> {
  if (!staticLiteralCandidate(expression)) return undefined;
  const fragment = expressionFragment(source, expression);
  const ast = await babelParser.parse({
    code: `const __veryfront_value = (${fragment.value}\n);`,
    filePath: filePath ?? "content.mdx",
    decoratorMode: "current",
    syntax: "javascript",
  });
  const literal = staticLiteral(ast);
  if (literal === undefined) return undefined;
  const span = literalRange(expression, literal.kind);
  if (span === undefined) {
    throw new TypeError("Acorn did not locate the Babel static literal");
  }
  return {
    span,
    syntax: literal.kind === "string" ? "javascript-string" : "javascript-template",
    cookedValue: literal.cookedValue,
  };
}

function jsxLiteralDestination(
  source: string,
  span: Span,
  absoluteStart: number,
  locator: SourceLocator,
  syntax: "javascript-string" | "javascript-template",
  cookedValue: string,
): ContentDestination {
  return {
    kind: "mdx-jsx-attribute",
    rawValue: source.slice(span.start, span.end),
    range: locator.range(
      absoluteStart + span.start,
      absoluteStart + span.end,
    ),
    syntax,
    cookedValue,
  };
}

function jsxQuotedDestination(
  source: string,
  span: Span,
  absoluteStart: number,
  locator: SourceLocator,
): ContentDestination {
  return {
    kind: "mdx-jsx-attribute",
    rawValue: source.slice(span.start, span.end),
    range: locator.range(
      absoluteStart + span.start,
      absoluteStart + span.end,
    ),
    syntax: "html-attribute",
  };
}

export async function analyzeEmbeddedExpression(options: {
  readonly source: string;
  readonly absoluteStart: number;
  readonly locator: SourceLocator;
  readonly filePath?: string;
  readonly attributeName?: string;
  readonly fragmentKind?: "expression" | "jsx-spread-attribute";
}): Promise<EmbeddedCodeAnalysis> {
  return await new EmbeddedExpressionAnalyzer(options).analyze();
}

type EmbeddedExpressionAnalyzerOptions = Parameters<typeof analyzeEmbeddedExpression>[0];

type EmbeddedSyntaxError = Extract<EmbeddedCodeAnalysis, { readonly kind: "syntax-error" }>;
type ScanResult = EmbeddedSyntaxError | undefined;

interface ParserToken {
  readonly type: {
    readonly label: string;
  };
  readonly start: number;
  readonly end: number;
}

type EmbeddedToken = TokenSpan | ParserToken;

class EmbeddedExpressionAnalyzer {
  private readonly expressions: ExpressionRecord[];
  private readonly modes: ParseMode[] = [{ kind: "expression", expressionId: 0 }];
  private readonly elements: ElementFrame[] = [];
  private readonly tags: JsxTagRecord[] = [];
  private readonly destinations: ContentDestination[] = [];
  private readonly reducedBuilder: ReturnType<typeof reducedSourceBuilder>;
  private readonly sourceCursor = { value: 0 };
  private activeExpressionId = 0;
  private reductionGroupDepth = 0;

  constructor(private readonly options: EmbeddedExpressionAnalyzerOptions) {
    this.expressions = [{
      id: 0,
      parentId: undefined,
      start: 0,
      end: undefined,
      root: true,
      attributeName: options.attributeName,
      fragmentKind: options.fragmentKind ?? "expression",
      braceDepth: 0,
      tokens: [],
    }];
    this.reducedBuilder = reducedSourceBuilder(options.source);
  }

  async analyze(): Promise<EmbeddedCodeAnalysis> {
    if (this.options.source.length > MAX_EMBEDDED_CODE_UNITS) {
      return {
        kind: "syntax-error",
        diagnostic: embeddedCodeLimitDiagnostic(
          this.options.locator,
          this.options.absoluteStart,
          0,
        ),
      };
    }

    const scanResult = this.scanTokens();
    if (scanResult !== undefined) return scanResult;

    const spreadValidation = this.validateSpreadExpressions();
    if (spreadValidation !== undefined) return spreadValidation;

    const tagValidation = this.validateTagBatches();
    if (tagValidation !== undefined) return tagValidation;

    const rootValidation = this.validateRootExpression();
    if (rootValidation !== undefined) return rootValidation;

    const staticDestination = await this.collectStaticDestinations();
    this.destinations.sort((left, right) => left.range.start.offset - right.range.start.offset);
    return { kind: "valid", destinations: this.destinations, staticDestination };
  }

  private scanTokens(): ScanResult {
    try {
      return this.processTokenStream();
    } catch (error) {
      return this.tokenizerDiagnostic(error);
    }
  }

  private processTokenStream(): ScanResult {
    const tokens = this.createTokenSource();
    while (true) {
      const token = tokens.next();
      const label = this.tokenLabel(token);
      const mode = currentMode(this.modes);
      if (mode === undefined) return this.unexpectedTokenDiagnostic(token);
      if (label === "eof") return this.handleEof(token, mode);
      const result = this.handleToken(mode, token, label);
      if (result !== undefined) return result;
    }
  }

  private createTokenSource(): { readonly next: () => EmbeddedToken } {
    const profile = embeddedLexicalProfile(this.options.source);
    if (profile.contextualSlash) {
      const tokens = grammarTokens(this.options.source);
      const terminalToken = tokens.at(-1);
      if (terminalToken === undefined) throw new TypeError("Missing EOF token");
      let tokenIndex = 0;
      return { next: () => tokens[tokenIndex++] ?? terminalToken };
    }
    const tokenizer = AcornJsxParser.tokenizer(this.options.source, {
      ecmaVersion: 2024,
      sourceType: "module",
      locations: true,
    });
    return { next: () => tokenizer.getToken() as ParserToken };
  }

  private tokenLabel(token: EmbeddedToken): string {
    return "label" in token ? token.label : token.type.label;
  }

  private unexpectedTokenDiagnostic(token: EmbeddedToken): EmbeddedSyntaxError {
    return {
      kind: "syntax-error",
      diagnostic: diagnostic(
        this.options.locator,
        this.options.absoluteStart,
        token.start,
        "Unexpected token after embedded expression",
      ),
    };
  }

  private handleEof(token: EmbeddedToken, mode: ParseMode): ScanResult {
    if (!this.reachedBalancedRoot(mode)) {
      return {
        kind: "syntax-error",
        diagnostic: diagnostic(
          this.options.locator,
          this.options.absoluteStart,
          token.start,
          "Unexpected end of embedded JSX expression",
        ),
      };
    }
    const root = expressionAt(this.expressions, 0);
    if (root !== undefined) root.end = token.start;
    appendAuthoredThrough(this.reducedBuilder, this.sourceCursor, token.start);
  }

  private reachedBalancedRoot(mode: ParseMode): boolean {
    const root = expressionAt(this.expressions, 0);
    return this.modes.length === 1 && mode.kind === "expression" &&
      mode.expressionId === 0 && this.elements.length === 0 &&
      root?.braceDepth === 0;
  }

  private handleToken(
    mode: ParseMode,
    token: EmbeddedToken,
    label: string,
  ): ScanResult {
    if (mode.kind === "expression") return this.handleExpressionMode(mode, token, label);
    if (mode.kind === "jsx-children") {
      this.handleJsxChildrenMode(token, label);
      return undefined;
    }
    return this.handleJsxTagMode(mode, token, label);
  }

  private handleExpressionMode(
    mode: ExpressionMode,
    token: EmbeddedToken,
    label: string,
  ): ScanResult {
    const expression = expressionAt(this.expressions, mode.expressionId);
    if (expression === undefined) throw new TypeError("Missing expression state");
    if (this.handleSpreadOperator(expression, token, label)) return undefined;
    if (label === "jsxTagStart") {
      this.startJsxTag(expression, token);
      return undefined;
    }
    if (label === "{" || label === "${") {
      this.appendExpressionBrace(expression, token, label);
      return undefined;
    }
    if (label === "}") return this.handleClosingExpressionBrace(expression, token, label);
    this.appendExpressionToken(expression, token, label);
  }

  private handleSpreadOperator(
    expression: ExpressionRecord,
    token: EmbeddedToken,
    label: string,
  ): boolean {
    if (
      expression.fragmentKind !== "jsx-spread-attribute" ||
      expression.tokens.length !== 0 || label !== "..."
    ) return false;
    appendAuthoredThrough(this.reducedBuilder, this.sourceCursor, token.start);
    discardThrough(this.sourceCursor, token.end);
    expression.tokens.push({ label, start: token.start, end: token.end });
    return true;
  }

  private startJsxTag(expression: ExpressionRecord, token: EmbeddedToken): void {
    const ownsReductionGroup = this.reductionGroupDepth === 0 || expression.tokens.length > 0;
    if (ownsReductionGroup) this.reductionGroupDepth++;
    appendAuthoredThrough(this.reducedBuilder, this.sourceCursor, token.start);
    discardThrough(this.sourceCursor, token.end);
    this.pushJsxTag(token, ownsReductionGroup);
  }

  private pushJsxTag(token: EmbeddedToken, ownsReductionGroup: boolean): void {
    this.modes.push({
      kind: "jsx-tag",
      start: token.start,
      expectedNameOffset: token.end,
      name: "",
      nameComplete: false,
      closing: false,
      selfClosing: false,
      ownsReductionGroup,
      reductionOpened: false,
      pendingAttributeName: undefined,
      pendingAttributeNameEnd: undefined,
      awaitingAttributeName: undefined,
      expressionIds: [],
    });
  }

  private appendExpressionBrace(
    expression: ExpressionRecord,
    token: EmbeddedToken,
    label: string,
  ): void {
    expression.braceDepth++;
    this.appendExpressionToken(expression, token, label);
  }

  private handleClosingExpressionBrace(
    expression: ExpressionRecord,
    token: EmbeddedToken,
    label: string,
  ): ScanResult {
    if (expression.braceDepth > 0) {
      expression.braceDepth--;
      this.appendExpressionToken(expression, token, label);
      return undefined;
    }
    if (expression.root) return this.unexpectedClosingBraceDiagnostic(token);
    appendAuthoredThrough(this.reducedBuilder, this.sourceCursor, token.start);
    this.reducedBuilder.generated(",", token.start);
    discardThrough(this.sourceCursor, token.end);
    expression.end = token.start;
    this.modes.pop();
    this.activeExpressionId = expression.parentId ?? 0;
  }

  private unexpectedClosingBraceDiagnostic(token: EmbeddedToken): EmbeddedSyntaxError {
    return {
      kind: "syntax-error",
      diagnostic: diagnostic(
        this.options.locator,
        this.options.absoluteStart,
        token.start,
        "Unexpected closing brace in embedded expression",
      ),
    };
  }

  private appendExpressionToken(
    expression: ExpressionRecord,
    token: EmbeddedToken,
    label: string,
  ): void {
    expression.tokens.push({ label, start: token.start, end: token.end });
    appendAuthoredThrough(this.reducedBuilder, this.sourceCursor, token.end);
  }

  private handleJsxChildrenMode(token: EmbeddedToken, label: string): void {
    if (label === "jsxTagStart") {
      this.startNestedJsxTag(token);
    } else if (label === "{") {
      this.startChildExpression(token);
    } else {
      discardThrough(this.sourceCursor, token.end);
    }
  }

  private startNestedJsxTag(token: EmbeddedToken): void {
    discardThrough(this.sourceCursor, token.end);
    this.pushJsxTag(token, false);
  }

  private startChildExpression(token: EmbeddedToken): void {
    discardThrough(this.sourceCursor, token.end);
    this.activeExpressionId = beginExpression(
      this.expressions,
      this.modes,
      this.activeExpressionId,
      token.end,
      undefined,
      "expression",
    );
  }

  private handleJsxTagMode(mode: JsxTagMode, token: EmbeddedToken, label: string): ScanResult {
    discardThrough(this.sourceCursor, token.end);
    this.markCompleteNameAfterGap(mode, token);
    if (this.readClosingTagSlash(mode, token, label)) return undefined;
    if (this.readTagNamePart(mode, token, label)) return undefined;
    this.openReductionGroup(mode);
    mode.nameComplete = true;
    if (this.handleJsxAttributeToken(mode, token, label)) return undefined;
    if (label !== "jsxTagEnd") return undefined;
    return this.finishJsxTag(mode, token);
  }

  private markCompleteNameAfterGap(mode: JsxTagMode, token: EmbeddedToken): void {
    if (!mode.nameComplete && token.start > mode.expectedNameOffset) {
      mode.nameComplete = true;
    }
  }

  private readClosingTagSlash(
    mode: JsxTagMode,
    token: EmbeddedToken,
    label: string,
  ): boolean {
    if (
      label !== "/" || mode.name !== "" || mode.nameComplete ||
      token.start !== mode.expectedNameOffset
    ) return false;
    mode.closing = true;
    mode.expectedNameOffset = token.end;
    return true;
  }

  private readTagNamePart(mode: JsxTagMode, token: EmbeddedToken, label: string): boolean {
    if (mode.nameComplete || !this.isTagNameLabel(label)) return false;
    mode.name += this.options.source.slice(token.start, token.end);
    mode.expectedNameOffset = token.end;
    return true;
  }

  private isTagNameLabel(label: string): boolean {
    return label === "jsxName" || label === "." || label === ":";
  }

  private openReductionGroup(mode: JsxTagMode): void {
    if (!mode.closing && mode.ownsReductionGroup && !mode.reductionOpened) {
      this.reducedBuilder.generated("(", mode.start);
      mode.reductionOpened = true;
    }
  }

  private handleJsxAttributeToken(
    mode: JsxTagMode,
    token: EmbeddedToken,
    label: string,
  ): boolean {
    if (label === "jsxName") return this.readAttributeName(mode, token);
    if (label === ":") return this.readAttributeNamespace(mode, token);
    if (label === "=") return this.readAttributeAssignment(mode);
    if (label === "string") return this.readQuotedAttribute(mode, token);
    if (label === "{") return this.startAttributeExpression(mode, token);
    if (label === "/") return this.readSelfClosingSlash(mode);
    return false;
  }

  private readAttributeName(mode: JsxTagMode, token: EmbeddedToken): boolean {
    const segment = this.options.source.slice(token.start, token.end);
    mode.pendingAttributeName = mode.pendingAttributeNameEnd === token.start
      ? `${mode.pendingAttributeName ?? ""}${segment}`
      : segment;
    mode.pendingAttributeNameEnd = token.end;
    mode.awaitingAttributeName = undefined;
    return true;
  }

  private readAttributeNamespace(mode: JsxTagMode, token: EmbeddedToken): boolean {
    if (mode.pendingAttributeName === undefined || mode.pendingAttributeNameEnd !== token.start) {
      return false;
    }
    mode.pendingAttributeName += this.options.source.slice(token.start, token.end);
    mode.pendingAttributeNameEnd = token.end;
    return true;
  }

  private readAttributeAssignment(mode: JsxTagMode): boolean {
    if (mode.pendingAttributeName === undefined) return false;
    mode.awaitingAttributeName = mode.pendingAttributeName;
    mode.pendingAttributeName = undefined;
    mode.pendingAttributeNameEnd = undefined;
    return true;
  }

  private readQuotedAttribute(mode: JsxTagMode, token: EmbeddedToken): boolean {
    if (isDestinationAttribute(mode.awaitingAttributeName)) {
      this.destinations.push(
        jsxQuotedDestination(
          this.options.source,
          { start: token.start + 1, end: token.end - 1 },
          this.options.absoluteStart,
          this.options.locator,
        ),
      );
    }
    mode.awaitingAttributeName = undefined;
    return true;
  }

  private startAttributeExpression(mode: JsxTagMode, token: EmbeddedToken): boolean {
    const attributeName = mode.awaitingAttributeName;
    mode.pendingAttributeName = undefined;
    mode.pendingAttributeNameEnd = undefined;
    mode.awaitingAttributeName = undefined;
    const expressionId = beginExpression(
      this.expressions,
      this.modes,
      this.activeExpressionId,
      token.end,
      attributeName,
      attributeName === undefined ? "jsx-spread-attribute" : "expression",
    );
    mode.expressionIds.push(expressionId);
    this.activeExpressionId = expressionId;
    return true;
  }

  private readSelfClosingSlash(mode: JsxTagMode): boolean {
    mode.selfClosing = true;
    return true;
  }

  private finishJsxTag(mode: JsxTagMode, token: EmbeddedToken): ScanResult {
    this.tags.push({
      start: mode.start,
      end: token.end,
      name: mode.name,
      closing: mode.closing,
      selfClosing: mode.selfClosing,
      expressionIds: mode.expressionIds,
    });
    this.modes.pop();
    if (mode.closing) return this.finishClosingJsxTag(mode, token);
    if (mode.selfClosing) {
      this.closeReducedJsxValue(mode.ownsReductionGroup, token.start);
      return undefined;
    }
    this.elements.push({ name: mode.name, ownsReductionGroup: mode.ownsReductionGroup });
    this.modes.push({ kind: "jsx-children" });
  }

  private finishClosingJsxTag(mode: JsxTagMode, token: EmbeddedToken): ScanResult {
    const element = this.elements.pop();
    const children = currentMode(this.modes);
    if (
      element === undefined || children?.kind !== "jsx-children" ||
      element.name !== mode.name
    ) return this.unexpectedClosingTagDiagnostic(mode);
    this.modes.pop();
    this.closeReducedJsxValue(element.ownsReductionGroup, token.start);
  }

  private unexpectedClosingTagDiagnostic(mode: JsxTagMode): EmbeddedSyntaxError {
    return {
      kind: "syntax-error",
      diagnostic: diagnostic(
        this.options.locator,
        this.options.absoluteStart,
        mode.start,
        `Unexpected closing JSX tag </${mode.name}>`,
      ),
    };
  }

  private closeReducedJsxValue(ownsReductionGroup: boolean, tokenStart: number): void {
    this.reducedBuilder.generated(
      reducedJsxValue(ownsReductionGroup, currentMode(this.modes)),
      tokenStart,
    );
    if (ownsReductionGroup) this.reductionGroupDepth--;
  }

  private tokenizerDiagnostic(error: unknown): EmbeddedSyntaxError {
    if (!(error instanceof SyntaxError) && !(error instanceof RangeError)) {
      throw error;
    }
    const position = own(error, "pos");
    return {
      kind: "syntax-error",
      diagnostic: diagnostic(
        this.options.locator,
        this.options.absoluteStart,
        typeof position === "number" ? position : 0,
        error instanceof RangeError
          ? "Tokenizer capacity exceeded for embedded code"
          : parserMessage(error),
      ),
    };
  }

  private validateSpreadExpressions(): ScanResult {
    for (const expression of this.expressions) {
      const validation = this.validateSpreadExpression(expression);
      if (validation !== undefined) return validation;
    }
  }

  private validateSpreadExpression(expression: ExpressionRecord): ScanResult {
    if (!this.isSpreadAttributeExpression(expression)) return undefined;
    if (expression.tokens.length === 1) return this.emptySpreadDiagnostic(expression);
    const spreadValidation = validateFragment(
      spreadAttributeFragment(this.options.source, expression),
      "const __veryfront_value = <_Veryfront {",
      "} />;\n",
      expression.start,
      this.options.absoluteStart,
      this.options.locator,
    );
    return spreadValidation.kind === "syntax-error" ? spreadValidation : undefined;
  }

  private isSpreadAttributeExpression(expression: ExpressionRecord): boolean {
    return expression.fragmentKind === "jsx-spread-attribute" &&
      expression.tokens[0]?.label === "...";
  }

  private emptySpreadDiagnostic(expression: ExpressionRecord): EmbeddedSyntaxError {
    return {
      kind: "syntax-error",
      diagnostic: diagnostic(
        this.options.locator,
        this.options.absoluteStart,
        expression.end ?? expression.tokens[0]!.end,
        "Expected an expression after the JSX spread operator",
      ),
    };
  }

  private validateTagBatches(): ScanResult {
    const tagBatchSize = 512;
    for (let start = 0; start < this.tags.length; start += tagBatchSize) {
      const batch = this.tags.slice(start, start + tagBatchSize);
      const tagValidation = this.validateTagBatch(batch);
      if (tagValidation !== undefined) return tagValidation;
    }
  }

  private validateTagBatch(batch: readonly JsxTagRecord[]): ScanResult {
    const tagFragment = tagValidationFragment(this.options.source, this.expressions, batch);
    const tagValidation = validateFragment(
      tagFragment,
      "const __veryfront_tags = [",
      "\n];",
      batch[0]?.start ?? 0,
      this.options.absoluteStart,
      this.options.locator,
    );
    return tagValidation.kind === "syntax-error" ? tagValidation : undefined;
  }

  private validateRootExpression(): ScanResult {
    const rootValidation = validateFragment(
      this.reducedBuilder.result(),
      "const __veryfront_value = (",
      "\n);",
      expressionAt(this.expressions, 0)?.end ?? 0,
      this.options.absoluteStart,
      this.options.locator,
    );
    return rootValidation.kind === "syntax-error" ? rootValidation : undefined;
  }

  private async collectStaticDestinations(): Promise<ContentDestination | undefined> {
    let staticDestination: ContentDestination | undefined;
    for (const expression of this.expressions) {
      const destination = await this.staticDestinationForExpression(expression);
      if (destination === undefined) continue;
      if (expression.id === 0) staticDestination = destination;
      else this.destinations.push(destination);
    }
    return staticDestination;
  }

  private async staticDestinationForExpression(
    expression: ExpressionRecord,
  ): Promise<ContentDestination | undefined> {
    const literal = await decodeStaticLiteral(
      this.options.source,
      expression,
      this.options.filePath,
    );
    if (literal === undefined || !isDestinationAttribute(expression.attributeName)) {
      return undefined;
    }
    return jsxLiteralDestination(
      this.options.source,
      literal.span,
      this.options.absoluteStart,
      this.options.locator,
      literal.syntax,
      literal.cookedValue,
    );
  }
}
