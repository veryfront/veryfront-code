/**
 * Header compound for assistant chat messages.
 *
 * Kept separate from the main message composition module so identity and
 * timestamp presentation can evolve without growing the message coordinator.
 *
 * @module react/components/chat/chat/composition/message-header
 */
import * as React from "react";
import type { ChatMessage } from "#veryfront/agent/react";
import { cn } from "../../theme.ts";
import { useChatContextOptional } from "../contexts/chat-context.tsx";
import { useMessageContext } from "../contexts/message-context.tsx";
import { AgentAvatar } from "./agent-avatar.tsx";

function metadataString(
  metadata: ChatMessage["metadata"] | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

interface MessageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Compose the header's inner row yourself; omit for the default anatomy. */
  children?: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

function formatTimestamp(createdAt: ChatMessage["createdAt"]): string {
  if (!createdAt) return "";
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Props for `Message.Header.Name`. */
export interface MessageHeaderNameProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Override the default agent/author label. */
  children?: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLSpanElement>;
}

/** Agent or author name displayed in an assistant message header. */
export function MessageHeaderName(
  { className, children, ref, ...props }: MessageHeaderNameProps,
): React.ReactElement {
  const { message } = useMessageContext();
  const chat = useChatContextOptional();
  const agentName = metadataString(message.metadata, "agentName") ??
    chat?.agent?.name ??
    metadataString(message.metadata, "agentId");
  return (
    <span {...props} ref={ref} className={cn("min-w-0 truncate font-medium", className)}>
      {children ?? agentName ?? "Assistant"}
    </span>
  );
}
MessageHeaderName.displayName = "Message.Header.Name";

/** Props for `Message.Header.Timestamp`. */
export interface MessageHeaderTimestampProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLSpanElement>;
}

/** Right-aligned timestamp displayed when the message has a valid creation time. */
export function MessageHeaderTimestamp(
  { className, ref, ...props }: MessageHeaderTimestampProps,
): React.ReactElement | null {
  const { message } = useMessageContext();
  const timestamp = formatTimestamp(message.createdAt);
  if (!timestamp) return null;
  return (
    <span
      {...props}
      ref={ref}
      className={cn("ml-auto text-sm text-[var(--faint)]", className)}
      suppressHydrationWarning
    >
      {timestamp}
    </span>
  );
}
MessageHeaderTimestamp.displayName = "Message.Header.Timestamp";

/** Assistant-only message header with addressable name and timestamp leaves. */
export function MessageHeader(
  { className, children, ref, ...props }: MessageHeaderProps,
): React.ReactElement | null {
  const { message, role } = useMessageContext();
  const chat = useChatContextOptional();
  if (role === "user") return null;

  const agentName = metadataString(message.metadata, "agentName") ??
    chat?.agent?.name ??
    metadataString(message.metadata, "agentId");
  const avatarUrl = metadataString(message.metadata, "agentAvatarUrl") ??
    chat?.agent?.avatarUrl ?? undefined;

  return (
    <div
      {...props}
      ref={ref}
      className={cn("flex w-full items-center gap-2 pt-px pb-3", className)}
    >
      {children ?? (
        <>
          <AgentAvatar
            name={agentName}
            avatarUrl={avatarUrl}
            model={metadataString(message.metadata, "model")}
            className="size-8"
          />
          <MessageHeaderName />
          <MessageHeaderTimestamp />
        </>
      )}
    </div>
  );
}
MessageHeader.displayName = "Message.Header";

/** `Message.Header` compound containing the header row and its addressable leaves. */
export const MessageHeaderCompound = Object.assign(MessageHeader, {
  Name: MessageHeaderName,
  Timestamp: MessageHeaderTimestamp,
});
