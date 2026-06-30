/**
 * Spinner — the Veryfront brand mark (conic-gradient circle) doing Studio's
 * `bounce-spin`. Studio renders `<Logo variant="compact" className="animate-
 * bounce-spin"/>`; here the mark is inlined so the package stays self-contained
 * (no Logo dependency). The `bounce-spin` keyframes + `.animate-bounce-spin`
 * utility ship via chat `theme.ts`. Private to the chat module.
 *
 * @module react/components/chat/ui/spinner
 */
import * as React from "react";
import { cn } from "../theme.ts";

/** The Veryfront mark's conic gradient. */
const MARK_GRADIENT =
  "conic-gradient(from 180deg, #00A3F4 0deg, #DE84BC 102deg, #FC8F5D 192deg, #5BC1C3 265deg, #00A3F4 360deg)";

/** Props accepted by `<Spinner>`. */
export interface SpinnerProps {
  /** Size/extra classes — defaults to `size-7` (28px), the Logo compact size. */
  className?: string;
  /** Accessible label. @default "Loading" */
  label?: string;
}

/** Render a brand-mark loading spinner. */
export function Spinner(
  { className, label = "Loading" }: SpinnerProps,
): React.ReactElement {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-block size-7 shrink-0 rounded-full animate-bounce-spin",
        className,
      )}
      style={{ background: MARK_GRADIENT }}
    />
  );
}
