/**
 * Trigger leaf for the ChatActions compound.
 *
 * @module react/components/chat/chat-actions-trigger
 */
import * as React from "react";
import { Button } from "../ui/button.tsx";
import { DropdownMenuTrigger } from "../ui/dropdown-menu.tsx";
import { PlusIcon } from "../ui/icons/index.ts";
import { cn } from "./theme.ts";
import type {
  ChatActionsSlottedTriggerProps,
  ChatActionsTriggerProps,
} from "./chat-actions.types.ts";

type ChatActionsCustomTriggerProps<T extends HTMLElement> =
  | ChatActionsSlottedTriggerProps<T>
  | (ChatActionsTriggerProps & { children: React.ReactElement });

function hasCustomTrigger<T extends HTMLElement>(
  props: ChatActionsTriggerProps | ChatActionsSlottedTriggerProps<T>,
): props is ChatActionsCustomTriggerProps<T> {
  return React.isValidElement(props.children);
}

/**
 * `ChatActions.Trigger` renders through the dropdown's `asChild` slot. Custom
 * children receive trigger props and classes; the childless path renders the
 * standard `+` button.
 */
export function ChatActionsTrigger<T extends HTMLElement = HTMLElement>(
  triggerProps: ChatActionsSlottedTriggerProps<T>,
): React.ReactElement;
export function ChatActionsTrigger(
  triggerProps: ChatActionsTriggerProps,
): React.ReactElement;
export function ChatActionsTrigger<T extends HTMLElement = HTMLElement>(
  triggerProps: ChatActionsTriggerProps | ChatActionsSlottedTriggerProps<T>,
): React.ReactElement {
  if (triggerProps.children != null && !React.isValidElement(triggerProps.children)) {
    throw new TypeError("ChatActions.Trigger children must be one valid React element");
  }
  if (hasCustomTrigger(triggerProps)) {
    const { children, className, ref, asChild: _asChild, ...props } = triggerProps;
    return (
      <DropdownMenuTrigger
        asChild
        ref={ref as React.Ref<HTMLElement>}
        className={className}
        {...(props as React.HTMLAttributes<HTMLElement>)}
      >
        {children}
      </DropdownMenuTrigger>
    );
  }

  const {
    children: _children,
    className,
    ref,
    type,
    asChild: _asChild,
    "aria-label": ariaLabel,
    ...props
  } = triggerProps;
  return (
    <DropdownMenuTrigger asChild ref={ref} {...props}>
      <Button
        type={type ?? "button"}
        variant="icon-tertiary"
        size="icon-lg"
        aria-label={ariaLabel ?? "Add attachments and settings"}
        className={cn("shrink-0", className)}
      >
        <PlusIcon />
      </Button>
    </DropdownMenuTrigger>
  );
}
ChatActionsTrigger.displayName = "ChatActions.Trigger";
