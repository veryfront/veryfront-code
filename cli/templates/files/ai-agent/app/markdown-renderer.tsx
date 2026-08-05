"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import katex from "katex";
import type { MarkdownRendererProps } from "veryfront/markdown";
import { normalizeLatexDelimiters, readMathPayload } from "./latex-delimiters.ts";

/**
 * Render a code span, or the maths hiding inside one.
 *
 * `normalizeLatexDelimiters` parks each expression in a code span, because code
 * spans are the only Markdown construct whose content is literal. That is what
 * lets `\$` and `\times` arrive here exactly as the model wrote them.
 *
 * KaTeX is called directly rather than through `rehype-katex`, which reparses
 * its output with `hast-util-from-html-isomorphic`; that picks a browser branch
 * under this runtime and fails server-side with "DOMParser is not defined",
 * taking the whole page render down. `renderToString` is pure string work.
 *
 * The markup is trusted because KaTeX produced it: it escapes its own input,
 * `trust` defaults to false so `\href` stays inert, and `throwOnError: false`
 * shows a bad expression as an error instead of failing the render.
 *
 * Display maths renders as an inline-block rather than a `div`, because this
 * sits inside a paragraph and a `div` there is invalid nesting.
 */
function MarkdownCode(
  { className, children, ...props }: {
    className?: string;
    children?: React.ReactNode;
    [key: string]: unknown;
  },
): React.JSX.Element {
  const math = readMathPayload(String(children ?? ""));

  if (math === null) {
    return <code className={className} {...props}>{children}</code>;
  }

  const html = katex.renderToString(math.tex, {
    displayMode: math.display,
    throwOnError: false,
  });

  return (
    <span
      style={math.display ? { display: "block" } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Rich Markdown for assistant answers.
 *
 * `veryfront/markdown` presents plain source until a renderer is installed, so
 * this component supplies one. Swap in any renderer that accepts
 * `MarkdownRendererProps` to change how answers are parsed and rendered.
 */
export function MarkdownRenderer({ source }: MarkdownRendererProps): React.JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{ code: MarkdownCode }}
    >
      {normalizeLatexDelimiters(source)}
    </ReactMarkdown>
  );
}
