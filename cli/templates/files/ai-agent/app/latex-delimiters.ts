/**
 * Normalise LaTeX delimiters before Markdown parsing.
 *
 * Two problems make this a pre-parse pass rather than a plugin.
 *
 * First, `\(` and `\[` cannot survive the Markdown parser. CommonMark treats a
 * backslash before ASCII punctuation as a character escape, so `\(x\)` reaches
 * the syntax tree as plain `(x)`. By the time any remark or rehype plugin runs,
 * the delimiters are already gone, and a KaTeX DOM pass has nothing to match.
 *
 * Second, `$` cannot be trusted as a delimiter in this content. Assistant
 * answers are full of currency: "18% tip on $84.50 ... totals $99.71". Enabling
 * single dollar math against that text turns the prose between two amounts into
 * a formula. So every dollar sign that the author wrote is escaped first, and
 * the only unescaped dollars left in the document are the delimiters introduced
 * here. That is what makes `singleDollarTextMath` safe downstream.
 *
 * Code is never rewritten. Fenced blocks and inline spans are copied through
 * untouched, so a snippet containing `$` or `\(` keeps its exact source.
 */

/** A half-open source range that must be copied through verbatim. */
interface CodeSpan {
  readonly start: number;
  readonly end: number;
}

const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;

/**
 * Locate fenced code blocks.
 *
 * A fence closes on the first later fence of the same character that is at
 * least as long as the opener. An unterminated fence runs to end of input,
 * matching how CommonMark treats it, so trailing text is not rewritten as if it
 * were prose.
 */
function findFencedSpans(source: string): CodeSpan[] {
  const spans: CodeSpan[] = [];
  const lines = source.split("\n");
  let offset = 0;
  let open: { marker: string; start: number } | undefined;

  for (const line of lines) {
    const match = FENCE_RE.exec(line);
    if (open === undefined) {
      if (match?.[1]) open = { marker: match[1], start: offset };
    } else if (
      match?.[1] &&
      match[1][0] === open.marker[0] &&
      match[1].length >= open.marker.length
    ) {
      spans.push({ start: open.start, end: offset + line.length });
      open = undefined;
    }
    offset += line.length + 1;
  }

  if (open !== undefined) spans.push({ start: open.start, end: source.length });
  return spans;
}

/** Locate inline code spans, skipping any that fall inside a fenced block. */
function findInlineSpans(source: string, fenced: readonly CodeSpan[]): CodeSpan[] {
  const spans: CodeSpan[] = [];
  const inFence = (index: number) => fenced.some((s) => index >= s.start && index < s.end);

  let index = 0;
  while (index < source.length) {
    if (source[index] !== "`" || inFence(index)) {
      index += 1;
      continue;
    }
    let run = 0;
    while (source[index + run] === "`") run += 1;
    const marker = "`".repeat(run);
    const close = source.indexOf(marker, index + run);
    // An unclosed run is literal text, not a span, so leave it to be rewritten.
    if (close === -1) {
      index += run;
      continue;
    }
    spans.push({ start: index, end: close + run });
    index = close + run;
  }

  return spans;
}

const MATH_RE = /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g;

/** Outside maths a dollar is currency, so hide it from the math tokenizer. */
function escapeProseDollars(text: string): string {
  return text.replace(/\$/g, "\\$");
}

/**
 * Inside maths a dollar has to stop being a dollar character entirely.
 *
 * `remark-math` closes an inline expression at the first `$` it meets and does
 * not honour a backslash escape, so `\textbf{ \$99.71 }` silently fails to
 * render rather than producing a dollar sign. `\textdollar` is the TeX spelling
 * that survives, and the braces keep it from swallowing a following digit.
 */
function convertMathDollars(body: string): string {
  return body.replace(/\$/g, "{\\textdollar}");
}

/** Promote LaTeX delimiters to remark-math syntax, per region. */
function convertProse(text: string): string {
  let result = "";
  let cursor = 0;

  for (const match of text.matchAll(MATH_RE)) {
    const index = match.index ?? 0;
    result += escapeProseDollars(text.slice(cursor, index));
    const display = match[1] !== undefined;
    const body = convertMathDollars(display ? match[1] : (match[2] ?? ""));
    result += display ? `$$${body}$$` : `$${body}$`;
    cursor = index + match[0].length;
  }

  result += escapeProseDollars(text.slice(cursor));
  return result;
}

/**
 * Rewrite `\(inline\)` and `\[display\]` into `$inline$` and `$$display$$`,
 * leaving every code region and every author-written `$` untouched.
 */
export function normalizeLatexDelimiters(source: string): string {
  const fenced = findFencedSpans(source);
  const protectedSpans = [...fenced, ...findInlineSpans(source, fenced)]
    .sort((a, b) => a.start - b.start);

  let result = "";
  let cursor = 0;
  for (const span of protectedSpans) {
    if (span.start < cursor) continue;
    result += convertProse(source.slice(cursor, span.start));
    result += source.slice(span.start, span.end);
    cursor = span.end;
  }
  result += convertProse(source.slice(cursor));
  return result;
}
