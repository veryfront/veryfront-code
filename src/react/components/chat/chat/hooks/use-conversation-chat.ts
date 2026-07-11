import * as React from "react";
import { useChat } from "#veryfront/agent/react";
import type { ChatMessage, UseChatResult } from "#veryfront/agent/react";
import { useConversationsContextOptional } from "../contexts/conversations-context.tsx";
import {
  createEmptyConversation,
  DEFAULT_CONVERSATION_TITLE,
  deriveTitle,
} from "./use-conversations.ts";
import type { Conversation } from "../persistence/conversation-store.ts";

/**
 * `useConversationChat` — the library primitive that binds a `useChat` session
 * to conversation persistence, so **application code never writes the
 * persistence `useEffect` itself** (composition-patterns §2.3 "lift state into a
 * provider/hook", not "sync state up with an effect").
 *
 * Inside a `ConversationsProvider` it seeds the session from the active
 * conversation and saves changes back to the store; standalone, an explicit
 * `onUpdate` sink persists to a single minted record; with neither, the chat is
 * ephemeral. The persist bridge lives here — one implementation shared by the
 * batteries `<Chat>` and any composed chat — instead of being copy-pasted into
 * every consuming app.
 *
 * Behaviour (must match the pre-extraction `UncontrolledChat`):
 * - **Seed on open** from `bound.messages` (provider) or `initialMessages`.
 * - **No re-save on open** — the sink is seeded with the mount-time messages, so
 *   merely opening a thread never bumps `updatedAt`.
 * - **Sink resolution** `onUpdate ?? provider.save ?? ephemeral`.
 * - **Whole-conversation emit** on a real `messages` change (title derived only
 *   when the base title is empty/default), keyed on `[messages, boundId]` with
 *   sink/identity read via refs so the save→setActive round-trip can't loop.
 *
 * @module react/components/chat/chat/hooks/use-conversation-chat
 */
export interface UseConversationChatOptions {
  /** AG-UI endpoint the session streams from. Default `/api/ag-ui`. */
  api?: string;
  /** Agent to drive the session (overridden by the bound conversation's agent). */
  agentId?: string;
  /** Seed messages when standalone (no bound conversation). */
  initialMessages?: ChatMessage[];
  /** Surfaced from the underlying `useChat`. */
  onError?: (error: Error) => void;
  /**
   * Explicit persistence sink — receives the whole updated `Conversation`.
   * Wins over a surrounding `ConversationsProvider`'s `save`. Omit both for an
   * ephemeral (unsaved) session.
   */
  onUpdate?: (conversation: Conversation) => void;
}

export interface UseConversationChatResult {
  /** The live `useChat` session (seeded + persistence-bridged). */
  chat: UseChatResult;
  /** The bound conversation from a surrounding provider, or `null` standalone. */
  bound: Conversation | null;
  /** The agent id actually driving the session (`bound?.agentId ?? agentId`). */
  resolvedAgentId: string | undefined;
}

export function useConversationChat(
  options: UseConversationChatOptions = {},
): UseConversationChatResult {
  const { api = "/api/ag-ui", agentId, initialMessages, onError, onUpdate } = options;

  // Inside a `ConversationsProvider`, bind to the active conversation — seed
  // from its messages/agent and persist changes back. No provider: standalone.
  // `active` must match `activeId` so we never seed from a still-loading thread.
  const conversations = useConversationsContextOptional();
  const bound = conversations?.active && conversations.active.id === conversations.activeId
    ? conversations.active
    : null;
  const resolvedAgentId = bound?.agentId ?? agentId;

  const chat = useChat({
    api,
    initialMessages: conversations ? (bound?.messages ?? []) : initialMessages,
    onError,
    body: resolvedAgentId ? { agentId: resolvedAgentId } : undefined,
  });

  // Sink resolution: explicit prop → provider default → ephemeral.
  const persist = onUpdate ?? conversations?.save;

  const syntheticRef = React.useRef<Conversation | null>(null);
  const persistRef = React.useRef(persist);
  persistRef.current = persist;
  const boundRef = React.useRef(bound);
  boundRef.current = bound;
  const agentIdRef = React.useRef(resolvedAgentId);
  agentIdRef.current = resolvedAgentId;

  const boundId = bound?.id;
  const lastEmittedRef = React.useRef<ChatMessage[] | null>(null);
  if (lastEmittedRef.current === null) lastEmittedRef.current = chat.messages;
  const sessionKey = conversations
    ? bound ? `conversation:${bound.id}` : `pending:${conversations.activeId ?? ""}`
    : "standalone";
  const currentSessionKeyRef = React.useRef(sessionKey);
  const pendingSessionRef = React.useRef<
    {
      key: string;
      messages: ChatMessage[];
    } | null
  >(null);

  React.useEffect(() => {
    if (currentSessionKeyRef.current === sessionKey) return;

    const messages = bound?.messages ?? (conversations ? [] : initialMessages ?? []);
    pendingSessionRef.current = { key: sessionKey, messages };
    lastEmittedRef.current = messages;
    chat.stop();
    chat.setMessages(messages);
  }, [sessionKey]);

  React.useEffect(() => {
    const pendingSession = pendingSessionRef.current;
    if (pendingSession) {
      if (chat.messages !== pendingSession.messages) return;
      currentSessionKeyRef.current = pendingSession.key;
      pendingSessionRef.current = null;
      lastEmittedRef.current = chat.messages;
      return;
    }
    if (currentSessionKeyRef.current !== sessionKey) return;
    if (conversations && !bound) return;

    const sink = persistRef.current;
    if (!sink) return;
    if (chat.messages === lastEmittedRef.current) return;
    lastEmittedRef.current = chat.messages;
    let base = boundRef.current;
    if (!base) {
      syntheticRef.current ??= createEmptyConversation({ agentId: agentIdRef.current });
      base = syntheticRef.current;
    }
    const keepTitle = base.title !== "" && base.title !== DEFAULT_CONVERSATION_TITLE;
    const title = keepTitle ? base.title : (deriveTitle(chat.messages) || base.title);
    const conversation: Conversation = {
      ...base,
      messages: chat.messages,
      title,
      updatedAt: Date.now(),
    };
    // Fold the derived title back onto the synthetic identity so later emits
    // don't re-derive it every keystroke of a streamed reply.
    if (base === syntheticRef.current) syntheticRef.current = conversation;
    sink(conversation);
  }, [chat.messages, boundId]);

  return { chat, bound, resolvedAgentId };
}
