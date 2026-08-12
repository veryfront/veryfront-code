import * as React from "react";
import { cn } from "../../theme.ts";
import { ChatMarkdown } from "../../chat-markdown.tsx";
import { ChevronDownIcon } from "../../../ui/icons/index.ts";
import { createStrictContext } from "../../../create-strict-context.ts";
import { Shimmer } from "./animations.tsx";

// ---------------------------------------------------------------------------
// Reasoning — compound, render-or-compose (mirrors `Message` / `ToolCall`).
//
// `<Reasoning text={...} />` renders the default disclosure (trigger + body).
// Pass children to recompose from `Reasoning.Trigger` + `Reasoning.Content`,
// each reading `useReasoning()`. `Content` takes children to replace the
// rendered markdown; every part takes `className`.
// ---------------------------------------------------------------------------

/** Per-card state shared with `Reasoning.*` sub-parts. */
export interface ReasoningContextValue {
  /** The reasoning markdown text to render in the body. */
  text: string;
  /** Whether tokens are still streaming; drives the shimmer label + auto-open. */
  isStreaming: boolean;
  /** Whether the disclosure is currently expanded. */
  isOpen: boolean;
  /** Toggle the disclosure open/closed (opts out of stream-driven auto-collapse). */
  toggle: () => void;
}

const [ReasoningContext, useReasoningContext] = createStrictContext<ReasoningContextValue>(
  "useReasoning",
  "a Reasoning",
);

/**
 * Read the disclosure state provided by `Reasoning.Root` (text + open state).
 * Use it to build a custom disclosure part; throws outside a `Reasoning`.
 *
 * @example
 * ```tsx
 * function MyTrigger() {
 *   const { isOpen, toggle } = useReasoning();
 *   return <button onClick={toggle}>{isOpen ? "Hide" : "Show"} reasoning</button>;
 * }
 * // <Reasoning.Root text={text}><MyTrigger /><Reasoning.Content /></Reasoning.Root>
 * ```
 */
export const useReasoning = useReasoningContext;

/** Props accepted by `Reasoning` / `Reasoning.Root`. */
export interface ReasoningProps {
  /** The reasoning markdown text rendered in the disclosure body. */
  text: string;
  /** Whether tokens are still streaming; shimmers the label and auto-opens the card. */
  isStreaming?: boolean;
  className?: string;
  /** Overrides the chevron glyph. Rotation-on-open styling is applied to the
   *  wrapper, so a custom icon does not need to know about open state. */
  icon?: React.ReactNode;
  /** Override the two labels; each defaults to the current string. */
  labels?: { thinking?: string; thought?: string };
  /** Controlled open state. When provided, the component is controlled and the
   *  auto open/collapse behaviour is disabled (the parent owns the state). */
  open?: boolean;
  /** Initial open value when uncontrolled. Defaults to whether the card is
   *  streaming at mount — so a completed / reloaded reasoning starts collapsed
   *  and never animates, while a live one opens as tokens arrive. */
  defaultOpen?: boolean;
  /** Called whenever the open state should change (both controlled and not). */
  onOpenChange?: (open: boolean) => void;
  /** Compose your own disclosure; when omitted, the default anatomy renders. */
  children?: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * `Reasoning.Root` — context provider + wrapper. No children renders the
 * default anatomy (`Trigger` + `Content`); pass children to recompose.
 */
function ReasoningRoot(
  {
    text,
    isStreaming = false,
    className,
    icon,
    labels,
    open,
    defaultOpen,
    onOpenChange,
    children,
    ref,
  }: ReasoningProps,
): React.ReactElement {
  const isControlled = open !== undefined;
  // Uncontrolled default: open only if we mount mid-stream. A completed /
  // reloaded card (isStreaming === false) starts collapsed, so it never
  // plays the open-then-collapse animation.
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    defaultOpen ?? isStreaming,
  );
  const isOpen = isControlled ? open : uncontrolledOpen;
  const userToggledRef = React.useRef(false);
  // Tracks whether this card has ever streamed during its lifetime. We only
  // auto-collapse once streaming actually ends — a card that was never
  // streaming (history reload) has nothing to animate away from.
  const hasStreamedRef = React.useRef(isStreaming);

