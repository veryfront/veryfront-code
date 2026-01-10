/**
 * Chat Component - Layer 3 (Styled)
 *
 * Production-ready, fully styled chat component.
 * Built on Layer 2 primitives.
 */

import * as React from "react";
import {
  ChatContainer,
  InputBox,
  MessageItem,
  MessageList,
  SubmitButton,
} from "../primitives/index.ts";
import { useVoiceInput } from "../hooks/use-voice-input.ts";
import type { DynamicToolUIPart, ToolUIPart, UIMessage, UIMessagePart } from "../hooks/use-chat.ts";
import { type ChatTheme, cn, defaultChatTheme, mergeThemes } from "./theme.ts";
import { Markdown } from "./markdown.tsx";

/**
 * Icons for tool UI (AI Elements style - Lucide icons)
 */
function CircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function BrainIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
}

function MessageSquareIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ArrowDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

function _SendIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function _StopIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    </svg>
  );
}

function RefreshCwIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-4", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * Shimmer animation for loading states (AI Elements style)
 */
function Shimmer({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-block overflow-hidden">
      <span className="animate-pulse">{children}</span>
    </span>
  );
}

/**
 * Reasoning card component - displays AI thinking/reasoning process
 * Styled to match AI Elements (https://ai-sdk.dev/elements)
 */
function ReasoningCard({ text, isStreaming = false }: { text: string; isStreaming?: boolean }) {
  const [isOpen, setIsOpen] = React.useState(true);

  // Auto-close after streaming ends
  React.useEffect(() => {
    if (!isStreaming && isOpen) {
      const timer = setTimeout(() => {
        setIsOpen(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, isOpen]);

  return (
    <div className="not-prose mb-4">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <BrainIcon className="size-4" />
        {isStreaming ? <Shimmer>Thinking...</Shimmer> : <span>Thought process</span>}
        <ChevronDownIcon
          className={cn(
            "size-4 transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {/* Content */}
      {isOpen && (
        <div className="mt-4 text-sm text-muted-foreground border-l-2 border-muted pl-4 ml-2">
          <Markdown className="text-sm">{text}</Markdown>
        </div>
      )}
    </div>
  );
}

/**
 * Suggestion component - ChatGPT-style suggestion card
 */
export interface SuggestionProps {
  suggestion: string;
  onClick?: (suggestion: string) => void;
  className?: string;
  /** Optional icon to display */
  icon?: React.ReactNode;
}

export function Suggestion({ suggestion, onClick, className, icon }: SuggestionProps) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(suggestion)}
      className={cn(
        "group flex items-start gap-3 rounded-xl border border-border bg-background p-4 text-left text-sm text-foreground transition-all hover:bg-muted hover:border-muted-foreground/20",
        className,
      )}
    >
      {icon && (
        <span className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors">
          {icon}
        </span>
      )}
      <span className="line-clamp-2">{suggestion}</span>
    </button>
  );
}

/**
 * Suggestions container - ChatGPT-style 2x2 grid layout
 */
export interface SuggestionsProps {
  children: React.ReactNode;
  className?: string;
  /** Layout mode: 'grid' for 2x2 grid (ChatGPT style), 'horizontal' for scrollable pills */
  layout?: "grid" | "horizontal";
}

export function Suggestions({ children, className, layout = "grid" }: SuggestionsProps) {
  if (layout === "horizontal") {
    return (
      <div className={cn("flex gap-2 overflow-x-auto pb-2 scrollbar-hide", className)}>
        {children}
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-2 gap-3 max-w-2xl mx-auto", className)}>
      {children}
    </div>
  );
}

/**
 * ConversationEmptyState - ChatGPT-style empty state with large greeting
 */
export interface ConversationEmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

export function ConversationEmptyState({
  icon,
  title = "What can I help with?",
  description,
  children,
  className,
}: ConversationEmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", className)}>
      {icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
      <h1 className="text-3xl font-semibold text-foreground">{title}</h1>
      {description && <p className="mt-2 text-base text-muted-foreground max-w-md">{description}
      </p>}
      {children}
    </div>
  );
}

/**
 * ConversationScrollButton - scroll to bottom button
 */
export interface ConversationScrollButtonProps {
  onClick?: () => void;
  visible?: boolean;
  className?: string;
}

export function ConversationScrollButton({
  onClick,
  visible = true,
  className,
}: ConversationScrollButtonProps) {
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background p-2 shadow-lg transition-all hover:bg-muted",
        className,
      )}
    >
      <ArrowDownIcon className="size-4" />
    </button>
  );
}

/**
 * MessageActions component - copy button for messages
 */
export interface MessageActionsProps {
  content: string;
  className?: string;
}

export function MessageActions({ content, className }: MessageActionsProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={cn("flex items-center gap-1 mt-2", className)}>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
        title={copied ? "Copied!" : "Copy to clipboard"}
      >
        {copied
          ? (
            <>
              <CheckIcon className="size-3" />
              <span>Copied</span>
            </>
          )
          : (
            <>
              <CopyIcon className="size-3" />
              <span>Copy</span>
            </>
          )}
      </button>
    </div>
  );
}

