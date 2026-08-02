/**
 * Accessible single-select combobox composed from Root / Trigger / Value /
 * Content / Item / Label / Separator / Group parts.
 *
 * Focus remains on the trigger while the open listbox exposes its active
 * option through `aria-activedescendant`. Keyboard navigation, typeahead,
 * pointer highlighting, controlled state, and DOM order all share one item
 * registry.
 *
 * Each Select root must contain exactly one Trigger and one Content. Item
 * values and DOM ids must be unique within that Content; use Group to organize
 * sections. When options are generated entirely inside an opaque custom
 * component, pass explicit children to SelectValue so its closed/SSR label
 * does not depend on mounting the portalled Content. Disabling either Root or
 * Trigger suppresses the whole popup and requests closure; a controlled owner
 * that ignores the request remains suppressed until it re-enables the Select.
 *
 * @module react/components/ui/select
 */
import * as React from "react";
import { createStrictContext } from "../create-strict-context.ts";
import { cx as cn } from "./cva.ts";
import { cva, type VariantProps } from "./cva.ts";
import { Floating } from "./floating.tsx";
import { CheckIcon, ChevronDownIcon } from "./icons/index.ts";

const useIsomorphicLayoutEffect = typeof document === "undefined"
  ? React.useEffect
  : React.useLayoutEffect;

const TYPEAHEAD_RESET_MS = 700;
const REACT_MAJOR_VERSION = Number.parseInt(React.version, 10);
const SUPPORTS_REF_CLEANUP = Number.isFinite(REACT_MAJOR_VERSION) &&
  REACT_MAJOR_VERSION >= 19;

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

type SelectMoveDirection = "first" | "last" | "next" | "previous";

interface SelectItemRegistration {
  token: object;
  id: string;
  value: string;
  disabled: boolean;
  textValue: string | undefined;
  element: HTMLDivElement | null;
}

interface PartRegistration {
  id: string;
  token: object;
}

interface TriggerRegistration extends PartRegistration {
  disabled: boolean;
}

interface TypeaheadState {
  buffer: string;
  lastTypedAt: number;
  pending: boolean;
}

interface PendingOpenRequest {
  open: boolean;
  token: object;
}

class SelectConfigurationError extends Error {
  override name = "SelectConfigurationError";
}

interface SelectContextValue {
  value: string | undefined;
  setValue: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  disabled: boolean;
  invalid: boolean;
  labels: Map<string, React.ReactNode>;
  anchorRef: React.RefObject<HTMLElement | null>;
  triggerId: string | undefined;
  listboxId: string | undefined;
  activeId: string | undefined;
  registerTrigger: (
    id: string,
    token: object,
    element: HTMLButtonElement | null,
    disabled: boolean,
  ) => void;
  updateTriggerDisabled: (token: object, disabled: boolean) => void;
  unregisterTrigger: (token: object) => void;
  registerListbox: (id: string, token: object) => void;
  unregisterListbox: (token: object) => void;
  registerItem: (item: SelectItemRegistration) => void;
  unregisterItem: (id: string, token: object) => void;
  refreshItemOrder: () => void;
  setActiveId: (id: string) => void;
  moveActive: (direction: SelectMoveDirection) => void;
  selectActive: () => boolean;
  selectItem: (id: string) => boolean;
  typeahead: (character: string) => void;
  focusTrigger: () => void;
}

const [SelectContext, useSelect] = createStrictContext<SelectContextValue>(
  "Select components",
  "<Select>",
);
const SelectListboxContext = React.createContext<string | null>(null);

interface SelectGroupContextValue {
  registerLabel: (id: string, token: object) => void;
  unregisterLabel: (token: object) => void;
}

const SelectGroupContext = React.createContext<SelectGroupContextValue | null>(
  null,
);

function isUsableId(id: string | undefined): id is string {
  return Boolean(id && !/\s/.test(id));
}

function setReactRef<T>(
  ref: React.Ref<T> | undefined,
  value: T | null,
): (() => void) | undefined {
  if (typeof ref === "function") {
    const cleanup = ref(value);
    return typeof cleanup === "function" ? cleanup : undefined;
  } else if (ref) {
    ref.current = value;
  }
  return undefined;
}

