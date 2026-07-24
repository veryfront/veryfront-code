/**
 * Shared behavioral machinery for Dialog and Drawer.
 * TODO(a11y): focus trap, aria-labelledby, scroll-lock, portal, animation.
 * Drawer: drag-to-dismiss / snap points.
 * @module react/components/ui/modal-surface
 */
import * as React from "react";
import { Slot } from "./slot.tsx";

/** Open/close state shared between a modal skin's Root and its parts. */
export interface ModalState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** Context for Dialog and Drawer skins. */
export const ModalContext = React.createContext<ModalState | null>(null);

/** Reads the nearest ModalContext; throws if called outside a skin root. */
export function useModal(name = "Modal"): ModalState {
  const ctx = React.useContext(ModalContext);
  if (!ctx) throw new Error(`${name} parts must be used within <${name}>`);
  return ctx;
}

const FOCUSABLE =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Attaches Escape-dismiss and focus-first-focusable behaviour to a modal panel. */
export function useModalContentEffect(
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
  }, [open]); // setOpen is stable (useCallback); ref object is stable
}

type ModalBtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean };

/** Opens the modal on click. `asChild` merges onto the child element. */
export function ModalTrigger(
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
export function ModalClose(
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

/** Props for `ModalContent`. */
export interface ModalContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Extra node rendered before `children` — used by Drawer for the drag handle. */
  lead?: React.ReactNode;
}

/** Fixed overlay + panel shell. Skins supply panel layout via `className`. */
export function ModalContent(
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
