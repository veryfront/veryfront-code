/**
 * Dialog — BASIC fork of @radix-ui/react-dialog with the same API shape (Root /
 * Trigger / Content + Header / Title / Description / Body / Footer / Action /
 * Cancel / Close / Form). Classes ported 1:1 from Studio's `Dialog` (tokens
 * remapped; `Heading` level 2 + `Text` inlined). Modal overlay + centered panel;
 * dismisses on `Escape` and overlay click.
 *
 * TODO(a11y): focus trap + restore, `aria-labelledby`/`aria-describedby` wiring,
 * scroll-lock, portal, enter/exit animation. Private to the chat module.
 *
 * @module react/components/chat/ui/dialog
 */
import * as React from "react";
import { cn } from "../theme.ts";
import { Slot } from "./slot.tsx";
import { ScrollFade } from "./scroll-fade.tsx";
import { Button, type ButtonProps, LoadingButton } from "./button.tsx";

const DialogContext = React.createContext<
  { open: boolean; setOpen: (open: boolean) => void } | null
>(null);

function useDialog() {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("Dialog parts must be used within <Dialog>");
  return ctx;
}

/** Props accepted by `<Dialog>`. */
export interface DialogProps {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Dialog root — owns open state. */
export function Dialog({
  children,
  open,
  defaultOpen,
  onOpenChange,
}: DialogProps): React.ReactElement {
  const [internal, setInternal] = React.useState(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internal;
  const setOpen = React.useCallback((next: boolean) => {
    if (!isControlled) setInternal(next);
    onOpenChange?.(next);
  }, [isControlled, onOpenChange]);
  return (
    <DialogContext.Provider value={{ open: isOpen, setOpen }}>
      {children}
    </DialogContext.Provider>
  );
}

/** Trigger — opens the dialog. `asChild` merges onto the child element. */
export function DialogTrigger({
  children,
  asChild,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }): React.ReactElement {
  const ctx = useDialog();
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

/** Modal surface — overlay + centered panel, rendered while open. */
export function DialogContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement | null {
  const ctx = useDialog();
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!ctx.open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") ctx.setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    // Focus the first focusable descendant on open (radix-like) — e.g. a
    // CommandInput — falling back to the panel itself. Full focus-trap is TODO.
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panel)?.focus();
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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100%-3rem)] max-w-xl max-h-[85vh] -translate-x-1/2 -translate-y-1/2",
          "rounded-xl bg-[var(--dialog)] text-[var(--foreground)] shadow-lg outline-none overflow-hidden flex flex-col",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

/** Left-aligned title + description block. */
export function DialogHeader(
  { className, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  return <div className={cn("flex flex-col px-6 pt-6 shrink-0", className)} {...props} />;
}

/** Dialog title — Studio Heading level 2 (20px). Semibold so Inter reads at
 * Studio's medium-on-Söhne weight (workbench heading convention). */
export function DialogTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return (
    <h2
      className={cn(
        "text-xl font-semibold text-[var(--foreground)]",
        className,
      )}
      {...props}
    />
  );
}

/** Dialog description — body text, left-aligned. */
export function DialogDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.ReactElement {
  return (
    <p
      className={cn(
        "text-base font-normal text-[var(--foreground)] mt-2",
        className,
      )}
      {...props}
    />
  );
}

/** Scrollable body area with a bottom edge-fade. */
export function DialogBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <ScrollFade
      edges="bottom"
      className={cn("px-6 mt-6 pb-1 min-h-0 flex flex-col gap-4 text-left", className)}
      {...props}
    >
      {children}
    </ScrollFade>
  );
}

/** Sticky footer row — action left, cancel right. */
export function DialogFooter(
  { className, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  return <div className={cn("p-6 flex justify-start gap-3 shrink-0", className)} {...props} />;
}

/** Layout-neutral `<form>` shell (`display: contents`) wrapping header/body/footer. */
export function DialogForm(
  { className, ...props }: React.FormHTMLAttributes<HTMLFormElement>,
): React.ReactElement {
  return <form className={cn("contents", className)} {...props} />;
}

/** Props accepted by `<DialogAction>`. */
export interface DialogActionProps extends ButtonProps {
  isLoading?: boolean;
}

/** Recommended action button (primary, default size). */
export function DialogAction({
  isLoading,
  variant = "primary",
  size = "default",
  type = "button",
  ...props
}: DialogActionProps): React.ReactElement {
  return (
    <LoadingButton
      type={type}
      variant={variant}
      size={size}
      isLoading={Boolean(isLoading)}
      {...props}
    />
  );
}

/** Alternate button (secondary, default size) that closes the dialog. */
export function DialogCancel({
  className,
  variant = "secondary",
  size = "default",
  onClick,
  ...props
}: ButtonProps): React.ReactElement {
  const ctx = useDialog();
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={(e) => {
        onClick?.(e);
        ctx.setOpen(false);
      }}
      {...props}
    />
  );
}

/** Closes the dialog. `asChild` merges onto the child element. */
export function DialogClose({
  children,
  asChild,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }): React.ReactElement {
  const ctx = useDialog();
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
