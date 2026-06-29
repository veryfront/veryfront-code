import * as React from "react";
import { cn } from "../../theme.ts";

/** Public API contract for source. */
export interface Source {
  title: string;
  url?: string;
  score?: number;
  snippet?: string;
}

/** Props accepted by sources. */
export interface SourcesProps {
  sources: Source[];
  className?: string;
  onSourceClick?: (source: Source, index: number) => void;
}

/** Render sources. */
export const Sources = React.forwardRef<HTMLDivElement, SourcesProps>(
  function Sources({ sources, className, onSourceClick }, ref) {
    if (sources.length === 0) return null;

    return (
      <div
        ref={ref}
        className={cn("mt-1", className)}
      >
        <div className="flex flex-wrap gap-2">
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

function SourcePill(
  { source, index, onClick }: SourcePillProps,
): React.ReactElement {
  const [showPreview, setShowPreview] = React.useState(false);

  return (
    <span className="relative">
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setShowPreview(true)}
        onMouseLeave={() => setShowPreview(false)}
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--outline-border)] py-1 pl-1 pr-2 text-xs no-underline",
          "bg-transparent text-[var(--foreground)]",
          "transition-colors hover:bg-[var(--tertiary)]",
          onClick ? "cursor-pointer" : "cursor-default",
        )}
      >
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-[var(--outline-border)] text-xs font-medium">
          {index + 1}
        </span>
        <span className="ml-0.5 max-w-[150px] truncate">{source.title}</span>
        {source.score != null && (
          <span className="ml-0.5 flex shrink-0 items-center gap-1">
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
          <div className="rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-[var(--secondary)] p-2.5 text-left shadow-sm">
            <p className="text-xs text-[var(--foreground)] line-clamp-3 leading-relaxed">
              {source.snippet.slice(0, 150)}
              {source.snippet.length > 150 ? "..." : ""}
            </p>
          </div>
        </div>
      )}
    </span>
  );
}
