import * as React from "react";
import { cn } from "../../theme.ts";
import { CheckIcon, CopyIcon, RefreshCwIcon } from "../../icons/index.ts";

const ACTION_BUTTON =
  "inline-flex items-center justify-center size-7 rounded-full text-[var(--faint)] transition-colors hover:bg-[var(--tertiary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";

/** Props accepted by message actions. */
export interface MessageActionsProps {
  content: string;
  className?: string;
  /** When provided, renders an edit button that calls this handler */
  onEdit?: (content: string) => void;
  /** When provided, renders a regenerate button that calls this handler */
  onRegenerate?: () => void;
}

/** Render message actions. */
export const MessageActions = React.forwardRef<
  HTMLDivElement,
  MessageActionsProps
>(
  function MessageActions({ content, className, onEdit, onRegenerate }, ref) {
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
      } catch (_) {
        /* expected: clipboard API unavailable in older browsers */
        fallbackCopy();
      } finally {
        setCopiedWithTimeout();
      }
    }, [content, fallbackCopy, setCopiedWithTimeout]);

    return (
      <div
        ref={ref}
        className={cn(
          // No vertical margin here — the footer row owns spacing/alignment so
          // the buttons stay centered with the token count beside them.
          "flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-all duration-200",
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
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            className={ACTION_BUTTON}
            title="Regenerate response"
            aria-label="Regenerate response"
          >
            <RefreshCwIcon className="size-3.5" />
          </button>
        )}
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
