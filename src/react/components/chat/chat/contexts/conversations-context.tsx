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
  type UseConversationsActiveLoadState,
  type UseConversationsOptions,
  type UseConversationsPersistenceState,
  type UseConversationsResult,
} from "../hooks/use-conversations.ts";

/**
 * Value accepted by the low-level context provider. Persistence state and
 * `activeReady` are optional here so existing caller-supplied structural
 * fixtures remain compatible; {@link ConversationsProvider} always supplies
 * them.
 */
export type ConversationsContextValue =
  & UseConversationsResult
  & Partial<UseConversationsPersistenceState & UseConversationsActiveLoadState>
  & {
    /**
     * True once the full active record has resolved for the current
     * `activeConversationId` (`activeConversationId != null &&
     * activeConversation?.id === activeConversationId`) from the current
     * store; false while it is loading or mismatched, and false when there is
     * no active id.
     */
    activeReady?: boolean;
  };

const [ConversationsContext, useConversationsContext] = createStrictContext<
  ConversationsContextValue
>(
  "useConversationsContext",
  "a ConversationsProvider",
);

/** Read the shared conversations state, or `null` when there is no provider. */
export function useConversationsContextOptional(): ConversationsContextValue | null {
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
  const storeScope = options.store ?? options.storageKey ?? null;
  const committedStoreScope = React.useRef(storeScope);
  const storeScopeReady = Object.is(committedStoreScope.current, storeScope);
  React.useEffect(() => {
    committedStoreScope.current = storeScope;
  }, [storeScope]);
  const activeReady = storeScopeReady && conversations.activeConversationId != null &&
    conversations.activeConversation?.id === conversations.activeConversationId;
  const value = React.useMemo(
    () => ({ ...conversations, activeReady }),
    [conversations, activeReady],
  );
  return (
    <ConversationsContextProvider value={value}>
      {children}
    </ConversationsContextProvider>
  );
}
