/**
 * ComposerContext — Input/composer state for the chat input area.
 *
 * Provided by Composer.Root or ChatRoot. Consumed by input, submit button,
 * attachment controls, model selector, voice input, etc.
 *
 * @module ai/react/components/chat/contexts/composer-context
 */

import * as React from "react";
import { COMPONENT_ERROR } from "#veryfront/errors";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import type { ModelOption } from "../../model-selector.tsx";

export interface ComposerContextValue {
  // Input
  input: string;
  setInput: (value: string) => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;

  // Attachments
  attachments: AttachmentInfo[];
  onAttach?: (files: FileList) => void;
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

const ComposerContext = React.createContext<ComposerContextValue | null>(null);

export function useComposerContext(): ComposerContextValue {
  const context = React.useContext(ComposerContext);
  if (!context) {
    throw COMPONENT_ERROR.create({
      detail: "useComposerContext must be used within a Composer or Chat component",
    });
  }
  return context;
}

export function useComposerContextOptional(): ComposerContextValue | null {
  return React.useContext(ComposerContext);
}

export const ComposerContextProvider = ComposerContext.Provider;
