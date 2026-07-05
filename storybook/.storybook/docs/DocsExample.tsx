import * as React from "react";
import { codeToHtml } from "shiki";
import { Check, Copy } from "./icons";
import { cn } from "./cn";
import { DocsSurface } from "./DocsSurface";

type DocsExampleDisplay = "code" | "preview" | "both";

interface DocsExampleProps {
  /** Preview content. Passed as a prop (not children) to prevent MDX paragraph wrapping. */
  preview?: React.ReactNode;
  code: string;
  className?: string;
  display?: DocsExampleDisplay;
  lang?: string;
}

function HighlightedCode({ html }: { html: string }) {
  return (
    <div
      className="overflow-x-auto text-[13px] leading-relaxed"
      // deno-lint-ignore react-no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
        className,
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function TabButton(
  { active, onClick, children }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  },
) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 text-xs font-normal rounded-full transition-colors cursor-pointer",
        active
          ? "bg-tint text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function CodePanel(
  { highlighted, trimmed }: { highlighted: string | null; trimmed: string },
) {
  return (
    <div>
      {highlighted
        ? <HighlightedCode html={highlighted} />
        : (
          <pre
            style={{ whiteSpace: "pre", padding: "1rem", margin: 0 }}
            className="overflow-x-auto text-[13px] leading-relaxed"
          >
            <code>{trimmed}</code>
          </pre>
        )}
    </div>
  );
}

function useTheme() {
  const [theme, setTheme] = React.useState<"light" | "dark">(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  });

  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(
        document.documentElement.getAttribute("data-theme") === "dark"
          ? "dark"
          : "light",
      );
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

const lineNumberStyles = `
  .docs-line-numbers code {
    counter-reset: line;
  }
  .docs-line-numbers code .line {
    counter-increment: line;
  }
  .docs-line-numbers code .line::before {
    content: counter(line);
    display: inline-block;
    width: 2rem;
    margin-right: 1rem;
    text-align: right;
    color: var(--muted-foreground);
    opacity: 0.4;
  }
`;

export function DocsExample(
  { preview, code, className, display = "both", lang = "tsx" }: DocsExampleProps,
) {
  const [view, setView] = React.useState<"preview" | "code">(
    display === "code" ? "code" : "preview",
  );
  const [highlighted, setHighlighted] = React.useState<string | null>(null);
  const theme = useTheme();

  const trimmed = code.trim();

  React.useEffect(() => {
    void codeToHtml(trimmed, {
      lang,
      theme: theme === "dark" ? "github-dark" : "github-light",
    }).then((html) => {
      // Force whitespace preservation — Storybook docs CSS overrides pre defaults
      const patched = html
        .replace(
          /<pre /,
          '<pre style="white-space:pre;margin:0;padding:1rem;background:transparent" ',
        )
        .replace(/<code>/, '<code style="white-space:pre">');
      setHighlighted(patched);
    });
  }, [trimmed, lang, theme]);

  if (display === "preview") {
    return (
      <DocsSurface filled={false}>
        <div
          className={cn(
            "p-6 [&_.h-screen]:!h-[33vh] [&_.h-screen]:!min-h-[18rem]",
            className,
          )}
        >
          {preview}
        </div>
      </DocsSurface>
    );
  }

  // Code-only: no header, line numbers, floating copy button
  if (display === "code") {
    return (
      <DocsSurface>
        <style>{lineNumberStyles}</style>
        <div className="relative docs-line-numbers">
          <CopyButton text={trimmed} className="absolute top-2 right-2 z-10" />
          <CodePanel highlighted={highlighted} trimmed={trimmed} />
        </div>
      </DocsSurface>
    );
  }

  // Both: header with tabs
  return (
    <DocsSurface filled={false}>
      <style>{lineNumberStyles}</style>
      <div className="flex items-center justify-between px-3 py-2 border-b border-outline-border bg-card">
        <div className="flex items-center gap-1">
          <TabButton
            active={view === "preview"}
            onClick={() => setView("preview")}
          >
            Preview
          </TabButton>
          <TabButton active={view === "code"} onClick={() => setView("code")}>
            Code
          </TabButton>
        </div>
        <CopyButton text={trimmed} />
      </div>
      {view === "preview"
        ? (
          <div
            className={cn(
              "p-8 [&_.h-screen]:!h-[33vh] [&_.h-screen]:!min-h-[18rem]",
              className,
            )}
            style={{
              backgroundImage:
                "linear-gradient(45deg, rgba(128,128,128,0.015) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.015) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.015) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.015) 75%)",
              backgroundSize: "16px 16px",
              backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
            }}
          >
            {preview}
          </div>
        )
        : (
          <div className="docs-line-numbers bg-card">
            <CodePanel highlighted={highlighted} trimmed={trimmed} />
          </div>
        )}
    </DocsSurface>
  );
}
