import * as React from "react";
import { cn } from "../../theme.ts";
import { PencilIcon, PlusIcon, TrashIcon } from "../../icons/index.ts";
import { Button } from "../../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu.tsx";
import type { Thread } from "../hooks/use-threads.ts";

/** Three-dots "more actions" glyph (not in the shared icons barrel). */
function MoreGlyph({ className }: { className?: string }): React.ReactElement {
  return (
    <svg
      className={cn("size-3.5", className)}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

/** Props accepted by chat sidebar. */
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
  const [menuOpen, setMenuOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function startRename(): void {
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

  if (editing) {
    return (
      <div className="flex items-center rounded-[var(--radius-md)] bg-[var(--secondary)] px-2.5 py-1.5">
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setEditing(false);
          }}
          className="min-w-0 flex-1 bg-transparent text-[13px] leading-snug outline-none"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        // Slimmer row (Studio conversation list): tighter padding, title-first.
        "group/thread flex cursor-pointer items-center gap-1 rounded-[var(--radius-md)] px-2.5 py-1.5 transition-colors",
        isActive || menuOpen
          ? "bg-[var(--secondary)] text-[var(--foreground)]"
          : "text-[var(--soft)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
      )}
      onClick={onSelect}
    >
      <span className="min-w-0 flex-1 truncate text-[13px] leading-snug">
        {thread.title}
      </span>
      <div
        className={cn(
          "shrink-0 transition-opacity",
          menuOpen ? "opacity-100" : "opacity-0 group-hover/thread:opacity-100",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="icon-ghost"
              size="icon-xs"
              on="card"
              aria-label={`More actions for ${thread.title}`}
            >
              <MoreGlyph />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            {onRename && (
              <DropdownMenuItem onSelect={startRename}>
                <PencilIcon />
                Rename
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-[var(--destructive)] hover:bg-[color-mix(in_oklch,var(--destructive),transparent_92%)]"
            >
              <TrashIcon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Render chat sidebar. */
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
  const visibleThreads = React.useMemo(
    () => threads.filter((t) => t.messages.length > 0 || t.id === activeThreadId),
    [threads, activeThreadId],
  );
  const grouped = React.useMemo(() => groupThreads(visibleThreads), [
    visibleThreads,
  ]);
  const hasThreads = visibleThreads.length > 0;

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "flex flex-col h-full shrink-0 max-sm:absolute max-sm:z-20 max-sm:shadow-xl max-sm:bg-[var(--background)]",
        className,
      )}
      style={{ width: 240 }}
    >
      {onNewThread && (
        <div className="px-3 pt-4 pb-1">
          <button
            type="button"
            onClick={onNewThread}
            className="inline-flex h-[38px] w-full items-center justify-center gap-1.5 rounded-full bg-[var(--secondary)] px-4 text-sm font-normal text-[var(--foreground)] shadow-sm transition-colors hover:bg-[var(--primary)] hover:text-[var(--secondary)]"
          >
            <PlusIcon className="size-4" />
            <span>New chat</span>
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-2 pt-2 pb-3 space-y-3">
        {hasThreads
          ? Array.from(grouped.entries()).map(([label, items]) => (
            <div key={label}>
              <div className="px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-[var(--faint)]">
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
                    onRename={onRenameThread
                      ? (title) => onRenameThread(thread.id, title)
                      : undefined}
                  />
                ))}
              </div>
            </div>
          ))
          : (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center text-[var(--faint)]">
              <p className="text-sm">No chats yet</p>
            </div>
          )}
      </div>
    </div>
  );
}