function sortItemsByDocumentOrder(
  items: Map<string, SelectItemRegistration>,
): Map<string, SelectItemRegistration> {
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

function getNextItemId(
  itemIds: readonly string[],
  activeId: string | undefined,
  direction: SelectMoveDirection,
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

function normalizeOptionText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function itemText(item: SelectItemRegistration): string {
  return normalizeOptionText(
    item.textValue ?? item.element?.textContent ?? "",
  );
}

function findTypeaheadMatch(
  items: readonly SelectItemRegistration[],
  activeId: string | undefined,
  buffer: string,
): string | undefined {
  if (items.length === 0) return undefined;
  const normalizedBuffer = normalizeOptionText(buffer);
  if (!normalizedBuffer) return undefined;
  const repeatedCharacter = [...normalizedBuffer].every(
    (character) => character === normalizedBuffer[0],
  );
  const query = repeatedCharacter ? normalizedBuffer[0]! : normalizedBuffer;
  const activeIndex = activeId ? items.findIndex((item) => item.id === activeId) : -1;

  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (activeIndex + offset + items.length) % items.length;
    const item = items[index];
    if (item && itemText(item).startsWith(query)) return item.id;
  }
  return undefined;
}

interface StaticSelectInspection {
  labels: Map<string, React.ReactNode>;
  itemValues: Set<string>;
  partIds: Set<string>;
  triggerCount: number;
  contentCount: number;
  triggerDisabled: boolean;
}

function createStaticInspection(): StaticSelectInspection {
  return {
    labels: new Map(),
    itemValues: new Set(),
    partIds: new Set(),
    triggerCount: 0,
    contentCount: 0,
    triggerDisabled: false,
  };
}

function inspectPartId(
  id: unknown,
  inspection: StaticSelectInspection,
): void {
  if (typeof id !== "string" || !isUsableId(id)) return;
  if (inspection.partIds.has(id)) {
    throw new SelectConfigurationError(
      `Select part ids must be unique; received "${id}" twice`,
    );
  }
  inspection.partIds.add(id);
}

function extractDisplayText(node: React.ReactNode): string | undefined {
  const parts: string[] = [];
  const visit = (current: React.ReactNode): void => {
    React.Children.forEach(current, (child) => {
      if (typeof child === "string" || typeof child === "number") {
        parts.push(String(child));
        return;
      }
      if (!React.isValidElement(child)) return;
      visit((child.props as { children?: React.ReactNode }).children);
    });
  };
  visit(node);
  const text = parts.join(" ").trim().replace(/\s+/g, " ");
  return text || undefined;
}

function inspectSelectChildren(
  node: React.ReactNode,
  inspection: StaticSelectInspection,
): void {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return;

    if (child.type === SelectItem) {
      const item = child.props as SelectItemProps;
      if (inspection.itemValues.has(item.value)) {
        throw new SelectConfigurationError(
          `SelectItem values must be unique; received "${item.value}" twice`,
        );
      }
      inspection.itemValues.add(item.value);
      inspectPartId(item.id, inspection);
      inspection.labels.set(
        item.value,
        item.displayValue ??
          item.textValue ??
          extractDisplayText(item.children) ??
          item.value,
      );
      return;
    }

    if (child.type === SelectTrigger) {
      inspection.triggerCount += 1;
      inspection.triggerDisabled = Boolean(
        (child.props as SelectTriggerProps).disabled,
      );
      if (inspection.triggerCount > 1) {
        throw new SelectConfigurationError(
          "Select supports one <SelectTrigger> per root",
        );
      }
    } else if (child.type === SelectContent) {
      inspection.contentCount += 1;
      if (inspection.contentCount > 1) {
        throw new SelectConfigurationError(
          "Select supports one <SelectContent> per root; use <SelectGroup> for sections",
        );
      }
    }

    if (
      child.type === SelectTrigger ||
      child.type === SelectContent ||
      child.type === SelectValue ||
      child.type === SelectGroup ||
      child.type === SelectLabel
    ) {
      inspectPartId(
        (child.props as React.HTMLAttributes<HTMLElement>).id,
        inspection,
      );
    }

    const staticallyRendersChildren = child.type === React.Fragment ||
      typeof child.type === "string" ||
      child.type === SelectTrigger ||
      child.type === SelectContent ||
      child.type === SelectGroup;
    if (staticallyRendersChildren) {
      const nested = (child.props as { children?: React.ReactNode }).children;
      if (nested !== undefined) inspectSelectChildren(nested, inspection);
    }
  });
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
  /** Disable the trigger, options, and popup as one interaction boundary. */
  disabled?: boolean;
}

/**
 * Select root — owns the selected value, disclosure state, and option registry.
 *
 * Compose one {@link SelectTrigger} and one {@link SelectContent} per root.
 */
