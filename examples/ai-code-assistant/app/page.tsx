'use client';

/**
 * AI Code Assistant - Main Page
 *
 * A sleek, modern chat interface inspired by ChatGPT.
 * Features real-time streaming, tool execution, and session management.
 */

import React, { useEffect, useState, useRef } from 'react';

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

// Sparkle icon for AI
function SparkleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L13.09 8.26L18 7L14.74 10.91L20 14L13.09 13.74L12 20L10.91 13.74L4 14L9.26 10.91L6 7L10.91 8.26L12 2Z" />
    </svg>
  );
}

// User icon
function UserIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM6 8a6 6 0 1 1 12 0A6 6 0 0 1 6 8zm2 10a3 3 0 0 0-3 3 1 1 0 1 1-2 0 5 5 0 0 1 5-5h8a5 5 0 0 1 5 5 1 1 0 1 1-2 0 3 3 0 0 0-3-3H8z" />
    </svg>
  );
}

// Send icon
function SendIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Code icon for tools
function CodeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 18L22 12L16 6M8 6L2 12L8 18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Typing indicator
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

// Tool execution card
function ToolCard({ tool }: { tool: { toolName: string; args: any; state: string; result?: any } }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-3 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-800/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
          <CodeIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{tool.toolName}</span>
            {tool.state === 'call' && (
              <span className="text-xs px-2 py-0.5 bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 rounded-full">
                Running...
              </span>
            )}
            {tool.state === 'result' && (
              <span className="text-xs px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 rounded-full">
                Complete
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
            {JSON.stringify(tool.args).slice(0, 60)}...
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-gray-200 dark:border-gray-700 bg-gray-100/50 dark:bg-gray-900/30">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Arguments</div>
          <pre className="text-xs bg-white dark:bg-gray-800 rounded-lg p-3 overflow-x-auto border border-gray-200 dark:border-gray-700">
            <code className="text-gray-700 dark:text-gray-300">{JSON.stringify(tool.args, null, 2)}</code>
          </pre>
          {tool.state === 'result' && tool.result && (
            <>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 mt-4">Result</div>
              <pre className="text-xs bg-white dark:bg-gray-800 rounded-lg p-3 overflow-x-auto max-h-48 border border-gray-200 dark:border-gray-700">
                <code className="text-gray-700 dark:text-gray-300">{JSON.stringify(tool.result, null, 2)}</code>
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Message component
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`py-6 ${isUser ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50'}`}>
      <div className="max-w-3xl mx-auto px-4 flex gap-4">
        {/* Avatar */}
        <div
          className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
            isUser ? 'bg-gray-600' : 'bg-gradient-to-br from-violet-500 to-purple-600'
          }`}
        >
          {isUser ? (
            <UserIcon className="w-4 h-4 text-white" />
          ) : (
            <SparkleIcon className="w-4 h-4 text-white" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-1">
            {isUser ? 'You' : 'Veryfront AI'}
          </div>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <div className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
              {message.content}
            </div>
          </div>

          {/* Tool Calls */}
          {message.toolInvocations && message.toolInvocations.length > 0 && (
            <div className="mt-4">
              {message.toolInvocations.map((tool, j) => (
                <ToolCard key={j} tool={tool} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Empty state
function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-6 shadow-lg">
        <SparkleIcon className="w-8 h-8 text-white" />
      </div>
      <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
        How can I help you today?
      </h2>
      <p className="text-gray-500 dark:text-gray-400 text-center max-w-md mb-8">
        I can help you explore your codebase, search for patterns, read files, and understand your project structure.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
        {[
          { icon: '🔍', title: 'Search code', desc: '"Find all React components using hooks"' },
          { icon: '📁', title: 'Explore files', desc: '"What files are in the src directory?"' },
          { icon: '📖', title: 'Read content', desc: '"Show me the package.json"' },
          { icon: '🔀', title: 'Git status', desc: '"What are the recent changes?"' },
        ].map((item, i) => (
          <div
            key={i}
            className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-all cursor-pointer group"
          >
            <div className="text-xl mb-2">{item.icon}</div>
            <div className="font-medium text-gray-900 dark:text-gray-100 mb-1 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
              {item.title}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">{item.desc}</div>
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Initialize session ID
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const storedSessionId = localStorage.getItem('ai-assistant-session-id');
    if (storedSessionId) {
      setSessionId(storedSessionId);
    } else {
      const newSessionId = crypto.randomUUID();
      localStorage.setItem('ai-assistant-session-id', newSessionId);
      setSessionId(newSessionId);
    }
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  };

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

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

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
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'chunk') {
                assistantMessage.content += data.content;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...assistantMessage };
                  return updated;
                });
              } else if (data.type === 'tool_call') {
                assistantMessage.toolInvocations = assistantMessage.toolInvocations || [];
                assistantMessage.toolInvocations.push({
                  toolName: data.toolCall.name,
                  args: data.toolCall.args,
                  state: 'call',
                });
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...assistantMessage };
                  return updated;
                });
              } else if (data.type === 'tool_result') {
                const invocations = assistantMessage.toolInvocations || [];
                const idx = invocations.findIndex(
                  (inv) => inv.toolName === data.toolCall.name && inv.state === 'call'
                );
                if (idx >= 0) {
                  invocations[idx] = {
                    ...invocations[idx],
                    state: 'result',
                    result: data.toolCall.result,
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
              console.error('Error parsing SSE data:', e);
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

  // Handle Enter key (with Shift for new line)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Clear conversation
  const handleClearConversation = async () => {
    if (!confirm('Clear conversation history?')) return;

    try {
      await fetch(`/api/chat?sessionId=${sessionId}`, {
        method: 'DELETE',
      });

      // Generate new session ID
      const newSessionId = crypto.randomUUID();
      localStorage.setItem('ai-assistant-session-id', newSessionId);
      setSessionId(newSessionId);
      setMessages([]);
    } catch (error) {
      console.error('Error clearing conversation:', error);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <SparkleIcon className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-gray-900 dark:text-white">Veryfront AI</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">Code Assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {messages.length > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {messages.length} messages
              </span>
            )}
            <button
              onClick={handleClearConversation}
              className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              New chat
            </button>
          </div>
        </div>
      </header>

      {/* Messages Area */}
      <main className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {messages.map((message, i) => (
              <MessageBubble key={message.id || i} message={message} />
            ))}

            {/* Loading State */}
            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="py-6 bg-gray-50 dark:bg-gray-800/50">
                <div className="max-w-3xl mx-auto px-4 flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                    <SparkleIcon className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-1">
                      Veryfront AI
                    </div>
                    <TypingIndicator />
                  </div>
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="py-6 bg-red-50 dark:bg-red-900/20">
                <div className="max-w-3xl mx-auto px-4">
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800">
                    <svg className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <div className="font-medium text-red-800 dark:text-red-200">Something went wrong</div>
                      <div className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Area */}
      <footer className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <form onSubmit={handleSubmit} className="relative">
            <div className="relative rounded-2xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-sm focus-within:border-violet-500 dark:focus-within:border-violet-400 focus-within:ring-1 focus-within:ring-violet-500 dark:focus-within:ring-violet-400 transition-all">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Message Veryfront AI..."
                rows={1}
                className="w-full resize-none bg-transparent px-4 py-3 pr-14 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="absolute right-2 bottom-2 p-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white transition-colors"
              >
                <SendIcon className="w-4 h-4" />
              </button>
            </div>
          </form>
          <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-3">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function HomePage() {
  return <ChatInterface />;
}
