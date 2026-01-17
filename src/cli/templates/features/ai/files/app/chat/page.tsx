"use client";

import { Chat } from "veryfront/components/ai";
import { useChat } from "veryfront/agent/react";

export default function ChatPage() {
  const chat = useChat({ api: "/api/chat" });

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="max-w-3xl mx-auto py-8">
        <header className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            AI Chat
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 mt-2">
            Try asking about the weather in San Francisco, New York, London, or Tokyo
          </p>
        </header>
        <Chat
          {...chat}
          className="h-[600px] rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden"
        />
      </div>
    </div>
  );
}
