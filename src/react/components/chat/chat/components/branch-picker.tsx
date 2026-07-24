import * as React from "react";
import { createStrictContext } from "../../../create-strict-context.ts";
import { cn } from "../../theme.ts";

/** Props accepted by branch picker. */
export interface BranchPickerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "className" | "onClick"> {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  /** Compose the controls. The default renders previous, count, and next. */
  children?: React.ReactNode;
  className?: string;
}

/** Props shared by `BranchPicker.Previous` and `BranchPicker.Next`. */
export interface BranchPickerActionProps {
  /** Override the chevron glyph. */
  icon?: React.ReactNode;
  className?: string;
}

/** Props accepted by `BranchPicker.Count`. */
export interface BranchPickerCountProps {
  /** Override the default `current/total` label. */
  children?: React.ReactNode;
  className?: string;
}

interface BranchPickerContextValue {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

const [BranchPickerContext, useBranchPicker] = createStrictContext<BranchPickerContextValue>(
  "BranchPicker.*",
  "<BranchPicker>",
);

const ACTION_BUTTON =
  "size-5 flex items-center justify-center rounded-full transition-all hover:bg-[var(--foreground)]/5 disabled:opacity-50 disabled:pointer-events-none";

function PreviousIcon(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
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
  );
}

function NextIcon(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
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
  );
}

/** Previous-branch control. */
function BranchPickerPrevious({
  icon,
  className,
}: BranchPickerActionProps): React.ReactElement {
  const { current, onPrev } = useBranchPicker();
  return (
    <button
      type="button"
      onClick={onPrev}
      disabled={current <= 1}
      className={cn(ACTION_BUTTON, className)}
      aria-label="Previous variant"
    >
      {icon ?? <PreviousIcon />}
    </button>
  );
}
BranchPickerPrevious.displayName = "BranchPicker.Previous";

/** Current branch position. */
function BranchPickerCount({
  children,
  className,
}: BranchPickerCountProps): React.ReactElement {
  const { current, total } = useBranchPicker();
  return (
    <span className={cn("tabular-nums min-w-[2ch] text-center", className)}>
      {children ?? `${current}/${total}`}
    </span>
  );
}
BranchPickerCount.displayName = "BranchPicker.Count";

/** Next-branch control. */
function BranchPickerNext({
  icon,
  className,
}: BranchPickerActionProps): React.ReactElement {
  const { current, total, onNext } = useBranchPicker();
  return (
    <button
      type="button"
      onClick={onNext}
      disabled={current >= total}
      className={cn(ACTION_BUTTON, className)}
      aria-label="Next variant"
    >
      {icon ?? <NextIcon />}
    </button>
  );
}
BranchPickerNext.displayName = "BranchPicker.Next";

/** Render the branch picker default or compose its addressable controls. */
function BranchPickerRoot({
  current,
  total,
  onPrev,
  onNext,
  children,
  className,
  ...props
}: BranchPickerProps): React.ReactElement | null {
  const context = React.useMemo(
    () => ({ current, total, onPrev, onNext }),
    [current, total, onPrev, onNext],
  );
  if (total <= 1) return null;

  return (
    <BranchPickerContext.Provider value={context}>
      <div
        {...props}
        className={cn(
          "inline-flex items-center gap-1 text-xs text-[var(--faint)]",
          className,
        )}
      >
        {children ?? (
          <>
            <BranchPickerPrevious />
            <BranchPickerCount />
            <BranchPickerNext />
          </>
        )}
      </div>
    </BranchPickerContext.Provider>
  );
}
BranchPickerRoot.displayName = "BranchPicker";

/** Branch picker with addressable previous, count, and next leaves. */
export const BranchPicker = Object.assign(BranchPickerRoot, {
  Root: BranchPickerRoot,
  Previous: BranchPickerPrevious,
  Count: BranchPickerCount,
  Next: BranchPickerNext,
});
