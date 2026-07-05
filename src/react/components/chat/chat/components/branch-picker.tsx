import * as React from "react";
import { cn } from "../../theme.ts";

/**
 * Icon overrides for {@link BranchPicker}. Each defaults to the built-in
 * chevron glyph.
 */
export interface BranchPickerIcons {
  prev?: React.ReactNode;
  next?: React.ReactNode;
}

/** Props accepted by branch picker. */
export interface BranchPickerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick" | "className"> {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
  /** Override either of the chevron icons. */
  icons?: BranchPickerIcons;
}

/** Render branch picker. */
export function BranchPicker({
  current,
  total,
  onPrev,
  onNext,
  className,
  icons,
  ...props
}: BranchPickerProps): React.ReactElement | null {
  if (total <= 1) return null;

  return (
    <div
      {...props}
      className={cn(
        "inline-flex items-center gap-1 text-xs text-[var(--faint)]",
        className,
      )}
    >
      <button
        type="button"
        onClick={onPrev}
        disabled={current <= 1}
        className={cn(
          "size-5 flex items-center justify-center rounded-full transition-all",
          "hover:bg-[var(--foreground)]/5",
          "disabled:opacity-50 disabled:pointer-events-none",
        )}
        aria-label="Previous variant"
      >
        {icons?.prev ?? (
          <svg
            className="size-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        )}
      </button>
      <span className="tabular-nums min-w-[2ch] text-center">{current}/{total}</span>
      <button
        type="button"
        onClick={onNext}
        disabled={current >= total}
        className={cn(
          "size-5 flex items-center justify-center rounded-full transition-all",
          "hover:bg-[var(--foreground)]/5",
          "disabled:opacity-50 disabled:pointer-events-none",
        )}
        aria-label="Next variant"
      >
        {icons?.next ?? (
          <svg
            className="size-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}
      </button>
    </div>
  );
}
