/**
 * ToggleGroup — a set of {@link Toggle}-style buttons with shared selection.
 * `type="single"` behaves like a segmented control (one value, optionally
 * deselectable); `type="multiple"` is a set of independent toggles (an array of
 * values). Self-contained (context + `aria-pressed` buttons, no floating engine).
 * Selection is exposed as `data-state="on" | "off"` per item; skinned with the
 * veryfront theme tokens.
 *
 * @module react/components/ui/toggle-group
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { Slot } from "./slot.tsx";

interface ToggleGroupContextValue {
  value: string[];
  toggle: (itemValue: string) => void;
  disabled?: boolean;
}

const ToggleGroupContext = React.createContext<ToggleGroupContextValue | null>(null);

function useToggleGroupContext(part: string): ToggleGroupContextValue {
  const ctx = React.useContext(ToggleGroupContext);
  if (!ctx) throw new Error(`<${part}> must be used within <ToggleGroup>`);
  return ctx;
}

function toArray(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Props accepted by `<ToggleGroup>`. */
export interface ToggleGroupProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> {
  /** `single` — one value (a segmented control); `multiple` — a set. @default "single" */
  type?: "single" | "multiple";
  /** Controlled selection. `string` for `single`, `string[]` for `multiple`. */
  value?: string | string[];
  /** Initial selection when uncontrolled. */
  defaultValue?: string | string[];
  /** Fires with the next selection (same shape as `value`). */
  onValueChange?: (value: string | string[]) => void;
  /** Disable every item. */
  disabled?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Render a group of toggles with shared selection. */
export function ToggleGroup({
  type = "single",
  value,
  defaultValue,
  onValueChange,
  disabled,
  className,
  children,
  ref,
  ...props
}: ToggleGroupProps): React.ReactElement {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState<string[]>(() => toArray(defaultValue));
  const selected = isControlled ? toArray(value) : internal;

  const toggle = React.useCallback((itemValue: string) => {
    let next: string[];
    if (type === "single") {
      next = selected[0] === itemValue ? [] : [itemValue];
    } else {
      next = selected.includes(itemValue)
        ? selected.filter((v) => v !== itemValue)
        : [...selected, itemValue];
    }
    if (!isControlled) setInternal(next);
    onValueChange?.(type === "single" ? (next[0] ?? "") : next);
  }, [type, selected, isControlled, onValueChange]);

  const ctx = React.useMemo<ToggleGroupContextValue>(
    () => ({ value: selected, toggle, disabled }),
    [selected, toggle, disabled],
  );

  return (
    <ToggleGroupContext.Provider value={ctx}>
      <div
        ref={ref}
        role="group"
        data-type={type}
        className={cn("inline-flex items-center gap-1", className)}
        {...props}
      >
        {children}
      </div>
    </ToggleGroupContext.Provider>
  );
}

/** Props accepted by `<ToggleGroupItem>`. */
export interface ToggleGroupItemProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  /** The value this item contributes to the group selection. */
  value: string;
  /** Render as a Slot, merging the item behaviour onto the child element. */
  asChild?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** A single toggle within a {@link ToggleGroup}. */
export function ToggleGroupItem({
  value,
  asChild = false,
  disabled,
  className,
  onClick,
  ref,
  ...props
}: ToggleGroupItemProps): React.ReactElement {
  const ctx = useToggleGroupContext("ToggleGroupItem");
  const isOn = ctx.value.includes(value);
  const isDisabled = disabled || ctx.disabled;

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    ctx.toggle(value);
  };

  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : "button"}
      aria-pressed={isOn}
      data-state={isOn ? "on" : "off"}
      data-disabled={isDisabled ? "" : undefined}
      disabled={isDisabled}
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
