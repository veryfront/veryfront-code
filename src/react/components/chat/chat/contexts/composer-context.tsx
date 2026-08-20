/**
 * ChatInputContext — input state for the chat composer area.
 *
 * Provided by ChatInput.Root or ChatRoot. Consumed by input, submit button,
 * attachment controls, model selector, voice input, etc.
 *
 * @module react/components/chat/contexts/composer-context
 */

import * as React from "react";
import { createStrictContext } from "../../../create-strict-context.ts";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import type { ModelOption } from "../../model-selector.tsx";

/**
 * Public API contract for the chat input context value.
 */
export interface ChatInputContextValue {
  // Input
  input: string;
  setInput: (value: string) => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;

  // Attachments
  attachments: AttachmentInfo[];
  onAttach?: (files: FileList) => void;
  /** Open the native file input owned by the enclosing ChatInput provider. */
  onOpenAttachmentPicker?: () => void;
  onSelectAttachment?: () => void;
  onRemoveAttachment?: (id: string) => void;
  attachAccept?: string;

  // Submit
  onSubmit: (e?: React.FormEvent) => void;
  isLoading: boolean;
  canSubmit: boolean;

  // Stop
  onStop?: () => void;

  // Voice
  onVoice?: () => void;
  isListening: boolean;
  transcript?: string;

  // Model
  model?: string;
  models: ModelOption[];
  onModelChange?: (modelId: string) => void;
}

const [ChatInputContext, useChatInputContextInternal] = createStrictContext<ChatInputContextValue>(
  "useChatInputContext",
  "a ChatInput or Chat component",
);

/**
 * Read the enclosing `<ChatInput>` context, or null outside one.
 */
export function useChatInputContextOptional(): ChatInputContextValue | null {
  return React.useContext(ChatInputContext);
}

/**
 * Read the enclosing `<ChatInput>` context; throws outside one.
 */
export const useChatInputContext = useChatInputContextInternal;

/**
 * Provider for `<ChatInput>` context.
 */
export const ChatInputContextProvider = ChatInputContext.Provider;
