import * as React from "react";
import { useChat } from "#veryfront/agent/react";
import type { ChatMessage } from "#veryfront/agent/react";
import { useAgentMetadata } from "#veryfront/agent/react/use-agent-metadata.ts";
import type { AgentMetadata } from "#veryfront/agent/react/use-agent-metadata.ts";
import { AgentAvatar } from "./composition/agent-avatar.tsx";
import { ChatMessagesSkeleton } from "./components/chat-messages-skeleton.tsx";
import { useUpload } from "./hooks/use-upload.ts";
import { useConversationsContextOptional } from "./contexts/conversations-context.tsx";
import {
  createEmptyConversation,
  DEFAULT_CONVERSATION_TITLE,
  deriveTitle,
} from "./hooks/use-conversations.ts";
import type { Conversation } from "./persistence/conversation-store.ts";
import type { ChatProps } from "./chat-props.ts";
import {
  attachmentsToFileParts,
  ControlledChat,
  hasPendingAttachments,
} from "./controlled-chat.tsx";

// ---------------------------------------------------------------------------
// UncontrolledChat — "app mode": self-drives useChat + useAgentMetadata so the
// consumer writes only `<Chat agentId="…" api="…" />`.
// ---------------------------------------------------------------------------

interface AgentSuggestionItem {
  /** Short chip label — the agent's `title`, falling back to the prompt. */
  label: string;
  /** Full text sent to the agent when the chip is clicked. */
  prompt: string;
}

/**
 * Map agent-metadata suggestions to `{ label, prompt }`. The chip shows the
 * short `title` ("Triage login issue") while the click sends the full `prompt`
 * ("Triage a customer who cannot sign in after a release.") — so the empty
 * state stays scannable without truncating what the agent actually receives.
 */
function agentSuggestionItems(
  suggestions: AgentMetadata["suggestions"] | undefined,
): AgentSuggestionItem[] {
  const list = suggestions?.suggestions;
  if (!Array.isArray(list)) return [];
  return list.flatMap((s) => {
    if (s.type !== "prompt" || !("prompt" in s) || !s.prompt) return [];
    const title = (s as { title?: unknown }).title;
    const label = typeof title === "string" && title.length > 0 ? title : s.prompt;
    return [{ label, prompt: s.prompt }];
  });
}

