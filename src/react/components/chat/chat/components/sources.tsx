import * as React from "react";
import { cn } from "../../theme.ts";
import { createStrictContext } from "../../../create-strict-context.ts";

/** Public API contract for source. */
export interface Source {
  title: string;
  url?: string;
  score?: number;
  snippet?: string;
}

// ---------------------------------------------------------------------------
// Sources — compound, render-or-compose (mirrors `ToolCall` / `Reasoning`).
//
// `<Sources sources={…} />` renders the default anatomy: a flex-wrap row of
// `Sources.Pill`s. Pass children to recompose from `Sources.List` + a mapped
// set of `Sources.Pill`s, each reading `useSources()`. Every part takes
// `className`.
// ---------------------------------------------------------------------------

/** Per-list state shared with `Sources.*` sub-parts. */
export interface SourcesContextValue {
  sources: Source[];
  onSourceClick?: (source: Source, index: number) => void;
}

const [SourcesContext, useSources] = createStrictContext<SourcesContextValue>(
  "useSources",
  "a Sources",
);
export { useSources };

/**
 * Read the enclosing `Sources` state if present, or `null` outside one. Lets a
 * leaf like `Message.Source` opt into the row's `onSourceClick` without failing
 * when rendered standalone.
 */
export function useSourcesOptional(): SourcesContextValue | null {
  return React.useContext(SourcesContext);
}

/** Props accepted by `Sources` / `Sources.Root`. */
export interface SourcesProps {
  sources: Source[];
  className?: string;
  onSourceClick?: (source: Source, index: number) => void;
  /** Render each source yourself instead of using `Sources.Pill`. */
  renderItem?: (options: { item: Source; index: number }) => React.ReactNode;
  /** Compose your own row; when omitted, the default anatomy is rendered. */
  children?: React.ReactNode;
  /** React 19: `ref` is a regular prop, forwarded to the row wrapper. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * `Sources.Root` — context provider + the row wrapper. No children renders the
 * default anatomy (`List` of `Pill`s); pass children to recompose. Renders
 * nothing when the source list is empty.
 */
function SourcesRoot(
  { sources, className, onSourceClick, renderItem, children, ref }: SourcesProps,
): React.ReactElement | null {
  if (sources.length === 0) return null;

  const context: SourcesContextValue = { sources, onSourceClick };

  return (
    <SourcesContext.Provider value={context}>
      <div
        ref={ref}
        className={cn("mt-1", className)}
      >
        {children ?? <SourcesList renderItem={renderItem} />}
      </div>
    </SourcesContext.Provider>
  );
}
SourcesRoot.displayName = "Sources.Root";

/** Props for `Sources.List` — the flex-wrap row of pills. */
export interface SourcesListProps {
  className?: string;
  /** Render each source yourself instead of using `Sources.Pill`. */
  renderItem?: (options: { item: Source; index: number }) => React.ReactNode;
  /** Compose your own pills; when omitted, one `Sources.Pill` per source. */
  children?: React.ReactNode;
}

/** The flex-wrap row. Renders one `Sources.Pill` per source by default. */
function SourcesList(
  { className, renderItem, children }: SourcesListProps,
): React.JSX.Element {
  const { sources, onSourceClick } = useSources();
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {children ?? sources.map((source, index) =>
        renderItem
          ? (
            <React.Fragment key={`${source.title}-${index}`}>
              {renderItem({ item: source, index })}
            </React.Fragment>
          )
          : (
            <SourcePill
              key={`${source.title}-${index}`}
              source={source}
              index={index}
              onClick={onSourceClick ? () => onSourceClick(source, index) : undefined}
            />
          )
      )}
    </div>
  );
}
SourcesList.displayName = "Sources.List";

/** Props accepted by an individual source pill. */
export interface SourcePillProps {
  source: Source;
  index: number;
  onClick?: () => void;
  className?: string;
}

/** Render a single source pill with hover preview and score-color behaviour. */
export function SourcePill(
  { source, index, onClick, className }: SourcePillProps,
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
          className,
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
        <div className="absolute bottom-full left-0 mb-2 z-50 w-64 pointer-events-none animate-in fade-in duration-150">
          <div className="rounded-lg border border-[var(--outline-border)] bg-[var(--popover)] px-3 py-2 text-left shadow-md">
            <p className="text-xs text-[var(--foreground)] line-clamp-3 leading-relaxed">
              {source.snippet}
            </p>
          </div>
        </div>
      )}
    </span>
  );
}
SourcePill.displayName = "Sources.Pill";

/**
 * Sources — render `<Sources sources={…} />` for the default row, or compose
 * `Sources.Root` + `Sources.List` + `Sources.Pill` for a custom layout.
 * Mirrors the `ToolCall` / `Reasoning` compounds: render it, or compose it.
 */
export const Sources = Object.assign(SourcesRoot, {
  Root: SourcesRoot,
  List: SourcesList,
  Pill: SourcePill,
});