/**
 * Loader component - animated loading dots
 */
export function Loader({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <span
        className="animate-bounce rounded-full bg-muted-foreground"
        style={{ width: size / 4, height: size / 4, animationDelay: "0ms" }}
      />
      <span
        className="animate-bounce rounded-full bg-muted-foreground"
        style={{ width: size / 4, height: size / 4, animationDelay: "150ms" }}
      />
      <span
        className="animate-bounce rounded-full bg-muted-foreground"
        style={{ width: size / 4, height: size / 4, animationDelay: "300ms" }}
      />
    </div>
  );
}

/** Tool status configuration mapping state to label and icon */
const TOOL_STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  "input-streaming": { label: "Pending", icon: <CircleIcon className="size-3.5" /> },
  "input-available": { label: "Running", icon: <ClockIcon className="size-3.5 animate-pulse" /> },
  "approval-requested": {
    label: "Awaiting Approval",
    icon: <ClockIcon className="size-3.5 text-yellow-600" />,
  },
  "approval-responded": {
    label: "Responded",
    icon: <CheckCircleIcon className="size-3.5 text-blue-600" />,
  },
  "output-available": {
    label: "Completed",
    icon: <CheckCircleIcon className="size-3.5 text-green-600" />,
  },
  "output-error": { label: "Error", icon: <XCircleIcon className="size-3.5 text-red-600" /> },
  "output-denied": { label: "Denied", icon: <XCircleIcon className="size-3.5 text-orange-600" /> },
  // Legacy states
  "call": { label: "Running", icon: <ClockIcon className="size-3.5 animate-pulse" /> },
  "partial-call": { label: "Running", icon: <ClockIcon className="size-3.5 animate-pulse" /> },
  "result": { label: "Completed", icon: <CheckCircleIcon className="size-3.5 text-green-600" /> },
  "error": { label: "Error", icon: <XCircleIcon className="size-3.5 text-red-600" /> },
};

/** Tool call status badge component (AI Elements style) */
function ToolStatusBadge({ state }: { state: string }) {
  const config = TOOL_STATUS_CONFIG[state];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground border border-border">
      {config?.icon ?? <CircleIcon className="size-3.5" />}
      {config?.label ?? state}
    </span>
  );
}

/**
 * Format JSON with syntax highlighting
 */
function formatJsonWithHighlight(obj: unknown): React.ReactNode {
  if (obj == null) return null;

  const jsonStr = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);

  // Simple syntax highlighting
  const highlighted = jsonStr
    .replace(/"([^"]+)":/g, '<span class="text-green-600 dark:text-green-400">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="text-amber-600 dark:text-amber-400">"$1"</span>')
    .replace(/: (\d+)/g, ': <span class="text-blue-600 dark:text-blue-400">$1</span>')
    .replace(/: (true|false)/g, ': <span class="text-purple-600 dark:text-purple-400">$1</span>');

  return (
    <pre
      className="text-sm font-mono whitespace-pre-wrap"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}

