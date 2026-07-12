import type * as React from "react";

import type { ChatProps } from "./chat-props.ts";
import type { ChatMessagesSkeleton } from "./components/chat-messages-skeleton.tsx";
import type { ChatEmpty } from "./composition/chat-empty.tsx";
import type { ChatIf } from "./composition/chat-if.tsx";
import type { ChatInput } from "./composition/chat-composer.tsx";
import type { ErrorBanner } from "./composition/error-banner.tsx";
import type { ChatMessageList } from "./composition/chat-message-list.tsx";
import type { ChatRoot } from "./composition/chat-root.tsx";
import type { Message } from "./composition/message.tsx";

export type ChatComponent = ((props: ChatProps) => React.ReactElement) & {
  Root: typeof ChatRoot;
  MessageList: typeof ChatMessageList;
  Input: typeof ChatInput;
  Empty: typeof ChatEmpty;
  Skeleton: typeof ChatMessagesSkeleton;
  If: typeof ChatIf;
  Message: typeof Message;
  ErrorBanner: typeof ErrorBanner;
};
