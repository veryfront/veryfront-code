/**
 * Drawer — BASIC bottom-sheet fork of Studio's `Drawer` (which is a large
 * Vaul-style component). Same API shape for the parts we need: Root / Trigger /
 * Content (overlay + sheet + drag handle) / Title / Header / Body / Footer /
 * Close. Surface classes ported 1:1 from Studio (tokens remapped). Slides up
 * from the bottom; dismisses on `Escape` and overlay click.
 *
 * TODO(a11y): focus trap + restore, drag-to-dismiss / snap points, scroll-lock,
 * portal, enter/exit animation. Private to the chat module.
 *
 * @module react/components/chat/ui/drawer
 */
import * as React from "react";
import { cn } from "../theme.ts";
import { Slot } from "./slot.tsx";

const DrawerContext = React.createContext<
  { open: boolean; setOpen: (open: boolean) => void } | null
>(null);

function useDrawer() {
  const ctx = React.useContext(DrawerContext);
  if (!ctx) throw new Error("Drawer parts must be used within <Drawer>");
  return ctx;
}

/** Props accepted by `<Drawer>`. */
export interface DrawerProps {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Drawer root — owns open state. */
export function Drawer({
  children,
  open,
  defaultOpen,
  onOpenChange,
}: DrawerProps): React.ReactElement {
  const [internal, setInternal] = React.useState(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internal;
  const setOpen = React.useCallback((next: boolean) => {
    if (!isControlled) setInternal(next);
    onOpenChange?.(next);
  }, [isControlled, onOpenChange]);
  return (
    <DrawerContext.Provider value={{ open: isOpen, setOpen }}>
      {children}
    </DrawerContext.Provider>
  );
}

/** Trigger — opens the drawer. `asChild` merges onto the child element. */
export function DrawerTrigger({
  children,
  asChild,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }): React.ReactElement {
  const ctx = useDrawer();
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

/** Bottom sheet — overlay + sliding surface with a drag handle. */
export function DrawerContent({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement | null {
  const ctx = useDrawer();
  const sheetRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!ctx.open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") ctx.setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const focusable = sheetRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? sheetRef.current)?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ctx.open]);

  if (!ctx.open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div
        className="fixed inset-0 bg-[var(--overlay)]"
        onClick={() => ctx.setOpen(false)}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex flex-col max-h-[85vh] w-full rounded-t-xl bg-[var(--drawer)] text-[var(--foreground)] outline-none",
          className,
        )}
        {...props}
      >
        <div
          aria-hidden="true"
          className="mx-auto mt-3 h-[3px] w-[30px] shrink-0 rounded-full bg-[var(--outline-border)]"
        />
        {children}
      </div>
    </div>
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
export function DrawerClose({
  children,
  asChild,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }): React.ReactElement {
  const ctx = useDrawer();
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
