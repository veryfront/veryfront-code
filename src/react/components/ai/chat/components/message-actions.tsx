import * as React from "react";
import { cn } from "../../theme.ts";
import { CheckIcon, CopyIcon } from "../../icons/index.ts";

const ACTION_BUTTON =
  "inline-flex items-center justify-center size-7 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md transition-all";

export interface MessageActionsProps {
  content: string;
  className?: string;
  /** When provided, renders an edit button that calls this handler */
  onEdit?: (content: string) => void;
}

export const MessageActions = React.forwardRef<HTMLDivElement, MessageActionsProps>(
  function MessageActions({ content, className, onEdit }, ref) {
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
      <div
        ref={ref}
        className={cn(
          "flex items-center gap-0.5 mt-1.5 opacity-0 group-hover/msg:opacity-100 transition-all duration-200",
          className,
        )}
      >
        <button
          type="button"
          onClick={handleCopy}
          className={ACTION_BUTTON}
          title={copied ? "Copied!" : "Copy to clipboard"}
          aria-label={copied ? "Copied!" : "Copy to clipboard"}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </button>
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(content)}
            className={ACTION_BUTTON}
            title="Edit message"
            aria-label="Edit message"
          >
            <svg
              className="size-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
        )}
      </div>
    );
  },
);
MessageActions.displayName = "MessageActions";
