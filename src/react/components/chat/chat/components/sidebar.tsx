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
import { List, ListItem, ListLabel } from "../../ui/list.tsx";
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

/**
 * Icon overrides for {@link ChatSidebar}. Each defaults to the built-in glyph.
 */
export interface ChatSidebarIcons {
  newThread?: React.ReactNode;
  rename?: React.ReactNode;
  delete?: React.ReactNode;
  more?: React.ReactNode;
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
  /**
   * Fill the parent instead of owning a fixed width + mobile overlay chrome.
   * Set when embedding inside a layout container (e.g. `AppShell.Sidebar`) that
   * already provides width and the off-canvas overlay. Default `false`.
   */
  fill?: boolean;
  /** Override any of the sidebar icons. */
  icons?: ChatSidebarIcons;
  /**
   * Render each thread row yourself instead of the built-in {@link ThreadItem}.
   * Receives the thread plus the per-row handlers/state the internal item uses.
   * When omitted, rows render exactly as the default.
   */
  renderThreadItem?: (
    thread: Thread,
    opts: {
      isActive: boolean;
      onSelect: () => void;
      onDelete?: () => void;
      onRename?: (title: string) => void;
    },
  ) => React.ReactNode;
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
  icons,
}: {
  thread: Thread;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename?: (title: string) => void;
  icons?: ChatSidebarIcons;
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
      <div className="flex items-center rounded-[var(--radius-md)] bg-[var(--accent)] px-2.5 py-1.5">
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
    <ListItem
      title={thread.title}
      active={isActive || menuOpen}
      onClick={onSelect}
      action={
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="icon-ghost"
              size="icon-xs"
              on="card"
              aria-label={`More actions for ${thread.title}`}
            >
              {icons?.more ?? <MoreGlyph />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            {onRename && (
              <DropdownMenuItem onSelect={startRename}>
                {icons?.rename ?? <PencilIcon />}
                Rename
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-[var(--destructive)] hover:bg-[color-mix(in_oklch,var(--destructive),transparent_92%)]"
            >
              {icons?.delete ?? <TrashIcon />}
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
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
  fill = false,
  icons,
  renderThreadItem,
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
        "flex flex-col h-full",
        fill
          ? "w-full"
          : "shrink-0 max-sm:absolute max-sm:z-20 max-sm:shadow-xl max-sm:bg-[var(--background)]",
        className,
      )}
      style={fill ? undefined : { width: 240 }}
    >
      {onNewThread && (
        <div className="px-3 pt-4 pb-1">
          <Button
            type="button"
            variant="secondary"
            onClick={onNewThread}
            className="w-full shadow-sm"
          >
            {icons?.newThread ?? <PlusIcon className="size-4" />}
            New chat
          </Button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-2 pt-2 pb-3 space-y-3">
        {hasThreads
          ? Array.from(grouped.entries()).map(([label, items]) => (
            <List key={label}>
              <ListLabel>{label}</ListLabel>
              {items.map((thread) => {
                const isActive = thread.id === activeThreadId;
                const onSelect = () => onSelectThread(thread.id);
                const onDelete = () => onDeleteThread(thread.id);
                const onRename = onRenameThread
                  ? (title: string) => onRenameThread(thread.id, title)
                  : undefined;

                if (renderThreadItem) {
                  return (
                    <React.Fragment key={thread.id}>
                      {renderThreadItem(thread, {
                        isActive,
                        onSelect,
                        onDelete,
                        onRename,
                      })}
                    </React.Fragment>
                  );
                }

                return (
                  <ThreadItem
                    key={thread.id}
                    thread={thread}
                    isActive={isActive}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    onRename={onRename}
                    icons={icons}
                  />
                );
              })}
            </List>
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
