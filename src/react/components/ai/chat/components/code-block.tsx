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
            "bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono",
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
          "my-4 rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800",
          className,
        )}
      >
        <div className="flex items-center justify-between px-4 py-2 bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 text-xs">
          <span className="font-mono font-medium">{language || "text"}</span>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
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
        <pre className="p-4 bg-neutral-50 dark:bg-neutral-900 overflow-auto text-sm">
        <code className={language ? `language-${language} hljs` : "hljs"}>{code}</code>
        </pre>
      </div>
    );
  },
);
RichCodeBlock.displayName = "RichCodeBlock";
