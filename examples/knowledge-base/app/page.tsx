"use client";

import React, { useEffect, useRef, useState } from "react";

// Custom SVG Icons
function BookIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

// Typing indicator component
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <span
        className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
        style={{ animationDelay: "0ms" }}
      ></span>
      <span
        className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
        style={{ animationDelay: "150ms" }}
      ></span>
      <span
        className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
        style={{ animationDelay: "300ms" }}
      ></span>
    </div>
  );
}

// Message bubble component
function MessageBubble({
  role,
  content,
}: {
  role: "user" | "assistant";
  content: string;
}) {
  const isUser = role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser ? "bg-neutral-600 dark:bg-neutral-500" : "bg-blue-500"
        }`}
      >
        {isUser ? (
          <UserIcon className="w-5 h-5 text-white" />
        ) : (
          <BookIcon className="w-4 h-4 text-white" />
        )}
      </div>

      {/* Message content */}
      <div
        className={`max-w-[80%] px-4 py-3 rounded-[20px] ${
          isUser
            ? "bg-blue-500 text-white rounded-br-[4px]"
            : "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white rounded-bl-[4px]"
        }`}
      >
        <div className="whitespace-pre-wrap text-sm leading-relaxed">
          {content}
        </div>
      </div>
    </div>
  );
}

// Empty state component
function EmptyState({
  onSuggestionClick,
}: {
  onSuggestionClick: (text: string) => void;
}) {
  const suggestions = [
    { text: "What is this documentation about?" },
    { text: "How do I get started?" },
    { text: "What features are available?" },
    { text: "Show me some examples" },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full py-12 px-4">
      <div className="w-16 h-16 rounded-full bg-blue-500 flex items-center justify-center mb-6">
        <BookIcon className="w-8 h-8 text-white" />
      </div>
      <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white mb-2">
        Knowledge Base Assistant
      </h2>
      <p className="text-neutral-500 dark:text-neutral-400 text-center max-w-md mb-8">
        Ask me anything about the documentation. I can help you find
        information, understand concepts, and navigate the content.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onSuggestionClick(suggestion.text)}
            className="flex items-center gap-3 p-4 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl hover:border-blue-400 dark:hover:border-blue-500 transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:bg-blue-200 dark:group-hover:bg-blue-900/50 transition-colors">
              <SearchIcon className="w-4 h-4" />
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

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg],
        }),
      });

      if (!response.ok) throw new Error("Failed to fetch");

      const reader = response.body?.getReader();
      if (!reader) return;

      // Add empty assistant message
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const decoder = new TextDecoder();
      let assistantContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "content") {
                assistantContent += data.content;
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "assistant") {
                    return [
                      ...prev.slice(0, -1),
                      { ...last, content: assistantContent },
                    ];
                  }
                  return prev;
                });
              }
            } catch (_e) {
              // Ignore parsing errors for incomplete chunks
            }
          }
        }
      }
    } catch (error) {
      console.error(error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
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
            <BookIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-neutral-900 dark:text-white">
              Knowledge Base
            </h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              RAG-powered documentation assistant
            </p>
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
              {messages.map((m, i) => (
                <MessageBubble key={i} role={m.role} content={m.content} />
              ))}

              {loading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                    <BookIcon className="w-4 h-4 text-white" />
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
                placeholder="Ask a question about the documentation..."
                disabled={loading}
                className="flex-1 bg-transparent text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none text-sm"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
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
