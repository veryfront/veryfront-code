/**
 * Command — BASIC self-contained fork of Studio's `Command` (which wraps `cmdk`).
 * A searchable, filtered list: Input / List / Empty / Group / Item (+ Item
 * Content/Title/Description, Shortcut, Separator). Classes ported 1:1 from
 * Studio (tokens remapped, icons sized down a half-step). Used by the model
 * picker (Popover + Command). No `cmdk` dependency.
 *
 * Filtering uses case-insensitive substring matching. The input retains focus
 * while arrow keys move the active descendant through the visible options.
 *
 * @module react/components/ui/command
 */
import * as React from "react";
import { createStrictContext } from "../create-strict-context.ts";
import { cx as cn } from "./cva.ts";
import { SearchIcon, XIcon } from "./icons/index.ts";
import { Dialog, DialogContent, DialogTitle } from "./dialog.tsx";
import { composeRefs } from "./slot.tsx";

const useIsomorphicLayoutEffect = typeof document === "undefined"
  ? React.useEffect
  : React.useLayoutEffect;

interface CommandContextValue {
  search: string;
  setSearch: (s: string) => void;
  register: (item: CommandItemRegistration) => void;
  unregister: (id: string) => void;
  refreshItemOrder: () => void;
  registerList: (id: string, token: object) => void;
  unregisterList: (token: object) => void;
  matches: (text: string) => boolean;
  anyVisible: boolean;
  registryReady: boolean;
  primaryListId: string | undefined;
  activeId: string | undefined;
  setActiveId: (id: string) => void;
  moveActive: (direction: "first" | "last" | "next" | "previous") => void;
  selectActive: () => boolean;
}

interface CommandItemRegistration {
  id: string;
  text: string;
  disabled: boolean;
  select: () => void;
  element: HTMLDivElement | null;
}

type CommandMoveDirection = "first" | "last" | "next" | "previous";

/** Internal matching rule shared by the registry and its focused tests. */
export function commandItemMatches(search: string, text: string): boolean {
  return text.length === 0 ||
    !search ||
    text.toLowerCase().includes(search.toLowerCase());
}

/** Resolve the next active option without coupling navigation to the DOM. */
export function getNextCommandItemId(
  itemIds: readonly string[],
  activeId: string | undefined,
  direction: CommandMoveDirection,
): string | undefined {
  const firstId = itemIds[0];
  if (!firstId) return undefined;
  if (direction === "first") return firstId;
  if (direction === "last") return itemIds.at(-1);

  const currentIndex = activeId ? itemIds.indexOf(activeId) : -1;
  if (currentIndex < 0) {
    return direction === "next" ? firstId : itemIds.at(-1);
  }
  const offset = direction === "next" ? 1 : -1;
  return itemIds[(currentIndex + offset + itemIds.length) % itemIds.length];
}

/** Compose a caller's change handler with the controlled search state. */
export function handleCommandInputChange(
  event: React.ChangeEvent<HTMLInputElement>,
  onChange: React.ChangeEventHandler<HTMLInputElement> | undefined,
  setSearch: (value: string) => void,
): void {
  onChange?.(event);
  if (!event.defaultPrevented) setSearch(event.currentTarget.value);
}

/** Apply command navigation only after the caller and IME have yielded the key. */
export function handleCommandInputKeyDown(
  event: React.KeyboardEvent<HTMLInputElement>,
  onKeyDown: React.KeyboardEventHandler<HTMLInputElement> | undefined,
  actions: {
    moveActive: (direction: CommandMoveDirection) => void;
    selectActive: () => boolean;
  },
): void {
  onKeyDown?.(event);
  if (
    event.defaultPrevented ||
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229
  ) {
    return;
  }

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      actions.moveActive("next");
      break;
    case "ArrowUp":
      event.preventDefault();
      actions.moveActive("previous");
      break;
    case "Home":
      event.preventDefault();
      actions.moveActive("first");
      break;
    case "End":
      event.preventDefault();
      actions.moveActive("last");
      break;
    case "Enter":
      if (actions.selectActive()) event.preventDefault();
      break;
  }
}

const [CommandContext, useCommand] = createStrictContext<CommandContextValue>(
  "Command parts",
  "<Command>",
);
const CommandListIdContext = React.createContext<string | null>(null);

