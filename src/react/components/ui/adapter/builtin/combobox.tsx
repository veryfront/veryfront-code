/**
 * Builtin Combobox adapter — the zero-dependency, hand-rolled engine for the
 * Combobox primitive: a `role="combobox"` text input filtering a `role="listbox"`
 * of `role="option"`s, with `aria-activedescendant` keyboard navigation
 * (ArrowUp/Down/Home/End/Enter/Escape) over the *filtered* option set. Filtering,
 * the option registry, and the active-descendant live here (the adapter), not in
 * the skin — see {@link ComboboxState}. The floating listbox portals into the
 * token scope via `Floating`. No `cmdk`/Base UI dependency; those are opt-in
 * adapters that satisfy the same `ComboboxParts` contract.
 *
 * @module react/components/ui/adapter/builtin/combobox
 */
import * as React from "react";
import { createStrictContext } from "../../../create-strict-context.ts";
import { Floating } from "../../floating.tsx";
import type { ComboboxParts, ComboboxState } from "../contract.ts";

interface Option {
  id: string;
  value: string;
  text: string;
}

interface InternalComboboxState extends ComboboxState {
  anchorRef: React.RefObject<HTMLInputElement | null>;
}

const [ComboboxContext, useCombobox] = createStrictContext<InternalComboboxState>(
  "Combobox components",
  "<Combobox>",
);

function ComboboxRoot({
  children,
  value,
  defaultValue,
  onValueChange,
  open,
  defaultOpen,
  onOpenChange,
  defaultInputValue,
  onInputValueChange,
}: {
  children: React.ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultInputValue?: string;
  onInputValueChange?: (value: string) => void;
}): React.ReactElement {
  const listboxId = React.useId();
  const anchorRef = React.useRef<HTMLInputElement | null>(null);
  const optionsRef = React.useRef<Option[]>([]);

  const [query, setQueryState] = React.useState(defaultInputValue ?? "");
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);
  const [activeId, setActiveId] = React.useState<string | undefined>(undefined);

  const isValueControlled = value !== undefined;
  const isOpenControlled = open !== undefined;
  const currentValue = isValueControlled ? value : internalValue;
  const isOpen = isOpenControlled ? open : internalOpen;

  const matches = React.useCallback(
    (text: string) => !query || text.toLowerCase().includes(query.toLowerCase()),
    [query],
  );

  const setOpen = React.useCallback((next: boolean) => {
    if (!isOpenControlled) setInternalOpen(next);
    onOpenChange?.(next);
    if (!next) setActiveId(undefined);
  }, [isOpenControlled, onOpenChange]);

  const setQuery = React.useCallback((next: string) => {
    setQueryState(next);
    onInputValueChange?.(next);
    setActiveId(undefined);
    if (!isOpenControlled) setInternalOpen(true);
    onOpenChange?.(true);
  }, [isOpenControlled, onOpenChange, onInputValueChange]);

  const select = React.useCallback((nextValue: string, text: string) => {
    if (!isValueControlled) setInternalValue(nextValue);
    onValueChange?.(nextValue);
    setQueryState(text);
    onInputValueChange?.(text);
    setActiveId(undefined);
    if (!isOpenControlled) setInternalOpen(false);
    onOpenChange?.(false);
  }, [isValueControlled, onValueChange, isOpenControlled, onOpenChange, onInputValueChange]);

  const registerOption = React.useCallback((id: string, value: string, text: string) => {
    const existing = optionsRef.current.find((o) => o.id === id);
    if (existing) {
      existing.value = value;
      existing.text = text;
    } else {
      optionsRef.current.push({ id, value, text });
    }
  }, []);
  const unregisterOption = React.useCallback((id: string) => {
    optionsRef.current = optionsRef.current.filter((o) => o.id !== id);
  }, []);

  const onInputKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    const visible = optionsRef.current.filter((o) => matches(o.text));
    const currentIndex = visible.findIndex((o) => o.id === activeId);
    const move = (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(visible.length - 1, nextIndex));
      setActiveId(visible[clamped]?.id);
    };
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!isOpen) setOpen(true);
        else move(currentIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!isOpen) setOpen(true);
        else move(currentIndex <= 0 ? 0 : currentIndex - 1);
        break;
      case "Home":
        if (isOpen && visible.length) {
          event.preventDefault();
          move(0);
        }
        break;
      case "End":
        if (isOpen && visible.length) {
          event.preventDefault();
          move(visible.length - 1);
        }
        break;
      case "Enter": {
        const active = visible.find((o) => o.id === activeId);
        if (isOpen && active) {
          event.preventDefault();
          select(active.value, active.text);
        }
        break;
      }
      case "Escape":
        if (isOpen) {
          event.preventDefault();
          setOpen(false);
        }
        break;
    }
  }, [matches, activeId, isOpen, setOpen, select]);

  const ctx = React.useMemo<InternalComboboxState>(() => ({
    query,
    setQuery,
    open: isOpen,
    setOpen,
    value: currentValue,
    select,
    activeId,
    matches,
    listboxId,
    registerOption,
    unregisterOption,
    onInputKeyDown,
    anchorRef,
  }), [
    query,
    setQuery,
    isOpen,
    setOpen,
    currentValue,
    select,
    activeId,
    matches,
    listboxId,
    registerOption,
    unregisterOption,
    onInputKeyDown,
  ]);

  return <ComboboxContext.Provider value={ctx}>{children}</ComboboxContext.Provider>;
}

function ComboboxInputPart({
  className,
  onChange,
  onKeyDown,
  onFocus,
  ref,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  ref?: React.Ref<HTMLInputElement>;
}): React.ReactElement {
  const ctx = useCombobox();
  const setRef = React.useCallback((node: HTMLInputElement | null) => {
    ctx.anchorRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref != null) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
  }, [ctx.anchorRef, ref]);

  return (
    <input
      ref={setRef}
      role="combobox"
      aria-expanded={ctx.open}
      aria-controls={ctx.listboxId}
      aria-activedescendant={ctx.activeId}
      aria-autocomplete="list"
      autoComplete="off"
      value={ctx.query}
      className={className}
      onChange={(event) => {
        onChange?.(event);
        ctx.setQuery(event.target.value);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented) ctx.onInputKeyDown(event);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        if (!ctx.open) ctx.setOpen(true);
      }}
      {...props}
    />
  );
}

function ComboboxContentPart({
  className,
  children,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }):
  | React.ReactElement
  | null {
  const ctx = useCombobox();
  return (
    <Floating
      anchorRef={ctx.anchorRef}
      open={ctx.open}
      align="start"
      matchTriggerWidth
      onDismiss={() => ctx.setOpen(false)}
      role="listbox"
      id={ctx.listboxId}
      className={className}
      contentRef={ref}
      {...props}
    >
      <div className="p-1.5">{children}</div>
    </Floating>
  );
}

export const builtinCombobox: ComboboxParts = {
  Root: ComboboxRoot,
  Input: ComboboxInputPart,
  Content: ComboboxContentPart,
  useCombobox: useCombobox as () => ComboboxState,
};
