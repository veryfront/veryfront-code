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
 * @module react/components/chat/composition/message
 */

import * as React from "react";
import type {
  BranchInfo,
  ChatDynamicToolPart,
  ChatMessage,
  ChatToolPart,
} from "#veryfront/agent/react";
import { cn } from "../../theme.ts";
import { Markdown } from "../../markdown.tsx";
import { MessageItem } from "#veryfront/react/primitives/index.ts";
import { MessageContextProvider, useMessageContext } from "../contexts/message-context.tsx";
import type { MessageContextValue } from "../contexts/message-context.tsx";
import { useChatContextOptional } from "../contexts/chat-context.tsx";
import type { FeedbackValue } from "../components/message-feedback.tsx";
import { MessageActions as ActionsImpl } from "../components/message-actions.tsx";
import { MessageFeedback as FeedbackImpl } from "../components/message-feedback.tsx";
import { BranchPicker as BranchPickerImpl } from "../components/branch-picker.tsx";
import { ReasoningCard } from "../components/reasoning.tsx";
import { SkillBadge } from "../components/skill-badge.tsx";
import { ToolCallCard } from "../components/tool-ui.tsx";
import { StepIndicator } from "../components/step-indicator.tsx";
import { Sources as SourcesImpl } from "../components/sources.tsx";
import type { Source } from "../components/sources.tsx";
import { AgentAvatar as AvatarImpl } from "./agent-avatar.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover.tsx";
import {
  extractSourcesFromParts,
  getAnswerPartsForRendering,
  getTextContentFromParts,
  groupPartsInOrder,
  isSkillToolPart,
} from "../utils/message-parts.ts";

// ---------------------------------------------------------------------------
// Message.Root
// ---------------------------------------------------------------------------

