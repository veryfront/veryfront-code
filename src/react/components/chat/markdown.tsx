import * as React from "react";
import ReactMarkdown, {
  type Components,
  type Options as ReactMarkdownOptions,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "./theme.ts";
import { CodeBlock as SyntaxCodeBlock } from "../ui/code-block.tsx";

/**
 * Custom element renderers keyed by HTML tag name, the shape of
 * react-markdown's `Components` option.
 */
export type { Components };

type UpstreamPluginList = NonNullable<
  ReactMarkdownOptions["remarkPlugins"]
>;

/**
 * Readonly remark/rehype plugin list accepted by react-markdown.
 *
 * Readonly is intentional and preserves the existing public contract for
 * frozen application configuration. A mutable copy is passed upstream.
 */
export type PluggableList = readonly UpstreamPluginList[number][];

/** Props accepted by markdown. */
export interface MarkdownProps {
  /** CommonMark/GFM source to render. */
  children: string;
  /** Additional class name for the outer container. */
  className?: string;
  /**
   * Replace the default fenced-code renderer. Inline code remains an ordinary
   * `<code>` element. The callback receives the fence language exactly as
   * authored and source text with only the parser-added final newline removed.
   */
  renderCodeBlock?: (props: CodeBlockProps) => React.ReactNode;
  /**
   * Custom element renderers merged OVER the built-in defaults (consumer
   * entries win). Lets callers override the anchor/table/heading/blockquote/etc
   * renderers, not just code fences. `renderCodeBlock` still handles the
   * `pre`/code path unless a `pre` entry is supplied here.
   */
  components?: Components;
  /**
   * Trusted remark plugins appended after the built-in GFM plugin. Plugins run
   * as application code and are not sandboxed.
   */
  remarkPlugins?: PluggableList;
  /**
   * Trusted rehype plugins. Plugins can alter the default HTML-safety
   * properties, so do not derive this list from untrusted input.
   */
  rehypePlugins?: PluggableList;
}

/** Props passed to a custom fenced-code renderer. */
export interface CodeBlockProps {
  /** Fence language identifier, or `undefined` for an unlabelled fence. */
  language: string | undefined;
  /** Fence source with meaningful leading and trailing whitespace preserved. */
  code: string;
  /** Always `false`; retained for renderer compatibility. */
  inline?: boolean;
}
// Self-contained prose styling. Studio's ChatMessageText leans on the
// `@tailwindcss/typography` `prose` plugin for element defaults (list markers,
// heading sizes, spacing). This package is dependency-light and must not
// require consumers to install that plugin, so the element styles are declared
// explicitly with arbitrary-variant descendant selectors — mirroring Studio's
// `variantStyles.default` (`prose-p:my-4 prose-ul:my-4 prose-li:my-1.5
// prose-h1:text-lg … prose-hr:my-5`). Tailwind's preflight strips list markers,
// so `list-disc`/`list-decimal` + padding are restored here.
const MARKDOWN_CONTAINER_CLASS = [
  "max-w-none min-w-0 overflow-hidden break-words text-base leading-relaxed text-[var(--foreground)] [overflow-wrap:anywhere]",
  // paragraph rhythm
  "[&_p]:my-4",
  // lists — restore markers + indentation preflight removes
  "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1.5 [&_li]:pl-1",
  "[&_ul_ul]:my-1 [&_ol_ol]:my-1 [&_ul_ol]:my-1 [&_ol_ul]:my-1",
  "[&_li>p]:my-0 [&_li_p]:my-2",
  // headings — Studio sizes; font-semibold (Inter reads lighter than Söhne)
  "[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-sm [&_h4]:font-semibold",
  // inline emphasis
  "[&_strong]:font-semibold [&_em]:italic",
  // inline code — `:not(pre)>code` targets bare inline code (block code lives
  // inside the CodeBlock's own <pre>). Mirrors Studio's `prose-inline-code`
  // (bg-accent, rounded-xs, px-1 py-0.5, font-mono font-medium).
  "[&_:not(pre)>code]:rounded-[var(--radius-xs)] [&_:not(pre)>code]:bg-[var(--accent)] [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.9em] [&_:not(pre)>code]:font-medium [&_:not(pre)>code]:text-[var(--foreground)]",
  // horizontal rule
  "[&_hr]:my-6 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-[var(--edge-medium)]",
  // margin reset for the container edges + width guard
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_*]:max-w-full",
].join(" ");

/** Props passed by react-markdown to a custom `pre` renderer. */
interface PreRendererProps {
  children?: React.ReactNode;
}

