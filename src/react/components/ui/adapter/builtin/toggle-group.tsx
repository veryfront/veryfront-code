/**
 * Builtin ToggleGroup adapter — the zero-dependency shared-selection machinery
 * (`single` = segmented control, `multiple` = independent toggles), assembled as
 * `ToggleGroupParts`. Behaviour-preserving move of `toggle-group.tsx`'s logic;
 * the Item sets `aria-pressed` / `data-state` and toggles, but carries NO visual
 * classes — the skin passes those via `className`.
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

function toArray(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

const ToggleGroupRoot: ToggleGroupParts["Root"] = (
  { type = "single", value, defaultValue, onValueChange, disabled, children, ref, ...props },
) => {
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

  const ctx = React.useMemo<ToggleGroupState>(
    () => ({ value: selected, toggle, disabled }),
    [selected, toggle, disabled],
  );

  return (
    <ToggleGroupContext.Provider value={ctx}>
      <div ref={ref} role="group" data-type={type} {...props}>{children}</div>
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
      ref={ref}
      type={asChild ? undefined : "button"}
      aria-pressed={isOn}
      data-state={isOn ? "on" : "off"}
      data-disabled={isDisabled ? "" : undefined}
      disabled={isDisabled}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        ctx.toggle(value);
      }}
      {...props}
    />
  );
};

export const builtinToggleGroup: ToggleGroupParts = {
  Root: ToggleGroupRoot,
  Item: ToggleGroupItem,
};
