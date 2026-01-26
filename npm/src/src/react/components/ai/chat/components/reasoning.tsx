import * as dntShim from "../../../../../../_dnt.shims.js";
import * as React from "react";
import { cn } from "../../theme.js";
import { Markdown } from "../../markdown.js";
import { BrainIcon, ChevronDownIcon } from "../../icons/index.js";
import { Shimmer } from "./animations.js";

type ReasoningCardProps = {
  text: string;
  isStreaming?: boolean;
};

export function ReasoningCard({
  text,
  isStreaming = false,
}: ReasoningCardProps): React.JSX.Element {
  const [isOpen, setIsOpen] = React.useState(true);

  React.useEffect(() => {
    if (isStreaming || !isOpen) return;

    const timer = dntShim.setTimeout(() => setIsOpen(false), 1000);
    return () => clearTimeout(timer);
  }, [isStreaming, isOpen]);

  return (
    <div className="not-prose mb-4">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <BrainIcon className="size-4" />
        {isStreaming ? <Shimmer>Thinking...</Shimmer> : <span>Thought process</span>}
        <ChevronDownIcon
          className={cn("size-4 transition-transform", isOpen && "rotate-180")}
        />
      </button>

      {isOpen && (
        <div className="mt-4 text-sm text-muted-foreground border-l-2 border-muted pl-4 ml-2">
          <Markdown className="text-sm">{text}</Markdown>
        </div>
      )}
    </div>
  );
}
