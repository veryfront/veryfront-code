/**
 * Import resolution and extraction utilities
 */

import { existsSync } from "#veryfront/platform/compat/std/fs.ts";
import { dirname, join, resolve } from "#veryfront/compat/path/index.ts";

interface ModuleSpecifierMatch {
  readonly path: string;
  readonly start: number;
  readonly end: number;
}

interface ModuleSpecifierOwner {
  readonly name: string;
  readonly start: number;
}

function maskRange(characters: string[], start: number, end: number): void {
  for (let index = start; index < end; index++) {
    if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
  }
}

interface MdxExpressionState {
  depth: number;
  quote?: string;
  inBlockComment: boolean;
  inJsxTag: boolean;
  jsxQuote?: string;
  canStartRegexAtLineStart: boolean;
  lineStartFollowsArrow: boolean;
  lineStartFollowsClassExpression: boolean;
  lineStartRequiresExpression: boolean;
  pendingControlFlowCondition: boolean;
  readonly controlFlowParentheses: boolean[];
  readonly statementBlocks: JavaScriptBlockContext[];
  readonly templateExpressionDepths: number[];
}

function isControlFlowConditionOpen(line: string, openIndex: number): boolean {
  let cursor = openIndex - 1;
  while (cursor >= 0) {
    while (cursor >= 0 && /\s/.test(line[cursor]!)) cursor--;
    if (line[cursor] !== "/" || line[cursor - 1] !== "*") break;
    const commentOpen = line.lastIndexOf("/*", cursor - 2);
    if (commentOpen < 0) break;
    cursor = commentOpen - 1;
  }
  const wordEnd = cursor + 1;
  while (cursor >= 0 && /[\w$]/.test(line[cursor]!)) cursor--;
  const word = line.slice(cursor + 1, wordEnd);
  return isControlFlowKeyword(word);
}

function isControlFlowKeyword(word: string): boolean {
  return word === "if" || word === "for" || word === "while" || word === "with";
}

function endsWithControlFlowKeyword(line: string, endIndex: number): boolean {
  const word = precedingWord(line, endIndex);
  if (!isControlFlowKeyword(word)) return false;
  const wordStart = endIndex - word.length + 1;
  const previousIndex = previousSignificantIndex(line, wordStart);
  return line[previousIndex] !== ".";
}

interface DelimiterCloseIndexes {
  readonly controlFlow: ReadonlySet<number>;
  readonly statementBlocks: ReadonlySet<number>;
}

interface JavaScriptBlockContext {
  readonly allowsStatements: boolean;
  readonly closeStartsRegex: boolean;
}

function delimiterCloseIndexes( // NOSONAR: scanner state must stay synchronized in one pass.
  line: string,
  pendingControlFlowCondition = false,
  lineStartRequiresExpression = false,
  lineStartFollowsArrow = false,
  lineStartFollowsClassExpression = false,
): DelimiterCloseIndexes {
  const parentheses: Array<{ controlFlow: boolean }> = [];
  const blocks: JavaScriptBlockContext[] = [];
  const controlFlowCloses = new Set<number>();
  const statementBlockCloses = new Set<number>();
  let quote: string | undefined;
  let inBlockComment = false;
  let lastDivisionSlashIndex = -1;
  for (let index = 0; index < line.length; index++) {
    const current = line[index]!;
    const next = line[index + 1];
    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (current === "\\") index++;
      else if (current === quote) quote = undefined;
      continue;
    }
    if (current === "/" && next === "/") break;
    if (current === "/" && next === "*") {
      inBlockComment = true;
      index++;
      continue;
    }
    if (current === "/") {
      const followsDivision = lastDivisionSlashIndex >= 0 &&
        previousSignificantIndex(line, index) === lastDivisionSlashIndex;
      const regexEnd = findRegexLiteralEnd(
        line,
        index,
        {
          controlFlowCloses,
          statementBlockCloses,
          canStartAtLineStart: true,
        },
        followsDivision,
      );
      if (regexEnd >= 0) {
        lastDivisionSlashIndex = -1;
        index = regexEnd; // NOSONAR: scanner jumps over one complete regex literal.
        continue;
      }
      lastDivisionSlashIndex = index;
    }
    if (current === '"' || current === "'" || current === "`") {
      quote = current;
      continue;
    }
    if (current === "(") {
      const carriedControlFlow = pendingControlFlowCondition &&
        previousSignificantIndex(line, index) < 0;
      parentheses.push({
        controlFlow: carriedControlFlow || isControlFlowConditionOpen(line, index),
      });
      continue;
    }
    if (current === ")") {
      const open = parentheses.pop();
      if (open?.controlFlow) controlFlowCloses.add(index);
      continue;
    }
    if (current === "{") {
      blocks.push(
        javascriptBlockContext(
          line,
          index,
          blocks,
          lineStartRequiresExpression,
          lineStartFollowsArrow,
          lineStartFollowsClassExpression,
        ),
      );
      continue;
    }
    if (current === "}" && blocks.pop()?.closeStartsRegex) statementBlockCloses.add(index);
  }
  return { controlFlow: controlFlowCloses, statementBlocks: statementBlockCloses };
}

