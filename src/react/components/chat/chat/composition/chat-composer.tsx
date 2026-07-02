/**
 * ChatInput — the composer: input area with attachments, model selector, voice,
 * and submit. Canonical name is `ChatInput` (the composer of a chat message).
 *
 * Render-or-compose: `<ChatInput … />` renders the batteries-included toolbar,
 * or compose your own from the sub-parts (`ChatInput.Field`, `ChatInput.Send`,
 * `ChatInput.Stop`, `ChatInput.Voice`, `ChatInput.Model`, `ChatInput.Attach`) —
 * each reads its state/handlers from `useComposerContext`, which `ChatInput`
 * provides. Every action sub-part takes `icon`, `className`, `asChild`, and an
 * `onClick(e, next)` wrap-signature.
 *
 * @module react/components/chat/composition/chat-composer
 */

import * as React from "react";
import { InputBox } from "#veryfront/react/primitives/index.ts";
import { cn } from "../../theme.ts";
import { ArrowUpIcon, FileTextIcon, PaperclipIcon, PlusIcon, StopIcon } from "../../icons/index.ts";
import { Button } from "../../ui/button.tsx";
import { IconButton } from "../../ui/icon-button.tsx";
import { Slot } from "../../ui/slot.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu.tsx";
import { type ModelOption, ModelSelector } from "../../model-selector.tsx";
import type { ChatTheme } from "../../theme.ts";
import { AttachmentPill } from "../components/attachment-pill.tsx";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import { DropZoneOverlay } from "../components/drop-zone.tsx";
import { useDropZone } from "../hooks/use-drop-zone.ts";
import { downloadMarkdown } from "../utils/export.ts";
import type { ChatMessage } from "#veryfront/agent/react";
import {
  ComposerContextProvider,
  type ComposerContextValue,
  useComposerContext,
} from "../contexts/composer-context.tsx";

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

/** Default export (download) glyph. */
function ExportGlyph(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/** Icon overrides for the batteries-included `ChatInput` toolbar. */
export interface ChatInputIcons {
  send?: React.ReactNode;
  attach?: React.ReactNode;
  voice?: React.ReactNode;
  stop?: React.ReactNode;
  export?: React.ReactNode;
}

/** Wrap-signature onClick shared by the interactive `ChatInput` sub-parts. */
type WrapClick = (event: React.MouseEvent<HTMLElement>, next: () => void) => void;

// ---------------------------------------------------------------------------
// Sub-parts — each reads from ComposerContext (provided by ChatInput)
// ---------------------------------------------------------------------------

/** Props accepted by `<ChatInput.Field>`. */
export interface ChatInputFieldProps {
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}

/** The multiline text editor. */
export function ChatInputField(
  { placeholder = "Type a message...", className, ...props }: ChatInputFieldProps,
): React.ReactElement {
  const c = useComposerContext();
  const value = c.isListening ? c.transcript || c.input : c.input;
  const label = props["aria-label"] ?? placeholder ?? "Message";
  return (
    <InputBox
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

/** Props shared by the icon action sub-parts. */
export interface ChatInputActionProps {
  icon?: React.ReactNode;
  className?: string;
  asChild?: boolean;
  onClick?: WrapClick;
}

/** Send button — shows when there is input (and not streaming). */
export const ChatInputSend = React.forwardRef<HTMLButtonElement, ChatInputActionProps>(
  function ChatInputSend({ icon, className, asChild, onClick }, ref) {
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
        {icon ?? <ArrowUpIcon />}
      </Comp>
    );
  },
);
ChatInputSend.displayName = "ChatInput.Send";

/** Stop button — shows while streaming. */
export const ChatInputStop = React.forwardRef<HTMLButtonElement, ChatInputActionProps>(
  function ChatInputStop({ icon, className, asChild, onClick }, ref) {
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
        {icon ?? <StopIcon />}
      </Comp>
    );
  },
);
ChatInputStop.displayName = "ChatInput.Stop";

/** Voice button — shows when the field is empty and voice is available. */
export const ChatInputVoice = React.forwardRef<HTMLButtonElement, ChatInputActionProps>(
  function ChatInputVoice({ icon, className, asChild, onClick }, ref) {
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
        {icon ?? <MicGlyph />}
      </Comp>
    );
  },
);
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
  { icon, onClick }: { icon?: React.ReactNode; onClick?: WrapClick },
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
    <div className="relative flex shrink-0 items-center">
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

// ---------------------------------------------------------------------------
// ChatInput — batteries-included composer
// ---------------------------------------------------------------------------

/** Props accepted by `ChatInput`. */
export interface ChatInputProps {
  input: string;
  onChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  onSubmit?: (e?: React.FormEvent) => void;
  isLoading?: boolean;
  placeholder?: string;
  theme?: ChatTheme;

  // Stop / Voice
  stop?: () => void;
  onVoice?: () => void;
  isListening?: boolean;
  transcript?: string;

  // Model
  models?: ModelOption[];
  model?: string;
  onModelChange?: (model: string) => void;

  // Leading toolbar slot — rendered in the footer toolbar after the `+` (Studio
  // PromptForm's leading slot). Generic: hold an `<AgentPicker>`, a template
  // button, anything. (Was `agentSelector` — renamed to a role-neutral slot.)
  toolbarStart?: React.ReactNode;

