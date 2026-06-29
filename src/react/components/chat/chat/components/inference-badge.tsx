import * as React from "react";
import type { InferenceMode } from "#veryfront/agent/react";

/** Props accepted by inference badge. */
export interface InferenceBadgeProps {
  inferenceMode: InferenceMode;
}

/** Render inference badge. */
export function InferenceBadge({ inferenceMode }: InferenceBadgeProps): React.ReactElement | null {
  if (inferenceMode === "cloud") return null;

  return (
    <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-[var(--faint)]">
      <span className="size-1.5 rounded-full bg-green-500" />
      <span>Running locally</span>
    </div>
  );
}
