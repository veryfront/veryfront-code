/**
 * Toast: transient notification messages. A `ToastProvider` holds the queue and
 * renders a viewport; `useToast()` enqueues messages from anywhere inside the
 * provider. The queue mechanics come from the active adapter's `toast` slot: the
 * zero-dependency builtin by default, swappable to Sonner / react-hot-toast via
 * `UIAdapterProvider`. The visual surface + option types live in `toast-parts.tsx`
 * (re-exported here); this file is the thin, adapter-routed public entry.
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
 *         toast({
 *           title: "Saved",
 *           description: "Your changes are live.",
 *           variant: "success",
 *           action: { label: "Undo", onClick: undo },
 *         })}
 *     >
 *       Save
 *     </button>
 *   );
 * }
 *
 * // Fully custom node: toast.custom((id) => <MyToast onClose={() => dismiss(id)} />);
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
import { useAdapter } from "./adapter/context.tsx";
import type { ToastState } from "./adapter/contract.ts";

// Presentational parts + option types (pure visual, no queue): re-exported so
// consumers import them from `veryfront/ui` as before.
export {
  Toast,
  type ToastAction,
  ToastClose,
  ToastDescription,
  type ToastFn,
  type ToastOptions,
  type ToastProps,
  ToastTitle,
  type ToastVariant,
} from "./toast-parts.tsx";

// The builtin viewport is engine-specific. Set `viewport="manual"` on the
// provider before rendering this export (or its `Toaster` alias).
export {
  ToastViewport,
  ToastViewport as Toaster,
  type ToastViewportProps,
} from "./adapter/builtin/toast.tsx";

/** Props accepted by `<ToastProvider>`. */
export interface ToastProviderProps {
  /** Subtree that can enqueue toasts via `useToast()`. */
  children: React.ReactNode;
  /** Default milliseconds before a toast auto-dismisses, unless the call overrides it. @default 5000 */
  duration?: number;
  /** Maximum queued notifications (1 to 50); oldest entries are evicted first. @default 5 */
  maxToasts?: number;
  /** Viewport ownership. Portal is hydration-safe; manual requires rendering ToastViewport. @default "portal" */
  viewport?: "portal" | "inline" | "manual";
}

/**
 * Holds the toast queue (via the active adapter: builtin by default) and mounts
 * the viewport. Wrap the part of the app that needs notifications.
 */
export function ToastProvider(
  { children, duration, maxToasts, viewport }: ToastProviderProps,
): React.ReactElement {
  const { toast } = useAdapter();
  return (
    <toast.Provider duration={duration} maxToasts={maxToasts} viewport={viewport}>
      {children}
    </toast.Provider>
  );
}
ToastProvider.displayName = "ToastProvider";

/**
 * Returns `{ toast, dismiss }`. Call `toast(options)` to enqueue (returns the new
 * id), `toast.custom((id) => node)` for a fully custom toast, and `dismiss(id)` to
 * remove one early. Must be used within a `ToastProvider`.
 */
export function useToast(): ToastState {
  const { toast } = useAdapter();
  return toast.useToast();
}
