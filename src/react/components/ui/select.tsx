/**
 * Select — BASIC fork of @radix-ui/react-select with the same API shape (Root /
 * Trigger / Value / Content / Item / Label / Separator / Group). Classes ported
 * 1:1 from Studio's `Select` (tokens remapped). A single-select listbox that
 * opens below the trigger and dismisses on outside-click / `Escape`.
 *
 * TODO(a11y): roving focus + arrow/typeahead keyboard nav, `aria-activedescendant`,
 * portal + collision-aware positioning, scroll-into-view. The selected option's
 * label is tracked once its Content has rendered at least once (basic). Private
 * to the chat module.
 *
 * @module react/components/ui/select
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { cva, type VariantProps } from "./cva.ts";
import { CheckIcon, ChevronDownIcon } from "./icons/index.ts";
import { useAdapter } from "./adapter/context.tsx";

const selectTriggerVariants = cva(
  [
    "flex w-full items-center justify-between text-[var(--foreground)]",
    "transition-[background-color,box-shadow,border-color] duration-150 ease-in",
    "focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
    "[&>span]:line-clamp-1",
    "bg-[var(--input-bg)] border border-[var(--background)] dark:border-transparent",
    "data-[invalid=true]:border-[var(--status-error)]",
  ],
  {
    variants: {
      size: {
        xs: "h-[32px] px-2.5 text-sm rounded-md",
        sm: "h-[38px] px-3 text-base rounded-md",
        md: "h-[42px] px-3 text-base rounded-md",
        lg: "h-[50px] px-4 text-base rounded-md",
      },
    },
    defaultVariants: { size: "lg" },
  },
);

/** Props accepted by `<Select>`. */
export interface SelectProps {
  children: React.ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Select root — collects the value→label map from its items (so the trigger
 * shows the selected LABEL immediately) and hands it, with the state props, to
 * the active adapter's Select root. The state machine + positioning anchor live
 * in the adapter (builtin by default); this skin owns styling only.
 */
export function Select(
  { children, ...stateProps }: SelectProps,
): React.ReactElement {
  const { select } = useAdapter();
  // Collect value→label synchronously from the item children — no flip from raw
  // value on first open. This walks the skin's own `SelectItem`, so it stays in
  // the skin, decoupled from the adapter.
  const labels = React.useMemo(() => {
    const map = new Map<string, React.ReactNode>();
    collectSelectLabels(children, map);
    return map;
  }, [children]);
  return <select.Root {...stateProps} labels={labels}>{children}</select.Root>;
}

/** Walk children for `SelectItem` elements, mapping `value` → label node. */
function collectSelectLabels(
  node: React.ReactNode,
  map: Map<string, React.ReactNode>,
): void {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === SelectItem) {
      const p = child.props as SelectItemProps;
      if (p.value !== undefined) map.set(p.value, p.children);
    } else {
      const p = child.props as { children?: React.ReactNode };
      if (p?.children) collectSelectLabels(p.children, map);
    }
  });
}

/** Props accepted by `<SelectTrigger>`. */
export interface SelectTriggerProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof selectTriggerVariants> {}

/** Trigger — shows the current value and toggles the listbox. */
export function SelectTrigger({
  className,
  children,
  size,
  onClick,
  ...props
}: SelectTriggerProps): React.ReactElement {
  const { select } = useAdapter();
  const ctx = select.useSelect();
  return (
    <button
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={ctx.open}
      className={cn(selectTriggerVariants({ size }), className)}
      onClick={(e) => {
        onClick?.(e);
        ctx.setOpen(!ctx.open);
      }}
      {...props}
    >
      {children}
      <ChevronDownIcon className="size-3.5 opacity-50" />
    </button>
  );
}

/** Displays the selected option's label, or a placeholder. */
export function SelectValue(
  { placeholder }: { placeholder?: string },
): React.ReactElement {
  const { select } = useAdapter();
  const ctx = select.useSelect();
  const label = ctx.value !== undefined ? ctx.labels.get(ctx.value) ?? ctx.value : undefined;
  return (
    <span className={cn(label === undefined && "opacity-25")}>
      {label ?? placeholder}
    </span>
  );
}

/** Listbox surface — rendered below the trigger while open. */
export function SelectContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement | null {
  const { select } = useAdapter();
  return (
    <select.Content
      className={cn(
        "z-50 max-h-96 overflow-x-hidden overflow-y-auto rounded-lg bg-[var(--secondary)] text-[var(--foreground)] shadow-sm",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    >
      {children}
    </select.Content>
  );
}

/** Props accepted by `<SelectItem>`. */
export interface SelectItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  value: string;
  disabled?: boolean;
}

/** A selectable option. Shows a check when it is the current value. */
export function SelectItem({
  className,
  children,
  value,
  disabled,
  onClick,
  ...props
}: SelectItemProps): React.ReactElement {
  const { select } = useAdapter();
  const ctx = select.useSelect();
  const selected = ctx.value === value;

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-md h-[38px] px-3 text-base outline-none transition-colors",
        "hover:bg-[var(--tertiary)] focus:bg-[var(--tertiary)]",
        "aria-disabled:pointer-events-none aria-disabled:opacity-50",
        className,
      )}
      {...props}
      // Compose the caller's onClick with selection (caller runs first) so a
      // consumer-supplied handler adds to — never overrides — selection.
      onClick={(e) => {
        if (disabled) return;
        onClick?.(e);
        ctx.setValue(value);
        ctx.setOpen(false);
      }}
    >
      <span className="line-clamp-1">{children}</span>
      {selected && <CheckIcon className="ml-auto pl-2 size-3 shrink-0 box-content" />}
    </div>
  );
}

/** Non-interactive section label. */
export function SelectLabel(
  { className, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  return (
    <div
      className={cn(
        "px-3 py-1.5 text-sm font-medium text-[var(--foreground)]",
        className,
      )}
      {...props}
    />
  );
}

/** Divider between option groups. */
export function SelectSeparator(
  { className }: { className?: string },
): React.ReactElement {
  return <div className={cn("-mx-2.5 my-1.5 h-px bg-[var(--tertiary)]", className)} />;
}

/** Groups related options (semantic only in this basic version). */
export function SelectGroup(
  { children, className }: { children: React.ReactNode; className?: string },
): React.ReactElement {
  return <div role="group" className={className}>{children}</div>;
}

export { selectTriggerVariants };
