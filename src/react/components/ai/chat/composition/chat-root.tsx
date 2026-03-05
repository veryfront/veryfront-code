/**
 * ChatRoot — Context provider and container for the compound chat system.
 *
 * Provides ChatContextValue to all descendant components. Extra HTML div
 * attributes (e.g. drag handlers) are forwarded to the container element.
 *
 * @module ai/react/components/chat/composition/chat-root
 */

import * as React from "react";
import { ChatContainer } from "../../../../primitives/index.ts";
import type { UIMessage } from "#veryfront/agent/react";
import type { ChatTheme } from "../../theme.ts";
import { cn, defaultChatTheme, mergeThemes } from "../../theme.ts";
import type { ModelOption } from "../../model-selector.tsx";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import type { FeedbackValue } from "../components/message-feedback.tsx";
import type { Source } from "../components/sources.tsx";
import type { BranchInfo } from "#veryfront/agent/react";
import { ChatContextProvider } from "../contexts/chat-context.tsx";
import type { ChatContextValue } from "../contexts/chat-context.tsx";

export interface ChatRootProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  children: React.ReactNode;

  // Messages
  messages: UIMessage[];
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
        <ChatContainer
          ref={ref}
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
