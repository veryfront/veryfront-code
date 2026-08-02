/**
 * Builtin Toast adapter: the zero-dependency toast engine: a `ToastProvider`
 * that holds a queue and mounts a fixed bottom-right viewport, plus `useToast`.
 * Composes the presentational parts from `toast-parts.tsx` (structured
 * icon/action/cancel toasts, and `toast.custom` nodes). Imports ONLY the parts +
 * the contract types: never the `toast.tsx` skin or the adapter context: so
 * Toast can be adapter-routed without an import cycle. A Sonner adapter satisfies
 * the same `ToastParts` contract by mounting `<Toaster/>` instead.
 *
 * @module react/components/ui/adapter/builtin/toast
 */
import * as React from "react";
import { createStrictContext } from "../../../create-strict-context.ts";
import { cx as cn } from "../../cva.ts";
import {
  Toast,
  ToastClose,
  ToastDescription,
  type ToastFn,
  type ToastOptions,
  ToastTitle,
  useAutoDismiss,
} from "../../toast-parts.tsx";
import type { ToastParts, ToastState } from "../contract.ts";

interface ToastRecord extends ToastOptions {
  /** Stable identifier used as the React key and dismiss handle. */
  id: string;
  /** When set (via `toast.custom`), renders this node instead of the built-in surface. */
  render?: (id: string) => React.ReactNode;
}

interface BuiltinToastContextValue extends ToastState {
  toasts: ToastRecord[];
}

const [ToastContext, useToastContext] = createStrictContext<BuiltinToastContextValue>(
  "useToast",
  "a <ToastProvider>",
);

/** Builtin provider: owns the queue, exposes `{ toast, dismiss }`, mounts the viewport. */
function BuiltinToastProvider(
  { children, duration = 5000, maxToasts = 100 }: {
    children: React.ReactNode;
    duration?: number;
    maxToasts?: number;
  },
): React.ReactElement {
  assertDuration(duration, "ToastProvider duration");
  if (!Number.isSafeInteger(maxToasts) || maxToasts < 1) {
    throw new RangeError("ToastProvider maxToasts must be a positive safe integer");
  }
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const idRef = React.useRef(0);

  const dismiss = React.useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const enqueue = React.useCallback((record: Omit<ToastRecord, "id">) => {
    assertDuration(record.duration ?? duration, "toast duration");
    const id = `toast-${idRef.current++}`;
    setToasts((list) => [...list, { duration, ...record, id }].slice(-maxToasts));
    return id;
  }, [duration, maxToasts]);

  const toast = React.useMemo<ToastFn>(() => {
    const fn = ((options: ToastOptions) => enqueue(options)) as ToastFn;
    fn.custom = (render: (id: string) => React.ReactNode) => enqueue({ render });
    return fn;
  }, [enqueue]);

  const value = React.useMemo<BuiltinToastContextValue>(
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
BuiltinToastProvider.displayName = "BuiltinToastProvider";

function assertDuration(value: number, label: string): void {
  if (value !== Infinity && (!Number.isFinite(value) || value < 0)) {
    throw new RangeError(`${label} must be a non-negative finite number or Infinity`);
  }
}

function useBuiltinToast(): ToastState {
  const { toast, dismiss } = useToastContext();
  return { toast, dismiss };
}

/** Props accepted by `<ToastViewport>`. */
export interface ToastViewportProps extends React.HTMLAttributes<HTMLOListElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLOListElement>;
}

/**
 * Fixed region (bottom-right) that stacks the queued toasts. The builtin
 * `ToastProvider` mounts one automatically, so you rarely render this yourself.
 * Exported (and aliased as `Toaster`) for advanced placement on the builtin engine.
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
      {toasts.map((t) => <ToastItem key={t.id} record={t} onDismiss={() => dismiss(t.id)} />)}
    </ol>
  );
}
ToastViewport.displayName = "ToastViewport";

/** Renders one queued toast: a `toast.custom` node, or the built-in surface. */
function ToastItem(
  { record, onDismiss }: { record: ToastRecord; onDismiss: () => void },
): React.ReactElement {
  if (record.render) {
    return (
      <CustomToastItem duration={record.duration} onClose={onDismiss}>
        {record.render(record.id)}
      </CustomToastItem>
    );
  }
  const { icon, title, description, action, cancel, variant, duration } = record;
  return (
    <Toast variant={variant} duration={duration} onClose={onDismiss}>
      {icon
        ? (
          <span
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-[var(--foreground)] [&_svg]:size-5"
          >
            {icon}
          </span>
        )
        : null}
      <div className="flex-1 space-y-1">
        {title ? <ToastTitle>{title}</ToastTitle> : null}
        {description ? <ToastDescription>{description}</ToastDescription> : null}
        {action || cancel
          ? (
            <div className="mt-2 flex gap-2">
              {cancel
                ? (
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        cancel.onClick?.();
                      } finally {
                        onDismiss();
                      }
                    }}
                    className="rounded-md px-2 py-1 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]"
                  >
                    {cancel.label}
                  </button>
                )
                : null}
              {action
                ? (
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        action.onClick();
                      } finally {
                        onDismiss();
                      }
                    }}
                    className="rounded-md bg-[var(--primary)] px-2 py-1 text-sm font-medium text-[var(--secondary)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]"
                  >
                    {action.label}
                  </button>
                )
                : null}
            </div>
          )
          : null}
      </div>
      <ToastClose onClick={onDismiss} />
    </Toast>
  );
}

/** Bare list item for a `toast.custom` node: arms the auto-dismiss timer only. */
function CustomToastItem(
  { duration, onClose, children }: {
    duration?: number;
    onClose: () => void;
    children: React.ReactNode;
  },
): React.ReactElement {
  useAutoDismiss(duration, onClose);
  return <li className="pointer-events-auto">{children}</li>;
}

/** The builtin (zero-dependency) Toast engine, as `ToastParts`. */
export const builtinToast: ToastParts = {
  Provider: BuiltinToastProvider,
  useToast: useBuiltinToast,
};
