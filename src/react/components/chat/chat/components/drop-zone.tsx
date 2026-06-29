import * as React from "react";
import { cn } from "../../theme.ts";

/** Props accepted by drop zone overlay. */
export interface DropZoneOverlayProps {
  visible: boolean;
  accept?: string;
}

/** Render drop zone overlay. */
export function DropZoneOverlay({
  visible,
  accept,
}: DropZoneOverlayProps): React.ReactElement | null {
  if (!visible) return null;

  return (
    <div
      className={cn(
        "absolute inset-0 z-50 flex flex-col items-center justify-center gap-3",
        "bg-[var(--background)]/80 backdrop-blur-sm",
        "rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--success)]",
        "pointer-events-none",
      )}
    >
      <svg
        className="size-10 text-[var(--success)]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <div className="text-center">
        <p className="text-sm font-medium text-[var(--foreground)]">
          Drop files here
        </p>
        {accept && (
          <p className="text-xs text-[var(--faint)] mt-1">
            {accept.replace(/\./g, "").toUpperCase().replace(/,/g, ", ")}
          </p>
        )}
      </div>
    </div>
  );
}
