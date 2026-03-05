/**
 * ChatMessageList — Message rendering loop with component injection.
 *
 * Renders user and assistant messages with support for branching, editing,
 * feedback, sources, reasoning, tool calls, and step indicators.
 *
 * @module ai/react/components/chat/composition/chat-message-list
 */

import * as React from "react";
import { MessageItem, MessageList } from "../../../../primitives/index.ts";
import type {
  BranchInfo,
  BrowserInferenceStatus,
  DynamicToolUIPart,
  InferenceMode,
  ToolUIPart,
  UIMessage,
} from "#veryfront/agent/react";
import type { ChatTheme } from "../../theme.ts";
import { cn } from "../../theme.ts";
import { Markdown } from "../../markdown.tsx";
import {
  extractSourcesFromParts,
  getTextContent,
  groupPartsInOrder,
} from "../utils/message-parts.ts";
import { ConversationScrollButton } from "../components/empty-state.tsx";
import { MessageActions } from "../components/message-actions.tsx";
import { ReasoningCard } from "../components/reasoning.tsx";
import { ToolCallCard } from "../components/tool-ui.tsx";

import { Sources } from "../components/sources.tsx";
import type { Source } from "../components/sources.tsx";
import { MessageEditForm } from "../components/message-edit-form.tsx";
import { BranchPicker } from "../components/branch-picker.tsx";
import { MessageFeedback } from "../components/message-feedback.tsx";
import type { FeedbackValue } from "../components/message-feedback.tsx";
import { StepIndicator } from "../components/step-indicator.tsx";
import { ModelAvatar } from "./model-avatar.tsx";

export interface ChatMessageListProps {
  messages: UIMessage[];
  isLoading?: boolean;
  theme?: ChatTheme;

  // Rendering
  renderMessage?: (message: UIMessage) => React.ReactNode;
  renderTool?: (tool: ToolUIPart | DynamicToolUIPart) => React.ReactNode;
  model?: string;

  // Features
  showMessageActions?: boolean;
  showSources?: boolean;
  showSteps?: boolean;
  showScrollButton?: boolean;
  onSourceClick?: (source: Source, index: number) => void;
  inferenceMode?: InferenceMode;
  browserStatus?: BrowserInferenceStatus | null;

  // Editing / Branching
  editMessage?: (messageId: string, newText: string) => Promise<void>;
  getBranches?: (messageId: string) => BranchInfo;
  switchBranch?: (messageId: string, branchIndex: number) => void;

  // Feedback
  onFeedback?: (messageId: string, feedback: FeedbackValue) => void;

  className?: string;
  children?: React.ReactNode;
}

export const ChatMessageList = React.forwardRef<HTMLDivElement, ChatMessageListProps>(
  function ChatMessageList(
    {
      messages,
      isLoading,
      theme,
      renderMessage,
      renderTool,
      model,
      showMessageActions = true,
      showSources = false,
      showSteps = false,
      showScrollButton = false,
      onSourceClick,
      inferenceMode: _inferenceMode,
      browserStatus,
      editMessage,
      getBranches,
      switchBranch,
      onFeedback,
      className,
      children,
    },
    ref,
  ) {
    const messagesEndRef = React.useRef<HTMLDivElement>(null!);
    const [editingMessageId, setEditingMessageId] = React.useState<string | null>(null);
    const [feedbackMap, setFeedbackMap] = React.useState<Record<string, FeedbackValue>>({});

    const handleFeedback = React.useCallback(
      (msgId: string, value: FeedbackValue) => {
        setFeedbackMap((prev) => ({ ...prev, [msgId]: value }));
        onFeedback?.(msgId, value);
      },
      [onFeedback],
    );

    const messageCount = messages.length;
    React.useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messageCount]);

    return (
      <MessageList ref={ref} className={cn("flex-1 min-h-0 overflow-y-auto relative", className)}>
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
          {messages.map((msg) => {
            if (renderMessage) {
              return <React.Fragment key={msg.id}>{renderMessage(msg)}</React.Fragment>;
            }

            if (msg.role === "user") {
              return (
                <UserMessage
                  key={msg.id}
                  message={msg}
                  theme={theme}
                  isEditing={editingMessageId === msg.id}
                  onStartEdit={() => setEditingMessageId(msg.id)}
                  onCancelEdit={() =>
                    setEditingMessageId(null)}
                  editMessage={editMessage}
                  getBranches={getBranches}
                  switchBranch={switchBranch}
                />
              );
            }

            return (
              <AssistantMessage
                key={msg.id}
                message={msg}
                theme={theme}
                renderTool={renderTool}
                showMessageActions={showMessageActions}
                showSources={showSources}
                showSteps={showSteps}
                onSourceClick={onSourceClick}
                onFeedback={onFeedback ? handleFeedback : undefined}
                feedbackMap={feedbackMap}
              />
            );
          })}

          {isLoading && (
            <div className="flex items-start gap-3">
              <ModelAvatar model={model} />
              {browserStatus === "downloading-model" || browserStatus === "loading-runtime"
                ? (
                  <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] py-2.5">
                    <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                    <span>
                      {browserStatus === "downloading-model"
                        ? "Downloading model..."
                        : "Loading AI..."}
                    </span>
                  </div>
                )
                : (
                  <div className="flex gap-1.5 items-center py-3">
                    <span className={cn(theme?.loading)} />
                    <span className={cn(theme?.loading)} style={{ animationDelay: "0.15s" }} />
                    <span className={cn(theme?.loading)} style={{ animationDelay: "0.3s" }} />
                  </div>
                )}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {children}

        {showScrollButton && (
          <ConversationScrollButton
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
          />
        )}
      </MessageList>
    );
  },
);
ChatMessageList.displayName = "ChatMessageList";

