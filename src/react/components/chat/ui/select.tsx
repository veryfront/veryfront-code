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
 * @module react/components/chat/ui/select
 */
import * as React from "react";
import { cn } from "../theme.ts";
import { cva, type VariantProps } from "./cva.ts";
import { CheckIcon, ChevronDownIcon } from "../icons/index.ts";

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

interface SelectContextValue {
  value: string | undefined;
  setValue: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  labels: Map<string, React.ReactNode>;
  register: (value: string, label: React.ReactNode) => void;
}

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelect(): SelectContextValue {
  const ctx = React.useContext(SelectContext);
  if (!ctx) throw new Error("Select components must be used within <Select>");
  return ctx;
}

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

/** Select root — owns the selected value, open state, and label registry. */
export function Select({
  children,
  value,
  defaultValue,
  onValueChange,
  open,
  defaultOpen,
  onOpenChange,
}: SelectProps): React.ReactElement {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);
  const [, forceUpdate] = React.useReducer((n: number) => n + 1, 0);
  const labelsRef = React.useRef(new Map<string, React.ReactNode>());

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

  const register = React.useCallback((v: string, label: React.ReactNode) => {
    if (labelsRef.current.get(v) !== label) {
      labelsRef.current.set(v, label);
      forceUpdate();
    }
  }, []);

  return (
    <span className="relative inline-block w-full">
      <SelectContext.Provider
        value={{
          value: currentValue,
          setValue,
          open: isOpen,
          setOpen,
          labels: labelsRef.current,
          register,
        }}
      >
        {children}
      </SelectContext.Provider>
    </span>
  );
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
  const ctx = useSelect();
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
  const ctx = useSelect();
  const label = ctx.value !== undefined
    ? ctx.labels.get(ctx.value) ?? ctx.value
    : undefined;
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
  const ctx = useSelect();
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!ctx.open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        ctx.setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") ctx.setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ctx.open]);

  if (!ctx.open) return null;
  return (
    <div
      ref={ref}
      role="listbox"
      className={cn(
        "absolute top-full left-0 mt-2 z-50 max-h-96 min-w-full overflow-x-hidden overflow-y-auto rounded-lg bg-[var(--secondary)] text-[var(--foreground)] shadow-sm",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    >
      <div className="p-2.5">{children}</div>
    </div>
  );
}

/** Props accepted by `<SelectItem>`. */
export interface SelectItemProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  value: string;
  disabled?: boolean;
}

/** A selectable option. Shows a check when it is the current value. */
export function SelectItem({
  className,
  children,
  value,
  disabled,
  ...props
}: SelectItemProps): React.ReactElement {
  const ctx = useSelect();
  const selected = ctx.value === value;

  React.useEffect(() => {
    ctx.register(value, children);
  }, [value, children]);

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
      onClick={() => {
        if (disabled) return;
        ctx.setValue(value);
        ctx.setOpen(false);
      }}
      {...props}
    >
      <span className="line-clamp-1">{children}</span>
      {selected && (
        <CheckIcon className="ml-auto pl-2 size-3 shrink-0 box-content" />
      )}
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
  return (
    <div className={cn("-mx-2.5 my-1.5 h-px bg-[var(--tertiary)]", className)} />
  );
}

/** Groups related options (semantic only in this basic version). */
export function SelectGroup(
  { children, className }: { children: React.ReactNode; className?: string },
): React.ReactElement {
  return <div role="group" className={className}>{children}</div>;
}

export { selectTriggerVariants };
