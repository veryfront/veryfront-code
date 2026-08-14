/**
 * AlertDialog - a confirmation modal. Semantically a {@link Dialog} with
 * `role="alertdialog"`, a REQUIRED title + description, and explicit
 * Action / Cancel buttons. Unlike `Dialog` it does NOT dismiss on outside-click
 * or `Escape`: the user must choose an option.
 *
 * It reuses the Dialog primitive's open-state context (`dialog.Root` /
 * `dialog.Trigger` / `dialog.useDialog` resolved from the active adapter) so
 * trigger + open state behave identically, but renders its own alert-specific
 * overlay + panel - the panel carries `role="alertdialog"` and its
 * `aria-labelledby` / `aria-describedby` are wired to the Title / Description
 * ids, and neither the overlay nor a key listener dismisses it.
 *
 * @example
 * ```tsx
 * import {
 *   AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
 *   AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger,
 * } from "veryfront/ui";
 *
 * <AlertDialog>
 *   <AlertDialogTrigger>Delete account</AlertDialogTrigger>
 *   <AlertDialogContent>
 *     <AlertDialogTitle>Delete account?</AlertDialogTitle>
 *     <AlertDialogDescription>This permanently removes your account.</AlertDialogDescription>
 *     <AlertDialogFooter>
 *       <AlertDialogCancel>Cancel</AlertDialogCancel>
 *       <AlertDialogAction variant="destructive" onClick={remove}>Delete</AlertDialogAction>
 *     </AlertDialogFooter>
 *   </AlertDialogContent>
 * </AlertDialog>;
 * ```
 *
 * @module react/components/ui/alert-dialog
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { Button, type ButtonProps } from "./button.tsx";
import { useAdapter } from "./adapter/context.tsx";
import { registerDismissableLayer } from "./dismissable-layer.ts";
import { composeRefs } from "./slot.tsx";

// The confirm modal's open state / trigger reuse the Dialog slot of the active
// UI adapter (zero-dependency `builtinDialog` with no provider), so open/close
// behaviour is shared with Dialog. Only the surface (role + non-dismissing
// overlay) is alert-specific and authored here.

/** Title / Description element ids, published by Content so the labelled parts adopt them. */
interface AlertDialogIds {
  titleId: string;
  descriptionId: string;
}

const AlertDialogContext = React.createContext<AlertDialogIds | null>(null);

/** Read the Content-provided ids; throws when a labelled part is used outside `<AlertDialogContent>`. */
function useAlertDialogIds(): AlertDialogIds {
  const ctx = React.useContext(AlertDialogContext);
  if (!ctx) throw new Error("AlertDialog parts must be used within <AlertDialogContent>");
  return ctx;
}

const FOCUSABLE =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Props accepted by `<AlertDialog>`. */
export interface AlertDialogProps {
  /** The trigger and content parts to compose. */
  children: React.ReactNode;
  /** Controlled open state (pair with `onOpenChange`). @default undefined */
  open?: boolean;
  /** Initial open state when uncontrolled. @default false */
  defaultOpen?: boolean;
  /** Fires when the open state changes. @default undefined */
  onOpenChange?: (open: boolean) => void;
}

/** AlertDialog root - owns open state (shares the Dialog adapter slot). */
export function AlertDialog(props: AlertDialogProps): React.ReactElement {
  const { dialog } = useAdapter();
  return <dialog.Root {...props} />;
}

/** Props accepted by `<AlertDialogTrigger>`. */
export interface AlertDialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Merge trigger behaviour onto the child element instead of a `<button>`. @default false */
  asChild?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** Trigger - opens the alert dialog. `asChild` merges onto the child element. */
export function AlertDialogTrigger(props: AlertDialogTriggerProps): React.ReactElement {
  const { dialog } = useAdapter();
  return <dialog.Trigger {...props} />;
}

/** Props accepted by `<AlertDialogContent>`. */
export interface AlertDialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** React 19: ref is a regular prop (forwarded to the panel node). */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * Alert surface - non-dismissing overlay + centered `role="alertdialog"` panel,
 * rendered only while open. Generates the title / description ids, wires them to
 * `aria-labelledby` / `aria-describedby`, and moves focus into the panel on open.
 */
