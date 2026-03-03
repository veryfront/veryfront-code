import * as React from "react";
import { cn } from "../../theme.ts";
import { MessageSquareIcon, PlusIcon, TrashIcon } from "../../icons/index.ts";
import type { Thread } from "../hooks/use-threads.ts";

export interface ChatSidebarProps {
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  onDeleteThread: (id: string) => void;
  onRenameThread?: (id: string, title: string) => void;
  className?: string;
  isOpen?: boolean;
}

function getRelativeGroup(timestamp: number): string {
  const day = 86_400_000;
  const diff = Date.now() - timestamp;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart.getTime() - day);

  if (timestamp >= todayStart.getTime()) return "Today";
  if (timestamp >= yesterdayStart.getTime()) return "Yesterday";
  if (diff < 7 * day) return "Previous 7 days";
  return "Older";
}

function groupThreads(threads: Thread[]): Map<string, Thread[]> {
  const groups = new Map<string, Thread[]>();
  const order = ["Today", "Yesterday", "Previous 7 days", "Older"];

  for (const label of order) {
    groups.set(label, []);
  }

  for (const thread of threads) {
    const label = getRelativeGroup(thread.updatedAt);
    groups.get(label)!.push(thread);
  }

  for (const [key, value] of groups) {
    if (value.length === 0) groups.delete(key);
  }

  return groups;
}

function ThreadItem({
  thread,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  thread: Thread;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename?: (title: string) => void;
}): React.ReactElement {
  const [editing, setEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(thread.title);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function handleDoubleClick(): void {
    if (!onRename) return;
    setEditValue(thread.title);
    setEditing(true);
  }

  function commitRename(): void {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== thread.title) {
      onRename?.(trimmed);
    }
  }

  return (
    <div
      className={cn(
        "group/thread flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all",
        isActive
          ? "bg-neutral-200/80 dark:bg-neutral-700/60 text-neutral-900 dark:text-neutral-100 shadow-sm"
          : "text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-200",
      )}
      onClick={!editing ? onSelect : undefined}
      onDoubleClick={handleDoubleClick}
    >
      <MessageSquareIcon className="size-4 shrink-0 opacity-50" />
      {editing
        ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditing(false);
            }}
            className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-neutral-300 dark:border-neutral-600"
          />
        )
        : (
          <span className="flex-1 min-w-0 truncate text-[13px] leading-snug">
            {thread.title}
          </span>
        )}
      {!editing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="shrink-0 opacity-0 group-hover/thread:opacity-100 p-0.5 text-neutral-400 hover:text-red-500 dark:text-neutral-500 dark:hover:text-red-400 transition-all rounded"
          aria-label="Delete thread"
        >
          <TrashIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function ChatSidebar({
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  onRenameThread,
  className,
  isOpen = true,
}: ChatSidebarProps): React.ReactElement | null {
  const visibleThreads = threads.filter((t) => t.messages.length > 0);
  const grouped = React.useMemo(() => groupThreads(visibleThreads), [visibleThreads]);
  const hasThreads = visibleThreads.length > 0;

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "flex flex-col w-[280px] h-full border-r border-neutral-200/80 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/80 shrink-0",
        className,
      )}
    >
      <div className="p-3">
        <button
          type="button"
          onClick={onNewThread}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:bg-neutral-700 dark:hover:bg-neutral-200 transition-colors shadow-sm"
        >
          <PlusIcon className="size-4" />
          <span>New Chat</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-4">
        {hasThreads
          ? Array.from(grouped.entries()).map(([label, items]) => (
            <div key={label}>
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                {label}
              </div>
              <div className="space-y-0.5">
                {items.map((thread) => (
                  <ThreadItem
                    key={thread.id}
                    thread={thread}
                    isActive={thread.id === activeThreadId}
                    onSelect={() => onSelectThread(thread.id)}
                    onDelete={() => onDeleteThread(thread.id)}
                    onRename={onRenameThread ? (title) => onRenameThread(thread.id, title) : undefined}
                  />
                ))}
              </div>
            </div>
          ))
          : (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-400 dark:text-neutral-500">
              <MessageSquareIcon className="size-8 mb-3 opacity-40" />
              <p className="text-xs">No conversations yet</p>
            </div>
          )}
      </div>
    </div>
  );
}
