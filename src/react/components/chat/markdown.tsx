import * as React from "react";
import ReactMarkdown, {
  type Components as ReactMarkdownComponents,
  type Options as ReactMarkdownOptions,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "./theme.ts";
import { CodeBlock as SyntaxCodeBlock } from "../ui/code-block.tsx";

/** Element renderers keyed by HTML tag name. Entries override built-in renderers. */
export type Components = {
  [TagName in keyof React.JSX.IntrinsicElements]?: React.ElementType<
    React.JSX.IntrinsicElements[TagName]
  >;
};

/** Read-only list of remark or rehype plugins accepted by Markdown. */
export type PluggableList = readonly (
  | ((...parameters: never[]) => unknown)
  | readonly [((...parameters: never[]) => unknown), ...unknown[]]
  | {
    readonly plugins?: PluggableList;
    readonly settings?: object;
  }
)[];

/** Props accepted by Markdown. */
export interface MarkdownProps {
  /** Markdown source to render. */
  children: string;
  /** Additional class name for the outer container. */
  className?: string;
  /** Custom renderer for fenced code blocks. */
  renderCodeBlock?: (props: CodeBlockProps) => React.ReactNode;
  /**
   * Custom element renderers merged over the built-in defaults. Consumer
   * entries take precedence. `renderCodeBlock` handles fenced code unless
   * this map supplies a `pre` renderer.
   */
  components?: Components;
  /** Trusted remark plugins appended after the built-in GFM plugin. */
  remarkPlugins?: PluggableList;
  /** Trusted rehype plugins appended to the processing pipeline. */
  rehypePlugins?: PluggableList;
}

/** Props passed to a custom fenced code block renderer. */
export interface CodeBlockProps {
  /** Language identifier parsed from the fenced code block. */
  language: string | undefined;
  /** Code contents without the trailing fence newline. */
  code: string;
  /** Whether the code is inline. Markdown currently calls this for blocks. */
  inline?: boolean;
}
// Keep prose styles self-contained so consumers do not need
// `@tailwindcss/typography`. Tailwind's preflight removes list markers, so the
// container restores markers and indentation explicitly.
const MARKDOWN_CONTAINER_CLASS = [
  "max-w-none min-w-0 overflow-hidden break-words text-base leading-relaxed text-[var(--foreground)] [overflow-wrap:anywhere]",
  // paragraph rhythm
  "[&_p]:my-4",
  // lists: restore markers and indentation preflight removes
  "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1.5 [&_li]:pl-1",
  "[&_ul_ul]:my-1 [&_ol_ol]:my-1 [&_ul_ol]:my-1 [&_ol_ul]:my-1",
  "[&_li>p]:my-0 [&_li_p]:my-2",
  // headings
  "[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-sm [&_h4]:font-semibold",
  // inline emphasis
  "[&_strong]:font-semibold [&_em]:italic",
  // `:not(pre)>code` targets inline code. Block code has its own `<pre>`.
  "[&_:not(pre)>code]:rounded-[var(--radius-xs)] [&_:not(pre)>code]:bg-[var(--accent)] [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.9em] [&_:not(pre)>code]:font-medium [&_:not(pre)>code]:text-[var(--foreground)]",
  // horizontal rule
  "[&_hr]:my-6 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-[var(--edge-medium)]",
  // margin reset for the container edges + width guard
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_*]:max-w-full",
].join(" ");

/** Props on the inner `<code>` element inside a `<pre>` (language + text). */
interface CodeElementProps {
  className?: string;
  children?: React.ReactNode;
}

type ReactMarkdownPlugins = NonNullable<ReactMarkdownOptions["remarkPlugins"]>;

function preparePlugins(plugins: PluggableList | undefined): ReactMarkdownPlugins {
  if (!plugins) return [];

  // Clone the read-only public representation into unified's mutable list.
  // The public structural type intentionally avoids leaking unified's private
  // declaration graph into Veryfront's generated API documentation.
  return plugins.map((plugin) =>
    Array.isArray(plugin) ? [...plugin] : plugin
  ) as ReactMarkdownPlugins;
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
 * Render a fenced code region. Inline code is not handled here. It
 * renders as a bare `<code>` styled by the container class, so only block code
 * reaches the syntax highlighter.
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

  // Block fences use the shared syntax-highlighted code primitive.
  return <SyntaxCodeBlock code={code} language={language} />;
}