/**
 * Render output as table if it's an array of objects
 */
function renderOutputAsTable(output: unknown): React.ReactNode | null {
  if (!Array.isArray(output) || output.length === 0) return null;

  const firstItem = output[0];
  if (typeof firstItem !== "object" || firstItem === null) return null;

  const keys = Object.keys(firstItem);
  if (keys.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-700">
            {keys.map((key) => (
              <th
                key={key}
                className="px-4 py-2 text-left font-semibold text-neutral-900 dark:text-neutral-100"
              >
                {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {output.map((row, i) => (
            <tr key={i} className="border-b border-neutral-100 dark:border-neutral-800">
              {keys.map((key) => (
                <td key={key} className="px-4 py-2 text-neutral-700 dark:text-neutral-300">
                  {String((row as Record<string, unknown>)[key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Tool call card component - renders tool invocations with parameters and results
 * Styled to match AI Elements (https://ai-sdk.dev/elements)
 */
function ToolCallCard({ tool }: { tool: ToolUIPart | DynamicToolUIPart }) {
  const [isExpanded, setIsExpanded] = React.useState(true);

  const tableOutput = tool.output !== undefined ? renderOutputAsTable(tool.output) : null;

  return (
    <div className="not-prose w-full rounded-md border border-border bg-card">
      {/* Header - CollapsibleTrigger style */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="group flex w-full items-center justify-between gap-4 p-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <WrenchIcon className="size-4 text-muted-foreground" />
          <span className="font-medium text-sm text-foreground">{tool.toolName}</span>
          <ToolStatusBadge state={tool.state} />
        </div>
        <ChevronDownIcon
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            isExpanded && "rotate-180",
          )}
        />
      </button>

      {/* Content - CollapsibleContent style */}
      {isExpanded && (
        <div className="border-t border-border">
          {/* Parameters section - ToolInput style */}
          {tool.input !== undefined && (
            <div className="space-y-2 overflow-hidden p-4">
              <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Parameters
              </h4>
              <div className="rounded-md bg-muted/50 p-3">
                {formatJsonWithHighlight(tool.input)}
              </div>
            </div>
          )}

          {/* Result section - ToolOutput style */}
          {tool.output !== undefined && (
            <div className="space-y-2 p-4 border-t border-border">
              <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Result
              </h4>
              <div className="overflow-x-auto rounded-md bg-muted/50 text-foreground">
                {tableOutput || (
                  <div className="p-3">
                    {formatJsonWithHighlight(tool.output)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error section */}
          {tool.errorText && (
            <div className="space-y-2 p-4 border-t border-border">
              <h4 className="font-medium text-destructive text-xs uppercase tracking-wide">
                Error
              </h4>
              <div className="rounded-md bg-destructive/10 text-destructive p-3 text-sm">
                {tool.errorText}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Get text content from UIMessage parts */
function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is UIMessagePart & { type: "text" } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * Get tool parts from UIMessage
 * Matches tool-${toolName} pattern (AI SDK v5) and dynamic-tool
 * Excludes tool-result parts since those are handled by the main tool part
 */
function _getToolParts(message: UIMessage): (ToolUIPart | DynamicToolUIPart)[] {
  return message.parts.filter(
    (p): p is ToolUIPart | DynamicToolUIPart =>
      (p.type.startsWith("tool-") && p.type !== "tool-result") || p.type === "dynamic-tool",
  );
}

/** Check if a part is a tool part */
function isToolPart(part: UIMessagePart): part is ToolUIPart | DynamicToolUIPart {
  return (part.type.startsWith("tool-") && part.type !== "tool-result") ||
    part.type === "dynamic-tool";
}

/** Check if a part is a reasoning part */
function isReasoningPart(
  part: UIMessagePart,
): part is { type: "reasoning"; text: string; state?: string } {
  return part.type === "reasoning";
}

/**
 * Part group types for ordered rendering
 */
type PartGroup =
  | { type: "text"; content: string }
  | { type: "tool"; tool: ToolUIPart | DynamicToolUIPart }
  | { type: "reasoning"; text: string; isStreaming: boolean };

/**
 * Group consecutive parts for ordered rendering
 * Returns an array of groups, each containing either consecutive text parts, a tool part, or a reasoning part
 */
function groupPartsInOrder(parts: UIMessagePart[]): PartGroup[] {
  const groups: PartGroup[] = [];
  let currentTextGroup: string[] = [];

  const flushText = (): void => {
    if (currentTextGroup.length > 0) {
      groups.push({ type: "text", content: currentTextGroup.join("") });
      currentTextGroup = [];
    }
  };

  for (const part of parts) {
    if (part.type === "text") {
      currentTextGroup.push(part.text);
    } else if (isToolPart(part)) {
      flushText();
      groups.push({ type: "tool", tool: part });
    } else if (isReasoningPart(part)) {
      flushText();
      groups.push({ type: "reasoning", text: part.text, isStreaming: part.state === "streaming" });
    }
    // Skip tool-result and other non-renderable parts
  }

  flushText();
  return groups;
}

export interface ChatProps {
  /** Messages to display (AI SDK v5 format) */
  messages: UIMessage[];

  /** Current input value */
  input: string;

  /** Input change handler (alternative naming) */
  onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;

  /** Input change handler (from useChat) */
  handleInputChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;

  /** Submit handler (alternative naming) */
  onSubmit?: (e: React.FormEvent) => void | Promise<void>;

  /** Submit handler (from useChat) */
  handleSubmit?: (e: React.FormEvent) => void | Promise<void>;

  /** Stop handler - called when stop button is clicked during loading */
  stop?: () => void;

  /** Reload handler - called to retry the last message (from useChat) */
  reload?: () => void;

  /** Enable built-in voice input (uses Web Speech API) */
  enableVoice?: boolean;

  /** Custom voice input handler - overrides built-in voice if provided */
  onVoice?: () => void;

  /** Setter for input value (required for voice input to work) */
  setInput?: (value: string) => void;

  /** Loading state */
  isLoading?: boolean;

  /** Error state */
  error?: Error | null;

  /** Placeholder text */
  placeholder?: string;

  /** Max height */
  maxHeight?: string;

  /** Additional class name */
  className?: string;

  /** Theme customization */
  theme?: Partial<ChatTheme>;

  /** Custom message renderer */
  renderMessage?: (message: UIMessage) => React.ReactNode;

  /** Custom tool renderer (v5 format) */
  renderTool?: (tool: ToolUIPart | DynamicToolUIPart) => React.ReactNode;

  /** Enable multiline input */
  multiline?: boolean;

  /** Suggestions to show when no messages exist */
  suggestions?: string[];

  /** Handler for suggestion clicks */
  onSuggestionClick?: (suggestion: string) => void;

  /** Empty state configuration */
  emptyState?: {
    icon?: React.ReactNode;
    title?: string;
    description?: string;
  };

  /** Show scroll-to-bottom button */
  showScrollButton?: boolean;

  /** Show message actions (copy button) on assistant messages */
  showMessageActions?: boolean;
}

/**
 * Chat - Complete chat interface
 *
 * Production-ready chat component with sensible defaults.
 *
 * @example
 * ```tsx
 * import { Chat } from 'veryfront/ai/components';
 * import { useChat } from 'veryfront/ai/react';
 *
 * export default function ChatPage() {
 *   const chat = useChat({ api: '/api/chat' });
 *   return <Chat {...chat} />;
 * }
 * ```
 */
export const Chat = React.forwardRef<HTMLDivElement, ChatProps>(
  (
    {
      messages,
      input,
      onChange,
      handleInputChange,
      onSubmit,
      handleSubmit,
      stop,
      reload,
      enableVoice = false,
      onVoice,
      setInput,
      isLoading,
      error,
      placeholder = "Type a message...",
      maxHeight = "100%",
      className,
      theme: userTheme,
      renderMessage,
      renderTool,
      multiline = false,
      suggestions,
      onSuggestionClick,
      emptyState,
      showScrollButton = false,
      showMessageActions = true,
    },
    ref,
  ) => {
    const theme = mergeThemes(defaultChatTheme, userTheme);
    const messagesEndRef = React.useRef<HTMLDivElement>(null);

    // Support both naming conventions from useChat
    const inputChangeHandler = onChange || handleInputChange || (() => {});
    const submitHandler = onSubmit || handleSubmit;

    // Built-in voice input
    const voice = useVoiceInput({
      onTranscript: (transcript, isFinal) => {
        if (setInput && isFinal) {
          setInput(transcript);
        }
      },
    });

    // Determine voice handler - custom or built-in
    const voiceHandler = React.useMemo(() => {
      if (onVoice) return onVoice;
      if (enableVoice && voice.isSupported && setInput) {
        return voice.toggle;
      }
      return undefined;
    }, [onVoice, enableVoice, voice.isSupported, voice.toggle, setInput]);

    // Auto-scroll to bottom on new messages
    React.useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    return (
      <ChatContainer
        ref={ref}
        className={cn(theme.container, className)}
        style={{ maxHeight }}
      >
        {/* Message List - scrollable content area */}
        <MessageList className="flex-1 min-h-0 overflow-y-auto relative">
          {/* Empty state - centered vertically like ChatGPT */}
          {messages.length === 0
            ? (
              <div className="flex flex-col items-center justify-center h-full px-4">
                <div className="flex-1" />
                <ConversationEmptyState
                  icon={emptyState?.icon || <MessageSquareIcon className="size-10" />}
                  title={emptyState?.title || "What can I help with?"}
                  description={emptyState?.description}
                />
                {/* Suggestions grid - ChatGPT style */}
                {suggestions && suggestions.length > 0 && (
                  <div className="w-full max-w-2xl mt-6 mb-8">
                    <Suggestions layout="grid">
                      {suggestions.map((suggestion) => (
                        <Suggestion
                          key={suggestion}
                          suggestion={suggestion}
                          onClick={onSuggestionClick}
                        />
                      ))}
                    </Suggestions>
                  </div>
                )}
                <div className="flex-1" />
              </div>
            )
            : (
              <div className="max-w-2xl mx-auto px-4 py-4 space-y-2">
                {messages.map((msg) => {
                  // For user messages, use simple text extraction
                  if (msg.role === "user") {
                    const content = getTextContent(msg);
                    return renderMessage
                      ? <React.Fragment key={msg.id}>{renderMessage(msg)}</React.Fragment>
                      : (
                        <MessageItem
                          key={msg.id}
                          role={msg.role}
                          className={cn("flex", "justify-end")}
                        >
                          <div className={theme.message?.[msg.role] || theme.message?.user}>
                            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
                              {content}
                            </p>
                          </div>
                        </MessageItem>
                      );
                  }

                  // For assistant messages, render parts in order
                  const partGroups = groupPartsInOrder(msg.parts);
                  const textContent = getTextContent(msg);
                  return renderMessage
                    ? <React.Fragment key={msg.id}>{renderMessage(msg)}</React.Fragment>
                    : (
                      <MessageItem
                        key={msg.id}
                        role={msg.role}
                        className={cn("flex", "justify-start")}
                      >
                        <div className={theme.message?.[msg.role] || theme.message?.assistant}>
                          {partGroups.map((group, index) => {
                            if (group.type === "text") {
                              return (
                                <Markdown
                                  key={`text-${index}`}
                                  className="text-[15px] leading-relaxed"
                                >
                                  {group.content}
                                </Markdown>
                              );
                            }
                            if (group.type === "reasoning") {
                              return (
                                <ReasoningCard
                                  key={`reasoning-${index}`}
                                  text={group.text}
                                  isStreaming={group.isStreaming}
                                />
                              );
                            }
                            // Tool part
                            return (
                              <div key={group.tool.toolCallId} className="my-3">
                                {renderTool
                                  ? renderTool(group.tool)
                                  : <ToolCallCard tool={group.tool} />}
                              </div>
                            );
                          })}
                          {/* Message actions for assistant messages */}
                          {showMessageActions && textContent && (
                            <MessageActions content={textContent} />
                          )}
                        </div>
                      </MessageItem>
                    );
                })}

                {/* Loading indicator */}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-neutral-100 dark:bg-neutral-800 rounded-[20px] rounded-bl-[4px] px-4 py-3">
                      <div className="flex gap-1.5 items-center">
                        <span className={cn(theme.loading)} />
                        <span className={cn(theme.loading)} style={{ animationDelay: "0.15s" }} />
                        <span className={cn(theme.loading)} style={{ animationDelay: "0.3s" }} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Auto-scroll anchor */}
                <div ref={messagesEndRef} />
              </div>
            )}

          {/* Scroll to bottom button */}
          {showScrollButton && (
            <ConversationScrollButton
              onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
            />
          )}
        </MessageList>

        {/* Error display with retry button */}
        {error && (
          <div className="mx-4 mb-2 px-4 py-3 bg-red-50 dark:bg-red-900/20 rounded-2xl text-red-600 dark:text-red-400 text-sm flex items-center justify-between gap-3">
            <span>{error.message}</span>
            {reload && (
              <button
                type="button"
                onClick={reload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60 rounded-lg transition-colors"
              >
                <RefreshCwIcon className="size-3.5" />
                Retry
              </button>
            )}
          </div>
        )}

        {/* Input area - fixed at bottom */}
        <div className="flex-shrink-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800">
          <form
            onSubmit={submitHandler}
            className="max-w-2xl mx-auto px-4 py-3"
          >
            <div className="flex gap-2 items-center">
              <InputBox
                value={voice.isListening ? voice.transcript || input : input}
                onChange={inputChangeHandler}
                placeholder={voice.isListening ? "Listening..." : placeholder}
                disabled={isLoading || voice.isListening}
                multiline={multiline}
                className={theme.input}
              />
              <SubmitButton
                isLoading={isLoading || voice.isListening}
                hasInput={!!input.trim()}
                onStop={voice.isListening ? voice.stop : stop}
                onVoice={voiceHandler}
                disabled={!input.trim()}
                className={theme.button}
              />
            </div>
          </form>
        </div>
      </ChatContainer>
    );
  },
);

Chat.displayName = "Chat";

// Composition API (for advanced usage)
const ChatHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "border-b border-gray-200 dark:border-gray-800 p-4 bg-gray-50 dark:bg-gray-900",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});
ChatHeader.displayName = "ChatHeader";

const ChatMessages = MessageList;
ChatMessages.displayName = "ChatMessages";

const ChatInput = React.forwardRef<
  HTMLInputElement | HTMLTextAreaElement,
  React.ComponentProps<typeof InputBox>
>(({ className, ...props }, ref) => {
  return (
    <div className="border-t border-gray-200 dark:border-gray-800 p-4">
      <div className="flex gap-2">
        <InputBox
          ref={ref}
          className={cn(defaultChatTheme.input, className)}
          {...props}
        />
      </div>
    </div>
  );
});
ChatInput.displayName = "ChatInput";

const ChatFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "border-t border-gray-200 dark:border-gray-800 p-4 text-sm text-gray-500",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});
ChatFooter.displayName = "ChatFooter";

// Attach subcomponents for composition API
export const ChatComponents = Object.assign(Chat, {
  Header: ChatHeader,
  Messages: ChatMessages,
  Input: ChatInput,
  Footer: ChatFooter,
});
