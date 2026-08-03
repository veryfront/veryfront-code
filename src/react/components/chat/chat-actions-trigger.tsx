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
import type { ChatActionsTriggerProps } from "./chat-actions.types.ts";

/**
 * `ChatActions.Trigger` renders through the dropdown's `asChild` slot. Custom
 * children receive trigger props and classes; the childless path renders the
 * standard `+` button.
 */
export function ChatActionsTrigger<T extends HTMLElement = HTMLElement>(
  triggerProps: ChatActionsTriggerProps<T>,
): React.ReactElement {
  if (triggerProps.children != null) {
    const { children, className, ref, ...props } = triggerProps;
    return (
      <DropdownMenuTrigger<T>
        asChild
        ref={ref}
        className={className}
        {...props}
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
    "aria-label": ariaLabel,
    ...props
  } = triggerProps;
  return (
    <DropdownMenuTrigger<HTMLButtonElement> asChild ref={ref} {...props}>
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
