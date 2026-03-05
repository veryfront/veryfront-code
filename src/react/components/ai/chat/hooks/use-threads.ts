import * as React from "react";
import type { UIMessage } from "#veryfront/agent/react";
import { isBrowserEnvironment } from "#veryfront/platform/compat/runtime.ts";

export interface Thread {
  id: string;
  title: string;
  messages: UIMessage[];
  createdAt: number;
  updatedAt: number;
}

interface ThreadIndex {
  ids: string[];
}

export interface UseThreadsOptions {
  /** localStorage key prefix. Default: "vf-threads" */
  storageKey?: string;
}

export interface UseThreadsResult {
  threads: Thread[];
  activeThreadId: string | null;
  activeThread: Thread | null;
  createThread: () => Thread;
  selectThread: (id: string) => void;
  deleteThread: (id: string) => void;
  updateThread: (id: string, updates: Partial<Pick<Thread, "title" | "messages">>) => void;
  renameThread: (id: string, title: string) => void;
}

function generateId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyThread(): Thread {
  return {
    id: generateId(),
    title: "New Chat",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function loadIndex(key: string): ThreadIndex {
  if (!isBrowserEnvironment()) return { ids: [] };
  try {
    const raw = localStorage.getItem(`${key}-index`);
    if (raw) return JSON.parse(raw) as ThreadIndex;
  } catch { /* corrupted */ }
  return { ids: [] };
}

function saveIndex(key: string, index: ThreadIndex): void {
  if (!isBrowserEnvironment()) return;
  localStorage.setItem(`${key}-index`, JSON.stringify(index));
}

function loadThread(key: string, id: string): Thread | null {
  if (!isBrowserEnvironment()) return null;
  try {
    const raw = localStorage.getItem(`${key}-${id}`);
    if (raw) return JSON.parse(raw) as Thread;
  } catch { /* corrupted */ }
  return null;
}

function saveThread(key: string, thread: Thread): void {
  if (!isBrowserEnvironment()) return;
  localStorage.setItem(`${key}-${thread.id}`, JSON.stringify(thread));
}

function removeThread(key: string, id: string): void {
  if (!isBrowserEnvironment()) return;
  localStorage.removeItem(`${key}-${id}`);
}

export function useThreads(options?: UseThreadsOptions): UseThreadsResult {
  const storageKey = options?.storageKey ?? "vf-threads";

  const [threads, setThreads] = React.useState<Thread[]>(() => {
    const index = loadIndex(storageKey);
    const loaded: Thread[] = [];
    for (const id of index.ids) {
      const thread = loadThread(storageKey, id);
      if (thread) loaded.push(thread);
    }

    if (loaded.length === 0) {
      // Return empty array during SSR/first render; create thread in useEffect
      return [];
    }

    // Sort by updatedAt desc
    loaded.sort((a, b) => b.updatedAt - a.updatedAt);
    return loaded;
  });

  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(
    () => threads[0]?.id ?? null,
  );

  // Create initial thread on client only to avoid SSR hydration mismatch
  React.useEffect(() => {
    if (threads.length > 0) return;
    const first = createEmptyThread();
    saveThread(storageKey, first);
    saveIndex(storageKey, { ids: [first.id] });
    setThreads([first]);
    setActiveThreadId(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced persist — clear on unmount to avoid stale writes
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => clearTimeout(saveTimerRef.current), []);
  const persistThreads = React.useCallback(
    (updated: Thread[]) => {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveIndex(storageKey, { ids: updated.map((t) => t.id) });
        for (const thread of updated) {
          saveThread(storageKey, thread);
        }
      }, 300);
    },
    [storageKey],
  );

  const activeThread = React.useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  );

  const createThread = React.useCallback((): Thread => {
    const thread = createEmptyThread();
    setThreads((prev) => {
      const next = [thread, ...prev];
      persistThreads(next);
      return next;
    });
    setActiveThreadId(thread.id);
    return thread;
  }, [persistThreads]);

  const selectThread = React.useCallback((id: string): void => {
    setActiveThreadId(id);
  }, []);

  const deleteThread = React.useCallback(
    (id: string): void => {
      setThreads((prev) => {
        const next = prev.filter((t) => t.id !== id);
        removeThread(storageKey, id);

        if (next.length === 0) {
          const fresh = createEmptyThread();
          saveThread(storageKey, fresh);
          const result = [fresh];
          persistThreads(result);
          setActiveThreadId(fresh.id);
          return result;
        }

        persistThreads(next);
        // If we deleted the active thread, switch to the first one
        setActiveThreadId((current) => current === id ? (next[0]?.id ?? null) : current);
        return next;
      });
    },
    [storageKey, persistThreads],
  );

  const updateThread = React.useCallback(
    (id: string, updates: Partial<Pick<Thread, "title" | "messages">>): void => {
      setThreads((prev) => {
        const next = prev.map((t) => {
          if (t.id !== id) return t;
          return { ...t, ...updates, updatedAt: Date.now() };
        });
        persistThreads(next);
        return next;
      });
    },
    [persistThreads],
  );

  const renameThread = React.useCallback(
    (id: string, title: string): void => {
      updateThread(id, { title });
    },
    [updateThread],
  );

  return {
    threads,
    activeThreadId,
    activeThread,
    createThread,
    selectThread,
    deleteThread,
    updateThread,
    renameThread,
  };
}
