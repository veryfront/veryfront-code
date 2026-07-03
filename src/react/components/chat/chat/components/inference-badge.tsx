import * as React from "react";
import { cn } from "../../theme.ts";
import type { InferenceMode } from "#veryfront/agent/react";

/** Props accepted by inference badge. */
export interface InferenceBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  inferenceMode: InferenceMode;
  /** Override the badge label. Defaults to "Running locally". */
  label?: string;
  /** Override the leading green status dot. */
  icon?: React.ReactNode;
}

/** Render inference badge. */
export function InferenceBadge(
  {
    inferenceMode,
    label = "Running locally",
    icon,
    className,
    ...props
  }: InferenceBadgeProps,
): React.ReactElement | null {
  if (inferenceMode === "cloud") return null;

  return (
    <div
      {...props}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1 text-xs text-[var(--faint)]",
        className,
      )}
    >
      {icon ?? <span className="size-1.5 rounded-full bg-green-500" />}
      <span>{label}</span>
    </div>
  );
}
