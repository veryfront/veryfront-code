/**
 * Rich Markdown renderer built on react-markdown and remark-gfm.
 *
 * Implements the `MarkdownRendererProps` contract from `veryfront/markdown`,
 * so it can be installed with `<MarkdownRendererProvider renderer={...}>` or
 * passed per instance. Parsing, sanitization, link policy, and fenced-code
 * presentation are owned here, not by core.
 *
 * This module is client-safe: it imports React and react-markdown only, never
 * the extension registry.
 *
 * @module extensions/ext-markdown-react/renderer
 */

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { CodeBlockProps, MarkdownRendererProps } from "veryfront/markdown";
import { normalizeTexDelimiters } from "./tex-delimiters.ts";

/** Props react-markdown passes to a custom `pre` renderer. */
interface PreRendererProps {
  children?: React.ReactNode;
}

/** Props on the inner `<code>` element inside a `<pre>` (language + text). */
interface CodeElementProps {
  className?: string;
  children?: React.ReactNode;
}

/** Props react-markdown passes to a custom `a` (anchor) renderer. */
interface AnchorRendererProps {
  href?: string;
  children?: React.ReactNode;
}

/** Props react-markdown passes to block-level renderers (table, blockquote). */
interface BlockRendererProps {
  children?: React.ReactNode;
}

/** Props for `th`/`td` — carries GFM column alignment via inline `style`. */
interface TableCellProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Minimal shape of the react-markdown default export used here. */
interface ReactMarkdownComponentProps {
  remarkPlugins?: unknown[];
  rehypePlugins?: unknown[];
  components?: Record<string, (props: never) => React.ReactNode>;
  children?: string;
}

const Markdown = ReactMarkdown as unknown as (
  props: ReactMarkdownComponentProps,
) => React.ReactElement;

/** Recursively read the text content of a rendered node tree. */
function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

/**
 * Render a fenced (block) code region. Inline code is not handled here: it
 * renders as a bare `<code>` styled by the Markdown container, because the
 * `pre` element is overridden rather than `code`.
 *
 * Presentation beyond the escaped source belongs to the caller. Chat passes its
 * own code block through `renderCodeBlock`; the fallback stays dependency-free
 * so this renderer never reaches back into framework UI.
 */
function FencedCode({
  language,
  code,
  renderCodeBlock,
}: Omit<CodeBlockProps, "inline"> & {
  renderCodeBlock?: (props: CodeBlockProps) => React.ReactNode;
}): React.ReactElement {
  if (renderCodeBlock) {
    return <>{renderCodeBlock({ language, code, inline: false })}</>;
  }
  return (
    <pre data-language={language}>
      <code className={language ? `language-${language}` : undefined}>{code}</code>
    </pre>
  );
}

/**
 * Element overrides applied under any caller-supplied `components`. Caller
 * entries win, so an application can restyle a single element without
 * reimplementing the rest.
 */
function buildComponents(
  renderCodeBlock?: (props: CodeBlockProps) => React.ReactNode,
): Record<string, (props: never) => React.ReactNode> {
  return {
    // Override `pre`, not `code`: block code arrives as
    // `<pre><code class="language-x">…</code></pre>`, so the language and text
    // come off the inner `<code>`. Inline code stays a bare `<code>`.
    pre(props: PreRendererProps) {
      const child = React.Children.toArray(props.children).find(
        React.isValidElement,
      ) as React.ReactElement<CodeElementProps> | undefined;
      if (!child) return <pre>{props.children}</pre>;

      // Language ids are not all word characters: `c++`, `objective-c`, and
      // `f#` are all valid fence infos, so match up to the next class boundary.
      const match = /language-([^\s]+)/.exec(child.props.className || "");
      const code = extractText(child.props.children).replace(/\n$/, "");
      return (
        <FencedCode
          language={match ? match[1] : undefined}
          code={code}
          renderCodeBlock={renderCodeBlock}
        />
      );
    },
    table(props: BlockRendererProps) {
      // Borders live on the rows, scoped by section so the header keeps its
      // divider. Only the final body row drops its border, so it does not
      // double up with the container edge.
      return (
        <div className="my-4 max-w-full overflow-x-auto rounded-[var(--radius-md)] border border-[var(--outline-border)]">
          <table className="w-full text-sm [&_thead_tr]:border-b [&_thead_tr]:border-[var(--edge)] [&_tbody_tr]:border-b [&_tbody_tr]:border-[var(--edge)] [&_tbody_tr:last-child]:border-b-0">
            {props.children}
          </table>
        </div>
      );
    },
    th(props: TableCellProps) {
      return (
        <th
          style={props.style}
          className="px-4 py-2 text-left font-medium text-[var(--foreground)]"
        >
          {props.children}
        </th>
      );
    },
    td(props: TableCellProps) {
      return (
        <td style={props.style} className="px-4 py-2 text-[var(--foreground)]">
          {props.children}
        </td>
      );
    },
    a(props: AnchorRendererProps) {
      return (
        <a
          href={props.href}
          className="break-words text-[var(--foreground)] underline underline-offset-4 hover:no-underline [overflow-wrap:anywhere]"
          target="_blank"
          rel="noopener noreferrer"
        >
          {props.children}
        </a>
      );
    },
    blockquote(props: BlockRendererProps) {
      return (
        <blockquote className="my-4 border-l-4 border-[var(--outline-border)] pl-4 text-[var(--foreground)] italic">
          {props.children}
        </blockquote>
      );
    },
  } as Record<string, (props: never) => React.ReactNode>;
}

/**
 * KaTeX emits MathML rather than its HTML-plus-CSS output, so math renders from
 * the markup alone. The HTML output would require the KaTeX stylesheet and its
 * web fonts, which this package must not force on every consumer.
 */
const KATEX_OPTIONS = {
  output: "mathml",
  // A malformed expression renders as the source text in an error colour rather
  // than throwing and taking the surrounding answer down with it.
  throwOnError: false,
} as const;

/**
 * Math delimiters are `$$…$$` only. Assistant answers quote currency constantly,
 * and single-dollar text math turns everything between two amounts (`$84.50` …
 * `$33.24`) into an equation. `\(…\)` and `\[…\]` are normalized to `$$` before
 * parsing, so the TeX forms models actually emit still render.
 */
const MATH_OPTIONS = { singleDollarTextMath: false } as const;

/**
 * Render Markdown source as semantic React elements: CommonMark, GFM tables,
 * task lists, strikethrough and autolinks, plus LaTeX math through KaTeX.
 *
 * react-markdown never injects raw HTML here (no `rehype-raw`), and its default
 * URL transform drops unsafe link protocols such as `javascript:`.
 */
export function MarkdownRenderer({
  source,
  components,
  renderCodeBlock,
}: MarkdownRendererProps): React.ReactElement {
  const merged = React.useMemo(() => ({
    ...buildComponents(renderCodeBlock),
    ...(components as Record<string, (props: never) => React.ReactNode> | undefined),
  }), [components, renderCodeBlock]);
  const normalized = React.useMemo(() => normalizeTexDelimiters(source), [source]);

  return (
    <Markdown
      remarkPlugins={[remarkGfm, [remarkMath, MATH_OPTIONS]]}
      rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
      components={merged}
    >
      {normalized}
    </Markdown>
  );
}
MarkdownRenderer.displayName = "ReactMarkdownRenderer";
