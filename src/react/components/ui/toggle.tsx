/**
 * Toggle — a two-state pressed button (on / off). Behavioural but self-contained
 * (a single `aria-pressed` button, no floating engine needed): controlled via
 * `pressed`/`onPressedChange` or uncontrolled via `defaultPressed`. State is
 * exposed as `data-state="on" | "off"` for styling; `asChild` grafts the toggle
 * behaviour onto your own element. Skinned entirely with veryfront theme tokens.
 *
 * @module react/components/ui/toggle
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { Slot } from "./slot.tsx";

/** Props accepted by `<Toggle>`. */
export interface ToggleProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  /** Controlled pressed state. Pair with `onPressedChange`. */
  pressed?: boolean;
  /** Initial pressed state when uncontrolled. @default false */
  defaultPressed?: boolean;
  /** Fires with the next pressed state on user activation. */
  onPressedChange?: (pressed: boolean) => void;
  /** Render as a Slot, merging the toggle behaviour onto the child element. */
  asChild?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** Render a pressed toggle button. */
export function Toggle({
  pressed,
  defaultPressed = false,
  onPressedChange,
  asChild = false,
  disabled,
  className,
  onClick,
  ref,
  ...props
}: ToggleProps): React.ReactElement {
  const isControlled = pressed !== undefined;
  const [internal, setInternal] = React.useState(defaultPressed);
  const isOn = isControlled ? pressed : internal;

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    const next = !isOn;
    if (!isControlled) setInternal(next);
    onPressedChange?.(next);
  };

  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : "button"}
      aria-pressed={isOn}
      data-state={isOn ? "on" : "off"}
      data-disabled={disabled ? "" : undefined}
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md",
        "h-[38px] min-w-[38px] px-3 text-base font-normal",
        "transition-[background-color,color] duration-150 ease-in",
        "text-[var(--foreground)] hover:bg-[var(--accent)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
        "data-[state=on]:bg-[var(--secondary)] data-[state=on]:text-[var(--foreground)]",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}