function javascriptBlockContext(
  line: string,
  openIndex: number,
  enclosingBlocks: readonly JavaScriptBlockContext[] = [],
  lineStartRequiresExpression = false,
  lineStartFollowsArrow = false,
  lineStartFollowsClassExpression = false,
): JavaScriptBlockContext {
  const previousIndex = previousJavaScriptTokenIndex(line, openIndex);
  const previous = line[previousIndex];
  const word = previousIndex < 0 ? "" : precedingWord(line, previousIndex);
  const classBody = /\bclass(?:\s+[A-Za-z_$][\w$]*)?(?:\s+extends\s+[^{}]+)?\s*$/.test( // NOSONAR: bounded parser heuristic.
    line.slice(0, openIndex),
  ) || (previousIndex < 0 && lineStartFollowsClassExpression);
  const classExpressionBody = classBody &&
    !/(?:^|[;{}])\s*(?:export\s+(?:default\s+)?)?class(?:\s+[A-Za-z_$][\w$]*)?(?:\s+extends\s+[^{}]+)?\s*$/ // NOSONAR: bounded parser heuristic.
      .test(line.slice(0, openIndex));
  const statementLabelBlock = /(?:^|[;{}])\s*[A-Za-z_$][\w$]*\s*:\s*$/.test( // NOSONAR: bounded parser heuristic.
    line.slice(0, openIndex),
  );
  const caseClauseBlock = /(?:^|[;{}])\s*(?:case\b[^:]*|default)\s*:\s*$/.test( // NOSONAR: bounded parser heuristic.
    line.slice(0, openIndex),
  );
  const labeledBlock = previous === ":" &&
    enclosingBlocks.at(-1)?.allowsStatements !== false &&
    (statementLabelBlock || caseClauseBlock);
  // Callable bodies contain statements, but their closing brace is still an
  // expression operand. A following slash therefore means division, unlike a
  // slash after an if/loop/declaration block where a new regex can begin.
  const functionExpressionBody = previous === ")" &&
    /(?:^|[^\w$])(?:async\s+)?function\s*\*?(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*$/.test( // NOSONAR: bounded parser heuristic.
      line.slice(0, openIndex),
    ) &&
    !/(?:^|[;{}])\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*$/ // NOSONAR: bounded parser heuristic.
      .test(
        line.slice(0, openIndex),
      );
  const callableExpressionBody = functionExpressionBody ||
    (previous === ">" && line[previousIndex - 1] === "=") ||
    (previousIndex < 0 && lineStartFollowsArrow);
  const expressionBody = callableExpressionBody || classExpressionBody;
  const statementBody = (previousIndex < 0 && !lineStartRequiresExpression) || previous === ")" ||
    previous === ";" ||
    (classBody && !classExpressionBody) || labeledBlock || word === "catch" || word === "class" ||
    word === "do" || word === "else" || word === "finally" || word === "static" || word === "try";
  return {
    allowsStatements: statementBody || callableExpressionBody,
    closeStartsRegex: statementBody && !expressionBody,
  };
}

interface RegexLineContext {
  readonly controlFlowCloses: ReadonlySet<number>;
  readonly statementBlockCloses: ReadonlySet<number>;
  readonly canStartAtLineStart: boolean;
}

function regexLineContext(
  line: string,
  canStartAtLineStart = true,
  pendingControlFlowCondition = false,
  lineStartRequiresExpression = false,
  lineStartFollowsArrow = false,
  lineStartFollowsClassExpression = false,
): RegexLineContext {
  const closes = delimiterCloseIndexes(
    line,
    pendingControlFlowCondition,
    lineStartRequiresExpression,
    lineStartFollowsArrow,
    lineStartFollowsClassExpression,
  );
  return {
    controlFlowCloses: closes.controlFlow,
    statementBlockCloses: closes.statementBlocks,
    canStartAtLineStart,
  };
}

function previousSignificantIndex(line: ArrayLike<string>, before: number): number {
  let index = before - 1;
  while (index >= 0 && /\s/.test(line[index]!)) index--;
  return index;
}

function previousJavaScriptTokenIndex(line: string, before: number): number {
  let index = previousSignificantIndex(line, before);
  while (index > 0 && line[index] === "/" && line[index - 1] === "*") {
    const commentOpen = line.lastIndexOf("/*", index - 2);
    if (commentOpen < 0) return -1;
    index = previousSignificantIndex(line, commentOpen);
  }
  return index;
}

function requiresExpressionAfter(line: ArrayLike<string>, endIndex: number): boolean {
  const previous = line[endIndex];
  if (!previous) return false;
  if (previous === ">" && line[endIndex - 1] === "=") return false;
  if (
    (previous === "+" || previous === "-") && line[endIndex - 1] === previous
  ) {
    return false;
  }
  // A trailing slash may be either division or the end of a regex literal;
  // callers track division separately, so do not infer it from this character.
  if ("([=,!?&|+-*%^~<>".includes(previous)) return true;
  if (
    previous === "." && line[endIndex - 1] === "." && line[endIndex - 2] === "."
  ) {
    return true;
  }
  let wordStart = endIndex;
  while (wordStart >= 0 && /[\w$]/.test(line[wordStart]!)) wordStart--;
  let word = "";
  for (let index = wordStart + 1; index <= endIndex; index++) word += line[index];
  return word === "await" || word === "delete" || word === "extends" || word === "in" ||
    word === "instanceof" || word === "new" || word === "of" || word === "typeof" ||
    word === "void" || word === "class";
}

function endsWithArrow(line: ArrayLike<string>, endIndex: number): boolean {
  return line[endIndex] === ">" && line[endIndex - 1] === "=";
}

function endsWithClassExpression(line: string, endIndex: number): boolean {
  const prefix = line.slice(0, endIndex + 1);
  return /\bclass(?:\s+[A-Za-z_$][\w$]*)?(?:\s+extends\s+[^{}]+)?\s*$/.test(prefix) &&
    !/(?:^|[;{}])\s*(?:export\s+(?:default\s+)?)?class(?:\s+[A-Za-z_$][\w$]*)?(?:\s+extends\s+[^{}]+)?\s*$/
      .test(prefix);
}

function precedingWord(line: string, endIndex: number): string {
  let start = endIndex;
  while (start >= 0 && /[\w$]/.test(line[start]!)) start--;
  return line.slice(start + 1, endIndex + 1);
}

function canStartRegexLiteral(
  line: string,
  slashIndex: number,
  context: RegexLineContext,
): boolean {
  const previousIndex = previousJavaScriptTokenIndex(line, slashIndex);
  if (previousIndex < 0) return context.canStartAtLineStart;
  const previous = line[previousIndex]!;
  if (
    (previous === "+" || previous === "-") &&
    line[previousIndex - 1] === previous
  ) {
    return false;
  }
  if (previous === "." && line.slice(previousIndex - 2, previousIndex + 1) === "...") return true;
  if ("([{=,:;!?&|+-*%^~<>".includes(previous)) return true;
  if (previous === ")" && context.controlFlowCloses.has(previousIndex)) return true;
  if (previous === "}" && context.statementBlockCloses.has(previousIndex)) return true;
  const word = precedingWord(line, previousIndex);
  const wordStart = previousIndex - word.length + 1;
  if (line[previousSignificantIndex(line, wordStart)] === ".") return false;
  return word === "await" || word === "break" || word === "case" || word === "continue" ||
    word === "debugger" || word === "default" || word === "delete" || word === "do" ||
    word === "else" || word === "extends" || word === "in" || word === "instanceof" ||
    word === "new" || word === "of" || word === "return" || word === "throw" ||
    word === "typeof" || word === "void" || word === "yield";
}

function findRegexLiteralEnd(
  line: string,
  slashIndex: number,
  context = regexLineContext(line),
  forceCanStart = false,
): number {
  if (!forceCanStart && !canStartRegexLiteral(line, slashIndex, context)) return -1;
  let inCharacterClass = false;
  for (let index = slashIndex + 1; index < line.length; index++) {
    const current = line[index]!;
    if (current === "\\") {
      index++;
      continue;
    }
    if (current === "[") {
      inCharacterClass = true;
      continue;
    }
    if (current === "]") {
      inCharacterClass = false;
      continue;
    }
    if (current !== "/" || inCharacterClass) continue;
    while (/[A-Za-z]/.test(line[index + 1] ?? "")) index++;
    return index;
  }
  return -1;
}

function findRegexLiteralEndAt(
  code: string,
  slashIndex: number,
  contextCache: Map<number, RegexLineContext>,
  contextCharacters: readonly string[],
  forceCanStart = false,
): number {
  const lineStart = code.lastIndexOf("\n", slashIndex - 1) + 1;
  const nextLine = code.indexOf("\n", slashIndex);
  const lineEnd = nextLine < 0 ? code.length : nextLine;
  const line = code.slice(lineStart, lineEnd);
  let context = contextCache.get(lineStart);
  if (!context) {
    const previousIndex = previousSignificantIndex(contextCharacters, lineStart);
    let canStartAtLineStart = true;
    let lineStartRequiresExpression = false;
    let lineStartFollowsArrow = false;
    let lineStartFollowsClassExpression = false;
    if (previousIndex >= 0) {
      const previousLineStart = code.lastIndexOf("\n", previousIndex - 1) + 1;
      const previousLineEndIndex = code.indexOf("\n", previousIndex);
      const previousLineEnd = previousLineEndIndex < 0 ? code.length : previousLineEndIndex;
      const previousLine = contextCharacters.slice(previousLineStart, previousLineEnd).join("");
      const previousLineIndex = previousIndex - previousLineStart;
      canStartAtLineStart = canStartRegexLiteral(
        previousLine,
        previousLineIndex + 1,
        regexLineContext(
          previousLine,
          true,
          hasControlFlowKeywordBefore(contextCharacters, previousLineStart),
        ),
      );
      lineStartRequiresExpression = requiresExpressionAfter(
        previousLine,
        previousLineIndex,
      );
      lineStartFollowsArrow = endsWithArrow(previousLine, previousLineIndex);
      lineStartFollowsClassExpression = endsWithClassExpression(previousLine, previousLineIndex);
    }
    context = regexLineContext(
      line,
      canStartAtLineStart,
      hasControlFlowKeywordBefore(contextCharacters, lineStart),
      lineStartRequiresExpression,
      lineStartFollowsArrow,
      lineStartFollowsClassExpression,
    );
    contextCache.set(lineStart, context);
  }
  const regexEnd = findRegexLiteralEnd(
    line,
    slashIndex - lineStart,
    context,
    forceCanStart,
  );
  return regexEnd < 0 ? -1 : lineStart + regexEnd;
}

function scanMdxExpressionLine( // NOSONAR: line scanner coordinates MDX expression, JSX, quote, and regex state.
  line: string,
  state: MdxExpressionState,
  markExpressionCharacter?: (index: number) => void,
  markJsxTagCharacter?: (index: number) => void,
): void {
  const controlFlowCloses = new Set<number>();
  const statementBlockCloses = new Set<number>();
  const regexContext: RegexLineContext = {
    controlFlowCloses,
    statementBlockCloses,
    canStartAtLineStart: state.canStartRegexAtLineStart,
  };
  let escapedLineContinuation = false;
  let lastSignificantIndex = -1;
  let lastDivisionSlashIndex = -1;
  for (let index = 0; index < line.length; index++) {
    const current = line[index]!;
    const next = line[index + 1];
    if (state.depth === 0) {
      if (state.jsxQuote) {
        markJsxTagCharacter?.(index);
        if (current === state.jsxQuote) state.jsxQuote = undefined;
        continue;
      }
      if (
        !state.inJsxTag && current === "<" && /[A-Za-z/>]/.test(next ?? "")
      ) {
        state.inJsxTag = true;
        markJsxTagCharacter?.(index);
        continue;
      }
      if (state.inJsxTag) markJsxTagCharacter?.(index);
      if (state.inJsxTag && (current === '"' || current === "'")) {
        state.jsxQuote = current;
        continue;
      }
      if (state.inJsxTag && current === ">") {
        state.inJsxTag = false;
        continue;
      }
      if (current === "`" && !state.inJsxTag && !isEscapedCharacter(line, index)) {
        let delimiterEnd = index + 1;
        while (line[delimiterEnd] === "`") delimiterEnd++;
        const closingEnd = findClosingBacktickRun(line, delimiterEnd, delimiterEnd - index);
        if (closingEnd >= 0) {
          index = closingEnd - 1;
          continue;
        }
        index = delimiterEnd - 1;
        continue;
      }
      if (current !== "{" || isEscapedCharacter(line, index)) continue;
      state.depth = 1;
      markExpressionCharacter?.(index);
      continue;
    }
    markExpressionCharacter?.(index);
    if (state.inBlockComment) {
      if (current === "*" && next === "/") {
        state.inBlockComment = false;
        index++; // NOSONAR: scanner consumes the escaped character with its escape.
      }
      continue;
    }
    if (state.quote) {
      if (current === "\\") {
        if (index === line.length - 1) escapedLineContinuation = true;
        index++; // NOSONAR: scanner consumes template-expression open as a pair.
      } else if (state.quote === "`" && current === "$" && next === "{") {
        markExpressionCharacter?.(index + 1);
        state.quote = undefined;
        state.depth++;
        state.statementBlocks.push({ allowsStatements: false, closeStartsRegex: false });
        state.templateExpressionDepths.push(state.depth);
        index++;
      } else if (current === state.quote) {
        state.quote = undefined;
        lastSignificantIndex = index;
      }
      continue;
    }
    if (current === "/" && next === "/") break;
    if (current === "/" && next === "*") {
      state.inBlockComment = true;
      index++; // NOSONAR: scanner consumes block-comment open as a pair.
      continue;
    }
    if (current === "<" && /[A-Za-z/]/.test(next ?? "")) {
      state.inJsxTag = true;
      markJsxTagCharacter?.(index);
      continue;
    }
    if (state.inJsxTag) {
      markJsxTagCharacter?.(index);
      if (state.jsxQuote) {
        if (current === state.jsxQuote) state.jsxQuote = undefined;
        continue;
      }
      if (current === '"' || current === "'") {
        state.jsxQuote = current;
        continue;
      }
      if (current === ">") state.inJsxTag = false;
      continue;
    }
    if (current === "/") {
      const followsDivision = lastDivisionSlashIndex >= 0 &&
        previousSignificantIndex(line, index) === lastDivisionSlashIndex;
      const regexEnd = findRegexLiteralEnd(line, index, regexContext, followsDivision);
      if (regexEnd >= 0) {
        for (let cursor = index + 1; cursor <= regexEnd; cursor++) {
          markExpressionCharacter?.(cursor);
        }
        lastSignificantIndex = regexEnd;
        lastDivisionSlashIndex = -1;
        index = regexEnd; // NOSONAR: scanner jumps over one complete regex literal.
        continue;
      }
      lastDivisionSlashIndex = index;
    }
    if (current === '"' || current === "'" || current === "`") {
      state.quote = current;
      lastSignificantIndex = index;
      continue;
    }
    if (current === "(") {
      const carriedControlFlow = state.pendingControlFlowCondition &&
        previousSignificantIndex(line, index) < 0;
      state.controlFlowParentheses.push(
        carriedControlFlow || isControlFlowConditionOpen(line, index),
      );
    } else if (current === ")") {
      if (state.controlFlowParentheses.pop()) controlFlowCloses.add(index);
    }
    if (current === "{") {
      state.depth++;
      state.statementBlocks.push(
        javascriptBlockContext(
          line,
          index,
          state.statementBlocks,
          state.lineStartRequiresExpression,
          state.lineStartFollowsArrow,
          state.lineStartFollowsClassExpression,
        ),
      );
    }
    if (current === "}") {
      if (state.statementBlocks.pop()?.closeStartsRegex) statementBlockCloses.add(index);
      const templateDepth = state.templateExpressionDepths.at(-1);
      state.depth = Math.max(0, state.depth - 1);
      if (templateDepth !== undefined && templateDepth === state.depth + 1) {
        state.templateExpressionDepths.pop();
        state.quote = "`";
      }
    }
    if (!/\s/.test(current)) lastSignificantIndex = index;
  }
  if (state.quote !== "`" && !escapedLineContinuation) state.quote = undefined;
  if (state.depth === 0) {
    state.quote = undefined;
    state.inBlockComment = false;
    state.canStartRegexAtLineStart = true;
    state.lineStartFollowsArrow = false;
    state.lineStartFollowsClassExpression = false;
    state.lineStartRequiresExpression = false;
    state.pendingControlFlowCondition = false;
    state.controlFlowParentheses.length = 0;
    state.statementBlocks.length = 0;
    state.templateExpressionDepths.length = 0;
  } else if (lastSignificantIndex >= 0) {
    state.pendingControlFlowCondition = endsWithControlFlowKeyword(line, lastSignificantIndex);
    state.canStartRegexAtLineStart = lastSignificantIndex === lastDivisionSlashIndex ||
      canStartRegexLiteral(
        line,
        lastSignificantIndex + 1,
        regexContext,
      );
    state.lineStartFollowsArrow = endsWithArrow(line, lastSignificantIndex);
    state.lineStartFollowsClassExpression = endsWithClassExpression(line, lastSignificantIndex);
    state.lineStartRequiresExpression = requiresExpressionAfter(line, lastSignificantIndex);
  }
}

function findClosingBacktickRun(value: string, start: number, length: number): number {
  for (let cursor = start; cursor < value.length;) {
    const runStart = value.indexOf("`", cursor);
    if (runStart < 0) return -1;
    let runEnd = runStart + 1;
    while (value[runEnd] === "`") runEnd++;
    if (runEnd - runStart === length) return runEnd;
    cursor = runEnd;
  }
  return -1;
}

function isEscapedCharacter(value: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor--) backslashes++;
  return backslashes % 2 === 1;
}

