/**
 * AI starter template for Veryfront
 */

import type { TemplateFile } from "./index.ts";

export const aiTemplate: TemplateFile[] = [
  {
    path: "veryfront.config.js",
    content: `export default {
  title: "Veryfront AI App",
  description: "An AI-native application starter",
  
  dev: {
    port: 3000,
    open: true,
  },
  
  ai: {
    providers: {
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
      },
    },
    defaultModel: "openai/gpt-4o",
  },

  cache: {
    dir: ".veryfront/cache",
    render: {
      type: "memory",
      ttl: 60 * 1000,
      maxEntries: 200,
    },
  },
};
`,
  },
  {
    path: ".env",
    content: `OPENAI_API_KEY=your_api_key_here`,
  },
  {
    path: "ai/agent.ts",
    content: `import { agent, tool } from "veryfront/ai";
import { z } from "zod";

// Define a tool
const weatherTool = tool({
  id: "get_weather",
  description: "Get the current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("The city and state, e.g. San Francisco, CA"),
  }),
  execute: async ({ location }) => {
    // Mock implementation
    return {
      location,
      temperature: 72,
      condition: "Sunny",
    };
  },
});

// Create the agent
export const myAgent = agent({
  model: "openai/gpt-4o",
  system: "You are a helpful AI assistant with access to weather information.",
  tools: {
    weather: weatherTool,
  },
});
`,
  },
  {
    path: "app/layout.tsx",
    content: `export default function RootLayout({
  children
}: { 
  children: React.ReactNode 
}) {
  return (
    <html lang="en">
      <head>
        <title>Veryfront AI Starter</title>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css"
        />
      </head>
      <body className="bg-gray-50 min-h-screen">
        <div className="max-w-4xl mx-auto p-8">
          {children}
        </div>
      </body>
    </html>
  );
}`,
  },
  {
    path: "app/api/chat/route.ts",
    content: `import { myAgent } from "../../../ai/agent";

export async function POST(request: Request) {
  const { messages } = await request.json();

  // Use the agent to generate a response
  const response = await myAgent.stream({ messages });

  return response.toDataStreamResponse();
}
`,
  },
  {
    path: "app/page.tsx",
    content: `/** @jsxImportSource react */
'use client';

import { useChat } from "veryfront/ai/react";

export default function ChatPage() {
  const { messages, input, setInput, append, isLoading, handleInputChange, handleSubmit } = useChat({
    api: "/api/chat",
  });

  return (
    <div className="flex flex-col h-[80vh] bg-white rounded-xl shadow-lg overflow-hidden">
      <header className="bg-blue-600 text-white p-4">
        <h1 className="text-xl font-bold">Veryfront AI Assistant</h1>
        <p className="text-blue-100 text-sm">Powered by Agents & MCP</p>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-20">
            <p>👋 Hello! I'm your AI assistant.</p>
            <p className="text-sm mt-2">Try asking about the weather!</p>
          </div>
        )}
        
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={
              msg.role === "user" ? "justify-end" : "justify-start"
            }
          >
            <div
              className={
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-800"
              }
            >
              <div className="font-medium text-xs opacity-70 mb-1">
                {msg.role === "user" ? "You" : "Assistant"}
              </div>
              {msg.content}
              
              {/* Show tool calls if any */}
              {msg.toolCalls && (
                <div className="mt-2 pt-2 border-t border-gray-200/20 text-xs font-mono">
                  <div className="opacity-70">Used tools:</div>
                  {msg.toolCalls.map(tc => (
                    <div key={tc.id} className="bg-black/10 rounded px-1 py-0.5 mt-1">
                      {tc.name}({JSON.stringify(tc.arguments)})
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg p-3 text-gray-500 animate-pulse">
              Thinking...
            </div>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-gray-100">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSubmit(e as unknown as React.FormEvent)}
            placeholder="Type a message..."
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
            disabled={isLoading}
          />
          <button
            onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
            disabled={isLoading || !input.trim()}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}`,
  },
];
