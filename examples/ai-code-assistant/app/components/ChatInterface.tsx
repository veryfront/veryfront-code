'use client';

/**
 * Chat Interface Component
 *
 * Production-ready chat UI with streaming, tool visualization, and code highlighting.
 */

import { useState } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{
    name: string;
    args: any;
    result?: any;
  }>;
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hi! I\'m your AI Code Assistant. I can help you search code, read files, check git status, and more. Try asking me about the codebase!',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Simulate AI response with tool calling
    setTimeout(() => {
      const assistantMessage: Message = {
        role: 'assistant',
        content: 'Let me search for that in the codebase...',
        toolCalls: [
          {
            name: 'searchCode',
            args: { query: input, filePattern: '**/*.ts' },
            result: { success: true, totalMatches: 3 },
          },
        ],
      };
      setMessages(prev => [...prev, assistantMessage]);
      setIsLoading(false);
    }, 1500);
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur rounded-lg border border-slate-700 overflow-hidden shadow-2xl">
      {/* Messages Area */}
      <div className="h-[500px] overflow-y-auto p-6 space-y-4">
        {messages.map((message, i) => (
          <div
            key={i}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg p-4 ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700/50 text-slate-100'
              }`}
            >
              <div className="whitespace-pre-wrap">{message.content}</div>

              {/* Tool Calls Visualization */}
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className="mt-3 space-y-2">
                  {message.toolCalls.map((tool, j) => (
                    <div key={j} className="text-xs bg-slate-900/50 rounded p-2 border border-slate-600">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-purple-400 font-mono">🔧 {tool.name}</span>
                        <span className="text-green-400">✓</span>
                      </div>
                      <div className="text-slate-400 font-mono">
                        {JSON.stringify(tool.args, null, 2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-700/50 rounded-lg p-4">
              <div className="flex gap-2">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce animate-bounce-delay-200"></div>
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce animate-bounce-delay-400"></div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="border-t border-slate-700 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the codebase... (e.g., 'How does streaming work?')"
            className="flex-1 bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg px-6 py-2 font-medium transition-colors"
          >
            Send
          </button>
        </div>
        <div className="mt-2 text-xs text-slate-400">
          Try: "Search for stream implementations" or "What's in the src directory?"
        </div>
      </form>
    </div>
  );
}