function findMdxExpressionCharacters(code: string, jsxTagCharacters?: boolean[]): boolean[] {
  const expressionCharacters = new Array<boolean>(code.length).fill(false);
  const state: MdxExpressionState = {
    depth: 0,
    inBlockComment: false,
    inJsxTag: false,
    canStartRegexAtLineStart: true,
    lineStartFollowsArrow: false,
    lineStartFollowsClassExpression: false,
    lineStartRequiresExpression: false,
    pendingControlFlowCondition: false,
    controlFlowParentheses: [],
    statementBlocks: [],
    templateExpressionDepths: [],
  };
  let lineStart = 0;
  while (lineStart < code.length) {
    let lineEnd = code.indexOf("\n", lineStart);
    if (lineEnd < 0) lineEnd = code.length;
    scanMdxExpressionLine(
      code.slice(lineStart, lineEnd),
      state,
      (index) => {
        expressionCharacters[lineStart + index] = true;
      },
      jsxTagCharacters
        ? (index) => {
          jsxTagCharacters[lineStart + index] = true;
        }
        : undefined,
    );
    lineStart = lineEnd < code.length ? lineEnd + 1 : code.length;
  }
  return expressionCharacters;
}

const MARKDOWN_CONTAINER_PREFIX = /^(?: {0,3}>[ \t]?| {0,3}(?:[*+-]|\d{1,9}[.)])[ \t])/;
const MARKDOWN_BLOCKQUOTE_PREFIX = /^ {0,3}>[ \t]?/;
const MARKDOWN_LIST_PREFIX = /^ {0,3}(?:[*+-]|\d{1,9}[.)])(?: {1,4}(?=\S|$)|\t)/;
const MARKDOWN_FENCE_OPEN_PREFIX = /^ {0,3}(`{3,}|~{3,})/; // NOSONAR: CommonMark fence marker heuristic.
const MARKDOWN_FENCE_CLOSE = /^ {0,3}(`+|~+)[ \t]*$/;

