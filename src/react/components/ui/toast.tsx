/**
 * Toast — transient notification messages. A `ToastProvider` holds the queue and
 * renders a fixed-position viewport; `useToast()` enqueues messages from anywhere
 * inside the provider; each `Toast` surface auto-dismisses after its `duration`
 * (default ~5000ms) and can be closed manually. This is a pure-visual surface + a
 * queue — no floating engine and no adapter routing. Skinned entirely with
 * veryfront theme tokens (`--popover`, `--foreground`, `--status-success`,
 * `--status-error`, `--muted-foreground`, `--edge`).
 *
 * @module react/components/ui/toast
 *
 * @example
 * ```tsx
 * import { ToastProvider, useToast } from "veryfront/ui";
 *
 * function SaveButton() {
 *   const { toast } = useToast();
 *   return (
 *     <button
 *       type="button"
 *       onClick={() =>
 *         toast({ title: "Saved", description: "Your changes are live.", variant: "success" })}
 *     >
 *       Save
 *     </button>
 *   );
 * }
 *
 * export function App() {
 *   return (
 *     <ToastProvider>
 *       <SaveButton />
 *     </ToastProvider>
 *   );
 * }
 * ```
 */
import * as React from "react";
import { createStrictContext } from "../create-strict-context.ts";
import { cva, cx as cn, type VariantProps } from "./cva.ts";

