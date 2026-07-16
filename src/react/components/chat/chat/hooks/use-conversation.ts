/**
 * useConversation — load a single full {@link Conversation} (with messages) by
 * id, over the same swappable {@link ConversationStore} as {@link useConversations}.
 * The singular companion to the list hook: use it to preview or open one
 * conversation without mounting the whole list.
 *
 * Inside a {@link ConversationsProvider} it short-circuits when the requested id
 * is already the active conversation (no redundant load); otherwise it fetches
 * from the store. Pass your own `store` to point it anywhere, or omit it to use
 * the default localStorage adapter.
 *
 * @module react/components/chat/hooks/use-conversation
 */
import * as React from "react";
import type { Conversation, ConversationStore } from "../persistence/conversation-store.ts";
import { localConversationStore } from "../persistence/local-conversation-store.ts";
import { useConversationsContextOptional } from "../contexts/conversations-context.tsx";

/** Options for {@link useConversation}. */
export interface UseConversationOptions {
  /** Async persistence adapter. Default: `localConversationStore(storageKey)`.
   *  Ignored when a surrounding `ConversationsProvider` already holds the id. */
  store?: ConversationStore;
  /** Convenience storage key for the default localStorage adapter. */
  storageKey?: string;
}

/** Result of {@link useConversation}. */
export interface UseConversationResult {
  /** The full conversation (with messages), or `null` while loading / not found. */
  conversation: Conversation | null;
  /** True while the conversation is loading from the store. */
  isLoading: boolean;
  /** Re-fetch from the store. */
  reload: () => void;
}

/** Load one full conversation by id, over a swappable async store. */
export function useConversation(
  id: string | null | undefined,
  options: UseConversationOptions = {},
): UseConversationResult {
  const { storageKey } = options;
  // Inside a provider, reuse its already-loaded active conversation when it
  // matches — avoids a redundant round-trip and stays in sync with edits.
  const context = useConversationsContextOptional();
  const fromContext = context?.activeConversation && context.activeConversation.id === id
    ? context.activeConversation
    : null;

  const store = React.useMemo(
    () => options.store ?? localConversationStore(storageKey),
    [options.store, storageKey],
  );

  const [conversation, setConversation] = React.useState<Conversation | null>(fromContext);
  const [isLoading, setIsLoading] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);

  const reload = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    if (!id) {
      setConversation(null);
      setIsLoading(false);
      return;
    }
    // The provider already has this conversation — mirror it, no fetch.
    if (fromContext) {
      setConversation(fromContext);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    void store.load(id).then((loaded) => {
      if (cancelled) return;
      setConversation(loaded);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id, store, fromContext, reloadToken]);

  return { conversation, isLoading, reload };
}