function markdownContainerContent(line: string): { content: string; offset: number } {
  let offset = 0;
  while (offset < line.length) {
    const prefix = MARKDOWN_CONTAINER_PREFIX.exec(line.slice(offset))?.[0];
    if (!prefix) break;
    offset += prefix.length;
  }
  return { content: line.slice(offset), offset };
}

function markdownBlockquoteContent(
  line: string,
): { content: string; offset: number; depth: number } {
  let offset = 0;
  let depth = 0;
  while (offset < line.length) {
    const prefix = MARKDOWN_BLOCKQUOTE_PREFIX.exec(line.slice(offset))?.[0];
    if (!prefix) break;
    offset += prefix.length;
    depth++;
  }
  return { content: line.slice(offset), offset, depth };
}

function markdownListContinuationIndent(line: string): number | undefined {
  let offset = 0;
  let columns = 0;
  let continuationIndent: number | undefined;
  while (offset < line.length) {
    const prefix = MARKDOWN_LIST_PREFIX.exec(line.slice(offset))?.[0];
    if (!prefix) break;
    offset += prefix.length;
    for (const character of prefix) {
      columns = character === "\t" ? columns + 4 - (columns % 4) : columns + 1;
    }
    continuationIndent = columns;
  }
  return continuationIndent;
}

function markdownColumnOffset(line: string, targetColumn: number): number | undefined {
  let columns = 0;
  for (let offset = 0; offset < line.length; offset++) {
    const character = line[offset]!;
    if (character === " ") {
      columns++;
    } else if (character === "\t") {
      columns += 4 - (columns % 4);
    } else {
      return undefined;
    }
    if (columns >= targetColumn) return offset + 1;
  }
  return undefined;
}

interface MarkdownContainerState {
  listContinuationIndent?: number;
  listBlockquoteDepth?: number;
  listBlankLines: number;
}

function trackedMarkdownContainerContent(
  line: string,
  state: MarkdownContainerState,
): { content: string; offset: number } {
  const blockquoteContent = markdownBlockquoteContent(line);
  if (
    state.listContinuationIndent !== undefined &&
    blockquoteContent.depth < (state.listBlockquoteDepth ?? 0)
  ) {
    state.listContinuationIndent = undefined;
    state.listBlockquoteDepth = undefined;
    state.listBlankLines = 0;
  }
  const blankLine = blockquoteContent.content.trim().length === 0;
  if (state.listContinuationIndent !== undefined && blankLine) {
    state.listBlankLines++;
    if (state.listBlankLines >= 2) {
      state.listContinuationIndent = undefined;
      state.listBlockquoteDepth = undefined;
    }
  } else if (!blankLine) {
    state.listBlankLines = 0;
  }
  const directListIndent = markdownListContinuationIndent(blockquoteContent.content);
  const directContent = markdownContainerContent(line);
  if (directListIndent !== undefined) {
    state.listContinuationIndent = directListIndent;
    state.listBlockquoteDepth = blockquoteContent.depth;
    state.listBlankLines = 0;
    return directContent;
  }
  if (
    state.listContinuationIndent !== undefined
  ) {
    const continuationOffset = markdownColumnOffset(
      blockquoteContent.content,
      state.listContinuationIndent,
    );
    if (continuationOffset !== undefined) {
      return {
        content: blockquoteContent.content.slice(continuationOffset),
        offset: blockquoteContent.offset + continuationOffset,
      };
    }
  }
  if (blockquoteContent.content.trim().length > 0) {
    state.listContinuationIndent = undefined;
    state.listBlockquoteDepth = undefined;
    state.listBlankLines = 0;
  }
  return directContent;
}

function adjustTemplateExpressionDepth(
  depths: number[],
  index: number,
  delta: number,
): number {
  const nextDepth = depths[index]! + delta;
  depths[index] = nextDepth;
  return nextDepth;
}

