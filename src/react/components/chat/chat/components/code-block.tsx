import * as React from "react";
import { cn } from "../../theme.ts";
import { CheckIcon, CopyIcon } from "../../icons/index.ts";

/** Props accepted by code block. */
export interface CodeBlockProps {
  language?: string;
  code: string;
  inline?: boolean;
  className?: string;
}

/**
 * Render rich code block.
 *
 * @deprecated Use the shared `CodeBlock` primitive (`chat/ui/code-block.tsx`)
 * instead — it does real shiki syntax highlighting, an icon-only copy button
 * with tooltip, a file-type/language label, collapsible + mermaid support. This
 * plain `<pre>` fork (no highlighting) is kept only for back-compat and will be
 * removed. `Markdown` already renders fenced blocks through `CodeBlock`.
 */
export const RichCodeBlock = React.forwardRef<HTMLDivElement, CodeBlockProps>(
  function RichCodeBlock({ language, code, inline, className }, ref) {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = React.useCallback(async (): Promise<void> => {
      try {
        await navigator.clipboard.writeText(code);
      } catch (_) {
        /* expected: clipboard API unavailable, using fallback */
        const textarea = document.createElement("textarea");
        textarea.value = code;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, [code]);

    if (inline) {
      return (
        <code
          className={cn(
            "rounded-[var(--radius-xs)] bg-[var(--accent)] px-1 py-0.5 font-mono text-sm font-medium",
            className,
          )}
        >
          {code}
        </code>
      );
    }

    return (
      <div
        ref={ref}
        className={cn(
          "my-4 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--edge)]",
          className,
        )}
      >
        <div className="flex items-center justify-between px-4 py-2 text-xs text-[var(--faint)]">
          <span className="font-mono font-medium">{language || "text"}</span>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 text-[var(--faint)] transition-colors hover:text-[var(--foreground)]"
          >
            {copied
              ? (
                <>
                  <CheckIcon className="size-3.5" />
                  <span>Copied</span>
                </>
              )
              : (
                <>
                  <CopyIcon className="size-3.5" />
                  <span>Copy</span>
                </>
              )}
          </button>
        </div>
        <pre className="overflow-auto bg-[var(--secondary)] p-4 text-sm text-[var(--foreground)] [&_.hljs]:bg-transparent [&_.hljs]:p-0">
          <code className={language ? `language-${language}` : undefined}>{code}</code>
        </pre>
      </div>
    );
  },
);
RichCodeBlock.displayName = "RichCodeBlock";
