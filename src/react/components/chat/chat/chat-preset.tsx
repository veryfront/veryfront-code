/**
 * The `Chat` preset — the batteries-included compound (`Chat` + `Chat.Root` /
 * `Chat.MessageList` / …). Extracted from the chat barrel (`./index.ts`) so that
 * barrel stays under its size ratchet; `index.ts` re-exports `Chat` from here, so
 * the public surface is unchanged.
 *
 * @module react/components/chat/chat/chat-preset
 */
import * as React from "react";

import type { ChatComponent } from "./chat-component.ts";
import type { ChatProps } from "./chat-props.ts";
import { ControlledChat } from "./controlled-chat.tsx";
import { ConversationBoundChat } from "./app-mode-chat.tsx";
import { ChatRoot } from "./composition/chat-root.tsx";
import { ChatInput } from "./composition/chat-composer.tsx";
import { ChatMessageList } from "./composition/chat-message-list.tsx";
import { ChatEmpty } from "./composition/chat-empty.tsx";
import { ChatIf } from "./composition/chat-if.tsx";
import { ErrorBanner } from "./composition/error-banner.tsx";
import { Message } from "./composition/message.tsx";
import { ChatMessagesSkeleton } from "./components/chat-messages-skeleton.tsx";

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

// Chat — Compound API via Object.assign. The default export IS the compound, so
// `Chat.Root` / `Chat.Empty` / `Chat.Skeleton` / … are all typed off the same
// import.

/** Render chat components. */
export const Chat: ChatComponent = Object.assign(ChatBase, {
  Root: ChatRoot,
  MessageList: ChatMessageList,
  Input: ChatInput,
  Empty: ChatEmpty,
  Skeleton: ChatMessagesSkeleton,
  If: ChatIf,
  Message: Message,
  ErrorBanner: ErrorBanner,
});
