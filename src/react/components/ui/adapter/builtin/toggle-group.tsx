/**
 * Builtin ToggleGroup adapter: the zero-dependency shared-selection machinery
 * (`single` = segmented control, `multiple` = independent toggles), assembled as
 * `ToggleGroupParts`. Behaviour-preserving move of `toggle-group.tsx`'s logic;
 * the Item sets `aria-pressed` / `data-state` and toggles, but carries NO visual
 * classes: the skin passes those via `className`.
 *
 * @module react/components/ui/adapter/builtin/toggle-group
 */
import * as React from "react";
import { Slot } from "../../slot.tsx";
import type { ToggleGroupParts } from "../contract.ts";

interface ToggleGroupState {
  value: string[];
  toggle: (itemValue: string) => void;
  disabled?: boolean;
}
const ToggleGroupContext = React.createContext<ToggleGroupState | null>(null);

function normalizeValue(
  type: "single" | "multiple",
  value: string | string[] | undefined,
): string[] {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  return type === "single" ? values.slice(0, 1) : values;
}

const ToggleGroupRoot: ToggleGroupParts["Root"] = (
  { type = "single", value, defaultValue, onValueChange, disabled, children, ref, ...props },
) => {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState<string[]>(() =>
    normalizeValue(type, defaultValue)
  );
  const selected = normalizeValue(type, isControlled ? value : internal);

  React.useEffect(() => {
    if (!isControlled) setInternal((current) => normalizeValue(type, current));
  }, [isControlled, type]);

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
    if (type === "single") {
      (onValueChange as ((value: string) => void) | undefined)?.(next[0] ?? "");
    } else {
      (onValueChange as ((value: string[]) => void) | undefined)?.(next);
    }
  }, [type, selected, isControlled, onValueChange]);

  const ctx = React.useMemo<ToggleGroupState>(
    () => ({ value: selected, toggle, disabled }),
    [selected, toggle, disabled],
  );

  return (
    <ToggleGroupContext.Provider value={ctx}>
      <div {...props} ref={ref} role="group" data-type={type}>{children}</div>
    </ToggleGroupContext.Provider>
  );
};

const ToggleGroupItem: ToggleGroupParts["Item"] = (
  { value, asChild = false, disabled, onClick, ref, ...props },
) => {
  const ctx = React.useContext(ToggleGroupContext);
  if (!ctx) throw new Error("<ToggleGroupItem> must be used within <ToggleGroup>");
  const isOn = ctx.value.includes(value);
  const isDisabled = disabled || ctx.disabled;
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...props}
      ref={ref}
      type={asChild ? undefined : "button"}
      aria-pressed={isOn}
      aria-disabled={asChild && isDisabled ? true : undefined}
      data-state={isOn ? "on" : "off"}
      data-disabled={isDisabled ? "" : undefined}
      disabled={isDisabled}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        if (isDisabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
        if (event.defaultPrevented) return;
        ctx.toggle(value);
      }}
    />
  );
};

export const builtinToggleGroup: ToggleGroupParts = {
  Root: ToggleGroupRoot,
  Item: ToggleGroupItem,
};
