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
  const [showCard, setShowCard] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const [cardStyle, setCardStyle] = React.useState<React.CSSProperties>({});

  const show = React.useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // Position the card using fixed positioning to prevent overflow clipping
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
            "size-4 rounded text-[10px] font-medium leading-none",
            "bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300",
            "hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors",
            "align-super -translate-y-0.5 mx-0.5",
            className,
          )}
        >
          {index + 1}
        </button>
      </span>

      {showCard && source && (
        <div
          style={cardStyle}
          className="w-80 animate-in fade-in duration-150"
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl p-3.5 text-left">
            {/* Title */}
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 flex items-center justify-center size-5 rounded bg-neutral-200 dark:bg-neutral-700 text-[10px] font-bold text-neutral-600 dark:text-neutral-300 mt-0.5">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 line-clamp-2">
                  {source.title}
                </p>
                {source.url && (
                  <p className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5 flex items-center gap-1">
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
            </div>

            {/* Snippet as blockquote */}
            {source.snippet && (
              <div className="mt-2.5 pl-3 border-l-2 border-neutral-200 dark:border-neutral-600">
                <p className="text-xs text-neutral-600 dark:text-neutral-300 line-clamp-4 leading-relaxed italic">
                  {source.snippet}
                </p>
              </div>
            )}

            {/* Score bar */}
            {source.score != null && (
              <div className="mt-2.5 flex items-center gap-2">
                <span className="text-[10px] text-neutral-400 dark:text-neutral-500 shrink-0">
                  Relevance
                </span>
                <div className="flex-1 h-1 rounded-full bg-neutral-100 dark:bg-neutral-700 overflow-hidden">
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
                <span className="text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">
                  {Math.round(source.score * 100)}%
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
