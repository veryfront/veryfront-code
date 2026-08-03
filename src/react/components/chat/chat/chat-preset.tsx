/**
 * Batteries-included Chat preset and its compound component surface.
 *
 * @module react/components/chat/chat/chat-preset
 */
import * as React from "react";

import type { ChatComponent } from "./chat-component.ts";
import type { ChatProps } from "./chat-props.ts";
import { ControlledChat } from "./controlled-chat.tsx";
import { ConversationBoundChat } from "./app-mode-chat.tsx";
import { ChatMessagesSkeleton } from "./components/chat-messages-skeleton.tsx";
import { ChatEmpty } from "./composition/chat-empty.tsx";
import { ErrorBanner } from "./composition/error-banner.tsx";
import { ChatIf } from "./composition/chat-if.tsx";
import { ChatInput } from "./composition/chat-composer.tsx";
import { ChatMessageList } from "./composition/chat-message-list.tsx";
import { ChatRoot } from "./composition/chat-root.tsx";
import { Message } from "./composition/message.tsx";

/**
 * Chat — batteries-included chat surface.
 *
 * - **App mode (uncontrolled):** omit `chat` and pass `agentId` + `api`;
 *   `<Chat>` wires `useChat` + `useAgentMetadata` internally. Inside a
 *   `ConversationsProvider` it also binds to the active conversation.
 * - **Controlled mode:** pass `chat={useChat()}`.
 */
function ChatBase(props: ChatProps): React.ReactElement {
  return props.chat !== undefined
    ? <ControlledChat {...props} chat={props.chat} />
    : <ConversationBoundChat ref={props.ref} {...props} />;
}
ChatBase.displayName = "Chat";

/** Render chat components through the preset or its composable sub-parts. */
export const Chat: ChatComponent = Object.assign(ChatBase, {
  Root: ChatRoot,
  MessageList: ChatMessageList,
  Input: ChatInput,
  Empty: ChatEmpty,
  Skeleton: ChatMessagesSkeleton,
  If: ChatIf,
  Message,
  ErrorBanner,
});
