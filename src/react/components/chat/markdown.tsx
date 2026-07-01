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
const ESM_REHYPE_HIGHLIGHT = "https://esm.sh/rehype-highlight@7.0.2?target=es2022&pin=v135";
const ESM_MERMAID = "https://esm.sh/mermaid@11.4.1?pin=v135";
const MARKDOWN_CONTAINER_CLASS =
  "prose max-w-none min-w-0 overflow-hidden break-words text-base leading-relaxed text-[var(--foreground)] [overflow-wrap:anywhere] prose-headings:font-medium prose-strong:font-medium prose-a:text-[var(--foreground)] prose-a:underline prose-a:underline-offset-4 hover:prose-a:no-underline prose-inline-code:rounded-[var(--radius-xs)] prose-inline-code:bg-[var(--accent)] prose-inline-code:px-1 prose-inline-code:py-0.5 prose-inline-code:font-mono prose-inline-code:font-medium prose-inline-code:text-[var(--foreground)] prose-pre:rounded-[var(--radius-lg)] prose-pre:bg-[var(--secondary)] prose-pre:text-[var(--foreground)] prose-hr:border-[var(--edge-medium)] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_*]:max-w-full";

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

/** Props passed by react-markdown to a custom `code` renderer. */
interface CodeRendererProps {
  className?: string;
  children?: React.ReactNode;
  node?: { position?: { start?: { line?: number } } };
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
let rehypeHighlight: MarkdownPlugin | null = null;

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
        setError(error instanceof Error ? error.message : "Failed to render diagram");
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

function CodeBlock({
  language,
  code,
  inline,
  enableMermaid,
  renderCodeBlock,
}: CodeBlockProps & {
  enableMermaid: boolean;
  renderCodeBlock?: MarkdownProps["renderCodeBlock"];
}): React.ReactElement {
  if (renderCodeBlock) {
    return <>{renderCodeBlock({ language, code, inline })}</>;
  }

  if (inline) {
    return (
      <code className="rounded-[var(--radius-xs)] bg-[var(--accent)] px-1 py-0.5 font-mono text-sm font-medium">
        {code}
      </code>
    );
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
        const [rmModule, gfmModule, highlightModule] = await Promise.all([
          importFromUrl<DefaultModule<unknown>>(ESM_REACT_MARKDOWN),
          importFromUrl<DefaultModule<unknown>>(ESM_REMARK_GFM),
          importFromUrl<DefaultModule<unknown>>(ESM_REHYPE_HIGHLIGHT),
        ]);

        ReactMarkdown = rmModule.default as ReactMarkdownComponent;
        remarkGfm = gfmModule.default;
        rehypeHighlight = highlightModule.default;
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
        rehypePlugins={rehypeHighlight ? [rehypeHighlight] : []}
        components={{
          code(props: CodeRendererProps) {
            const { className: codeClassName, children: codeChildren, node } = props;
            const match = /language-(\w+)/.exec(codeClassName || "");
            const language = match ? match[1] : undefined;
            const code = String(codeChildren).replace(/\n$/, "");
            const isInline = !node?.position?.start?.line;

            return (
              <CodeBlock
                language={language}
                code={code}
                inline={isInline}
                enableMermaid={enableMermaid}
                renderCodeBlock={renderCodeBlock}
              />
            );
          },
          table(props: BlockRendererProps) {
            return (
              <div className="my-4 max-w-full overflow-x-auto rounded-[var(--radius-md)] border border-[var(--outline-border)]">
                <table className="w-full divide-y divide-[var(--outline-border)]">
                  {props.children}
                </table>
              </div>
            );
          },
          a(props: AnchorRendererProps) {
            return (
              <a
                href={props.href}
                className="break-words text-blue-600 hover:underline [overflow-wrap:anywhere]"
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
