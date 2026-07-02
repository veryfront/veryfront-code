import * as React from "react";
import { cn } from "./theme.ts";
import { isBrowserEnvironment } from "#veryfront/platform/compat/runtime.ts";
import { validateTrustedHtml } from "#veryfront/security/client/html-sanitizer.ts";
import { CodeBlock as SyntaxCodeBlock } from "./ui/code-block.tsx";

/** Props accepted by markdown. */
export interface MarkdownProps {
  /** Markdown content to render */
  children: string;
  /** Additional class name */
  className?: string;
  /** Enable mermaid diagram rendering (default: true, client-side only) */
  enableMermaid?: boolean;
  /** Custom code block renderer */
  renderCodeBlock?: (props: CodeBlockProps) => React.ReactNode;
}

/** Props accepted by code block. */
export interface CodeBlockProps {
  language: string | undefined;
  code: string;
  inline?: boolean;
}

const ESM_REACT_MARKDOWN =
  "https://esm.sh/react-markdown@9.0.3?target=es2022&pin=v135&deps=react@19.2.4";
const ESM_REMARK_GFM = "https://esm.sh/remark-gfm@4.0.1?target=es2022&pin=v135";
const ESM_MERMAID = "https://esm.sh/mermaid@11.4.1?pin=v135";
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

type DefaultModule<T> = { default: T };

type MermaidModule = {
  default: {
    initialize(config: {
      startOnLoad: boolean;
      theme: string;
      securityLevel: string;
    }): void;
    render(id: string, code: string): Promise<{ svg: string }>;
  };
};

/**
 * Opaque remark/rehype plugin handle. The plugin internals are not used
 * directly; they are only passed through to react-markdown.
 */
type MarkdownPlugin = unknown;

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

/** Minimal shape of the react-markdown default export used here. */
interface ReactMarkdownProps {
  remarkPlugins?: MarkdownPlugin[];
  rehypePlugins?: MarkdownPlugin[];
  components?: Record<string, (props: never) => React.ReactNode>;
  children?: string;
}

type ReactMarkdownComponent = (props: ReactMarkdownProps) => React.ReactElement;

async function importFromUrl<T>(url: string): Promise<T> {
  return await import(/* @vite-ignore */ url) as T;
}

let ReactMarkdown: ReactMarkdownComponent | null = null;
let remarkGfm: MarkdownPlugin | null = null;

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

let mermaidPromise: Promise<MermaidModule> | null = null;
let mermaidModule: MermaidModule | null = null;

async function loadMermaid(): Promise<MermaidModule | null> {
  if (!isBrowserEnvironment()) return null;
  if (mermaidModule) return mermaidModule;

  mermaidPromise ??= importFromUrl<MermaidModule>(ESM_MERMAID);
  mermaidModule = await mermaidPromise;

  mermaidModule.default.initialize({
    startOnLoad: false,
    theme: "neutral",
    securityLevel: "strict",
  });

  return mermaidModule;
}

function MermaidDiagram({ code }: { code: string }): React.ReactElement {
  const [svg, setSvg] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");

  React.useEffect(() => {
    if (!isBrowserEnvironment()) return;

    let cancelled = false;

    async function render(): Promise<void> {
      try {
        const mermaid = await loadMermaid();
        if (!mermaid) return;

        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        const { svg: renderedSvg } = await mermaid.default.render(id, code);

        if (cancelled) return;
        setSvg(validateTrustedHtml(renderedSvg, { strict: true }));
        setError("");
      } catch (error) {
        if (cancelled) return;
        setError(
          error instanceof Error ? error.message : "Failed to render diagram",
        );
      }
    }

    render();

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (!isBrowserEnvironment()) {
    return (
      <pre className="my-4 overflow-auto rounded-[var(--radius-lg)] bg-[var(--secondary)] p-4">
        <code>{code}</code>
      </pre>
    );
  }

  if (error) {
    return (
      <div className="my-4 rounded-[var(--radius-lg)] bg-red-50 p-4 text-sm text-red-600">
        <p className="font-medium">Mermaid Error</p>
        <p>{error}</p>
        <pre className="mt-2 text-xs overflow-auto">{code}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-4 animate-pulse rounded-[var(--radius-lg)] bg-[var(--secondary)] p-4">
        <div className="flex h-32 items-center justify-center text-[var(--faint)]">
          Loading diagram...
        </div>
      </div>
    );
  }

  return (
    <div
      className="my-4 flex justify-center overflow-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
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
  enableMermaid,
  renderCodeBlock,
}: Omit<CodeBlockProps, "inline"> & {
  enableMermaid: boolean;
  renderCodeBlock?: MarkdownProps["renderCodeBlock"];
}): React.ReactElement {
  if (renderCodeBlock) {
    return <>{renderCodeBlock({ language, code, inline: false })}</>;
  }

  if (enableMermaid && language === "mermaid") {
    return <MermaidDiagram code={code} />;
  }

  // Block fences render through the shared syntax-highlight primitive (shiki +
  // copy + language label + collapsible), forked from Studio's ChatCodeBlock.
  return <SyntaxCodeBlock code={code} language={language} />;
}

function FallbackMarkdown({
  children,
  className,
}: Pick<MarkdownProps, "children" | "className">): React.ReactElement {
  return (
    <div className={cn(MARKDOWN_CONTAINER_CLASS, className)}>
      <p className="whitespace-pre-wrap">{children}</p>
    </div>
  );
}

/** Render markdown. */
export function Markdown({
  children,
  className,
  enableMermaid = true,
  renderCodeBlock,
}: MarkdownProps): React.ReactElement {
  const [isLoaded, setIsLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      if (!ReactMarkdown) {
        const [rmModule, gfmModule] = await Promise.all([
          importFromUrl<DefaultModule<unknown>>(ESM_REACT_MARKDOWN),
          importFromUrl<DefaultModule<unknown>>(ESM_REMARK_GFM),
        ]);

        ReactMarkdown = rmModule.default as ReactMarkdownComponent;
        remarkGfm = gfmModule.default;
      }

      if (cancelled) return;
      setIsLoaded(true);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!isLoaded || !ReactMarkdown) {
    return <FallbackMarkdown className={className}>{children}</FallbackMarkdown>;
  }

  return (
    <div className={cn(MARKDOWN_CONTAINER_CLASS, className)}>
      <ReactMarkdown
        remarkPlugins={remarkGfm ? [remarkGfm] : []}
        components={{
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
            const match = /language-(\w+)/.exec(codeClassName || "");
            const language = match ? match[1] : undefined;
            const code = extractText(child.props.children).replace(/\n$/, "");

            return (
              <CodeBlock
                language={language}
                code={code}
                enableMermaid={enableMermaid}
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
        } as ReactMarkdownProps["components"]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
