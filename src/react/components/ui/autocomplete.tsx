/**
 * Autocomplete - a free-text input with a suggestions dropdown. Unlike
 * {@link Combobox} (where the value must be one of the listed options), the
 * value here is *whatever the user types*; suggestions are optional completions
 * that fill the input when chosen. It reuses the zero-dependency `combobox`
 * adapter for its mechanics (filtering, `aria-activedescendant` keyboard nav,
 * open/dismiss, token-scope portalling) - swap it via `UIAdapterProvider` like
 * any other primitive.
 *
 * @example
 * ```tsx
 * import { Autocomplete, AutocompleteContent, AutocompleteInput, AutocompleteItem } from "veryfront/ui";
 *
 * <Autocomplete onValueChange={setQuery}>
 *   <AutocompleteInput placeholder="Search cities…" />
 *   <AutocompleteContent>
 *     {suggestions.map((s) => <AutocompleteItem key={s} value={s} />)}
 *   </AutocompleteContent>
 * </Autocomplete>;
 * ```
 *
 * @module react/components/ui/autocomplete
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { useAdapter } from "./adapter/context.tsx";

/** Props accepted by `<Autocomplete>` (the root; owns the input text + open state). */
export interface AutocompleteProps {
  /** `AutocompleteInput` + `AutocompleteContent` parts to compose. */
  children: React.ReactNode;
  /** Initial input text when uncontrolled. */
  defaultValue?: string;
  /** Fires with the current text on every change - typing OR choosing a suggestion. */
  onValueChange?: (value: string) => void;
  /** Controlled open state of the suggestions list (pair with `onOpenChange`). */
  open?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Fires when the suggestions list opens or closes. */
  onOpenChange?: (open: boolean) => void;
}

/** Autocomplete root - renders no node of its own (state + context only). */
export function Autocomplete({
  children,
  defaultValue,
  onValueChange,
  open,
  defaultOpen,
  onOpenChange,
}: AutocompleteProps): React.ReactElement {
  const { combobox } = useAdapter();
  return (
    <combobox.Root
      defaultInputValue={defaultValue}
      onInputValueChange={onValueChange}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
      {children}
    </combobox.Root>
  );
}

/** Props accepted by `<AutocompleteInput>`. */
export interface AutocompleteInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLInputElement>;
}

/** The free-text input that drives the suggestions. */
export function AutocompleteInput(
  { className, ...props }: AutocompleteInputProps,
): React.ReactElement {
  const { combobox } = useAdapter();
  return (
    <combobox.Input
      className={cn(
        "h-[38px] w-full rounded-md px-3 text-base",
        "bg-[var(--input-bg)] text-[var(--foreground)] border border-[var(--outline-border)]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--edge-medium)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** Props accepted by `<AutocompleteContent>`. */
export interface AutocompleteContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** The floating `role="listbox"` of suggestions, shown while typing. */
export function AutocompleteContent(
  { className, children, ...props }: AutocompleteContentProps,
): React.ReactElement | null {
  const { combobox } = useAdapter();
  return (
    <combobox.Content
      className={cn(
        "z-50 max-h-64 min-w-[220px] overflow-auto rounded-lg",
        "bg-[var(--popover)] text-[var(--foreground)] shadow-sm outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </combobox.Content>
  );
}

/** Props accepted by `<AutocompleteItem>`. */
export interface AutocompleteItemProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  /** The suggestion text - filled into the input when chosen, and used for filtering. */
  value: string;
  /** Disable this suggestion and dim it. */
  disabled?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** A single suggestion. Fills the input when chosen; hides when it doesn't match. */
export function AutocompleteItem({
  value,
  disabled,
  className,
  children,
  onClick,
  ref,
  ...props
}: AutocompleteItemProps): React.ReactElement | null {
  const { combobox } = useAdapter();
  const ctx = combobox.useCombobox();
  const id = React.useId();

  React.useEffect(() => {
    ctx.registerOption(id, value, value, disabled);
    return () => ctx.unregisterOption(id);
  }, [ctx, disabled, id, value]);

  if (!ctx.matches(value)) return null;

  const active = ctx.activeId === id;

  return (
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={false}
      aria-disabled={disabled || undefined}
      data-active={active ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      onClick={(event: React.MouseEvent<HTMLDivElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) ctx.select(value, value);
      }}
      className={cn(
        "flex cursor-pointer items-center rounded-md px-2.5 py-1.5 text-base",
        "data-[active]:bg-[var(--accent)]",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {children ?? value}
    </div>
  );
}
