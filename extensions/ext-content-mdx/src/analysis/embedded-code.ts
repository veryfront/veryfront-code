import { BabelParseOnlyParser } from "@veryfront/ext-parser-babel/parser-only";
import { Parser } from "acorn";
import acornJsx from "acorn-jsx";
import type { ASTNode } from "veryfront/extensions/parser";

import type { SourceLocator } from "./source.ts";
import type { ContentDestination, ContentSyntaxDiagnostic } from "./types.ts";

export const MAX_EMBEDDED_CODE_UNITS = 65_536;

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

function isDestinationAttribute(name: string | undefined): boolean {
  const normalized = name?.toLowerCase();
  return normalized === "href" || normalized === "src" ||
    normalized === "action";
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

function expressionAt(
  expressions: readonly ExpressionRecord[],
  id: number,
): ExpressionRecord | undefined {
  return expressions[id];
}

function currentMode(modes: readonly ParseMode[]): ParseMode | undefined {
  return modes[modes.length - 1];
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
    if (tag.closing) {
      builder.generated(tag.name === "" ? "<>" : `<${tag.name}>`, tag.start);
    }
    let cursor = tag.start;
    for (const expressionId of tag.expressionIds) {
      const expression = expressionAt(expressions, expressionId);
      if (expression?.end === undefined) continue;
      const braceStart = expression.start - 1;
      const braceEnd = expression.end + 1;
      builder.authored(cursor, braceStart);
      const spread = expression.fragmentKind === "jsx-spread-attribute" &&
        expression.tokens[0]?.label === "...";
      builder.generated(spread ? "{...{}}" : "{null}", braceStart);
      cursor = braceEnd;
    }
    builder.authored(cursor, tag.end);
    if (!tag.closing && !tag.selfClosing) {
      builder.generated(tag.name === "" ? "</>" : `</${tag.name}>`, tag.end);
    }
    builder.generated(",", tag.end);
  }
  return builder.result();
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

function staticLiteralCandidate(expression: ExpressionRecord): boolean {
  const labels = expression.tokens.map((token) => token.label);
  let start = 0;
  let end = labels.length;
  while (labels[start] === "(" && labels[end - 1] === ")") {
    start++;
    end--;
  }
  const literalLabels = labels.slice(start, end);
  if (literalLabels.length === 1) return literalLabels[0] === "string";
  return literalLabels[0] === "`" &&
    literalLabels[literalLabels.length - 1] === "`" &&
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
  const end = delimiters[delimiters.length - 1]?.start;
  return start === undefined || end === undefined || end < start ? undefined : { start, end };
}

function hasTokens(fragment: string): boolean {
  const tokenizer = AcornJsxParser.tokenizer(fragment, {
    ecmaVersion: 2024,
    sourceType: "module",
  });
  return tokenizer.getToken().type.label !== "eof";
}

function embeddedLexicalProfile(source: string): {
  readonly contextualSlash: boolean;
} {
  const tokenizer = AcornJsxParser.tokenizer(source, {
    ecmaVersion: 2024,
    sourceType: "module",
  });
  let pendingSlash = false;
  let previousLabel: string | undefined;
  while (true) {
    const token = tokenizer.getToken();
    const label = token.type.label;
    if (pendingSlash) {
      if (label !== "jsxTagEnd") return { contextualSlash: true };
      pendingSlash = false;
    }
    if (label === "/" && previousLabel !== "jsxTagStart") {
      pendingSlash = true;
    }
    previousLabel = label;
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

async function validateFragment(
  fragment: ReducedFragment,
  prefix: string,
  suffix: string,
  fallbackOffset: number,
  absoluteStart: number,
  locator: SourceLocator,
  filePath: string | undefined,
): Promise<
  | { readonly kind: "valid"; readonly ast: ASTNode | undefined }
  | { readonly kind: "syntax-error"; readonly diagnostic: ContentSyntaxDiagnostic }
> {
  if (fragment.value.length > MAX_EMBEDDED_CODE_UNITS) {
    return {
      kind: "syntax-error",
      diagnostic: diagnostic(
        locator,
        absoluteStart,
        fallbackOffset,
        `Embedded code exceeds the ${MAX_EMBEDDED_CODE_UNITS}-unit parser limit`,
      ),
    };
  }

  try {
    if (!hasTokens(fragment.value)) return { kind: "valid", ast: undefined };
    const ast = await babelParser.parse({
      code: `${prefix}${fragment.value}${suffix}`,
      filePath: filePath ?? "content.mdx",
      decoratorMode: "current",
      syntax: "javascript",
    });
    return { kind: "valid", ast };
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
  const expressions: ExpressionRecord[] = [{
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
  const modes: ParseMode[] = [{ kind: "expression", expressionId: 0 }];
  const elements: ElementFrame[] = [];
  const tags: JsxTagRecord[] = [];
  const destinations: ContentDestination[] = [];
  const reducedBuilder = reducedSourceBuilder(options.source);
  const sourceCursor = { value: 0 };
  let activeExpressionId = 0;
  let reductionGroupDepth = 0;

  try {
    const profile = embeddedLexicalProfile(options.source);
    const contextualTokens = profile.contextualSlash ? grammarTokens(options.source) : undefined;
    let tokenIndex = 0;
    const tokenizer = contextualTokens === undefined
      ? AcornJsxParser.tokenizer(options.source, {
        ecmaVersion: 2024,
        sourceType: "module",
        locations: true,
      })
      : undefined;
    while (true) {
      const token = contextualTokens?.[tokenIndex++] ?? tokenizer!.getToken();
      const label = "label" in token ? token.label : token.type.label;
      const mode = currentMode(modes);
      if (mode === undefined) {
        return {
          kind: "syntax-error",
          diagnostic: diagnostic(
            options.locator,
            options.absoluteStart,
            token.start,
            "Unexpected token after embedded expression",
          ),
        };
      }

      if (label === "eof") {
        const root = expressionAt(expressions, 0);
        if (
          modes.length !== 1 || mode.kind !== "expression" ||
          mode.expressionId !== 0 || elements.length !== 0 ||
          root === undefined || root.braceDepth !== 0
        ) {
          return {
            kind: "syntax-error",
            diagnostic: diagnostic(
              options.locator,
              options.absoluteStart,
              token.start,
              "Unexpected end of embedded JSX expression",
            ),
          };
        }
        root.end = token.start;
        appendAuthoredThrough(reducedBuilder, sourceCursor, token.start);
        break;
      }

      if (mode.kind === "expression") {
        const expression = expressionAt(expressions, mode.expressionId);
        if (expression === undefined) throw new TypeError("Missing expression state");
        if (
          expression.fragmentKind === "jsx-spread-attribute" &&
          expression.tokens.length === 0 && label === "..."
        ) {
          appendAuthoredThrough(reducedBuilder, sourceCursor, token.start);
          discardThrough(sourceCursor, token.end);
          expression.tokens.push({ label, start: token.start, end: token.end });
          continue;
        }
        if (label === "jsxTagStart") {
          const ownsReductionGroup = reductionGroupDepth === 0 || expression.tokens.length > 0;
          if (ownsReductionGroup) reductionGroupDepth++;
          appendAuthoredThrough(reducedBuilder, sourceCursor, token.start);
          discardThrough(sourceCursor, token.end);
          modes.push({
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
            awaitingAttributeName: undefined,
            expressionIds: [],
          });
          continue;
        }
        if (label === "{" || label === "${") {
          expression.braceDepth++;
          expression.tokens.push({ label, start: token.start, end: token.end });
          appendAuthoredThrough(reducedBuilder, sourceCursor, token.end);
          continue;
        }
        if (label === "}") {
          if (expression.braceDepth > 0) {
            expression.braceDepth--;
            expression.tokens.push({ label, start: token.start, end: token.end });
            appendAuthoredThrough(reducedBuilder, sourceCursor, token.end);
            continue;
          }
          if (expression.root) {
            return {
              kind: "syntax-error",
              diagnostic: diagnostic(
                options.locator,
                options.absoluteStart,
                token.start,
                "Unexpected closing brace in embedded expression",
              ),
            };
          }
          appendAuthoredThrough(reducedBuilder, sourceCursor, token.start);
          reducedBuilder.generated(",", token.start);
          discardThrough(sourceCursor, token.end);
          expression.end = token.start;
          modes.pop();
          activeExpressionId = expression.parentId ?? 0;
          continue;
        }
        expression.tokens.push({ label, start: token.start, end: token.end });
        appendAuthoredThrough(reducedBuilder, sourceCursor, token.end);
        continue;
      }

      if (mode.kind === "jsx-children") {
        if (label === "jsxTagStart") {
          discardThrough(sourceCursor, token.end);
          modes.push({
            kind: "jsx-tag",
            start: token.start,
            expectedNameOffset: token.end,
            name: "",
            nameComplete: false,
            closing: false,
            selfClosing: false,
            ownsReductionGroup: false,
            reductionOpened: false,
            pendingAttributeName: undefined,
            awaitingAttributeName: undefined,
            expressionIds: [],
          });
        } else if (label === "{") {
          discardThrough(sourceCursor, token.end);
          activeExpressionId = beginExpression(
            expressions,
            modes,
            activeExpressionId,
            token.end,
            undefined,
            "expression",
          );
        } else {
          discardThrough(sourceCursor, token.end);
        }
        continue;
      }

      discardThrough(sourceCursor, token.end);
      if (!mode.nameComplete && token.start > mode.expectedNameOffset) {
        mode.nameComplete = true;
      }
      if (
        label === "/" && mode.name === "" && !mode.nameComplete &&
        token.start === mode.expectedNameOffset
      ) {
        mode.closing = true;
        mode.expectedNameOffset = token.end;
        continue;
      }
      if (
        !mode.nameComplete &&
        (label === "jsxName" || label === "." || label === ":")
      ) {
        mode.name += options.source.slice(token.start, token.end);
        mode.expectedNameOffset = token.end;
        continue;
      }
      if (!mode.closing && mode.ownsReductionGroup && !mode.reductionOpened) {
        reducedBuilder.generated("(", mode.start);
        mode.reductionOpened = true;
      }
      mode.nameComplete = true;
      if (label === "jsxName") {
        mode.pendingAttributeName = options.source.slice(token.start, token.end);
        mode.awaitingAttributeName = undefined;
        continue;
      }
      if (label === "=" && mode.pendingAttributeName !== undefined) {
        mode.awaitingAttributeName = mode.pendingAttributeName;
        mode.pendingAttributeName = undefined;
        continue;
      }
      if (label === "string") {
        if (isDestinationAttribute(mode.awaitingAttributeName)) {
          destinations.push(
            jsxQuotedDestination(
              options.source,
              { start: token.start + 1, end: token.end - 1 },
              options.absoluteStart,
              options.locator,
            ),
          );
        }
        mode.awaitingAttributeName = undefined;
        continue;
      }
      if (label === "{") {
        const attributeName = mode.awaitingAttributeName;
        mode.awaitingAttributeName = undefined;
        const expressionId = beginExpression(
          expressions,
          modes,
          activeExpressionId,
          token.end,
          attributeName,
          attributeName === undefined ? "jsx-spread-attribute" : "expression",
        );
        mode.expressionIds.push(expressionId);
        activeExpressionId = expressionId;
        continue;
      }
      if (label === "/") {
        mode.selfClosing = true;
        continue;
      }
      if (label !== "jsxTagEnd") continue;

      tags.push({
        start: mode.start,
        end: token.end,
        name: mode.name,
        closing: mode.closing,
        selfClosing: mode.selfClosing,
        expressionIds: mode.expressionIds,
      });
      modes.pop();
      if (mode.closing) {
        const element = elements.pop();
        const children = currentMode(modes);
        if (
          element === undefined || children?.kind !== "jsx-children" ||
          element.name !== mode.name
        ) {
          return {
            kind: "syntax-error",
            diagnostic: diagnostic(
              options.locator,
              options.absoluteStart,
              mode.start,
              `Unexpected closing JSX tag </${mode.name}>`,
            ),
          };
        }
        modes.pop();
        reducedBuilder.generated(
          element.ownsReductionGroup
            ? "null)"
            : currentMode(modes)?.kind === "jsx-children"
            ? "null,"
            : "null",
          token.start,
        );
        if (element.ownsReductionGroup) reductionGroupDepth--;
        continue;
      }

      if (mode.selfClosing) {
        reducedBuilder.generated(
          mode.ownsReductionGroup
            ? "null)"
            : currentMode(modes)?.kind === "jsx-children"
            ? "null,"
            : "null",
          token.start,
        );
        if (mode.ownsReductionGroup) reductionGroupDepth--;
        continue;
      }
      elements.push({ name: mode.name, ownsReductionGroup: mode.ownsReductionGroup });
      modes.push({ kind: "jsx-children" });
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof RangeError)) {
      throw error;
    }
    const position = own(error, "pos");
    return {
      kind: "syntax-error",
      diagnostic: diagnostic(
        options.locator,
        options.absoluteStart,
        typeof position === "number" ? position : 0,
        error instanceof RangeError
          ? "Tokenizer capacity exceeded for embedded code"
          : parserMessage(error),
      ),
    };
  }

  const tagBatchSize = 512;
  for (let start = 0; start < tags.length; start += tagBatchSize) {
    const batch = tags.slice(start, start + tagBatchSize);
    const tagFragment = tagValidationFragment(options.source, expressions, batch);
    const tagValidation = await validateFragment(
      tagFragment,
      "const __veryfront_tags = [",
      "\n];",
      batch[0]?.start ?? 0,
      options.absoluteStart,
      options.locator,
      options.filePath,
    );
    if (tagValidation.kind === "syntax-error") return tagValidation;
  }

  const rootValidation = await validateFragment(
    reducedBuilder.result(),
    "const __veryfront_value = (",
    "\n);",
    expressionAt(expressions, 0)?.end ?? 0,
    options.absoluteStart,
    options.locator,
    options.filePath,
  );
  if (rootValidation.kind === "syntax-error") return rootValidation;

  let staticDestination: ContentDestination | undefined;
  for (const expression of expressions) {
    const literal = await decodeStaticLiteral(
      options.source,
      expression,
      options.filePath,
    );
    if (
      literal !== undefined &&
      isDestinationAttribute(expression.attributeName)
    ) {
      const destination = jsxLiteralDestination(
        options.source,
        literal.span,
        options.absoluteStart,
        options.locator,
        literal.syntax,
        literal.cookedValue,
      );
      if (expression.id === 0) staticDestination = destination;
      else destinations.push(destination);
    }
  }

  destinations.sort((left, right) => left.range.start.offset - right.range.start.offset);
  return { kind: "valid", destinations, staticDestination };
}
