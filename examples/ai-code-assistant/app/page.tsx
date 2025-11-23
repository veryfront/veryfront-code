'use client';

/**
 * AI Code Assistant - Main Page
 *
 * A production-ready chat interface with real-time streaming,
 * tool execution visualization, and session management.
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

function ChatInterface() {
  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
    <div className="bg-slate-800/50 backdrop-blur rounded-lg border border-slate-700 overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="border-b border-slate-700 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
          <span className="text-slate-300 text-sm font-medium">
            {messages.length} messages • Session: {sessionId.substring(0, 8)}...
          </span>
        </div>
        <button
          onClick={handleClearConversation}
          className="text-slate-400 hover:text-slate-200 text-sm transition-colors"
          title="Clear conversation"
        >
          🗑️ Clear
        </button>
      </div>

      {/* Messages Area */}
      <div className="h-[500px] overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-slate-400">
              <div className="text-4xl mb-4">💬</div>
              <p className="text-lg">Start a conversation</p>
              <p className="text-sm mt-2">
                Try: "What files are in the src directory?" or "Search for agent code"
              </p>
            </div>
          </div>
        )}

        {messages.map((message, i) => (
          <div
            key={message.id || i}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg p-4 ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700/50 text-white'
              }`}
            >
              <div className="whitespace-pre-wrap">{message.content}</div>

              {/* Tool Calls Visualization */}
              {message.toolInvocations && message.toolInvocations.length > 0 && (
                <div className="mt-3 space-y-2">
                  {message.toolInvocations.map((tool, j) => (
                    <div
                      key={j}
                      className="text-xs bg-slate-900/50 rounded p-3 border border-slate-600"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-purple-400 font-mono">🔧 {tool.toolName}</span>
                        {tool.state === 'result' && (
                          <span className="text-green-400 text-lg">✓</span>
                        )}
                        {tool.state === 'call' && (
                          <span className="text-yellow-400 animate-pulse">⏳</span>
                        )}
                      </div>

                      {/* Tool Arguments */}
                      <div className="text-slate-400 font-mono text-[10px] mb-2">
                        <div className="font-semibold text-slate-300 mb-1">Args:</div>
                        <pre className="overflow-x-auto">
                          {JSON.stringify(tool.args, null, 2)}
                        </pre>
                      </div>

                      {/* Tool Result */}
                      {tool.state === 'result' && tool.result && (
                        <div className="text-slate-400 font-mono text-[10px]">
                          <div className="font-semibold text-green-300 mb-1">Result:</div>
                          <pre className="overflow-x-auto max-h-32 overflow-y-auto">
                            {JSON.stringify(tool.result, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-700/50 rounded-lg p-4">
              <div className="flex gap-2 items-center">
                <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce animate-bounce-delay-200"></div>
                <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce animate-bounce-delay-400"></div>
                <span className="text-slate-400 text-sm ml-2">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="flex justify-center">
            <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-200 text-sm">
              <div className="font-semibold mb-1">Error</div>
              {error}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="border-t border-slate-700 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the codebase... (e.g., 'How does streaming work?')"
            className="flex-1 bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-slate-400"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg px-6 py-2 font-medium transition-colors"
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </div>
        <div className="mt-2 text-xs text-slate-400 flex items-center justify-between">
          <span>Try: "Search for stream implementations" or "What's in the src directory?"</span>
          {messages.length > 0 && (
            <span className="text-slate-500">{messages.length} messages in session</span>
          )}
        </div>
      </form>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            AI Code Assistant
          </h1>
          <p className="text-slate-300">
            Powered by Veryfront AI with streaming, tool calling, and session management
          </p>
          <div className="flex justify-center gap-4 mt-4 text-sm text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
              Live Streaming
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
              4 Tools
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-purple-400 rounded-full"></span>
              Session Isolated
            </span>
          </div>
        </header>

        {/* Chat Interface */}
        <ChatInterface />

        {/* Features */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="bg-slate-800/50 backdrop-blur rounded-lg p-4 border border-slate-700 hover:border-slate-600 transition-colors">
            <div className="text-2xl mb-2">🔍</div>
            <h3 className="text-white font-semibold mb-2">Code Search</h3>
            <p className="text-slate-400">
              Search through your codebase with powerful pattern matching and regex support
            </p>
          </div>
          <div className="bg-slate-800/50 backdrop-blur rounded-lg p-4 border border-slate-700 hover:border-slate-600 transition-colors">
            <div className="text-2xl mb-2">📁</div>
            <h3 className="text-white font-semibold mb-2">File Operations</h3>
            <p className="text-slate-400">
              Read files, list directories, and navigate your project structure
            </p>
          </div>
          <div className="bg-slate-800/50 backdrop-blur rounded-lg p-4 border border-slate-700 hover:border-slate-600 transition-colors">
            <div className="text-2xl mb-2">🔀</div>
            <h3 className="text-white font-semibold mb-2">Git Integration</h3>
            <p className="text-slate-400">
              Check status, view changes, and understand your repository state
            </p>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-8 text-center text-slate-500 text-xs">
          <p>
            Built with{' '}
            <a
              href="https://veryfront.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-400 hover:text-purple-300 transition-colors"
            >
              Veryfront AI
            </a>
            {' '}• Real-time streaming • Session management • Tool execution
          </p>
        </footer>
      </div>
    </div>
  );
}
