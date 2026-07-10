import * as React from "react";
import { cn } from "../../theme.ts";

/** Public API contract for feedback value. */
export type FeedbackValue = "positive" | "negative";

/** Props accepted by message feedback. */
export interface MessageFeedbackProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick" | "className"> {
  messageId: string;
  feedback?: FeedbackValue | null;
  onFeedback: (messageId: string, feedback: FeedbackValue) => void;
  className?: string;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

const BUTTON_BASE =
  "inline-flex items-center justify-center size-7 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";

/** Render message feedback. */
export function MessageFeedback(
  { messageId, feedback, onFeedback, className, ref, ...props }: MessageFeedbackProps,
): React.ReactElement {
  return (
    <div
      ref={ref}
      {...props}
      className={cn("flex items-center gap-1", className)}
    >
      <button
        type="button"
        onClick={() => onFeedback(messageId, "positive")}
        className={cn(
          BUTTON_BASE,
          feedback === "positive"
            ? "text-emerald-500 bg-emerald-500/10"
            : "text-[var(--faint)] hover:bg-[var(--tertiary)] hover:text-emerald-500",
        )}
        title="Helpful"
      >
        <svg
          className="size-3.5"
          viewBox="0 0 24 24"
          fill={feedback === "positive" ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 10v12" />
          <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onFeedback(messageId, "negative")}
        className={cn(
          BUTTON_BASE,
          feedback === "negative"
            ? "text-red-500 bg-red-500/10"
            : "text-[var(--faint)] hover:bg-[var(--tertiary)] hover:text-[var(--destructive)]",
        )}
        title="Not helpful"
      >
        <svg
          className="size-3.5"
          viewBox="0 0 24 24"
          fill={feedback === "negative" ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17 14V2" />
          <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z" />
        </svg>
      </button>
    </div>
  );
}
MessageFeedback.displayName = "MessageFeedback";
