/**
 * Internal form boundary for the default ChatInput layout.
 *
 * @module react/components/chat/chat/composition/chat-input-form
 */

import * as React from "react";
import type { ChatInputContextValue } from "../contexts/composer-context.tsx";

interface ChatInputFormProps {
  children: React.ReactNode;
  onSubmit: ChatInputContextValue["onSubmit"];
}

/** Prevent browser navigation before delegating a default composer submit. */
export function ChatInputForm(
  { children, onSubmit }: ChatInputFormProps,
): React.ReactElement {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(event);
      }}
    >
      {children}
    </form>
  );
}
