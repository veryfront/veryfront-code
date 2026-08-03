/**
 * ChatMessagesSkeleton — loading placeholder for a chat thread that is still
 * fetching its history. Ported 1:1 from Studio's `ChatMessagesSkeleton`:
 * alternating user (right-aligned bubble) and assistant (avatar + name + text
 * lines) skeleton rows, at the same `max-w-[850px]` column as the real list.
 * Wrapped in an `aria-busy` `<output>` for assistive tech.
 *
 * @module react/components/chat/components/chat-messages-skeleton
 */
import * as React from "react";
import { cn } from "../../theme.ts";
import { Skeleton } from "../../../ui/skeleton.tsx";

/** An assistant skeleton row: avatar + name, then a few text lines. */
function AssistantSkeletonRow(
  { lines }: { lines: string[] },
): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {
          /* `!` overrides the Skeleton primitive's base `w-full h-4` (cn does not
            tailwind-merge). */
        }
        <Skeleton className="size-8! rounded-full! bg-[var(--edge)]!" />
        <Skeleton className="h-3! w-28! bg-[var(--edge)]!" />
      </div>
      <div className="flex flex-col gap-2">
        {lines.map((w, i) => <Skeleton key={i} className={cn("h-3!", w)} />)}
      </div>
    </div>
  );
}

/** Props accepted by `<ChatMessagesSkeleton>`. */
export interface ChatMessagesSkeletonProps {
  className?: string;
}

/** Render the loading skeleton for a chat thread. */
export function ChatMessagesSkeleton(
  { className }: ChatMessagesSkeletonProps,
): React.ReactElement {
  return (
    <output
      aria-busy="true"
      className={cn("flex-1 min-h-0 overflow-hidden", className)}
    >
      {
        /* Same column box as the real message list (`max-w-[850px] mx-auto px-9`)
          so the skeleton lines up with the messages it's standing in for. */
      }
      <div className="py-6 w-full max-w-[850px] mx-auto px-9 flex flex-col gap-5">
        <Skeleton className="h-8! w-48! self-end rounded-lg! rounded-br-sm! bg-[var(--tint)]!" />
        <AssistantSkeletonRow lines={["w-full!", "w-5/6!", "w-3/4!"]} />
        <Skeleton className="h-8! w-36! self-end rounded-lg! rounded-br-sm! bg-[var(--tint)]!" />
        <AssistantSkeletonRow lines={["w-full!", "w-4/6!"]} />
      </div>
      <span className="sr-only">Loading messages...</span>
    </output>
  );
}
ChatMessagesSkeleton.displayName = "ChatMessagesSkeleton";
