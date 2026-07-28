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
import {
  type Conversation,
  type ConversationStore,
  type ConversationStoreError,
  toConversationStoreError,
} from "../persistence/conversation-store.ts";
import { localConversationStore } from "../persistence/local-conversation-store.ts";
import { useConversationsContextOptional } from "../contexts/conversations-context.tsx";
import { reportUnhandledError } from "./report-unhandled-error.ts";

const useIsomorphicLayoutEffect = typeof document === "undefined"
  ? React.useEffect
  : React.useLayoutEffect;

/** Options for {@link useConversation}. */
export interface UseConversationOptions {
  /** Async persistence adapter. Default: `localConversationStore(storageKey)`.
   *  Ignored when a surrounding `ConversationsProvider` already holds the id. */
  store?: ConversationStore;
  /** Convenience storage key for the default localStorage adapter. */
  storageKey?: string;
  /** Called when loading the conversation fails. */
  onError?: (error: ConversationStoreError) => void;
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

/**
 * Additive persistence state returned by {@link useConversation}. It is kept
 * separate from the original result interface so existing structural fixtures
 * remain source-compatible.
 */
export interface UseConversationPersistenceState {
  /** Most recent load failure, or `null`. */
  error: ConversationStoreError | null;
  /** Clear the reported load failure. */
  clearError: () => void;
}

interface ConversationHookScope {
  active: boolean;
}

/** Load one full conversation by id, over a swappable async store. */
export function useConversation(
  id: string | null | undefined,
  options: UseConversationOptions = {},
): UseConversationResult & UseConversationPersistenceState {
  const { storageKey } = options;
  // Inside a provider, reuse its already-loaded active conversation when it
  // matches — avoids a redundant round-trip and stays in sync with edits.
  const context = useConversationsContextOptional();
  const fromContext = context?.activeConversation && context.activeConversation.id === id
    ? context.activeConversation
    : null;
  const contextOwnsId = id != null && context?.activeConversationId === id;
  const contextIsLoading = contextOwnsId &&
    (context.isActiveConversationLoading ?? context.isLoading);
  const contextLoadFailure = contextOwnsId && context.activeConversationError?.id === id
    ? context.activeConversationError
    : null;

  const store = React.useMemo(
    () => options.store ?? localConversationStore(storageKey),
    [options.store, storageKey],
  );

  const [conversation, setConversation] = React.useState<Conversation | null>(fromContext);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<ConversationStoreError | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const requestGenerationRef = React.useRef(0);
  const scope = React.useMemo<ConversationHookScope>(() => ({ active: false }), [store]);
  const activeScopeRef = React.useRef<ConversationHookScope | null>(null);
  const onErrorRef = React.useRef(options.onError);
  useIsomorphicLayoutEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);
  useIsomorphicLayoutEffect(() => {
    scope.active = true;
    activeScopeRef.current = scope;
    return () => {
      scope.active = false;
      if (activeScopeRef.current === scope) activeScopeRef.current = null;
    };
  }, [scope]);

  const isCurrentScope = React.useCallback(
    () => scope.active && activeScopeRef.current === scope,
    [scope],
  );
  const reload = React.useCallback(() => {
    if (!isCurrentScope()) return;
    if (contextOwnsId) {
      context?.reloadActiveConversation?.();
      return;
    }
    setReloadToken((token) => token + 1);
  }, [context, contextOwnsId, isCurrentScope]);
  const clearError = React.useCallback(() => {
    if (!isCurrentScope()) return;
    setError(null);
    if (contextOwnsId) {
      (context?.clearActiveConversationError ?? context?.clearError)?.();
    }
  }, [context, contextOwnsId, isCurrentScope]);

  const reportedContextFailureRef = React.useRef<typeof contextLoadFailure>(null);
  React.useEffect(() => {
    if (!contextLoadFailure) {
      reportedContextFailureRef.current = null;
      return;
    }
    if (reportedContextFailureRef.current === contextLoadFailure) return;
    reportedContextFailureRef.current = contextLoadFailure;
    try {
      onErrorRef.current?.(contextLoadFailure.error);
    } catch (callbackCause) {
      reportUnhandledError(callbackCause);
    }
  }, [contextLoadFailure]);

  React.useEffect(() => {
    const generation = ++requestGenerationRef.current;
    setError(null);
    if (!id) {
      setConversation(null);
      setIsLoading(false);
      return;
    }
    // The provider owns its active id even before the full record arrives. Never
    // fall through to an unrelated default/local store while that load is pending.
    if (contextOwnsId) {
      setConversation(fromContext);
      setIsLoading(fromContext === null && contextIsLoading);
      return;
    }

    let cancelled = false;
    setConversation(null);
    setIsLoading(true);
    void Promise.resolve()
      .then(() => store.load(id))
      .then(
        (loaded) => {
          if (
            cancelled ||
            !isCurrentScope() ||
            requestGenerationRef.current !== generation
          ) return;
          setConversation(loaded);
          setIsLoading(false);
        },
        (cause) => {
          if (
            cancelled ||
            !isCurrentScope() ||
            requestGenerationRef.current !== generation
          ) return;
          const nextError = toConversationStoreError("load", cause);
          setError(nextError);
          setIsLoading(false);
          try {
            onErrorRef.current?.(nextError);
          } catch (callbackCause) {
            reportUnhandledError(callbackCause);
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [id, store, fromContext, contextOwnsId, contextIsLoading, reloadToken, isCurrentScope]);

  return {
    conversation,
    isLoading,
    error: contextOwnsId ? (contextLoadFailure?.error ?? null) : error,
    clearError,
    reload,
  };
}
