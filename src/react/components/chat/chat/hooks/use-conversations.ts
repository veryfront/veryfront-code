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
import { generateUuid } from "#veryfront/utils/id.ts";
import type {
  Conversation,
  ConversationStore,
  ConversationSummary,
} from "../persistence/conversation-store.ts";
import { localConversationStore } from "../persistence/local-conversation-store.ts";

/** Default title for a fresh, untitled conversation. */
export const DEFAULT_CONVERSATION_TITLE = "New Chat";
const AUTOTITLE_MAX = 40;
const SAVE_DEBOUNCE_MS = 300;

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
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
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
    ...(c.agentId ? { agentId: c.agentId } : {}),
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
}

/** Result of {@link useConversations}. */
export interface UseConversationsResult {
  /** All conversations as summaries (no messages), newest first. */
  conversations: ConversationSummary[];
  /** The full active conversation (with messages), or `null`. */
  active: Conversation | null;
  activeId: string | null;
  /** True while the initial list is loading from the store. */
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
  save: (conversation: Conversation) => void;
  /** Persist a live chat's messages + auto-title from the first user message. */
  bind: (id: string, chat: { messages: ChatMessage[] }) => void;
}

/** List + active + persistence for conversations, over a swappable async store. */
export function useConversations(options: UseConversationsOptions = {}): UseConversationsResult {
  const { id: controlledId, onSelect, storageKey } = options;
  const isControlled = controlledId !== undefined;

  const store = React.useMemo(
    () => options.store ?? localConversationStore(storageKey),
    [options.store, storageKey],
  );

  const [summaries, setSummaries] = React.useState<ConversationSummary[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [active, setActive] = React.useState<Conversation | null>(null);
  const [internalActiveId, setInternalActiveId] = React.useState<string | null>(null);

  const activeId = isControlled ? (controlledId ?? null) : internalActiveId;

  // Keep the latest values reachable from stable callbacks without re-creating them.
  const summariesRef = React.useRef(summaries);
  summariesRef.current = summaries;
  const activeRef = React.useRef(active);
  activeRef.current = active;

  const select = React.useCallback((id?: string | null) => {
    const next = id ?? null;
    if (isControlled) onSelect?.(next);
    else setInternalActiveId(next);
  }, [isControlled, onSelect]);

  // Debounced persistence — a burst of streaming message updates collapses to
  // one save. Flushed on unmount so nothing is lost.
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingSave = React.useRef<Conversation | null>(null);
  const flushSave = React.useCallback(() => {
    clearTimeout(saveTimer.current);
    if (pendingSave.current) {
      void store.save(pendingSave.current);
      pendingSave.current = null;
    }
  }, [store]);
  const discardPendingSave = React.useCallback((id: string) => {
    if (pendingSave.current?.id !== id) return;
    clearTimeout(saveTimer.current);
    pendingSave.current = null;
  }, []);
  const scheduleSave = React.useCallback((conversation: Conversation) => {
    // A pending save for a *different* conversation must be flushed, not
    // clobbered: switching threads inside the debounce window would
    // otherwise drop the previous thread's final messages.
    if (pendingSave.current && pendingSave.current.id !== conversation.id) {
      flushSave();
    }
    pendingSave.current = conversation;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }, [flushSave]);
  React.useEffect(() => flushSave, [flushSave]);

  const create = React.useCallback((agentId?: string): Conversation => {
    // Reuse an existing untouched draft instead of piling up "New Chat" rows —
    // clicking "New chat" (or an auto-create) when a blank draft already exists
    // just re-opens it.
    const draft = summariesRef.current.find(
      (s) => s.messageCount === 0 && s.title === DEFAULT_CONVERSATION_TITLE,
    );
    if (draft) {
      const reused: Conversation = activeRef.current?.id === draft.id ? activeRef.current : {
        id: draft.id,
        title: draft.title,
        ...(draft.agentId ? { agentId: draft.agentId } : {}),
        messages: [],
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
      };
      setActive(reused);
      select(draft.id);
      return reused;
    }
    const conversation = createEmptyConversation({ agentId });
    void store.save(conversation);
    setSummaries((prev) => upsertSummary(prev, conversationSummary(conversation)));
    setActive(conversation);
    select(conversation.id);
    return conversation;
  }, [store, select]);

  // Refs for callbacks and derived props that are used inside async .then()
  // continuations in the initial-load effect. The effect is keyed on the store
  // only (it should not re-run when select/create/isControlled change), but the
  // async callbacks inside must always see the *current* values — not the stale
  // closure captured when the effect ran. Using refs achieves both goals without
  // the eslint-disable workaround.
  const createRef = React.useRef(create);
  createRef.current = create;
  const selectRef = React.useRef(select);
  selectRef.current = select;
  const isControlledRef = React.useRef(isControlled);
  isControlledRef.current = isControlled;

  // Initial load: pull the list; auto-create a draft only when there's nothing
  // to open, otherwise land on the most-recent conversation (so a reload
  // restores where you were instead of spawning a fresh "New Chat"). Runs once
  // per store.
  const didInit = React.useRef(false);
  React.useEffect(() => {
    didInit.current = false;
    let cancelled = false;
    setIsLoading(true);
    void store.list().then((list) => {
      if (cancelled) return;
      setSummaries(list);
      setIsLoading(false);
      if (!didInit.current) {
        if (list.length === 0) createRef.current();
        else if (!isControlledRef.current && activeRef.current == null) {
          const firstId = list[0]?.id ?? null;
          selectRef.current(firstId);
          if (firstId) {
            void store.load(firstId).then((conversation) => {
              if (!cancelled) setActive(conversation);
            });
          }
        }
      }
      didInit.current = true;
    });
    const unsubscribe = store.subscribe?.(() => {
      void store.list().then((list) => !cancelled && setSummaries(list));
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [store]);

  // Load the full active conversation when the active id changes. Skip when we
  // already hold it (optimistic create/update set `active` directly).
  React.useEffect(() => {
    if (!activeId) {
      setActive(null);
      return;
    }
    if (activeRef.current?.id === activeId) return;
    let cancelled = false;
    void store.load(activeId).then((conversation) => {
      if (!cancelled) setActive(conversation);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId, store]);

  const update = React.useCallback((id: string, patch: ConversationPatch) => {
    const now = Date.now();
    setSummaries((prev) => {
      const existing = prev.find((s) => s.id === id);
      if (!existing) return prev;
      return upsertSummary(prev, {
        ...existing,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.agentId !== undefined ? { agentId: patch.agentId } : {}),
        ...(patch.messages ? { messageCount: patch.messages.length } : {}),
        updatedAt: now,
      });
    });

    if (activeRef.current?.id === id) {
      const next = { ...activeRef.current, ...patch, updatedAt: now };
      setActive(next);
      scheduleSave(next);
    } else {
      // Non-active edit (e.g. rename from the sidebar) — load, patch, save now.
      void store.load(id).then((conversation) => {
        if (conversation) void store.save({ ...conversation, ...patch, updatedAt: now });
      });
    }
  }, [store, scheduleSave]);

  const save = React.useCallback((conversation: Conversation) => {
    const summary = conversationSummary(conversation);
    // Streaming emits once per token; the list (and everything reading this
    // context) only cares when something it shows (title, count, order)
    // actually changes. Returning `prev` bails out of the re-render.
    setSummaries((prev) => {
      const existing = prev.find((s) => s.id === summary.id);
      if (
        existing && existing.title === summary.title &&
        existing.messageCount === summary.messageCount
      ) return prev;
      return upsertSummary(prev, summary);
    });
    // Keep the in-memory active thread in sync when it's the one being saved,
    // so a re-open reads the just-saved messages instead of the loaded blob.
    // Same churn gate: mid-stream token growth is captured by the debounced
    // store write below; `active` consumers only read it on remount.
    if (activeRef.current?.id === conversation.id) {
      const current = activeRef.current;
      if (
        current.title !== conversation.title ||
        current.messages.length !== conversation.messages.length
      ) setActive(conversation);
    }
    scheduleSave(conversation);
  }, [scheduleSave]);

  const bind = React.useCallback((id: string, chat: { messages: ChatMessage[] }) => {
    const current = activeRef.current?.id === id
      ? activeRef.current
      : summariesRef.current.find((s) => s.id === id);
    const patch: ConversationPatch = { messages: chat.messages };
    // Auto-title an untitled conversation from its first user message.
    if (current && current.title === DEFAULT_CONVERSATION_TITLE) {
      const title = deriveTitle(chat.messages);
      if (title) patch.title = title;
    }
    update(id, patch);
  }, [update]);

  const rename = React.useCallback((id: string, title: string) => {
    update(id, { title });
  }, [update]);

  const remove = React.useCallback((id: string) => {
    discardPendingSave(id);
    void store.delete(id);
    const next = nextActiveAfterRemove(summariesRef.current, id);
    setSummaries((prev) => prev.filter((s) => s.id !== id));
    if (id === activeId) {
      if (next) select(next);
      else create();
    }
  }, [store, activeId, select, create, discardPendingSave]);

  // Memoized so `ConversationsProvider` can pass this straight through as a
  // context value: consumers re-render only when the state above changes, not
  // on every render of the provider.
  return React.useMemo(() => ({
    conversations: summaries,
    active,
    activeId,
    isLoading,
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
    select,
    create,
    rename,
    remove,
    update,
    save,
    bind,
  ]);
}
