/**
 * Shared native file input for default and headless chat attachment controls.
 *
 * @module react/components/chat/chat/composition/chat-input-attachment-picker
 */
import * as React from "react";
import type { ChatInputContextValue } from "../contexts/composer-context.tsx";

interface ChatInputAttachmentPickerProps {
  onAttach?: (files: FileList) => void;
  accept?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

/** @internal Render the visually hidden input owned by a ChatInput provider. */
function ChatInputAttachmentPicker({
  onAttach,
  accept,
  inputRef,
}: ChatInputAttachmentPickerProps): React.ReactElement | null {
  if (!onAttach) return null;
  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple
      aria-label="Upload file"
      onChange={(event) => {
        if (event.target.files?.length) onAttach(event.target.files);
        event.target.value = "";
      }}
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0,0,0,0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    />
  );
}

interface ChatInputAttachmentPickerResult {
  contextValue: ChatInputContextValue;
  fileInput: React.ReactElement | null;
}

/** @internal Add a provider-owned file picker action to composer context. */
export function useChatInputAttachmentPicker(
  baseContextValue: ChatInputContextValue,
  onAttach: ((files: FileList) => void) | undefined,
  accept: string | undefined,
): ChatInputAttachmentPickerResult {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const openAttachmentPicker = React.useCallback(() => inputRef.current?.click(), []);
  const contextValue = React.useMemo(
    () => ({
      ...baseContextValue,
      onOpenAttachmentPicker: onAttach ? openAttachmentPicker : undefined,
    }),
    [baseContextValue, onAttach, openAttachmentPicker],
  );
  const fileInput = (
    <ChatInputAttachmentPicker
      inputRef={inputRef}
      onAttach={onAttach}
      accept={accept}
    />
  );
  return { contextValue, fileInput };
}
