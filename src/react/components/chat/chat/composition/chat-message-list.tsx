/**
 * ChatMessageList — Message rendering loop, composed from the `Message` primitive.
 *
 * Every turn renders through `<Message message={…} />` so the `<Chat>` transcript
 * is identical to the standalone `Message` component (header, reasoning, tools,
 * sources, tokens, hover actions). Pass `renderMessage` to override a row.
 *
 * @module react/components/chat/composition/chat-message-list
 */

import * as React from "react";
import { MessageList } from "#veryfront/react/primitives/index.ts";
import type { BranchInfo, ChatMessage, InferenceMode } from "#veryfront/agent/react";
import type { ChatTheme } from "../../theme.ts";
import { cn } from "../../theme.ts";
import type { Source } from "../components/sources.tsx";
import type { FeedbackValue } from "../components/message-feedback.tsx";
import { useStickToBottom } from "../hooks/use-stick-to-bottom.ts";
import { COMPONENT_ERROR } from "#veryfront/errors/error-registry.ts";
import { PendingMessage } from "./pending-message.tsx";
import { Message } from "./message.tsx";
import { useChatContextOptional } from "../contexts/chat-context.tsx";

/** Props accepted by chat message list. */
export interface ChatMessageListProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  theme?: ChatTheme;

  // Rendering
  renderMessage?: (message: ChatMessage) => React.ReactNode;
  model?: string;

  /** Render the scroll-to-bottom control; receives the click handler and pin state. */
  renderScrollButton?: (
    opts: { onClick: () => void; isAtBottom: boolean },
  ) => React.ReactNode;
  onSourceClick?: (source: Source, index: number) => void;
  inferenceMode?: InferenceMode;

  // Editing / Branching
  editMessage?: (messageId: string, newText: string) => Promise<void>;
  getBranches?: (messageId: string) => BranchInfo;
  switchBranch?: (messageId: string, branchIndex: number) => void;

  // Feedback
  onFeedback?: (messageId: string, feedback: FeedbackValue) => void;

  className?: string;
  /** Compose the viewport. Defaults to `<ChatMessageList.Content />`. */
  children?: React.ReactNode;

  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

interface ChatMessageListContextValue {
  messages: ChatMessage[];
  isLoading?: boolean;
  renderMessage?: (message: ChatMessage) => React.ReactNode;
  onSourceClick?: (source: Source, index: number) => void;
  editMessage?: (messageId: string, newText: string) => Promise<void>;
  getBranches?: (messageId: string) => BranchInfo;
  switchBranch?: (messageId: string, branchIndex: number) => void;
  onFeedback?: (messageId: string, feedback: FeedbackValue) => void;
  contentRef: React.RefObject<HTMLElement | null>;
  lastMessage?: ChatMessage;
}

const ChatMessageListContext = React.createContext<ChatMessageListContextValue | null>(null);

function useChatMessageList(): ChatMessageListContextValue {
  const context = React.useContext(ChatMessageListContext);
  if (!context) {
    throw COMPONENT_ERROR.create({
      detail: "ChatMessageList.Content must be used within a ChatMessageList",
    });
  }
  return context;
}

/** Props accepted by the centered transcript column. */
export interface ChatMessageListContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Centered transcript column. Compose this part to style or replace its anatomy. */
function ChatMessageListContent({
  className,
  children,
  ref,
  ...props
}: ChatMessageListContentProps): React.ReactElement {
  const {
    messages,
    isLoading,
    renderMessage,
    onSourceClick,
    editMessage,
    getBranches,
    switchBranch,
    onFeedback,
    contentRef,
    lastMessage,
  } = useChatMessageList();
  const chat = useChatContextOptional();

  const setContentRef = React.useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }, [contentRef, ref]);

  return (
    <div
      ref={setContentRef}
      className={cn("max-w-[850px] mx-auto px-9 py-6 space-y-6", className)}
      {...props}
    >
      {children ?? (
        <>
          {messages.map((msg) => {
            if (renderMessage) {
              return <React.Fragment key={msg.id}>{renderMessage(msg)}</React.Fragment>;
            }
            const isStreaming = chat?.status === undefined
              ? Boolean(isLoading && msg === lastMessage && msg.role === "assistant")
              : undefined;
            return (
              <Message
                key={msg.id}
                message={msg}
                isStreaming={isStreaming}
                onSourceClick={onSourceClick}
                editMessage={editMessage}
                getBranches={getBranches}
                switchBranch={switchBranch}
                onFeedback={onFeedback}
              />
            );
          })}

          {isLoading && lastMessage?.role !== "assistant" && <PendingMessage />}
        </>
      )}
    </div>
  );
}
ChatMessageListContent.displayName = "ChatMessageList.Content";

