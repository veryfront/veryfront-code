import * as React from "react";
import { cn } from "../../theme.ts";
import { CheckIcon, CopyIcon } from "../../icons/index.ts";

export interface MessageActionsProps {
  content: string;
  className?: string;
}

export function MessageActions({
  content,
  className,
}: MessageActionsProps): React.ReactElement {
  const [copied, setCopied] = React.useState(false);

  const setCopiedWithTimeout = React.useCallback((): void => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const fallbackCopy = React.useCallback((): void => {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }, [content]);

  const handleCopy = React.useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      // Fallback for older browsers
      fallbackCopy();
    } finally {
      setCopiedWithTimeout();
    }
  }, [content, fallbackCopy, setCopiedWithTimeout]);

  return (
    <div className={cn("flex items-center gap-1 mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity", className)}>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center justify-center size-7 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
        title={copied ? "Copied!" : "Copy to clipboard"}
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </button>
    </div>
  );
}
