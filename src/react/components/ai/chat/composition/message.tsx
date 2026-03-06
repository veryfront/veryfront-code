/**
 * Message — Compound component for rendering individual chat messages.
 *
 * Provides fine-grained control over per-message rendering. Each sub-component
 * consumes MessageContext, so they must be nested inside Message.Root.
 *
 * @example
 * ```tsx
 * <Message.Root message={msg}>
 *   <Message.Avatar />
 *   <div className="flex-1">
 *     <Message.Content />
 *     <Message.Actions />
 *   </div>
 * </Message.Root>
 * ```
 *
 * @module ai/react/components/chat/composition/message
 */

import * as React from "react";
import type { BranchInfo, DynamicToolUIPart, ToolUIPart, UIMessage } from "#veryfront/agent/react";
import { cn } from "../../theme.ts";
import { Markdown } from "../../markdown.tsx";
import { MessageItem } from "../../../../primitives/index.ts";
import { MessageContextProvider, useMessageContext } from "../contexts/message-context.tsx";
import type { MessageContextValue } from "../contexts/message-context.tsx";
import { useChatContextOptional } from "../contexts/chat-context.tsx";
import type { FeedbackValue } from "../components/message-feedback.tsx";
import { MessageActions as ActionsImpl } from "../components/message-actions.tsx";
import { MessageFeedback as FeedbackImpl } from "../components/message-feedback.tsx";
import { BranchPicker as BranchPickerImpl } from "../components/branch-picker.tsx";
import { ReasoningCard } from "../components/reasoning.tsx";
import { ToolCallCard } from "../components/tool-ui.tsx";
import { StepIndicator } from "../components/step-indicator.tsx";
import { Sources as SourcesImpl } from "../components/sources.tsx";
import type { Source } from "../components/sources.tsx";
import { ModelAvatar as AvatarImpl } from "./model-avatar.tsx";
import {
  extractSourcesFromParts,
  getTextContent,
  groupPartsInOrder,
} from "../utils/message-parts.ts";

// ---------------------------------------------------------------------------
// Message.Root
// ---------------------------------------------------------------------------

export interface MessageRootProps {
  message: UIMessage;
  isStreaming?: boolean;
  children: React.ReactNode;
  className?: string;

  // Optional overrides — falls back to ChatContext when available
  editMessage?: (messageId: string, newText: string) => Promise<void>;
  getBranches?: (messageId: string) => BranchInfo;
  switchBranch?: (messageId: string, branchIndex: number) => void;
  onFeedback?: (messageId: string, feedback: FeedbackValue) => void;
  feedback?: FeedbackValue | null;
}

