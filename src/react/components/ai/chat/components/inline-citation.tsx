import * as React from "react";
import type { Source } from "./sources.tsx";
import { cn } from "../../theme.ts";

export interface InlineCitationProps {
  index: number;
  source?: Source;
  className?: string;
  onClick?: (index: number) => void;
}

export function InlineCitation({
  index,
  source,
  className,
  onClick,
}: InlineCitationProps): React.ReactElement {
  const [showTooltip, setShowTooltip] = React.useState(false);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => onClick?.(index)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={cn(
          "inline-flex items-center justify-center",
          "size-4 rounded text-[10px] font-medium leading-none",
          "bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300",
          "hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors",
          "align-super -translate-y-0.5 mx-0.5",
          className,
        )}
      >
        {index + 1}
      </button>

      {showTooltip && source && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-64 pointer-events-none">
          <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-lg p-3 text-left">
            <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
              {source.title}
            </p>
            {source.url && (
              <p className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                {source.url}
              </p>
            )}
            {source.snippet && (
              <p className="text-xs text-neutral-600 dark:text-neutral-300 mt-1.5 line-clamp-3">
                {source.snippet}
              </p>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
