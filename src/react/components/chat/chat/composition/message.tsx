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
import type { BranchInfo, ChatMessage } from "#veryfront/agent/react";
import { cn, defaultChatTheme } from "../../theme.ts";
import type { CodeBlockProps, Components } from "../../markdown.tsx";
import type { PartGroup } from "../utils/message-parts.ts";
import { MessageItem } from "#veryfront/react/primitives/index.ts";
import { MessageContextProvider, useMessageContext } from "../contexts/message-context.tsx";
import type { MessageContextValue } from "../contexts/message-context.tsx";
import { useChatContextOptional } from "../contexts/chat-context.tsx";
import type { FeedbackValue } from "../components/message-feedback.tsx";
import { useClipboard } from "../hooks/use-clipboard.ts";
import { Slot } from "../../../ui/slot.tsx";
import { CheckIcon, CopyIcon, PencilIcon, RefreshCwIcon } from "../../../ui/icons/index.ts";
import { MessageFeedback as FeedbackImpl } from "../components/message-feedback.tsx";
import { BranchPicker as BranchPickerImpl } from "../components/branch-picker.tsx";
import { Shimmer } from "../../../ui/shimmer.tsx";
import { AttachmentPill } from "../components/attachment-pill.tsx";
import type { Source } from "../components/sources.tsx";
import { AgentAvatar as AvatarImpl } from "./agent-avatar.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../../ui/popover.tsx";
import { MessageSources } from "./message-sources.tsx";
export type { MessageSourcesProps } from "./message-sources.tsx";
import {
  MessagePart,
  MessageReasoning,
  MessageSource,
  MessageText,
  renderAnswerPart,
} from "./message-body.tsx";
export type {
  MessagePartProps,
  MessageReasoningProps,
  MessageSourceProps,
  MessageTextProps,
} from "./message-body.tsx";
import {
  getAnswerPartsForRendering,
  getTextContentFromParts,
  groupPartsInOrder,
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
  /**
   * Whether this turn is still streaming. Omit to derive it from
   * `ChatContext` (`streamingMessageId === message.id`) so a hand-composed
   * transcript never has to compute an off-by-one index. Pass a boolean only
   * to override the context (e.g. rendering outside a live chat).
   */
  isStreaming?: boolean;
  children: React.ReactNode;
  className?: string;

  // Optional overrides — falls back to ChatContext when available
  editMessage?: (messageId: string, newText: string) => Promise<void>;
  getBranches?: (messageId: string) => BranchInfo;
  switchBranch?: (messageId: string, branchIndex: number) => void;
  onFeedback?: (messageId: string, feedback: FeedbackValue) => void;
  feedback?: FeedbackValue | null;
  /** Regenerate this turn — surfaces the retry button in `Message.Actions`. */
  onReload?: () => void;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

function MessageRoot(
  { message, isStreaming, children, className, ref, ...overrides }: MessageRootProps,
): React.ReactElement {
  {
    const chat = useChatContextOptional();
    const role = message.role as MessageContextValue["role"];
    // Derive streaming from context unless the caller pins it explicitly.
    const resolvedStreaming = isStreaming ??
      (chat?.streamingMessageId != null && chat.streamingMessageId === message.id);
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
    // Regenerate only applies to assistant turns (Studio `chat.regenerate()`).
    const onReload = overrides.onReload ?? chat?.onReload;

    const branch = React.useMemo(
      () => getBranches?.(message.id) ?? null,
      [getBranches, message.id],
    );

    const { copied, copy } = useClipboard();
    const onCopy = React.useCallback(
      () => copy(textContent),
      [copy, textContent],
    );

    const contextValue = React.useMemo<MessageContextValue>(
      () => ({
        message,
        role,
        isStreaming: resolvedStreaming,
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
        copied,
        onEdit: editMessage
          ? (content: string) => {
            editMessage(message.id, content);
          }
          : undefined,
        onFeedback: onFeedbackProp
          ? (value: FeedbackValue) => onFeedbackProp(message.id, value)
          : undefined,
        onRegenerate: role !== "user" && onReload ? onReload : undefined,
        feedback: overrides.feedback,
      }),
      [
        message,
        message.id,
        role,
        resolvedStreaming,
        parts,
        onReload,
        textContent,
        branch,
        switchBranch,
        onCopy,
        copied,
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
  }
}
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
  const chat = useChatContextOptional();
  if (role === "user") return null;
  return (
    <AvatarImpl
      name={metadataString(message.metadata, "agentName") ??
        chat?.agent?.name ??
        metadataString(message.metadata, "agentId")}
      avatarUrl={metadataString(message.metadata, "agentAvatarUrl") ??
        chat?.agent?.avatarUrl ?? undefined}
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
  /** Compose the header's inner row yourself; omit for the default anatomy. */
  children?: React.ReactNode;
}

/** Format a timestamp as a short `HH:MM` label (matches Studio's meta line). */
function formatTimestamp(createdAt: ChatMessage["createdAt"]): string {
  if (!createdAt) return "";
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Props for `Message.Header.Name`. */
export interface MessageHeaderNameProps {
  className?: string;
  /** Override the default agent/author label. */
  children?: React.ReactNode;
}

/**
 * The agent/author name shown in the header. Reads the same identity from
 * `MessageContext` (+ optional `ChatContext`) the default header uses — with no
 * agent it falls back to the `"Assistant"` placeholder. Pass `children` to
 * replace the text without losing the styling/position.
 */
function MessageHeaderName(
  { className, children }: MessageHeaderNameProps,
): React.ReactElement {
  const { message } = useMessageContext();
  const chat = useChatContextOptional();
  // The label carries the "Assistant" placeholder; the avatar deliberately does
  // NOT (so `AgentAvatar` can fall back to the provider logomark for `model`).
  const agentName = metadataString(message.metadata, "agentName") ??
    chat?.agent?.name ??
    metadataString(message.metadata, "agentId");
  const displayName = agentName ?? "Assistant";
  return (
    <span className={cn("min-w-0 truncate font-medium", className)}>
      {children ?? displayName}
    </span>
  );
}
MessageHeaderName.displayName = "Message.Header.Name";

/** Props for `Message.Header.Timestamp`. */
export interface MessageHeaderTimestampProps {
  className?: string;
}

/**
 * The right-aligned `HH:MM` timestamp in the header (`ml-auto`). Reads
 * `message.createdAt` from context and renders nothing when there's no valid
 * time — identical to the default header's inline behaviour.
 */
function MessageHeaderTimestamp(
  { className }: MessageHeaderTimestampProps,
): React.ReactElement | null {
  const { message } = useMessageContext();
  const timestamp = formatTimestamp(message.createdAt);
  if (!timestamp) return null;
  return (
    <span
      className={cn("ml-auto text-sm text-[var(--faint)]", className)}
      suppressHydrationWarning
    >
      {timestamp}
    </span>
  );
}
MessageHeaderTimestamp.displayName = "Message.Header.Timestamp";

/**
 * Assistant message header — agent avatar (`size-8`) + name on the left, a
 * right-aligned timestamp. Ported 1:1 from Studio's `ChatMessageHeader`
 * (`pt-px pb-2`, `flex items-center gap-2`, name `font-medium`, timestamp
 * `text-sm ml-auto`). User turns have no header. Pass `children` to recompose
 * the inner row from `Message.Header.Name` / `Message.Header.Timestamp`.
 */
function MessageHeader(
  { className, children }: MessageHeaderProps,
): React.ReactElement | null {
  const { message, role } = useMessageContext();
  const chat = useChatContextOptional();
  if (role === "user") return null;

  // The avatar gets only REAL agent identity (like `Message.Avatar`): with no
  // agent, `AgentAvatar` falls back to the provider logomark for
  // `metadata.model`. Folding the "Assistant" placeholder into `name` would
  // make that fallback unreachable — the label below still shows it.
  const agentName = metadataString(message.metadata, "agentName") ??
    chat?.agent?.name ??
    metadataString(message.metadata, "agentId");
  const avatarUrl = metadataString(message.metadata, "agentAvatarUrl") ??
    chat?.agent?.avatarUrl ?? undefined;

  return (
    // `w-full` so the timestamp's `ml-auto` reaches the right edge — the Root
    // is `items-start`, which would otherwise shrink the header to its content.
    <div className={cn("flex w-full items-center gap-2 pt-px pb-3", className)}>
      {children ?? (
        <>
          <AvatarImpl
            name={agentName}
            avatarUrl={avatarUrl}
            model={metadataString(message.metadata, "model")}
            className="size-8"
          />
          <MessageHeaderName />
          <MessageHeaderTimestamp />
        </>
      )}
    </div>
  );
}
MessageHeader.displayName = "Message.Header";

/** `Message.Header` compound — the header row plus its addressable leaves. */
const MessageHeaderCompound = Object.assign(MessageHeader, {
  Name: MessageHeaderName,
  Timestamp: MessageHeaderTimestamp,
});

// ---------------------------------------------------------------------------
// Message.Content
// ---------------------------------------------------------------------------

/** A stable React key for a grouped part (preserves streaming reconciliation). */
function groupKey(group: PartGroup, index: number): string {
  switch (group.type) {
    case "text":
      return `text-${index}`;
    case "reasoning":
      return `reasoning-${index}`;
    case "step":
      return `step-${group.stepIndex}`;
    case "file":
      return `file-${index}`;
    default:
      return group.tool.toolCallId;
  }
}

export interface MessageContentProps {
  className?: string;
  /** Swap the code block used in the answer markdown (forwarded to `Markdown`). */
  codeBlock?: (props: CodeBlockProps) => React.ReactNode;
  /** Override markdown element renderers (merged over the built-in defaults). */
  markdownComponents?: Components;
  /**
   * Compose the body yourself. Receives each grouped part in order; return a
   * node (a `Message.Part`, a `Message.*` sub-part, or your own markup). When
   * provided you own the whole body — sources are NOT auto-appended, so add a
   * `Message.Sources` where you want them.
   */
  children?: (part: PartGroup, index: number) => React.ReactNode;
}

function MessageContent({
  className,
  codeBlock,
  markdownComponents,
  children,
}: MessageContentProps): React.ReactElement {
  const { message, role, parts, textContent } = useMessageContext();
  const chat = useChatContextOptional();

  if (role === "user") {
    const fileParts = message.parts.filter((p) => p.type === "file");
    return (
      <div
        className={cn(
          chat?.theme.message?.user ?? defaultChatTheme.message?.user,
          className,
        )}
      >
        {fileParts.length > 0 && (
          <div className="mb-2 flex flex-wrap justify-end gap-2">
            {fileParts.map((file, index) => (
              <AttachmentPill
                key={`file-${index}`}
                className="w-[200px]"
                attachment={{
                  id: `file-${index}`,
                  name: file.filename ?? "Attachment",
                  type: file.mediaType,
                  url: file.url,
                  // Read-only sent attachment → show type/size, not "Uploaded".
                  ...(file.size != null ? { size: file.size } : {}),
                  preview: file.mediaType.startsWith("image/") ? file.url : undefined,
                }}
              />
            ))}
          </div>
        )}
        {textContent && (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
            {textContent}
          </p>
        )}
      </div>
    );
  }

  const stepCount = parts.filter((g) => g.type === "step").length;
  const compose = typeof children === "function";

  return (
    <div
      className={cn(
        chat?.theme.message?.assistant ?? defaultChatTheme.message?.assistant,
        // `w-full` because `Message.Root` is `items-start`, which would
        // otherwise shrink this column to its widest child — a lone tool card
        // (`w-full`) would render narrow until streamed text widened the
        // column. Mirrors the same workaround on `Message.Header`.
        // `flex flex-col gap-2.5` owns the spacing *between* parts (text,
        // reasoning, tool cards) — gaps apply between siblings only, so there's
        // no leading gap under the header and no per-part margins to juggle.
        "flex w-full flex-col gap-2.5 flex-1 min-w-0",
        className,
      )}
    >
      {parts.map((group, index) => (
        <React.Fragment key={groupKey(group, index)}>
          {compose ? children(group, index) : renderAnswerPart(group, {
            stepCount,
            codeBlock,
            markdownComponents,
          })}
        </React.Fragment>
      ))}
    </div>
  );
}
MessageContent.displayName = "Message.Content";

// ---------------------------------------------------------------------------
// Message.Actions — the reference render-or-compose pattern.
//
// `<Message.Actions />` renders the default cluster (copy / regenerate); pass
// children to compose your own bar from the individual action sub-parts
// (`Message.CopyAction`, `Message.EditAction`, …), each of which reads its
// handler + state from context. `Message.EditAction` stays available but is off
// by default. Every sub-part accepts `icon`, `className`, `asChild`, and an
// `onClick(e, next)` wrap-signature so you can log-then-run or fully replace the
// default without ejecting.
// ---------------------------------------------------------------------------

const ACTION_BUTTON =
  "inline-flex items-center justify-center size-7 rounded-full text-[var(--faint)] transition-colors hover:bg-[var(--tertiary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";

/** Shared props for the individual `Message.*Action` sub-parts. */
export interface MessageActionProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  /** Override the button's icon (ignored when `asChild`). */
  icon?: React.ReactNode;
  /** Render onto a supplied child element (Slot) instead of a `<button>`. */
  asChild?: boolean;
  /** Runs before the default action; call `next()` to invoke it (or skip it). */
  onClick?: (event: React.MouseEvent<HTMLElement>, next: () => void) => void;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** Internal button shared by every action sub-part. */
function ActionButton(
  {
    icon,
    asChild,
    onClick,
    className,
    children,
    label,
    defaultIcon,
    action,
    ref,
    ...props
  }: MessageActionProps & {
    label: string;
    defaultIcon: React.ReactNode;
    action: () => void;
  },
): React.ReactElement {
  const handleClick = (e: React.MouseEvent<HTMLElement>) => onClick ? onClick(e, action) : action();

  if (asChild) {
    return (
      <Slot
        ref={ref}
        {...props}
        className={cn(ACTION_BUTTON, className)}
        onClick={handleClick}
      >
        {children}
      </Slot>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      aria-label={label}
      title={label}
      className={cn(ACTION_BUTTON, className)}
      onClick={handleClick}
    >
      {icon ?? defaultIcon}
    </button>
  );
}
ActionButton.displayName = "Message.ActionButton";

/** Copy the message text. Reads `onCopy`/`copied`/`textContent` from context. */
export function MessageCopyAction(
  props: MessageActionProps,
): React.ReactElement | null {
  const { onCopy, copied, textContent } = useMessageContext();
  if (!textContent) return null;
  return (
    <ActionButton
      ref={props.ref}
      {...props}
      label={copied ? "Copied!" : "Copy to clipboard"}
      defaultIcon={copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      action={() => void onCopy()}
    />
  );
}
MessageCopyAction.displayName = "Message.CopyAction";

/** Regenerate this turn. Renders only when `onRegenerate` is available. */
export function MessageRegenerateAction(
  props: MessageActionProps,
): React.ReactElement | null {
  const { onRegenerate } = useMessageContext();
  if (!onRegenerate) return null;
  return (
    <ActionButton
      ref={props.ref}
      {...props}
      label="Regenerate response"
      defaultIcon={<RefreshCwIcon className="size-3.5" />}
      action={onRegenerate}
    />
  );
}
MessageRegenerateAction.displayName = "Message.RegenerateAction";

/** Edit this message. Renders only when `onEdit` is available. */
export function MessageEditAction(
  props: MessageActionProps,
): React.ReactElement | null {
  const { onEdit, textContent } = useMessageContext();
  if (!onEdit || !textContent) return null;
  return (
    <ActionButton
      ref={props.ref}
      {...props}
      label="Edit message"
      defaultIcon={<PencilIcon className="size-3.5" />}
      action={() => onEdit(textContent)}
    />
  );
}
MessageEditAction.displayName = "Message.EditAction";

/** Props accepted by `<Message.Actions>`. */
export interface MessageActionsProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Compose your own bar; when omitted, the default cluster is rendered. */
  children?: React.ReactNode;
}

function MessageActionsWrapper(
  { children, className, ...props }: MessageActionsProps,
): React.ReactElement | null {
  const { textContent } = useMessageContext();
  if (!textContent) return null;
  return (
    <div
      {...props}
      className={cn(
        "flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-all duration-200",
        className,
      )}
    >
      {children ?? (
        <>
          <MessageCopyAction />
          <MessageRegenerateAction />
        </>
      )}
    </div>
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

// Message.Tokens — token-usage popover (Studio `ChatTokenUsage`, tightened)

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

/** One row in the token usage breakdown. */
export interface TokenRowProps {
  label: string;
  value: string;
  bold?: boolean;
}

/** Props accepted by `Message.Tokens`. */
export interface MessageTokensProps {
  className?: string;
  /** Override how each breakdown row renders (Model / Input / Output / Total). */
  renderItem?: (options: { item: TokenRowProps; index: number }) => React.ReactNode;
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
  { className, renderItem }: MessageTokensProps,
): React.ReactElement | null {
  const { message, role } = useMessageContext();
  const [open, setOpen] = React.useState(false);
  if (role === "user") return null;

  const usage = readUsage(message.metadata);
  const input = usage?.inputTokens ?? 0;
  const output = usage?.outputTokens ?? 0;
  const reasoning = usage?.reasoningTokens ?? 0;
  const total = input + output + reasoning;
  if (total === 0) return null;

  const model = metadataString(message.metadata, "model");
  const rows: TokenRowProps[] = [
    ...(model ? [{ label: "Model", value: model }] : []),
    { label: "Input", value: formatTokens(input) },
    { label: "Output", value: formatTokens(output) },
    { label: "Total", value: formatTokens(total), bold: true },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center rounded-full px-2 h-7 text-xs tabular-nums text-[var(--faint)] transition-all hover:bg-[var(--tertiary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]",
            // Hidden until the message is hovered — matching the action
            // buttons — but stays visible while its popover is open.
            "opacity-0 transition-opacity group-hover/msg:opacity-100 focus-visible:opacity-100",
            open && "opacity-100",
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
          {rows.map((row, index) =>
            renderItem
              ? <React.Fragment key={row.label}>{renderItem({ item: row, index })}</React.Fragment>
              : <TokenRow key={row.label} {...row} />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
MessageTokens.displayName = "Message.Tokens";

// Message.BranchPicker

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
// Message.Continuing — "Continuing…" shimmer while the turn is still streaming
// (Studio `ChatMessageView` showContinuing). Renders nothing when not streaming.
// ---------------------------------------------------------------------------

function MessageContinuing(
  { className, children }: { className?: string; children?: React.ReactNode },
): React.ReactElement | null {
  const { isStreaming } = useMessageContext();
  if (!isStreaming) return null;
  return (
    <div className={cn("mt-3 text-sm", className)}>
      {children ?? <Shimmer duration={1}>Continuing...</Shimmer>}
    </div>
  );
}
MessageContinuing.displayName = "Message.Continuing";

// ---------------------------------------------------------------------------
// Message — compound export
// ---------------------------------------------------------------------------

export type { MessageContentProps as MessageCompoundContentProps, MessageContextValue };

// ---------------------------------------------------------------------------
// Message — render-or-compose
//
// `<Message message={msg} />` renders the full Studio anatomy (header, content,
// reasoning, tools, "Continuing…" shimmer, hover action bar). Pass `children`
// (via `Message.Root`/`Message.Header`/…) to recompose the layout yourself.
// Mirrors the `Chat` preset: render it, or compose it — userland decides.
// ---------------------------------------------------------------------------

/** Props accepted by `<Message />`. */
export interface MessageProps extends Omit<MessageRootProps, "children"> {
  /** Compose your own layout; when omitted, the default anatomy is rendered. */
  children?: React.ReactNode;
  /** Handle a source selection in the default `Message.Sources` anatomy. */
  onSourceClick?: (source: Source, index: number) => void;
}

/** The default anatomy rendered when `<Message>` gets no children. */
function MessageDefault(
  { onSourceClick }: Pick<MessageProps, "onSourceClick">,
): React.ReactElement {
  return (
    <>
      <MessageHeader />
      <MessageContent />
      <MessageSources onSourceClick={onSourceClick} />
      <MessageContinuing />
      <div className="mt-1.5 flex items-center gap-0.5">
        <MessageActionsWrapper />
        <MessageTokens />
      </div>
    </>
  );
}

function MessageComponent(
  { children, onSourceClick, ref, ...root }: MessageProps,
): React.ReactElement {
  return (
    <MessageRoot ref={ref} {...root}>
      {children ?? <MessageDefault onSourceClick={onSourceClick} />}
    </MessageRoot>
  );
}
MessageComponent.displayName = "Message";

/**
 * Message — render `<Message message={msg} />` for the default turn, or compose
 * `Message.Root` + `Message.Header`/`Content`/`Actions`/… for a custom layout.
 */
export const Message = Object.assign(MessageComponent, {
  Root: MessageRoot,
  Avatar: MessageAvatar,
  Header: MessageHeaderCompound,
  Content: MessageContent,
  Part: MessagePart,
  Text: MessageText,
  Reasoning: MessageReasoning,
  Source: MessageSource,
  Sources: MessageSources,
  Actions: MessageActionsWrapper,
  CopyAction: MessageCopyAction,
  RegenerateAction: MessageRegenerateAction,
  EditAction: MessageEditAction,
  Feedback: MessageFeedbackWrapper,
  BranchPicker: MessageBranchPicker,
  Tokens: MessageTokens,
  Continuing: MessageContinuing,
});
