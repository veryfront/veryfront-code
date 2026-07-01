/**
 * ChatEmptyState — the conversation idle / empty view: an agent avatar, a
 * heading, and a row of suggestion chips. Ported 1:1 from Veryfront Studio's
 * `ChatIdleView` family (`ChatIdleView` + `…Avatar` + `…Heading` +
 * `Suggestions`/`SuggestionItem`), restyled onto the chat primitives.
 *
 * Composed via children — every part is a small, focused piece you arrange
 * yourself, so there is no monolithic prop surface:
 *
 * ```tsx
 * <ChatEmptyState.Root>
 *   <ChatEmptyState.Avatar src={agent.avatarUrl} alt={agent.name} />
 *   <ChatEmptyState.Heading>{agent.name}</ChatEmptyState.Heading>
 *   <ChatEmptyState.Suggestions>
 *     <ChatEmptyState.Suggestion onClick={() => send("Create a plan")}>
 *       Create a plan
 *     </ChatEmptyState.Suggestion>
 *   </ChatEmptyState.Suggestions>
 * </ChatEmptyState.Root>
 * ```
 *
 * @module react/components/chat/composition/chat-empty-state
 */
import * as React from "react";
import { cn } from "../../theme.ts";
import { Avatar, Button, type ButtonProps } from "../../ui/index.ts";

/** Props accepted by `<ChatEmptyState.Root>`. */
export interface ChatEmptyStateRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>;
}

/** Centered container for the empty-state pieces. */
function Root({
  className,
  children,
  ref,
  ...props
}: ChatEmptyStateRootProps): React.ReactElement {
  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-3.5 px-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Props accepted by `<ChatEmptyState.Avatar>`. */
export interface ChatEmptyStateAvatarProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  src?: string;
  alt?: string;
  /** Pulse while the agent is being provisioned. */
  isCreating?: boolean;
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * Hero agent avatar (64px). Renders the generic {@link Avatar} in `muted`
 * tone — the agent's image when `src` resolves, otherwise its initial. Same as
 * Studio's `ChatIdleView` avatar: agent identity comes from the data, not a
 * bespoke component.
 */
function EmptyStateAvatar({
  className,
  isCreating,
  src,
  alt = "Veryfront Agent",
  ...props
}: ChatEmptyStateAvatarProps): React.ReactElement {
  return (
    <Avatar
      name={alt}
      avatarSrc={src}
      tone="muted"
      className={cn("size-16!", isCreating && "animate-pulse", className)}
      {...props}
    />
  );
}

/** Props accepted by `<ChatEmptyState.Heading>`. */
export interface ChatEmptyStateHeadingProps
  extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level, `1`–`6`. Defaults to `2`. */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  ref?: React.Ref<HTMLHeadingElement>;
}

/** Balanced, centered title (e.g. the agent name). */
function Heading({
  level = 2,
  className,
  children,
  ref,
  ...props
}: ChatEmptyStateHeadingProps): React.ReactElement {
  const Tag = `h${level}` as const;
  return (
    <Tag
      ref={ref}
      className={cn(
        "text-[1.375rem] font-semibold text-balance text-center leading-[1.2] tracking-normal text-[var(--foreground)]",
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

/** Props accepted by `<ChatEmptyState.Suggestions>`. */
export interface ChatEmptyStateSuggestionsProps
  extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>;
}

/** Wrapping, centered row of suggestion chips. */
function Suggestions({
  className,
  role = "group",
  children,
  ref,
  ...props
}: ChatEmptyStateSuggestionsProps): React.ReactElement {
  return (
    <div
      ref={ref}
      role={role}
      className={cn("mt-4 flex flex-wrap justify-center gap-2", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/** Props accepted by `<ChatEmptyState.Suggestion>`. */
export interface ChatEmptyStateSuggestionProps extends Omit<ButtonProps, "variant"> {}

/** A single filled suggestion chip. */
function Suggestion({
  className,
  size = "sm",
  children,
  ...props
}: ChatEmptyStateSuggestionProps): React.ReactElement {
  return (
    <Button
      variant="tertiary"
      size={size}
      className={cn("h-9! rounded-md! px-3.5", className)}
      {...props}
    >
      {children}
    </Button>
  );
}

/**
 * Compound empty state. Use the namespaced parts to compose the view:
 * `Root`, `Avatar`, `Heading`, `Suggestions`, `Suggestion`.
 */
export const ChatEmptyState = {
  Root,
  Avatar: EmptyStateAvatar,
  Heading,
  Suggestions,
  Suggestion,
};
