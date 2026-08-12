/**
 * ChatInput — the composer: input area with attachments, model selector, voice,
 * and submit. Canonical name is `ChatInput` (the composer of a chat message).
 *
 * Render-or-compose: `<ChatInput … />` renders the batteries-included toolbar,
 * or compose your own from the sub-parts (`ChatInput.Field`, `ChatInput.Send`,
 * `ChatInput.Stop`, `ChatInput.Voice`, `ChatInput.Model`, `ChatInput.Attach`,
 * `ChatInput.Export`): each reads its state/handlers from
 * `useChatInputContext`, which `ChatInput` provides.
 *
 * @module react/components/chat/composition/chat-composer
 */

import * as React from "react";
import { InputBox } from "#veryfront/react/primitives/index.ts";
import { cn } from "../../theme.ts";
import { ArrowDownIcon, FileTextIcon, PaperclipIcon, PlusIcon } from "../../../ui/icons/index.ts";
import { Button } from "../../../ui/button.tsx";
import { IconButton } from "../../../ui/icon-button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../ui/dropdown-menu.tsx";
import { ModelSelector } from "../../model-selector.tsx";
import { AttachmentPill } from "../components/attachment-pill.tsx";
import { DropZoneOverlay } from "../components/drop-zone.tsx";
import { useDropZone } from "../hooks/use-drop-zone.ts";
import { downloadMarkdown } from "../utils/export.ts";
import { ChatInputContextProvider, useChatInputContext } from "../contexts/composer-context.tsx";
import { useChatInputAttachmentPicker } from "./chat-input-attachment-picker.tsx";
import { ChatInputForm } from "./chat-input-form.tsx";
import { ChatInputSend, ChatInputStop, ChatInputVoice } from "./chat-input-actions.tsx";
import { ChatInputSubmit } from "./chat-input-submit.tsx";
import { useComposerValue } from "./use-composer-value.ts";
import type {
  ChatInputAttachProps,
  ChatInputExportProps,
  ChatInputFieldProps,
  ChatInputModelProps,
  ChatInputProps,
  ChatInputRootProps,
  ChatInputToolbarProps,
} from "./chat-composer.types.ts";

export type * from "./chat-composer.types.ts";
export { ChatInputSend, ChatInputStop, ChatInputSubmit, ChatInputVoice };

// ---------------------------------------------------------------------------
// Sub-parts — each reads from ChatInputContext (provided by ChatInput)
// ---------------------------------------------------------------------------

/** The multiline text editor. */
export function ChatInputField(
  { placeholder = "Type a message...", className, ref, ...props }: ChatInputFieldProps,
): React.ReactElement {
  const c = useChatInputContext();
  const value = c.isListening ? c.transcript || c.input : c.input;
  const label = props["aria-label"] ?? placeholder ?? "Message";
  return (
    <InputBox
      ref={ref as React.Ref<HTMLInputElement | HTMLTextAreaElement>}
      {...props}
      value={value}
      onChange={c.onChange}
      onSubmit={() => c.onSubmit()}
      placeholder={placeholder}
      aria-label={label}
      disabled={c.isLoading || c.isListening}
      multiline
      className={cn(
        "min-h-9 w-full min-w-0 py-1.5 text-base leading-6 text-[var(--foreground)] placeholder:text-[var(--faint)]",
        className,
      )}
    />
  );
}

/** Model selector — shows when models are configured. */
export function ChatInputModel(
  { className }: ChatInputModelProps,
): React.ReactElement | null {
  const c = useChatInputContext();
  if (!c.models || c.models.length === 0 || !c.onModelChange) return null;
  return (
    <ModelSelector
      variant="icon"
      models={c.models}
      value={c.model}
      onChange={c.onModelChange}
      disabled={c.isLoading}
      className={className}
    />
  );
}

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
            aria-label="Add document"
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

/** Download the supplied conversation as Markdown. */
export function ChatInputExport(
  { messages, icon, className, onClick, ref }: ChatInputExportProps,
): React.ReactElement | null {
  if (messages.length === 0) return null;
  const download = () => downloadMarkdown(messages);
  return (
    <IconButton
      ref={ref}
      type="button"
      variant="icon-ghost"
      size="icon-lg"
      on="card"
      onClick={(event) => onClick ? onClick(event, download) : download()}
      aria-label="Export conversation"
      tooltip="Export as Markdown"
      tooltipSide="top"
      className={cn("shrink-0", className)}
    >
      {icon ?? <ArrowDownIcon />}
    </IconButton>
  );
}
ChatInputExport.displayName = "ChatInput.Export";

/**
 * `ChatInput.Toolbar` — a semantic layout slot for the composer's action row.
 * Group/reorder the action sub-parts (`ChatInput.Attach`/`.Model`/`.Export`/
 * `.Voice`/`.Send`) inside it without re-implementing the composer. Pure layout: the
 * children read their own `ChatInputContext`, so `<ChatInput.Toolbar>` just
 * mirrors the default action-row wrapper classes.
 */
export function ChatInputToolbar(
  { className, children, ref, ...props }: ChatInputToolbarProps,
): React.ReactElement {
  return (
    <div
      ref={ref}
      role="toolbar"
      className={cn("flex items-center gap-1.5 md:gap-2", className)}
      {...props}
    >
      {children}
    </div>
  );
}
ChatInputToolbar.displayName = "ChatInput.Toolbar";

// ---------------------------------------------------------------------------
// ChatInput — batteries-included composer
// ---------------------------------------------------------------------------

/**
 * `ChatInput.Root` — the provider shell for a fully custom composer. Supplies
 * `ChatInputContext` from props and renders your children, so you arrange
 * `ChatInput.Field` + the toolbar sub-parts yourself (like `Message.Root`). The
 * default `<ChatInput>` is exactly this Root plus the standard body.
 */
