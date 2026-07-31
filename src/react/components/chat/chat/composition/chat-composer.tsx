/**
 * ChatInput — the composer: input area with attachments, model selector, voice,
 * and submit. Canonical name is `ChatInput` (the composer of a chat message).
 *
 * Render-or-compose: `<ChatInput … />` renders the batteries-included toolbar,
 * or compose your own from the sub-parts (`ChatInput.Field`, `ChatInput.Send`,
 * `ChatInput.Stop`, `ChatInput.Voice`, `ChatInput.Model`, `ChatInput.Attach`,
 * `ChatInput.Export`): each reads its state/handlers from
 * `useComposerContext`, which `ChatInput` provides.
 *
 * @module react/components/chat/composition/chat-composer
 */

import * as React from "react";
import { InputBox } from "#veryfront/react/primitives/index.ts";
import { cn } from "../../theme.ts";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FileTextIcon,
  PaperclipIcon,
  PlusIcon,
  StopIcon,
} from "../../../ui/icons/index.ts";
import { Button } from "../../../ui/button.tsx";
import { IconButton } from "../../../ui/icon-button.tsx";
import { Slot } from "../../../ui/slot.tsx";
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
import { ComposerContextProvider, useComposerContext } from "../contexts/composer-context.tsx";
import { useComposerValue } from "./use-composer-value.ts";
import type {
  ChatInputActionProps,
  ChatInputExportProps,
  ChatInputFieldProps,
  ChatInputProps,
  ChatInputRootProps,
  ChatInputSubmitProps,
  ChatInputToolbarProps,
  WrapClick,
} from "./chat-composer.types.ts";

export type {
  ChatInputActionProps,
  ChatInputExportProps,
  ChatInputFieldProps,
  ChatInputProps,
  ChatInputRootProps,
  ChatInputSubmitProps,
  ChatInputToolbarProps,
} from "./chat-composer.types.ts";

