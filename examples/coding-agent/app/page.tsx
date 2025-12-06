"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Custom SVG Icons
function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
    </svg>
  );
}

function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}

// Typing indicator component
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
      <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
      <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
    </div>
  );
}

// Tool call card component
function ToolCard({ name, args, result }: { name: string; args: any; result?: any }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-3 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden bg-slate-50 dark:bg-slate-800/50">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
            <WrenchIcon className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{name}</span>
        </div>
        <ChevronDownIcon className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Arguments</div>
          <pre className="text-xs text-slate-600 dark:text-slate-300 overflow-x-auto bg-slate-50 dark:bg-slate-900 rounded p-2 mb-2">
            {JSON.stringify(args, null, 2)}
          </pre>
          {result !== undefined && (
            <>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Result</div>
              <pre className="text-xs text-slate-600 dark:text-slate-300 overflow-x-auto bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-32">
                {typeof result === "string" ? result.slice(0, 500) : JSON.stringify(result, null, 2).slice(0, 500)}
                {(typeof result === "string" ? result.length : JSON.stringify(result).length) > 500 && "..."}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{ name: string; args: any }>;
  toolResults?: Array<{ name: string; result: any }>;
}

// Message bubble component
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        isUser
          ? 'bg-slate-600 dark:bg-slate-500'
          : 'bg-gradient-to-br from-indigo-500 to-blue-600'
      }`}>
        {isUser ? (
          <UserIcon className="w-5 h-5 text-white" />
        ) : (
          <TerminalIcon className="w-4 h-4 text-white" />
        )}
      </div>

      {/* Message content */}
      <div className={`max-w-[85%] ${isUser ? '' : ''}`}>
        <div className={`px-4 py-3 rounded-2xl ${
          isUser
            ? 'bg-indigo-600 text-white rounded-tr-sm'
            : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-tl-sm shadow-sm'
        }`}>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
        </div>

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-2">
            {message.toolCalls.map((tc, i) => (
              <ToolCard
                key={i}
                name={tc.name}
                args={tc.args}
                result={message.toolResults?.[i]?.result}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Empty state component
function EmptyState({ onSuggestionClick }: { onSuggestionClick: (text: string) => void }) {
  const suggestions = [
    { text: "List all TypeScript files in the project" },
    { text: "Search the web for React best practices" },
    { text: "Read the package.json file" },
    { text: "What files are in the src directory?" },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full py-12 px-4">
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center mb-6 shadow-lg">
        <TerminalIcon className="w-8 h-8 text-white" />
      </div>
      <h2 className="text-2xl font-semibold text-slate-800 dark:text-slate-200 mb-2">
        Coding Agent
      </h2>
      <p className="text-slate-500 dark:text-slate-400 text-center max-w-md mb-8">
        AI assistant with file operations, web search, and command execution capabilities.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onSuggestionClick(suggestion.text)}
            className="flex items-center gap-3 p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-md transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-200 dark:group-hover:bg-indigo-900/50 transition-colors">
              <TerminalIcon className="w-4 h-4" />
            </div>
            <span className="text-sm text-slate-700 dark:text-slate-300 group-hover:text-indigo-700 dark:group-hover:text-indigo-400 transition-colors">
              {suggestion.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Custom hook for agent chat with tool calls support
 */
function useAgentChat(options: { api: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setError(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch(options.api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      let assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: "",
      };

      setMessages((prev) => [...prev, assistantMessage]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          const rawData = line.slice(6);
          if (rawData === "[DONE]") continue;

          try {
            const data = JSON.parse(rawData);

            // Vercel AI SDK data stream format
            if (data.type === "text-delta") {
              assistantMessage = {
                ...assistantMessage,
                content: assistantMessage.content + (data.textDelta || ""),
              };
              setMessages((prev) => [...prev.slice(0, -1), assistantMessage]);
            } else if (data.type === "tool-call") {
              assistantMessage = {
                ...assistantMessage,
                toolCalls: [...(assistantMessage.toolCalls || []), { name: data.toolName, args: data.args }],
              };
              setMessages((prev) => [...prev.slice(0, -1), assistantMessage]);
            } else if (data.type === "tool-result") {
              assistantMessage = {
                ...assistantMessage,
                toolResults: [...(assistantMessage.toolResults || []), { name: data.toolName, result: data.result }],
              };
              setMessages((prev) => [...prev.slice(0, -1), assistantMessage]);
            } else if (data.type === "error") {
              assistantMessage = {
                ...assistantMessage,
                content: assistantMessage.content + `\n\nError: ${data.error}`,
              };
              setMessages((prev) => [...prev.slice(0, -1), assistantMessage]);
            }
          } catch (_e) {
            // Skip invalid JSON
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }

      const errorObj = err instanceof Error ? err : new Error(String(err));
      setError(errorObj);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `Error: ${errorObj.message}`,
        },
      ]);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [input, isLoading, messages, options.api]);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
  }, []);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      await sendMessage();
    },
    [sendMessage],
  );

  return {
    messages,
    input,
    isLoading,
    error,
    setInput: handleInputChange,
    handleSubmit,
    sendMessage,
  };
}

export default function CodingAgentPage() {
  const { messages, input, isLoading, setInput, handleSubmit } = useAgentChat({
    api: "/api/agent",
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleSuggestionClick(text: string) {
    setInput(text);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-lg">
            <TerminalIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-slate-800 dark:text-white">Coding Agent</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">File ops, web search, command execution</p>
          </div>
        </div>
      </header>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-6">
          {messages.length === 0 ? (
            <EmptyState onSuggestionClick={handleSuggestionClick} />
          ) : (
            <div className="space-y-6">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}

              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center">
                    <TerminalIcon className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                    <TypingIndicator />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <form onSubmit={handleSubmit} className="relative">
            <div className="flex items-end gap-2 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 focus-within:border-indigo-400 dark:focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-400/20 transition-all">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask the coding agent..."
                disabled={isLoading}
                rows={1}
                className="flex-1 bg-transparent px-4 py-3 text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 resize-none focus:outline-none text-sm leading-relaxed max-h-[200px]"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="flex-shrink-0 m-2 p-2 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:from-indigo-600 hover:to-blue-700 transition-all shadow-sm hover:shadow-md"
              >
                <SendIcon className="w-5 h-5" />
              </button>
            </div>
            <p className="mt-2 text-xs text-center text-slate-400 dark:text-slate-500">
              Press Enter to send, Shift+Enter for new line
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