const toastVariants = cva(
  "pointer-events-auto relative flex w-full items-start gap-3 rounded-lg border border-[var(--edge)] bg-[var(--popover)] p-4 pr-8 text-sm text-[var(--foreground)] shadow-lg",
  {
    variants: {
      variant: {
        default: "",
        success: "border-l-4 border-l-[var(--status-success)]",
        destructive: "border-l-4 border-l-[var(--status-error)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

/** One of the `cva` colour schemes a toast can take. */
export type ToastVariant = NonNullable<VariantProps<typeof toastVariants>["variant"]>;

/** Options accepted by `toast(...)` when enqueuing a notification. */
export interface ToastOptions {
  /** Heading line. */
  title?: React.ReactNode;
  /** Secondary supporting line shown under the title. */
  description?: React.ReactNode;
  /** Colour scheme. @default "default" */
  variant?: ToastVariant;
  /** Milliseconds before auto-dismiss; pass `Infinity` to persist. Overrides the provider default. */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  /** Stable identifier used as the React key and dismiss handle. */
  id: string;
}

interface ToastContextValue {
  toasts: ToastRecord[];
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const [ToastContext, useToastContext] = createStrictContext<ToastContextValue>(
  "useToast",
  "a <ToastProvider>",
);

/** Props accepted by `<ToastProvider>`. */
export interface ToastProviderProps {
  /** Subtree that can enqueue toasts via `useToast()`. */
  children: React.ReactNode;
  /** Default milliseconds before a toast auto-dismisses, unless the call overrides it. @default 5000 */
  duration?: number;
}

/**
 * Holds the toast queue, exposes it via context, and mounts the viewport
 * automatically. Wrap the part of the app that needs notifications.
 */
export function ToastProvider({
  children,
  duration = 5000,
}: ToastProviderProps): React.ReactElement {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const idRef = React.useRef(0);

  const dismiss = React.useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback((options: ToastOptions) => {
    const id = `toast-${idRef.current++}`;
    setToasts((list) => [...list, { duration, ...options, id }]);
    return id;
  }, [duration]);

  const value = React.useMemo<ToastContextValue>(
    () => ({ toasts, toast, dismiss }),
    [toasts, toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport />
    </ToastContext.Provider>
  );
}
ToastProvider.displayName = "ToastProvider";

/**
 * Returns `{ toast, dismiss }`. Call `toast(options)` to enqueue (returns the new
 * id) and `dismiss(id)` to remove one early. Must be used within a `ToastProvider`.
 */
export function useToast(): Pick<ToastContextValue, "toast" | "dismiss"> {
  const { toast, dismiss } = useToastContext();
  return { toast, dismiss };
}

/** Props accepted by `<ToastViewport>`. */
export interface ToastViewportProps extends React.HTMLAttributes<HTMLOListElement> {
  ref?: React.Ref<HTMLOListElement>;
}

/**
 * Fixed region (bottom-right) that stacks the queued toasts. `ToastProvider`
 * mounts one automatically, so you rarely render this yourself. Exported (and
 * aliased as `Toaster`) for advanced placement.
 */
export function ToastViewport({
  className,
  ref,
  ...props
}: ToastViewportProps): React.ReactElement {
  const { toasts, dismiss } = useToastContext();

  return (
    <ol
      ref={ref}
      aria-label="Notifications"
      className={cn(
        "pointer-events-none fixed bottom-0 right-0 z-[100] flex w-full max-w-full flex-col-reverse gap-2 p-4 sm:max-w-sm",
        className,
      )}
      {...props}
    >
      {toasts.map((t) => (
        <Toast
          key={t.id}
          variant={t.variant}
          duration={t.duration}
          onClose={() => dismiss(t.id)}
        >
          <div className="flex-1 space-y-1">
            {t.title ? <ToastTitle>{t.title}</ToastTitle> : null}
            {t.description ? <ToastDescription>{t.description}</ToastDescription> : null}
          </div>
          <ToastClose onClick={() => dismiss(t.id)} />
        </Toast>
      ))}
    </ol>
  );
}
ToastViewport.displayName = "ToastViewport";

export { ToastViewport as Toaster };

/** Props accepted by `<Toast>`. */
export interface ToastProps
  extends Omit<React.LiHTMLAttributes<HTMLLIElement>, "title">, VariantProps<typeof toastVariants> {
  /** Milliseconds before the toast auto-closes; `Infinity`/`0` disables the timer. @default 5000 */
  duration?: number;
  /** Invoked when the auto-dismiss timer fires. */
  onClose?: () => void;
  ref?: React.Ref<HTMLLIElement>;
}

/**
 * A single toast surface. Renders as a live region and arms an auto-dismiss timer
 * that calls `onClose` after `duration`. Compose `ToastTitle`, `ToastDescription`
 * and `ToastClose` inside it.
 */
export function Toast({
  variant,
  duration = 5000,
  onClose,
  className,
  children,
  ref,
  ...props
}: ToastProps): React.ReactElement {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (duration == null || duration === Infinity || duration <= 0) return;
    const timer = setTimeout(() => onCloseRef.current?.(), duration);
    return () => clearTimeout(timer);
  }, [duration]);

  return (
    <li
      ref={ref}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-variant={variant ?? "default"}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    >
      {children}
    </li>
  );
}
Toast.displayName = "Toast";

/** Heading line for `<Toast>`. */
export function ToastTitle({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
}): React.ReactElement {
  return (
    <div
      ref={ref}
      className={cn("text-sm font-medium text-[var(--foreground)]", className)}
      {...props}
    />
  );
}
ToastTitle.displayName = "ToastTitle";

/** Secondary supporting line for `<Toast>`. */
export function ToastDescription({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & {
  ref?: React.Ref<HTMLParagraphElement>;
}): React.ReactElement {
  return (
    <p
      ref={ref}
      className={cn("text-sm text-[var(--muted-foreground)]", className)}
      {...props}
    />
  );
}
ToastDescription.displayName = "ToastDescription";

/** Manual close button for `<Toast>` (renders an ✕ glyph when given no children). */
export function ToastClose({
  className,
  children,
  ref,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: React.Ref<HTMLButtonElement>;
}): React.ReactElement {
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Dismiss notification"
      className={cn(
        "absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]",
        className,
      )}
      {...props}
    >
      {children ?? (
        <svg
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      )}
    </button>
  );
}
ToastClose.displayName = "ToastClose";