/**
 * Render Markdown with GFM, syntax-highlighted code, and Mermaid diagrams.
 *
 * Raw HTML remains text and URLs use react-markdown's safe default transform.
 * Custom components and plugins execute as application code and can change
 * those defaults, so only pass implementations you trust.
 */
export function Markdown({
  children,
  className,
  renderCodeBlock,
  components,
  remarkPlugins,
  rehypePlugins,
}: MarkdownProps): React.ReactElement {
  const builtinComponents: ReactMarkdownComponents = {
    // Override `pre` rather than `code`. Block code arrives as
    // `<pre><code class="language-x">...</code></pre>`; pull the
    // language + text off the inner (default-rendered) `<code>` element
    // and hand it to the syntax highlighter. Inline code is left as a bare
    // `<code>`, styled by the container class.
    pre({ children: preChildren, node: _node, ...preProps }) {
      const child = React.Children.toArray(preChildren).find(
        (candidate): candidate is React.ReactElement<CodeElementProps> =>
          React.isValidElement<CodeElementProps>(candidate),
      );
      if (!child) {
        return <pre {...preProps}>{preChildren}</pre>;
      }
      const codeClassName = child.props.className;
      const match = /(?:^|\s)language-([^\s]+)(?:\s|$)/.exec(
        codeClassName || "",
      );
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
    table({ children: tableChildren, className, node: _node, ...tableProps }) {
      // Borders live on the rows, scoped by section so the header always
      // keeps its divider (a `tr:last-child` rule would wrongly strip the
      // lone header row in <thead>). Only the final body row drops its
      // border so it doesn't double up with the container edge.
      return (
        <div className="my-4 max-w-full overflow-x-auto rounded-[var(--radius-md)] border border-[var(--outline-border)]">
          <table
            {...tableProps}
            className={cn(
              "w-full text-sm [&_thead_tr]:border-b [&_thead_tr]:border-[var(--edge)] [&_tbody_tr]:border-b [&_tbody_tr]:border-[var(--edge)] [&_tbody_tr:last-child]:border-b-0",
              className,
            )}
          >
            {tableChildren}
          </table>
        </div>
      );
    },
    th({ children: cellChildren, className, node: _node, ...cellProps }) {
      return (
        <th
          {...cellProps}
          className={cn(
            "px-4 py-2 text-left font-medium text-[var(--foreground)]",
            className,
          )}
        >
          {cellChildren}
        </th>
      );
    },
    td({ children: cellChildren, className, node: _node, ...cellProps }) {
      return (
        <td
          {...cellProps}
          className={cn(
            "px-4 py-2 text-[var(--foreground)]",
            className,
          )}
        >
          {cellChildren}
        </td>
      );
    },
    a(props) {
      const {
        children: linkChildren,
        className: linkClassName,
        node: _node,
        ...anchorProps
      } = props;
      // Keep links consistent with the surrounding foreground color.
      return (
        <a
          {...anchorProps}
          className={cn(
            "break-words text-[var(--foreground)] underline underline-offset-4 hover:no-underline [overflow-wrap:anywhere]",
            linkClassName,
          )}
          target="_blank"
          rel="noopener noreferrer"
        >
          {linkChildren}
        </a>
      );
    },
    blockquote({
      children: quoteChildren,
      className,
      node: _node,
      ...quoteProps
    }) {
      return (
        <blockquote
          {...quoteProps}
          className={cn(
            "border-l-4 border-[var(--outline-border)] pl-4 my-4 text-[var(--foreground)] italic",
            className,
          )}
        >
          {quoteChildren}
        </blockquote>
      );
    },
  };

  // Consumer entries win over the built-ins because they are spread last.
  const mergedComponents = {
    ...builtinComponents,
    ...components,
  } satisfies ReactMarkdownComponents;

  return (
    <div className={cn(MARKDOWN_CONTAINER_CLASS, className)}>
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          ...preparePlugins(remarkPlugins),
        ]}
        rehypePlugins={preparePlugins(rehypePlugins)}
        components={mergedComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