function sortItemsByDocumentOrder(
  items: Map<string, CommandItemRegistration>,
): Map<string, CommandItemRegistration> {
  const entries = [...items.entries()];
  entries.sort(([, left], [, right]) => {
    const leftElement = left.element;
    const rightElement = right.element;
    if (
      !leftElement ||
      !rightElement ||
      leftElement.ownerDocument !== rightElement.ownerDocument
    ) {
      return 0;
    }
    const position = leftElement.compareDocumentPosition(rightElement);
    const node = leftElement.ownerDocument.defaultView?.Node;
    if (position & (node?.DOCUMENT_POSITION_FOLLOWING ?? 4)) return -1;
    if (position & (node?.DOCUMENT_POSITION_PRECEDING ?? 2)) return 1;
    return 0;
  });

  const currentIds = [...items.keys()];
  if (entries.every(([id], index) => id === currentIds[index])) return items;
  return new Map(entries);
}

/**
 * Command root — owns the filter query and item registry.
 *
 * Each root accepts one {@link CommandList}; use {@link CommandGroup} to
 * organize sections within it.
 */
export function Command({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  const [search, setSearch] = React.useState("");
  const [requestedActiveId, setRequestedActiveId] = React.useState<string>();
  const [items, setItems] = React.useState<Map<string, CommandItemRegistration>>(
    new Map(),
  );
  const [registryReady, setRegistryReady] = React.useState(false);
  const [primaryListId, setPrimaryListId] = React.useState<string>();
  const listRegistrationRef = React.useRef<
    { id: string; token: object } | undefined
  >(undefined);

  const register = React.useCallback((item: CommandItemRegistration) => {
    setItems((m) => {
      const current = m.get(item.id);
      if (
        current?.text === item.text &&
        current.disabled === item.disabled &&
        current.select === item.select &&
        current.element === item.element
      ) {
        return m;
      }
      const next = new Map(m);
      next.set(item.id, item);
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
  const refreshItemOrder = React.useCallback(() => {
    setItems((current) => sortItemsByDocumentOrder(current));
  }, []);
  const registerList = React.useCallback((id: string, token: object) => {
    const current = listRegistrationRef.current;
    if (current && current.token !== token) {
      throw new Error(
        "Command supports one <CommandList>; use <CommandGroup> to organize multiple sections",
      );
    }
    if (current?.id === id) return;
    listRegistrationRef.current = { id, token };
    setPrimaryListId(id);
  }, []);
  const unregisterList = React.useCallback((token: object) => {
    if (listRegistrationRef.current?.token !== token) return;
    listRegistrationRef.current = undefined;
    setPrimaryListId(undefined);
  }, []);
  React.useEffect(() => {
    setRegistryReady(true);
  }, []);
  const matches = React.useCallback(
    (text: string) => commandItemMatches(search, text),
    [search],
  );
  const matchingItems = React.useMemo(
    () => [...items.values()].filter((item) => matches(item.text)),
    [items, matches],
  );
  const navigableItems = React.useMemo(
    () => matchingItems.filter((item) => !item.disabled),
    [matchingItems],
  );
  const activeId = navigableItems.some((item) => item.id === requestedActiveId)
    ? requestedActiveId
    : navigableItems[0]?.id;
  const anyVisible = React.useMemo(
    () => matchingItems.length > 0,
    [matchingItems],
  );
  const setSearchValue = React.useCallback((value: string) => {
    setRequestedActiveId(undefined);
    setSearch(value);
  }, []);
  const setActiveId = React.useCallback((id: string) => {
    setRequestedActiveId(id);
  }, []);
  const moveActive = React.useCallback(
    (direction: CommandMoveDirection) => {
      const nextId = getNextCommandItemId(
        navigableItems.map((item) => item.id),
        activeId,
        direction,
      );
      if (nextId) setRequestedActiveId(nextId);
    },
    [activeId, navigableItems],
  );
  const selectActive = React.useCallback(() => {
    if (!activeId) return false;
    const item = items.get(activeId);
    if (!item || item.disabled || !matches(item.text)) return false;
    item.select();
    return true;
  }, [activeId, items, matches]);
  const context = React.useMemo<CommandContextValue>(
    () => ({
      search,
      setSearch: setSearchValue,
      register,
      unregister,
      refreshItemOrder,
      registerList,
      unregisterList,
      matches,
      anyVisible,
      registryReady,
      primaryListId,
      activeId,
      setActiveId,
      moveActive,
      selectActive,
    }),
    [
      search,
      setSearchValue,
      register,
      unregister,
      refreshItemOrder,
      registerList,
      unregisterList,
      matches,
      anyVisible,
      registryReady,
      primaryListId,
      activeId,
      setActiveId,
      moveActive,
      selectActive,
    ],
  );

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg bg-[var(--secondary)] text-[var(--foreground)]",
        className,
      )}
      {...props}
    >
      <CommandContext.Provider value={context}>{children}</CommandContext.Provider>
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
  /** Consumer ref for the search input. */
  ref?: React.Ref<HTMLInputElement>;
}

/** Search input row — bound to the command's filter query. */
export function CommandInput({
  className,
  icon,
  placeholder = "Search…",
  onChange,
  onKeyDown,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-controls": ariaControls,
  "aria-expanded": ariaExpanded,
  ref,
  ...inputProps
}: CommandInputProps): React.ReactElement {
  const ctx = useCommand();
  const hasValue = ctx.search.length > 0;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const composedInputRef = React.useMemo(
    () => composeRefs<HTMLInputElement>(inputRef, ref),
    [ref],
  );
  const controlledListId = ariaControls ?? ctx.primaryListId;
  const isExpanded = ariaExpanded === undefined
    ? Boolean(controlledListId)
    : ariaExpanded === true || ariaExpanded === "true";

  return (
    <div className="relative flex items-center px-2.5 border-b border-[var(--separator)]">
      <span className="absolute left-4 pointer-events-none text-[var(--foreground)]">
        {icon ?? <SearchIcon className="size-3.5" />}
      </span>
      <input
        {...inputProps}
        ref={composedInputRef}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={controlledListId}
        aria-expanded={isExpanded}
        aria-activedescendant={isExpanded && controlledListId ? ctx.activeId : undefined}
        aria-label={ariaLabelledBy ? ariaLabel : ariaLabel ?? placeholder}
        aria-labelledby={ariaLabelledBy}
        value={ctx.search}
        onChange={(event) => handleCommandInputChange(event, onChange, ctx.setSearch)}
        onKeyDown={(event) => handleCommandInputKeyDown(event, onKeyDown, ctx)}
        placeholder={placeholder}
        className={cn(
          "flex h-12 w-full bg-transparent pl-9 pr-9 text-sm text-[var(--foreground)] placeholder:text-[var(--foreground)] placeholder:opacity-50 outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => {
            ctx.setSearch("");
            inputRef.current?.focus();
          }}
          aria-label="Clear filter"
          className="absolute right-2 flex size-6 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--foreground)] transition-colors"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </div>
  );
}

/** The root's single scrollable results list. */
export function CommandList({
  className,
  variant = "default",
  id: suppliedId,
  children,
  ref,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...listProps
}:
  & React.HTMLAttributes<HTMLDivElement>
  & { variant?: "default" | "flush"; ref?: React.Ref<HTMLDivElement> }): React.ReactElement {
  const ctx = useCommand();
  const generatedId = React.useId();
  const id = suppliedId ?? generatedId;
  const registrationToken = React.useRef<object>({}).current;

  useIsomorphicLayoutEffect(() => {
    ctx.registerList(id, registrationToken);
    return () => ctx.unregisterList(registrationToken);
  }, [ctx.registerList, ctx.unregisterList, id, registrationToken]);

  return (
    <CommandListIdContext.Provider value={id}>
      <div
        {...listProps}
        ref={ref}
        id={id}
        role="listbox"
        aria-label={ariaLabelledBy ? ariaLabel : ariaLabel ?? "Command results"}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          "max-h-[300px] overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          variant === "flush" ? "p-0" : "p-2.5",
          className,
        )}
      >
        {children}
      </div>
    </CommandListIdContext.Provider>
  );
}

/** Shown when the query matches no items. */
export function CommandEmpty({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement | null {
  const ctx = useCommand();
  if (!ctx.registryReady || ctx.anyVisible) return null;
  return (
    <div
      {...props}
      role="option"
      aria-disabled="true"
      aria-selected="false"
      aria-live="polite"
      className={cn(
        "text-sm text-[var(--foreground)] text-center py-8 px-4",
        className,
      )}
    />
  );
}

/** A labelled group of items; auto-hides when all its items are filtered out. */
export function CommandGroup({
  className,
  heading,
  children,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...groupProps
}: React.HTMLAttributes<HTMLDivElement> & { heading?: React.ReactNode }): React.ReactElement {
  const headingId = React.useId();
  const hasHeading = heading !== undefined && heading !== null && heading !== false;
  const hasAccessibleName = hasHeading || Boolean(ariaLabel) || Boolean(ariaLabelledBy);
  return (
    <div
      {...groupProps}
      role={hasAccessibleName ? "group" : "presentation"}
      aria-label={ariaLabel}
      aria-labelledby={hasHeading ? headingId : ariaLabelledBy}
      className={cn(
        "overflow-hidden p-0.5 [&:not(:has([data-command-item]:not([hidden])))]:hidden",
        className,
      )}
    >
      {hasHeading && (
        <div
          id={headingId}
          role="presentation"
          className="pl-0.5 pr-3 pt-0 pb-1.5 mb-0.5 text-sm font-medium text-[var(--foreground)]"
        >
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
    <div
      role="presentation"
      className={cn("-mx-2.5 my-2 h-px bg-[var(--separator)]", className)}
    />
  );
}

/** Props accepted by `<CommandItem>`. */
export interface CommandItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  /** Searchable text for filtering (falls back to nothing → always visible). */
  value?: string;
  /** Top-align the icon for two-line items. */
  align?: "center" | "start";
  disabled?: boolean;
  onSelect?: (value?: string) => void;
  /** Consumer ref for the rendered command item. */
  ref?: React.Ref<HTMLDivElement>;
}

/** A selectable, filterable result row nested within {@link CommandList}. */
export function CommandItem({
  className,
  align = "center",
  value,
  disabled,
  onSelect,
  children,
  id: suppliedId,
  onClick,
  onMouseMove,
  ref,
  ...itemProps
}: CommandItemProps): React.ReactElement {
  const ctx = useCommand();
  const listId = React.useContext(CommandListIdContext);
  if (!listId) {
    throw new Error("CommandItem must be used within <CommandList>");
  }
  const generatedId = React.useId();
  const id = suppliedId ?? generatedId;
  const text = value ?? "";
  const elementRef = React.useRef<HTMLDivElement>(null);
  const composedItemRef = React.useMemo(
    () => composeRefs<HTMLDivElement>(elementRef, ref),
    [ref],
  );
  const selectionRef = React.useRef({ disabled, onSelect, value });
  useIsomorphicLayoutEffect(() => {
    selectionRef.current = { disabled, onSelect, value };
  }, [disabled, onSelect, value]);
  const select = React.useCallback(() => {
    const current = selectionRef.current;
    if (!current.disabled) current.onSelect?.(current.value);
  }, []);

  useIsomorphicLayoutEffect(() => {
    ctx.register({
      id,
      text,
      disabled: Boolean(disabled),
      select,
      element: elementRef.current,
    });
    return () => ctx.unregister(id);
  }, [ctx.register, ctx.unregister, disabled, id, select, text]);
  useIsomorphicLayoutEffect(() => {
    ctx.refreshItemOrder();
  });

  const visible = ctx.matches(text);
  const active = visible && !disabled && ctx.activeId === id;
  useIsomorphicLayoutEffect(() => {
    if (!active) return;
    const element = elementRef.current;
    if (typeof element?.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  return (
    <div
      {...itemProps}
      ref={composedItemRef}
      id={id}
      data-command-item=""
      data-selected={active || undefined}
      role="option"
      aria-disabled={disabled || undefined}
      aria-selected={active}
      hidden={!visible || undefined}
      className={cn(
        "relative flex gap-3 select-none cursor-default rounded-md px-3 h-auto py-2 text-base font-normal outline-none transition-colors",
        "hover:bg-[var(--tertiary)] dark:hover:bg-[var(--accent)] data-[selected=true]:bg-[var(--tertiary)] dark:data-[selected=true]:bg-[var(--accent)]",
        "aria-disabled:pointer-events-none aria-disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-w-0 group",
        align === "start" ? "items-start [&>svg]:mt-0.5" : "items-center",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) select();
      }}
      onMouseMove={(event) => {
        onMouseMove?.(event);
        if (!event.defaultPrevented && !disabled) ctx.setActiveId(id);
      }}
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
  return <div className={cn("text-sm font-medium", className)} {...props} />;
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
