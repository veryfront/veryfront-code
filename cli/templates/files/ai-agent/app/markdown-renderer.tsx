"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import katex from "katex";
import type { MarkdownRendererProps } from "veryfront/markdown";
import { normalizeLatexDelimiters } from "./latex-delimiters.ts";

/**
 * Render one `remark-math` node with KaTeX.
 *
 * `rehype-katex` is deliberately not used. It reparses KaTeX's output through
 * `hast-util-from-html-isomorphic`, which selects its browser branch under this
 * runtime and fails server-side with "DOMParser is not defined", taking the
 * whole page render down with it. `katex.renderToString` is pure string work
 * with no DOM, so it is safe in SSR and in the browser alike.
 *
 * The markup is trusted because KaTeX generated it: input is escaped during
 * rendering, `trust` defaults to false so `\href` and friends stay inert, and
 * `throwOnError: false` turns a bad expression into a visible KaTeX error
 * instead of a failed render.
 */
function MathCode(
  { className, children, ...props }: {
    className?: string;
    children?: React.ReactNode;
    [key: string]: unknown;
  },
): React.JSX.Element {
  const classes = className ?? "";
  const isDisplay = classes.includes("math-display");

  if (!isDisplay && !classes.includes("math-inline")) {
    return <code className={className} {...props}>{children}</code>;
  }

  const html = katex.renderToString(String(children ?? ""), {
    displayMode: isDisplay,
    throwOnError: false,
  });

  return isDisplay
    ? <div dangerouslySetInnerHTML={{ __html: html }} />
    : <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Rich Markdown for assistant answers.
 *
 * `veryfront/markdown` presents plain source until a renderer is installed, so
 * this component supplies one. Swap in any renderer that accepts
 * `MarkdownRendererProps` to change how answers are parsed and rendered.
 *
 * `normalizeLatexDelimiters` runs before parsing because `\(` and `\[` cannot
 * survive it: CommonMark reads a backslash before ASCII punctuation as a
 * character escape, so `\(x\)` reaches the syntax tree as plain `(x)` and no
 * later plugin can recover it. That same pass is what makes dollar-delimited
 * maths safe here, by escaping every dollar the author wrote so the money in
 * "totals $99.71" is never mistaken for a formula.
 */
export function MarkdownRenderer({ source }: MarkdownRendererProps): React.JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      components={{ code: MathCode }}
    >
      {normalizeLatexDelimiters(source)}
    </ReactMarkdown>
  );
}
