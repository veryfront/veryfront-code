/**
 * ComposerContext — Input/composer state for the chat input area.
 *
 * Provided by Composer.Root or ChatRoot. Consumed by input, submit button,
 * attachment controls, model selector, voice input, etc.
 *
 * @module react/components/chat/contexts/composer-context
 */

import * as React from "react";
import { createStrictContext } from "../../../create-strict-context.ts";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import type { ModelOption } from "../../model-selector.tsx";

/**
 * Public API contract for composer context value.
 */
export interface ComposerContextValue {
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

const [ComposerContext, useComposerContext] = createStrictContext<ComposerContextValue>(
  "useChatInputContext",
  "a ChatInput or Chat component",
);

/**
 * React hook for composer context optional.
 */
export function useComposerContextOptional(): ComposerContextValue | null {
  return React.useContext(ComposerContext);
}

/**
 * Render composer context provider.
 */
export const ComposerContextProvider = ComposerContext.Provider;
export { useComposerContext };

// ---------------------------------------------------------------------------
// Canonical RFC 2980 names ("Composer" is banned across the surface → ChatInput).
// Additive aliases through the migration; the "Composer" names become deprecated
// re-exports and are removed in the batched breaking release.
// ---------------------------------------------------------------------------

/** Shared state exposed by a `<ChatInput>` to its children (RFC 2980 name). */
export type ChatInputContextValue = ComposerContextValue;
/** Read the enclosing `<ChatInput>` context; throws outside one. */
export const useChatInputContext = useComposerContext;
/** Read the enclosing `<ChatInput>` context, or null outside one. */
export const useChatInputContextOptional = useComposerContextOptional;
/** Provider for `<ChatInput>` context (RFC 2980 name). */
export const ChatInputContextProvider = ComposerContextProvider;