export function Select({
  children,
  value,
  defaultValue,
  onValueChange,
  open,
  defaultOpen,
  onOpenChange,
  disabled = false,
}: SelectProps): React.ReactElement {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);
  const [requestedActiveId, setRequestedActiveId] = React.useState<string>();
  const [items, setItems] = React.useState<
    Map<string, SelectItemRegistration>
  >(new Map());
  const [triggerId, setTriggerId] = React.useState<string>();
  const [listboxId, setListboxId] = React.useState<string>();
  const [triggerDisabled, setTriggerDisabled] = React.useState(false);
  // Runtime registration failures are configuration bugs, not transient user
  // input. Latch them fail-closed until this Select root is remounted; clearing
  // as the invalid portalled content unmounts would otherwise create an
  // open/close/remount loop for controlled roots.
  const [configurationError, setConfigurationError] = React.useState<
    SelectConfigurationError | undefined
  >(undefined);
  const anchorRef = React.useRef<HTMLElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const triggerRegistrationRef = React.useRef<TriggerRegistration | undefined>(
    undefined,
  );
  const listboxRegistrationRef = React.useRef<PartRegistration | undefined>(
    undefined,
  );
  const itemRegistryRef = React.useRef(items);
  const typeaheadRef = React.useRef<TypeaheadState>({
    buffer: "",
    lastTypedAt: 0,
    pending: false,
  });
  const typeaheadTimerRef = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const pendingOpenRequestRef = React.useRef<
    PendingOpenRequest | undefined
  >(undefined);
  const itemOrderRefreshScheduledRef = React.useRef(false);
  const itemRegistryMountedRef = React.useRef(true);
  const staticInspection = React.useMemo(() => {
    const inspection = createStaticInspection();
    inspectSelectChildren(children, inspection);
    return inspection;
  }, [children]);

  const isValueControlled = value !== undefined;
  const isOpenControlled = open !== undefined;
  const currentValue = isValueControlled ? value : internalValue;
  const rawOpen = isOpenControlled ? open : internalOpen;
  const configurationInvalid = configurationError !== undefined;
  const effectiveDisabled = disabled || staticInspection.triggerDisabled ||
    triggerDisabled ||
    configurationInvalid;
  const isOpen = rawOpen && !effectiveDisabled;
  const valueRef = React.useRef(currentValue);
  const openRef = React.useRef(rawOpen);
  useIsomorphicLayoutEffect(() => {
    valueRef.current = currentValue;
  }, [currentValue]);
  useIsomorphicLayoutEffect(() => {
    openRef.current = rawOpen;
  }, [rawOpen]);

  const clearTypeahead = React.useCallback(() => {
    if (typeaheadTimerRef.current !== undefined) {
      clearTimeout(typeaheadTimerRef.current);
      typeaheadTimerRef.current = undefined;
    }
    typeaheadRef.current = {
      buffer: "",
      lastTypedAt: 0,
      pending: false,
    };
  }, []);

  React.useEffect(() => {
    itemRegistryMountedRef.current = true;
    return () => {
      itemRegistryMountedRef.current = false;
      clearTypeahead();
    };
  }, [clearTypeahead]);

  const reportConfigurationError = React.useCallback(
    (error: SelectConfigurationError) => {
      setConfigurationError((current) => current ?? error);
    },
    [],
  );

  const setValue = React.useCallback((next: string) => {
    if (effectiveDisabled) return;
    if (valueRef.current === next) return;
    if (!isValueControlled) {
      valueRef.current = next;
      setInternalValue(next);
    }
    onValueChange?.(next);
  }, [effectiveDisabled, isValueControlled, onValueChange]);

  const setOpen = React.useCallback((next: boolean) => {
    if (effectiveDisabled && next) return;
    if (openRef.current === next) return;
    if (
      isOpenControlled &&
      pendingOpenRequestRef.current?.open === next
    ) {
      return;
    }
    if (next) {
      setRequestedActiveId(undefined);
    } else {
      clearTypeahead();
    }
    if (!isOpenControlled) {
      openRef.current = next;
      setInternalOpen(next);
    } else {
      const token = {};
      pendingOpenRequestRef.current = { open: next, token };
      queueMicrotask(() => {
        if (pendingOpenRequestRef.current?.token === token) {
          pendingOpenRequestRef.current = undefined;
        }
      });
    }
    onOpenChange?.(next);
  }, [clearTypeahead, effectiveDisabled, isOpenControlled, onOpenChange]);

  const disabledCloseRequestedRef = React.useRef(false);
  useIsomorphicLayoutEffect(() => {
    if (!effectiveDisabled || !rawOpen) {
      disabledCloseRequestedRef.current = false;
      return;
    }
    if (disabledCloseRequestedRef.current) return;
    disabledCloseRequestedRef.current = true;
    setOpen(false);
  }, [effectiveDisabled, rawOpen, setOpen]);

  const focusTrigger = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (trigger?.isConnected && !trigger.disabled) {
      trigger.focus({ preventScroll: true });
    }
  }, []);

  const registerTrigger = React.useCallback(
    (
      id: string,
      token: object,
      element: HTMLButtonElement | null,
      triggerIsDisabled: boolean,
    ) => {
      const current = triggerRegistrationRef.current;
      if (current && current.token !== token) {
        reportConfigurationError(
          new SelectConfigurationError(
            "Select supports one <SelectTrigger> per root",
          ),
        );
        return;
      }
      if (
        listboxRegistrationRef.current?.id === id ||
        itemRegistryRef.current.has(id)
      ) {
        reportConfigurationError(
          new SelectConfigurationError(
            `Select part ids must be unique; received "${id}" twice`,
          ),
        );
        return;
      }
      triggerRegistrationRef.current = {
        id,
        token,
        disabled: triggerIsDisabled,
      };
      triggerRef.current = element;
      setTriggerId((currentId) => currentId === id ? currentId : id);
      setTriggerDisabled((currentDisabled) =>
        currentDisabled === triggerIsDisabled ? currentDisabled : triggerIsDisabled
      );
    },
    [reportConfigurationError],
  );

  const updateTriggerDisabled = React.useCallback(
    (token: object, triggerIsDisabled: boolean) => {
      const current = triggerRegistrationRef.current;
      if (!current || current.token !== token) return;
      if (current.disabled === triggerIsDisabled) return;
      current.disabled = triggerIsDisabled;
      setTriggerDisabled(triggerIsDisabled);
    },
    [],
  );

  const unregisterTrigger = React.useCallback((token: object) => {
    if (triggerRegistrationRef.current?.token !== token) return;
    triggerRegistrationRef.current = undefined;
    triggerRef.current = null;
    setTriggerId(undefined);
    setTriggerDisabled(false);
  }, []);

  const registerListbox = React.useCallback((id: string, token: object) => {
    const current = listboxRegistrationRef.current;
    if (current && current.token !== token) {
      reportConfigurationError(
        new SelectConfigurationError(
          "Select supports one <SelectContent> per root; use <SelectGroup> for sections",
        ),
      );
      return;
    }
    if (
      triggerRegistrationRef.current?.id === id ||
      itemRegistryRef.current.has(id)
    ) {
      reportConfigurationError(
        new SelectConfigurationError(
          `Select part ids must be unique; received "${id}" twice`,
        ),
      );
      return;
    }
    listboxRegistrationRef.current = { id, token };
    setListboxId((currentId) => currentId === id ? currentId : id);
  }, [reportConfigurationError]);

  const unregisterListbox = React.useCallback((token: object) => {
    if (listboxRegistrationRef.current?.token !== token) return;
    listboxRegistrationRef.current = undefined;
    setListboxId(undefined);
  }, []);

  const registerItem = React.useCallback((item: SelectItemRegistration) => {
    const registry = itemRegistryRef.current;
    if (
      triggerRegistrationRef.current?.id === item.id ||
      listboxRegistrationRef.current?.id === item.id
    ) {
      reportConfigurationError(
        new SelectConfigurationError(
          `Select part ids must be unique; received "${item.id}" twice`,
        ),
      );
      return;
    }
    const sameId = registry.get(item.id);
    if (sameId && sameId.token !== item.token) {
      reportConfigurationError(
        new SelectConfigurationError(
          `SelectItem ids must be unique; received "${item.id}" twice`,
        ),
      );
      return;
    }
    const sameValue = [...registry.values()].find((registered) =>
      registered.token !== item.token && registered.value === item.value
    );
    if (sameValue) {
      reportConfigurationError(
        new SelectConfigurationError(
          `SelectItem values must be unique; received "${item.value}" twice`,
        ),
      );
      return;
    }
    const current = registry.get(item.id);
    if (
      current?.token === item.token &&
      current.value === item.value &&
      current.disabled === item.disabled &&
      current.textValue === item.textValue &&
      current.element === item.element
    ) {
      return;
    }
    const next = new Map(registry);
    next.set(item.id, item);
    itemRegistryRef.current = next;
    setItems(next);
  }, [reportConfigurationError]);

  const unregisterItem = React.useCallback((id: string, token: object) => {
    const registry = itemRegistryRef.current;
    if (registry.get(id)?.token !== token) return;
    const next = new Map(registry);
    next.delete(id);
    itemRegistryRef.current = next;
    setItems(next);
  }, []);

  const refreshItemOrder = React.useCallback(() => {
    if (itemOrderRefreshScheduledRef.current) return;
    itemOrderRefreshScheduledRef.current = true;
    queueMicrotask(() => {
      itemOrderRefreshScheduledRef.current = false;
      if (!itemRegistryMountedRef.current) return;
      const current = itemRegistryRef.current;
      const sorted = sortItemsByDocumentOrder(current);
      if (sorted === current) return;
      itemRegistryRef.current = sorted;
      setItems(sorted);
    });
  }, []);

  const orderedItems = React.useMemo(() => [...items.values()], [items]);
  const navigableItems = React.useMemo(
    () => orderedItems.filter((item) => !item.disabled),
    [orderedItems],
  );
  const selectedItem = React.useMemo(
    () => navigableItems.find((item) => item.value === currentValue),
    [currentValue, navigableItems],
  );
  const activeId = isOpen &&
      navigableItems.some((item) => item.id === requestedActiveId)
    ? requestedActiveId
    : isOpen
    ? selectedItem?.id ?? navigableItems[0]?.id
    : undefined;

  const setActiveId = React.useCallback((id: string) => {
    if (itemRegistryRef.current.get(id)?.disabled === false) {
      setRequestedActiveId(id);
    }
  }, []);

  const moveActive = React.useCallback(
    (direction: SelectMoveDirection) => {
      const nextId = getNextItemId(
        navigableItems.map((item) => item.id),
        activeId,
        direction,
      );
      if (nextId) setRequestedActiveId(nextId);
    },
    [activeId, navigableItems],
  );

  const selectItem = React.useCallback((id: string) => {
    const item = itemRegistryRef.current.get(id);
    if (!item || item.disabled) return false;
    setValue(item.value);
    setOpen(false);
    focusTrigger();
    return true;
  }, [focusTrigger, setOpen, setValue]);

  const selectActive = React.useCallback(
    () => activeId ? selectItem(activeId) : false,
    [activeId, selectItem],
  );

  const matchTypeahead = React.useCallback(
    (buffer: string): boolean => {
      const nextId = findTypeaheadMatch(navigableItems, activeId, buffer);
      if (!nextId) return false;
      setRequestedActiveId(nextId);
      return true;
    },
    [activeId, navigableItems],
  );

  const typeahead = React.useCallback((character: string) => {
    const now = Date.now();
    const previous = typeaheadRef.current;
    const buffer = now - previous.lastTypedAt > TYPEAHEAD_RESET_MS
      ? character
      : previous.buffer + character;
    typeaheadRef.current = {
      buffer,
      lastTypedAt: now,
      pending: !matchTypeahead(buffer),
    };
    if (typeaheadTimerRef.current !== undefined) {
      clearTimeout(typeaheadTimerRef.current);
    }
    typeaheadTimerRef.current = setTimeout(
      clearTypeahead,
      TYPEAHEAD_RESET_MS,
    );
  }, [clearTypeahead, matchTypeahead]);

  useIsomorphicLayoutEffect(() => {
    const typeaheadState = typeaheadRef.current;
    if (!isOpen || !typeaheadState.pending || navigableItems.length === 0) {
      return;
    }
    typeaheadState.pending = false;
    matchTypeahead(typeaheadState.buffer);
  }, [isOpen, matchTypeahead, navigableItems.length]);

  const previousOpenRef = React.useRef(isOpen);
  useIsomorphicLayoutEffect(() => {
    if (isOpen && !previousOpenRef.current) {
      setRequestedActiveId(undefined);
    } else if (!isOpen && previousOpenRef.current) {
      clearTypeahead();
    }
    previousOpenRef.current = isOpen;
  }, [clearTypeahead, isOpen]);

  const labels = staticInspection.labels;

  const context = React.useMemo<SelectContextValue>(
    () => ({
      value: currentValue,
      setValue,
      open: isOpen,
      setOpen,
      disabled: effectiveDisabled,
      invalid: configurationInvalid,
      labels,
      anchorRef,
      triggerId,
      listboxId,
      activeId,
      registerTrigger,
      updateTriggerDisabled,
      unregisterTrigger,
      registerListbox,
      unregisterListbox,
      registerItem,
      unregisterItem,
      refreshItemOrder,
      setActiveId,
      moveActive,
      selectActive,
      selectItem,
      typeahead,
      focusTrigger,
    }),
    [
      currentValue,
      setValue,
      isOpen,
      setOpen,
      effectiveDisabled,
      configurationInvalid,
      labels,
      triggerId,
      listboxId,
      activeId,
      registerTrigger,
      updateTriggerDisabled,
      unregisterTrigger,
      registerListbox,
      unregisterListbox,
      registerItem,
      unregisterItem,
      refreshItemOrder,
      setActiveId,
      moveActive,
      selectActive,
      selectItem,
      typeahead,
      focusTrigger,
    ],
  );

  return (
    <span ref={anchorRef} className="relative inline-block w-full">
      <SelectContext.Provider value={context}>
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

function handleTriggerKeyDown(
  event: React.KeyboardEvent<HTMLButtonElement>,
  context: SelectContextValue,
): void {
  if (
    event.defaultPrevented ||
    event.currentTarget.disabled ||
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229
  ) {
    return;
  }

  if (event.key === "Tab") {
    if (context.open) context.setOpen(false);
    return;
  }
  if (event.key === "Escape") {
    if (!context.open) return;
    event.preventDefault();
    event.stopPropagation();
    context.setOpen(false);
    context.focusTrigger();
    return;
  }
  if (event.altKey && event.key === "ArrowUp") {
    if (context.open) {
      event.preventDefault();
      context.setOpen(false);
      context.focusTrigger();
    }
    return;
  }

  switch (event.key) {
    case "ArrowDown":
    case "ArrowUp":
      event.preventDefault();
      if (context.open) {
        context.moveActive(
          event.key === "ArrowDown" ? "next" : "previous",
        );
      } else {
        context.setOpen(true);
      }
      return;
    case "Home":
    case "End":
      if (!context.open) return;
      event.preventDefault();
      context.moveActive(event.key === "Home" ? "first" : "last");
      return;
    case "Enter":
    case " ":
    case "Spacebar":
      event.preventDefault();
      if (context.open) context.selectActive();
      else context.setOpen(true);
      return;
  }

  if (
    [...event.key].length === 1 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    event.preventDefault();
    if (!context.open) context.setOpen(true);
    context.typeahead(event.key);
  }
}

/** Trigger — keeps focus while controlling and navigating the listbox. */
export const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  SelectTriggerProps
>(function SelectTrigger({
  className,
  children,
  size,
  onClick,
  onKeyDown,
  onBlur,
  id: suppliedId,
  disabled,
  type,
  "aria-invalid": ariaInvalid,
  ...triggerProps
}, forwardedRef): React.ReactElement {
  const context = useSelect();
  const locallyDisabled = Boolean(disabled);
  const isDisabled = locallyDisabled || context.disabled;
  const generatedId = React.useId();
  const id = isUsableId(suppliedId) ? suppliedId : generatedId;
  const registrationToken = React.useRef<object>({}).current;
  const elementRef = React.useRef<HTMLButtonElement>(null);
  const setRef = React.useCallback((element: HTMLButtonElement | null) => {
    elementRef.current = element;
    const cleanup = setReactRef(forwardedRef, element);
    if (element !== null && SUPPORTS_REF_CLEANUP) {
      return () => {
        if (elementRef.current === element) elementRef.current = null;
        if (cleanup) cleanup();
        else setReactRef(forwardedRef, null);
      };
    }
  }, [forwardedRef]);

  useIsomorphicLayoutEffect(() => {
    context.registerTrigger(
      id,
      registrationToken,
      elementRef.current,
      locallyDisabled,
    );
    return () => context.unregisterTrigger(registrationToken);
  }, [
    context.registerTrigger,
    context.unregisterTrigger,
    id,
    registrationToken,
  ]);
  useIsomorphicLayoutEffect(() => {
    context.updateTriggerDisabled(registrationToken, locallyDisabled);
  }, [
    context.updateTriggerDisabled,
    locallyDisabled,
    registrationToken,
  ]);

  return (
    <button
      {...triggerProps}
      ref={setRef}
      id={id}
      type={type ?? "button"}
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={context.open}
      aria-controls={context.listboxId}
      aria-activedescendant={context.open ? context.activeId : undefined}
      aria-invalid={context.invalid ? true : ariaInvalid}
      disabled={isDisabled}
      className={cn(selectTriggerVariants({ size }), className)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || isDisabled) return;
        event.currentTarget.focus({ preventScroll: true });
        context.setOpen(!context.open);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        handleTriggerKeyDown(event, context);
      }}
      onBlur={(event) => {
        onBlur?.(event);
        if (event.defaultPrevented || !context.open) return;
        const nextTarget = event.relatedTarget;
        const ownerNode = event.currentTarget.ownerDocument.defaultView?.Node;
        if (
          ownerNode &&
          nextTarget instanceof ownerNode &&
          (context.anchorRef.current?.contains(nextTarget) ||
            (context.listboxId &&
              event.currentTarget.ownerDocument.getElementById(
                context.listboxId,
              )?.contains(nextTarget)))
        ) {
          return;
        }
        context.setOpen(false);
      }}
    >
      {children}
      <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-50" />
    </button>
  );
});
SelectTrigger.displayName = "SelectTrigger";

