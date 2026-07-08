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
import type {
  BranchInfo,
  ChatDynamicToolPart,
  ChatMessage,
  ChatToolPart,
  InferenceMode,
} from "#veryfront/agent/react";
import type { ChatTheme } from "../../theme.ts";
import { cn } from "../../theme.ts";
import type { Source } from "../components/sources.tsx";
import type { FeedbackValue } from "../components/message-feedback.tsx";
import { ConversationScrollButton } from "../components/empty-state.tsx";
import { useStickToBottom } from "../hooks/use-stick-to-bottom.ts";
import { PendingMessage } from "./pending-message.tsx";
import { Message } from "./message.tsx";

/** Props accepted by chat message list. */
export interface ChatMessageListProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  theme?: ChatTheme;

  // Rendering
  renderMessage?: (message: ChatMessage) => React.ReactNode;
  renderTool?: (tool: ChatToolPart | ChatDynamicToolPart) => React.ReactNode;
  model?: string;

  // Features
  showMessageActions?: boolean;
  showSources?: boolean;
  showSteps?: boolean;
  showScrollButton?: boolean;
  /** Override the scroll-to-bottom button; receives the click handler + pin state. */
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
  /** Classes for the inner centered content column (default `max-w-[850px]`). */
  contentClassName?: string;
  children?: React.ReactNode;

  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Render chat message list. */
export function ChatMessageList(
  {
    messages,
    isLoading,
    renderMessage,
    renderTool,
    showSources = false,
    showSteps = false,
    showScrollButton = false,
    renderScrollButton,
    onSourceClick,
    inferenceMode: _inferenceMode,
    editMessage,
    getBranches,
    switchBranch,
    onFeedback,
    className,
    contentClassName,
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

  return (
    // The scroll button must overlay the *visible* viewport, so it lives in a
    // non-scrolling `relative` wrapper as a sibling of the scroll container —
    // not inside it, where `absolute bottom-4` would anchor to the bottom of
    // the full scrollable content and scroll away with the messages.
    <div className={cn("relative flex-1 min-h-0 flex flex-col", className)}>
      <MessageList
        ref={setListRef}
        className={cn(
          "flex-1 min-h-0 overflow-y-auto",
          topFaded && "[mask-image:linear-gradient(to_bottom,transparent,black_1.5rem)]",
        )}
      >
        <div
          ref={contentRef as React.Ref<HTMLDivElement>}
          className={cn(
            "max-w-[850px] mx-auto px-9 py-6 space-y-6",
            contentClassName,
          )}
        >
          {messages.map((msg) => {
            if (renderMessage) {
              return (
                <React.Fragment key={msg.id}>
                  {renderMessage(msg)}
                </React.Fragment>
              );
            }
            // The last assistant turn shimmers while a response is streaming.
            const isStreaming = Boolean(
              isLoading && msg === lastMessage && msg.role === "assistant",
            );
            return (
              <Message
                key={msg.id}
                message={msg}
                isStreaming={isStreaming}
                showSources={showSources}
                showSteps={showSteps}
                editMessage={editMessage}
                getBranches={getBranches}
                switchBranch={switchBranch}
                onFeedback={onFeedback}
              >
                {renderTool
                  ? (
                    <>
                      <Message.Header />
                      <Message.Content
                        showSources={showSources}
                        showSteps={showSteps}
                        renderTool={renderTool}
                        onSourceClick={onSourceClick}
                      />
                      <Message.Continuing />
                      <div className="mt-1.5 flex items-center gap-0.5">
                        <Message.Actions />
                        <Message.Tokens />
                      </div>
                    </>
                  )
                  : undefined}
              </Message>
            );
          })}

          {isLoading && lastMessage?.role !== "assistant" && <PendingMessage />}
        </div>

        {children}
      </MessageList>

      {showScrollButton && (
        renderScrollButton
          ? renderScrollButton({
            onClick: () => scrollToBottom("smooth"),
            isAtBottom,
          })
          : (!isAtBottom && <ConversationScrollButton onClick={() => scrollToBottom("smooth")} />)
      )}
    </div>
  );
}
ChatMessageList.displayName = "ChatMessageList";
