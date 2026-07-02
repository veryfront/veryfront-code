import * as React from "react";
import { cn } from "../../theme.ts";

/** Props accepted by drop zone overlay. */
export interface DropZoneOverlayProps extends React.HTMLAttributes<HTMLDivElement> {
  visible: boolean;
  /** Override the upload glyph. */
  icon?: React.ReactNode;
  /** Override the prompt label. Defaults to "Drop files". */
  label?: string;
}

/**
 * Drag overlay shown over the composer while files are dragged onto it — the
 * glyph-in-a-circle + "Drop files" from Studio's `PromptForm`. Rendered inside
 * a `relative` card; fills it and blurs the content behind.
 */
export function DropZoneOverlay({
  visible,
  icon,
  label = "Drop files",
  className,
  ...props
}: DropZoneOverlayProps): React.ReactElement | null {
  if (!visible) return null;

  return (
    <div
      {...props}
      className={cn(
        "pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5",
        "rounded-[var(--radius-lg)] bg-[var(--secondary)] backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-[var(--accent)]">
        {icon ?? (
          <svg
            className="size-4 text-[var(--foreground)]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        )}
      </div>
      <p className="text-sm text-[var(--foreground)]">{label}</p>
    </div>
  );
}