export function ChatInputRoot(
  { className, children, ref, ...state }: ChatInputRootProps,
): React.ReactElement {
  const baseCtxValue = useComposerValue(state);
  const { contextValue, fileInput } = useChatInputAttachmentPicker(
    baseCtxValue,
    state.onAttach,
    state.attachAccept,
  );
  return (
    <ChatInputContextProvider value={contextValue}>
      <div ref={ref} className={cn("flex-shrink-0 pb-6 pt-2", className)}>
        {fileInput}
        <div className="mx-auto w-full max-w-[850px] px-4">{children}</div>
      </div>
    </ChatInputContextProvider>
  );
}
ChatInputRoot.displayName = "ChatInput.Root";

/** Render the composer. */
function ChatInputBase(
  {
    input,
    onChange,
    setInput,
    onSubmit,
    isLoading = false,
    placeholder = "Type a message...",
    theme,
    stop,
    onVoice,
    isListening = false,
    transcript,
    models,
    model,
    onModelChange,
    toolbarStart,
    onAttach,
    onSelectAttachment,
    onDrop,
    attachAccept,
    attachments,
    onRemoveAttachment,
    onAttachClick,
    className,
    children,
    ref,
  }: ChatInputProps,
): React.ReactElement {
  {
    // Return focus to the editor after attaching (menu pick or drop) so the
    // user can keep typing without clicking back into the field.
    const fieldContainerRef = React.useRef<HTMLDivElement>(null);
    const focusField = React.useCallback(() => {
      fieldContainerRef.current?.querySelector("textarea")?.focus();
    }, []);
    const withFocus = React.useCallback(
      (fn: ((files: FileList) => void) | undefined) =>
        fn
          ? (files: FileList) => {
            fn(files);
            focusField();
          }
          : undefined,
      [focusField],
    );
    const handleAttach = withFocus(onAttach);

    const {
      isDragActive,
      onDragEnter,
      onDragLeave,
      onDragOver,
      onDrop: onFileDrop,
    } = useDropZone(withFocus(onDrop ?? onAttach));
    const baseCtxValue = useComposerValue({
      input,
      onChange,
      setInput,
      onSubmit,
      isLoading,
      stop,
      onVoice,
      isListening,
      transcript,
      models,
      model,
      onModelChange,
      onAttach: handleAttach,
      onSelectAttachment,
      attachAccept,
      attachments,
      onRemoveAttachment,
    });
    const { contextValue, fileInput } = useChatInputAttachmentPicker(
      baseCtxValue,
      handleAttach,
      attachAccept,
    );

    return (
      <ChatInputContextProvider value={contextValue}>
        <div ref={ref} className={cn("flex-shrink-0 pb-6", className)}>
          {fileInput}
          <div className="mx-auto w-full max-w-[850px] px-4">
            {React.Children.toArray(children).length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pb-3">
                {children}
              </div>
            )}
            <ChatInputForm onSubmit={contextValue.onSubmit}>
              <div
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                onDragOver={onDragOver}
                onDrop={onFileDrop}
                ref={fieldContainerRef}
                className={cn(
                  "relative overflow-hidden rounded-[var(--radius-lg)] border border-transparent bg-[var(--secondary)] px-3 py-2 shadow-sm transition-all md:px-4 md:py-3",
                  isDragActive && "border-dashed border-[var(--edge-medium)]",
                )}
              >
                {/* Drag overlay — files dragged onto the card (Studio PromptForm) */}
                <DropZoneOverlay visible={isDragActive} />

                {
                  /* Pending attachments — inside the composer card, above the
                    editor (Studio PromptForm), not floating as a separate row. */
                }
                {attachments && attachments.length > 0 && (
                  <div className="mb-2.5 flex flex-wrap items-center gap-2">
                    {attachments.map((file) => (
                      <AttachmentPill
                        key={file.id}
                        attachment={file}
                        onRemove={onRemoveAttachment}
                        className="w-[200px]"
                      />
                    ))}
                  </div>
                )}

                {/* Editor — occupies the top of the card (Studio PromptForm) */}
                <ChatInputField placeholder={placeholder} className={theme?.input} />

                {/* Footer toolbar — left: + menu + agent selector; right: model + submit */}
                <div className="mt-2.5 flex min-h-[44px] items-center justify-between gap-1.5 md:gap-2">
                  <div className="flex min-w-0 items-center gap-1.5 md:gap-2">
                    <ChatInputAttach onClick={onAttachClick} />
                    {toolbarStart}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
                    <ChatInputModel />
                    {
                      /* Streaming → Stop · empty (+voice) → Mic · value → Send
                        (Studio PromptFormActions). Each sub-part self-gates. */
                    }
                    <ChatInputStop />
                    <ChatInputVoice />
                    <ChatInputSend className={theme?.button} />
                  </div>
                </div>
              </div>
            </ChatInputForm>
          </div>
        </div>
      </ChatInputContextProvider>
    );
  }
}
ChatInputBase.displayName = "ChatInput";

/**
 * ChatInput — render `<ChatInput … />` for the default composer, or compose
 * `ChatInput.Field` + `ChatInput.Send`/`Stop`/`Voice`/`Model`/`Attach`/`Export`.
 */
export const ChatInput = Object.assign(ChatInputBase, {
  Root: ChatInputRoot,
  Field: ChatInputField,
  Send: ChatInputSend,
  Stop: ChatInputStop,
  Submit: ChatInputSubmit,
  Voice: ChatInputVoice,
  Model: ChatInputModel,
  Attach: ChatInputAttach,
  Export: ChatInputExport,
  Toolbar: ChatInputToolbar,
});
