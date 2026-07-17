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
import type { ChatMessage, ChatStatus } from "#veryfront/agent/react";
import type { ChatTheme } from "../../theme.ts";
import { getDocumentNonce } from "../../../ui/csp-nonce.ts";
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

/** Props accepted by chat root. */
export interface ChatRootProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  children: React.ReactNode;

  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;

  // Messages
  messages: ChatMessage[];
  isLoading?: boolean;
  /** Streaming lifecycle of the current turn (`useChat().status`). */
  status?: ChatStatus;
  /** Id of the assistant message currently streaming (`useChat().streamingMessageId`). */
  streamingMessageId?: string | null;
  error?: Error | null;

  // Input
  input: string;
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
    messages,
    isLoading = false,
    status,
    streamingMessageId,
    error = null,
    input,
    setInput,
    onSubmit,
    onStop,
    onReload,
    model,
    models = [],
    onModelChange,
    agent,
    attachments = [],
    onAttach,
    onRemoveAttachment,
    editMessage,
    getBranches,
    switchBranch,
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
  const theme = React.useMemo(() => mergeThemes(defaultChatTheme, userTheme), [userTheme]);
  const nonce = getDocumentNonce();
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
