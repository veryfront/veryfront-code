import * as React from "react";
import type { Source } from "./sources.tsx";
import { cn } from "../../theme.ts";

/** Props accepted by inline citation. */
export interface InlineCitationProps {
  index: number;
  source?: Source;
  className?: string;
  onClick?: (index: number) => void;
  /**
   * When provided, replaces the entire default hover-card body with the
   * consumer's node. The positioning/visibility timing wrapper is preserved;
   * only the card contents are replaced.
   */
  renderCard?: (source: Source, index: number) => React.ReactNode;
  /** Merged onto the hover-card container. */
  cardClassName?: string;
}

/** Render inline citation. */
export function InlineCitation({
  index,
  source,
  className,
  onClick,
  renderCard,
  cardClassName,
}: InlineCitationProps): React.ReactElement {
  const [showCard, setShowCard] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const [cardStyle, setCardStyle] = React.useState<React.CSSProperties>({});

  const show = React.useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // Position the card using fixed positioning to prevent overflow clipping.
      // Constants assume the card renders with the `w-80` class (Tailwind = 320px):
      //   160 = 320 / 2 — centers the card horizontally on the trigger button
      //   328 = 320 + 8 — keeps an 8px gap between the card's right edge and the viewport
      //   8   = minimum left margin from the viewport edge
      // If `cardClassName` overrides the card width, update these constants or
      // replace with a ref that measures the rendered card dimensions.
      const el = buttonRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        setCardStyle({
          position: "fixed",
          left: Math.max(
            8,
            Math.min(rect.left + rect.width / 2 - 160, globalThis.innerWidth - 328),
          ),
          bottom: globalThis.innerHeight - rect.top + 8,
          zIndex: 9999,
        });
      }
      setShowCard(true);
    }, 150);
  }, []);

  const hide = React.useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShowCard(false), 100);
  }, []);

  React.useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <>
      <span className="relative inline-block">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => onClick?.(index)}
          onMouseEnter={show}
          onMouseLeave={hide}
          className={cn(
            "inline-flex items-center justify-center",
            "size-[15px] rounded-full border border-[var(--outline-border)] text-[10px] font-semibold leading-none tabular-nums",
            "bg-[var(--secondary)] text-[var(--soft)] shadow-sm",
            "hover:border-[var(--faint)] hover:text-[var(--foreground)] transition-colors",
            "cursor-pointer align-super -translate-y-px ml-0.5",
            className,
          )}
        >
          {index + 1}
        </button>
      </span>

      {showCard && source && (
        <div
          style={cardStyle}
          className={cn("w-80 animate-in fade-in duration-150", cardClassName)}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          {renderCard
            ? renderCard(source, index)
            : (
              <div className="rounded-lg bg-[var(--popover)] p-3.5 text-left shadow-sm">
                {/* Title + URL */}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--foreground)] line-clamp-2">
                    {source.title}
                  </p>
                  {source.url && (
                    <p className="text-[10px] text-[var(--faint)] truncate mt-1 flex items-center gap-1">
                      <svg
                        className="size-2.5 shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      {source.url}
                    </p>
                  )}
                </div>

                {/* Snippet as blockquote */}
                {source.snippet && (
                  <div className="mt-2.5 border-l-2 border-[var(--outline-border)] pl-3">
                    <p className="text-xs text-[var(--foreground)] line-clamp-4 leading-relaxed italic">
                      {source.snippet}
                    </p>
                  </div>
                )}

                {/* Score bar */}
                {source.score != null && (
                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="text-[10px] text-[var(--faint)] shrink-0">
                      Relevance
                    </span>
                    <div className="flex-1 h-1 rounded-full bg-[var(--edge-medium)] overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          source.score >= 0.7
                            ? "bg-emerald-500"
                            : source.score >= 0.4
                            ? "bg-amber-500"
                            : "bg-neutral-400",
                        )}
                        style={{ width: `${Math.round(source.score * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-[var(--faint)]">
                      {Math.round(source.score * 100)}%
                    </span>
                  </div>
                )}
              </div>
            )}
        </div>
      )}
    </>
  );
}
