/**
 * ChatComposer — Input area with attachments, model selector, voice, and submit.
 *
 * @module react/components/chat/composition/chat-composer
 */

import * as React from "react";
import { InputBox, SubmitButton } from "#veryfront/react/primitives/index.ts";
import { cn } from "../../theme.ts";
import { PlusIcon } from "../../icons/index.ts";
import { type ModelOption, ModelSelector } from "../../model-selector.tsx";
import type { ChatTheme } from "../../theme.ts";
import { AttachmentPill } from "../components/attachment-pill.tsx";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import { downloadMarkdown } from "../utils/export.ts";
import type { ChatMessage } from "#veryfront/agent/react";

/** Props accepted by chat composer. */
export interface ChatComposerProps {
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

  // Attachments
  onAttach?: (files: FileList) => void;
  onSelectAttachment?: () => void;
  attachAccept?: string;
  attachments?: AttachmentInfo[];
  onRemoveAttachment?: (id: string) => void;

  // Export
  showExport?: boolean;
  messages?: ChatMessage[];

  className?: string;
  children?: React.ReactNode;
}

/** Render chat composer. */
export const ChatComposer = React.forwardRef<HTMLDivElement, ChatComposerProps>(
  function ChatComposer(
    {
      input,
      onChange,
      onSubmit,
      isLoading,
      placeholder = "Type a message...",
      theme,
      stop,
      onVoice,
      isListening = false,
      transcript,
      models,
      model,
      onModelChange,
      onAttach,
      onSelectAttachment,
      attachAccept,
      attachments,
      onRemoveAttachment,
      showExport = false,
      messages,
      className,
      children,
    },
    ref,
  ) {
    const fileInputRef = React.useRef<HTMLInputElement>(null!);
    const [attachmentMenuOpen, setAttachmentMenuOpen] = React.useState(false);
    const inputPlaceholder = isListening ? "Listening..." : placeholder;
    const inputLabel = inputPlaceholder || "Message";

    return (
      <div
        ref={ref}
        className={cn("flex-shrink-0 pb-6 pt-2", className)}
      >
        <div className="mx-auto w-full max-w-3xl px-4">
          {children && (
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
            <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-transparent bg-[var(--secondary)] px-3 pt-3 pb-2 shadow-sm transition-all md:px-4 md:pt-4 md:pb-3">
              <div className="flex min-h-[44px] items-end gap-1.5 md:gap-2">
                {(onAttach || onSelectAttachment) && (
                  <div className="relative flex shrink-0 items-center">
                    {onAttach && (
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={attachAccept}
                        multiple
                        aria-label="Upload file"
                        onChange={(e) => {
                          if (e.target.files?.length) {
                            onAttach(e.target.files);
                          }
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
                    <button
                      type="button"
                      onClick={() => {
                        if (onAttach && !onSelectAttachment) {
                          fileInputRef.current?.click();
                          return;
                        }
                        setAttachmentMenuOpen((open) => !open);
                      }}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-transparent text-[var(--foreground)] transition-colors hover:bg-[var(--tertiary)]"
                      aria-label="Add document"
                      aria-expanded={attachmentMenuOpen}
                    >
                      <PlusIcon className="size-4" />
                    </button>
                    {attachmentMenuOpen && (
                      <div
                        role="menu"
                        className="absolute bottom-11 left-0 z-20 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--outline-border)] bg-[var(--popover)] shadow-sm"
                        style={{ minWidth: 224 }}
                      >
                        {onAttach && (
                          <button
                            type="button"
                            role="menuitem"
                            className="block w-full whitespace-nowrap px-3 py-2.5 text-left text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--tertiary)]"
                            onClick={() => {
                              setAttachmentMenuOpen(false);
                              fileInputRef.current?.click();
                            }}
                          >
                            Upload document
                          </button>
                        )}
                        {onSelectAttachment && (
                          <button
                            type="button"
                            role="menuitem"
                            className="block w-full whitespace-nowrap px-3 py-2.5 text-left text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--tertiary)]"
                            onClick={() => {
                              setAttachmentMenuOpen(false);
                              onSelectAttachment();
                            }}
                          >
                            Select document
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <InputBox
                  value={isListening ? transcript || input : input}
                  onChange={onChange}
                  onSubmit={() => onSubmit?.()}
                  placeholder={inputPlaceholder}
                  aria-label={inputLabel}
                  disabled={isLoading || isListening}
                  multiline
                  className={cn(
                    "min-h-9 min-w-0 flex-1 py-1.5 text-base leading-6 text-[var(--foreground)] placeholder:text-[var(--faint)]",
                    theme?.input,
                  )}
                />
                <div className="flex items-center gap-2">
                  {models && models.length > 0 && onModelChange && (
                    <ModelSelector
                      models={models}
                      value={model}
                      onChange={onModelChange}
                      disabled={isLoading}
                    />
                  )}
                  {showExport && messages && messages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => downloadMarkdown(messages)}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-transparent text-[var(--foreground)] transition-colors hover:bg-[var(--tertiary)]"
                      aria-label="Export conversation"
                      title="Export as Markdown"
                    >
                      <svg
                        className="size-5"
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
                    </button>
                  )}
                  <SubmitButton
                    isLoading={isLoading || isListening}
                    hasInput={!!input.trim()}
                    onStop={isListening ? undefined : stop}
                    onVoice={onVoice}
                    disabled={!input.trim()}
                    className={cn(
                      "size-8 shrink-0 rounded-full bg-[var(--primary)] text-[var(--secondary)] shadow-sm transition-[background-color,color] hover:bg-[var(--secondary)] hover:text-[var(--foreground)] disabled:opacity-60",
                      theme?.button,
                    )}
                  />
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    );
  },
);
ChatComposer.displayName = "ChatComposer";
