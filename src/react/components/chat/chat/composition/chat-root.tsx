/**
 * ChatRoot — Context provider and container for the compound chat system.
 *
 * Provides ChatContextValue to all descendant components. Extra HTML div
 * attributes (e.g. drag handlers) are forwarded to the container element.
 *
 * @module react/components/chat/composition/chat-root
 */

import * as React from "react";
import { ChatContainer } from "#veryfront/react/primitives/index.ts";
import type { ChatMessage, ChatStatus, UseChatResult } from "#veryfront/agent/react";
import type { ChatTheme } from "../../theme.ts";
import { useDocumentNonce } from "../../../ui/csp-nonce.ts";
import {
  cn,
  defaultChatTheme,
  generateTokenCSS,
  mergeThemes,
  UI_SCOPE_ATTRS,
} from "../../theme.ts";
import type { ModelOption } from "../../model-selector.tsx";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import type { FeedbackValue } from "../components/message-feedback.tsx";
import type { Source } from "../components/sources.tsx";
import type { BranchInfo } from "#veryfront/agent/react";
import { ChatContextProvider } from "../contexts/chat-context.tsx";
import type { ChatContextValue } from "../contexts/chat-context.tsx";
import { attachmentsToFileParts, hasPendingAttachments } from "../chat-attachments.ts";

/**
 * Props accepted by chat root.
 *
 * Supply either `chat` (a `useChat()` session) or the flat props
 * (`messages`, `input`, `onSubmit`, …). Both are optional so the two modes can
 * mix, but a `<Chat.Root>` given neither renders an empty chat whose
 * `setInput`/`onSubmit` are inert no-ops.
 */
export interface ChatRootProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  children: React.ReactNode;

  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;

  /**
   * Drive the chat surface from a `useChat()` session you own:
   * `<Chat.Root chat={useChat()}>`. Folds the session state into the shared
   * context; the flat props below stay as an explicit override path.
   */
  chat?: UseChatResult;

  // Messages
  messages?: ChatMessage[];
  isLoading?: boolean;
  /** Streaming lifecycle of the current turn (`useChat().status`). */
  status?: ChatStatus;
  /** Id of the assistant message currently streaming (`useChat().streamingMessageId`). */
  streamingMessageId?: string | null;
  error?: Error | null;

  // Input
  input?: string;
  setInput?: (value: string) => void;

  // Submit / Stop
  onSubmit?: (e?: React.FormEvent) => void | Promise<void>;
  onStop?: () => void;
  onReload?: () => void;

  // Model
  model?: string;
  models?: ModelOption[];
  onModelChange?: (modelId: string) => void;

  // Agent identity — fallback for assistant message headers. Accepts
  // `AgentMetadata` structurally, so a `useAgentMetadata()` object passes
  // through without narrowing (`avatarUrl: string | null`).
  agent?: { name?: string; avatarUrl?: string | null };

  // Attachments
  attachments?: AttachmentInfo[];
  onAttach?: (files: FileList) => void;
  onRemoveAttachment?: (id: string) => void;

  // Branching
  editMessage?: (messageId: string, newText: string) => Promise<void>;
  getBranches?: (messageId: string) => BranchInfo;
  switchBranch?: (messageId: string, branchIndex: number) => void;

  // Feedback
  onFeedback?: (messageId: string, feedback: FeedbackValue) => void;

  // Sources
  onSourceClick?: (source: Source, index: number) => void;

  // Theme
  theme?: Partial<ChatTheme>;
  maxHeight?: string;
}

