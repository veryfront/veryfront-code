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
  braceDepth: number;
  readonly jsxRanges: Span[];
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
  readonly containerExpressionId: number;
  expectedNameOffset: number;
  name: string;
  nameComplete: boolean;
  closing: boolean;
  selfClosing: boolean;
  pendingAttributeName: string | undefined;
  awaitingAttributeName: string | undefined;
}

type ParseMode = ExpressionMode | JsxChildrenMode | JsxTagMode;

interface ElementFrame {
  readonly start: number;
  readonly name: string;
  readonly containerExpressionId: number;
  readonly direct: boolean;
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
): number {
  const id = expressions.length;
  expressions.push({
    id,
    parentId: activeExpressionId,
    start,
    end: undefined,
    root: false,
    attributeName,
    braceDepth: 0,
    jsxRanges: [],
    tokens: [],
  });
  modes.push({ kind: "expression", expressionId: id });
  return id;
}

function reducedFragment(
  source: string,
  expression: ExpressionRecord,
): ReducedFragment {
  const ranges = [...expression.jsxRanges].sort((left, right) => left.start - right.start);
  const end = expression.end ?? expression.start;
  const parts: string[] = [];
  const segments: ReducedSegment[] = [];
  let cursor = expression.start;
  let reducedOffset = 0;
  for (const range of ranges) {
    if (range.start < cursor || range.end > end) continue;
    const authored = source.slice(cursor, range.start);
    parts.push(authored);
    if (authored.length > 0) {
      segments.push({
        reducedStart: reducedOffset,
        reducedEnd: reducedOffset + authored.length,
        sourceStart: cursor,
        replacement: false,
      });
      reducedOffset += authored.length;
    }
    parts.push("null");
    segments.push({
      reducedStart: reducedOffset,
      reducedEnd: reducedOffset + 4,
      sourceStart: range.start,
      replacement: true,
    });
    reducedOffset += 4;
    cursor = range.end;
  }
  const tail = source.slice(cursor, end);
  parts.push(tail);
  if (tail.length > 0) {
    segments.push({
      reducedStart: reducedOffset,
      reducedEnd: reducedOffset + tail.length,
      sourceStart: cursor,
      replacement: false,
    });
  }
  return { value: parts.join(""), segments };
}

