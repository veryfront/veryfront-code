import * as React from "react";
import { cn } from "../../theme.ts";
import { Markdown } from "../../markdown.tsx";
import { ChevronDownIcon } from "../../icons/index.ts";
import { Shimmer } from "./animations.tsx";

type ReasoningCardProps = {
  text: string;
  isStreaming?: boolean;
  className?: string;
};

/** Render reasoning card. */
export const ReasoningCard = React.forwardRef<
  HTMLDivElement,
  ReasoningCardProps
>(
  function ReasoningCard({ text, isStreaming = false, className }, ref) {
    const [isOpen, setIsOpen] = React.useState(true);
    const userToggledRef = React.useRef(false);

    React.useEffect(() => {
      if (isStreaming || !isOpen || userToggledRef.current) return;

      const timer = setTimeout(() => setIsOpen(false), 1000);
      return () => clearTimeout(timer);
    }, [isStreaming, isOpen]);

    const label = isStreaming ? <Shimmer>Thinking...</Shimmer> : <span>Thought process</span>;

    return (
      <div ref={ref} className={cn("not-prose mb-3", className)}>
        <button
          type="button"
          onClick={() => {
            userToggledRef.current = true;
            setIsOpen((open) => !open);
          }}
          className="flex w-full items-center gap-2 rounded-sm text-sm text-[var(--faint)] outline-none transition-colors hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-0"
        >
          {label}
          <ChevronDownIcon
            className={cn(
              "size-3.5 shrink-0 transition-transform duration-200",
              isOpen && "rotate-90",
            )}
          />
        </button>

        {isOpen
          ? (
            <div className="mt-2 text-sm text-[var(--foreground)]">
              <Markdown className="mb-0 space-y-2.5 text-sm">{text}</Markdown>
            </div>
          )
          : null}
      </div>
    );
  },
);
ReasoningCard.displayName = "ReasoningCard";
