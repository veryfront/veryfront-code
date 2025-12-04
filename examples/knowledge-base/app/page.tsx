'use client';

import React, { useEffect, useRef, useState } from "react";

// Custom SVG Icons
function BookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
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

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8"/>
      <path d="M21 21l-4.35-4.35"/>
    </svg>
  );
}

// Typing indicator component
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
      <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
      <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
    </div>
  );
}

// Message bubble component
function MessageBubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        isUser
          ? 'bg-slate-600 dark:bg-slate-500'
          : 'bg-gradient-to-br from-emerald-500 to-teal-600'
      }`}>
        {isUser ? (
          <UserIcon className="w-5 h-5 text-white" />
        ) : (
          <BookIcon className="w-4 h-4 text-white" />
        )}
      </div>

      {/* Message content */}
      <div className={`max-w-[80%] px-4 py-3 rounded-2xl ${
        isUser
          ? 'bg-emerald-600 text-white rounded-tr-sm'
          : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-tl-sm shadow-sm'
      }`}>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{content}</div>
      </div>
    </div>
  );
}

// Empty state component
function EmptyState({ onSuggestionClick }: { onSuggestionClick: (text: string) => void }) {
  const suggestions = [
    { icon: "?", text: "What is this documentation about?" },
    { icon: "?", text: "How do I get started?" },
    { icon: "?", text: "What features are available?" },
    { icon: "?", text: "Show me some examples" },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full py-12 px-4">
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-6 shadow-lg">
        <BookIcon className="w-8 h-8 text-white" />
      </div>
      <h2 className="text-2xl font-semibold text-slate-800 dark:text-slate-200 mb-2">
        Knowledge Base Assistant
      </h2>
      <p className="text-slate-500 dark:text-slate-400 text-center max-w-md mb-8">
        Ask me anything about the documentation. I can help you find information, understand concepts, and navigate the content.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onSuggestionClick(suggestion.text)}
            className="flex items-center gap-3 p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-emerald-400 dark:hover:border-emerald-500 hover:shadow-md transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-200 dark:group-hover:bg-emerald-900/50 transition-colors">
              <SearchIcon className="w-4 h-4" />
            </div>
            <span className="text-sm text-slate-700 dark:text-slate-300 group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
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

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

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
                    return [...prev.slice(0, -1), { ...last, content: assistantContent }];
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
      setMessages(
        (prev) => [...prev, { role: "assistant", content: "Sorry, something went wrong. Please try again." }],
      );
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleSuggestionClick(text: string) {
    setInput(text);
    // Focus and submit after a brief delay
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
            <BookIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-slate-800 dark:text-white">Knowledge Base</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">RAG-powered documentation assistant</p>
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
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                    <BookIcon className="w-4 h-4 text-white" />
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
            <div className="flex items-end gap-2 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 focus-within:border-emerald-400 dark:focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-400/20 transition-all">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question about the documentation..."
                disabled={loading}
                rows={1}
                className="flex-1 bg-transparent px-4 py-3 text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 resize-none focus:outline-none text-sm leading-relaxed max-h-[200px]"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="flex-shrink-0 m-2 p-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:from-emerald-600 hover:to-teal-700 transition-all shadow-sm hover:shadow-md"
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
