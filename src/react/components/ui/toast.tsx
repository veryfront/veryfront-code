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
 *           action: { label: "Undo", onClick: () => undefined },
 *         })}
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
import { useAdapter } from "./adapter/context.tsx";
import type {
  ToastParts,
  ToastProviderProps,
  ToastState,
  ToastViewportProps,
} from "./adapter/contract.ts";
import { assertToastDuration, type ToastFn, type ToastOptions } from "./toast-parts.tsx";

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

export type { ToastProviderProps, ToastViewportProps } from "./adapter/contract.ts";

const MAX_TOASTS = 50;
const [ToastStateContext, useToastState] = createStrictContext<ToastState>(
  "useToast",
  "a <ToastProvider>",
);

function createToastStateBridge(
  useAdapterToast: ToastParts["useToast"],
): React.FC<{ children: React.ReactNode }> {
  function AdapterToastStateBridge(
    { children }: { children: React.ReactNode },
  ): React.ReactElement {
    const state = useAdapterToast();
    const value = React.useMemo<ToastState>(
      () => ({ toast: state.toast, dismiss: state.dismiss }),
      [state.dismiss, state.toast],
    );
    return <ToastStateContext.Provider value={value}>{children}</ToastStateContext.Provider>;
  }
  AdapterToastStateBridge.displayName = "AdapterToastStateBridge";
  return AdapterToastStateBridge;
}

/**
 * Holds the toast queue (via the active adapter: builtin by default) and mounts
 * the viewport. Wrap the part of the app that needs notifications.
 */
export function ToastProvider(
  { children, duration, maxToasts, viewport }: ToastProviderProps,
): React.ReactElement {
  if (duration !== undefined) assertToastDuration(duration, "ToastProvider duration");
  if (
    maxToasts !== undefined &&
    (!Number.isSafeInteger(maxToasts) || maxToasts < 1 || maxToasts > MAX_TOASTS)
  ) {
    throw new RangeError(
      `ToastProvider maxToasts must be an integer between 1 and ${MAX_TOASTS}`,
    );
  }
  const { toast } = useAdapter();
  // Keep adapter-owned hooks behind a component boundary. If a provider swaps
  // adapters at runtime, a new bridge type remounts instead of changing the
  // hook sequence inside the public `useToast` hook.
  const ToastStateBridge = React.useMemo(
    () => createToastStateBridge(toast.useToast),
    [toast.useToast],
  );
  return (
    <toast.Provider duration={duration} maxToasts={maxToasts} viewport={viewport}>
      <ToastStateBridge>{children}</ToastStateBridge>
    </toast.Provider>
  );
}
ToastProvider.displayName = "ToastProvider";

/** Render the active adapter's viewport for `<ToastProvider viewport="manual">`. */
export function ToastViewport(props: ToastViewportProps): React.ReactElement {
  const { toast } = useAdapter();
  return <toast.Viewport {...props} />;
}
ToastViewport.displayName = "ToastViewport";

/**
 * Returns `{ toast, dismiss }`. Call `toast(options)` to enqueue (returns the new
 * id), `toast.custom((id) => node)` for a fully custom toast, and `dismiss(id)` to
 * remove one early. Must be used within a `ToastProvider`.
 */
export function useToast(): ToastState {
  const state = useToastState();
  const enqueue = state.toast;
  const guardedToast = React.useMemo<ToastFn>(() => {
    const fn = ((options: ToastOptions) => {
      if (options.duration !== undefined) assertToastDuration(options.duration, "toast duration");
      return enqueue(options);
    }) as ToastFn;
    fn.custom = enqueue.custom;
    return fn;
  }, [enqueue]);
  return React.useMemo(
    () => ({ toast: guardedToast, dismiss: state.dismiss }),
    [guardedToast, state.dismiss],
  );
}
