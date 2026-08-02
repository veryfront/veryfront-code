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
export function ChatActionsTrigger(
  { children, className, ref, ...props }: ChatActionsTriggerProps,
): React.ReactElement {
  const triggerClassName = children == null ? undefined : className;
  return (
    <DropdownMenuTrigger asChild ref={ref} className={triggerClassName} {...props}>
      {children ?? (
        <Button
          type="button"
          variant="icon-tertiary"
          size="icon-lg"
          aria-label="Add attachments and settings"
          className={cn("shrink-0", className)}
        >
          <PlusIcon />
        </Button>
      )}
    </DropdownMenuTrigger>
  );
}
ChatActionsTrigger.displayName = "ChatActions.Trigger";
