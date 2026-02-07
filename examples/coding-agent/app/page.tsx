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
      <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
      <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
      <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
    </div>
  );
}

// Tool call card component
function ToolCard({ name, args }: { name: string; args: any }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden bg-neutral-50 dark:bg-neutral-800/50">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <WrenchIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          </div>
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{name}</span>
        </div>
        <ChevronDownIcon className={`w-4 h-4 text-neutral-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800">
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Arguments</div>
          <pre className="text-xs text-neutral-600 dark:text-neutral-300 overflow-x-auto bg-neutral-50 dark:bg-neutral-900 rounded-lg p-2">
            {JSON.stringify(args, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

type MessageBlock =
  | { type: "text"; text: string }
  | { type: "tool-call"; name: string; args: any };

interface Message {
  id: string;
  role: "user" | "assistant";
  blocks: MessageBlock[];
}

// Message bubble component
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        isUser
          ? 'bg-neutral-600 dark:bg-neutral-500'
          : 'bg-blue-500'
      }`}>
        {isUser ? (
          <UserIcon className="w-5 h-5 text-white" />
        ) : (
          <TerminalIcon className="w-4 h-4 text-white" />
        )}
      </div>

      {/* Message content — blocks rendered in order */}
      <div className={`max-w-[85%] space-y-2`}>
        {message.blocks.map((block, i) => {
          if (block.type === "text" && block.text) {
            return (
              <div
                key={i}
                className={`px-4 py-3 rounded-[20px] ${
                  isUser
                    ? 'bg-blue-500 text-white rounded-br-[4px]'
                    : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white rounded-bl-[4px]'
                }`}
              >
                <div className="whitespace-pre-wrap text-sm leading-relaxed">{block.text}</div>
              </div>
            );
          }
          if (block.type === "tool-call") {
            return <ToolCard key={i} name={block.name} args={block.args} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

// Empty state component
function EmptyState({ onSuggestionClick }: { onSuggestionClick: (text: string) => void }) {
  const suggestions = [
    { text: "Read the veryfront.config.ts and explain what it does" },
    { text: "Search for TODO comments using grep" },
    { text: "Run the tests and summarize the results" },
    { text: "What files are in this project?" },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full py-12 px-4">
      <div className="w-16 h-16 rounded-full bg-blue-500 flex items-center justify-center mb-6">
        <TerminalIcon className="w-8 h-8 text-white" />
      </div>
      <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white mb-2">
        Coding Agent
      </h2>
      <p className="text-neutral-500 dark:text-neutral-400 text-center max-w-md mb-8">
        Powered by the Claude Agent SDK — all tools built-in, no API key needed.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onSuggestionClick(suggestion.text)}
            className="flex items-center gap-3 p-4 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl hover:border-blue-400 dark:hover:border-blue-500 transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:bg-blue-200 dark:group-hover:bg-blue-900/50 transition-colors">
              <TerminalIcon className="w-4 h-4" />
            </div>
            <span className="text-sm text-neutral-700 dark:text-neutral-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {suggestion.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Custom hook for agent chat with ordered blocks
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
      blocks: [{ type: "text", text: input.trim() }],
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setError(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // Build plain text history for the API
      const allMessages = [...messages, userMessage];
      const apiMessages = allMessages.map((m) => ({
        role: m.role,
        content: m.blocks
          .filter((b): b is MessageBlock & { type: "text" } => b.type === "text")
          .map((b) => b.text)
          .join("\n"),
      }));

      const response = await fetch(options.api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      let blocks: MessageBlock[] = [];
      const assistantId = `assistant-${Date.now()}`;

      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", blocks: [] }]);

      const updateAssistant = (newBlocks: MessageBlock[]) => {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { id: assistantId, role: "assistant", blocks: newBlocks },
        ]);
      };

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

            if (data.type === "text-delta") {
              const last = blocks[blocks.length - 1];
              if (last?.type === "text") {
                // Append to existing text block
                last.text += data.textDelta || "";
              } else {
                // Start a new text block
                blocks.push({ type: "text", text: data.textDelta || "" });
              }
              updateAssistant([...blocks]);
            } else if (data.type === "tool-call") {
              blocks.push({ type: "tool-call", name: data.toolName, args: data.args });
              updateAssistant([...blocks]);
            } else if (data.type === "error") {
              blocks.push({ type: "text", text: `Error: ${data.error}` });
              updateAssistant([...blocks]);
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
          blocks: [{ type: "text", text: `Error: ${errorObj.message}` }],
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
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleSuggestionClick(text: string) {
    setInput(text);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-neutral-900">
      {/* Header */}
      <header className="flex-shrink-0 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-lg border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center">
            <TerminalIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-neutral-900 dark:text-white">Coding Agent</h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Claude Agent SDK — all tools built-in</p>
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
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                    <TerminalIcon className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-neutral-100 dark:bg-neutral-800 rounded-[20px] rounded-bl-[4px] px-4 py-3">
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
      <div className="flex-shrink-0 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <form onSubmit={handleSubmit} className="relative">
            <div className="flex items-center gap-2 bg-neutral-100 dark:bg-neutral-800 rounded-full border border-neutral-200 dark:border-neutral-700 focus-within:border-blue-400 dark:focus-within:border-blue-500 transition-all px-4 py-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask the coding agent..."
                disabled={isLoading}
                className="flex-1 bg-transparent text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none text-sm"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-600 transition-colors flex items-center justify-center"
              >
                <SendIcon className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
