"use client";

import { Chat } from "veryfront/components/ai";
import { useChat } from "veryfront/agent/react";

export default function ChatPage(): React.JSX.Element {
  const chat = useChat({ api: "/api/chat" });

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto max-w-3xl py-8">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            AI Chat
          </h1>
          <p className="mt-2 text-neutral-500 dark:text-neutral-400">
            Try asking about the weather in San Francisco, New York, London, or Tokyo
          </p>
        </header>
        <Chat
          {...chat}
          className="h-[600px] overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800"
        />
      </div>
    </div>
  );
}
