/**
 * Command — BASIC self-contained fork of Studio's `Command` (which wraps `cmdk`).
 * A searchable, filtered list: Input / List / Empty / Group / Item (+ Item
 * Content/Title/Description, Shortcut, Separator). Classes ported 1:1 from
 * Studio (tokens remapped, icons sized down a half-step). Used by the model
 * picker (Popover + Command). No `cmdk` dependency.
 *
 * TODO(a11y): arrow-key navigation + `aria-activedescendant`, fuzzy ranking
 * (this does case-insensitive substring matching), `CommandDialog`. Private to
 * the chat module.
 *
 * @module react/components/chat/ui/command
 */
import * as React from "react";
import { cn } from "../theme.ts";
import { SearchIcon, XIcon } from "../icons/index.ts";
import { Dialog, DialogContent, DialogTitle } from "./dialog.tsx";

interface CommandContextValue {
  search: string;
  setSearch: (s: string) => void;
  register: (id: string, text: string) => void;
  unregister: (id: string) => void;
  matches: (text: string) => boolean;
  anyVisible: boolean;
}

const CommandContext = React.createContext<CommandContextValue | null>(null);

function useCommand(): CommandContextValue {
  const ctx = React.useContext(CommandContext);
  if (!ctx) throw new Error("Command parts must be used within <Command>");
  return ctx;
}

/** Command root — owns the filter query and the item registry. */
export function Command({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  const [search, setSearch] = React.useState("");
  const [items, setItems] = React.useState<Map<string, string>>(new Map());

  const register = React.useCallback((id: string, text: string) => {
    setItems((m) => {
      if (m.get(id) === text) return m;
      const next = new Map(m);
      next.set(id, text);
      return next;
    });
  }, []);
  const unregister = React.useCallback((id: string) => {
    setItems((m) => {
      if (!m.has(id)) return m;
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  }, []);
  const matches = React.useCallback(
    (text: string) =>
      !search || text.toLowerCase().includes(search.toLowerCase()),
    [search],
  );
  const anyVisible = React.useMemo(
    () => [...items.values()].some(matches),
    [items, matches],
  );

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg bg-[var(--secondary)] text-[var(--foreground)]",
        className,
      )}
      {...props}
    >
      <CommandContext.Provider
        value={{ search, setSearch, register, unregister, matches, anyVisible }}
      >
        {children}
      </CommandContext.Provider>
    </div>
  );
}

/** Props accepted by `<CommandDialog>`. */
export interface CommandDialogProps {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** A Command palette inside a modal Dialog overlay. */
export function CommandDialog({
  children,
  open,
  defaultOpen,
  onOpenChange,
}: CommandDialogProps): React.ReactElement {
  return (
    <Dialog open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden rounded-lg! p-0 shadow-lg">
        <DialogTitle className="sr-only">Command Menu</DialogTitle>
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

/** Props accepted by `<CommandInput>`. */
export interface CommandInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value"> {
  icon?: React.ReactNode;
}

/** Search input row — bound to the command's filter query. */
export function CommandInput({
  className,
  icon,
  placeholder = "Search…",
  ...props
}: CommandInputProps): React.ReactElement {
  const ctx = useCommand();
  const hasValue = ctx.search.length > 0;
  return (
    <div className="relative flex items-center px-2.5 border-b border-[var(--separator)]">
      <span className="absolute left-4 pointer-events-none text-[var(--foreground)]">
        {icon ?? <SearchIcon className="size-3.5" />}
      </span>
      <input
        value={ctx.search}
        onChange={(e) => ctx.setSearch(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "flex h-12 w-full bg-transparent pl-9 pr-9 text-sm text-[var(--foreground)] placeholder:text-[var(--foreground)] placeholder:opacity-50 outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => ctx.setSearch("")}
          aria-label="Clear filter"
          className="absolute right-2 flex size-6 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--foreground)] transition-colors"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </div>
  );
}

/** Scrollable results list. */
export function CommandList({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "flush" }):
  React.ReactElement {
  return (
    <div
      className={cn(
        "max-h-[300px] overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        variant === "flush" ? "p-0" : "p-2.5",
        className,
      )}
      {...props}
    />
  );
}

/** Shown when the query matches no items. */
export function CommandEmpty({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement | null {
  const ctx = useCommand();
  if (ctx.anyVisible) return null;
  return (
    <div
      className={cn(
        "text-sm text-[var(--foreground)] text-center py-8 px-4",
        className,
      )}
      {...props}
    />
  );
}

/** A labelled group of items; auto-hides when all its items are filtered out. */
export function CommandGroup({
  className,
  heading,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { heading?: React.ReactNode }):
  React.ReactElement {
  return (
    <div
      className={cn(
        "overflow-hidden p-0.5 [&:not(:has([data-command-item]:not([hidden])))]:hidden",
        className,
      )}
      {...props}
    >
      {heading && (
        <div className="pl-0.5 pr-3 pt-0 pb-1.5 mb-0.5 text-sm font-medium text-[var(--foreground)]">
          {heading}
        </div>
      )}
      {children}
    </div>
  );
}

/** Divider between groups. */
export function CommandSeparator(
  { className }: { className?: string },
): React.ReactElement {
  return (
    <div className={cn("-mx-2.5 my-2 h-px bg-[var(--separator)]", className)} />
  );
}

/** Props accepted by `<CommandItem>`. */
export interface CommandItemProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  /** Searchable text for filtering (falls back to nothing → always visible). */
  value?: string;
  /** Top-align the icon for two-line items. */
  align?: "center" | "start";
  disabled?: boolean;
  onSelect?: (value?: string) => void;
}

/** A selectable, filterable result row. */
export function CommandItem({
  className,
  align = "center",
  value,
  disabled,
  onSelect,
  children,
  ...props
}: CommandItemProps): React.ReactElement {
  const ctx = useCommand();
  const id = React.useId();
  const text = value ?? "";

  React.useEffect(() => {
    ctx.register(id, text);
    return () => ctx.unregister(id);
  }, [id, text]);

  const visible = ctx.matches(text);

  return (
    <div
      data-command-item=""
      role="option"
      aria-disabled={disabled || undefined}
      hidden={!visible || undefined}
      className={cn(
        "relative flex gap-3 select-none cursor-default rounded-md px-3 h-auto py-2 text-base font-normal outline-none transition-colors",
        "hover:bg-[var(--tertiary)] dark:hover:bg-[var(--accent)]",
        "aria-disabled:pointer-events-none aria-disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-w-0 group",
        align === "start" ? "items-start [&>svg]:mt-0.5" : "items-center",
        className,
      )}
      onClick={() => {
        if (disabled) return;
        onSelect?.(value);
      }}
      {...props}
    >
      {children}
    </div>
  );
}

/** Flex column wrapper for an item's title + description. */
export function CommandItemContent(
  { className, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  return <div className={cn("flex-1 min-w-0", className)} {...props} />;
}

/** Item primary text. */
export function CommandItemTitle(
  { className, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  return (
    <div className={cn("text-sm font-medium", className)} {...props} />
  );
}

/** Item secondary text. */
export function CommandItemDescription(
  { className, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  return (
    <div
      className={cn("text-xs text-[var(--foreground)] leading-tight", className)}
      {...props}
    />
  );
}

/** Trailing shortcut / metadata text. */
export function CommandShortcut(
  { className, ...props }: React.HTMLAttributes<HTMLSpanElement>,
): React.ReactElement {
  return (
    <span
      className={cn(
        "ml-auto text-xs text-[var(--foreground)] opacity-60",
        className,
      )}
      {...props}
    />
  );
}
