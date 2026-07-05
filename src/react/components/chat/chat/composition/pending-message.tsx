/**
 * PendingMessage — the "waiting for a response" placeholder shown while the
 * assistant turn hasn't started streaming yet.
 *
 * Rather than a floating avatar + bouncing dots, it mirrors the real assistant
 * `Message.Header` anatomy: a `size-8` skeleton circle where the avatar sits
 * (same size and position) and a skeleton bar where the agent name goes. When
 * the first token arrives the real `Message` takes over in the same slot, so
 * there's no layout jump.
 *
 * @module react/components/chat/composition/pending-message
 */

import * as React from "react";
import { cn } from "../../theme.ts";
import { Skeleton } from "../../ui/skeleton.tsx";

/** Props accepted by `<PendingMessage>`. */
export interface PendingMessageProps {
  className?: string;
}

/**
 * Render the pending assistant header — a skeleton avatar + name. Matches
 * `Message.Header`'s layout (`flex items-center gap-2 pt-px pb-1`) and the
 * `AgentAvatar`'s `mt-1 size-8` so the skeleton circle lands exactly where the
 * real avatar will.
 *
 * `!` overrides are required because the `Skeleton` primitive ships a base
 * `h-4 w-full rounded-md` and `cn` does not tailwind-merge.
 */
export function PendingMessage(
  { className }: PendingMessageProps,
): React.ReactElement {
  return (
    <output
      aria-busy="true"
      className={cn(
        "flex w-full items-center gap-2 pt-px pb-1",
        className,
      )}
    >
      <Skeleton className="mt-1 size-8! shrink-0 rounded-full! bg-[var(--edge)]!" />
      <Skeleton className="h-3.5! w-28! rounded-md! bg-[var(--edge)]!" />
      <span className="sr-only">Waiting for a response...</span>
    </output>
  );
}
PendingMessage.displayName = "PendingMessage";
