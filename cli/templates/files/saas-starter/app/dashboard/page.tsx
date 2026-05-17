"use client";

import { useState } from "react";
import { Chat, useChat } from "veryfront/chat";

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

const INITIAL_CONVERSATIONS: Conversation[] = [
  { id: "1", title: "Getting started", updatedAt: "Just now" },
];

export default function Dashboard(): JSX.Element {
  const [conversations] = useState<Conversation[]>(INITIAL_CONVERSATIONS);
  const [activeId, setActiveId] = useState("1");
  const chat = useChat({ api: "/api/chat" });

  return (
    <div className="flex h-screen bg-white dark:bg-neutral-950">
      {/* Sidebar */}
      <aside className="w-64 border-r border-neutral-200 dark:border-neutral-800 flex flex-col bg-neutral-50 dark:bg-neutral-900">
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-800">
          <button className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors">
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
            New chat
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setActiveId(conv.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                activeId === conv.id
                  ? "bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-white"
                  : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/50"
              }`}
            >
              <p className="truncate">{conv.title}</p>
              <p className="text-xs text-neutral-400 mt-0.5">
                {conv.updatedAt}
              </p>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-xs font-medium text-neutral-600 dark:text-neutral-300">
              U
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-900 dark:text-white truncate">
                User
              </p>
              <p className="text-xs text-neutral-500 truncate">
                user@example.com
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Chat */}
      <main className="flex-1 flex flex-col">
        <Chat {...chat} className="flex-1 min-h-0" placeholder="Message..." />
      </main>
    </div>
  );
}