/** Props accepted by `<SelectValue>`. */
export interface SelectValueProps extends React.HTMLAttributes<HTMLSpanElement> {
  placeholder?: React.ReactNode;
}

/**
 * Displays custom children, the selected label, or a placeholder.
 *
 * Explicit children are the deterministic label contract when SelectItems are
 * generated inside a custom component that the root cannot statically inspect.
 */
export function SelectValue({
  placeholder,
  children,
  className,
  ...valueProps
}: SelectValueProps): React.ReactElement {
  const context = useSelect();
  const label = children ??
    (context.value !== undefined ? context.labels.get(context.value) ?? context.value : undefined);
  const placeholderVisible = label === undefined;
  return (
    <span
      {...valueProps}
      data-placeholder={placeholderVisible || undefined}
      className={cn(placeholderVisible && "opacity-25", className)}
    >
      {placeholderVisible ? placeholder : label}
    </span>
  );
}

/** Listbox surface — rendered below the trigger while open. */
export function SelectContent({
  className,
  children,
  id: suppliedId,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...contentProps
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement | null {
  const context = useSelect();
  const generatedId = React.useId();
  const id = isUsableId(suppliedId) ? suppliedId : generatedId;
  const registrationToken = React.useRef<object>({}).current;

  useIsomorphicLayoutEffect(() => {
    context.registerListbox(id, registrationToken);
    return () => context.unregisterListbox(registrationToken);
  }, [
    context.registerListbox,
    context.unregisterListbox,
    id,
    registrationToken,
  ]);

  const accessibleLabelledBy = ariaLabel || ariaLabelledBy ? ariaLabelledBy : context.triggerId;

  return (
    <Floating
      {...contentProps}
      anchorRef={context.anchorRef}
      open={context.open}
      align="start"
      matchTriggerWidth
      onDismiss={() => context.setOpen(false)}
      id={id}
      role="listbox"
      aria-label={ariaLabel}
      aria-labelledby={accessibleLabelledBy}
      tabIndex={undefined}
      className={cn(
        "z-50 max-h-96 overflow-x-hidden overflow-y-auto rounded-lg bg-[var(--secondary)] text-[var(--foreground)] shadow-sm",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      <SelectListboxContext.Provider value={id}>
        <div role="presentation" className="p-2.5">{children}</div>
      </SelectListboxContext.Provider>
    </Floating>
  );
}

/** Props accepted by `<SelectItem>`. */
export interface SelectItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  value: string;
  disabled?: boolean;
  /** Text used for typeahead and the default selected-value display. */
  textValue?: string;
  /** Explicit rich content to display inside SelectValue for this option. */
  displayValue?: React.ReactNode;
}

/** A selectable option nested within the root's single SelectContent. */
export const SelectItem = React.forwardRef<
  HTMLDivElement,
  SelectItemProps
>(function SelectItem({
  className,
  children,
  value,
  disabled,
  textValue,
  displayValue: _displayValue,
  onClick,
  onMouseDown,
  onMouseMove,
  onFocus,
  id: suppliedId,
  ...itemProps
}, forwardedRef): React.ReactElement {
  const context = useSelect();
  const listboxId = React.useContext(SelectListboxContext);
  if (!listboxId) {
    throw new Error("SelectItem must be used within <SelectContent>");
  }
  const generatedId = React.useId();
  const id = isUsableId(suppliedId) ? suppliedId : generatedId;
  const registrationToken = React.useRef<object>({}).current;
  const elementRef = React.useRef<HTMLDivElement>(null);
  const selected = context.value === value;
  const isDisabled = disabled || context.disabled;
  const active = context.open && !isDisabled && context.activeId === id;
  const setRef = React.useCallback((element: HTMLDivElement | null) => {
    elementRef.current = element;
    const cleanup = setReactRef(forwardedRef, element);
    if (element !== null && SUPPORTS_REF_CLEANUP) {
      return () => {
        if (elementRef.current === element) elementRef.current = null;
        if (cleanup) cleanup();
        else setReactRef(forwardedRef, null);
      };
    }
  }, [forwardedRef]);

  useIsomorphicLayoutEffect(() => {
    context.registerItem({
      token: registrationToken,
      id,
      value,
      disabled: isDisabled,
      textValue,
      element: elementRef.current,
    });
    return () => context.unregisterItem(id, registrationToken);
  }, [
    context.registerItem,
    context.unregisterItem,
    isDisabled,
    id,
    registrationToken,
    textValue,
    value,
  ]);
  useIsomorphicLayoutEffect(() => {
    context.refreshItemOrder();
  });
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
      ref={setRef}
      id={id}
      role="option"
      tabIndex={undefined}
      aria-selected={selected}
      aria-disabled={isDisabled || undefined}
      data-highlighted={active || undefined}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-md h-[38px] px-3 text-base outline-none transition-colors",
        "hover:bg-[var(--tertiary)] data-[highlighted=true]:bg-[var(--tertiary)]",
        "aria-disabled:pointer-events-none aria-disabled:opacity-50",
        className,
      )}
      onMouseDown={(event) => {
        if (isDisabled) {
          if (event.button === 0) event.preventDefault();
          return;
        }
        onMouseDown?.(event);
        // Focus belongs to the combobox in the aria-activedescendant pattern.
        // Prevent the browser's primary-button focus transfer so blur cannot
        // dismiss and unmount this option before its click selects it.
        if (event.button === 0) event.preventDefault();
      }}
      onClick={(event) => {
        if (isDisabled) return;
        onClick?.(event);
        if (!event.defaultPrevented) context.selectItem(id);
      }}
      onMouseMove={(event) => {
        onMouseMove?.(event);
        if (!event.defaultPrevented && !isDisabled) context.setActiveId(id);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        if (!event.defaultPrevented && !isDisabled) context.setActiveId(id);
      }}
    >
      <span className="line-clamp-1">{children}</span>
      {selected && (
        <CheckIcon
          aria-hidden="true"
          className="ml-auto pl-2 size-3 shrink-0 box-content"
        />
      )}
    </div>
  );
});
SelectItem.displayName = "SelectItem";

