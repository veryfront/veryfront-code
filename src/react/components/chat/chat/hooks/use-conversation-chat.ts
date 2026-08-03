import * as React from "react";
import type { ChatMessage, UseChatResult } from "#veryfront/agent/react";
import { useChatWithSessionReset } from "#veryfront/agent/react/use-chat/use-chat.ts";
import { useConversationsContextOptional } from "../contexts/conversations-context.tsx";
import {
  createEmptyConversation,
  DEFAULT_CONVERSATION_TITLE,
  deriveTitle,
} from "./use-conversations.ts";
import type { Conversation } from "../persistence/conversation-store.ts";

const useIsomorphicLayoutEffect = typeof document !== "undefined"
  ? React.useLayoutEffect
  : React.useEffect;

/**
 * `useConversationChat` — the library primitive that binds a `useChat` session
 * to conversation persistence, so application code does not need to duplicate
 * the persistence effect.
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

/** Result returned by {@link useConversationChat}. */
export interface UseConversationChatResult {
  /** The live `useChat` session (seeded + persistence-bridged). */
  chat: UseChatResult;
  /** The bound conversation from a surrounding provider, or `null` standalone. */
  bound: Conversation | null;
  /** The agent id actually driving the session (`bound?.agentId ?? agentId`). */
  resolvedAgentId: string | undefined;
}

/** Bind the active conversation to an isolated chat session and persistence sink. */
export function useConversationChat(
  options: UseConversationChatOptions = {},
): UseConversationChatResult {
  const { api = "/api/ag-ui", agentId, initialMessages, onError, onUpdate } = options;

  // Inside a `ConversationsProvider`, bind to the active conversation — seed
  // from its messages/agent and persist changes back. No provider: standalone.
  // The active conversation must match its id so we never seed from a still-loading thread.
  const conversations = useConversationsContextOptional();
  const bound = conversations?.activeConversation &&
      conversations.activeConversation.id === conversations.activeConversationId
    ? conversations.activeConversation
    : null;
  const isConversationPending = conversations !== null &&
    bound === null &&
    (conversations.isLoading || conversations.activeConversationId !== null);
  const resolvedAgentId = bound?.agentId ?? agentId;
  const emptyMessagesRef = React.useRef<ChatMessage[]>([]);
  const sessionMessages = bound?.messages ??
    (isConversationPending
      ? emptyMessagesRef.current
      : initialMessages ?? emptyMessagesRef.current);

  const resettableChat = useChatWithSessionReset({
    api,
    initialMessages: sessionMessages,
    onError,
    body: resolvedAgentId ? { agentId: resolvedAgentId } : undefined,
  });
  const { reset: resetChatSession, ...chat } = resettableChat;

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
  const sessionKey = bound
    ? `conversation:${bound.id}`
    : isConversationPending
    ? `pending:${conversations.activeConversationId}`
    : conversations
    ? "provider:unbound"
    : "standalone";
  const currentSessionKeyRef = React.useRef(sessionKey);
  const currentSessionEpochRef = React.useRef(0);
  const resetEpochRef = React.useRef(0);
  const [committedResetEpoch, setCommittedResetEpoch] = React.useState(0);
  const pendingSessionRef = React.useRef<
    {
      key: string;
      messages: ChatMessage[];
      epoch: number;
    } | null
  >(null);

  useIsomorphicLayoutEffect(() => {
    if (
      currentSessionKeyRef.current === sessionKey &&
      pendingSessionRef.current === null
    ) return;

    syntheticRef.current = null;
    const epoch = ++resetEpochRef.current;
    pendingSessionRef.current = { key: sessionKey, messages: sessionMessages, epoch };
    lastEmittedRef.current = sessionMessages;
    resetChatSession(sessionMessages);
    setCommittedResetEpoch(epoch);
  }, [sessionKey]);

  useIsomorphicLayoutEffect(() => {
    const pendingSession = pendingSessionRef.current;
    if (!pendingSession || committedResetEpoch < pendingSession.epoch) return;

    currentSessionKeyRef.current = pendingSession.key;
    currentSessionEpochRef.current = pendingSession.epoch;
    pendingSessionRef.current = null;
    lastEmittedRef.current = chat.messages === pendingSession.messages
      ? chat.messages
      : pendingSession.messages;
  }, [committedResetEpoch]);

  React.useEffect(() => {
    if (currentSessionKeyRef.current !== sessionKey) return;
    if (pendingSessionRef.current !== null) return;
    if (isConversationPending) return;

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
    if (agentIdRef.current) conversation.agentId = agentIdRef.current;
    else delete conversation.agentId;
    // Fold synthetic records back so later updates retain their identity and title.
    if (base === syntheticRef.current) syntheticRef.current = conversation;
    sink(conversation);
  }, [chat.messages, boundId, committedResetEpoch, sessionKey]);

  const renderedSessionEpoch = committedResetEpoch;
  const canUseSession = () =>
    !isConversationPending &&
    currentSessionKeyRef.current === sessionKey &&
    currentSessionEpochRef.current === renderedSessionEpoch &&
    pendingSessionRef.current === null;
  const sessionReady = canUseSession();
  const guardedSetInput = (value: string) => {
    if (canUseSession()) chat.setInput(value);
  };
  const guardedSetModel = (value: string | undefined) => {
    if (canUseSession()) chat.setModel(value);
  };
  const guardedInputChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (canUseSession()) chat.handleInputChange(event);
  };
  const guardedSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();
    return canUseSession() ? chat.handleSubmit() : Promise.resolve();
  };

  // Every action is bound to the session from the render that produced it.
  // Retained callbacks from an old conversation therefore cannot mutate the
  // newly active one, even after its reset has committed.
  const sessionChat: UseChatResult = {
    ...chat,
    ...(sessionReady ? {} : {
      messages: sessionMessages,
      input: "",
      isLoading: false,
      status: "ready" as const,
      streamingMessageId: null,
      error: null,
      model: undefined,
      data: null,
      activeModel: undefined,
      inferenceMode: "cloud" as const,
    }),
    setInput: guardedSetInput,
    setModel: guardedSetModel,
    sendMessage: (message) => canUseSession() ? chat.sendMessage(message) : Promise.resolve(),
    editMessage: (messageId, newText) =>
      canUseSession() ? chat.editMessage(messageId, newText) : Promise.resolve(),
    getBranches: (messageId) =>
      canUseSession() ? chat.getBranches(messageId) : { current: 1, total: 1 },
    switchBranch: (messageId, branchIndex) => {
      if (canUseSession()) chat.switchBranch(messageId, branchIndex);
    },
    reload: () => canUseSession() ? chat.reload() : Promise.resolve(),
    stop: () => {
      if (canUseSession()) chat.stop();
    },
    setMessages: (messages) => {
      if (canUseSession()) chat.setMessages(messages);
    },
    addToolOutput: (output) => {
      if (canUseSession()) chat.addToolOutput(output);
    },
    handleInputChange: guardedInputChange,
    handleSubmit: guardedSubmit,
  };

  return { chat: sessionChat, bound, resolvedAgentId };
}
