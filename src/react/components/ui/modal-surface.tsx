/**
 * Shared behavioral machinery for Dialog and Drawer.
 * Drawer: drag-to-dismiss / snap points.
 * @module react/components/ui/modal-surface
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { UI_SCOPE_SELECTOR } from "./design-tokens.ts";
import { type DisclosureOptions, useDisclosure } from "./disclosure.ts";
import { registerDismissableLayer } from "./dismissable-layer.ts";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect.ts";
import { focusFirst, focusWithoutScroll, trapTabKey } from "./focus-management.ts";
import { composeRefs, Slot } from "./slot.tsx";

/** Open/close state shared between a modal skin's Root and its parts. */
export interface ModalState {
  open: boolean;
  setOpen: (open: boolean) => void;
  contentId: string;
  descriptionId: string;
  titleId: string;
  defaultContentId: string;
  defaultDescriptionId: string;
  defaultTitleId: string;
  setContentId: React.Dispatch<React.SetStateAction<string>>;
  setDescriptionId: React.Dispatch<React.SetStateAction<string>>;
  setTitleId: React.Dispatch<React.SetStateAction<string>>;
  descriptionPresent: boolean;
  titlePresent: boolean;
  setDescriptionPresent: React.Dispatch<React.SetStateAction<boolean>>;
  setTitlePresent: React.Dispatch<React.SetStateAction<boolean>>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

/** Props for the shared modal content shell. */
export interface ModalContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Extra node rendered before `children` -- used by Drawer for the drag handle. */
  lead?: React.ReactNode;
  /** React 19: ref is a regular prop, forwarded to (merged onto) the panel node. */
  ref?: React.Ref<HTMLDivElement>;
}

type ModalBtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
};

interface ScrollLockState {
  count: number;
  previousOverflow: string;
}

const modalStacks = new WeakMap<Document, HTMLElement[]>();
const scrollLocks = new WeakMap<Document, ScrollLockState>();

function stableDomId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "");
}

function lockDocumentScroll(document: Document): () => void {
  const current = scrollLocks.get(document);
  if (current) {
    current.count += 1;
  } else {
    scrollLocks.set(document, {
      count: 1,
      previousOverflow: document.body.style.overflow,
    });
    document.body.style.overflow = "hidden";
  }

  return () => {
    const lock = scrollLocks.get(document);
    if (!lock) return;
    lock.count -= 1;
    if (lock.count > 0) return;
    document.body.style.overflow = lock.previousOverflow;
    scrollLocks.delete(document);
  };
}

function isFocusableElement(value: Element | null): value is HTMLElement {
  return value !== null && typeof (value as HTMLElement).focus === "function";
}

function useModalContentEffect(
  open: boolean,
  setOpen: (open: boolean) => void,
  ref: React.RefObject<HTMLElement | null>,
  triggerRef: React.RefObject<HTMLButtonElement | null>,
): void {
  React.useEffect(() => {
    const panel = ref.current;
    if (!open || !panel) return;
    const document = panel.ownerDocument;
    const stack = modalStacks.get(document) ?? [];
    stack.push(panel);
    modalStacks.set(document, stack);
    const previousFocus = isFocusableElement(document.activeElement)
      ? document.activeElement
      : null;
    const unlockScroll = lockDocumentScroll(document);
    const isTopModal = (): boolean => stack.at(-1) === panel;

    const unregisterDismissableLayer = registerDismissableLayer(
      document,
      () => ref.current,
      () => setOpen(false),
    );
    const onKey = (e: KeyboardEvent) => {
      if (!isTopModal() || e.defaultPrevented) return;
      trapTabKey(e, panel);
    };
    document.addEventListener("keydown", onKey);
    const onFocusIn = (event: FocusEvent) => {
      if (!isTopModal()) return;
      const target = event.target;
      if (
        target !== null &&
        typeof (target as { nodeType?: unknown }).nodeType === "number" &&
        panel.contains(target as Node)
      ) {
        return;
      }
      focusFirst(panel);
    };
    document.addEventListener("focusin", onFocusIn);
    queueMicrotask(() => {
      if (panel.isConnected && isTopModal()) focusFirst(panel);
    });

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      unregisterDismissableLayer();
      const index = stack.lastIndexOf(panel);
      if (index >= 0) stack.splice(index, 1);
      if (stack.length === 0) modalStacks.delete(document);
      unlockScroll();
      const restoreTarget = triggerRef.current?.isConnected
        ? triggerRef.current
        : previousFocus?.isConnected
        ? previousFocus
        : null;
      if (restoreTarget) focusWithoutScroll(restoreTarget);
    };
  }, [open, ref, setOpen, triggerRef]);
}

/**
 * Creates a fresh context instance plus the Root, useModal, ModalTrigger,
 * ModalClose, and ModalContent parts -- all bound to that context.
 *
 * Each skin (Dialog, Drawer) calls this ONCE at module scope so their contexts
 * are distinct objects. This prevents cross-binding when one skin is nested
 * inside the other: a DrawerClose inside a Dialog will only close the Drawer,
 * never the Dialog, because the two contexts cannot overlap.
 *
 * @param name - Component name used in the thrown error (e.g. "Dialog").
 */
