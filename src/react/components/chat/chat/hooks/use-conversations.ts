/**
 * useConversations — the conversation list + active-thread hook, backed by a
 * swappable async {@link ConversationStore}. Owns what the havana example used
 * to hand-roll in userland: load/persist, auto-title, create/remove/select, and
 * per-message binding.
 *
 * The active id is **controlled** — pass `id` (from your router) + `onSelect`
 * and the hook stays router-agnostic; omit them and it manages active itself.
 * Persistence is async and pluggable; batching (debounced saves) lives here so
 * adapters stay dumb.
 *
 * @module react/components/chat/hooks/use-conversations
 */
import * as React from "react";
import type { ChatMessage } from "#veryfront/agent/react";
import {
  scopeCommitRequiresRenderPublication,
  useScopeCommitEffect,
} from "#veryfront/react/compat/scope-commit-effect.ts";
import { generateUuid } from "#veryfront/utils/id.ts";
import {
  type Conversation,
  type ConversationStore,
  ConversationStoreError,
  type ConversationStoreOperation,
  type ConversationSummary,
  toConversationStoreError,
} from "../persistence/conversation-store.ts";
import { localConversationStore } from "../persistence/local-conversation-store.ts";
import { reportUnhandledError } from "./report-unhandled-error.ts";

/** Default title for a fresh, untitled conversation. */
export const DEFAULT_CONVERSATION_TITLE = "New Chat";
const AUTOTITLE_MAX = 40;
const SAVE_DEBOUNCE_MS = 300;
const useIsomorphicLayoutEffect = typeof document === "undefined"
  ? React.useEffect
  : React.useLayoutEffect;

class ConversationHookScopeError extends Error {
  constructor() {
    super("This conversation command belongs to an inactive hook scope");
    this.name = "ConversationHookScopeError";
  }
}

class ConversationNotFoundError extends Error {
  constructor(id: string) {
    super(`Conversation "${id}" no longer exists in the store`);
    this.name = "ConversationNotFoundError";
  }
}

function invokeStore<T>(
  operation: ConversationStoreOperation,
  action: () => Promise<T>,
): Promise<T> {
  return Promise.resolve()
    .then(action)
    .catch((cause) => {
      throw toConversationStoreError(operation, cause);
    });
}

// ---------------------------------------------------------------------------
// Pure helpers — the state transitions, extracted so they're unit-testable
// without a React renderer (the hook is a thin wrapper over these).
// ---------------------------------------------------------------------------

function randomId(): string {
  return `c_${generateUuid()}`;
}

