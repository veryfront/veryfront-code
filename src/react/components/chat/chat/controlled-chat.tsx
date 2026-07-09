import * as React from "react";
import { useVoiceInput } from "#veryfront/agent/react";
import type { ChatFilePart } from "#veryfront/agent/react";
import { defaultChatTheme, mergeThemes } from "../theme.ts";
import type { AttachmentInfo } from "./components/attachment-pill.tsx";
import { useUpload } from "./hooks/use-upload.ts";
import type { ChatTab } from "./components/tab-switcher.tsx";

// Composition imports (used in the Chat preset)
import { ChatRoot } from "./composition/chat-root.tsx";
import { ChatInput } from "./composition/chat-composer.tsx";
import { ChatMessageList } from "./composition/chat-message-list.tsx";
import { ChatEmpty } from "./composition/chat-empty.tsx";
import { ErrorBanner } from "./composition/error-banner.tsx";
import { ChatMessagesSkeleton } from "./components/chat-messages-skeleton.tsx";
import { TabSwitcher } from "./components/tab-switcher.tsx";
import { AttachmentsPanel } from "./components/attachments-panel.tsx";
import { InferenceBadge } from "./components/inference-badge.tsx";
import { QuickActions as QuickActionsComponent } from "./components/quick-actions.tsx";
import type { ChatProps } from "./chat-props.ts";

// ---------------------------------------------------------------------------
// Chat — Preset component
//
// Composes ChatRoot, ChatMessageList, ChatInput, ChatEmpty, etc. into a
// full-featured chat UI with sensible defaults. For custom layouts, use the
// building blocks directly.
// ---------------------------------------------------------------------------

