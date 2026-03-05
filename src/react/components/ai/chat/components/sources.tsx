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

export const Sources = React.forwardRef<HTMLDivElement, SourcesProps>(
  function Sources({ sources, className, onSourceClick }, ref) {
    if (sources.length === 0) return null;

    return (
      <div
        ref={ref}
        className={cn("mt-3 pt-3 border-t border-neutral-200 dark:border-neutral-800", className)}
      >
        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Sources</p>
        <div className="flex flex-wrap gap-1.5">
          {sources.map((source, index) => (
            <SourcePill
              key={`${source.title}-${index}`}
              source={source}
              index={index}
              onClick={onSourceClick ? () => onSourceClick(source, index) : undefined}
            />
          ))}
        </div>
      </div>
    );
  },
);
Sources.displayName = "Sources";

interface SourcePillProps {
  source: Source;
  index: number;
  onClick?: () => void;
}

function SourcePill({ source, index, onClick }: SourcePillProps): React.ReactElement {
  const [showPreview, setShowPreview] = React.useState(false);

  return (
    <span className="relative">
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setShowPreview(true)}
        onMouseLeave={() => setShowPreview(false)}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs",
          "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300",
          "hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors",
          onClick ? "cursor-pointer" : "cursor-default",
        )}
      >
        <span className="flex items-center justify-center size-4 rounded bg-neutral-200 dark:bg-neutral-700 text-[10px] font-medium text-neutral-600 dark:text-neutral-300">
          {index + 1}
        </span>
        <span className="truncate max-w-[160px]">{source.title}</span>
        {source.score != null && (
          <span className="flex items-center gap-1 shrink-0 ml-0.5">
            <span
              className={cn(
                "size-1.5 rounded-full",
                source.score >= 0.7
                  ? "bg-emerald-500"
                  : source.score >= 0.4
                  ? "bg-amber-500"
                  : "bg-neutral-400",
              )}
            />
          </span>
        )}
      </button>

      {/* Hover preview */}
      {showPreview && source.snippet && (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-60 pointer-events-none">
          <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-lg p-2.5 text-left">
            <p className="text-xs text-neutral-600 dark:text-neutral-300 line-clamp-3 leading-relaxed">
              {source.snippet.slice(0, 150)}
              {source.snippet.length > 150 ? "..." : ""}
            </p>
          </div>
        </div>
      )}
    </span>
  );
}
