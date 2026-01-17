'use client';

/**
 * AI Code Assistant - Main Page
 *
 * A sleek, modern chat interface with Apple-inspired design.
 * Features real-time streaming, tool execution, and session management.
 */

import React, { useEffect, useState, useRef } from 'react';
import { Markdown } from 'veryfront/components/ai';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolInvocations?: Array<{
    toolName: string;
    args: any;
    state: 'call' | 'result';
    result?: any;
  }>;
}

// Typing indicator
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <div className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <div className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

// Tool execution card
function ToolCard({ tool }: { tool: { toolName: string; args: any; state: string; result?: any } }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-3 border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden bg-neutral-50 dark:bg-neutral-800/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors"
      >
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 18L22 12L16 6M8 6L2 12L8 18" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="font-medium text-neutral-900 dark:text-neutral-100 text-sm">{tool.toolName}</span>
            {tool.state === 'call' && (
              <span className="text-xs px-2 py-0.5 bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 rounded-full">
                Running...
              </span>
            )}
            {tool.state === 'result' && (
              <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 rounded-full">
                Complete
              </span>
            )}
          </div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">
            {JSON.stringify(tool.args).slice(0, 60)}...
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-neutral-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-neutral-200 dark:border-neutral-700">
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Arguments</div>
          <pre className="text-xs bg-white dark:bg-neutral-800 rounded-lg p-3 overflow-x-auto border border-neutral-200 dark:border-neutral-700">
            <code className="text-neutral-700 dark:text-neutral-300">{JSON.stringify(tool.args, null, 2)}</code>
          </pre>
          {tool.state === 'result' && tool.result && (
            <>
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2 mt-4">Result</div>
              <pre className="text-xs bg-white dark:bg-neutral-800 rounded-lg p-3 overflow-x-auto max-h-48 border border-neutral-200 dark:border-neutral-700">
                <code className="text-neutral-700 dark:text-neutral-300">{JSON.stringify(tool.result, null, 2)}</code>
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Message component - Apple Messages style
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[75%]">
        <div
          className={`px-4 py-2.5 ${
            isUser
              ? 'bg-blue-500 text-white rounded-[20px] rounded-br-[4px]'
              : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-[20px] rounded-bl-[4px]'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.content}</p>
          ) : (
            <Markdown className="text-[15px] leading-relaxed">{message.content}</Markdown>
          )}
        </div>

        {/* Tool Calls */}
        {message.toolInvocations && message.toolInvocations.length > 0 && (
          <div className="mt-2">
            {message.toolInvocations.map((tool, j) => (
              <ToolCard key={j} tool={tool} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Empty state
function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-14 h-14 rounded-2xl bg-blue-500 flex items-center justify-center mb-6">
        <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L13.09 8.26L18 7L14.74 10.91L20 14L13.09 13.74L12 20L10.91 13.74L4 14L9.26 10.91L6 7L10.91 8.26L12 2Z" />
        </svg>
      </div>
      <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white mb-2">
        How can I help?
      </h2>
      <p className="text-neutral-500 dark:text-neutral-400 text-center max-w-md mb-8">
        I can help you explore your codebase, search for patterns, and understand your project.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
        {[
          { title: 'Search code', desc: 'Find React components using hooks' },
          { title: 'Explore files', desc: 'What files are in src?' },
          { title: 'Read content', desc: 'Show me package.json' },
          { title: 'Git status', desc: 'What are recent changes?' },
        ].map((item, i) => (
          <div
            key={i}
            className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <div className="font-medium text-neutral-900 dark:text-white text-sm mb-1">
              {item.title}
            </div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">{item.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatInterface() {
  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Generate a unique ID (with fallback for environments without crypto.randomUUID)
  const generateId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  };

  // Initialize session ID
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const storedSessionId = localStorage.getItem('ai-assistant-session-id');
    if (storedSessionId) {
      setSessionId(storedSessionId);
    } else {
      const newSessionId = generateId();
      localStorage.setItem('ai-assistant-session-id', newSessionId);
      setSessionId(newSessionId);
    }
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle message submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !sessionId) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Parse SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let assistantMessage: Message = {
        id: `msg_${Date.now()}_assistant`,
        role: 'assistant',
        content: '',
        toolInvocations: [],
      };

      setMessages((prev) => [...prev, assistantMessage]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const rawData = line.slice(6);
            if (rawData === '[DONE]') continue;

            try {
              const data = JSON.parse(rawData);

              if (data.type === 'text-delta') {
                assistantMessage.content += data.textDelta || '';
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...assistantMessage };
                  return updated;
                });
              } else if (data.type === 'tool-call') {
                assistantMessage.toolInvocations = assistantMessage.toolInvocations || [];
                assistantMessage.toolInvocations.push({
                  toolName: data.toolName,
                  args: data.args,
                  state: 'call',
                });
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...assistantMessage };
                  return updated;
                });
              } else if (data.type === 'tool-result') {
                const invocations = assistantMessage.toolInvocations || [];
                const idx = invocations.findIndex(
                  (inv) => inv.toolName === data.toolName && inv.state === 'call'
                );
                if (idx >= 0) {
                  invocations[idx] = {
                    ...invocations[idx],
                    state: 'result',
                    result: data.result,
                  };
                }
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...assistantMessage };
                  return updated;
                });
              } else if (data.type === 'error') {
                throw new Error(data.error);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      }
    } catch (err) {
      console.error('Chat error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  // Clear conversation
  const handleClearConversation = async () => {
    if (!confirm('Clear conversation history?')) return;

    try {
      await fetch(`/api/chat?sessionId=${sessionId}`, {
        method: 'DELETE',
      });

      const newSessionId = generateId();
      localStorage.setItem('ai-assistant-session-id', newSessionId);
      setSessionId(newSessionId);
      setMessages([]);
    } catch (err) {
      console.error('Error clearing conversation:', err);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-neutral-900">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="font-medium text-neutral-900 dark:text-white">AI Assistant</h1>
          {messages.length > 0 && (
            <button
              onClick={handleClearConversation}
              className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors"
            >
              New chat
            </button>
          )}
        </div>
      </header>

      {/* Messages Area */}
      <main className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="max-w-2xl mx-auto px-4 py-4 space-y-2">
            {messages.map((message, i) => (
              <MessageBubble key={message.id || i} message={message} />
            ))}

            {/* Loading State */}
            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex justify-start">
                <div className="bg-neutral-100 dark:bg-neutral-800 rounded-[20px] rounded-bl-[4px] px-4 py-3">
                  <TypingIndicator />
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="mx-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 rounded-2xl text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Input Area */}
      <footer className="flex-shrink-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800">
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex gap-2 items-center">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message"
              className="flex-1 px-4 py-2.5 bg-neutral-100 dark:bg-neutral-800 border-0 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 text-[15px]"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="w-9 h-9 flex items-center justify-center bg-blue-500 hover:bg-blue-600 active:scale-95 text-white rounded-full transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-blue-500 disabled:active:scale-100"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
        </form>
      </footer>
    </div>
  );
}

export default function HomePage() {
  return <ChatInterface />;
}