/** Render the controlled chat (caller supplies `messages`/`input`). */
export function ControlledChat(
  {
    messages = [],
    input = "",
    onChange = () => {},
    onSubmit,
    sendMessage,
    stop,
    reload,
    enableVoice = false,
    onVoice,
    setInput,
    isLoading,
    error,
    placeholder = "Type a message...",
    maxHeight = "100%",
    className,
    theme: userTheme,
    renderMessage,
    renderTool,
    suggestions,
    onSuggestionClick,
    emptyState,
    initializing = false,
    skeleton,
    agent,
    showScrollButton = false,
    showMessageActions = true,
    models,
    model,
    activeModel,
    onModelChange,
    inferenceMode,
    showSources = false,
    onSourceClick,
    enableAttachments = true,
    uploadApi,
    onAttach,
    onSelectAttachment,
    onDrop,
    attachAccept,
    attachments,
    onRemoveAttachment,
    showExport = false,
    onFeedback,
    editMessage,
    getBranches,
    switchBranch,
    showSteps = false,
    showTabs = false,
    activeTab: controlledTab,
    onTabChange: controlledTabChange,
    uploads,
    onRemoveUpload,
    quickActions,
    onQuickAction,
    toolbarStart,
    hideTabSwitcher = false,
    children,
    ref,
  }: ChatProps,
): React.ReactElement {
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
  // control; pass `enableAttachments={false}` to hide the control entirely.
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
  const manageAttachments = enableAttachments && !isAttachControlled;

  const effectiveOnAttach = !enableAttachments
    ? undefined
    : isAttachControlled
    ? onAttach
    : upload.upload;
  const effectiveOnDrop = !enableAttachments
    ? undefined
    : isAttachControlled
    ? onDrop
    : upload.upload;
  const effectiveAttachments = isAttachControlled ? attachments : upload.attachments;
  const effectiveOnRemove = !enableAttachments
    ? undefined
    : isAttachControlled
    ? onRemoveAttachment
    : upload.remove;

  // Self-managed attachments must ride along on submit: the caller's
  // `onSubmit` only carries the input text, so fold the uploaded files into
  // `sendMessage({ text, files })` (then clear). Falls back to `onSubmit` for
  // a text-only turn, when the caller controls attachments, or when no
  // `sendMessage` is available.
  const handleSubmit = React.useCallback((e?: React.FormEvent) => {
    if (manageAttachments && sendMessage) {
      // Wait for pending uploads: sending now would carry only the resolved
      // files and silently drop the one still in flight.
      if (hasPendingAttachments(upload.attachments)) {
        e?.preventDefault();
        return;
      }
      const files = attachmentsToFileParts(upload.attachments);
      if (files.length > 0) {
        e?.preventDefault();
        void sendMessage({ text: input.trim(), files });
        setInput?.("");
        upload.clear();
        return;
      }
    }
    onSubmit?.(e);
  }, [manageAttachments, sendMessage, upload, input, setInput, onSubmit]);

  // --- Tab state ---
  const [internalTab, setInternalTab] = React.useState<ChatTab>("chat");
  const currentTab = controlledTab ?? internalTab;
  const handleTabChange = controlledTabChange ?? setInternalTab;

  // --- Voice ---
  const voice = useVoiceInput({
    onTranscript: (transcript, isFinal) => {
      if (!isFinal || !setInput) return;
      setInput(transcript);
    },
  });

  const voiceHandler = React.useMemo(() => {
    if (onVoice) return onVoice;
    if (enableVoice && voice.isSupported && setInput) return voice.toggle;
    return undefined;
  }, [onVoice, enableVoice, voice.isSupported, voice.toggle, setInput]);

  const isEmpty = messages.length === 0;
  const isDocsTab = showTabs && currentTab === "attachments";

  return (
    <ChatRoot
      ref={ref}
      messages={messages}
      input={input}
      isLoading={isLoading}
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
      showSources={showSources}
      onSourceClick={onSourceClick}
      theme={userTheme}
      maxHeight={maxHeight}
      className={className}
    >
      {showTabs && !hideTabSwitcher && (
        <TabSwitcher activeTab={currentTab} onTabChange={handleTabChange} />
      )}

      {isDocsTab
        ? (
          <AttachmentsPanel
            uploads={uploads}
            onRemoveUpload={onRemoveUpload}
            onAttach={effectiveOnAttach}
            attachAccept={attachAccept}
            onClose={() => handleTabChange("chat")}
            className="flex-1 min-h-0"
          />
        )
        : isEmpty && (isLoading || initializing)
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
            renderTool={renderTool}
            model={activeModel || model}
            showMessageActions={showMessageActions}
            showSources={showSources}
            showSteps={showSteps}
            showScrollButton={showScrollButton}
            onSourceClick={onSourceClick}
            inferenceMode={inferenceMode}
            editMessage={editMessage}
            getBranches={getBranches}
            switchBranch={switchBranch}
            onFeedback={onFeedback}
          />
        )}

      {error && <ErrorBanner error={error} onRetry={reload} />}

      {!isDocsTab && (
        <ChatInput
          input={voice.isListening ? voice.transcript || input : input}
          onChange={onChange}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          placeholder={voice.isListening ? "Listening..." : placeholder}
          theme={theme}
          stop={voice.isListening ? undefined : stop}
          onVoice={voiceHandler}
          isListening={voice.isListening}
          transcript={voice.transcript}
          models={models}
          model={model}
          onModelChange={onModelChange}
          onAttach={effectiveOnAttach}
          onSelectAttachment={onSelectAttachment}
          onDrop={effectiveOnDrop}
          attachAccept={attachAccept}
          attachments={effectiveAttachments}
          onRemoveAttachment={effectiveOnRemove}
          showExport={showExport}
          messages={messages}
          toolbarStart={toolbarStart}
        >
          {inferenceMode && inferenceMode !== "cloud" && (
            <InferenceBadge inferenceMode={inferenceMode} />
          )}
          {isEmpty && quickActions && quickActions.length > 0 && (
            <QuickActionsComponent
              actions={quickActions}
              onActionClick={onQuickAction}
            />
          )}
        </ChatInput>
      )}

      {children}
    </ChatRoot>
  );
}
ControlledChat.displayName = "ControlledChat";

/**
 * Map uploaded attachments to `file` message parts. Only attachments that
 * finished uploading (have a resolved `url`) are sent — pending/errored ones
 * are skipped so a half-uploaded file never reaches the agent.
 */
export function attachmentsToFileParts(items: AttachmentInfo[]): ChatFilePart[] {
  return items
    .filter((a): a is AttachmentInfo & { url: string } => Boolean(a.url))
    .map((a) => ({
      type: "file",
      mediaType: a.type ?? "application/octet-stream",
      url: a.url,
      filename: a.name,
      ...(a.size != null ? { size: a.size } : {}),
    }));
}

/** True while any attachment is still resolving its `url`; submits must wait
 * or the fold above would silently drop the pending file. */
export function hasPendingAttachments(items: AttachmentInfo[]): boolean {
  return items.some((a) => a.state === "uploading" || a.state === "processing");
}
