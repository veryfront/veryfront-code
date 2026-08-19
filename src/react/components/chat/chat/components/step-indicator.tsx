import * as React from "react";
import { cn } from "../../theme.ts";
import { CheckCircleIcon } from "../../../ui/icons/index.ts";
import { createStrictContext } from "../../../create-strict-context.ts";

/** Props accepted by step indicator. */
export interface StepIndicatorProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "className"> {
  /** Zero-based step number; the label renders it as `Step {stepIndex + 1}`. */
  stepIndex: number;
  /** Whether this step has finished. Swaps the pending glyph for a check. */
  isComplete: boolean;
  className?: string;
  icon?: React.ReactNode;
  /** Compose your own divider; when omitted, the default anatomy is rendered. */
  children?: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

// ---------------------------------------------------------------------------
// StepIndicator — compound, render-or-compose (mirrors `ToolCall` / `Sources`).
//
// Minimal by nature: a labelled divider is a rule + a `Step N` label + a rule.
// `<StepIndicator stepIndex={…} isComplete />` renders that default anatomy;
// pass children to recompose from `StepIndicator.Rule` + `StepIndicator.Label`,
// each reading `useStepIndicator()`. Every part takes `className` (merged LAST).
// ---------------------------------------------------------------------------

/** Per-indicator state shared with `StepIndicator.*` sub-parts. */
export interface StepIndicatorContextValue {
  /** Zero-based step number; the label renders it as `Step {stepIndex + 1}`. */
  stepIndex: number;
  /** Whether this step has finished. Swaps the pending glyph for a check. */
  isComplete: boolean;
  /** Optional override for the complete/pending status glyph. */
  icon?: React.ReactNode;
}

const [StepIndicatorContext, useStepIndicatorContext] = createStrictContext<
  StepIndicatorContextValue
>(
  "useStepIndicator",
  "a StepIndicator",
);

/**
 * Read the current `StepIndicator`'s state from a `StepIndicator.*` sub-part.
 * Throws when called outside a `StepIndicator` / `StepIndicator.Root`.
 *
 * @example
 * ```tsx
 * function StepBadge() {
 *   const { stepIndex, isComplete } = useStepIndicator();
 *   return <span>{isComplete ? "✓" : `Step ${stepIndex + 1}`}</span>;
 * }
 * // <StepIndicator.Root stepIndex={0} isComplete={false}><StepBadge /></StepIndicator.Root>
 * ```
 */
export const useStepIndicator = useStepIndicatorContext;

/**
 * `StepIndicator.Root` — context provider + the flex container. No children
 * renders the default anatomy (`Rule` + `Label` + `Rule`); pass children to
 * recompose.
 */
function StepIndicatorRoot({
  stepIndex,
  isComplete,
  className,
  icon,
  children,
  ref,
  ...props
}: StepIndicatorProps): React.ReactElement {
  const context: StepIndicatorContextValue = { stepIndex, isComplete, icon };
  return (
    <StepIndicatorContext.Provider value={context}>
      <div
        {...props}
        ref={ref}
        className={cn(
          "flex items-center gap-3 py-3 text-xs text-[var(--faint)]",
          className,
        )}
      >
        {children ?? (
          <>
            <StepIndicatorRule />
            <StepIndicatorLabel />
            <StepIndicatorRule />
          </>
        )}
      </div>
    </StepIndicatorContext.Provider>
  );
}
StepIndicatorRoot.displayName = "StepIndicator.Root";

/** `StepIndicator.Rule` — one of the flanking horizontal rules. */
function StepIndicatorRule(
  { className, ref, ...props }:
    & Omit<React.HTMLAttributes<HTMLDivElement>, "children">
    & { ref?: React.Ref<HTMLDivElement> },
): React.JSX.Element {
  return <div {...props} ref={ref} className={cn("flex-1 h-px bg-[var(--edge)]", className)} />;
}
StepIndicatorRule.displayName = "StepIndicator.Rule";

/** `StepIndicator.Label` — the status glyph + `Step N` pill. */
function StepIndicatorLabel(
  { className, children, ref, ...props }:
    & React.HTMLAttributes<HTMLDivElement>
    & { ref?: React.Ref<HTMLDivElement> },
): React.JSX.Element {
  const { stepIndex, isComplete, icon } = useStepIndicator();
  return (
    <div
      {...props}
      ref={ref}
      className={cn(
        "flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[var(--outline-border)] bg-transparent",
        className,
      )}
    >
      {children ?? icon ?? (isComplete
        ? <CheckCircleIcon className="size-3.5 text-[var(--success)]" />
        : <span className="size-2 rounded-full bg-[var(--faint)] animate-pulse" />)}
      <span className="font-medium">Step {stepIndex + 1}</span>
    </div>
  );
}
StepIndicatorLabel.displayName = "StepIndicator.Label";

/**
 * StepIndicator — render `<StepIndicator stepIndex={…} isComplete />` for the
 * default divider, or compose `StepIndicator.Root` + `.Rule` / `.Label` for a
 * custom layout. Mirrors the `ToolCall` / `Sources` compounds.
 */
export const StepIndicator = Object.assign(StepIndicatorRoot, {
  Root: StepIndicatorRoot,
  Rule: StepIndicatorRule,
  Label: StepIndicatorLabel,
});
