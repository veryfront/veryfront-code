// Consumer fixture — documented `veryfront/chat` composition.
//
// Never executed. It exists so the consumer `tsc --noEmit` gate
// (scripts/typecheck/tsconfig.consumer.json) proves the public chat
// surface — batteries `<Chat>` AND the `<Chat.Root>` compound — composes under
// React-19 `@types/react` the way an external app imports it (via the built
// npm `.d.ts`, exactly what npm consumers get). This is the check `deno check`
// cannot perform.
import * as React from "react";
import {
  Chat,
  ChatSidebar,
  Message,
  Suggestion,
  Suggestions,
} from "veryfront/chat";
import type { ChatMessage } from "veryfront/chat";

const messages: ChatMessage[] = [];

/** Batteries — the default explicit variant, zero-config. */
export function BatteriesDemo(): React.ReactElement {
  return <Chat messages={messages} />;
}

/** Compound — arrange the blocks yourself; each leaf individually addressable. */
export function ComposedDemo(): React.ReactElement {
  return (
    <Chat.Root messages={messages}>
      <Chat.Empty title="Ask anything">
        <Suggestions>
          <Suggestion suggestion="Summarize this page" />
        </Suggestions>
      </Chat.Empty>
      <Chat.MessageList messages={messages} />
      <Chat.Input placeholder="Ask Veryfront" />
    </Chat.Root>
  );
}

/** A standalone message leaf renders off a single ChatMessage. */
export function MessageDemo({ message }: { message: ChatMessage }): React.ReactElement {
  return <Message message={message} />;
}

/** Sidebar compound. */
export function SidebarDemo(): React.ReactElement {
  return <ChatSidebar conversations={[]} />;
}
