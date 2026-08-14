/**
 * Dialog - BASIC fork of @radix-ui/react-dialog with the same API shape (Root /
 * Trigger / Content + Header / Title / Description / Body / Footer / Action /
 * Cancel / Close / Form). Classes ported 1:1 from Studio's `Dialog` (tokens
 * remapped; `Heading` level 2 + `Text` inlined). Modal overlay + centered panel;
 * dismisses on `Escape` and overlay click. A11y work tracked in modal-surface.tsx.
 *
 * @example
 * ```tsx
 * import { Button, Dialog, DialogAction, DialogCancel, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from "veryfront/ui";
 *
 * <Dialog>
 *   <DialogTrigger asChild><Button variant="destructive">Delete</Button></DialogTrigger>
 *   <DialogContent>
 *     <DialogTitle>Delete project?</DialogTitle>
 *     <DialogFooter>
 *       <DialogCancel>Cancel</DialogCancel>
 *       <DialogAction onClick={remove}>Delete</DialogAction>
 *     </DialogFooter>
 *   </DialogContent>
 * </Dialog>;
 * ```
 *
 * @module react/components/ui/dialog
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { ScrollFade } from "./scroll-fade.tsx";
import { Button, type ButtonProps, LoadingButton } from "./button.tsx";
import { useAdapter } from "./adapter/context.tsx";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect.ts";

// The Dialog's behavioural mechanics (open state, overlay, dismiss, focus) are
// resolved per-render from the active UI adapter. With no adapter provider this
// is the zero-dependency `builtinDialog`, so behaviour is unchanged.

/** Props accepted by `<Dialog>`. */
export interface DialogProps {
  /** The trigger and content parts to compose. */
  children: React.ReactNode;
  /** Controlled open state (pair with `onOpenChange`). */
  open?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Fires when the open state changes. */
  onOpenChange?: (open: boolean) => void;
}

/** Dialog root - owns open state. */
export function Dialog(props: DialogProps): React.ReactElement {
  const { dialog } = useAdapter();
  return <dialog.Root {...props} />;
}

/** Trigger - opens the dialog. `asChild` merges onto the child element. */
export function DialogTrigger(
  props:
    & React.ButtonHTMLAttributes<HTMLButtonElement>
    & { asChild?: boolean; ref?: React.Ref<HTMLButtonElement> },
): React.ReactElement {
  const { dialog } = useAdapter();
  return <dialog.Trigger {...props} />;
}

/** Props accepted by `<DialogContent>`. */
export interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** React 19: ref is a regular prop, forwarded to the dialog panel. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Modal surface - overlay + centered panel, rendered while open. */
export function DialogContent({
  className,
  children,
  "aria-describedby": describedBy,
  ...props
}: DialogContentProps): React.ReactElement | null {
  const { dialog } = useAdapter();
  const modal = dialog.useDialog();
  return (
    <dialog.Content
      aria-describedby={describedBy ?? (modal.descriptionPresent ? modal.descriptionId : undefined)}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 w-[calc(100%-3rem)] max-w-xl max-h-[85vh] -translate-x-1/2 -translate-y-1/2",
        "rounded-xl bg-[var(--dialog)] text-[var(--foreground)] shadow-lg outline-none overflow-hidden flex flex-col",
        className,
      )}
      {...props}
    >
      {children}
    </dialog.Content>
  );
}

/** Left-aligned title + description block. */
export function DialogHeader(
  { className, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  return <div className={cn("flex flex-col px-6 pt-6 shrink-0", className)} {...props} />;
}

/** Dialog title - Studio Heading level 2 (20px). Semibold so Inter reads at
 * Studio's medium-on-Söhne weight (workbench heading convention). Registers its
 * id with the adapter so the panel adopts `aria-labelledby`. */
export function DialogTitle({
  className,
  id,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  const { dialog } = useAdapter();
  const modal = dialog.useDialog();
  const resolvedId = id ?? modal.defaultTitleId;
  useIsomorphicLayoutEffect(() => {
    modal.setTitleId(resolvedId);
    modal.setTitlePresent(true);
    return () => {
      modal.setTitlePresent(false);
      modal.setTitleId((current) => current === resolvedId ? modal.defaultTitleId : current);
    };
  }, [modal.defaultTitleId, modal.setTitleId, modal.setTitlePresent, resolvedId]);
  return (
    <h2
      id={resolvedId}
      className={cn(
        "text-xl font-semibold text-[var(--foreground)]",
        className,
      )}
      {...props}
    />
  );
}

/** Dialog description - body text, left-aligned. Registers its id with the
 * adapter so the panel adopts `aria-describedby`. */
export function DialogDescription({
  className,
  id,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.ReactElement {
  const { dialog } = useAdapter();
  const modal = dialog.useDialog();
  const resolvedId = id ?? modal.defaultDescriptionId;
  useIsomorphicLayoutEffect(() => {
    modal.setDescriptionId(resolvedId);
    modal.setDescriptionPresent(true);
    return () => {
      modal.setDescriptionPresent(false);
      modal.setDescriptionId((current) =>
        current === resolvedId ? modal.defaultDescriptionId : current
      );
    };
  }, [
    modal.defaultDescriptionId,
    modal.setDescriptionId,
    modal.setDescriptionPresent,
    resolvedId,
  ]);
  return (
    <p
      id={resolvedId}
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

/** Sticky footer row - action left, cancel right. */
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
  /** Show the pending/pulsing state and block double-submits. */
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
  const { dialog } = useAdapter();
  const ctx = dialog.useDialog();
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) ctx.setOpen(false);
      }}
      {...props}
    />
  );
}

/** Closes the dialog. `asChild` merges onto the child element. */
export function DialogClose(
  props:
    & React.ButtonHTMLAttributes<HTMLButtonElement>
    & { asChild?: boolean; ref?: React.Ref<HTMLButtonElement> },
): React.ReactElement {
  const { dialog } = useAdapter();
  return <dialog.Close {...props} />;
}
