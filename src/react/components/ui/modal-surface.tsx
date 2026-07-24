/**
 * Shared behavioral machinery for Dialog and Drawer.
 * TODO(a11y): focus trap, aria-labelledby, scroll-lock, portal, animation.
 * Drawer: drag-to-dismiss / snap points.
 * @module react/components/ui/modal-surface
 */
import * as React from "react";
import { Slot } from "./slot.tsx";
import { type DisclosureOptions, useDisclosure } from "./disclosure.ts";

/** Open/close state shared between a modal skin's Root and its parts. */
export interface ModalState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** Props for the shared modal content shell. */
export interface ModalContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Extra node rendered before `children` -- used by Drawer for the drag handle. */
  lead?: React.ReactNode;
}

type ModalBtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean };

const FOCUSABLE =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function useModalContentEffect(
  open: boolean,
  setOpen: (open: boolean) => void,
  ref: React.RefObject<HTMLElement | null>,
): void {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const focusable = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (focusable ?? ref.current)?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]); // include setOpen: the controlled path can replace it
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
    const value = React.useMemo(() => ({ open: isOpen, setOpen }), [isOpen, setOpen]);
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
    { children, asChild, onClick, ...props }: ModalBtnProps,
  ): React.ReactElement {
    const ctx = useModal();
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        {...(asChild ? {} : { type: "button" as const })}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(e);
          ctx.setOpen(true);
        }}
        {...props}
      >
        {children}
      </Comp>
    );
  }

  /** Closes the modal on click. `asChild` merges onto the child element. */
  function ModalClose(
    { children, asChild, onClick, ...props }: ModalBtnProps,
  ): React.ReactElement {
    const ctx = useModal();
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        {...(asChild ? {} : { type: "button" as const })}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(e);
          ctx.setOpen(false);
        }}
        {...props}
      >
        {children}
      </Comp>
    );
  }

  /** Fixed overlay + panel shell. Skins supply panel layout via `className`. */
  function ModalContent(
    { className, children, lead, ...props }: ModalContentProps,
  ): React.ReactElement | null {
    const ctx = useModal();
    const panelRef = React.useRef<HTMLDivElement>(null);
    useModalContentEffect(ctx.open, ctx.setOpen, panelRef);
    if (!ctx.open) return null;
    return (
      <div className="fixed inset-0 z-50">
        <div
          className="fixed inset-0 bg-[var(--overlay)]"
          onClick={() => ctx.setOpen(false)}
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          className={className}
          {...props}
        >
          {lead}
          {children}
        </div>
      </div>
    );
  }

  return { ModalRoot, useModal, ModalTrigger, ModalClose, ModalContent };
}