export function AlertDialogContent({
  className,
  children,
  ref,
  ...props
}: AlertDialogContentProps): React.ReactElement | null {
  const { dialog } = useAdapter();
  const { open } = dialog.useDialog();
  const titleId = React.useId();
  const descriptionId = React.useId();
  const panelRef = React.useRef<HTMLDivElement>(null);
  // Merge the internal panel ref (read by the focus effect) with any consumer
  // ref via `composeRefs`, which tracks + runs ref cleanups for us.
  const setNode = React.useMemo(() => composeRefs<HTMLDivElement>(panelRef, ref), [ref]);
  React.useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    return registerDismissableLayer(
      panel.ownerDocument,
      () => panelRef.current,
      () => {},
    );
  }, [open]);
  // Move focus into the panel on open (no Escape listener → no key-dismiss).
  React.useEffect(() => {
    if (!open) return;
    const focusable = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (focusable ?? panelRef.current)?.focus();
  }, [open]);
  const ids = React.useMemo<AlertDialogIds>(() => ({ titleId, descriptionId }), [
    titleId,
    descriptionId,
  ]);
  if (!open) return null;
  return (
    <AlertDialogContext.Provider value={ids}>
      <div className="fixed inset-0 z-50" data-state="open">
        {/* Overlay: intentionally has NO onClick - an alert dialog never dismisses on outside-click. */}
        <div className="fixed inset-0 bg-[var(--overlay)]" data-state="open" />
        <div
          ref={setNode}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          data-state="open"
          tabIndex={-1}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-3rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
            "rounded-xl bg-[var(--dialog)] text-[var(--foreground)] shadow-lg outline-none",
            "flex flex-col gap-4 p-6",
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </div>
    </AlertDialogContext.Provider>
  );
}

/** Props accepted by `<AlertDialogTitle>`. */
export interface AlertDialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLHeadingElement>;
}

/** Required accessible name - adopts the Content-generated `aria-labelledby` id. */
export function AlertDialogTitle({
  className,
  ref,
  ...props
}: AlertDialogTitleProps): React.ReactElement {
  const { titleId } = useAlertDialogIds();
  return (
    <h2
      ref={ref}
      {...props}
      id={titleId}
      className={cn("text-lg font-semibold text-[var(--foreground)]", className)}
    />
  );
}

/** Props accepted by `<AlertDialogDescription>`. */
export interface AlertDialogDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLParagraphElement>;
}

/** Required supporting copy - adopts the Content-generated `aria-describedby` id. */
export function AlertDialogDescription({
  className,
  ref,
  ...props
}: AlertDialogDescriptionProps): React.ReactElement {
  const { descriptionId } = useAlertDialogIds();
  return (
    <p
      ref={ref}
      {...props}
      id={descriptionId}
      className={cn("text-sm font-normal text-[var(--muted-foreground)]", className)}
    />
  );
}

/** Props accepted by `<AlertDialogFooter>`. */
export interface AlertDialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Right-aligned action row - Cancel first, then the Action. */
export function AlertDialogFooter({
  className,
  ref,
  ...props
}: AlertDialogFooterProps): React.ReactElement {
  return (
    <div
      ref={ref}
      data-slot="footer"
      className={cn("mt-2 flex justify-end gap-3", className)}
      {...props}
    />
  );
}

/** Props accepted by `<AlertDialogAction>`. */
export type AlertDialogActionProps = ButtonProps;

/** Confirming action - runs `onClick`, then closes unless it calls `preventDefault()`. */
export function AlertDialogAction({
  variant = "primary",
  size = "default",
  type = "button",
  onClick,
  ...props
}: AlertDialogActionProps): React.ReactElement {
  const { dialog } = useAdapter();
  const ctx = dialog.useDialog();
  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) ctx.setOpen(false);
      }}
      {...props}
    />
  );
}

/** Props accepted by `<AlertDialogCancel>`. */
export type AlertDialogCancelProps = ButtonProps;

/** Dismissing action - runs `onClick`, then closes unless it calls `preventDefault()`. */
export function AlertDialogCancel({
  variant = "secondary",
  size = "default",
  type = "button",
  onClick,
  ...props
}: AlertDialogCancelProps): React.ReactElement {
  const { dialog } = useAdapter();
  const ctx = dialog.useDialog();
  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) ctx.setOpen(false);
      }}
      {...props}
    />
  );
}
