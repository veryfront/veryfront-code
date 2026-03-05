/**
 * ChatComposer — Input area with attachments, model selector, voice, and submit.
 *
 * @module ai/react/components/chat/composition/chat-composer
 */

import * as React from "react";
import { InputBox, SubmitButton } from "../../../../primitives/index.ts";
import { cn } from "../../theme.ts";
import { PaperclipIcon } from "../../icons/index.ts";
import { type ModelOption, ModelSelector } from "../../model-selector.tsx";
import type { ChatTheme } from "../../theme.ts";
import { AttachmentPill } from "../components/attachment-pill.tsx";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import { downloadMarkdown } from "../utils/export.ts";
import type { UIMessage } from "#veryfront/agent/react";

export interface ChatComposerProps {
  input: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onSubmit?: (e: React.FormEvent) => void;
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
  attachAccept?: string;
  attachments?: AttachmentInfo[];
  onRemoveAttachment?: (id: string) => void;

  // Export
  showExport?: boolean;
  messages?: UIMessage[];

  className?: string;
  children?: React.ReactNode;
}

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

    return (
      <div
        ref={ref}
        className={cn("flex-shrink-0 bg-white dark:bg-neutral-950 pb-6 pt-2", className)}
      >
        {children}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit?.(e);
          }}
          className="max-w-2xl mx-auto px-4"
        >
          {models && models.length > 0 && onModelChange && (
            <div className="mb-2">
              <ModelSelector
                models={models}
                value={model}
                onChange={onModelChange}
                disabled={isLoading}
              />
            </div>
          )}
          <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-700/80 bg-white dark:bg-neutral-900 focus-within:border-neutral-300 dark:focus-within:border-neutral-600 focus-within:shadow-md transition-all shadow-sm">
            {attachments && attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                {attachments.map((file) => (
                  <AttachmentPill
                    key={file.id}
                    attachment={file}
                    onRemove={onRemoveAttachment}
                  />
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 px-3 py-2">
              {onAttach && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={attachAccept}
                    multiple
                    aria-label="Upload file"
                    onChange={(e) => {
                      if (e.target.files?.length) onAttach(e.target.files);
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
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="size-8 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60 transition-colors shrink-0"
                    aria-label="Attach file"
                  >
                    <PaperclipIcon className="size-[18px]" />
                  </button>
                </>
              )}
              <InputBox
                value={isListening ? transcript || input : input}
                onChange={onChange}
                placeholder={isListening ? "Listening..." : placeholder}
                disabled={isLoading || isListening}
                multiline
                className={theme?.input}
              />
              {showExport && messages && messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => downloadMarkdown(messages)}
                  className="size-8 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60 transition-colors shrink-0"
                  aria-label="Export conversation"
                  title="Export as Markdown"
                >
                  <svg
                    className="size-[18px]"
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
                className={theme?.button}
              />
            </div>
          </div>
        </form>
      </div>
    );
  },
);
ChatComposer.displayName = "ChatComposer";
