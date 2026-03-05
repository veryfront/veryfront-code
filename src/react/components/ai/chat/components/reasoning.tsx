import * as React from "react";
import { cn } from "../../theme.ts";
import { Markdown } from "../../markdown.tsx";
import { BrainIcon, ChevronDownIcon } from "../../icons/index.ts";
import { Shimmer } from "./animations.tsx";

export type ReasoningCardProps = {
  text: string;
  isStreaming?: boolean;
  className?: string;
};

export const ReasoningCard = React.forwardRef<HTMLDivElement, ReasoningCardProps>(
  function ReasoningCard({ text, isStreaming = false, className }, ref) {
    const [isOpen, setIsOpen] = React.useState(true);

    React.useEffect(() => {
      if (isStreaming || !isOpen) return;

      const timer = setTimeout(() => setIsOpen(false), 1000);
      return () => clearTimeout(timer);
    }, [isStreaming, isOpen]);

    const label = isStreaming ? <Shimmer>Thinking...</Shimmer> : <span>Thought process</span>;

    return (
      <div ref={ref} className={cn("not-prose mb-4", className)}>
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          className="flex w-full items-center gap-2 text-neutral-400 dark:text-neutral-500 text-sm transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
        >
          <BrainIcon className="size-4" />
          {label}
          <ChevronDownIcon
            className={cn("size-4 transition-transform", isOpen && "rotate-180")}
          />
        </button>

        {isOpen
          ? (
            <div className="mt-4 text-sm text-neutral-500 dark:text-neutral-400 border-l-2 border-neutral-200 dark:border-neutral-700 pl-4 ml-2">
              <Markdown className="text-sm">{text}</Markdown>
            </div>
          )
          : null}
      </div>
    );
  },
);
ReasoningCard.displayName = "ReasoningCard";
