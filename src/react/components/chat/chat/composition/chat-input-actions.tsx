/**
 * Native button leaves for the ChatInput composer.
 *
 * @module react/components/chat/chat/composition/chat-input-actions
 */
import * as React from "react";
import { ArrowUpIcon, StopIcon } from "../../../ui/icons/index.ts";
import { Button } from "../../../ui/button.tsx";
import { cn } from "../../theme.ts";
import { useChatInputContext } from "../contexts/composer-context.tsx";
import { getChatInputActionType } from "./chat-input-action-semantics.ts";
import type { ChatInputActionProps, ChatInputSubmitProps } from "./chat-composer.types.ts";

/** Microphone glyph for the idle-composer voice button. */
function MicGlyph(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

/** Send button, shown while the composer is idle. */
export function ChatInputSend({
  children,
  icon,
  className,
  asChild,
  onClick,
  ref,
  disabled,
  "aria-label": ariaLabel,
  ...buttonProps
}: ChatInputActionProps): React.ReactElement | null {
  const c = useChatInputContext();
  if (c.isLoading) return null;
  if (!c.canSubmit && c.onVoice) return null;
  const run = () => c.onSubmit();
  return (
    <Button
      {...buttonProps}
      ref={ref}
      type={getChatInputActionType(asChild, children)}
      asChild={asChild}
      variant="icon-primary"
      on="card"
      size="icon-lg"
      aria-label={ariaLabel ?? "Send"}
      disabled={disabled || !c.canSubmit}
      onClick={(event: React.MouseEvent<HTMLElement>) => onClick ? onClick(event, run) : run()}
      className={cn("shrink-0", className)}
    >
      {children ?? icon ?? <ArrowUpIcon />}
    </Button>
  );
}
ChatInputSend.displayName = "ChatInput.Send";

/** Stop button, shown while the composer is streaming. */
export function ChatInputStop({
  children,
  icon,
  className,
  asChild,
  onClick,
  ref,
  disabled,
  "aria-label": ariaLabel,
  ...buttonProps
}: ChatInputActionProps): React.ReactElement | null {
  const c = useChatInputContext();
  if (!c.isLoading) return null;
  const run = () => c.onStop?.();
  return (
    <Button
      {...buttonProps}
      ref={ref}
      type={getChatInputActionType(asChild, children)}
      asChild={asChild}
      variant="icon-ghost"
      size="icon-lg"
      aria-label={ariaLabel ?? "Stop"}
      disabled={disabled}
      onClick={(event: React.MouseEvent<HTMLElement>) => onClick ? onClick(event, run) : run()}
      className={cn("shrink-0", className)}
    >
      {children ?? icon ?? <StopIcon />}
    </Button>
  );
}
ChatInputStop.displayName = "ChatInput.Stop";

/**
 * Unified submit control: renders {@link ChatInputStop} while a turn is
 * streaming and {@link ChatInputSend} otherwise, so the common case needs one
 * control instead of wiring Send and Stop and relying on their internal
 * visibility. Send and Stop remain available as low-level escapes.
 */
export function ChatInputSubmit(
  { children, icon, stopIcon, asChild, ...rest }: ChatInputSubmitProps,
): React.ReactElement | null {
  const c = useChatInputContext();
  return c.isLoading
    ? (
      <ChatInputStop icon={stopIcon} asChild={asChild} {...rest}>
        {asChild ? children : undefined}
      </ChatInputStop>
    )
    : (
      <ChatInputSend icon={icon} asChild={asChild} {...rest}>
        {children}
      </ChatInputSend>
    );
}
ChatInputSubmit.displayName = "ChatInput.Submit";

/** Voice button, shown when the idle composer is empty. */
export function ChatInputVoice({
  children,
  icon,
  className,
  asChild,
  onClick,
  ref,
  disabled,
  "aria-label": ariaLabel,
  ...buttonProps
}: ChatInputActionProps): React.ReactElement | null {
  const c = useChatInputContext();
  if (c.isLoading || c.canSubmit || !c.onVoice) return null;
  const run = () => c.onVoice?.();
  return (
    <Button
      {...buttonProps}
      ref={ref}
      type={getChatInputActionType(asChild, children)}
      asChild={asChild}
      variant="icon-ghost"
      on="card"
      size="icon-lg"
      aria-label={ariaLabel ?? "Voice input"}
      aria-pressed={c.isListening}
      disabled={disabled}
      onClick={(event: React.MouseEvent<HTMLElement>) => onClick ? onClick(event, run) : run()}
      className={cn(
        "shrink-0",
        c.isListening && "bg-[var(--primary)] text-[var(--secondary)]",
        className,
      )}
    >
      {children ?? icon ?? <MicGlyph />}
    </Button>
  );
}
ChatInputVoice.displayName = "ChatInput.Voice";
