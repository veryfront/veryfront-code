/**
 * Combobox — a text input that filters a dropdown `listbox` as you type, then
 * commits a selection. The look is ours (theme tokens); the mechanics (query,
 * filtering, `aria-activedescendant` keyboard nav, open/dismiss, portalling)
 * come from the active adapter's `combobox` slot — the zero-dependency
 * {@link builtinCombobox} by default, swappable to cmdk / Base UI / etc. via
 * `UIAdapterProvider`.
 *
 * @example
 * ```tsx
 * import { Combobox, ComboboxInput, ComboboxContent, ComboboxItem } from "veryfront/ui";
 *
 * <Combobox onValueChange={setFramework}>
 *   <ComboboxInput placeholder="Search framework…" />
 *   <ComboboxContent>
 *     <ComboboxItem value="next">Next.js</ComboboxItem>
 *     <ComboboxItem value="remix">Remix</ComboboxItem>
 *     <ComboboxItem value="astro">Astro</ComboboxItem>
 *   </ComboboxContent>
 * </Combobox>;
 * ```
 *
 * @module react/components/ui/combobox
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { useAdapter } from "./adapter/context.tsx";

/** Props accepted by `<Combobox>` (the root; owns query/open/value state). */
export interface ComboboxProps {
  /** `ComboboxInput` + `ComboboxContent` parts to compose. */
  children: React.ReactNode;
  /** Controlled selected value (pair with `onValueChange`). */
  value?: string;
  /** Initial selected value when uncontrolled. */
  defaultValue?: string;
  /** Fires with the newly-selected value. */
  onValueChange?: (value: string) => void;
  /** Controlled open state of the listbox (pair with `onOpenChange`). */
  open?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Fires when the listbox opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Initial input text. */
  defaultInputValue?: string;
}

/** Combobox root — renders no node of its own (state + context only). */
export function Combobox(props: ComboboxProps): React.ReactElement {
  const { combobox } = useAdapter();
  return <combobox.Root {...props} />;
}

/** Props accepted by `<ComboboxInput>`. */
export interface ComboboxInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLInputElement>;
}

/** The `role="combobox"` text input that drives filtering. */
export function ComboboxInput({ className, ...props }: ComboboxInputProps): React.ReactElement {
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

/** Props accepted by `<ComboboxContent>`. */
export interface ComboboxContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** The floating `role="listbox"` surface, shown while filtering. */
export function ComboboxContent(
  { className, children, ...props }: ComboboxContentProps,
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

/** Props accepted by `<ComboboxItem>`. */
export interface ComboboxItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  /** The value this option commits when chosen. */
  value: string;
  /** Text used for filtering + the input after selection. @default value */
  textValue?: string;
  /** Disable selection and dim the option. */
  disabled?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** A selectable, filterable option. Hides itself when it doesn't match the query. */
export function ComboboxItem({
  value,
  textValue,
  disabled,
  className,
  children,
  onClick,
  ref,
  ...props
}: ComboboxItemProps): React.ReactElement | null {
  const { combobox } = useAdapter();
  const ctx = combobox.useCombobox();
  const id = React.useId();
  const text = textValue ?? value;

  React.useEffect(() => {
    ctx.registerOption(id, value, text);
    return () => ctx.unregisterOption(id);
  }, [ctx, id, value, text]);

  if (!ctx.matches(text)) return null;

  const active = ctx.activeId === id;
  const selected = ctx.value === value;

  return (
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={selected}
      data-active={active ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      onClick={(event: React.MouseEvent<HTMLDivElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) ctx.select(value, text);
      }}
      className={cn(
        "flex cursor-pointer items-center rounded-md px-2.5 py-1.5 text-base",
        "data-[active]:bg-[var(--accent)] aria-selected:font-medium",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {children ?? text}
    </div>
  );
}
