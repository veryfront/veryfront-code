/**
 * ConversationsContext — the shared {@link useConversations} instance for a
 * multi-conversation app. Put {@link ConversationsProvider} in your layout so
 * the sidebar, the chat page, and `<Chat>` all read one source of truth; never
 * call `useConversations()` again below it (a second call is a second,
 * disconnected store).
 *
 * @module react/components/chat/contexts/conversations-context
 */

import * as React from "react";
import { createStrictContext } from "../../../create-strict-context.ts";
import {
  useConversations,
  type UseConversationsOptions,
  type UseConversationsResult,
} from "../hooks/use-conversations.ts";

const [ConversationsContext, useConversationsContext] = createStrictContext<UseConversationsResult>(
  "useConversationsContext",
  "a ConversationsProvider",
);

/** Read the shared conversations state, or `null` when there is no provider. */
export function useConversationsContextOptional(): UseConversationsResult | null {
  return React.useContext(ConversationsContext);
}

export { useConversationsContext };

/** Low-level context provider (value supplied by the caller). */
export const ConversationsContextProvider = ConversationsContext.Provider;

/** Props accepted by {@link ConversationsProvider}. */
export interface ConversationsProviderProps extends UseConversationsOptions {
  children: React.ReactNode;
}

/**
 * ConversationsProvider — calls {@link useConversations} once with your
 * `store` / `id` / `onSelect` and shares it via {@link ConversationsContext}.
 * Declare persistence + router wiring here, once, at the app layout; children
 * read it with {@link useConversationsContext}.
 */
export function ConversationsProvider(
  { children, ...options }: ConversationsProviderProps,
): React.ReactElement {
  const conversations = useConversations(options);
  return (
    <ConversationsContextProvider value={conversations}>
      {children}
    </ConversationsContextProvider>
  );
}
