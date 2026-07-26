/**
 * Builtin Select adapter — the existing Select state machine (value + open,
 * controlled/uncontrolled, label registry, positioning anchor) plus the
 * `Floating` listbox, assembled as `SelectParts`. Behaviour-preserving move out
 * of `select.tsx`; the skin keeps all styling and passes the collected `labels`
 * map into `Root`, so the adapter stays decoupled from the skin's item identity.
 *
 * @module react/components/ui/adapter/builtin/select
 */
import * as React from "react";
import { createStrictContext } from "../../../create-strict-context.ts";
import { Floating } from "../../floating.tsx";
import type { SelectParts, SelectState } from "../contract.ts";

interface InternalSelectState extends SelectState {
  anchorRef: React.RefObject<HTMLElement | null>;
}

const [SelectContext, useSelect] = createStrictContext<InternalSelectState>(
  "Select components",
  "<Select>",
);

function SelectRoot({
  children,
  value,
  defaultValue,
  onValueChange,
  open,
  defaultOpen,
  onOpenChange,
  labels,
}: {
  children: React.ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  labels: Map<string, React.ReactNode>;
}): React.ReactElement {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);
  const anchorRef = React.useRef<HTMLElement | null>(null);

  const isValueControlled = value !== undefined;
  const isOpenControlled = open !== undefined;
  const currentValue = isValueControlled ? value : internalValue;
  const isOpen = isOpenControlled ? open : internalOpen;

  const setValue = React.useCallback((next: string) => {
    if (!isValueControlled) setInternalValue(next);
    onValueChange?.(next);
  }, [isValueControlled, onValueChange]);

  const setOpen = React.useCallback((next: boolean) => {
    if (!isOpenControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }, [isOpenControlled, onOpenChange]);

  const ctx = React.useMemo<InternalSelectState>(() => ({
    value: currentValue,
    setValue,
    open: isOpen,
    setOpen,
    labels,
    anchorRef,
  }), [currentValue, setValue, isOpen, setOpen, labels]);

  return (
    <span ref={anchorRef} className="relative inline-block w-full">
      <SelectContext.Provider value={ctx}>{children}</SelectContext.Provider>
    </span>
  );
}

function SelectContentPart({
  className,
  children,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }): React.ReactElement | null {
  const ctx = useSelect();
  return (
    <Floating
      anchorRef={ctx.anchorRef}
      open={ctx.open}
      align="start"
      matchTriggerWidth
      onDismiss={() => ctx.setOpen(false)}
      role="listbox"
      className={className}
      contentRef={ref}
      {...props}
    >
      <div className="p-2.5">{children}</div>
    </Floating>
  );
}

export const builtinSelect: SelectParts = {
  Root: SelectRoot,
  Content: SelectContentPart,
  // Exposed to skin parts; returns the richer internal state (skin ignores anchorRef).
  useSelect: useSelect as () => SelectState,
};