  React.useEffect(() => {
    // Parent owns state when controlled, and a manual toggle opts out of the
    // stream-driven open/collapse entirely.
    if (isControlled || userToggledRef.current) return;

    if (isStreaming) {
      hasStreamedRef.current = true;
      if (!isOpen) {
        setUncontrolledOpen(true);
        onOpenChange?.(true);
      }
      return;
    }

    // Streaming just finished in this session — collapse after a beat. If we
    // never streamed (reloaded chat), leave the card exactly as it mounted.
    if (!hasStreamedRef.current || !isOpen) return;

    const timer = setTimeout(() => {
      setUncontrolledOpen(false);
      onOpenChange?.(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, [isControlled, isStreaming, isOpen, onOpenChange]);

  const toggle = React.useCallback(() => {
    userToggledRef.current = true;
    const next = !isOpen;
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }, [isControlled, isOpen, onOpenChange]);

  const context: ReasoningContextValue = { text, isStreaming, isOpen, toggle };

  return (
    <ReasoningContext.Provider value={context}>
      <div ref={ref} className={cn("not-prose", className)}>
        {children ?? (
          <>
            <ReasoningTrigger icon={icon} labels={labels} />
            <ReasoningContent />
          </>
        )}
      </div>
    </ReasoningContext.Provider>
  );
}
ReasoningRoot.displayName = "Reasoning.Root";

/** Props for `Reasoning.Trigger` — the disclosure button. */
export interface ReasoningTriggerProps {
  /** Replace the default glyph. The canonical path (RFC 2980: a leaf renders its
   * default icon when childless; pass children to replace it). */
  children?: React.ReactNode;
  /** @deprecated Pass `children` instead. Kept working for backward compatibility. */
  icon?: React.ReactNode;
  /** Override the two labels; each defaults to the current string. */
  labels?: { thinking?: string; thought?: string };
  className?: string;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** The header row: a "Thinking…" / "Thought process" label + expand chevron. */
function ReasoningTrigger(
  { children, icon, labels, className, ref }: ReasoningTriggerProps,
): React.JSX.Element {
  const { isStreaming, isOpen, toggle } = useReasoning();
  const thinkingLabel = labels?.thinking ?? "Thinking...";
  const thoughtLabel = labels?.thought ?? "Thought process";
  const label = isStreaming ? <Shimmer>{thinkingLabel}</Shimmer> : <span>{thoughtLabel}</span>;

  return (
    <button
      ref={ref}
      type="button"
      onClick={toggle}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm text-sm text-[var(--foreground)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-0",
        className,
      )}
    >
      {label}
      <span
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center transition-transform duration-200",
          !isOpen && "-rotate-90",
        )}
      >
        {children ?? icon ?? <ChevronDownIcon className="size-3.5 shrink-0" />}
      </span>
    </button>
  );
}
ReasoningTrigger.displayName = "Reasoning.Trigger";

/** The reasoning body. Renders when open; pass children to replace the markdown. */
function ReasoningContent(
  { className, children, ref, ...props }:
    & React.HTMLAttributes<HTMLDivElement>
    & { ref?: React.Ref<HTMLDivElement> },
): React.JSX.Element | null {
  const { text, isOpen } = useReasoning();
  if (!isOpen) return null;
  return (
    <div {...props} ref={ref} className={cn("mt-2 text-sm text-[var(--foreground)]", className)}>
      {children ?? (
        // `text-sm!` overrides Markdown's base `text-base` (cn does not tw-merge)
        // so reasoning renders at 14px like Studio's compact variant.
        <ChatMarkdown className="mb-0 space-y-2.5 text-sm!">{text}</ChatMarkdown>
      )}
    </div>
  );
}
ReasoningContent.displayName = "Reasoning.Content";

/**
 * Reasoning — render `<Reasoning text={…} />` for the default disclosure, or
 * compose `Reasoning.Trigger` + `Reasoning.Content` for a custom layout.
 * Mirrors the `Message` / `ToolCall` compounds: render it, or compose it.
 */
export const Reasoning = Object.assign(ReasoningRoot, {
  Root: ReasoningRoot,
  Trigger: ReasoningTrigger,
  Content: ReasoningContent,
});
