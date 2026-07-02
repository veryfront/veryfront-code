import * as React from "react";
import { cn } from "../../theme.ts";
import { Markdown } from "../../markdown.tsx";
import { ChevronDownIcon } from "../../icons/index.ts";
import { Shimmer } from "./animations.tsx";

type ReasoningCardProps = {
  text: string;
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
};

/** Render reasoning card. */
export const ReasoningCard = React.forwardRef<
  HTMLDivElement,
  ReasoningCardProps
>(
  function ReasoningCard(
    {
      text,
      isStreaming = false,
      className,
      icon,
      labels,
      open,
      defaultOpen,
      onOpenChange,
    },
    ref,
  ) {
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

    const thinkingLabel = labels?.thinking ?? "Thinking...";
    const thoughtLabel = labels?.thought ?? "Thought process";
    const label = isStreaming ? <Shimmer>{thinkingLabel}</Shimmer> : <span>{thoughtLabel}</span>;

    return (
      <div ref={ref} className={cn("not-prose mb-3", className)}>
        <button
          type="button"
          onClick={() => {
            userToggledRef.current = true;
            const next = !isOpen;
            if (!isControlled) setUncontrolledOpen(next);
            onOpenChange?.(next);
          }}
          className="flex w-full items-center gap-2 rounded-sm text-sm text-[var(--foreground)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-0"
        >
          {label}
          <span
            className={cn(
              "flex size-3.5 shrink-0 items-center justify-center transition-transform duration-200",
              !isOpen && "-rotate-90",
            )}
          >
            {icon ?? <ChevronDownIcon className="size-3.5 shrink-0" />}
          </span>
        </button>

        {isOpen
          ? (
            <div className="mt-2 text-sm text-[var(--foreground)]">
              {
                /* `text-sm!` overrides Markdown's base `text-base` (cn does not
                  tw-merge) so reasoning renders at 14px like Studio's compact
                  variant. */
              }
              <Markdown className="mb-0 space-y-2.5 text-sm!">{text}</Markdown>
            </div>
          )
          : null}
      </div>
    );
  },
);
ReasoningCard.displayName = "ReasoningCard";