function UncontrolledChat(
  {
    agentId,
    api = "/api/ag-ui",
    initialMessages,
    onError,
    onUpdate,
    models,
    suggestions: suggestionsProp,
    onSuggestionClick,
    emptyState,
    // App mode defaults the scroll-to-bottom button on (batteries-included).
    showScrollButton = true,
    // Attachments: default-wired through `useUpload` unless the caller
    // controls them. With no `uploadApi`, files inline as base64 `data:` URLs
    // (guest mode — zero backend). Set `uploadApi` to POST to a durable
    // upload endpoint (multipart `file` → `{ url }`) for real users + a project.
    uploadApi,
    enableAttachments = true,
    onAttach: userOnAttach,
    onDrop: userOnDrop,
    attachments: userAttachments,
    onRemoveAttachment: userOnRemoveAttachment,
    onSubmit: userOnSubmit,
    ref,
    ...rest
  }: ChatProps,
): React.ReactElement {
  // Inside a `ConversationsProvider`, bind to the active conversation — seed
  // from its messages/agent and persist changes back. No props: the context
  // carries it, so standalone `<Chat>` (no provider) is unchanged. `active`
  // must match `activeId` so we never seed from a still-loading thread.
  const conversations = useConversationsContextOptional();
  const bound = conversations?.active && conversations.active.id === conversations.activeId
    ? conversations.active
    : null;
  const resolvedAgentId = bound?.agentId ?? agentId;

  const chat = useChat({
    api,
    initialMessages: bound ? bound.messages : initialMessages,
    onError,
    body: resolvedAgentId ? { agentId: resolvedAgentId } : undefined,
  });
  const { agent, error: agentError } = useAgentMetadata(resolvedAgentId);

  // --- Persistence sink (explicit prop → provider default → ephemeral) ------
  // Resolve WHERE the live thread persists: an explicit `onUpdate` wins, else
  // a surrounding `ConversationsProvider`'s `save`, else nothing. The sink
  // takes the whole updated conversation; `<Chat>` owns building it (title
  // included) so `useConversations` stays dumb about titling and `useChat`
  // never touches the store.
  const persist = onUpdate ?? conversations?.save;

  // Identity for the emitted conversation: in a provider we ride the bound
  // conversation (id/agentId/createdAt); standalone (explicit `onUpdate`, no
  // provider) we mint one stable id so updates target a single record.
  const syntheticRef = React.useRef<Conversation | null>(null);
  const persistRef = React.useRef(persist);
  persistRef.current = persist;
  const boundRef = React.useRef(bound);
  boundRef.current = bound;
  const agentIdRef = React.useRef(resolvedAgentId);
  agentIdRef.current = resolvedAgentId;

  // Emit the whole conversation when the live messages change. Keyed on
  // `chat.messages` + `boundId` only (sink/identity read via refs) so the
  // save→setActive round-trip inside a provider can't feed a render loop.
  // Seeded with the mount-time messages so merely *opening* a thread never
  // re-saves it (a fresh `updatedAt` would jump it to the top of the sidebar).
  const boundId = bound?.id;
  const lastEmittedRef = React.useRef<ChatMessage[] | null>(null);
  if (lastEmittedRef.current === null) lastEmittedRef.current = chat.messages;
  React.useEffect(() => {
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

  // App mode owns the loading signal: from the very first paint until the
  // agent resolves (or errors) we render the skeleton — never flash an idle
  // placeholder first. Keyed off "agent not yet here" rather than the hook's
  // `isLoading` flag so there's no one-frame gap on mount. Works out of the
  // box — no `isLoading` wiring from the consumer.
  const agentInitializing = Boolean(resolvedAgentId) && !agent && !agentError;

  // Agent-driven empty state: avatar + name + description, shown once the
  // agent resolves (the skeleton covers the load, so the generic
  // "What can I help with?" placeholder never flashes). A consumer-supplied
  // `emptyState` still wins.
  const derivedEmptyState = React.useMemo(() => {
    if (emptyState) return emptyState;
    if (!agent) return undefined;
    return {
      icon: (
        <AgentAvatar
          name={agent.name}
          avatarUrl={agent.avatarUrl ?? undefined}
          className="size-12"
        />
      ),
      title: agent.name,
      description: agent.description ?? undefined,
    };
  }, [emptyState, agent]);

  // Chips show the short `title`; the click sends the full `prompt`.
  const suggestionItems = React.useMemo(
    () => agentSuggestionItems(agent?.suggestions),
    [agent],
  );
  const derivedSuggestions = suggestionsProp ??
    (suggestionItems.length > 0 ? suggestionItems.map((s) => s.label) : undefined);

  const handleSuggestion = onSuggestionClick ??
    ((label: string) => {
      const item = suggestionItems.find((s) => s.label === label);
      void chat.sendMessage({ text: item?.prompt ?? label });
    });

  // Batteries-included attachments: unless the caller controls them, files
  // uploaded via the `+` menu / drag land here, ride along on submit as
  // `file` parts, and clear once sent.
  const upload = useUpload({ api: uploadApi });
  const attachControlled = userOnAttach !== undefined ||
    userOnDrop !== undefined ||
    userAttachments !== undefined ||
    userOnRemoveAttachment !== undefined;
  const manageAttachments = enableAttachments && !attachControlled;

  const submitWithAttachments = React.useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    if (chat.isLoading) return;
    // Never send while a file is still uploading: the fold below only
    // carries resolved urls, so submitting now would silently drop the
    // pending attachment (and `clear()` would abort its upload).
    if (hasPendingAttachments(upload.attachments)) return;
    const text = chat.input.trim();
    const files = attachmentsToFileParts(upload.attachments);
    if (!text && files.length === 0) return;
    chat.setInput("");
    upload.clear();
    void chat.sendMessage({ text, files });
  }, [chat, upload]);

  return (
    <ControlledChat
      ref={ref}
      messages={chat.messages}
      input={chat.input}
      onChange={chat.onChange}
      onSubmit={manageAttachments ? submitWithAttachments : (userOnSubmit ?? chat.onSubmit)}
      stop={chat.stop}
      reload={() => void chat.reload()}
      setInput={chat.setInput}
      isLoading={chat.isLoading}
      error={chat.error}
      model={chat.model}
      activeModel={chat.activeModel}
      onModelChange={chat.onModelChange}
      inferenceMode={chat.inferenceMode}
      models={models}
      editMessage={chat.editMessage}
      getBranches={chat.getBranches}
      switchBranch={chat.switchBranch}
      emptyState={derivedEmptyState}
      agent={agent ? { name: agent.name, avatarUrl: agent.avatarUrl ?? undefined } : undefined}
      initializing={agentInitializing}
      suggestions={derivedSuggestions}
      onSuggestionClick={handleSuggestion}
      showScrollButton={showScrollButton}
      enableAttachments={enableAttachments}
      onAttach={manageAttachments ? upload.upload : userOnAttach}
      onDrop={manageAttachments ? upload.upload : userOnDrop}
      attachments={manageAttachments ? upload.attachments : userAttachments}
      onRemoveAttachment={manageAttachments ? upload.remove : userOnRemoveAttachment}
      {...rest}
    />
  );
}
UncontrolledChat.displayName = "UncontrolledChat";

/**
 * App-mode `<Chat>` with conversation-thread lifecycle when a
 * `ConversationsProvider` is present: keys by the active id so switching threads
 * remounts `UncontrolledChat` (fresh `useChat` seed), and holds the skeleton
 * while the active thread's messages load from the store. No provider → renders
 * `UncontrolledChat` unchanged.
 */
export function ConversationBoundChat(props: ChatProps): React.ReactElement {
  const conversations = useConversationsContextOptional();
  if (!conversations || conversations.activeId == null) {
    return <UncontrolledChat ref={props.ref} {...props} />;
  }
  const { active, activeId } = conversations;
  // Wait for the active thread's messages before mounting, so `useChat` seeds
  // from the right thread rather than a still-loading one.
  if (active?.id !== activeId) {
    return <>{props.skeleton ?? <ChatMessagesSkeleton />}</>;
  }
  return <UncontrolledChat key={activeId} ref={props.ref} {...props} />;
}
ConversationBoundChat.displayName = "ConversationBoundChat";