function metadataString(
  metadata: ChatMessage["metadata"] | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Props accepted by message root. */
export interface MessageRootProps {
  message: ChatMessage;
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
    const answerParts = React.useMemo(
      () =>
        getAnswerPartsForRendering(message.parts, {
          isAssistant: role !== "user",
        }),
      [message.parts, role],
    );
    const parts = React.useMemo(() => groupPartsInOrder(answerParts), [
      answerParts,
    ]);
    const textContent = React.useMemo(
      () => getTextContentFromParts(answerParts),
      [answerParts],
    );

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
      } catch (_) {
        /* expected: clipboard API unavailable, using fallback */
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
          // Studio `Message` anatomy: a full-width vertical column. Assistant
          // turns are left-aligned with a header (avatar + name + timestamp) on
          // top; user turns are right-aligned and capped at `max-w-[80%]`.
          className={cn(
            "group/msg flex w-full flex-col gap-1.5 text-[var(--foreground)]",
            isUser ? "ml-auto max-w-[80%] items-end" : "items-start",
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

interface MessageAvatarProps {
  className?: string;
}

function MessageAvatar(
  { className }: MessageAvatarProps,
): React.ReactElement | null {
  const { message, role } = useMessageContext();
  if (role === "user") return null;
  return (
    <AvatarImpl
      name={metadataString(message.metadata, "agentName") ??
        metadataString(message.metadata, "agentId")}
      avatarUrl={metadataString(message.metadata, "agentAvatarUrl")}
      model={metadataString(message.metadata, "model")}
      className={className}
    />
  );
}
MessageAvatar.displayName = "Message.Avatar";

// ---------------------------------------------------------------------------
// Message.Header — avatar + name + timestamp (Studio `ChatMessageHeader`)
// ---------------------------------------------------------------------------

interface MessageHeaderProps {
  className?: string;
}

/** Format a timestamp as a short `HH:MM` label (matches Studio's meta line). */
function formatTimestamp(createdAt: ChatMessage["createdAt"]): string {
  if (!createdAt) return "";
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Assistant message header — agent avatar (`size-8`) + name on the left, a
 * right-aligned timestamp. Ported 1:1 from Studio's `ChatMessageHeader`
 * (`pt-px pb-2`, `flex items-center gap-2`, name `font-medium`, timestamp
 * `text-sm ml-auto`). User turns have no header.
 */
function MessageHeader(
  { className }: MessageHeaderProps,
): React.ReactElement | null {
  const { message, role } = useMessageContext();
  if (role === "user") return null;

  const displayName = metadataString(message.metadata, "agentName") ??
    metadataString(message.metadata, "agentId") ?? "Assistant";
  const timestamp = formatTimestamp(message.createdAt);

  return (
    <div className={cn("flex items-center gap-2 pt-px pb-1", className)}>
      <AvatarImpl
        name={displayName}
        avatarUrl={metadataString(message.metadata, "agentAvatarUrl")}
        model={metadataString(message.metadata, "model")}
        className="size-8"
      />
      <span className="min-w-0 truncate font-medium">{displayName}</span>
      {timestamp && (
        <span
          className="ml-auto text-sm text-[var(--faint)]"
          suppressHydrationWarning
        >
          {timestamp}
        </span>
      )}
    </div>
  );
}
MessageHeader.displayName = "Message.Header";

// ---------------------------------------------------------------------------
// Message.Content
// ---------------------------------------------------------------------------

export interface MessageContentProps {
  renderTool?: (tool: ChatToolPart | ChatDynamicToolPart) => React.ReactNode;
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
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
          {textContent}
        </p>
      </div>
    );
  }

  const stepCount = parts.filter((g) => g.type === "step").length;
  const messageSources = shouldShowSources ? extractSourcesFromParts(message.parts) : [];

  return (
    <div
      className={cn(
        chat?.theme.message?.assistant,
        "flex-1 min-w-0",
        className,
      )}
    >
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
        const isSkill = isSkillToolPart(group.tool);
        return (
          <div
            key={group.tool.toolCallId}
            className={isSkill ? "my-2" : "my-3"}
          >
            {renderTool
              ? renderTool(group.tool)
              : isSkill
              ? <SkillBadge tool={group.tool} />
              : <ToolCallCard tool={group.tool} />}
          </div>
        );
      })}
      {messageSources.length > 0 && (
        <SourcesImpl
          sources={messageSources}
          onSourceClick={sourceClickHandler}
        />
      )}
    </div>
  );
}
MessageContent.displayName = "Message.Content";

// ---------------------------------------------------------------------------
// Message.Actions
// ---------------------------------------------------------------------------

interface MessageActionsWrapperProps {
  className?: string;
}

function MessageActionsWrapper(
  { className }: MessageActionsWrapperProps,
): React.ReactElement | null {
  const { textContent, onEdit, role } = useMessageContext();
  const chat = useChatContextOptional();
  if (!textContent) return null;
  // Regenerate only makes sense for assistant turns, and only when the host
  // wires a reload handler (Studio's `chat.regenerate()`).
  const onRegenerate = role !== "user" ? chat?.onReload : undefined;
  return (
    <ActionsImpl
      content={textContent}
      onEdit={onEdit}
      onRegenerate={onRegenerate}
      className={className}
    />
  );
}
MessageActionsWrapper.displayName = "Message.Actions";

// ---------------------------------------------------------------------------
// Message.Feedback
// ---------------------------------------------------------------------------

interface MessageFeedbackWrapperProps {
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
// Message.Tokens — token-usage popover (Studio `ChatTokenUsage`, tightened)
// ---------------------------------------------------------------------------

interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}

/** Compact token count — `726`, `79.8k`. */
function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function readUsage(metadata: ChatMessage["metadata"]): TokenUsage | undefined {
  const usage = metadata?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    inputTokens: num(u.inputTokens),
    outputTokens: num(u.outputTokens),
    reasoningTokens: num(u.reasoningTokens),
  };
}

interface TokenRowProps {
  label: string;
  value: string;
  bold?: boolean;
}

