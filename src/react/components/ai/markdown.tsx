import * as React from "react";
import { cn } from "./theme.ts";
import { isBrowserEnvironment } from "#veryfront/platform/compat/runtime.ts";
import { validateTrustedHtml } from "#veryfront/security/client/html-sanitizer.ts";
import { RichCodeBlock } from "./chat/components/code-block.tsx";

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

export interface CodeBlockProps {
  language: string | undefined;
  code: string;
  inline?: boolean;
}

const ESM_REACT_MARKDOWN =
  "https://esm.sh/react-markdown@9.0.3?external=react&target=es2022&pin=v135";
const ESM_REMARK_GFM = "https://esm.sh/remark-gfm@4.0.1?target=es2022&pin=v135";
const ESM_REHYPE_HIGHLIGHT = "https://esm.sh/rehype-highlight@7.0.2?target=es2022&pin=v135";
const ESM_MERMAID = "https://esm.sh/mermaid@11.4.1?pin=v135";

const dynamicImport = new Function("url", "return import(url)") as (url: string) => Promise<any>;

// deno-lint-ignore no-explicit-any
let ReactMarkdown: any = null;
// deno-lint-ignore no-explicit-any
let remarkGfm: any = null;
// deno-lint-ignore no-explicit-any
let rehypeHighlight: any = null;

// deno-lint-ignore no-explicit-any
let mermaidPromise: Promise<any> | null = null;
// deno-lint-ignore no-explicit-any
let mermaidModule: any = null;

async function loadMermaid(): Promise<any | null> {
  if (!isBrowserEnvironment()) return null;
  if (mermaidModule) return mermaidModule;

  mermaidPromise ??= dynamicImport(ESM_MERMAID);
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
      <pre className="my-4 p-4 bg-[var(--accent)] rounded-lg overflow-auto">
        <code>{code}</code>
      </pre>
    );
  }

  if (error) {
    return (
      <div className="my-4 p-4 bg-red-50 rounded-lg text-red-600 text-sm">
        <p className="font-medium">Mermaid Error</p>
        <p>{error}</p>
        <pre className="mt-2 text-xs overflow-auto">{code}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-4 p-4 bg-[var(--accent)] rounded-lg animate-pulse">
        <div className="h-32 flex items-center justify-center text-[var(--muted-foreground)]">
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
      <code className="bg-[var(--accent)] px-1.5 py-0.5 rounded text-sm font-mono">
        {code}
      </code>
    );
  }

  if (enableMermaid && language === "mermaid") {
    return <MermaidDiagram code={code} />;
  }

  return <RichCodeBlock language={language} code={code} />;
}

function FallbackMarkdown({
  children,
  className,
}: Pick<MarkdownProps, "children" | "className">): React.ReactElement {
  return (
    <div className={cn("prose prose-sm max-w-none", className)}>
      <p className="whitespace-pre-wrap">{children}</p>
    </div>
  );
}

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
          dynamicImport(ESM_REACT_MARKDOWN),
          dynamicImport(ESM_REMARK_GFM),
          dynamicImport(ESM_REHYPE_HIGHLIGHT),
        ]);

        ReactMarkdown = rmModule.default;
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
    <div className={cn("prose prose-sm max-w-none", className)}>
      <ReactMarkdown
        remarkPlugins={remarkGfm ? [remarkGfm] : []}
        rehypePlugins={rehypeHighlight ? [rehypeHighlight] : []}
        components={{
          // deno-lint-ignore no-explicit-any
          code(props: any) {
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
          // deno-lint-ignore no-explicit-any
          table(props: any) {
            return (
              <div className="my-4 overflow-auto">
                <table className="min-w-full divide-y divide-[var(--border)]">
                  {props.children}
                </table>
              </div>
            );
          },
          // deno-lint-ignore no-explicit-any
          a(props: any) {
            return (
              <a
                href={props.href}
                className="text-blue-600 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {props.children}
              </a>
            );
          },
          // deno-lint-ignore no-explicit-any
          blockquote(props: any) {
            return (
              <blockquote className="border-l-4 border-[var(--border)] pl-4 my-4 text-[var(--card-foreground)] italic">
                {props.children}
              </blockquote>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