export function createModalSurfaceParts(name: string) {
  const Context = React.createContext<ModalState | null>(null);

  /** Provides open state to all parts in a modal skin. */
  function ModalRoot(
    { children, open, defaultOpen, onOpenChange }: DisclosureOptions & {
      children: React.ReactNode;
    },
  ): React.ReactElement {
    const { open: isOpen, setOpen } = useDisclosure({ open, defaultOpen, onOpenChange });
    const reactId = stableDomId(React.useId());
    const defaultContentId = `vf-${name.toLowerCase()}-${reactId}-content`;
    const defaultDescriptionId = `vf-${name.toLowerCase()}-${reactId}-description`;
    const defaultTitleId = `vf-${name.toLowerCase()}-${reactId}-title`;
    const [contentId, setContentId] = React.useState(defaultContentId);
    const [descriptionId, setDescriptionId] = React.useState(
      defaultDescriptionId,
    );
    const [titleId, setTitleId] = React.useState(defaultTitleId);
    const [descriptionPresent, setDescriptionPresent] = React.useState(false);
    const [titlePresent, setTitlePresent] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const value = React.useMemo(
      () => ({
        open: isOpen,
        setOpen,
        contentId,
        descriptionId,
        titleId,
        defaultContentId,
        defaultDescriptionId,
        defaultTitleId,
        setContentId,
        setDescriptionId,
        setTitleId,
        descriptionPresent,
        titlePresent,
        setDescriptionPresent,
        setTitlePresent,
        triggerRef,
      }),
      [
        contentId,
        defaultContentId,
        defaultDescriptionId,
        defaultTitleId,
        descriptionPresent,
        descriptionId,
        isOpen,
        setOpen,
        titlePresent,
        titleId,
      ],
    );
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  /** Reads the skin's context; throws if called outside the skin's root. */
  function useModal(): ModalState {
    const ctx = React.useContext(Context);
    if (!ctx) throw new Error(`${name} parts must be used within <${name}>`);
    return ctx;
  }

  /** Opens the modal on click. `asChild` merges onto the child element. */
  function ModalTrigger(
    { children, asChild, disabled, id, onClick, ref, type, ...props }: ModalBtnProps,
  ): React.ReactElement {
    const ctx = useModal();
    const Comp = asChild ? Slot : "button";
    const setTriggerRef = React.useCallback((element: HTMLButtonElement | null) => {
      ctx.triggerRef.current = element;
      return () => {
        if (ctx.triggerRef.current === element) ctx.triggerRef.current = null;
      };
    }, [ctx.triggerRef]);
    const composedRef = React.useMemo(
      () => composeRefs<HTMLButtonElement>(setTriggerRef, ref),
      [ref, setTriggerRef],
    );
    return (
      <Comp
        {...props}
        type={asChild ? type : type ?? "button"}
        ref={composedRef}
        id={id}
        aria-haspopup="dialog"
        aria-expanded={ctx.open}
        aria-controls={ctx.contentId}
        aria-disabled={asChild && disabled ? true : undefined}
        disabled={disabled}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(e);
          if (!e.defaultPrevented && !disabled) ctx.setOpen(true);
        }}
      >
        {children}
      </Comp>
    );
  }

  /** Closes the modal on click. `asChild` merges onto the child element. */
  function ModalClose(
    { children, asChild, disabled, onClick, ref, type, ...props }: ModalBtnProps,
  ): React.ReactElement {
    const ctx = useModal();
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        {...props}
        type={asChild ? type : type ?? "button"}
        ref={ref}
        aria-disabled={asChild && disabled ? true : undefined}
        disabled={disabled}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(e);
          if (!e.defaultPrevented && !disabled) ctx.setOpen(false);
        }}
      >
        {children}
      </Comp>
    );
  }

  /** Fixed overlay + panel shell. Skins supply panel layout via `className`. */
  function ModalContent(
    {
      className,
      children,
      lead,
      id,
      ref,
      "aria-label": ariaLabel,
      "aria-labelledby": labelledBy,
      ...props
    }: ModalContentProps,
  ): React.ReactElement | null {
    const ctx = useModal();
    const panelRef = React.useRef<HTMLDivElement>(null);
    // Merge the internal panel ref (read by the focus/dismiss effects) with any
    // consumer ref, so `<DialogContent ref={...}>` reaches the panel node too.
    const setPanelNode = React.useMemo(
      () => composeRefs<HTMLDivElement>(panelRef, ref),
      [ref],
    );
    const resolvedId = id ?? ctx.defaultContentId;
    const [portalReady, setPortalReady] = React.useState(false);
    React.useEffect(() => setPortalReady(true), []);
    useIsomorphicLayoutEffect(() => {
      ctx.setContentId(resolvedId);
      return () => {
        ctx.setContentId((current) => current === resolvedId ? ctx.defaultContentId : current);
      };
    }, [ctx.defaultContentId, ctx.setContentId, resolvedId]);
    useModalContentEffect(
      ctx.open && portalReady,
      ctx.setOpen,
      panelRef,
      ctx.triggerRef,
    );
    if (!ctx.open || !portalReady) return null;
    const trigger = ctx.triggerRef.current;
    const document = trigger?.ownerDocument ?? globalThis.document;
    if (!document?.body) return null;
    const container = trigger?.closest<HTMLElement>("[data-vf-modal-content]") ??
      trigger?.closest<HTMLElement>(UI_SCOPE_SELECTOR) ?? document.body;
    return createPortal(
      <div className="fixed inset-0 z-50">
        <div
          aria-hidden="true"
          className="fixed inset-0 bg-[var(--overlay)]"
          onClick={() => ctx.setOpen(false)}
        />
        <div
          {...props}
          ref={setPanelNode}
          id={resolvedId}
          data-vf-modal-content=""
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel ?? (!labelledBy && !ctx.titlePresent ? name : undefined)}
          aria-labelledby={labelledBy ?? (ctx.titlePresent ? ctx.titleId : undefined)}
          tabIndex={-1}
          className={className}
        >
          {lead}
          {children}
        </div>
      </div>,
      container,
    );
  }

  return { ModalRoot, useModal, ModalTrigger, ModalClose, ModalContent };
}
