/**
 * Normalize the LaTeX delimiters remark-math does not recognize.
 *
 * Models routinely emit `\(inline\)` and `\[display\]` rather than the dollar
 * delimiters remark-math parses, so that output would otherwise reach the page
 * as literal backslashes. Rewriting happens on the source before parsing, which
 * means it must leave code alone: `\(` inside a fence or a code span is content,
 * not math.
 *
 * @module extensions/ext-markdown-react/tex-delimiters
 */

/**
 * Fenced code blocks and inline code spans, matched so the rewrite can skip
 * them. The fence arm runs first, so a `` ` `` inside a fence cannot open a
 * span.
 */
const CODE_REGION =
  /(?:^|\n)[ ]{0,3}(`{3,}|~{3,})[^\n]*(?:[\s\S]*?\n[ ]{0,3}\1[ \t]*(?=\n|$)|[\s\S]*$)|`+[^`]*`+/g;

/**
 * Rewrite `\(...\)` and `\[...\]` outside code into remark-math delimiters.
 *
 * Both forms produce `$$`, never a single `$`: single-dollar text math is off,
 * so that a chat answer quoting `$84.50` and `$33.24` stays currency rather than
 * turning the text between the two amounts into an equation. Display math is
 * emitted on its own lines, which is what makes remark-math treat it as a block.
 */
function rewriteDelimiters(text: string): string {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, body: string) => `\n\n$$\n${body.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, body: string) => `$$${body.trim()}$$`);
}

/**
 * Return `source` with TeX-style delimiters converted to the dollar delimiters
 * remark-math parses. Code fences and code spans are preserved verbatim.
 */
export function normalizeTexDelimiters(source: string): string {
  if (!source.includes("\\(") && !source.includes("\\[")) return source;

  let out = "";
  let last = 0;
  for (const match of source.matchAll(CODE_REGION)) {
    out += rewriteDelimiters(source.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + rewriteDelimiters(source.slice(last));
}
