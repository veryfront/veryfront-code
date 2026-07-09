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
import type { ChatMessage } from "#veryfront/agent/react";
import type { ChatTheme } from "../../theme.ts";
import { getDocumentNonce } from "../../../ui/csp-nonce.ts";
import { cn, defaultChatTheme, generateTokenCSS, mergeThemes } from "../../theme.ts";
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

  // Messages
  messages: ChatMessage[];
  isLoading?: boolean;
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

  // Agent identity — fallback for assistant message headers.
  agent?: { name?: string; avatarUrl?: string };

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
  showSources?: boolean;
  onSourceClick?: (source: Source, index: number) => void;

  // Theme
  theme?: Partial<ChatTheme>;
  maxHeight?: string;
}

/** Render chat root. */
export const ChatRoot = React.forwardRef<HTMLDivElement, ChatRootProps>(
  function ChatRoot(
    {
      children,
      messages,
      isLoading = false,
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
      showSources = false,
      onSourceClick,
      theme: userTheme,
      maxHeight = "100%",
      className,
      style,
      ...containerProps
    },
    ref,
  ) {
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
        showSources,
        onSourceClick,
        isEmpty: messages.length === 0,
        isAtBottom,
        scrollToBottom,
        theme,
      }),
      [
        messages,
        isLoading,
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
        showSources,
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
          data-vf-chat=""
          className={cn(theme.container, "relative", className)}
          style={{ maxHeight, ...style }}
          {...containerProps}
        >
          {children}
        </ChatContainer>
      </ChatContextProvider>
    );
  },
);
ChatRoot.displayName = "ChatRoot";
