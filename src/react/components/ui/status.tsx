/**
 * Status — ported 1:1 from Veryfront Studio. A coloured status dot with a
 * label (optionally pulsing / responsively hidden). Semantic classes remapped
 * to veryfront's `[var(--token)]` vocabulary — the `--status-*` dot tokens all
 * exist in `theme.ts`. Private to the chat module.
 *
 * @module react/components/ui/status
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

/** Dot colour, keyed to the `--status-*` palette. */
export type StatusColor = "gray" | "blue" | "green" | "red" | "yellow";

/** Props accepted by `<Status>`. */
export interface StatusProps {
  label: string;
  color: StatusColor;
  /** Pulse the dot (e.g. an in-progress run). */
  pulse?: boolean;
  /** Render the label (off → dot-only, label kept for screen readers). */
  showLabel?: boolean;
  /** Hide the label via container query when space is tight. */
  responsive?: boolean;
  /** `'sm'` (14px, default) or `'inherit'` to inherit the parent's size. */
  size?: "sm" | "inherit";
  className?: string;
}

const dotColorMap: Record<StatusColor, string> = {
  gray: "bg-[var(--status-neutral)]",
  blue: "bg-[var(--status-info)]",
  green: "bg-[var(--status-success)]",
  red: "bg-[var(--status-error)]",
  yellow: "bg-[var(--status-warning)]",
};

/** Render a status dot + label. */
export function Status({
  label,
  color,
  pulse,
  showLabel = true,
  responsive,
  size = "sm",
  className,
}: StatusProps): React.ReactElement {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        responsive && "@container",
        className,
      )}
    >
      <span
        className={cn(
          "size-2 rounded-full shrink-0",
          dotColorMap[color],
          pulse && "animate-pulse",
        )}
      />
      <span
        className={cn(
          size === "sm" && "text-sm",
          "font-normal text-[var(--foreground)] truncate",
          !showLabel && "sr-only",
          showLabel && responsive && "hidden @[5rem]:inline",
        )}
      >
        {label}
      </span>
    </div>
  );
}