function authoredOffsetAt(
  fragment: ReducedFragment,
  reducedOffset: number,
  expression: ExpressionRecord,
): number {
  const offset = Math.max(0, Math.min(reducedOffset, fragment.value.length));
  for (const segment of fragment.segments) {
    if (offset >= segment.reducedEnd) continue;
    if (offset < segment.reducedStart) return segment.sourceStart;
    if (segment.replacement) return segment.sourceStart;
    return segment.sourceStart + offset - segment.reducedStart;
  }
  return expression.end ?? expression.start;
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

async function validateRecord(
  source: string,
  expression: ExpressionRecord,
  absoluteStart: number,
  locator: SourceLocator,
  filePath: string | undefined,
  fragmentKind: "expression" | "jsx-spread-attribute",
): Promise<
  | {
    readonly kind: "valid";
    readonly literal:
      | {
        readonly span: Span;
        readonly syntax: "javascript-string" | "javascript-template";
        readonly cookedValue: string;
      }
      | undefined;
  }
  | { readonly kind: "syntax-error"; readonly diagnostic: ContentSyntaxDiagnostic }
> {
  const fragment = reducedFragment(source, expression);
  if (fragment.value.length > MAX_EMBEDDED_CODE_UNITS) {
    return {
      kind: "syntax-error",
      diagnostic: diagnostic(
        locator,
        absoluteStart,
        expression.start,
        `Embedded code exceeds the ${MAX_EMBEDDED_CODE_UNITS}-unit parser limit`,
      ),
    };
  }

  const spreadRoot = expression.root && fragmentKind === "jsx-spread-attribute";
  const prefix = spreadRoot ? "const __veryfront_value = ({" : "const __veryfront_value = (";
  const suffix = spreadRoot ? "\n});" : "\n);";
  try {
    if (!hasTokens(fragment.value)) return { kind: "valid", literal: undefined };
    const ast = await babelParser.parse({
      code: `${prefix}${fragment.value}${suffix}`,
      filePath: filePath ?? "content.mdx",
      decoratorMode: "current",
      syntax: "javascript",
    });
    const literal = staticLiteral(ast);
    if (literal === undefined) return { kind: "valid", literal: undefined };
    const span = literalRange(expression, literal.kind);
    if (span === undefined) {
      throw new TypeError("Acorn did not locate the Babel static literal");
    }
    return {
      kind: "valid",
      literal: {
        span,
        syntax: literal.kind === "string" ? "javascript-string" : "javascript-template",
        cookedValue: literal.cookedValue,
      },
    };
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
            expression,
          )
          : expression.start,
        error instanceof RangeError
          ? "Parser capacity exceeded for embedded code"
          : parserMessage(error),
      ),
    };
  }
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
    braceDepth: 0,
    jsxRanges: [],
    tokens: [],
  }];
  const modes: ParseMode[] = [{ kind: "expression", expressionId: 0 }];
  const elements: ElementFrame[] = [];
  const elementDepth = new Map<number, number>();
  const closedExpressions: number[] = [];
  const destinations: ContentDestination[] = [];
  let activeExpressionId = 0;

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
        closedExpressions.push(root.id);
        break;
      }

      if (mode.kind === "expression") {
        const expression = expressionAt(expressions, mode.expressionId);
        if (expression === undefined) throw new TypeError("Missing expression state");
        if (label === "jsxTagStart") {
          modes.push({
            kind: "jsx-tag",
            start: token.start,
            containerExpressionId: activeExpressionId,
            expectedNameOffset: token.end,
            name: "",
            nameComplete: false,
            closing: false,
            selfClosing: false,
            pendingAttributeName: undefined,
            awaitingAttributeName: undefined,
          });
          continue;
        }
        if (label === "{" || label === "${") {
          expression.braceDepth++;
          expression.tokens.push({ label, start: token.start, end: token.end });
          continue;
        }
        if (label === "}") {
          if (expression.braceDepth > 0) {
            expression.braceDepth--;
            expression.tokens.push({ label, start: token.start, end: token.end });
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
          expression.end = token.start;
          closedExpressions.push(expression.id);
          modes.pop();
          activeExpressionId = expression.parentId ?? 0;
          continue;
        }
        expression.tokens.push({ label, start: token.start, end: token.end });
        continue;
      }

      if (mode.kind === "jsx-children") {
        if (label === "jsxTagStart") {
          modes.push({
            kind: "jsx-tag",
            start: token.start,
            containerExpressionId: activeExpressionId,
            expectedNameOffset: token.end,
            name: "",
            nameComplete: false,
            closing: false,
            selfClosing: false,
            pendingAttributeName: undefined,
            awaitingAttributeName: undefined,
          });
        } else if (label === "{") {
          activeExpressionId = beginExpression(
            expressions,
            modes,
            activeExpressionId,
            token.end,
            undefined,
          );
        }
        continue;
      }

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
        activeExpressionId = beginExpression(
          expressions,
          modes,
          activeExpressionId,
          token.end,
          attributeName,
        );
        continue;
      }
      if (label === "/") {
        mode.selfClosing = true;
        continue;
      }
      if (label !== "jsxTagEnd") continue;

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
        const depth = Math.max(
          0,
          (elementDepth.get(element.containerExpressionId) ?? 1) - 1,
        );
        elementDepth.set(element.containerExpressionId, depth);
        if (element.direct) {
          expressionAt(expressions, element.containerExpressionId)?.jsxRanges
            .push({ start: element.start, end: token.end });
        }
        continue;
      }

      const depth = elementDepth.get(mode.containerExpressionId) ?? 0;
      if (mode.selfClosing) {
        if (depth === 0) {
          expressionAt(expressions, mode.containerExpressionId)?.jsxRanges.push({
            start: mode.start,
            end: token.end,
          });
        }
        continue;
      }
      elements.push({
        start: mode.start,
        name: mode.name,
        containerExpressionId: mode.containerExpressionId,
        direct: depth === 0,
      });
      elementDepth.set(mode.containerExpressionId, depth + 1);
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

  let staticDestination: ContentDestination | undefined;
  for (const id of closedExpressions) {
    const expression = expressionAt(expressions, id);
    if (expression === undefined) throw new TypeError("Missing closed expression");
    const validation = await validateRecord(
      options.source,
      expression,
      options.absoluteStart,
      options.locator,
      options.filePath,
      options.fragmentKind ?? "expression",
    );
    if (validation.kind === "syntax-error") return validation;
    if (
      validation.literal !== undefined &&
      isDestinationAttribute(expression.attributeName)
    ) {
      const destination = jsxLiteralDestination(
        options.source,
        validation.literal.span,
        options.absoluteStart,
        options.locator,
        validation.literal.syntax,
        validation.literal.cookedValue,
      );
      if (expression.id === 0) staticDestination = destination;
      else destinations.push(destination);
    }
  }

  destinations.sort((left, right) => left.range.start.offset - right.range.start.offset);
  return { kind: "valid", destinations, staticDestination };
}
