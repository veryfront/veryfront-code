import * as React from "react";
import { cn } from "../../theme.ts";

export interface Source {
  title: string;
  url?: string;
  score?: number;
  snippet?: string;
}

export interface SourcesProps {
  sources: Source[];
  className?: string;
  onSourceClick?: (source: Source, index: number) => void;
}

export function Sources({
  sources,
  className,
  onSourceClick,
}: SourcesProps): React.ReactElement | null {
  if (sources.length === 0) return null;

  return (
    <div className={cn("mt-3 pt-3 border-t border-neutral-200 dark:border-neutral-800", className)}>
      <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Sources</p>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((source, index) => (
          <button
            key={`${source.title}-${index}`}
            type="button"
            onClick={() => onSourceClick?.(source, index)}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs",
              "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300",
              "hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors",
              onSourceClick && "cursor-pointer",
              !onSourceClick && "cursor-default",
            )}
          >
            <span className="flex items-center justify-center size-4 rounded bg-neutral-200 dark:bg-neutral-700 text-[10px] font-medium text-neutral-600 dark:text-neutral-300">
              {index + 1}
            </span>
            <span className="truncate max-w-[160px]">{source.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