function TokenRow({ label, value, bold }: TokenRowProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-6 text-sm">
      <span className="text-[var(--faint)]">{label}</span>
      <span
        className={cn(
          "tabular-nums",
          bold ? "font-semibold" : "text-[var(--foreground)]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Token-usage popover. A subtle total count in the message footer opens a
 * breakdown (Model · Input · Output · Total). Tightened vs Studio's
 * `ChatTokenUsage` (smaller title, tighter rows, clearer hierarchy) and drops
 * the "Credits used" row (not relevant to open-source chat). Renders nothing
 * when the message carries no usage metadata.
 */
function MessageTokens(
  { className }: { className?: string },
): React.ReactElement | null {
  const { message, role } = useMessageContext();
  if (role === "user") return null;

  const usage = readUsage(message.metadata);
  const input = usage?.inputTokens ?? 0;
  const output = usage?.outputTokens ?? 0;
  const reasoning = usage?.reasoningTokens ?? 0;
  const total = input + output + reasoning;
  if (total === 0) return null;

  const model = metadataString(message.metadata, "model");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center rounded-full px-2 h-7 text-xs tabular-nums text-[var(--faint)] transition-colors hover:bg-[var(--tertiary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]",
            className,
          )}
          aria-label={`Token usage: ${total} total`}
        >
          {formatTokens(total)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="min-w-[200px] rounded-lg p-3"
      >
        <p className="mb-2 text-xs font-medium text-[var(--faint)]">
          Token usage
        </p>
        <div className="flex flex-col gap-1.5">
          {model && <TokenRow label="Model" value={model} />}
          <TokenRow label="Input" value={formatTokens(input)} />
          <TokenRow label="Output" value={formatTokens(output)} />
          <TokenRow label="Total" value={formatTokens(total)} bold />
        </div>
      </PopoverContent>
    </Popover>
  );
}
MessageTokens.displayName = "Message.Tokens";

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

// ---------------------------------------------------------------------------
// StandaloneMessage — non-compound convenience wrapper (Studio anatomy)
// ---------------------------------------------------------------------------

/** Props accepted by standalone message. */
export interface StandaloneMessageProps {
  message: ChatMessage;
  className?: string;
  /** Stream state — keeps the last row re-rendering while tokens arrive. */
  isStreaming?: boolean;
  /** Render inline citation sources under the answer. @default true */
  showSources?: boolean;
  /** Render multi-step indicators. @default true */
  showSteps?: boolean;
  /**
   * @deprecated The header now always shows the agent identity; kept for
   * back-compat with the old monolithic `Message` prop surface.
   */
  showRole?: boolean;
  /**
   * @deprecated The header now always shows the timestamp; kept for back-compat.
   */
  showTimestamp?: boolean;
}

/**
 * A self-contained chat turn assembled from the `Message.*` compound parts —
 * the common case where the caller doesn't need to recompose the layout. Gets
 * the full Studio anatomy for free: assistant header (avatar + name +
 * timestamp), reasoning, markdown, tool cards, right-aligned user turns, and a
 * hover action bar.
 */
export const StandaloneMessage = React.forwardRef<
  HTMLDivElement,
  StandaloneMessageProps
>(function StandaloneMessage(
  { message, className, isStreaming, showSources = true, showSteps = true },
  ref,
) {
  return (
    <MessageRoot
      ref={ref}
      message={message}
      isStreaming={isStreaming}
      className={className}
    >
      <MessageHeader />
      <MessageBranchPicker />
      <MessageContent showSources={showSources} showSteps={showSteps} />
      <div className="flex items-center gap-0.5">
        <MessageActionsWrapper />
        <MessageTokens />
      </div>
    </MessageRoot>
  );
});
StandaloneMessage.displayName = "StandaloneMessage";

/** Message shape for message. */
export const Message = Object.assign(MessageRoot, {
  Root: MessageRoot,
  Avatar: MessageAvatar,
  Header: MessageHeader,
  Content: MessageContent,
  Actions: MessageActionsWrapper,
  Feedback: MessageFeedbackWrapper,
  BranchPicker: MessageBranchPicker,
  Tokens: MessageTokens,
});
