/**
 * ThreadListContext — Thread navigation state for multi-conversation UIs.
 *
 * Provided by ThreadList.Root or ChatWithSidebar.
 * Consumed by thread list items, create/delete buttons, etc.
 *
 * @module ai/react/components/chat/contexts/thread-list-context
 */

import * as React from "react";
import type { Thread } from "../hooks/use-threads.ts";

export interface ThreadListContextValue {
  threads: Thread[];
  activeThreadId: string | null;
  activeThread: Thread | null;

  // Actions
  createThread: () => Thread;
  selectThread: (id: string) => void;
  deleteThread: (id: string) => void;
  renameThread: (id: string, title: string) => void;
  updateThread: (id: string, updates: Partial<Pick<Thread, "title" | "messages">>) => void;
}

const ThreadListContext = React.createContext<ThreadListContextValue | null>(null);

export function useThreadListContext(): ThreadListContextValue {
  const context = React.useContext(ThreadListContext);
  if (!context) {
    throw new Error("useThreadListContext must be used within a ThreadList provider");
  }
  return context;
}

export function useThreadListContextOptional(): ThreadListContextValue | null {
  return React.useContext(ThreadListContext);
}

export const ThreadListContextProvider = ThreadListContext.Provider;