/** Render chat root. */
export function ChatRoot(
  {
    children,
    chat,
    messages: messagesProp,
    isLoading: isLoadingProp,
    status: statusProp,
    streamingMessageId: streamingMessageIdProp,
    error: errorProp,
    input: inputProp,
    setInput: setInputProp,
    onSubmit: onSubmitProp,
    onStop: onStopProp,
    onReload: onReloadProp,
    model: modelProp,
    models = [],
    onModelChange: onModelChangeProp,
    agent,
    attachments = [],
    onAttach,
    onRemoveAttachment,
    editMessage: editMessageProp,
    getBranches: getBranchesProp,
    switchBranch: switchBranchProp,
    onFeedback,
    onSourceClick,
    theme: userTheme,
    maxHeight = "100%",
    className,
    style,
    ref,
    ...containerProps
  }: ChatRootProps,
): React.ReactElement {
  // `chat` folds the session's flat state into the context; each explicit flat
  // prop wins over the session value (issue #69's override path).
  const messages = messagesProp ?? chat?.messages ?? [];
  const isLoading = isLoadingProp ?? chat?.isLoading ?? false;
  const status = statusProp ?? chat?.status;
  // Nullable props compare against `undefined`, not nullish: `error={null}` and
  // `streamingMessageId={null}` are explicit overrides that clear the session
  // value, so `??` would wrongly restore it from `chat`.
  const streamingMessageId = streamingMessageIdProp !== undefined
    ? streamingMessageIdProp
    : chat?.streamingMessageId;
  const error = errorProp !== undefined ? errorProp : (chat?.error ?? null);
  const input = inputProp ?? chat?.input ?? "";
  const setInput = setInputProp ?? chat?.setInput;
  const hasFlatSubmitState = inputProp !== undefined || setInputProp !== undefined ||
    isLoadingProp !== undefined;
  const submitSession = React.useCallback((e?: React.FormEvent) => {
    if (!chat) return;
    if (hasPendingAttachments(attachments)) {
      e?.preventDefault();
      return;
    }
    const files = attachmentsToFileParts(attachments);
    if (files.length === 0 && !hasFlatSubmitState) return chat.handleSubmit(e);

    e?.preventDefault();
    if (isLoading) return;
    const text = input.trim();
    if (!text && files.length === 0) return;

    setInput?.("");
    for (const attachment of attachments) {
      if (attachment.url) onRemoveAttachment?.(attachment.id);
    }
    return chat.sendMessage({ text, ...(files.length > 0 ? { files } : {}) });
  }, [attachments, chat, hasFlatSubmitState, input, isLoading, onRemoveAttachment, setInput]);
  const onSubmit = onSubmitProp ?? (chat ? submitSession : undefined);
  const onStop = onStopProp ?? chat?.stop;
  const onReload = onReloadProp ?? chat?.reload;
  const model = modelProp ?? chat?.model;
  const onModelChange = onModelChangeProp ?? chat?.setModel;
  const editMessage = editMessageProp ?? chat?.editMessage;
  const getBranches = getBranchesProp ?? chat?.getBranches;
  const switchBranch = switchBranchProp ?? chat?.switchBranch;
  const theme = React.useMemo(() => mergeThemes(defaultChatTheme, userTheme), [userTheme]);
  const nonce = useDocumentNonce();
  const tokenCSS = React.useMemo(() => generateTokenCSS(), []);
  const [isAtBottom, _setIsAtBottom] = React.useState(true);
  const scrollAreaRef = React.useRef<HTMLDivElement>(null);

  const scrollToBottom = React.useCallback(() => {
    scrollAreaRef.current?.scrollTo({
      top: scrollAreaRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  const contextValue = React.useMemo<ChatContextValue>(
    () => ({
      messages,
      isLoading,
      status,
      streamingMessageId,
      error,
      input,
      setInput: setInput ?? (() => {}),
      onSubmit: onSubmit ?? (() => {}),
      sendMessage: onSubmitProp === undefined ? chat?.sendMessage : undefined,
      onStop,
      onReload,
      model,
      models,
      onModelChange,
      agent,
      attachments,
      onAttach,
      onRemoveAttachment,
      editMessage,
      getBranches,
      switchBranch,
      onFeedback,
      onSourceClick,
      isEmpty: messages.length === 0,
      isAtBottom,
      scrollToBottom,
      theme,
    }),
    [
      messages,
      isLoading,
      status,
      streamingMessageId,
      error,
      input,
      setInput,
      onSubmit,
      chat?.sendMessage,
      onSubmitProp,
      onStop,
      onReload,
      model,
      models,
      onModelChange,
      agent,
      attachments,
      onAttach,
      onRemoveAttachment,
      editMessage,
      getBranches,
      switchBranch,
      onFeedback,
      onSourceClick,
      isAtBottom,
      scrollToBottom,
      theme,
    ],
  );

  return (
    <ChatContextProvider value={contextValue}>
      <style nonce={nonce} dangerouslySetInnerHTML={{ __html: tokenCSS }} />
      <ChatContainer
        ref={ref}
        {...UI_SCOPE_ATTRS}
        className={cn(theme.container, "relative", className)}
        style={{ maxHeight, ...style }}
        {...containerProps}
      >
        {children}
      </ChatContainer>
    </ChatContextProvider>
  );
}
ChatRoot.displayName = "ChatRoot";
