/**
 * ThreadListContext — Thread navigation state for multi-conversation UIs.
 *
 * Provided by ThreadList.Root or ChatWithSidebar.
 * Consumed by thread list items, create/delete buttons, etc.
 *
 * @module react/components/chat/contexts/thread-list-context
 */

import * as React from "react";
import { COMPONENT_ERROR } from "#veryfront/errors/error-registry.ts";
import { type Thread, useThreads, type UseThreadsOptions } from "../hooks/use-threads.ts";

/** Public API contract for thread list context value. */
export interface ThreadListContextValue {
  threads: Thread[];
  activeThreadId: string | null;
  activeThread: Thread | null;

  // Actions
  createThread: () => Thread;
  selectThread: (id: string) => void;
  deleteThread: (id: string) => void;
  renameThread: (id: string, title: string) => void;
  updateThread: (
    id: string,
    updates: Partial<Pick<Thread, "title" | "messages" | "agentId">>,
  ) => void;
}

const ThreadListContext = React.createContext<ThreadListContextValue | null>(null);

/** Context for use thread list. */
export function useThreadListContext(): ThreadListContextValue {
  const context = React.useContext(ThreadListContext);
  if (!context) {
    throw COMPONENT_ERROR.create({
      detail: "useThreadListContext must be used within a ThreadList provider",
    });
  }
  return context;
}

/** React hook for thread list context optional. */
export function useThreadListContextOptional(): ThreadListContextValue | null {
  return React.useContext(ThreadListContext);
}

/** Render thread list context provider. */
export const ThreadListContextProvider = ThreadListContext.Provider;

/** Props accepted by {@link ThreadsProvider}. */
export interface ThreadsProviderProps extends UseThreadsOptions {
  children: React.ReactNode;
}

/**
 * ThreadsProvider — calls {@link useThreads} once and shares it through
 * {@link ThreadListContext}. Put it in your app layout so the sidebar and the
 * page read one source of truth via {@link useThreadListContext}; never call
 * `useThreads()` again below it (a second call is a second, disconnected store).
 */
export function ThreadsProvider(
  { children, ...options }: ThreadsProviderProps,
): React.ReactElement {
  const threads = useThreads(options);
  return <ThreadListContextProvider value={threads}>{children}</ThreadListContextProvider>;
}
