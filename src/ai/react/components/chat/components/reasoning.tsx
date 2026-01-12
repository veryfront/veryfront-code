/**
 * Reasoning Card Component
 * @module ai/react/components/chat/components/reasoning
 */

import * as React from "react";
import { cn } from "../../theme.ts";
import { Markdown } from "../../markdown.tsx";
import { BrainIcon, ChevronDownIcon } from "../../icons/index.ts";
import { Shimmer } from "./animations.tsx";

/**
 * Reasoning card component - displays AI thinking/reasoning process
 * Styled to match AI Elements (https://ai-sdk.dev/elements)
 */
export function ReasoningCard({ text, isStreaming = false }: { text: string; isStreaming?: boolean }) {
  const [isOpen, setIsOpen] = React.useState(true);

  // Auto-close after streaming ends
  React.useEffect(() => {
    if (!isStreaming && isOpen) {
      const timer = setTimeout(() => {
        setIsOpen(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, isOpen]);

  return (
    <div className="not-prose mb-4">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <BrainIcon className="size-4" />
        {isStreaming ? <Shimmer>Thinking...</Shimmer> : <span>Thought process</span>}
        <ChevronDownIcon
          className={cn(
            "size-4 transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {/* Content */}
      {isOpen && (
        <div className="mt-4 text-sm text-muted-foreground border-l-2 border-muted pl-4 ml-2">
          <Markdown className="text-sm">{text}</Markdown>
        </div>
      )}
    </div>
  );
}
