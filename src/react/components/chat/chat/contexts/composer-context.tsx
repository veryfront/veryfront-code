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

/** Public API contract for composer context value. */
export interface ComposerContextValue {
  // Input
  input: string;
  setInput: (value: string) => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;

  // Attachments
  attachments: AttachmentInfo[];
  onAttach?: (files: FileList) => void;
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
  "useComposerContext",
  "a Composer or Chat component",
);

/** React hook for composer context optional. */
export function useComposerContextOptional(): ComposerContextValue | null {
  return React.useContext(ComposerContext);
}

/** Render composer context provider. */
export const ComposerContextProvider = ComposerContext.Provider;
export { useComposerContext };