/** A fresh, empty conversation. `now`/`id` are injectable for tests. */
export function createEmptyConversation(
  opts: { agentId?: string; id?: string; now?: number } = {},
): Conversation {
  const now = opts.now ?? Date.now();
  return {
    id: opts.id ?? randomId(),
    title: DEFAULT_CONVERSATION_TITLE,
    messages: [],
    ...(opts.agentId !== undefined ? { agentId: opts.agentId } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** First user message text, trimmed to a title-sized slug. `""` if none. */
export function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "";
  const text = firstUser.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
  return text.length > AUTOTITLE_MAX ? `${text.slice(0, AUTOTITLE_MAX).trimEnd()}…` : text;
}

/** Derive a summary from a full conversation (mirrors the adapters). */
export function conversationSummary(c: Conversation): ConversationSummary {
  return {
    id: c.id,
    title: c.title,
    ...(c.agentId !== undefined ? { agentId: c.agentId } : {}),
    messageCount: c.messages.length,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** Insert or replace a summary, newest (`updatedAt`) first. */
export function upsertSummary(
  summaries: ConversationSummary[],
  summary: ConversationSummary,
): ConversationSummary[] {
  return [...summaries.filter((s) => s.id !== summary.id), summary].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

/** The id to select after removing `removedId` — the newest remaining, or null. */
export function nextActiveAfterRemove(
  summaries: ConversationSummary[],
  removedId: string,
): string | null {
  const remaining = summaries.filter((s) => s.id !== removedId);
  return remaining[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Fields a conversation can be patched with. */
export interface ConversationPatch {
  title?: string;
  messages?: ChatMessage[];
  agentId?: string;
}

/** Options for an explicit whole-conversation upsert. */
export interface SaveConversationOptions {
  /**
   * Reuse an id whose deletion already succeeded but whose absence has not yet
   * been confirmed by `list()`. Omit for ordinary chat updates so late stream
   * callbacks cannot resurrect a deleted conversation.
   */
  recreateDeleted?: boolean;
}

/** Options for {@link useConversations}. */
export interface UseConversationsOptions {
  /** Controlled active id — YOU own the source (e.g. `router.query.thread`).
   *  Omit to let the hook manage active internally (uncontrolled). */
  id?: string | null;
  /** Fired when active should change (select / after create / after remove).
   *  Wire it to your router. Omit → internal active state. */
  onSelect?: (id: string | null) => void;
  /** Async persistence adapter. Default: `localConversationStore(storageKey)`.
   *  Keep it referentially stable (module-level factory or `useMemo`). */
  store?: ConversationStore;
  /** Convenience storage key for the default localStorage adapter. */
  storageKey?: string;
  /** Called when a persistence operation fails. */
  onError?: (error: ConversationStoreError) => void;
}

/** Result of {@link useConversations}. */
export interface UseConversationsResult {
  /** All conversations as summaries (no messages), newest first. */
  conversations: ConversationSummary[];
  /** The full active conversation (with messages), or `null`. */
  activeConversation: Conversation | null;
  /** Id of the active conversation, or `null`. */
  activeConversationId: string | null;
  /**
   * True only while the initial list is loading from the store. Active-record
   * loading is reported separately by {@link UseConversationsPersistenceState}.
   */
  isLoading: boolean;
  select: (id?: string | null) => void;
  create: (agentId?: string) => Conversation;
  rename: (id: string, title: string) => void;
  remove: (id: string) => void;
  update: (id: string, patch: ConversationPatch) => void;
  /**
   * Upsert a whole conversation (create-or-update). The store default for
   * `<Chat onUpdate>` — hand it the emitted `{ id, messages, title, updatedAt }`
   * and it lands in the list + persists. The conversation arrives fully formed
   * (title already derived by the emitter), so this stays dumb about titling.
   */
  save: (conversation: Conversation, options?: SaveConversationOptions) => void;
  /** Persist a live chat's messages + auto-title from the first user message. */
  bind: (id: string, chat: { messages: ChatMessage[] }) => void;
}

/** Additive persistence state returned by {@link useConversations}. */
export interface UseConversationsPersistenceState {
  /** True while the active conversation's full record is being resolved. */
  isActiveConversationLoading: boolean;
  /** Most recent persistence or reconciliation failure, or `null`. */
  error: ConversationStoreError | null;
  /** Clear the reported persistence failure. */
  clearError: () => void;
}

/** A failed provider-owned active-record load, attributed to its exact id. */
export interface ActiveConversationLoadFailure {
  /** Conversation id whose full record failed to load. */
  readonly id: string;
  /** Normalized failure for this specific load attempt. */
  readonly error: ConversationStoreError;
}

/** Additive active-record controls returned by {@link useConversations}. */
export interface UseConversationsActiveLoadState {
  /** Most recent active-record failure, or `null` after a new attempt/success/clear. */
  activeConversationError: ActiveConversationLoadFailure | null;
  /** Clear only the active-record failure without discarding a newer unrelated error. */
  clearActiveConversationError: () => void;
  /** Re-fetch the current active conversation from the provider-owned store. */
  reloadActiveConversation: () => void;
}

interface StoreScope {
  readonly token: symbol;
  readonly store: ConversationStore;
  readonly mutationTails: Map<string, Promise<void>>;
}

interface ActiveConversationLoad {
  readonly scope: StoreScope;
  readonly id: string;
  readonly generation: number;
}

interface PendingSave {
  readonly scope: StoreScope;
  readonly revision: number;
  readonly conversation: Conversation;
}

interface DirtyConversation {
  readonly revision: number;
  readonly summary: ConversationSummary;
  /**
   * Latest complete optimistic value. A summary alone cannot recover unsaved
   * messages after navigation, so full records stay here until the matching
   * write is acknowledged.
   */
  readonly conversation?: Conversation;
  /** Summary to restore if every queued optimistic revision fails to load. */
  readonly rollbackSummary?: ConversationSummary;
  readonly persisted: boolean;
  readonly acknowledgeFromListRequest: number;
}

type DeferredDeletionMutation =
  | { readonly kind: "save"; readonly conversation: Conversation }
  | { readonly kind: "patch"; readonly patch: ConversationPatch };

interface DeletionBarrier {
  readonly revision: number;
  status: "deleting" | "deleted";
  acknowledgeAbsenceFromListRequest: number;
  deferred: DeferredDeletionMutation[];
}

function applyConversationPatch(
  conversation: Conversation,
  patch: ConversationPatch,
  updatedAt: number,
): Conversation {
  return {
    ...conversation,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.messages !== undefined ? { messages: patch.messages } : {}),
    ...(patch.agentId !== undefined ? { agentId: patch.agentId } : {}),
    updatedAt,
  };
}

function snapshotConversation(conversation: Conversation): Conversation {
  return structuredClone(conversation);
}

function snapshotConversationPatch(patch: ConversationPatch): ConversationPatch {
  return {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.messages !== undefined ? { messages: structuredClone(patch.messages) } : {}),
    ...(patch.agentId !== undefined ? { agentId: patch.agentId } : {}),
  };
}

/** List + active + persistence for conversations, over a swappable async store. */
export function useConversations(
  options: UseConversationsOptions = {},
): UseConversationsResult & UseConversationsPersistenceState & UseConversationsActiveLoadState {
  const { id: controlledId, onSelect, storageKey, onError } = options;
  const isControlled = controlledId !== undefined;

  const store = React.useMemo(
    () => options.store ?? localConversationStore(storageKey),
    [options.store, storageKey],
  );
  const scope = React.useMemo<StoreScope>(
    () => ({
      token: Symbol("conversation-store-scope"),
      store,
      mutationTails: new Map(),
    }),
    [store],
  );

  const [summaries, setSummaries] = React.useState<ConversationSummary[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isActiveConversationLoading, setIsActiveConversationLoading] = React.useState(false);
  const [active, setActive] = React.useState<Conversation | null>(null);
  const [internalActiveId, setInternalActiveId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<ConversationStoreError | null>(null);
  const [activeConversationError, setActiveConversationError] = React.useState<
    ActiveConversationLoadFailure | null
  >(null);

  const activeId = isControlled ? (controlledId ?? null) : internalActiveId;
  const mountedRef = React.useRef(true);
  const activeScopeRef = React.useRef<StoreScope | null>(scope);
  const committedScopeRef = React.useRef(scope);
  const controlRef = React.useRef({ isControlled, onSelect });
  const onErrorRef = React.useRef(onError);
  const summariesRef = React.useRef(summaries);
  const activeRef = React.useRef(active);
  const activeIdRef = React.useRef(activeId);
  const pendingScopeResetRef = React.useRef<StoreScope | null>(null);
  const activeLoadGenerationRef = React.useRef(0);
  const activeLoadRef = React.useRef<ActiveConversationLoad | null>(null);
  const activeConversationErrorRef = React.useRef(activeConversationError);
  const dirtyByScopeRef = React.useRef(
    new Map<StoreScope, Map<string, DirtyConversation>>(),
  );
  const pendingByScopeRef = React.useRef(
    new Map<StoreScope, Map<string, number>>(),
  );
  const deletionByScopeRef = React.useRef(
    new Map<StoreScope, Map<string, DeletionBarrier>>(),
  );
  const deferredRefreshScopesRef = React.useRef(new Set<StoreScope>());
  const refreshByScopeRef = React.useRef(new Map<StoreScope, () => void>());
  const listRequestSequenceRef = React.useRef(0);

  const writeSummaries = React.useCallback((next: ConversationSummary[]) => {
    summariesRef.current = next;
    setSummaries(next);
  }, []);
  const updateSummaries = React.useCallback((
    updater: (current: ConversationSummary[]) => ConversationSummary[],
  ) => {
    const current = summariesRef.current;
    const next = updater(current);
    if (next === current) return;
    writeSummaries(next);
  }, [writeSummaries]);
  const writeActive = React.useCallback((next: Conversation | null) => {
    activeRef.current = next;
    setActive(next);
  }, []);

  const publishScope = React.useCallback(() => {
    controlRef.current = { isControlled, onSelect };
    onErrorRef.current = onError;
    const previous = committedScopeRef.current;
    const changed = previous !== scope;
    mountedRef.current = true;
    activeScopeRef.current = scope;
    committedScopeRef.current = scope;
    activeIdRef.current = changed && !isControlled ? null : activeId;
    if (changed) {
      activeLoadGenerationRef.current += 1;
      activeLoadRef.current = null;
      dirtyByScopeRef.current.delete(previous);
      pendingByScopeRef.current.delete(previous);
      deletionByScopeRef.current.delete(previous);
      deferredRefreshScopesRef.current.delete(previous);
      refreshByScopeRef.current.delete(previous);
      summariesRef.current = [];
      activeRef.current = null;
      pendingScopeResetRef.current = scope;
    }
  }, [activeId, isControlled, onError, onSelect, scope]);
  // React 17 has no insertion phase. Its renderer is synchronous, so publish
  // during render to let descendant layout effects use the new scope; the
  // layout effect below republishes after React runs the previous cleanup.
  if (scopeCommitRequiresRenderPublication) publishScope();
  useScopeCommitEffect(() => {
    publishScope();
    return () => {
      if (activeScopeRef.current === scope) activeScopeRef.current = null;
    };
  }, [publishScope, scope]);
  useIsomorphicLayoutEffect(() => {
    if (pendingScopeResetRef.current === scope) return;
    summariesRef.current = summaries;
  }, [scope, summaries]);
  useIsomorphicLayoutEffect(() => {
    if (pendingScopeResetRef.current === scope) return;
    activeRef.current = active;
  }, [active, scope]);

  const isCurrentScope = React.useCallback((candidate: StoreScope): boolean => {
    return mountedRef.current && activeScopeRef.current === candidate;
  }, []);
  const transitionActiveConversationLoading = React.useCallback((
    candidate: StoreScope,
    id: string | null,
    loading: boolean,
    ownsRequest = false,
  ): number | null => {
    if (!isCurrentScope(candidate)) return null;
    const generation = ++activeLoadGenerationRef.current;
    activeLoadRef.current = loading && ownsRequest && id !== null
      ? { scope: candidate, id, generation }
      : null;
    setIsActiveConversationLoading(loading);
    return generation;
  }, [isCurrentScope]);
  const isCurrentActiveLoad = React.useCallback((
    candidate: StoreScope,
    id: string,
    generation: number,
  ): boolean => {
    const current = activeLoadRef.current;
    return isCurrentScope(candidate) &&
      activeIdRef.current === id &&
      current?.scope === candidate &&
      current.id === id &&
      current.generation === generation;
  }, [isCurrentScope]);
  const runContinuation = React.useCallback((action: () => void): void => {
    try {
      action();
    } catch (cause) {
      reportUnhandledError(cause);
    }
  }, []);
  const publishError = React.useCallback((
    candidate: StoreScope,
    nextError: ConversationStoreError,
  ): void => {
    if (!isCurrentScope(candidate)) return;
    setError(nextError);
    try {
      onErrorRef.current?.(nextError);
    } catch (cause) {
      reportUnhandledError(cause);
    }
  }, [isCurrentScope]);

  const revisionRef = React.useRef(0);
  const nextRevision = React.useCallback((): number => {
    revisionRef.current += 1;
    return revisionRef.current;
  }, []);
  const enqueueMutation = React.useCallback(<T>(
    candidate: StoreScope,
    id: string,
    action: () => Promise<T>,
  ): Promise<T> => {
    const scopeTails = candidate.mutationTails;
    const previous = scopeTails.get(id);
    let result: Promise<T>;
    if (previous) {
      result = previous.then(action);
    } else {
      try {
        result = action();
      } catch (cause) {
        result = Promise.reject(cause);
      }
    }
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    scopeTails.set(id, tail);
    void tail.then(() => {
      if (scopeTails.get(id) === tail) {
        scopeTails.delete(id);
      }
    });
    return result;
  }, []);

  const scopeMap = React.useCallback(<T>(
    source: Map<StoreScope, Map<string, T>>,
    candidate: StoreScope,
  ): Map<string, T> => {
    let values = source.get(candidate);
    if (!values) {
      values = new Map();
      source.set(candidate, values);
    }
    return values;
  }, []);
  const isScopePending = React.useCallback((candidate: StoreScope): boolean => {
    const counts = pendingByScopeRef.current.get(candidate);
    if (!counts) return false;
    for (const count of counts.values()) {
      if (count > 0) return true;
    }
    return false;
  }, []);
  const isIdPending = React.useCallback((candidate: StoreScope, id: string): boolean => {
    return (pendingByScopeRef.current.get(candidate)?.get(id) ?? 0) > 0;
  }, []);
  const isIdDirty = React.useCallback((candidate: StoreScope, id: string): boolean => {
    return dirtyByScopeRef.current.get(candidate)?.has(id) ?? false;
  }, []);
  const deferRefresh = React.useCallback((candidate: StoreScope): void => {
    deferredRefreshScopesRef.current.add(candidate);
  }, []);
  const beginPending = React.useCallback((candidate: StoreScope, id: string): void => {
    const counts = scopeMap(pendingByScopeRef.current, candidate);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }, [scopeMap]);
  const finishPending = React.useCallback((candidate: StoreScope, id: string): void => {
    const counts = pendingByScopeRef.current.get(candidate);
    if (counts) {
      const next = (counts.get(id) ?? 1) - 1;
      if (next > 0) counts.set(id, next);
      else counts.delete(id);
      if (counts.size === 0) pendingByScopeRef.current.delete(candidate);
    }
    if (
      isCurrentScope(candidate) &&
      !isIdPending(candidate, id) &&
      activeIdRef.current === id
    ) {
      const retained = dirtyByScopeRef.current.get(candidate)?.get(id)?.conversation;
      if (retained) {
        transitionActiveConversationLoading(candidate, null, false);
        if (activeRef.current !== retained) writeActive(retained);
      }
    }
    if (
      isCurrentScope(candidate) &&
      !isScopePending(candidate) &&
      deferredRefreshScopesRef.current.delete(candidate)
    ) {
      queueMicrotask(() => {
        if (isCurrentScope(candidate)) refreshByScopeRef.current.get(candidate)?.();
      });
    }
  }, [
    isCurrentScope,
    isIdPending,
    isScopePending,
    transitionActiveConversationLoading,
    writeActive,
  ]);
  const markDirty = React.useCallback((
    candidate: StoreScope,
    revision: number,
    summary: ConversationSummary,
    conversation?: Conversation,
    rollbackSummary?: ConversationSummary,
  ): void => {
    if (!isCurrentScope(candidate)) return;
    const dirty = scopeMap(dirtyByScopeRef.current, candidate);
    const current = dirty.get(summary.id);
    if (current && current.revision > revision) return;
    const stableRollbackSummary = current?.rollbackSummary ?? rollbackSummary;
    dirty.set(summary.id, {
      revision,
      summary,
      ...(conversation ? { conversation } : {}),
      ...(stableRollbackSummary ? { rollbackSummary: stableRollbackSummary } : {}),
      persisted: false,
      acknowledgeFromListRequest: Number.POSITIVE_INFINITY,
    });
  }, [isCurrentScope, scopeMap]);
  const markPersisted = React.useCallback((
    candidate: StoreScope,
    id: string,
    revision: number,
    persistedSummary: ConversationSummary,
  ): void => {
    const current = dirtyByScopeRef.current.get(candidate)?.get(id);
    if (!current || current.revision < revision) return;
    if (current.revision > revision) {
      dirtyByScopeRef.current.get(candidate)?.set(id, {
        ...current,
        rollbackSummary: persistedSummary,
      });
      return;
    }
    dirtyByScopeRef.current.get(candidate)?.set(id, {
      ...current,
      rollbackSummary: persistedSummary,
      persisted: true,
      acknowledgeFromListRequest: listRequestSequenceRef.current + 1,
    });
  }, []);
  const clearDirtyRevision = React.useCallback((
    candidate: StoreScope,
    id: string,
    revision: number,
  ): DirtyConversation | null => {
    const dirty = dirtyByScopeRef.current.get(candidate);
    if (!dirty) return null;
    const current = dirty.get(id);
    if (!current || current.revision !== revision) return null;
    dirty.delete(id);
    if (dirty.size === 0) dirtyByScopeRef.current.delete(candidate);
    return current;
  }, []);
  const deletionBarrier = React.useCallback((
    candidate: StoreScope,
    id: string,
  ): DeletionBarrier | undefined => {
    return deletionByScopeRef.current.get(candidate)?.get(id);
  }, []);

  const persistConversation = React.useCallback((
    candidate: StoreScope,
    conversation: Conversation,
    revision: number,
    pendingAlreadyCounted = false,
  ): void => {
    if (!pendingAlreadyCounted) beginPending(candidate, conversation.id);
    const result = enqueueMutation(
      candidate,
      conversation.id,
      () => invokeStore("save", () => candidate.store.save(conversation)),
    );
    void result.then(
      () => {
        markPersisted(
          candidate,
          conversation.id,
          revision,
          conversationSummary(conversation),
        );
        if (isCurrentScope(candidate)) deferRefresh(candidate);
        finishPending(candidate, conversation.id);
      },
      (cause) => {
        finishPending(candidate, conversation.id);
        publishError(candidate, toConversationStoreError("save", cause));
      },
    );
  }, [
    beginPending,
    deferRefresh,
    enqueueMutation,
    finishPending,
    isCurrentScope,
    markPersisted,
    publishError,
  ]);

  // Debounced persistence — a burst of streaming message updates collapses to
  // one save. Every pending entry captures its committed store scope.
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingSave = React.useRef<PendingSave | null>(null);
  const flushSave = React.useCallback((scopeFilter?: StoreScope) => {
    const pending = pendingSave.current;
    if (!pending || (scopeFilter && pending.scope !== scopeFilter)) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    pendingSave.current = null;
    persistConversation(
      pending.scope,
      pending.conversation,
      pending.revision,
      true,
    );
  }, [persistConversation]);
  const scheduleSave = React.useCallback((
    candidate: StoreScope,
    conversation: Conversation,
    revision: number,
  ) => {
    if (
      pendingSave.current &&
      (
        pendingSave.current.scope !== candidate ||
        pendingSave.current.conversation.id !== conversation.id
      )
    ) {
      flushSave();
    }
    if (!pendingSave.current) beginPending(candidate, conversation.id);
    pendingSave.current = { scope: candidate, conversation, revision };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }, [beginPending, flushSave]);

  // The insertion effect above publishes the committed scope before descendant
  // layout effects. Synchronize React state from those refs here so commands
  // issued by descendants during that same commit are preserved.
  useIsomorphicLayoutEffect(() => {
    if (pendingScopeResetRef.current !== scope) return;
    pendingScopeResetRef.current = null;
    writeSummaries(summariesRef.current);
    writeActive(activeRef.current);
    setError(null);
    activeConversationErrorRef.current = null;
    setActiveConversationError(null);
    setIsLoading(true);
    setIsActiveConversationLoading(false);
    if (!controlRef.current.isControlled) {
      setInternalActiveId(activeIdRef.current);
    }
  }, [scope, writeActive, writeSummaries]);
  React.useEffect(() => () => flushSave(scope), [flushSave, scope]);

  const selectForScope = React.useCallback((
    candidate: StoreScope,
    id: string | null,
  ): void => {
    if (!isCurrentScope(candidate)) return;
    const control = controlRef.current;
    if (control.isControlled) {
      control.onSelect?.(id);
      return;
    }
    activeIdRef.current = id;
    setInternalActiveId(id);
  }, [isCurrentScope]);
  const select = React.useCallback((id?: string | null) => {
    if (!isCurrentScope(scope)) return;
    selectForScope(scope, id ?? null);
  }, [isCurrentScope, scope, selectForScope]);

  const createConversationForScope = React.useCallback((
    candidate: StoreScope,
    agentId?: string,
    excludedDraftId?: string,
  ): Conversation => {
    if (!isCurrentScope(candidate)) throw new ConversationHookScopeError();
    const draft = summariesRef.current.find(
      (s) =>
        s.id !== excludedDraftId &&
        s.messageCount === 0 &&
        s.title === DEFAULT_CONVERSATION_TITLE &&
        s.agentId === agentId,
    );
    if (draft) {
      transitionActiveConversationLoading(candidate, null, false);
      const reused: Conversation = activeRef.current?.id === draft.id ? activeRef.current : {
        id: draft.id,
        title: draft.title,
        ...(draft.agentId !== undefined ? { agentId: draft.agentId } : {}),
        messages: [],
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
      };
      writeActive(reused);
      selectForScope(candidate, draft.id);
      return reused;
    }
    const conversation = createEmptyConversation({ agentId });
    transitionActiveConversationLoading(candidate, null, false);
    const revision = nextRevision();
    markDirty(candidate, revision, conversationSummary(conversation), conversation);
    persistConversation(candidate, conversation, revision);
    updateSummaries((current) => upsertSummary(current, conversationSummary(conversation)));
    writeActive(conversation);
    selectForScope(candidate, conversation.id);
    return conversation;
  }, [
    isCurrentScope,
    markDirty,
    nextRevision,
    persistConversation,
    selectForScope,
    transitionActiveConversationLoading,
    updateSummaries,
    writeActive,
  ]);

  const create = React.useCallback(
    (agentId?: string): Conversation => {
      if (!isCurrentScope(scope)) throw new ConversationHookScopeError();
      return createConversationForScope(scope, agentId);
    },
    [createConversationForScope, isCurrentScope, scope],
  );

  const requestActiveLoad = React.useCallback((
    candidate: StoreScope,
    id: string,
  ): void => {
    if (!isCurrentScope(candidate)) return;
    activeConversationErrorRef.current = null;
    setActiveConversationError(null);
    const dirtyConversation = dirtyByScopeRef.current.get(candidate)?.get(id)?.conversation;
    if (dirtyConversation) {
      transitionActiveConversationLoading(candidate, null, false);
      if (activeRef.current !== dirtyConversation) writeActive(dirtyConversation);
      return;
    }
    if (isIdDirty(candidate, id) && activeRef.current?.id === id) {
      transitionActiveConversationLoading(candidate, null, false);
      return;
    }
    if (isIdPending(candidate, id)) {
      transitionActiveConversationLoading(
        candidate,
        id,
        activeRef.current?.id !== id,
      );
      deferRefresh(candidate);
      return;
    }
    const generation = transitionActiveConversationLoading(candidate, id, true, true);
    if (generation === null) return;
    const request = invokeStore("load", () => candidate.store.load(id));
    void request.then(
      (conversation) => {
        if (!isCurrentActiveLoad(candidate, id, generation)) return;
        const retained = dirtyByScopeRef.current.get(candidate)?.get(id)?.conversation;
        if (retained) {
          transitionActiveConversationLoading(candidate, null, false);
          if (activeRef.current !== retained) writeActive(retained);
          return;
        }
        if (isIdPending(candidate, id)) {
          transitionActiveConversationLoading(
            candidate,
            id,
            activeRef.current?.id !== id,
          );
          deferRefresh(candidate);
          return;
        }
        if (conversation) {
          transitionActiveConversationLoading(candidate, null, false);
          writeActive(conversation);
          return;
        }
        transitionActiveConversationLoading(candidate, null, false);
        runContinuation(() => {
          updateSummaries((current) => current.filter((summary) => summary.id !== id));
          writeActive(null);
          const next = summariesRef.current[0]?.id ?? null;
          if (next) selectForScope(candidate, next);
          else createConversationForScope(candidate, undefined, id);
        });
      },
      (cause) => {
        if (!isCurrentActiveLoad(candidate, id, generation)) return;
        transitionActiveConversationLoading(candidate, null, false);
        const nextError = toConversationStoreError("load", cause);
        const failure = { id, error: nextError };
        activeConversationErrorRef.current = failure;
        setActiveConversationError(failure);
        publishError(candidate, nextError);
      },
    );
  }, [
    createConversationForScope,
    deferRefresh,
    isCurrentActiveLoad,
    isCurrentScope,
    isIdDirty,
    isIdPending,
    publishError,
    runContinuation,
    selectForScope,
    transitionActiveConversationLoading,
    updateSummaries,
    writeActive,
  ]);

  const reloadActiveConversation = React.useCallback(() => {
    if (!isCurrentScope(scope)) return;
    const id = activeIdRef.current;
    if (id) requestActiveLoad(scope, id);
  }, [isCurrentScope, requestActiveLoad, scope]);

  const reconcileList = React.useCallback((
    candidate: StoreScope,
    incoming: ConversationSummary[],
    requestId: number,
  ): ConversationSummary[] => {
    let next = [...incoming];
    const barriers = deletionByScopeRef.current.get(candidate);
    if (barriers) {
      for (const [id, barrier] of [...barriers]) {
        const remoteHasId = next.some((summary) => summary.id === id);
        next = next.filter((summary) => summary.id !== id);
        if (barrier.status === "deleting") {
          const local = summariesRef.current.find((summary) => summary.id === id);
          if (local) next = upsertSummary(next, local);
        } else if (
          !remoteHasId &&
          requestId >= barrier.acknowledgeAbsenceFromListRequest
        ) {
          barriers.delete(id);
        }
      }
      if (barriers.size === 0) deletionByScopeRef.current.delete(candidate);
    }
    const dirty = dirtyByScopeRef.current.get(candidate);
    if (dirty) {
      for (const [id, entry] of [...dirty]) {
        const remote = next.find((summary) => summary.id === id);
        if (
          entry.persisted &&
          !isIdPending(candidate, id) &&
          requestId >= entry.acknowledgeFromListRequest &&
          remote !== undefined
        ) {
          // A list request started after save acknowledgement is authoritative.
          // Providers may normalize titles, counts, or timestamps; retaining
          // the client summary until exact equality would mask server truth
          // forever and leak the dirty entry.
          dirty.delete(id);
          continue;
        }
        next = upsertSummary(next, entry.summary);
      }
      if (dirty.size === 0) dirtyByScopeRef.current.delete(candidate);
    }
    return [...next].sort((left, right) => right.updatedAt - left.updatedAt);
  }, [isIdPending]);

  const listGenerationRef = React.useRef(0);
  React.useEffect(() => {
    let cancelled = false;
    let initialized = false;

    const acceptList = (incoming: ConversationSummary[], requestId: number): void => {
      if (!isCurrentScope(scope)) return;
      const list = reconcileList(scope, incoming, requestId);
      writeSummaries(list);
      setIsLoading(false);
      if (!initialized) {
        initialized = true;
        if (list.length === 0) createConversationForScope(scope);
        else if (!controlRef.current.isControlled) {
          selectForScope(scope, list[0]?.id ?? null);
        }
        return;
      }

      const currentId = activeIdRef.current;
      if (!currentId) {
        transitionActiveConversationLoading(scope, null, false);
        if (!controlRef.current.isControlled && list[0]) {
          selectForScope(scope, list[0].id);
        }
        return;
      }
      if (list.some((summary) => summary.id === currentId)) {
        requestActiveLoad(scope, currentId);
        return;
      }
      transitionActiveConversationLoading(scope, null, false);
      writeActive(null);
      if (list[0]) selectForScope(scope, list[0].id);
      else createConversationForScope(scope, undefined, currentId);
    };

    const requestList = (initial = false): void => {
      if (cancelled || !isCurrentScope(scope)) return;
      if (!initial && isScopePending(scope)) {
        deferRefresh(scope);
        return;
      }
      const requestId = ++listRequestSequenceRef.current;
      const generation = ++listGenerationRef.current;
      const existingTails = initial ? [...scope.mutationTails.values()] : [];
      const request = invokeStore("list", () => scope.store.list());
      // Descendant layout effects can start current-scope writes before this
      // passive setup. Refresh once each of those already-started writes ends.
      for (const tail of existingTails) {
        void tail.then(() => {
          if (!cancelled && isCurrentScope(scope)) requestList(false);
        });
      }
      void request.then(
        (list) => {
          if (
            cancelled ||
            !isCurrentScope(scope) ||
            listGenerationRef.current !== generation
          ) return;
          if (isScopePending(scope)) {
            deferRefresh(scope);
            return;
          }
          runContinuation(() => acceptList(list, requestId));
        },
        (cause) => {
          if (
            cancelled ||
            !isCurrentScope(scope) ||
            listGenerationRef.current !== generation
          ) return;
          setIsLoading(false);
          if (activeLoadRef.current?.scope !== scope) {
            transitionActiveConversationLoading(scope, null, false);
          }
          publishError(scope, toConversationStoreError("list", cause));
        },
      );
    };

    refreshByScopeRef.current.set(scope, () => requestList(false));
    requestList(true);
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = scope.store.subscribe?.(() => requestList(false));
    } catch (cause) {
      publishError(scope, toConversationStoreError("subscribe", cause));
    }
    if (
      deferredRefreshScopesRef.current.delete(scope) &&
      !isScopePending(scope)
    ) requestList(false);

    return () => {
      cancelled = true;
      listGenerationRef.current += 1;
      refreshByScopeRef.current.delete(scope);
      try {
        unsubscribe?.();
      } catch (cause) {
        publishError(scope, toConversationStoreError("subscribe", cause));
      }
    };
  }, [
    createConversationForScope,
    deferRefresh,
    isCurrentScope,
    isIdDirty,
    isScopePending,
    publishError,
    reconcileList,
    requestActiveLoad,
    runContinuation,
    scope,
    selectForScope,
    transitionActiveConversationLoading,
    writeActive,
    writeSummaries,
  ]);

  React.useEffect(() => {
    if (!isCurrentScope(scope)) return;
    if (!activeId) {
      transitionActiveConversationLoading(scope, null, false);
      writeActive(null);
      return;
    }
    if (activeRef.current?.id === activeId) {
      transitionActiveConversationLoading(scope, null, false);
      return;
    }
    writeActive(null);
    requestActiveLoad(scope, activeId);
  }, [
    activeId,
    isCurrentScope,
    requestActiveLoad,
    scope,
    transitionActiveConversationLoading,
    writeActive,
  ]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeScopeRef.current = null;
      activeLoadGenerationRef.current += 1;
      activeLoadRef.current = null;
    };
  }, []);

  const bufferDeletionMutation = React.useCallback((
    barrier: DeletionBarrier,
    mutation: DeferredDeletionMutation,
  ): void => {
    const last = barrier.deferred.at(-1);
    if (mutation.kind === "save" && last?.kind === "save") {
      barrier.deferred[barrier.deferred.length - 1] = mutation;
    } else {
      barrier.deferred.push(mutation);
    }
  }, []);

  const updateForScope = React.useCallback((
    candidate: StoreScope,
    id: string,
    patch: ConversationPatch,
  ): void => {
    if (!isCurrentScope(candidate)) return;
    const barrier = deletionBarrier(candidate, id);
    if (barrier?.status === "deleted") return;
    const commandPatch = snapshotConversationPatch(patch);
    const now = Date.now();
    const activeConversation = activeRef.current?.id === id ? activeRef.current : null;
    const retainedConversation = dirtyByScopeRef.current.get(candidate)?.get(id)?.conversation ??
      null;
    const localConversation = activeConversation ?? retainedConversation;
    if (localConversation) {
      const next = applyConversationPatch(localConversation, commandPatch, now);
      if (activeConversation || activeIdRef.current === id) {
        transitionActiveConversationLoading(candidate, null, false);
        writeActive(next);
      }
      updateSummaries((current) => {
        const existing = current.find((summary) => summary.id === id);
        return existing ? upsertSummary(current, conversationSummary(next)) : current;
      });
      if (barrier) {
        bufferDeletionMutation(barrier, { kind: "save", conversation: next });
        return;
      }
      const revision = nextRevision();
      markDirty(candidate, revision, conversationSummary(next), next);
      scheduleSave(candidate, next, revision);
      return;
    }
    if (barrier) {
      bufferDeletionMutation(barrier, { kind: "patch", patch: commandPatch });
      return;
    }
    if (pendingSave.current?.scope === candidate && pendingSave.current.conversation.id === id) {
      flushSave(candidate);
    }
    const previousSummary = summariesRef.current.find((summary) => summary.id === id);
    updateSummaries((current) => {
      const existing = current.find((summary) => summary.id === id);
      if (!existing) return current;
      return upsertSummary(current, {
        ...existing,
        ...(commandPatch.title !== undefined ? { title: commandPatch.title } : {}),
        ...(commandPatch.agentId !== undefined ? { agentId: commandPatch.agentId } : {}),
        ...(commandPatch.messages !== undefined
          ? { messageCount: commandPatch.messages.length }
          : {}),
        updatedAt: now,
      });
    });
    const optimistic = summariesRef.current.find((summary) => summary.id === id);
    const revision = nextRevision();
    if (optimistic) {
      markDirty(candidate, revision, optimistic, undefined, previousSummary);
    }
    beginPending(candidate, id);
    const result = enqueueMutation(candidate, id, async () => {
      const loaded = await invokeStore("load", () => candidate.store.load(id));
      if (!loaded) throw new ConversationNotFoundError(id);
      const next = applyConversationPatch(loaded, commandPatch, now);
      markDirty(candidate, revision, conversationSummary(next), next);
      await invokeStore("save", () => candidate.store.save(next));
      return next;
    });
    void result.then(
      (saved) => {
        markPersisted(candidate, id, revision, conversationSummary(saved));
        if (isCurrentScope(candidate)) deferRefresh(candidate);
        finishPending(candidate, id);
        if (
          isCurrentScope(candidate) &&
          activeIdRef.current === id &&
          dirtyByScopeRef.current.get(candidate)?.get(id)?.revision === revision
        ) {
          transitionActiveConversationLoading(candidate, null, false);
          writeActive(saved);
        }
      },
      (cause) => {
        finishPending(candidate, id);
        if (cause instanceof ConversationNotFoundError) {
          const cleared = clearDirtyRevision(candidate, id, revision);
          if (cleared && isCurrentScope(candidate)) {
            updateSummaries((current) => current.filter((summary) => summary.id !== id));
          }
          publishError(candidate, toConversationStoreError("load", cause));
          return;
        }
        const cleared = cause instanceof ConversationStoreError &&
            cause.operation === "load"
          ? clearDirtyRevision(candidate, id, revision)
          : null;
        if (
          cleared &&
          isCurrentScope(candidate)
        ) {
          updateSummaries((current) =>
            cleared.rollbackSummary
              ? upsertSummary(current, cleared.rollbackSummary)
              : current.filter((summary) => summary.id !== id)
          );
        }
        publishError(
          candidate,
          cause instanceof ConversationStoreError ? cause : toConversationStoreError("save", cause),
        );
      },
    );
  }, [
    beginPending,
    bufferDeletionMutation,
    clearDirtyRevision,
    deletionBarrier,
    deferRefresh,
    enqueueMutation,
    finishPending,
    flushSave,
    isCurrentScope,
    markDirty,
    markPersisted,
    nextRevision,
    publishError,
    scheduleSave,
    transitionActiveConversationLoading,
    updateSummaries,
    writeActive,
  ]);

  const update = React.useCallback((id: string, patch: ConversationPatch) => {
    updateForScope(scope, id, patch);
  }, [scope, updateForScope]);

  const save = React.useCallback((
    conversation: Conversation,
    saveOptions: SaveConversationOptions = {},
  ) => {
    if (!isCurrentScope(scope)) return;
    const barrier = deletionBarrier(scope, conversation.id);
    if (barrier?.status === "deleted") {
      if (!saveOptions.recreateDeleted) return;
      const barriers = deletionByScopeRef.current.get(scope);
      barriers?.delete(conversation.id);
      if (barriers?.size === 0) deletionByScopeRef.current.delete(scope);
    }
    const commandConversation = snapshotConversation(conversation);
    const summary = conversationSummary(commandConversation);
    updateSummaries((current) => upsertSummary(current, summary));
    if (
      activeRef.current?.id === commandConversation.id ||
      activeIdRef.current === commandConversation.id
    ) {
      transitionActiveConversationLoading(scope, null, false);
      writeActive(commandConversation);
    }
    if (barrier?.status === "deleting") {
      bufferDeletionMutation(barrier, { kind: "save", conversation: commandConversation });
      return;
    }
    const revision = nextRevision();
    markDirty(scope, revision, summary, commandConversation);
    scheduleSave(scope, commandConversation, revision);
  }, [
    bufferDeletionMutation,
    deletionBarrier,
    isCurrentScope,
    markDirty,
    nextRevision,
    scheduleSave,
    scope,
    transitionActiveConversationLoading,
    updateSummaries,
    writeActive,
  ]);

  const bind = React.useCallback((id: string, chat: { messages: ChatMessage[] }) => {
    if (!isCurrentScope(scope)) return;
    const current = activeRef.current?.id === id
      ? activeRef.current
      : summariesRef.current.find((s) => s.id === id);
    const patch: ConversationPatch = { messages: chat.messages };
    // Auto-title an untitled conversation from its first user message.
    if (current && current.title === DEFAULT_CONVERSATION_TITLE) {
      const title = deriveTitle(chat.messages);
      if (title) patch.title = title;
    }
    updateForScope(scope, id, patch);
  }, [isCurrentScope, scope, updateForScope]);

  const rename = React.useCallback((id: string, title: string) => {
    updateForScope(scope, id, { title });
  }, [scope, updateForScope]);

  const remove = React.useCallback((id: string) => {
    if (!isCurrentScope(scope)) return;
    const barriers = scopeMap(deletionByScopeRef.current, scope);
    if (barriers.has(id)) return;
    if (pendingSave.current?.scope === scope && pendingSave.current.conversation.id === id) {
      flushSave(scope);
    }
    const revision = nextRevision();
    const barrier: DeletionBarrier = {
      revision,
      status: "deleting",
      acknowledgeAbsenceFromListRequest: Number.POSITIVE_INFINITY,
      deferred: [],
    };
    barriers.set(id, barrier);
    beginPending(scope, id);
    const result = enqueueMutation(
      scope,
      id,
      () => invokeStore("delete", () => scope.store.delete(id)),
    );
    void result.then(
      () => {
        const currentBarrier = deletionByScopeRef.current.get(scope)?.get(id);
        if (currentBarrier !== barrier || currentBarrier.revision !== revision) {
          finishPending(scope, id);
          return;
        }
        currentBarrier.status = "deleted";
        currentBarrier.deferred = [];
        currentBarrier.acknowledgeAbsenceFromListRequest = listRequestSequenceRef.current + 1;
        dirtyByScopeRef.current.get(scope)?.delete(id);
        runContinuation(() => {
          if (!isCurrentScope(scope)) return;
          const next = nextActiveAfterRemove(summariesRef.current, id);
          updateSummaries((current) => current.filter((summary) => summary.id !== id));
          if (activeIdRef.current !== id) return;
          transitionActiveConversationLoading(scope, null, false);
          writeActive(null);
          if (next) selectForScope(scope, next);
          else createConversationForScope(scope, undefined, id);
        });
        if (isCurrentScope(scope)) deferRefresh(scope);
        finishPending(scope, id);
      },
      (cause) => {
        const currentBarrier = deletionByScopeRef.current.get(scope)?.get(id);
        const deferred = currentBarrier === barrier ? [...barrier.deferred] : [];
        if (currentBarrier === barrier) {
          deletionByScopeRef.current.get(scope)?.delete(id);
        }
        finishPending(scope, id);
        publishError(scope, toConversationStoreError("delete", cause));
        if (!isCurrentScope(scope)) return;
        for (const mutation of deferred) {
          if (mutation.kind === "save") save(mutation.conversation);
          else updateForScope(scope, id, mutation.patch);
        }
      },
    );
  }, [
    beginPending,
    createConversationForScope,
    enqueueMutation,
    deferRefresh,
    finishPending,
    flushSave,
    isCurrentScope,
    nextRevision,
    publishError,
    runContinuation,
    save,
    scope,
    scopeMap,
    selectForScope,
    transitionActiveConversationLoading,
    updateForScope,
    updateSummaries,
    writeActive,
  ]);

  const clearError = React.useCallback(() => {
    if (!isCurrentScope(scope)) return;
    setError(null);
    activeConversationErrorRef.current = null;
    setActiveConversationError(null);
  }, [isCurrentScope, scope]);

  const clearActiveConversationError = React.useCallback(() => {
    if (!isCurrentScope(scope)) return;
    const failure = activeConversationErrorRef.current;
    if (!failure) return;
    activeConversationErrorRef.current = null;
    setActiveConversationError(null);
    setError((current) => current === failure.error ? null : current);
  }, [isCurrentScope, scope]);

  return React.useMemo(() => ({
    conversations: summaries,
    activeConversation: active,
    activeConversationId: activeId,
    isLoading,
    isActiveConversationLoading,
    activeConversationError,
    clearActiveConversationError,
    reloadActiveConversation,
    error,
    clearError,
    select,
    create,
    rename,
    remove,
    update,
    save,
    bind,
  }), [
    summaries,
    active,
    activeId,
    isLoading,
    isActiveConversationLoading,
    activeConversationError,
    clearActiveConversationError,
    reloadActiveConversation,
    error,
    clearError,
    select,
    create,
    rename,
    remove,
    update,
    save,
    bind,
  ]);
}