/** Microphone glyph for the idle-composer voice button (not in the barrel). */
function MicGlyph(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sub-parts — each reads from ComposerContext (provided by ChatInput)
// ---------------------------------------------------------------------------

/** The multiline text editor. */
export function ChatInputField(
  { placeholder = "Type a message...", className, ref, ...props }: ChatInputFieldProps,
): React.ReactElement {
  const c = useComposerContext();
  const value = c.isListening ? c.transcript || c.input : c.input;
  const label = props["aria-label"] ?? placeholder ?? "Message";
  return (
    <InputBox
      ref={ref}
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

/** Send button — shows when there is input (and not streaming). */
export function ChatInputSend(
  { children, icon, className, asChild, onClick, ref }: ChatInputActionProps,
): React.ReactElement | null {
  const c = useComposerContext();
  if (c.isLoading) return null;
  if (!c.canSubmit && c.onVoice) return null;
  const run = () => c.onSubmit();
  const Comp = asChild ? Slot : Button;
  return (
    <Comp
      ref={ref}
      type="button"
      variant="icon-primary"
      on="card"
      size="icon-lg"
      aria-label="Send"
      disabled={!c.canSubmit}
      onClick={(e: React.MouseEvent<HTMLElement>) => (onClick ? onClick(e, run) : run())}
      className={cn("shrink-0", className)}
    >
      {children ?? icon ?? <ArrowUpIcon />}
    </Comp>
  );
}
ChatInputSend.displayName = "ChatInput.Send";

/** Stop button — shows while streaming. */
export function ChatInputStop(
  { children, icon, className, asChild, onClick, ref }: ChatInputActionProps,
): React.ReactElement | null {
  const c = useComposerContext();
  if (!c.isLoading) return null;
  const run = () => c.onStop?.();
  const Comp = asChild ? Slot : Button;
  return (
    <Comp
      ref={ref}
      type="button"
      variant="icon-ghost"
      size="icon-lg"
      aria-label="Stop"
      onClick={(e: React.MouseEvent<HTMLElement>) => (onClick ? onClick(e, run) : run())}
      className={cn("shrink-0", className)}
    >
      {children ?? icon ?? <StopIcon />}
    </Comp>
  );
}
ChatInputStop.displayName = "ChatInput.Stop";

/**
 * Unified submit control: renders {@link ChatInputStop} while a turn is
 * streaming and {@link ChatInputSend} otherwise, so the common case needs one
 * control instead of wiring `Send` + `Stop` and relying on their internal
 * visibility. `Send`/`Stop` remain available as low-level escapes.
 */
export function ChatInputSubmit(
  { icon, stopIcon, ...rest }: ChatInputSubmitProps,
): React.ReactElement | null {
  const c = useComposerContext();
  return c.isLoading
    ? <ChatInputStop icon={stopIcon} {...rest} />
    : <ChatInputSend icon={icon} {...rest} />;
}
ChatInputSubmit.displayName = "ChatInput.Submit";

/** Voice button — shows when the field is empty and voice is available. */
export function ChatInputVoice(
  { children, icon, className, asChild, onClick, ref }: ChatInputActionProps,
): React.ReactElement | null {
  const c = useComposerContext();
  if (c.isLoading || c.canSubmit || !c.onVoice) return null;
  const run = () => c.onVoice?.();
  const Comp = asChild ? Slot : Button;
  return (
    <Comp
      ref={ref}
      type="button"
      variant="icon-ghost"
      on="card"
      size="icon-lg"
      aria-label="Voice input"
      aria-pressed={c.isListening}
      onClick={(e: React.MouseEvent<HTMLElement>) => (onClick ? onClick(e, run) : run())}
      className={cn(
        "shrink-0",
        c.isListening && "bg-[var(--primary)] text-[var(--secondary)]",
        className,
      )}
    >
      {children ?? icon ?? <MicGlyph />}
    </Comp>
  );
}
ChatInputVoice.displayName = "ChatInput.Voice";

/** Model selector — shows when models are configured. */
export function ChatInputModel(
  { className }: { className?: string },
): React.ReactElement | null {
  const c = useComposerContext();
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
 * Attachment `+` control — a portalled `+` menu (Studio `PromptForm`'s
 * `PlusMenu`). The menu leads with "Attach files to chat" (opens the file
 * dialog) and adds "Select document" when `onSelectAttachment` is set.
 */
export function ChatInputAttach(
  { icon, onClick, ref }: {
    icon?: React.ReactNode;
    onClick?: WrapClick;
    /** React 19: ref is a regular prop (the wrapper this sub-part owns). */
    ref?: React.Ref<HTMLDivElement>;
  },
): React.ReactElement | null {
  const c = useComposerContext();
  const fileInputRef = React.useRef<HTMLInputElement>(null!);
  const [menuOpen, setMenuOpen] = React.useState(false);
  if (!c.onAttach && !c.onSelectAttachment) return null;

  const openDialog = () => fileInputRef.current?.click();
  // Menu selection carries no mouse event; pass a stub so the `onClick` wrap
  // (e.g. `onAttachClick`) still gets its `next()` continuation.
  const runUpload = () =>
    onClick ? onClick({} as React.MouseEvent<HTMLElement>, openDialog) : openDialog();

  return (
    <div ref={ref} className="relative flex shrink-0 items-center">
      {c.onAttach && (
        <input
          ref={fileInputRef}
          type="file"
          accept={c.attachAccept}
          multiple
          aria-label="Upload file"
          onChange={(e) => {
            if (e.target.files?.length) c.onAttach?.(e.target.files);
            e.target.value = "";
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
      )}
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
              Attach files to chat
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
 * children read their own `ComposerContext`, so `<ChatInput.Toolbar>` just
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
 * `ComposerContext` from props and renders your children, so you arrange
 * `ChatInput.Field` + the toolbar sub-parts yourself (like `Message.Root`). The
 * default `<ChatInput>` is exactly this Root plus the standard body.
 */
export function ChatInputRoot(
  { className, children, ref, ...state }: ChatInputRootProps,
): React.ReactElement {
  const ctxValue = useComposerValue(state);
  return (
    <ComposerContextProvider value={ctxValue}>
      <div ref={ref} className={cn("flex-shrink-0 pb-6 pt-2", className)}>
        <div className="mx-auto w-full max-w-[850px] px-4">{children}</div>
      </div>
    </ComposerContextProvider>
  );
}
ChatInputRoot.displayName = "ChatInput.Root";

/** Render the composer. */
function ChatInputBase(
  {
    input,
    onChange,
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
    const ctxValue = useComposerValue({
      input,
      onChange,
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

    return (
      <ComposerContextProvider value={ctxValue}>
        <div ref={ref} className={cn("flex-shrink-0 pb-6", className)}>
          <div className="mx-auto w-full max-w-[850px] px-4">
            {React.Children.toArray(children).length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pb-3">
                {children}
              </div>
            )}
            {attachments && attachments.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pb-4">
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
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit?.(e);
              }}
            >
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
            </form>
          </div>
        </div>
      </ComposerContextProvider>
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
