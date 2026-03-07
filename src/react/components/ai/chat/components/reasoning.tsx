import * as React from "react";
import { cn } from "../../theme.ts";
import { Markdown } from "../../markdown.tsx";
import { BrainIcon, ChevronDownIcon } from "../../icons/index.ts";
import { Shimmer } from "./animations.tsx";

type ReasoningCardProps = {
  text: string;
  isStreaming?: boolean;
  className?: string;
};

export const ReasoningCard = React.forwardRef<HTMLDivElement, ReasoningCardProps>(
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
      <div ref={ref} className={cn("not-prose mb-4", className)}>
        <button
          type="button"
          onClick={() => {
            userToggledRef.current = true;
            setIsOpen((open) => !open);
          }}
          className="flex w-full items-center gap-2 text-[var(--input-placeholder)] text-sm transition-colors hover:text-[var(--foreground)]"
        >
          <BrainIcon className="size-4" />
          {label}
          <ChevronDownIcon
            className={cn("size-4 transition-transform", isOpen && "rotate-180")}
          />
        </button>

        {isOpen
          ? (
            <div className="mt-4 text-sm text-[var(--muted-foreground)] border-l-2 border-[var(--border)] pl-4 ml-2">
              <Markdown className="text-sm">{text}</Markdown>
            </div>
          )
          : null}
      </div>
    );
  },
);
ReasoningCard.displayName = "ReasoningCard";
