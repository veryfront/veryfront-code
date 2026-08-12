/**
 * ChatInput.Attach — the composer's `+` attachment control.
 *
 * Split out of `chat-composer.tsx` so the composer stays under its LOC ceiling.
 * When attaching files is the only action, `+` opens the file dialog directly;
 * when `onSelectAttachment` is also set it becomes a portalled `+` menu (Studio
 * `PromptForm`'s `PlusMenu`).
 *
 * @module react/components/chat/composition/chat-input-attach
 */

import * as React from "react";
import { FileTextIcon, PaperclipIcon, PlusIcon } from "../../../ui/icons/index.ts";
import { Button } from "../../../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../ui/dropdown-menu.tsx";
import { useChatInputContext } from "../contexts/composer-context.tsx";
import type { ChatInputAttachProps } from "./chat-composer.types.ts";

/**
 * Attachment `+` control. When attaching files is the only action, `+` opens
 * the file dialog directly. When `onSelectAttachment` is also set it becomes a
 * portalled `+` menu (Studio `PromptForm`'s `PlusMenu`) with "Add photos &
 * files" and "Select document".
 */
export function ChatInputAttach(
  { icon, onClick, ref }: ChatInputAttachProps,
): React.ReactElement | null {
  const c = useChatInputContext();
  const [menuOpen, setMenuOpen] = React.useState(false);
  if (!c.onAttach && !c.onSelectAttachment) return null;

  const openDialog = () => c.onOpenAttachmentPicker?.();
  const runUpload = (event: React.MouseEvent<HTMLButtonElement>) =>
    onClick ? onClick(event, openDialog) : openDialog();

  // When attaching files is the only action, the `+` opens the file dialog
  // directly — a single-item dropdown is needless chrome (matches ChatGPT).
  if (c.onAttach && !c.onSelectAttachment) {
    return (
      <div ref={ref} className="relative flex shrink-0 items-center">
        <Button
          type="button"
          variant="icon-tertiary"
          size="icon-lg"
          aria-label="Add photos & files"
          className="shrink-0"
          onClick={runUpload}
        >
          {icon ?? <PlusIcon />}
        </Button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative flex shrink-0 items-center">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="icon-tertiary"
            size="icon-lg"
            aria-label={c.onAttach ? "Add photos & files" : "Add document"}
            className="shrink-0"
          >
            {icon ?? <PlusIcon />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {c.onAttach && (
            <DropdownMenuItem onSelect={runUpload}>
              <PaperclipIcon />
              Add photos &amp; files
            </DropdownMenuItem>
          )}
          {c.onSelectAttachment && (
            <DropdownMenuItem onSelect={c.onSelectAttachment}>
              <FileTextIcon />
              Select document
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
