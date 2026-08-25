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
import { createPortal } from "react-dom";
import { cx as cn } from "./cva.ts";
import { Button, type ButtonProps } from "./button.tsx";
import { useAdapter } from "./adapter/context.tsx";
import { getModalTokenScope, useModalContentEffect } from "./modal-surface.tsx";
import { composeRefs } from "./slot.tsx";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect.ts";

// The confirm modal's open state / trigger reuse the Dialog slot of the active
// UI adapter (zero-dependency `builtinDialog` with no provider), so open/close
// behaviour is shared with Dialog. Only the surface (role + non-dismissing
// overlay) is alert-specific and authored here.

/** Title / Description element ids, published by Content so the labelled parts adopt them. */
interface AlertDialogIds {
  defaultTitleId: string;
  defaultDescriptionId: string;
  titleId: string;
  descriptionId: string;
  setTitleId: React.Dispatch<React.SetStateAction<string>>;
  setDescriptionId: React.Dispatch<React.SetStateAction<string>>;
}

const AlertDialogContext = React.createContext<AlertDialogIds | null>(null);

interface AlertDialogRootState {
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

const AlertDialogRootContext = React.createContext<AlertDialogRootState | null>(null);

function useAlertDialogRoot(): AlertDialogRootState {
  const ctx = React.useContext(AlertDialogRootContext);
  if (!ctx) throw new Error("AlertDialog parts must be used within <AlertDialog>");
  return ctx;
}

/** Read the Content-provided ids; throws when a labelled part is used outside `<AlertDialogContent>`. */
function useAlertDialogIds(): AlertDialogIds {
  const ctx = React.useContext(AlertDialogContext);
  if (!ctx) throw new Error("AlertDialog parts must be used within <AlertDialogContent>");
  return ctx;
}

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
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const value = React.useMemo<AlertDialogRootState>(() => ({ triggerRef }), []);
  return (
    <AlertDialogRootContext.Provider value={value}>
      <dialog.Root {...props} />
    </AlertDialogRootContext.Provider>
  );
}

/** Props accepted by `<AlertDialogTrigger>`. */
export interface AlertDialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Merge trigger behaviour onto the child element instead of a `<button>`. @default false */
  asChild?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** Trigger - opens the alert dialog. `asChild` merges onto the child element. */
export function AlertDialogTrigger({ ref, ...props }: AlertDialogTriggerProps): React.ReactElement {
  const { dialog } = useAdapter();
  const ctx = useAlertDialogRoot();
  const setTrigger = React.useCallback((node: HTMLButtonElement | null) => {
    ctx.triggerRef.current = node;
    return () => {
      if (ctx.triggerRef.current === node) ctx.triggerRef.current = null;
    };
  }, [ctx.triggerRef]);
  const composedRef = React.useMemo(
    () => composeRefs<HTMLButtonElement>(setTrigger, ref),
    [ref, setTrigger],
  );
  return <dialog.Trigger {...props} ref={composedRef} />;
}

/** Props accepted by `<AlertDialogContent>`. */
export interface AlertDialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** React 19: ref is a regular prop (forwarded to the panel node). */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * Alert surface - non-dismissing overlay + centered `role="alertdialog"` panel,
 * rendered only while open. Generates the title / description ids, wires them to
 * `aria-labelledby` / `aria-describedby`, traps focus, restores it on close,
 * and portals outside clipping ancestors while retaining the token scope.
 */
export function AlertDialogContent({
  className,
  children,
  id,
  ref,
  ...props
}: AlertDialogContentProps): React.ReactElement | null {
  const { dialog } = useAdapter();
  const modal = dialog.useDialog();
  const root = useAlertDialogRoot();
  const defaultTitleId = React.useId();
  const defaultDescriptionId = React.useId();
  const [titleId, setTitleId] = React.useState(defaultTitleId);
  const [descriptionId, setDescriptionId] = React.useState(defaultDescriptionId);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [portalReady, setPortalReady] = React.useState(false);
  React.useEffect(() => setPortalReady(true), []);
  const resolvedContentId = id ?? modal.defaultContentId;
  useIsomorphicLayoutEffect(() => {
    modal.setContentId(resolvedContentId);
    return () => {
      modal.setContentId((current) =>
        current === resolvedContentId ? modal.defaultContentId : current
      );
    };
  }, [modal.defaultContentId, modal.setContentId, resolvedContentId]);
  // Merge the internal panel ref (read by the focus effect) with any consumer
  // ref via `composeRefs`, which tracks + runs ref cleanups for us.
  const setNode = React.useMemo(() => composeRefs<HTMLDivElement>(panelRef, ref), [ref]);
  useModalContentEffect(
    modal.open && portalReady,
    modal.setOpen,
    panelRef,
    root.triggerRef,
    false,
  );
  const ids = React.useMemo<AlertDialogIds>(() => ({
    defaultTitleId,
    defaultDescriptionId,
    titleId,
    descriptionId,
    setTitleId,
    setDescriptionId,
  }), [
    defaultTitleId,
    defaultDescriptionId,
    titleId,
    descriptionId,
  ]);
  if (!modal.open || !portalReady) return null;
  const trigger = root.triggerRef.current;
  const document = trigger?.ownerDocument ?? globalThis.document;
  if (!document?.body) return null;
  const container = getModalTokenScope(document, trigger);
  return createPortal(
    <AlertDialogContext.Provider value={ids}>
      <div className="fixed inset-0 z-50" data-state="open">
        {/* Overlay: intentionally has NO onClick - an alert dialog never dismisses on outside-click. */}
        <div className="fixed inset-0 bg-[var(--overlay)]" data-state="open" />
        <div
          ref={setNode}
          id={resolvedContentId}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          data-state="open"
          tabIndex={-1}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_3rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
            "rounded-xl bg-[var(--dialog)] text-[var(--foreground)] shadow-lg outline-none",
            "flex flex-col gap-4 p-6",
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </div>
    </AlertDialogContext.Provider>,
    container,
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
  id,
  ref,
  ...props
}: AlertDialogTitleProps): React.ReactElement {
  const ids = useAlertDialogIds();
  const resolvedId = id ?? ids.defaultTitleId;
  useIsomorphicLayoutEffect(() => {
    ids.setTitleId(resolvedId);
    return () => {
      ids.setTitleId((current) => current === resolvedId ? ids.defaultTitleId : current);
    };
  }, [ids.defaultTitleId, ids.setTitleId, resolvedId]);
  return (
    <h2
      ref={ref}
      {...props}
      id={resolvedId}
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
  id,
  ref,
  ...props
}: AlertDialogDescriptionProps): React.ReactElement {
  const ids = useAlertDialogIds();
  const resolvedId = id ?? ids.defaultDescriptionId;
  useIsomorphicLayoutEffect(() => {
    ids.setDescriptionId(resolvedId);
    return () => {
      ids.setDescriptionId((current) =>
        current === resolvedId ? ids.defaultDescriptionId : current
      );
    };
  }, [ids.defaultDescriptionId, ids.setDescriptionId, resolvedId]);
  return (
    <p
      ref={ref}
      {...props}
      id={resolvedId}
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
