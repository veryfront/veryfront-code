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
    <div className={cn("flex items-center gap-1 mt-2", className)}>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
        title={copied ? "Copied!" : "Copy to clipboard"}
      >
        {copied
          ? (
            <>
              <CheckIcon className="size-3" />
              <span>Copied</span>
            </>
          )
          : (
            <>
              <CopyIcon className="size-3" />
              <span>Copy</span>
            </>
          )}
      </button>
    </div>
  );
}
