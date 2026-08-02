/**
 * `useComposerValue` builds the `ChatInputContext` value from composer state
 * props. Shared by `ChatInput` (batteries) and `ChatInput.Root` (composed).
 *
 * @module react/components/chat/composition/use-composer-value
 */

import * as React from "react";
import type { ChatFilePart } from "#veryfront/agent/react";
import type { ChatInputContextValue } from "../contexts/composer-context.tsx";
import type { ModelOption } from "../../model-selector.tsx";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import { attachmentsToFileParts, hasPendingAttachments } from "../chat-attachments.ts";

/** State shared by controlled and composer-owned submit modes. */
interface ComposerStateBaseProps {
  input: string;
  onChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  /** Clear pending attachments after a composer-owned submit sends. */
  onClearAttachments?: () => void;
  isLoading?: boolean;
  stop?: () => void;
  onVoice?: () => void;
  isListening?: boolean;
  transcript?: string;
  models?: ModelOption[];
  model?: string;
  onModelChange?: (model: string) => void;
  onAttach?: (files: FileList) => void;
  onSelectAttachment?: () => void;
  attachAccept?: string;
  attachments?: AttachmentInfo[];
  onRemoveAttachment?: (id: string) => void;
}

/** Caller-owned submit mode. */
interface ControlledComposerSubmitProps {
  /**
   * Explicit submit handler. The caller owns sending and clearing in this mode.
   */
  onSubmit?: (e?: React.FormEvent) => void;
  sendMessage?: undefined;
  /** Update the controlled input value for headless context consumers. */
  setInput?: (value: string) => void;
}

/** Composer-owned submit mode. */
interface ComposerOwnedSubmitProps {
  onSubmit?: never;
  /**
   * Send a message directly. The composer builds `onSubmit` itself:
   * it trims the input, waits while any upload is still in flight, folds the
   * resolved attachments into `file` parts, sends, then clears the controlled
   * input and attachments.
   */
  sendMessage: (message: { text: string; files?: ChatFilePart[] }) => void;
  /** Update and clear the controlled value after the composer-owned send. */
  setInput: (value: string) => void;
}

/** Composer state the context is built from (shared by `ChatInput` + `ChatInput.Root`). */
export type ComposerStateProps =
  & ComposerStateBaseProps
  & (ControlledComposerSubmitProps | ComposerOwnedSubmitProps);

/** Build the ChatInputContext value from composer state props. */
function missingSetInput(): never {
  throw new Error(
    "ChatInput cannot update its controlled value because setInput was not provided. " +
      "Pass setInput to <ChatInput> or <ChatInput.Root>.",
  );
}

export function useComposerValue(p: ComposerStateProps): ChatInputContextValue {
  const hasResolvedAttachment = p.attachments?.some((attachment) =>
    Boolean(attachment.url) &&
    attachment.state !== "uploading" &&
    attachment.state !== "processing" &&
    attachment.state !== "error"
  ) ?? false;
  const hasPendingAttachment = hasPendingAttachments(p.attachments ?? []);
  const canSubmit = !p.isLoading && !hasPendingAttachment &&
    (p.input.trim().length > 0 || hasResolvedAttachment);

  // When `sendMessage` is supplied the composer owns submit: trim, wait for
  // in-flight uploads, fold resolved attachments into file parts, send, clear.
  // Otherwise fall back to the caller's explicit `onSubmit` (controlled mode).
  const { sendMessage, setInput, onClearAttachments, onSubmit } = p;
  const onSubmitEffective = React.useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    if (!sendMessage) {
      onSubmit?.(e);
      return;
    }
    const attachments = p.attachments ?? [];
    const text = p.input.trim();
    const files = attachmentsToFileParts(attachments);
    if (!text && files.length === 0) return;
    if (!setInput) missingSetInput();
    sendMessage({ text, ...(files.length > 0 ? { files } : {}) });
    setInput("");
    onClearAttachments?.();
  }, [canSubmit, sendMessage, onSubmit, setInput, onClearAttachments, p.input, p.attachments]);

  return React.useMemo<ChatInputContextValue>(() => ({
    input: p.input,
    setInput: p.setInput ?? missingSetInput,
    onChange: p.onChange,
    attachments: p.attachments ?? [],
    onAttach: p.onAttach,
    onSelectAttachment: p.onSelectAttachment,
    onRemoveAttachment: p.onRemoveAttachment,
    attachAccept: p.attachAccept,
    onSubmit: onSubmitEffective,
    isLoading: p.isLoading ?? false,
    canSubmit,
    onStop: p.stop,
    onVoice: p.onVoice,
    isListening: p.isListening ?? false,
    transcript: p.transcript,
    model: p.model,
    models: p.models ?? [],
    onModelChange: p.onModelChange,
  }), [
    p.input,
    p.setInput,
    p.onChange,
    p.attachments,
    p.onAttach,
    p.onSelectAttachment,
    p.onRemoveAttachment,
    p.attachAccept,
    onSubmitEffective,
    p.isLoading,
    canSubmit,
    p.stop,
    p.onVoice,
    p.isListening,
    p.transcript,
    p.model,
    p.models,
    p.onModelChange,
  ]);
}
