import * as React from "react";
import type { UseChatResult } from "#veryfront/agent/react";
import { defaultChatTheme, mergeThemes } from "../theme.ts";
import { useUpload } from "./hooks/use-upload.ts";
import { attachmentsToFileParts, hasPendingAttachments } from "./chat-attachments.ts";

// Composition imports (used in the Chat preset)
import { ChatRoot } from "./composition/chat-root.tsx";
import { ChatInput } from "./composition/chat-composer.tsx";
import { ChatMessageList } from "./composition/chat-message-list.tsx";
import { ChatEmpty } from "./composition/chat-empty.tsx";
import { ErrorBanner } from "./composition/error-banner.tsx";
import { ChatMessagesSkeleton } from "./components/chat-messages-skeleton.tsx";
import { ConversationScrollButton } from "./components/empty-state.tsx";
import { InferenceBadge } from "./components/inference-badge.tsx";
import type { ChatProps } from "./chat-props.ts";

// ---------------------------------------------------------------------------
// Chat — Preset component
//
// Composes ChatRoot, ChatMessageList, ChatInput, ChatEmpty, etc. into a
// full-featured chat UI with sensible defaults. For custom layouts, use the
// building blocks directly.
// ---------------------------------------------------------------------------

interface ControlledChatProps extends Omit<ChatProps, "chat"> {
  chat: UseChatResult;
  /** App mode can replace the session submit to fold in managed attachments. */
  submit?: (e?: React.FormEvent) => void | Promise<void>;
}
/** Render the controlled chat from one complete session object. */
export function ControlledChat(
  {
    chat,
    submit,
    placeholder = "Type a message...",
    maxHeight = "100%",
    className,
    theme: userTheme,
    renderMessage,
    suggestions: suggestionsProp,
    onSuggestionClick,
    emptyState,
    initializing = false,
    skeleton,
    agent,
    onSourceClick,
    uploadApi,
    onAttach,
    onSelectAttachment,
    onDrop,
    attachAccept,
    attachments,
    onRemoveAttachment,
    onFeedback,
    toolbarStart,
    children,
    ref,
  }: ControlledChatProps,
): React.ReactElement {
  const {
    activeModel,
    editMessage,
    error,
    getBranches,
    handleInputChange: onChange,
    handleSubmit: sessionSubmit,
    inferenceMode,
    input,
    isLoading,
    messages,
    model,
    reload,
    sendMessage,
    setInput,
    setModel: onModelChange,
    status,
    stop,
    streamingMessageId,
    switchBranch,
  } = chat;
  const onSubmit = submit ?? sessionSubmit;
  const models = agent?.models;
  const suggestions = suggestionsProp ?? agent?.suggestions;
  const theme = React.useMemo(
    () => mergeThemes(defaultChatTheme, userTheme),
    [
      userTheme,
    ],
  );

  // --- Attachments (batteries-included) ---
  // The composer's `+` menu and drag-to-attach are on by default: when the
  // caller wires none of the attachment props, `<Chat>` manages the pending
  // files itself so `<Chat />` "just works". Pass any attachment prop to take
  // control, or compose `ChatInput` without its Attach leaf to omit it.
  const isAttachControlled = onAttach !== undefined ||
    onDrop !== undefined ||
    attachments !== undefined ||
    onRemoveAttachment !== undefined ||
    onSelectAttachment !== undefined;
  // When the caller wires no attachment props, `<Chat>` self-manages pending
  // files through `useUpload` — the SAME hook app-mode uses — so drag/`+`
  // uploads get an instant thumbnail (`preview`) and a resolved `url` (base64
  // `data:` by default, or a durable POST when `uploadApi` is set). The old
  // path only recorded name/size, so pills had no preview and never sent.
  const upload = useUpload({ api: uploadApi });
  const manageAttachments = !isAttachControlled;

  const effectiveOnAttach = isAttachControlled ? onAttach : upload.upload;
  const effectiveOnDrop = isAttachControlled ? onDrop : upload.upload;
  const effectiveAttachments = isAttachControlled ? attachments : upload.attachments;
  const effectiveOnRemove = isAttachControlled ? onRemoveAttachment : upload.remove;

  // Attachments must ride along on submit in both managed and controlled mode.
  // The session's `handleSubmit` only carries text, so any resolved files use
  // `sendMessage({ text, files })` and the text-only path delegates normally.
  const handleSubmit = React.useCallback((e?: React.FormEvent) => {
    const submittedAttachments = effectiveAttachments ?? [];
    // Wait for pending uploads: sending now would carry only the resolved
    // files and silently drop the one still in flight.
    if (hasPendingAttachments(submittedAttachments)) {
      e?.preventDefault();
      return;
    }
    const files = attachmentsToFileParts(submittedAttachments);
    if (files.length > 0) {
      e?.preventDefault();
      void sendMessage({ text: input.trim(), files });
      setInput("");
      if (manageAttachments) upload.clear();
      else {
        for (const attachment of submittedAttachments) {
          if (attachment.url) effectiveOnRemove?.(attachment.id);
        }
      }
      return;
    }
    void onSubmit(e);
  }, [
    effectiveAttachments,
    sendMessage,
    input,
    setInput,
    manageAttachments,
    upload,
    effectiveOnRemove,
    onSubmit,
  ]);

  const isEmpty = messages.length === 0;

  return (
    <ChatRoot
      ref={ref}
      messages={messages}
      input={input}
      isLoading={isLoading}
      status={status}
      streamingMessageId={streamingMessageId}
      error={error}
      setInput={setInput}
      onSubmit={handleSubmit}
      onStop={stop}
      onReload={reload}
      model={model}
      models={models}
      onModelChange={onModelChange}
      agent={agent}
      attachments={effectiveAttachments}
      onAttach={effectiveOnAttach}
      onRemoveAttachment={effectiveOnRemove}
      editMessage={editMessage}
      getBranches={getBranches}
      switchBranch={switchBranch}
      onFeedback={onFeedback}
      onSourceClick={onSourceClick}
      theme={userTheme}
      maxHeight={maxHeight}
      className={className}
    >
      {isEmpty && (isLoading || initializing)
        // Thread still loading its history (or agent metadata still
        // resolving) → skeleton, not an idle placeholder.
        ? (skeleton ?? <ChatMessagesSkeleton />)
        : isEmpty && emptyState
        // Idle hero is opt-in: only rendered when the consumer supplies an
        // `emptyState`. Otherwise an empty thread is just a blank canvas +
        // composer — no "What can I help with?" placeholder.
        ? (
          <ChatEmpty
            icon={emptyState.icon}
            title={emptyState.title}
            description={emptyState.description}
            suggestions={suggestions}
            onSuggestionClick={onSuggestionClick}
          />
        )
        : (
          <ChatMessageList
            messages={messages}
            isLoading={isLoading}
            theme={theme}
            renderMessage={renderMessage}
            model={activeModel || model}
            renderScrollButton={({ onClick, isAtBottom }) => (
              <ConversationScrollButton onClick={onClick} visible={!isAtBottom} />
            )}
            onSourceClick={onSourceClick}
            inferenceMode={inferenceMode}
            editMessage={editMessage}
            getBranches={getBranches}
            switchBranch={switchBranch}
            onFeedback={onFeedback}
          />
        )}

      {error && <ErrorBanner error={error} onRetry={reload} />}

      <ChatInput
        input={input}
        onChange={onChange}
        onSubmit={handleSubmit}
        isLoading={isLoading}
        placeholder={placeholder}
        theme={theme}
        stop={stop}
        models={models}
        model={model}
        onModelChange={onModelChange}
        onAttach={effectiveOnAttach}
        onSelectAttachment={onSelectAttachment}
        onDrop={effectiveOnDrop}
        attachAccept={attachAccept}
        attachments={effectiveAttachments}
        onRemoveAttachment={effectiveOnRemove}
        toolbarStart={toolbarStart}
      >
        {inferenceMode && inferenceMode !== "cloud" && (
          <InferenceBadge inferenceMode={inferenceMode} />
        )}
      </ChatInput>

      {children}
    </ChatRoot>
  );
}
ControlledChat.displayName = "ControlledChat";
