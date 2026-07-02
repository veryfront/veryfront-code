import * as React from "react";
import { cn } from "../../theme.ts";
import { CheckCircleIcon } from "../../icons/index.ts";
import { COMPONENT_ERROR } from "#veryfront/errors/error-registry.ts";

/** Props accepted by step indicator. */
export interface StepIndicatorProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "className"> {
  stepIndex: number;
  isComplete: boolean;
  className?: string;
  /** Override the complete/pending status glyph. */
  icon?: React.ReactNode;
  /** Compose your own divider; when omitted, the default anatomy is rendered. */
  children?: React.ReactNode;
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
  stepIndex: number;
  isComplete: boolean;
  /** Optional override for the complete/pending status glyph. */
  icon?: React.ReactNode;
}

const StepIndicatorContext = React.createContext<
  StepIndicatorContextValue | null
>(null);

/**
 * Read the enclosing `StepIndicator` state. Throws when used outside a
 * `StepIndicator`.
 */
export function useStepIndicator(): StepIndicatorContextValue {
  const ctx = React.useContext(StepIndicatorContext);
  if (!ctx) {
    throw COMPONENT_ERROR.create({
      detail: "useStepIndicator must be used within a StepIndicator",
    });
  }
  return ctx;
}

/**
 * `StepIndicator.Root` — context provider + the flex container. No children
 * renders the default anatomy (`Rule` + `Label` + `Rule`); pass children to
 * recompose.
 */
const StepIndicatorRoot = React.forwardRef<HTMLDivElement, StepIndicatorProps>(
  function StepIndicator({
    stepIndex,
    isComplete,
    className,
    icon,
    children,
    ...props
  }, ref): React.ReactElement {
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
  },
);
StepIndicatorRoot.displayName = "StepIndicator.Root";

/** `StepIndicator.Rule` — one of the flanking horizontal rules. */
function StepIndicatorRule(
  { className }: { className?: string },
): React.JSX.Element {
  return <div className={cn("flex-1 h-px bg-[var(--edge)]", className)} />;
}
StepIndicatorRule.displayName = "StepIndicator.Rule";

/** `StepIndicator.Label` — the status glyph + `Step N` pill. */
function StepIndicatorLabel(
  { className }: { className?: string },
): React.JSX.Element {
  const { stepIndex, isComplete, icon } = useStepIndicator();
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[var(--outline-border)] bg-transparent",
        className,
      )}
    >
      {icon ?? (isComplete
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