/** Render chat message list. */
function ChatMessageListBase(
  {
    messages,
    isLoading,
    renderMessage,
    renderScrollButton,
    onSourceClick,
    inferenceMode: _inferenceMode,
    editMessage,
    getBranches,
    switchBranch,
    onFeedback,
    className,
    children,
    ref,
  }: ChatMessageListProps,
): React.ReactElement {
  // Stick-to-bottom: auto-scroll on new messages only while pinned, and drive
  // the scroll-to-bottom button's visibility off `isAtBottom`.
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom<HTMLDivElement>(
    messages.length,
  );

  // Fade the top edge once the user scrolls down, so messages dissolve under
  // whatever sits above the list (e.g. a borderless header) instead of a hard
  // cut. Top-only: the bottom is never masked, so nothing is clipped at rest.
  const [topFaded, setTopFaded] = React.useState(false);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onScroll = () => setTopFaded(el.scrollTop > 8);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  // Merge the forwarded ref with the stick-to-bottom scroll container ref.
  const setListRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [ref, scrollRef],
  );

  const lastMessage = messages[messages.length - 1];

  // Force-scroll to the bottom when the user submits a new message, even if
  // they'd scrolled up into history. `useStickToBottom` only *follows* growth
  // while already pinned, so a fresh user turn from a scrolled-up position
  // would otherwise stay off-screen. Scrolling re-pins the view (the scroll
  // listener flips `isAtBottom` back to true), so the streaming response then
  // follows normally.
  const lastUserIdRef = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (lastMessage?.role !== "user") return;
    if (lastMessage.id === lastUserIdRef.current) return;
    lastUserIdRef.current = lastMessage.id;
    scrollToBottom("smooth");
  }, [lastMessage, scrollToBottom]);

  const contextValue = React.useMemo<ChatMessageListContextValue>(() => ({
    messages,
    isLoading,
    renderMessage,
    onSourceClick,
    editMessage,
    getBranches,
    switchBranch,
    onFeedback,
    contentRef,
    lastMessage,
  }), [
    messages,
    isLoading,
    renderMessage,
    onSourceClick,
    editMessage,
    getBranches,
    switchBranch,
    onFeedback,
    contentRef,
    lastMessage,
  ]);

  return (
    // The scroll button must overlay the *visible* viewport, so it lives in a
    // non-scrolling `relative` wrapper as a sibling of the scroll container —
    // not inside it, where `absolute bottom-4` would anchor to the bottom of
    // the full scrollable content and scroll away with the messages.
    <ChatMessageListContext.Provider value={contextValue}>
      <div className={cn("relative flex-1 min-h-0 flex flex-col", className)}>
        <MessageList
          ref={setListRef}
          className={cn(
            "flex-1 min-h-0 overflow-y-auto",
            topFaded && "[mask-image:linear-gradient(to_bottom,transparent,black_1.5rem)]",
          )}
        >
          {children ?? <ChatMessageListContent />}
        </MessageList>

        {renderScrollButton?.({
          onClick: () => scrollToBottom("smooth"),
          isAtBottom,
        })}
      </div>
    </ChatMessageListContext.Provider>
  );
}
ChatMessageListBase.displayName = "ChatMessageList";

/** Render the default message list or compose its centered `Content` column. */
export const ChatMessageList = Object.assign(ChatMessageListBase, {
  Content: ChatMessageListContent,
});
