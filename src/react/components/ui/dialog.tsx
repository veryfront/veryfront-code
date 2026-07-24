/**
 * Dialog — BASIC fork of @radix-ui/react-dialog with the same API shape (Root /
 * Trigger / Content + Header / Title / Description / Body / Footer / Action /
 * Cancel / Close / Form). Classes ported 1:1 from Studio's `Dialog` (tokens
 * remapped; `Heading` level 2 + `Text` inlined). Modal overlay + centered panel;
 * dismisses on `Escape` and overlay click. A11y work tracked in modal-surface.tsx.
 *
 * @module react/components/ui/dialog
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { ScrollFade } from "./scroll-fade.tsx";
import { Button, type ButtonProps, LoadingButton } from "./button.tsx";
import { useDisclosure } from "./disclosure.ts";
import {
  ModalClose,
  ModalContent,
  ModalContext,
  ModalTrigger,
  useModal,
} from "./modal-surface.tsx";

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
  const { open: isOpen, setOpen } = useDisclosure({ open, defaultOpen, onOpenChange });
  const ctx = React.useMemo(() => ({ open: isOpen, setOpen }), [isOpen, setOpen]);
  return (
    <ModalContext.Provider value={ctx}>
      {children}
    </ModalContext.Provider>
  );
}

/** Trigger — opens the dialog. `asChild` merges onto the child element. */
export function DialogTrigger(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean },
): React.ReactElement {
  return <ModalTrigger {...props} />;
}

/** Modal surface — overlay + centered panel, rendered while open. */
export function DialogContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement | null {
  return (
    <ModalContent
      className={cn(
        "fixed left-1/2 top-1/2 z-50 w-[calc(100%-3rem)] max-w-xl max-h-[85vh] -translate-x-1/2 -translate-y-1/2",
        "rounded-xl bg-[var(--dialog)] text-[var(--foreground)] shadow-lg outline-none overflow-hidden flex flex-col",
        className,
      )}
      {...props}
    >
      {children}
    </ModalContent>
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
  const ctx = useModal("Dialog");
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
export function DialogClose(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean },
): React.ReactElement {
  return <ModalClose {...props} />;
}
