import * as React from "react";
import { cn } from "../../theme.ts";
import { MessageSquareIcon, PlusIcon, TrashIcon } from "../../icons/index.ts";
import type { Thread } from "../hooks/use-threads.ts";

export interface ChatSidebarProps {
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onDeleteThread: (id: string) => void;
  onRenameThread?: (id: string, title: string) => void;
  onNewThread?: () => void;
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
          ? "bg-[var(--accent)] text-[var(--tab-active-foreground)] shadow-sm"
          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
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
            className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-[var(--input-border)]"
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
          className="shrink-0 opacity-0 group-hover/thread:opacity-100 p-0.5 text-[var(--muted-foreground)] hover:text-[var(--destructive)] transition-all rounded"
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
  onDeleteThread,
  onRenameThread,
  onNewThread,
  className,
  isOpen = true,
}: ChatSidebarProps): React.ReactElement | null {
  const visibleThreads = React.useMemo(() => threads.filter((t) => t.messages.length > 0), [
    threads,
  ]);
  const grouped = React.useMemo(() => groupThreads(visibleThreads), [visibleThreads]);
  const hasThreads = visibleThreads.length > 0;

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-[var(--sidebar-background)] shrink-0 max-sm:absolute max-sm:z-20 max-sm:shadow-xl",
        className,
      )}
      style={{ width: 240 }}
    >
      {onNewThread && (
        <div className="px-3 pt-4 pb-1">
          <button
            type="button"
            onClick={onNewThread}
            className="w-full inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium text-[var(--foreground)] bg-[var(--card)] hover:opacity-80 transition-all"
          >
            <PlusIcon className="size-4" />
            <span>New Chat</span>
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-2 pt-2 pb-3 space-y-4">
        {hasThreads
          ? Array.from(grouped.entries()).map(([label, items]) => (
            <div key={label}>
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--input-placeholder)]">
                {label}
              </div>
              <div className="space-y-1">
                {items.map((thread) => (
                  <ThreadItem
                    key={thread.id}
                    thread={thread}
                    isActive={thread.id === activeThreadId}
                    onSelect={() => onSelectThread(thread.id)}
                    onDelete={() => onDeleteThread(thread.id)}
                    onRename={onRenameThread
                      ? (title) => onRenameThread(thread.id, title)
                      : undefined}
                  />
                ))}
              </div>
            </div>
          ))
          : (
            <div className="flex flex-col items-center justify-center h-full px-4 text-center text-[var(--muted-foreground)]">
              <p className="text-sm">No chats yet</p>
            </div>
          )}
      </div>
    </div>
  );
}