/** Props on the inner `<code>` element inside a `<pre>` (language + text). */
interface CodeElementProps {
  className?: string;
  children?: React.ReactNode;
}

/** Props passed by react-markdown to a custom `a` (anchor) renderer. */
interface AnchorRendererProps {
  href?: string;
  children?: React.ReactNode;
}

/** Props passed by react-markdown to block-level renderers (table, blockquote). */
interface BlockRendererProps {
  children?: React.ReactNode;
}

/** Props for `th`/`td` — carries GFM column alignment via inline `style`. */
interface TableCellProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Recursively flatten a react-markdown child tree to plain text. Fenced code
 * arrives as a string, but some remark/rehype plugins wrap it in nested
 * element nodes; naive `String(children)` on those yields "[object Object]".
 * Walking the tree keeps the raw source text intact for the shiki-based
 * CodeBlock to highlight itself.
 */
function extractText(node: React.ReactNode): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

/**
 * Render a fenced (block) code region. Inline code is NOT handled here — it
 * renders as a bare `<code>` styled by the container class (see
 * `MARKDOWN_CONTAINER_CLASS`), matching Studio, which overrides `pre` (not
 * `code`) so only block code reaches the syntax highlighter.
 */
function CodeBlock({
  language,
  code,
  renderCodeBlock,
}: Omit<CodeBlockProps, "inline"> & {
  renderCodeBlock?: MarkdownProps["renderCodeBlock"];
}): React.ReactElement {
  if (renderCodeBlock) {
    return <>{renderCodeBlock({ language, code, inline: false })}</>;
  }

  // Block fences render through the shared syntax-highlight primitive (shiki +
  // copy + language label + collapsible), forked from Studio's ChatCodeBlock.
  return <SyntaxCodeBlock code={code} language={language} />;
}

/**
 * Render CommonMark and GitHub Flavored Markdown synchronously.
 *
 * Headings, emphasis, lists, tables, task lists, links, and custom components
 * are present in server output. Fenced source also renders during SSR; Shiki
 * highlighting and Mermaid SVGs progressively enhance it in the browser.
 * Raw HTML and unsafe link protocols are excluded by react-markdown's default
 * pipeline unless a caller intentionally changes that pipeline with plugins.
 */
export function Markdown({
  children,
  className,
  renderCodeBlock,
  components,
  remarkPlugins,
  rehypePlugins,
}: MarkdownProps): React.ReactElement {
  const builtinComponents: Components = {
    // Override `pre` (not `code`) — Studio's approach. Block code arrives
    // as `<pre><code class="language-x">…</code></pre>`; we pull the
    // language + text off the inner (default-rendered) `<code>` element
    // and hand it to the syntax highlighter. Inline code is left as a bare
    // `<code>`, styled by the container class.
    pre(props: PreRendererProps) {
      const child = React.Children.toArray(props.children).find(
        React.isValidElement,
      ) as React.ReactElement<CodeElementProps> | undefined;
      if (!child) {
        return <pre>{props.children}</pre>;
      }
      const codeClassName = child.props.className;
      const match = /(?:^|\s)language-([^\s]+)/.exec(codeClassName || "");
      const language = match ? match[1] : undefined;
      const code = extractText(child.props.children).replace(/\n$/, "");

      return (
        <CodeBlock
          language={language}
          code={code}
          renderCodeBlock={renderCodeBlock}
        />
      );
    },
    table(props: BlockRendererProps) {
      // Borders live on the rows, scoped by section so the header always
      // keeps its divider (a `tr:last-child` rule would wrongly strip the
      // lone header row in <thead>). Only the final body row drops its
      // border so it doesn't double up with the container edge.
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
        <td
          style={props.style}
          className="px-4 py-2 text-[var(--foreground)]"
        >
          {props.children}
        </td>
      );
    },
    a(props: AnchorRendererProps) {
      // Studio: links are foreground (black), underlined, and drop the
      // underline on hover — not the default browser blue.
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
        <blockquote className="border-l-4 border-[var(--outline-border)] pl-4 my-4 text-[var(--foreground)] italic">
          {props.children}
        </blockquote>
      );
    },
  };

  // Consumer entries win over the built-ins (merge order matters). Cast is
  // needed because the built-ins are typed with local prop interfaces while
  // `components` uses react-markdown's `Components`.
  const mergedComponents = {
    ...builtinComponents,
    ...components,
  } satisfies Components;

  return (
    <div className={cn(MARKDOWN_CONTAINER_CLASS, className)}>
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          ...(remarkPlugins ?? []),
        ]}
        rehypePlugins={rehypePlugins ? [...rehypePlugins] : undefined}
        components={mergedComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