// --- Internal sub-components ---

interface UserMessageProps {
  message: UIMessage;
  theme?: ChatTheme;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  editMessage?: (messageId: string, newText: string) => Promise<void>;
  getBranches?: (messageId: string) => BranchInfo;
  switchBranch?: (messageId: string, branchIndex: number) => void;
}

function UserMessage({
  message: msg,
  theme,
  isEditing,
  onStartEdit,
  onCancelEdit,
  editMessage,
  getBranches,
  switchBranch,
}: UserMessageProps): React.ReactElement {
  const content = getTextContent(msg);
  const branches = getBranches?.(msg.id);
  const hasBranches = branches && branches.total > 1;

  return (
    <MessageItem role={msg.role} className={cn("flex flex-col items-end", "group/msg")}>
      {isEditing
        ? (
          <div className="w-full max-w-md">
            <MessageEditForm
              initialContent={content}
              onSave={(text) => {
                onCancelEdit();
                editMessage?.(msg.id, text);
              }}
              onCancel={onCancelEdit}
            />
          </div>
        )
        : (
          <div className={theme?.message?.user}>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{content}</p>
          </div>
        )}
      {!isEditing && (
        <div className="flex items-center gap-2 mt-1">
          {hasBranches && (
            <BranchPicker
              current={branches.current}
              total={branches.total}
              onPrev={() => switchBranch?.(msg.id, branches.current - 2)}
              onNext={() => switchBranch?.(msg.id, branches.current)}
            />
          )}
          {editMessage && <MessageActions content={content} onEdit={onStartEdit} />}
        </div>
      )}
    </MessageItem>
  );
}

interface AssistantMessageProps {
  message: UIMessage;
  theme?: ChatTheme;
  renderTool?: (tool: ToolUIPart | DynamicToolUIPart) => React.ReactNode;
  showMessageActions?: boolean;
  showSources?: boolean;
  showSteps?: boolean;
  onSourceClick?: (source: Source, index: number) => void;
  onFeedback?: (messageId: string, feedback: FeedbackValue) => void;
  feedbackMap: Record<string, FeedbackValue>;
}

function AssistantMessage({
  message: msg,
  theme,
  renderTool,
  showMessageActions = true,
  showSources = false,
  showSteps = false,
  onSourceClick,
  onFeedback,
  feedbackMap,
}: AssistantMessageProps): React.ReactElement {
  const partGroups = groupPartsInOrder(msg.parts);
  const stepCount = partGroups.filter((g) => g.type === "step").length;
  const textContent = getTextContent(msg);
  const messageSources = showSources ? extractSourcesFromParts(msg.parts) : [];

  return (
    <MessageItem
      role={msg.role}
      className={cn("flex items-start gap-3", "justify-start", "group/msg")}
    >
      <ModelAvatar model={(msg.metadata?.model as string) || undefined} />
      <div className={cn(theme?.message?.assistant, "flex-1 min-w-0")}>
        {partGroups.map((group, index) => {
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

        {(showMessageActions || onFeedback) && textContent && (
          <div className="flex items-center gap-1 mt-1">
            {showMessageActions && <MessageActions content={textContent} />}
            {onFeedback && (
              <MessageFeedback
                messageId={msg.id}
                feedback={feedbackMap[msg.id]}
                onFeedback={onFeedback}
              />
            )}
          </div>
        )}

        {messageSources.length > 0 && (
          <Sources sources={messageSources} onSourceClick={onSourceClick} />
        )}
      </div>
    </MessageItem>
  );
}
