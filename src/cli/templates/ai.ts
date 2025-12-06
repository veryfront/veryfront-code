/**
 * AI starter template for Veryfront
 *
 * Simple AI chat application with tool calling.
 * Files in ai/ are auto-discovered by veryfront dev server.
 */

import type { TemplateConfig, TemplateFile } from "./index.ts";

/**
 * AI template configuration including required environment variables
 */
export const aiTemplateConfig: TemplateConfig = {
  envVars: [
    {
      name: "OPENAI_API_KEY",
      description: "Your OpenAI API key",
      required: true,
      sensitive: true,
      placeholder: "sk-...",
      docsUrl: "https://platform.openai.com/api-keys",
    },
  ],
};

export const aiTemplate: TemplateFile[] = [
  // TypeScript config with modern module resolution for npm package exports
  {
    path: "tsconfig.json",
    content: `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "lib": ["DOM", "DOM.Iterable", "ES2020"]
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
`,
  },

  // Agent definition - auto-discovered from ai/agents/
  {
    path: "ai/agents/assistant.ts",
    content: `/**
 * AI Assistant Agent
 *
 * Auto-discovered from ai/agents/ directory.
 * Export default to register the agent.
 */

import { agent, promptRegistry } from 'veryfront/ai';

/**
 * Get the system prompt from the registry
 * Falls back to a default if not found
 */
function getSystemPrompt(): string {
  const prompt = promptRegistry.get('assistant');
  if (prompt) {
    const content = prompt.getContent();
    return typeof content === 'string' ? content : '';
  }
  return 'You are a helpful AI assistant.';
}

export default agent({
  id: 'assistant',
  model: 'openai/gpt-4o',
  system: getSystemPrompt,

  // Reference auto-discovered tools by their IDs
  tools: {
    getWeather: true,
  },

  maxSteps: 10,
});
`,
  },

  // Prompt definition - auto-discovered from ai/prompts/
  {
    path: "ai/prompts/assistant.ts",
    content: `/**
 * Assistant System Prompt
 *
 * Auto-discovered from ai/prompts/ directory.
 * Export default to register the prompt.
 */

import { prompt } from 'veryfront/ai';

export default prompt({
  name: 'assistant',
  description: 'System prompt for the AI assistant',

  getContent: () => \`You are a helpful AI assistant with access to weather information.

When users ask about the weather:
1. Use the getWeather tool to fetch current conditions
2. Provide a friendly summary of the weather
3. Suggest appropriate activities based on conditions

Be conversational and helpful. If you don't know something, say so honestly.\`,
});
`,
  },

  // Tool definition - auto-discovered from ai/tools/
  {
    path: "ai/tools/get-weather.ts",
    content: `/**
 * Weather Tool
 *
 * Auto-discovered from ai/tools/ directory.
 * Export default to register the tool.
 */

import { tool } from 'veryfront/ai';
import { z } from 'zod';

export default tool({
  description: 'Get the current weather for a location',

  inputSchema: z.object({
    location: z.string().describe('The city and state, e.g. San Francisco, CA'),
  }),

  execute: async ({ location }: { location: string }) => {
    // Mock implementation - replace with real weather API
    const mockWeather: Record<string, { temp: number; condition: string }> = {
      'San Francisco, CA': { temp: 65, condition: 'Foggy' },
      'New York, NY': { temp: 75, condition: 'Sunny' },
      'London, UK': { temp: 60, condition: 'Rainy' },
      'Tokyo, Japan': { temp: 80, condition: 'Humid' },
    };

    const weather = mockWeather[location] || {
      temp: 70,
      condition: 'Clear',
    };

    return {
      location,
      temperature: weather.temp,
      condition: weather.condition,
      unit: 'fahrenheit',
    };
  },
});
`,
  },

  {
    path: "app/layout.tsx",
    content: `// Layout component for client-rendered pages
// Tailwind Play CDN is used for 'use client' pages where CSS classes are rendered dynamically
export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <head>
        <title>Veryfront AI Starter</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body className="h-full bg-slate-50 dark:bg-slate-900">
        {children}
      </body>
    </html>
  );
}`,
  },
  {
    path: "app/api/chat/route.ts",
    content: `/**
 * Chat API Route
 *
 * Imports the agent directly from ai/agents/ directory.
 * This ensures the agent is bundled with the route and available at runtime.
 */

import assistantAgent from '../../../ai/agents/assistant';

export async function POST(request: Request) {
  const { messages } = await request.json();

  // Stream response using the agent
  const result = await assistantAgent.stream({ messages });

  // Return Vercel AI SDK compatible streaming response
  return result.toDataStreamResponse();
}
`,
  },
  {
    path: "app/page.tsx",
    content: `/** @jsxImportSource react */
'use client';

import { useEffect, useRef } from "react";
import { useChat } from "veryfront/ai/react";

// Custom SVG Icons
function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"/>
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

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
    </svg>
  );
}

// Typing indicator component
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
      <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
      <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
    </div>
  );
}

interface ToolCall {
  id: string;
  name: string;
}

// Message bubble component
function MessageBubble({ role, content, toolCalls }: { role: "user" | "assistant"; content: string; toolCalls: ToolCall[] }) {
  const isUser = role === "user";

  return (
    <div className={\`flex gap-3 \${isUser ? 'flex-row-reverse' : 'flex-row'}\`}>
      {/* Avatar */}
      <div className={\`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center \${
        isUser
          ? 'bg-slate-600 dark:bg-slate-500'
          : 'bg-gradient-to-br from-violet-500 to-purple-600'
      }\`}>
        {isUser ? (
          <UserIcon className="w-5 h-5 text-white" />
        ) : (
          <SparklesIcon className="w-4 h-4 text-white" />
        )}
      </div>

      {/* Message content */}
      <div className={\`max-w-[80%] px-4 py-3 rounded-2xl \${
        isUser
          ? 'bg-violet-600 text-white rounded-tr-sm'
          : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-tl-sm shadow-sm'
      }\`}>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{content}</div>

        {/* Tool calls display */}
        {toolCalls.length > 0 && (
          <div className="mt-3 pt-2 border-t border-slate-200/20">
            <div className="text-xs opacity-70 mb-2">Tools used:</div>
            {toolCalls.map((tc) => (
              <div key={tc.id} className="text-xs font-mono bg-black/10 dark:bg-white/10 rounded px-2 py-1 mt-1">
                {tc.name}
              </div>
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
    { icon: CloudIcon, text: "What's the weather in San Francisco?" },
    { icon: CloudIcon, text: "Is it going to rain in Tokyo?" },
    { icon: CloudIcon, text: "How hot is it in Miami?" },
    { icon: CloudIcon, text: "Weather forecast for London" },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full py-12 px-4">
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-6 shadow-lg">
        <SparklesIcon className="w-8 h-8 text-white" />
      </div>
      <h2 className="text-2xl font-semibold text-slate-800 dark:text-slate-200 mb-2">
        Veryfront AI Assistant
      </h2>
      <p className="text-slate-500 dark:text-slate-400 text-center max-w-md mb-8">
        I can help you check the weather and answer questions. Try asking about the weather in any city!
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onSuggestionClick(suggestion.text)}
            className="flex items-center gap-3 p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-violet-400 dark:hover:border-violet-500 hover:shadow-md transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 dark:text-violet-400 group-hover:bg-violet-200 dark:group-hover:bg-violet-900/50 transition-colors">
              <suggestion.icon className="w-4 h-4" />
            </div>
            <span className="text-sm text-slate-700 dark:text-slate-300 group-hover:text-violet-700 dark:group-hover:text-violet-400 transition-colors">
              {suggestion.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface Message {
  id: string;
  role: string;
  content: string;
  toolInvocations?: unknown[];
}

export default function ChatPage() {
  const { messages, input, setInput, isLoading, handleSubmit } = useChat({
    api: "/api/chat",
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
      handleSubmit(e as unknown as React.FormEvent);
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
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
            <SparklesIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-slate-800 dark:text-white">Veryfront AI</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Powered by Agents & Tools</p>
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
              {(messages as Message[]).map((m) => (
                <MessageBubble
                  key={m.id}
                  role={m.role as "user" | "assistant"}
                  content={m.content}
                  toolCalls={(m.toolInvocations || []) as ToolCall[]}
                />
              ))}

              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                    <SparklesIcon className="w-4 h-4 text-white" />
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
            <div className="flex items-end gap-2 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 focus-within:border-violet-400 dark:focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-400/20 transition-all">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask me anything..."
                disabled={isLoading}
                rows={1}
                className="flex-1 bg-transparent px-4 py-3 text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 resize-none focus:outline-none text-sm leading-relaxed max-h-[200px]"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="flex-shrink-0 m-2 p-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:from-violet-600 hover:to-purple-700 transition-all shadow-sm hover:shadow-md"
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
}`,
  },
];
