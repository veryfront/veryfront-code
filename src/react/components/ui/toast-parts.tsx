/**
 * Toast presentational parts: the pure-visual surface + types, with NO queue and
 * NO adapter dependency. The queue/imperative engine lives in an adapter
 * (`adapter/builtin/toast.tsx` by default), which composes these parts; the
 * `toast.tsx` skin re-exports them. Keeping them here (importing only React +
 * cva) is what lets Toast be adapter-routed without an import cycle.
 *
 * @module react/components/ui/toast-parts
 */
import * as React from "react";
import { cva, cx as cn, type VariantProps } from "./cva.ts";
import { composeRefs } from "./slot.tsx";

/** Largest delay accepted by browser and server JavaScript timer hosts. */
export const MAX_TOAST_DURATION_MS = 2_147_483_647;

/** Enforce the timer-domain duration shared by public and adapter-owned toast lifecycle APIs. */
export function assertToastDuration(value: number, label: string): void {
  if (
    value !== Infinity &&
    (!Number.isFinite(value) || value < 0 || value > MAX_TOAST_DURATION_MS)
  ) {
    throw new RangeError(
      `${label} must be between 0 and ${MAX_TOAST_DURATION_MS}, or Infinity`,
    );
  }
}

export const toastVariants = cva(
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

/** A toast button: a label plus what to do when it's pressed. */
export interface ToastAction {
  /** Button text. */
  label: React.ReactNode;
  /** Runs when the button is pressed (the toast is dismissed afterwards). */
  onClick: () => void;
}

/** Options accepted by `toast(...)` when enqueuing a notification. */
export interface ToastOptions {
  /** Heading line. */
  title?: React.ReactNode;
  /** Secondary supporting line shown under the title. */
  description?: React.ReactNode;
  /** Leading icon shown before the text (any node: an SVG, emoji, etc.). */
  icon?: React.ReactNode;
  /** Primary action button; pressing it runs `onClick` then dismisses the toast. */
  action?: ToastAction;
  /** Secondary/cancel button; pressing it runs `onClick` (if given) then dismisses. */
  cancel?: { label: React.ReactNode; onClick?: () => void };
  /** Colour scheme. @default "default" */
  variant?: ToastVariant;
  /** Milliseconds before auto-dismiss; pass `Infinity` to persist. Overrides the provider default. */
  duration?: number;
}

/** Imperative enqueue function: call `toast(options)`, or `toast.custom(render)`. */
export interface ToastFn {
  /** Enqueue a structured toast; returns its id (for `dismiss`). */
  (options: ToastOptions): string;
  /** Enqueue a fully custom node: you own the markup, the provider owns the lifecycle (queue + auto-dismiss). */
  custom: (render: (id: string) => React.ReactNode) => string;
}

/** Arm a pausable auto-dismiss timer. Infinity and zero disable it. */
export function useAutoDismiss(
  duration: number | undefined,
  onClose?: () => void,
  options: { paused?: boolean; ownerDocument?: Document } = {},
): void {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const [documentHidden, setDocumentHidden] = React.useState(
    () => options.ownerDocument?.visibilityState === "hidden",
  );
  const remainingRef = React.useRef(duration ?? 0);

  React.useEffect(() => {
    const document = options.ownerDocument;
    if (!document) return;
    const update = () => setDocumentHidden(document.visibilityState === "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [options.ownerDocument]);

  React.useEffect(() => {
    remainingRef.current = duration ?? 0;
  }, [duration]);

  React.useEffect(() => {
    if (duration == null || duration === Infinity || duration === 0) return;
    assertToastDuration(duration, "Toast duration");
    if (options.paused || documentHidden) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => onCloseRef.current?.(), remainingRef.current);
    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [duration, options.paused, documentHidden]);
}

/** Props accepted by `<Toast>`. */
export interface ToastProps
  extends Omit<React.LiHTMLAttributes<HTMLLIElement>, "title">, VariantProps<typeof toastVariants> {
  /** Milliseconds before the toast auto-closes; `Infinity`/`0` disables the timer. @default 5000 */
  duration?: number;
  /** Invoked when the auto-dismiss timer fires. */
  onClose?: () => void;
  /** React 19: ref is a regular prop. */
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
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: ToastProps): React.ReactElement {
  const [node, setNode] = React.useState<HTMLLIElement | null>(null);
  const [hovered, setHovered] = React.useState(false);
  const [focusWithin, setFocusWithin] = React.useState(false);
  const composedRef = React.useMemo(() => composeRefs<HTMLLIElement>(setNode, ref), [ref]);
  useAutoDismiss(duration, onClose, {
    paused: hovered || focusWithin,
    ownerDocument: node?.ownerDocument,
  });

  return (
    <li
      ref={composedRef}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-variant={variant ?? "default"}
      className={cn(toastVariants({ variant }), className)}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        setHovered(true);
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        setHovered(false);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        setFocusWithin(true);
      }}
      onBlur={(event) => {
        onBlur?.(event);
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusWithin(false);
      }}
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
  "aria-label": ariaLabel = "Dismiss notification",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: React.Ref<HTMLButtonElement>;
}): React.ReactElement {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      className={cn(
        "absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]",
        className,
      )}
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
