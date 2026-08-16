/**
 * `useComposerValue` builds the `ChatInputContext` value from composer state
 * props. Shared by `ChatInput` (batteries) and `ChatInput.Root` (composed).
 *
 * @module react/components/chat/composition/use-composer-value
 */

import * as React from "react";
import type { ChatFilePart } from "#veryfront/agent/react";
import { useChatContextOptional } from "../contexts/chat-context.tsx";
import type { ChatInputContextValue } from "../contexts/composer-context.tsx";
import type { ModelOption } from "../../model-selector.tsx";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import { attachmentsToFileParts, hasPendingAttachments } from "../chat-attachments.ts";

/** State shared by controlled and composer-owned submit modes. */
interface ComposerStateBaseProps {
  /** Falls back to the surrounding `ChatContext` input when omitted. */
  input?: string;
  /** Falls back to `ChatContext.setInput` when omitted. */
  onChange?: (
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

/**
 * Submit props accepted during the additive ChatInput migration.
 *
 * `sendMessage` takes precedence when both handlers are supplied, matching the
 * legacy runtime. `setInput` remains optional for source and runtime
 * compatibility; when present, it clears the controlled value after sending.
 */
interface ComposerSubmitProps {
  /**
   * Explicit submit handler. The caller owns sending and clearing in this mode.
   */
  onSubmit?: (e?: React.FormEvent) => void;
  /**
   * Send directly through composer-owned submission. When supplied, `setInput`
   * clears the controlled input after this handler runs.
   */
  sendMessage?: (message: { text: string; files?: ChatFilePart[] }) => void;
  /** Update the controlled input value for headless context consumers. */
  setInput?: (value: string) => void;
}

/** Composer state the context is built from (shared by `ChatInput` + `ChatInput.Root`). */
export type ComposerStateProps =
  & ComposerStateBaseProps
  & ComposerSubmitProps;

/** Build the ChatInputContext value from composer state props. */
function missingSetInput(): never {
  throw new Error(
    "ChatInput cannot update its controlled value because setInput was not provided. " +
      "Pass setInput to <ChatInput> or <ChatInput.Root>.",
  );
}

export function useComposerValue(props: ComposerStateProps): ChatInputContextValue {
  // One shared chat context (issue #69): when a `<Chat.Root>` is above,
  // omitted props fall back to its `ChatContext` (the shared session), so a
  // propless `<ChatInput.Root>` wires itself. Explicit props always win, and a
  // standalone composer (no ChatContext) keeps the props-only behavior.
  const chat = useChatContextOptional();
  const resolvedSetInput = props.setInput ?? chat?.setInput;
  const fallbackOnChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      resolvedSetInput?.(e.target.value),
    [resolvedSetInput],
  );
  const hasExplicitSubmitState = props.input !== undefined ||
    props.setInput !== undefined || props.attachments !== undefined ||
    props.onRemoveAttachment !== undefined || props.onClearAttachments !== undefined ||
    props.isLoading !== undefined;
  const p = {
    ...props,
    input: props.input ?? chat?.input ?? "",
    onChange: props.onChange ?? fallbackOnChange,
    setInput: resolvedSetInput,
    onSubmit: props.onSubmit ?? chat?.onSubmit,
    sendMessage: props.sendMessage ??
      (props.onSubmit === undefined && hasExplicitSubmitState ? chat?.sendMessage : undefined),
    isLoading: props.isLoading ?? chat?.isLoading,
    stop: props.stop ?? chat?.onStop,
    model: props.model ?? chat?.model,
    models: props.models ?? chat?.models,
    onModelChange: props.onModelChange ?? chat?.onModelChange,
    attachments: props.attachments ?? chat?.attachments,
    onAttach: props.onAttach ?? chat?.onAttach,
    onRemoveAttachment: props.onRemoveAttachment ?? chat?.onRemoveAttachment,
  };
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
  const { sendMessage, setInput, onClearAttachments, onSubmit, onRemoveAttachment } = p;
  const onSubmitEffective = React.useCallback((e?: React.FormEvent) => {
    if (!sendMessage) {
      onSubmit?.(e);
      return;
    }
    e?.preventDefault();
    if (!canSubmit) return;
    const attachments = p.attachments ?? [];
    const text = p.input.trim();
    const files = attachmentsToFileParts(attachments);
    if (!text && files.length === 0) return;
    sendMessage({ text, ...(files.length > 0 ? { files } : {}) });
    setInput?.("");
    if (onClearAttachments) {
      onClearAttachments();
    } else {
      for (const attachment of attachments) {
        if (attachment.url) onRemoveAttachment?.(attachment.id);
      }
    }
  }, [
    canSubmit,
    sendMessage,
    onSubmit,
    setInput,
    onClearAttachments,
    onRemoveAttachment,
    p.input,
    p.attachments,
  ]);

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