/** Non-interactive label; labels its nearest SelectGroup when present. */
export function SelectLabel({
  className,
  id: suppliedId,
  ...labelProps
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  const group = React.useContext(SelectGroupContext);
  const generatedId = React.useId();
  const id = isUsableId(suppliedId) ? suppliedId : generatedId;
  const registrationToken = React.useRef<object>({}).current;

  useIsomorphicLayoutEffect(() => {
    if (!group) return;
    group.registerLabel(id, registrationToken);
    return () => group.unregisterLabel(registrationToken);
  }, [group, id, registrationToken]);

  return (
    <div
      {...labelProps}
      id={id}
      role="presentation"
      className={cn(
        "px-3 py-1.5 text-sm font-medium text-[var(--foreground)]",
        className,
      )}
    />
  );
}

/** Divider between option groups. */
export function SelectSeparator(
  { className }: { className?: string },
): React.ReactElement {
  return (
    <div
      role="presentation"
      className={cn("-mx-2.5 my-1.5 h-px bg-[var(--tertiary)]", className)}
    />
  );
}

/**
 * Groups related options. Add one SelectLabel or an explicit accessible name.
 */
export function SelectGroup({
  children,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...groupProps
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  const [registeredLabelId, setRegisteredLabelId] = React.useState<string>();
  const labelRegistrationRef = React.useRef<PartRegistration | undefined>(
    undefined,
  );
  const registerLabel = React.useCallback((id: string, token: object) => {
    const current = labelRegistrationRef.current;
    if (current && current.token !== token) {
      throw new Error("SelectGroup supports one <SelectLabel>");
    }
    labelRegistrationRef.current = { id, token };
    setRegisteredLabelId((currentId) => currentId === id ? currentId : id);
  }, []);
  const unregisterLabel = React.useCallback((token: object) => {
    if (labelRegistrationRef.current?.token !== token) return;
    labelRegistrationRef.current = undefined;
    setRegisteredLabelId(undefined);
  }, []);
  const accessibleLabelledBy = ariaLabel || ariaLabelledBy ? ariaLabelledBy : registeredLabelId;
  const hasAccessibleName = Boolean(ariaLabel || accessibleLabelledBy);
  const context = React.useMemo(
    () => ({ registerLabel, unregisterLabel }),
    [registerLabel, unregisterLabel],
  );

  return (
    <div
      {...groupProps}
      role={hasAccessibleName ? "group" : "presentation"}
      aria-label={ariaLabel}
      aria-labelledby={accessibleLabelledBy}
      className={className}
    >
      <SelectGroupContext.Provider value={context}>
        {children}
      </SelectGroupContext.Provider>
    </div>
  );
}

export { selectTriggerVariants };