const MessageRoot = React.forwardRef<HTMLDivElement, MessageRootProps>(
  function MessageRoot(
    { message, isStreaming = false, children, className, ...overrides },
    ref,
  ) {
    const chat = useChatContextOptional();
    const role = message.role as MessageContextValue["role"];
    const parts = React.useMemo(() => groupPartsInOrder(message.parts), [message.parts]);
    const textContent = React.useMemo(() => getTextContent(message), [message]);

    const editMessage = overrides.editMessage ?? chat?.editMessage;
    const getBranches = overrides.getBranches ?? chat?.getBranches;
    const switchBranch = overrides.switchBranch ?? chat?.switchBranch;
    const onFeedbackProp = overrides.onFeedback ?? chat?.onFeedback;

    const branch = React.useMemo(
      () => getBranches?.(message.id) ?? null,
      [getBranches, message.id],
    );

    const onCopy = React.useCallback(async () => {
      try {
        await navigator.clipboard.writeText(textContent);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = textContent;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
    }, [textContent]);

    const contextValue = React.useMemo<MessageContextValue>(
      () => ({
        message,
        role,
        isStreaming,
        parts,
        textContent,
        branch,
        onBranchPrev: branch && switchBranch
          ? () => switchBranch(message.id, branch.current - 2)
          : undefined,
        onBranchNext: branch && switchBranch
          ? () => switchBranch(message.id, branch.current)
          : undefined,
        onCopy,
        onEdit: editMessage
          ? (content: string) => {
            editMessage(message.id, content);
          }
          : undefined,
        onFeedback: onFeedbackProp
          ? (value: FeedbackValue) => onFeedbackProp(message.id, value)
          : undefined,
        feedback: overrides.feedback,
      }),
      [
        message,
        message.id,
        role,
        isStreaming,
        parts,
        textContent,
        branch,
        switchBranch,
        onCopy,
        editMessage,
        onFeedbackProp,
        overrides.feedback,
      ],
    );

    const isUser = role === "user";

    return (
      <MessageContextProvider value={contextValue}>
        <MessageItem
          ref={ref}
          role={message.role}
          className={cn(
            isUser
              ? "flex flex-col items-end group/msg"
              : "flex items-start gap-3 justify-start group/msg",
            className,
          )}
        >
          {children}
        </MessageItem>
      </MessageContextProvider>
    );
  },
);
MessageRoot.displayName = "Message.Root";

// ---------------------------------------------------------------------------
// Message.Avatar
// ---------------------------------------------------------------------------

export interface MessageAvatarProps {
  className?: string;
}

function MessageAvatar({ className }: MessageAvatarProps): React.ReactElement | null {
  const { message, role } = useMessageContext();
  if (role === "user") return null;
  return (
    <AvatarImpl
      model={(message.metadata?.model as string) || undefined}
      className={className}
    />
  );
}
MessageAvatar.displayName = "Message.Avatar";

// ---------------------------------------------------------------------------
// Message.Content
// ---------------------------------------------------------------------------

export interface MessageContentProps {
  renderTool?: (tool: ToolUIPart | DynamicToolUIPart) => React.ReactNode;
  showSteps?: boolean;
  showSources?: boolean;
  onSourceClick?: (source: Source, index: number) => void;
  className?: string;
}

function MessageContent({
  renderTool,
  showSteps = false,
  showSources = false,
  onSourceClick,
  className,
}: MessageContentProps): React.ReactElement {
  const { message, role, parts, textContent } = useMessageContext();
  const chat = useChatContextOptional();
  const shouldShowSources = showSources || chat?.showSources || false;
  const sourceClickHandler = onSourceClick ?? chat?.onSourceClick;

  if (role === "user") {
    return (
      <div className={cn(chat?.theme.message?.user, className)}>
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{textContent}</p>
      </div>
    );
  }

  const stepCount = parts.filter((g) => g.type === "step").length;
  const messageSources = shouldShowSources ? extractSourcesFromParts(message.parts) : [];

  return (
    <div className={cn(chat?.theme.message?.assistant, "flex-1 min-w-0", className)}>
      {parts.map((group, index) => {
        if (group.type === "text") {
          return (
            <Markdown key={`text-${index}`} className="text-[15px] leading-7">
              {group.content}
            </Markdown>
          );
        }
        if (group.type === "reasoning") {
          return (
            <ReasoningCard
              key={`reasoning-${index}`}
              text={group.text}
              isStreaming={group.isStreaming}
            />
          );
        }
        if (group.type === "step") {
          return showSteps && stepCount > 1
            ? (
              <StepIndicator
                key={`step-${group.stepIndex}`}
                stepIndex={group.stepIndex}
                isComplete={group.isComplete}
              />
            )
            : null;
        }
        return (
          <div key={group.tool.toolCallId} className="my-3">
            {renderTool ? renderTool(group.tool) : <ToolCallCard tool={group.tool} />}
          </div>
        );
      })}
      {messageSources.length > 0 && (
        <SourcesImpl sources={messageSources} onSourceClick={sourceClickHandler} />
      )}
    </div>
  );
}
MessageContent.displayName = "Message.Content";

// ---------------------------------------------------------------------------
// Message.Actions
// ---------------------------------------------------------------------------

export interface MessageActionsWrapperProps {
  className?: string;
}

function MessageActionsWrapper(
  { className }: MessageActionsWrapperProps,
): React.ReactElement | null {
  const { textContent, onEdit } = useMessageContext();
  if (!textContent) return null;
  return <ActionsImpl content={textContent} onEdit={onEdit} className={className} />;
}
MessageActionsWrapper.displayName = "Message.Actions";

// ---------------------------------------------------------------------------
// Message.Feedback
// ---------------------------------------------------------------------------

export interface MessageFeedbackWrapperProps {
  className?: string;
}

function MessageFeedbackWrapper(
  { className }: MessageFeedbackWrapperProps,
): React.ReactElement | null {
  const { message, onFeedback, feedback } = useMessageContext();
  if (!onFeedback) return null;
  return (
    <FeedbackImpl
      messageId={message.id}
      feedback={feedback}
      onFeedback={(_msgId, value) => onFeedback(value)}
      className={className}
    />
  );
}
MessageFeedbackWrapper.displayName = "Message.Feedback";

// ---------------------------------------------------------------------------
// Message.BranchPicker
// ---------------------------------------------------------------------------

function MessageBranchPicker(): React.ReactElement | null {
  const { branch, onBranchPrev, onBranchNext } = useMessageContext();
  if (!branch || branch.total <= 1) return null;
  return (
    <BranchPickerImpl
      current={branch.current}
      total={branch.total}
      onPrev={onBranchPrev ?? (() => {})}
      onNext={onBranchNext ?? (() => {})}
    />
  );
}
MessageBranchPicker.displayName = "Message.BranchPicker";

// ---------------------------------------------------------------------------
// Message — compound export
// ---------------------------------------------------------------------------

export type { MessageContentProps as MessageCompoundContentProps, MessageContextValue };

export const Message = Object.assign(MessageRoot, {
  Root: MessageRoot,
  Avatar: MessageAvatar,
  Content: MessageContent,
  Actions: MessageActionsWrapper,
  Feedback: MessageFeedbackWrapper,
  BranchPicker: MessageBranchPicker,
});
