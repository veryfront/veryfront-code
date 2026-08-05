/**
 * Carry LaTeX through Markdown parsing without letting the parser touch it.
 *
 * `\(` and `\[` cannot survive a Markdown parser. CommonMark treats a backslash
 * before ASCII punctuation as a character escape, so `\(x\)` reaches the syntax
 * tree as plain `(x)`. By the time any remark or rehype plugin runs the
 * delimiters are gone, and a KaTeX DOM pass has nothing left to match. The
 * rewrite therefore happens before parsing.
 *
 * Dollar delimiters are not used as the carrier, despite being what
 * `remark-math` expects. Two independent facts rule them out:
 *
 * 1. `remark-math` ends an inline expression at the first `$` it meets and does
 *    not honour `\$`, so an expression cannot contain a dollar sign.
 * 2. KaTeX only draws a dollar sign from a literal one (`\$`, `\text{\$}`).
 *    `\textdollar` and `\mathdollar` are not math-mode commands and render as
 *    an error.
 *
 * Together those mean a dollar-delimited expression can never display money,
 * which is most of what an assistant computes.
 *
 * A code span is used instead. Its content is literal by definition, so `\$`,
 * `\times` and every other backslash reach the renderer exactly as written, and
 * prose dollars need no escaping because `$` is no longer a delimiter at all.
 */

/** Marks a code span as maths. U+E000 is private use, so no author writes it. */
export const MATH_SENTINEL = "\uE000";

/** A half-open source range that must be copied through verbatim. */
interface CodeSpan {
  readonly start: number;
  readonly end: number;
}

const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;
const MATH_RE = /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g;

/**
 * Locate fenced code blocks.
 *
 * A fence closes on the first later fence of the same character that is at
 * least as long as the opener. An unterminated fence runs to end of input,
 * matching how CommonMark treats it, so a block still being streamed is not
 * rewritten as if it were prose.
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

/**
 * Wrap a payload in a code span long enough to contain it.
 *
 * A fence must be longer than any backtick run inside, and CommonMark strips
 * one leading and one trailing space, so padding keeps a payload that begins or
 * ends with a backtick intact. This is defensive: a closed backtick pair in the
 * source is already a code span and is skipped before maths is looked for, so
 * only an unbalanced backtick can reach here.
 */
function wrapAsCodeSpan(payload: string): string {
  let longestRun = 0;
  let run = 0;
  for (const character of payload) {
    run = character === "`" ? run + 1 : 0;
    if (run > longestRun) longestRun = run;
  }
  const fence = "`".repeat(longestRun + 1);
  const pad = payload.startsWith("`") || payload.endsWith("`") ? " " : "";
  return `${fence}${pad}${payload}${pad}${fence}`;
}

/** Rewrite the maths in one prose region into sentinel-tagged code spans. */
function convertProse(text: string): string {
  let result = "";
  let cursor = 0;

  for (const match of text.matchAll(MATH_RE)) {
    const index = match.index ?? 0;
    result += text.slice(cursor, index);
    const display = match[1] !== undefined;
    const tex = display ? match[1] : (match[2] ?? "");
    result += wrapAsCodeSpan(`${MATH_SENTINEL}${display ? "d" : "i"}${tex}`);
    cursor = index + match[0].length;
  }

  return result + text.slice(cursor);
}

/**
 * Rewrite `\(inline\)` and `\[display\]` into code spans the renderer can
 * recognise, leaving author code and every dollar sign untouched.
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

/** Decode a code span's content, or `null` when it is ordinary code. */
export function readMathPayload(
  content: string,
): { tex: string; display: boolean } | null {
  if (!content.startsWith(MATH_SENTINEL)) return null;
  return { display: content[1] === "d", tex: content.slice(2) };
}
