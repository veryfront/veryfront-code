import * as React from "react";
import { cn } from "../../theme.ts";
import { CheckIcon, CopyIcon } from "../../icons/index.ts";

export interface CodeBlockProps {
  language?: string;
  code: string;
  inline?: boolean;
  className?: string;
}

export const RichCodeBlock = React.forwardRef<HTMLDivElement, CodeBlockProps>(
  function RichCodeBlock({ language, code, inline, className }, ref) {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = React.useCallback(async (): Promise<void> => {
      try {
        await navigator.clipboard.writeText(code);
      } catch {
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
            "bg-[var(--accent)] px-1.5 py-0.5 rounded text-sm font-mono",
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
          "my-4 rounded-xl overflow-hidden border border-[var(--border)]",
          className,
        )}
      >
        <div className="flex items-center justify-between px-4 py-2 text-[var(--muted-foreground)] text-xs">
          <span className="font-mono font-medium">{language || "text"}</span>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 text-[var(--input-placeholder)] hover:text-[var(--foreground)] transition-colors"
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
        <pre className="p-4 text-[var(--foreground)] overflow-auto text-sm">
        <code className={language ? `language-${language}` : undefined}>{code}</code>
        </pre>
      </div>
    );
  },
);
RichCodeBlock.displayName = "RichCodeBlock";
