import * as React from "react";
import {
  getAgentPromptSuggestionItems,
  useAgentMetadata,
} from "#veryfront/agent/react/use-agent-metadata.ts";
import type { PromptSuggestion } from "#veryfront/agent/react/use-agent-metadata.ts";
import { AgentAvatar } from "./composition/agent-avatar.tsx";
import { ChatMessagesSkeleton } from "./components/chat-messages-skeleton.tsx";
import { useUpload } from "./hooks/use-upload.ts";
import { useConversationsContextOptional } from "./contexts/conversations-context.tsx";
import { useConversationChat } from "./hooks/use-conversation-chat.ts";
import type { ChatProps } from "./chat-props.ts";
import { ControlledChat } from "./controlled-chat.tsx";
import { attachmentsToFileParts, hasPendingAttachments } from "./chat-attachments.ts";

// ---------------------------------------------------------------------------
// UncontrolledChat — "app mode": self-drives useChat + useAgentMetadata so the
// consumer writes only `<Chat agentId="…" api="…" />`.
// ---------------------------------------------------------------------------

function UncontrolledChat(
  {
    agentId,
    api = "/api/ag-ui",
    initialMessages,
    onError,
    onUpdate,
    agent: userAgent,
    suggestions: suggestionsProp,
    onSuggestionClick,
    onSuggestionSelect,
    emptyState,
    // Attachments: default-wired through `useUpload` unless the caller
    // controls them. With no `uploadApi`, files inline as base64 `data:` URLs
    // (guest mode — zero backend). Set `uploadApi` to POST to a durable
    // upload endpoint (multipart `file` → `{ url }`) for real users + a project.
    uploadApi,
    onAttach: userOnAttach,
    onDrop: userOnDrop,
    attachments: userAttachments,
    onRemoveAttachment: userOnRemoveAttachment,
    ref,
    ...rest
  }: ChatProps,
): React.ReactElement {
  // Seed + persistence are the library's job, not app code's: `useConversationChat`
  // does `useChat` + conversation seeding + the persist bridge internally. This
  // component stays a presenter of the resulting session.
  const { chat, resolvedAgentId } = useConversationChat({
    api,
    agentId,
    initialMessages,
    onError,
    onUpdate,
  });
  const { agent, error: agentError } = useAgentMetadata(resolvedAgentId);

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
    () => getAgentPromptSuggestionItems(agent),
    [agent],
  );
  const derivedSuggestions = suggestionsProp ??
    (suggestionItems.length > 0 ? suggestionItems : undefined);

  const resolvedAgent = agent || userAgent
    ? {
      ...(agent
        ? {
          name: agent.name,
          avatarUrl: agent.avatarUrl ?? undefined,
          description: agent.description ?? undefined,
        }
        : {}),
      ...userAgent,
    }
    : undefined;

  const handleSuggestionSelect = onSuggestionSelect ??
    (onSuggestionClick ? undefined : (suggestion: PromptSuggestion) => {
      void chat.sendMessage({ text: suggestion.prompt });
    });

  // Batteries-included attachments: unless the caller controls them, files
  // uploaded via the `+` menu / drag land here, ride along on submit as
  // `file` parts, and clear once sent.
  const upload = useUpload({ api: uploadApi });
  const attachControlled = userOnAttach !== undefined ||
    userOnDrop !== undefined ||
    userAttachments !== undefined ||
    userOnRemoveAttachment !== undefined;
  const manageAttachments = !attachControlled;

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
      {...rest}
      ref={ref}
      chat={chat}
      submit={manageAttachments ? submitWithAttachments : chat.handleSubmit}
      emptyState={derivedEmptyState}
      agent={resolvedAgent}
      initializing={agentInitializing}
      suggestions={derivedSuggestions}
      onSuggestionClick={onSuggestionClick}
      onSuggestionSelect={handleSuggestionSelect}
      onAttach={manageAttachments ? upload.upload : userOnAttach}
      onDrop={manageAttachments ? upload.upload : userOnDrop}
      attachments={manageAttachments ? upload.attachments : userAttachments}
      onRemoveAttachment={manageAttachments ? upload.remove : userOnRemoveAttachment}
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
  if (!conversations || conversations.activeConversationId == null) {
    return <UncontrolledChat ref={props.ref} {...props} />;
  }
  const { activeConversation, activeConversationId } = conversations;
  // Wait for the active thread's messages before mounting, so `useChat` seeds
  // from the right thread rather than a still-loading one.
  if (activeConversation?.id !== activeConversationId) {
    return <>{props.skeleton ?? <ChatMessagesSkeleton />}</>;
  }
  return <UncontrolledChat key={activeConversationId} ref={props.ref} {...props} />;
}
ConversationBoundChat.displayName = "ConversationBoundChat";
