/**
 * Unified send/stop control for the ChatInput composer.
 *
 * @module react/components/chat/chat/composition/chat-input-submit
 */
import * as React from "react";
import { useChatInputContext } from "../contexts/composer-context.tsx";
import { ChatInputSend, ChatInputStop } from "./chat-input-actions.tsx";
import type {
  ChatInputSlottedActionProps,
  ChatInputSlottedSubmitProps,
  ChatInputSubmitProps,
} from "./chat-composer.types.ts";

function isSlottedSubmit<T extends HTMLElement>(
  props: ChatInputSubmitProps | ChatInputSlottedSubmitProps<T>,
): props is ChatInputSlottedSubmitProps<T> {
  return props.asChild === true && React.isValidElement(props.children);
}

/** Switch between send and stop states with one control. */
export function ChatInputSubmit<T extends HTMLElement = HTMLElement>(
  props: ChatInputSlottedSubmitProps<T>,
): React.ReactElement | null;
export function ChatInputSubmit(props: ChatInputSubmitProps): React.ReactElement | null;
export function ChatInputSubmit<T extends HTMLElement = HTMLElement>(
  props: ChatInputSubmitProps | ChatInputSlottedSubmitProps<T>,
): React.ReactElement | null {
  const c = useChatInputContext();
  if (isSlottedSubmit(props)) {
    const { children, ...actionProps } = props;
    // Rest destructuring cannot preserve a generic conditional mapped type;
    // the type guard above establishes this exact slotted contract.
    const slottedAction = {
      ...actionProps,
      children,
    } as ChatInputSlottedActionProps<T>;
    const loadingAction = actionProps as ChatInputSlottedActionProps<T>;
    return c.isLoading
      ? <ChatInputStop<T> {...loadingAction} />
      : <ChatInputSend<T> {...slottedAction} />;
  }
  const { children, ...actionProps } = props;
  return c.isLoading
    ? <ChatInputStop {...actionProps} />
    : <ChatInputSend {...actionProps}>{children}</ChatInputSend>;
}
ChatInputSubmit.displayName = "ChatInput.Submit";