function isMarkdownParagraphContent(
  content: string,
  previousLineWasParagraph: boolean,
): boolean {
  const trimmed = content.trimStart();
  if (trimmed.length === 0) return false;
  if (previousLineWasParagraph && /^(?:=+|-+)[ \t]*$/.test(trimmed)) return false;
  return !/^(?:#{1,6}(?:[ \t]|$)|(?:`{3,}|~{3,})|(?:[*_-][ \t]*){3,}$)/.test(trimmed) &&
    !/^(?:\{|<(?:[A-Za-z!/?>]))/.test(trimmed);
}

function maskMarkdownCode( // NOSONAR: Markdown masking coordinates containers, fences, expressions, and indented blocks.
  code: string,
  includeInlineCode: boolean,
  includeIndentedBlocks: boolean,
): string {
  const characters = code.split("");
  const trackMdxOwnership = includeInlineCode || includeIndentedBlocks;
  const mdxJsxTagCharacters = trackMdxOwnership
    ? new Array<boolean>(code.length).fill(false)
    : undefined;
  const mdxExpressionCharacters = trackMdxOwnership
    ? findMdxExpressionCharacters(code, mdxJsxTagCharacters)
    : undefined;
  const mdxEsmLineCharacters = trackMdxOwnership ? findMdxEsmLineCharacters(code) : undefined;
  let activeFence:
    | { marker: string; length: number; listIndent?: number; blockquoteDepth: number }
    | undefined;
  const fenceContainerState: MarkdownContainerState = { listBlankLines: 0 };
  let lineStart = 0;
  while (lineStart < code.length) {
    let lineEnd = code.indexOf("\n", lineStart);
    if (lineEnd < 0) lineEnd = code.length;
    const contentEnd = lineEnd > lineStart && code[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
    const line = code.slice(lineStart, contentEnd);
    const containerContent = trackedMarkdownContainerContent(line, fenceContainerState);
    const blockquoteDepth = markdownBlockquoteContent(line).depth;
    if (
      activeFence &&
      ((activeFence.listIndent !== undefined &&
        fenceContainerState.listContinuationIndent === undefined) ||
        blockquoteDepth < activeFence.blockquoteDepth)
    ) {
      activeFence = undefined;
    }
    const candidate = MARKDOWN_FENCE_OPEN_PREFIX.exec(containerContent.content);
    const candidateInfo = candidate ? containerContent.content.slice(candidate[0].length) : "";
    const validCandidate = candidate?.[1]?.startsWith("~") || !candidateInfo.includes("`");
    const candidateStart = candidate?.[1]
      ? lineStart + containerContent.offset + candidate[0].length - candidate[1].length
      : -1;
    const candidateIsJavaScript = candidateStart >= 0 &&
      (mdxExpressionCharacters?.[candidateStart] === true ||
        mdxEsmLineCharacters?.[candidateStart] === true ||
        mdxJsxTagCharacters?.[candidateStart] === true);
    if (!activeFence && candidate?.[1] && validCandidate && !candidateIsJavaScript) {
      activeFence = {
        marker: candidate[1][0]!,
        length: candidate[1].length,
        listIndent: fenceContainerState.listContinuationIndent,
        blockquoteDepth,
      };
      maskRange(characters, lineStart, contentEnd);
    } else if (activeFence) {
      maskRange(characters, lineStart, contentEnd);
      const closing = MARKDOWN_FENCE_CLOSE.exec(containerContent.content)?.[1];
      if (
        closing?.startsWith(activeFence.marker) && closing.length >= activeFence.length
      ) {
        activeFence = undefined;
      }
    }
    lineStart = lineEnd < code.length ? lineEnd + 1 : code.length;
  }

  if (includeInlineCode) {
    for (let index = 0; index < code.length;) {
      if (
        characters[index] !== "`" || mdxExpressionCharacters?.[index] ||
        mdxEsmLineCharacters?.[index] || mdxJsxTagCharacters?.[index] ||
        isEscapedCharacter(code, index)
      ) {
        index++; // NOSONAR: scanner consumes closing inline-code delimiter.
        continue;
      }
      let delimiterEnd = index + 1;
      while (characters[delimiterEnd] === "`") delimiterEnd++;
      const delimiterLength = delimiterEnd - index;
      let closing = delimiterEnd;
      while (closing < characters.length) {
        if (characters[closing] !== "`") {
          closing++;
          continue;
        }
        let closingEnd = closing + 1;
        while (characters[closingEnd] === "`") closingEnd++;
        if (closingEnd - closing === delimiterLength) break;
        closing = closingEnd;
      }
      if (closing >= characters.length) {
        index = delimiterEnd;
        continue;
      }
      maskRange(characters, index, closing + delimiterLength);
      index = closing + delimiterLength;
    }
  }

  if (includeIndentedBlocks) {
    lineStart = 0;
    let previousLineWasParagraph = false;
    let inIndentedBlock = false;
    const indentedContainerState: MarkdownContainerState = { listBlankLines: 0 };
    const expressionState: MdxExpressionState = {
      depth: 0,
      inBlockComment: false,
      inJsxTag: false,
      canStartRegexAtLineStart: true,
      lineStartFollowsArrow: false,
      lineStartFollowsClassExpression: false,
      lineStartRequiresExpression: false,
      pendingControlFlowCondition: false,
      controlFlowParentheses: [],
      statementBlocks: [],
      templateExpressionDepths: [],
    };
    while (lineStart < code.length) {
      let lineEnd = code.indexOf("\n", lineStart);
      if (lineEnd < 0) lineEnd = code.length;
      const line = code.slice(lineStart, lineEnd);
      const containerContent =
        trackedMarkdownContainerContent(line, indentedContainerState).content;
      const indented = containerContent.startsWith("\t") || containerContent.startsWith("    ");
      const inMdxExpression = expressionState.depth > 0;
      const inMdxEsm = mdxEsmLineCharacters?.[lineStart] === true;
      if (
        indented && !inMdxExpression && !inMdxEsm &&
        (!previousLineWasParagraph || inIndentedBlock)
      ) {
        maskRange(characters, lineStart, lineEnd);
        inIndentedBlock = true;
      } else if (containerContent.trim().length > 0) {
        inIndentedBlock = false;
      }
      const visibleLine = characters.slice(lineStart, lineEnd).join("");
      scanMdxExpressionLine(visibleLine, expressionState);
      previousLineWasParagraph = !inIndentedBlock &&
        isMarkdownParagraphContent(containerContent, previousLineWasParagraph);
      lineStart = lineEnd < code.length ? lineEnd + 1 : code.length;
    }
  }
  return characters.join("");
}

function precedingIdentifier(value: ArrayLike<string>, endIndex: number): string {
  let identifier = "";
  for (let index = endIndex; index >= 0 && /[\w$]/.test(value[index]!); index--) {
    identifier = value[index] + identifier;
  }
  return identifier;
}

function hasControlFlowKeywordBefore(value: ArrayLike<string>, before: number): boolean {
  const endIndex = previousSignificantIndex(value, before);
  const word = precedingIdentifier(value, endIndex);
  if (!isControlFlowKeyword(word)) return false;
  const wordStart = endIndex - word.length + 1;
  const previousIndex = previousSignificantIndex(value, wordStart);
  return value[previousIndex] !== ".";
}

function isModuleSpecifierQuote(code: ArrayLike<string>, quoteIndex: number): boolean {
  const owner = moduleSpecifierOwner(code, quoteIndex);
  return owner.name === "from" || owner.name === "import";
}

function moduleSpecifierOwner(code: ArrayLike<string>, quoteIndex: number): ModuleSpecifierOwner {
  let previousIndex = previousSignificantIndex(code, quoteIndex);
  if (code[previousIndex] === "(") previousIndex = previousSignificantIndex(code, previousIndex);
  const name = precedingIdentifier(code, previousIndex);
  return { name, start: previousIndex - name.length + 1 };
}

function findStringLiteralEnd(code: ArrayLike<string>, quoteIndex: number): number {
  const quote = code[quoteIndex];
  for (let index = quoteIndex + 1; index < code.length; index++) {
    const current = code[index];
    if (current === "\\") {
      index++;
      continue;
    }
    if (current === "\n" || current === "\r") return -1;
    if (current === quote) return index;
  }
  return -1;
}

function mdxAllowsSpecifierOwner(
  owner: ModuleSpecifierOwner,
  mdxExpressionCharacters: readonly boolean[] | undefined,
  mdxEsmLineCharacters: readonly boolean[] | undefined,
): boolean {
  if (!mdxExpressionCharacters || !mdxEsmLineCharacters) return true;
  if (mdxEsmLineCharacters[owner.start] === true) return true;
  return owner.name === "import" && mdxExpressionCharacters[owner.start] === true;
}

function maskJavaScriptComments(line: string): string { // NOSONAR: compact lexer for MDX ESM source-line detection.
  const characters = line.split("");
  let quote: string | undefined;
  let inBlockComment = false;
  for (let index = 0; index < line.length; index++) {
    const current = line[index]!;
    const next = line[index + 1];
    if (inBlockComment) {
      maskRange(characters, index, index + 1);
      if (current === "*" && next === "/") {
        maskRange(characters, index + 1, index + 2);
        inBlockComment = false;
        index++; // NOSONAR: scanner consumes block-comment close as a pair.
      }
      continue;
    }
    if (quote) {
      if (current === "\\") index++; // NOSONAR: scanner consumes the escaped character with its escape.
      else if (current === quote) quote = undefined;
      continue;
    }
    if (current === '"' || current === "'" || current === "`") {
      quote = current;
      continue;
    }
    if (current === "/" && next === "/") {
      maskRange(characters, index, line.length);
      break;
    }
    if (current === "/" && next === "*") {
      maskRange(characters, index, index + 2);
      inBlockComment = true;
      index++; // NOSONAR: scanner consumes block-comment open as a pair.
    }
  }
  return characters.join("");
}

function isMdxEsmSourceLine(line: string, nextCodeLine: () => string): boolean {
  const classifiedLine = maskJavaScriptComments(line);
  const bareImport = /^ {0,3}import\s*$/.test(classifiedLine);
  const bareExport = /^ {0,3}export\s*$/.test(classifiedLine);
  const defaultImport = /^ {0,3}import\s+[A-Za-z_$][\w$]*\s*$/.test(classifiedLine); // NOSONAR: bounded MDX ESM split-import heuristic.
  const continuation = bareImport || bareExport || defaultImport ? nextCodeLine() : "";
  const immediateContinuation = !continuation.startsWith("\n");
  const splitImportContinuation = immediateContinuation &&
    /^(?:["']|\{|\*|[A-Za-z_$][\w$]*\s*(?:,|\bfrom\b))/.test(continuation); // NOSONAR: bounded MDX ESM split-import heuristic.
  const splitDefaultImportContinuation = immediateContinuation && /^from\b/.test(continuation);
  const splitExportContinuation = immediateContinuation &&
    /^(?:default\b|\{|\*|const\b|let\b|var\b|function\b|class\b|async\s+function\b)/ // NOSONAR: bounded MDX ESM split-export heuristic.
      .test(continuation);
  return (bareImport && splitImportContinuation) ||
    (bareExport && splitExportContinuation) ||
    (defaultImport && splitDefaultImportContinuation) ||
    /^ {0,3}import(?:\s*["']|\s+\{|\s+\*|\s+[A-Za-z_$][\w$]*(?:\s*,|\s+from\b))/.test(
      classifiedLine,
    ) ||
    /^ {0,3}export\s+(?:default\b|\{|\*|const\b|let\b|var\b|function\b|class\b|async\s+function\b)/
      .test(classifiedLine);
}

interface MdxEsmContinuationState {
  readonly delimiters: string[];
  quote?: string;
  inBlockComment: boolean;
  canStartRegexAtLineStart: boolean;
  pendingControlFlowCondition: boolean;
}

function scanMdxEsmLine( // NOSONAR: compact lexer for MDX ESM continuation state.
  line: string,
  state: MdxEsmContinuationState,
): string {
  let lastSignificantIndex = -1;
  let lastDivisionSlashIndex = -1;
  let escapedLineContinuation = false;
  const regexContext = regexLineContext(
    line,
    state.canStartRegexAtLineStart,
    state.pendingControlFlowCondition,
  );
  for (let index = 0; index < line.length; index++) {
    const current = line[index]!;
    const next = line[index + 1];
    if (state.inBlockComment) {
      if (current === "*" && next === "/") {
        state.inBlockComment = false;
        index++; // NOSONAR: scanner consumes block-comment close as a pair.
      }
      continue;
    }
    if (state.quote) {
      if (current === "\\") {
        if (index === line.length - 1) escapedLineContinuation = true;
        index++; // NOSONAR: scanner consumes the escaped character with its escape.
      } else if (current === state.quote) {
        state.quote = undefined;
        lastSignificantIndex = index;
      }
      continue;
    }
    if (current === "/" && next === "/") break;
    if (current === "/" && next === "*") {
      state.inBlockComment = true;
      index++; // NOSONAR: scanner consumes block-comment open as a pair.
      continue;
    }
    if (current === "/") {
      const followsDivision = lastDivisionSlashIndex >= 0 &&
        previousSignificantIndex(line, index) === lastDivisionSlashIndex;
      const regexEnd = findRegexLiteralEnd(line, index, regexContext, followsDivision);
      if (regexEnd >= 0) {
        lastSignificantIndex = regexEnd;
        lastDivisionSlashIndex = -1;
        index = regexEnd; // NOSONAR: scanner jumps over one complete regex literal.
        continue;
      }
      lastDivisionSlashIndex = index;
    }
    if (current === '"' || current === "'" || current === "`") {
      state.quote = current;
      lastSignificantIndex = index;
      continue;
    }
    if ("([{".includes(current)) {
      state.delimiters.push(current);
    } else if (")]}".includes(current)) {
      state.delimiters.pop();
    }
    if (!/\s/.test(current)) lastSignificantIndex = index;
  }
  if (state.quote !== "`" && !escapedLineContinuation) state.quote = undefined;
  const executableLine = lastSignificantIndex < 0
    ? ""
    : line.slice(0, lastSignificantIndex + 1).trimEnd();
  if (executableLine.length > 0) {
    state.pendingControlFlowCondition = endsWithControlFlowKeyword(
      executableLine,
      executableLine.length - 1,
    );
    state.canStartRegexAtLineStart = lastSignificantIndex === lastDivisionSlashIndex ||
      canStartRegexLiteral(
        executableLine,
        executableLine.length,
        regexContext,
      );
  }
  return executableLine;
}

function continuesMdxEsmStatement(
  executableLine: string,
  state: MdxEsmContinuationState,
  nextLine: () => string,
): boolean {
  if (state.inBlockComment || state.quote !== undefined || state.delimiters.length > 0) return true;
  if (executableLine.length === 0) return true;
  return /(?:=>|===?|!==?|&&|\|\||\?\?|[=+\-*/%&|^?:.,([{!~])\s*$/.test(executableLine) ||
    /\b(?:await|delete|new|typeof|void)\s*$/.test(executableLine) ||
    /^(?:export\s+)?(?:const|let|var|class|(?:async\s+)?function)\s*$/.test(executableLine) ||
    /^export\s+default\s+(?:async\s+)?(?:function|class)\s*$/.test(executableLine) ||
    /^import\s*$/.test(executableLine) ||
    /^import\s+[A-Za-z_$][\w$]*\s*$/.test(executableLine) ||
    /^export\s*$/.test(executableLine) ||
    /\bexport\s+default\s*$/.test(executableLine) ||
    (!executableLine.endsWith(";") && startsMdxEsmContinuation(nextLine(), executableLine));
}

function startsMdxEsmContinuation(line: string, executableLine: string): boolean {
  const separatedByBlank = line.startsWith("\n");
  const trimmed = line.trimStart();
  const expressionDeclaration = /^(?:export\s+)?(?:const|let|var)\b.*=/.test(executableLine) ||
    /^export\s+default\b/.test(executableLine);
  // A leading list marker continues JavaScript only when the active ESM line
  // is an expression declaration. Complete imports still yield to CommonMark.
  if (/^[-+*](?:[ \t]|$)/.test(trimmed)) {
    return !separatedByBlank && expressionDeclaration;
  }
  if (/^>/.test(trimmed)) return false;
  if (/^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(trimmed)) return false;
  if (/^<(?:[A-Za-z!/?>])/.test(trimmed)) return false;
  if (
    separatedByBlank &&
    !/^(?:&&|\|\||\?\?|\?\.|[?:]|instanceof\b|in\b)/.test(trimmed)
  ) return false;
  if (/^(?:&&|\|\||\?\?|\?\.|instanceof\b|in\b)/.test(trimmed)) return true;
  const first = trimmed[0];
  if (first === "`") return !separatedByBlank && expressionDeclaration;
  return first !== undefined && "=+-*/%&|^?:.,([<>".includes(first);
}

function nextMdxEsmCodeLine(code: string, start: number): string {
  let inBlockComment = false;
  let separatedByBlank = false;
  while (start < code.length) {
    let end = code.indexOf("\n", start);
    if (end < 0) end = code.length;
    const physicalLine = code.slice(start, end);
    let candidate = physicalLine.trimStart();
    while (candidate.length > 0) {
      if (inBlockComment) {
        const commentEnd = candidate.indexOf("*/");
        if (commentEnd < 0) {
          candidate = "";
          break;
        }
        inBlockComment = false;
        candidate = candidate.slice(commentEnd + 2).trimStart();
        continue;
      }
      if (candidate.startsWith("//")) candidate = "";
      if (!candidate.startsWith("/*")) break;
      inBlockComment = true;
    }
    if (candidate.length > 0) return `${separatedByBlank ? "\n" : ""}${candidate}`;
    if (physicalLine.trim().length === 0) separatedByBlank = true;
    start = end < code.length ? end + 1 : code.length;
  }
  return "";
}

function findMdxEsmLineCharacters(code: string): boolean[] { // NOSONAR: line scanner coordinates MDX ESM continuation state.
  const esmLineCharacters = new Array<boolean>(code.length).fill(false);
  const state: MdxEsmContinuationState = {
    delimiters: [],
    inBlockComment: false,
    canStartRegexAtLineStart: true,
    pendingControlFlowCondition: false,
  };
  let inEsmStatement = false;
  let lineStart = 0;
  while (lineStart < code.length) {
    let lineEnd = code.indexOf("\n", lineStart);
    if (lineEnd < 0) lineEnd = code.length;
    const line = code.slice(lineStart, lineEnd);
    const nextCodeLine = () =>
      nextMdxEsmCodeLine(code, lineEnd < code.length ? lineEnd + 1 : code.length);
    if (!inEsmStatement && isMdxEsmSourceLine(line, nextCodeLine)) {
      state.delimiters.length = 0;
      state.quote = undefined;
      state.inBlockComment = false;
      state.canStartRegexAtLineStart = true;
      state.pendingControlFlowCondition = false;
      inEsmStatement = true;
    }
    if (inEsmStatement) {
      esmLineCharacters.fill(true, lineStart, lineEnd);
      inEsmStatement = continuesMdxEsmStatement(
        scanMdxEsmLine(line, state),
        state,
        nextCodeLine,
      );
    }
    lineStart = lineEnd < code.length ? lineEnd + 1 : code.length;
  }
  return esmLineCharacters;
}

function maskComments( // NOSONAR: top-level masking scanner coordinates JS, JSX, Markdown, and MDX ESM state.
  code: string,
  markdownCode: boolean,
): string {
  const characters = code.split("");
  const mdxJsxTagCharacters = markdownCode
    ? new Array<boolean>(code.length).fill(false)
    : undefined;
  const mdxExpressionCharacters = markdownCode
    ? findMdxExpressionCharacters(code, mdxJsxTagCharacters)
    : undefined;
  const mdxEsmLineCharacters = markdownCode ? findMdxEsmLineCharacters(code) : undefined;
  let quote: string | undefined;
  let preserveQuotedContent = false;
  let resetQuoteAtLineBoundary = false;
  const templateExpressionDepths: number[] = [];
  const controlFlowParentheses: boolean[] = [];
  const statementBlocks: JavaScriptBlockContext[] = [];
  const regexContextsByLine = new Map<number, RegexLineContext>();
  let lastDivisionSlashIndex = -1;
  let lastControlFlowCloseIndex = -1;
  let lastStatementBlockCloseIndex = -1;
  for (let index = 0; index < code.length; index++) {
    const current = code[index]!;
    if (quote) {
      if (
        (current === "\n" || current === "\r") &&
        (quote !== "`" || resetQuoteAtLineBoundary)
      ) {
        quote = undefined;
        preserveQuotedContent = false;
        resetQuoteAtLineBoundary = false;
        continue;
      }
      if (current === "\\") {
        if (!preserveQuotedContent) {
          maskRange(characters, index, Math.min(code.length, index + 2));
        }
        index++; // NOSONAR: scanner consumes the escaped character with its escape.
      } else if (quote === "`" && current === "$" && code[index + 1] === "{") {
        maskRange(characters, index, index + 2);
        quote = undefined;
        preserveQuotedContent = false;
        resetQuoteAtLineBoundary = false;
        templateExpressionDepths.push(1);
        statementBlocks.push({ allowsStatements: false, closeStartsRegex: false });
        index++; // NOSONAR: scanner consumes template-expression open as a pair.
      } else if (current === quote) {
        quote = undefined;
        preserveQuotedContent = false;
        resetQuoteAtLineBoundary = false;
      } else if (!preserveQuotedContent) {
        maskRange(characters, index, index + 1);
      }
      continue;
    }
    const templateDepthIndex = templateExpressionDepths.length - 1;
    const inJavaScript = !markdownCode || mdxExpressionCharacters?.[index] === true ||
      mdxEsmLineCharacters?.[index] === true;
    if (mdxJsxTagCharacters?.[index] === true) continue;
    const lineComment = inJavaScript && code.startsWith("//", index);
    const blockComment = inJavaScript && code.startsWith("/*", index);
    const htmlComment = code.startsWith("<!--", index);
    if (lineComment || blockComment || htmlComment) {
      let terminator = "-->";
      if (lineComment) {
        terminator = "\n";
      } else if (blockComment) {
        terminator = "*/";
      }
      const terminatorIndex = code.indexOf(terminator, index + (htmlComment ? 4 : 2));
      let end = code.length;
      if (terminatorIndex >= 0) {
        end = lineComment ? terminatorIndex : terminatorIndex + terminator.length;
      }
      maskRange(characters, index, end);
      index = end - 1;
      continue;
    }
    if (inJavaScript && current === "/") {
      const followsDivision = lastDivisionSlashIndex >= 0 &&
        previousSignificantIndex(characters, index) === lastDivisionSlashIndex;
      const followsStatementBlock = lastStatementBlockCloseIndex >= 0 &&
        previousSignificantIndex(characters, index) === lastStatementBlockCloseIndex;
      const followsControlFlow = lastControlFlowCloseIndex >= 0 &&
        previousSignificantIndex(characters, index) === lastControlFlowCloseIndex;
      const regexEnd = findRegexLiteralEndAt(
        code,
        index,
        regexContextsByLine,
        characters,
        followsDivision || followsStatementBlock || followsControlFlow,
      );
      if (regexEnd >= 0) {
        maskRange(characters, index, regexEnd + 1);
        characters[index] = "/";
        characters[regexEnd] = "/";
        lastDivisionSlashIndex = -1;
        index = regexEnd; // NOSONAR: scanner jumps over one complete regex literal.
        continue;
      }
      lastDivisionSlashIndex = index;
    }
    if (templateDepthIndex >= 0 && current === "{") {
      adjustTemplateExpressionDepth(templateExpressionDepths, templateDepthIndex, 1);
      const lineStart = code.lastIndexOf("\n", index - 1) + 1;
      const previousIndex = previousSignificantIndex(characters, index);
      statementBlocks.push(
        javascriptBlockContext(
          code.slice(lineStart, index + 1),
          index - lineStart,
          statementBlocks,
          previousIndex >= 0 && previousIndex < lineStart &&
            requiresExpressionAfter(characters, previousIndex),
        ),
      );
      continue;
    }
    if (templateDepthIndex >= 0 && current === "}") {
      if (statementBlocks.pop()?.closeStartsRegex) lastStatementBlockCloseIndex = index;
      if (adjustTemplateExpressionDepth(templateExpressionDepths, templateDepthIndex, -1) === 0) {
        templateExpressionDepths.pop();
        quote = "`";
      }
      continue;
    }
    if (inJavaScript && current === "(") {
      const lineStart = code.lastIndexOf("\n", index - 1) + 1;
      const localIndex = index - lineStart;
      const carriedControlFlow = previousSignificantIndex(characters, index) < lineStart &&
        hasControlFlowKeywordBefore(characters, index);
      controlFlowParentheses.push(
        carriedControlFlow || isControlFlowConditionOpen(
          code.slice(lineStart, index + 1),
          localIndex,
        ),
      );
      continue;
    }
    if (inJavaScript && current === ")") {
      if (controlFlowParentheses.pop()) lastControlFlowCloseIndex = index;
      continue;
    }
    if (inJavaScript && current === "{") {
      const lineStart = code.lastIndexOf("\n", index - 1) + 1;
      const previousIndex = previousSignificantIndex(characters, index);
      statementBlocks.push(
        javascriptBlockContext(
          code.slice(lineStart, index + 1),
          index - lineStart,
          statementBlocks,
          previousIndex >= 0 && previousIndex < lineStart &&
            requiresExpressionAfter(characters, previousIndex),
        ),
      );
      continue;
    }
    if (inJavaScript && current === "}") {
      if (statementBlocks.pop()?.closeStartsRegex) lastStatementBlockCloseIndex = index;
      continue;
    }
    if (mdxJsxTagCharacters?.[index] === true && !inJavaScript) continue;
    if (current === "`" && isEscapedCharacter(code, index)) continue;
    if (current === '"' || current === "'" || current === "`") {
      quote = current;
      preserveQuotedContent = current !== "`" && isModuleSpecifierQuote(characters, index);
      resetQuoteAtLineBoundary = current === "`" && markdownCode &&
        mdxExpressionCharacters?.[index] !== true && mdxEsmLineCharacters?.[index] !== true;
      continue;
    }
  }
  return characters.join("");
}

function findModuleSpecifiers(
  code: string,
  options: { markdownCode?: boolean } = {},
): ModuleSpecifierMatch[] {
  const markdownCode = options.markdownCode === true;
  const searchable = maskComments(
    maskMarkdownCode(code, markdownCode, markdownCode),
    markdownCode,
  );
  const mdxExpressionCharacters = markdownCode ? findMdxExpressionCharacters(code) : undefined;
  const mdxEsmLineCharacters = markdownCode ? findMdxEsmLineCharacters(code) : undefined;
  const matches: ModuleSpecifierMatch[] = [];
  for (let quoteIndex = 0; quoteIndex < searchable.length; quoteIndex++) {
    const quote = searchable[quoteIndex];
    if (quote !== '"' && quote !== "'") continue;
    const owner = moduleSpecifierOwner(searchable, quoteIndex);
    if (owner.name !== "from" && owner.name !== "import") continue;
    if (!mdxAllowsSpecifierOwner(owner, mdxExpressionCharacters, mdxEsmLineCharacters)) continue;
    const end = findStringLiteralEnd(searchable, quoteIndex);
    if (end <= quoteIndex + 1) continue;
    matches.push({
      path: code.slice(quoteIndex + 1, end),
      start: quoteIndex + 1,
      end,
    });
    quoteIndex = end;
  }
  return matches;
}

/**
 * Extract import statements from code or MDX while ignoring examples and comments.
 */
export function extractImports(code: string, options: { markdownCode?: boolean } = {}): string[] {
  return [...new Set(findModuleSpecifiers(code, options).map((match) => match.path))];
}

/**
 * Resolve import path relative to file
 */
export function resolveImportPath(
  importPath: string,
  fromFile: string,
  _projectDir: string,
): string {
  if (importPath.startsWith(".")) {
    return resolve(dirname(fromFile), importPath);
  }

  if (!importPath.startsWith("/") && !importPath.includes(":")) {
    return importPath;
  }

  return importPath;
}

/**
 * Find component file with various extensions
 */
export function findComponent(basePath: string, _projectDir: string): string | null {
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];

  for (const ext of extensions) {
    const fullPath = `${basePath}${ext}`;
    if (existsSync(fullPath)) return fullPath;

    const indexPath = join(basePath, `index${ext}`);
    if (existsSync(indexPath)) return indexPath;
  }

  return null;
}

/**
 * Process and update import paths in code
 */
export async function processImports(
  code: string,
  filePath: string,
  projectDir: string,
  processImport: (importPath: string) => Promise<string | null>,
  options: { markdownCode?: boolean } = {},
): Promise<string> {
  const specifiers = findModuleSpecifiers(code, options);
  const replacements = new Map<string, string | null>();
  for (const { path: importPath } of specifiers) {
    if (replacements.has(importPath)) continue;
    const resolvedPath = resolveImportPath(importPath, filePath, projectDir);
    replacements.set(importPath, await processImport(resolvedPath));
  }

  let cursor = 0;
  let processedCode = "";
  for (const specifier of specifiers) {
    processedCode += code.slice(cursor, specifier.start);
    const replacement = replacements.get(specifier.path);
    processedCode += replacement && replacement !== specifier.path
      ? replacement
      : code.slice(specifier.start, specifier.end);
    cursor = specifier.end;
  }
  return processedCode + code.slice(cursor);
}
