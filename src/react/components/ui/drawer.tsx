/**
 * Drawer — BASIC bottom-sheet fork of Studio's `Drawer` (which is a large
 * Vaul-style component). Same API shape for the parts we need: Root / Trigger /
 * Content (overlay + sheet + drag handle) / Title / Header / Body / Footer /
 * Close. Surface classes ported 1:1 from Studio (tokens remapped). Slides up
 * from the bottom; dismisses on `Escape` and overlay click. A11y work tracked
 * in modal-surface.tsx.
 *
 * @module react/components/ui/drawer
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { createModalSurfaceParts } from "./modal-surface.tsx";

// Per-skin context + machinery -- distinct from Dialog's instance so a
// DialogClose nested inside a Drawer cannot accidentally close the Drawer.
const { ModalRoot: _Root, ModalTrigger: _Trigger, ModalClose: _Close, ModalContent: _Content } =
  createModalSurfaceParts("Drawer");

/** Props accepted by `<Drawer>`. */
export interface DrawerProps {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Drawer root — owns open state. */
export function Drawer(props: DrawerProps): React.ReactElement {
  return <_Root {...props} />;
}

/** Trigger — opens the drawer. `asChild` merges onto the child element. */
export function DrawerTrigger(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean },
): React.ReactElement {
  return <_Trigger {...props} />;
}

/** Bottom sheet — overlay + sliding surface with a drag handle. */
export function DrawerContent({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement | null {
  return (
    <_Content
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 flex flex-col max-h-[85vh] w-full rounded-t-xl bg-[var(--drawer)] text-[var(--foreground)] outline-none",
        className,
      )}
      lead={
        <div
          aria-hidden="true"
          className="mx-auto mt-3 h-[3px] w-[30px] shrink-0 rounded-full bg-[var(--outline-border)]"
        />
      }
      {...props}
    >
      {children}
    </_Content>
  );
}

/** Drawer title — 18px medium (Studio Heading-ish). Add `sr-only` to hide. */
export function DrawerTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return (
    <h2
      className={cn("text-lg font-medium text-[var(--foreground)]", className)}
      {...props}
    />
  );
}

/** Header column wrapper. */
export function DrawerHeader(
  { className, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  return <div className={cn("flex flex-col px-4.5 pt-1 pb-2 shrink-0", className)} {...props} />;
}

/** Scrollable body area. */
export function DrawerBody(
  { className, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  return (
    <div
      className={cn("flex-1 overflow-y-auto px-4.5 pb-4", className)}
      {...props}
    />
  );
}

/** Sticky footer, full-width stacked actions. */
export function DrawerFooter(
  { className, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  return (
    <div
      className={cn(
        "shrink-0 px-4 pb-4 pt-3 flex flex-col gap-3 [&>button]:w-full",
        className,
      )}
      {...props}
    />
  );
}

/** Closes the drawer. `asChild` merges onto the child element. */
export function DrawerClose(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean },
): React.ReactElement {
  return <_Close {...props} />;
}