  // Attachments
  onAttach?: (files: FileList) => void;
  onSelectAttachment?: () => void;
  /**
   * Files dropped onto the composer. Defaults to `onAttach` — pass this only to
   * treat a drop differently from the `+` menu upload.
   */
  onDrop?: (files: FileList) => void;
  attachAccept?: string;
  attachments?: AttachmentInfo[];
  onRemoveAttachment?: (id: string) => void;

  // Export
  showExport?: boolean;
  messages?: ChatMessage[];

  // Customisation
  /** Override the toolbar button icons. */
  icons?: ChatInputIcons;
  /** Wrap the built-in attachment `+` click; call `next()` to run it. */
  onAttachClick?: WrapClick;
  /** Wrap the built-in export click; call `next()` to run it. */
  onExportClick?: WrapClick;

  className?: string;
  children?: React.ReactNode;
}

/** Composer state the context is built from (shared by `ChatInput` + `ChatInput.Root`). */
export interface ComposerStateProps {
  input: string;
  onChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  onSubmit?: (e?: React.FormEvent) => void;
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

/** Build the ComposerContext value from composer state props. */
function useComposerValue(p: ComposerStateProps): ComposerContextValue {
  return React.useMemo<ComposerContextValue>(() => ({
    input: p.input,
    setInput: () => {},
    onChange: p.onChange,
    attachments: p.attachments ?? [],
    onAttach: p.onAttach,
    onSelectAttachment: p.onSelectAttachment,
    onRemoveAttachment: p.onRemoveAttachment,
    attachAccept: p.attachAccept,
    onSubmit: (e?: React.FormEvent) => p.onSubmit?.(e),
    isLoading: p.isLoading ?? false,
    canSubmit: p.input.trim().length > 0,
    onStop: p.stop,
    onVoice: p.onVoice,
    isListening: p.isListening ?? false,
    transcript: p.transcript,
    model: p.model,
    models: p.models ?? [],
    onModelChange: p.onModelChange,
  }), [
    p.input,
    p.onChange,
    p.attachments,
    p.onAttach,
    p.onSelectAttachment,
    p.onRemoveAttachment,
    p.attachAccept,
    p.onSubmit,
    p.isLoading,
    p.stop,
    p.onVoice,
    p.isListening,
    p.transcript,
    p.model,
    p.models,
    p.onModelChange,
  ]);
}

/** Props accepted by `<ChatInput.Root>`. */
export interface ChatInputRootProps extends ComposerStateProps {
  className?: string;
  children: React.ReactNode;
}

/**
 * `ChatInput.Root` — the provider shell for a fully custom composer. Supplies
 * `ComposerContext` from props and renders your children, so you arrange
 * `ChatInput.Field` + the toolbar sub-parts yourself (like `Message.Root`). The
 * default `<ChatInput>` is exactly this Root plus the standard body.
 */
export const ChatInputRoot = React.forwardRef<HTMLDivElement, ChatInputRootProps>(
  function ChatInputRoot({ className, children, ...state }, ref) {
    const ctxValue = useComposerValue(state);
    return (
      <ComposerContextProvider value={ctxValue}>
        <div ref={ref} className={cn("flex-shrink-0 pb-6 pt-2", className)}>
          <div className="mx-auto w-full max-w-[850px] px-4">{children}</div>
        </div>
      </ComposerContextProvider>
    );
  },
);
ChatInputRoot.displayName = "ChatInput.Root";

/** Render the composer. */
const ChatInputBase = React.forwardRef<HTMLDivElement, ChatInputProps>(
  function ChatInput(
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
      showExport = false,
      messages,
      icons,
      onAttachClick,
      onExportClick,
      className,
      children,
    },
    ref,
  ) {
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

    const { isDragActive, dragProps } = useDropZone(withFocus(onDrop ?? onAttach));
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

    const exportDownload = () => {
      if (messages) downloadMarkdown(messages);
    };

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
                {...dragProps}
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
                    <ChatInputAttach icon={icons?.attach} onClick={onAttachClick} />
                    {toolbarStart}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
                    <ChatInputModel />
                    {showExport && messages && messages.length > 0 && (
                      <IconButton
                        type="button"
                        variant="icon-ghost"
                        size="icon-lg"
                        on="card"
                        onClick={(e) =>
                          onExportClick ? onExportClick(e, exportDownload) : exportDownload()}
                        aria-label="Export conversation"
                        tooltip="Export as Markdown"
                        tooltipSide="top"
                        className="shrink-0"
                      >
                        {icons?.export ?? <ExportGlyph />}
                      </IconButton>
                    )}
                    {
                      /* Streaming → Stop · empty (+voice) → Mic · value → Send
                        (Studio PromptFormActions). Each sub-part self-gates. */
                    }
                    <ChatInputStop icon={icons?.stop} />
                    <ChatInputVoice icon={icons?.voice} />
                    <ChatInputSend icon={icons?.send} className={theme?.button} />
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      </ComposerContextProvider>
    );
  },
);
ChatInputBase.displayName = "ChatInput";

/**
 * ChatInput — render `<ChatInput … />` for the default composer, or compose
 * `ChatInput.Field` + `ChatInput.Send`/`Stop`/`Voice`/`Model`/`Attach`.
 */
export const ChatInput = Object.assign(ChatInputBase, {
  Root: ChatInputRoot,
  Field: ChatInputField,
  Send: ChatInputSend,
  Stop: ChatInputStop,
  Voice: ChatInputVoice,
  Model: ChatInputModel,
  Attach: ChatInputAttach,
});
