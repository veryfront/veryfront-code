/**
 * ChatSidebar — a conversation rail, available as a one-shot preset or as a
 * composable compound (mirroring `Chat` / `Message`).
 *
 * @example Preset — the whole rail from props
 * ```tsx
 * <ChatSidebar
 *   threads={threads}
 *   activeThreadId={activeId}
 *   onSelectThread={select}
 *   onDeleteThread={remove}
 *   onRenameThread={rename}
 *   onNewThread={create}
 * />
 * ```
 *
 * @example Composition — drive the layout yourself
 * ```tsx
 * <ChatSidebar.Root
 *   threads={threads}
 *   activeThreadId={activeId}
 *   onSelectThread={select}
 *   onDeleteThread={remove}
 *   onRenameThread={rename}
 *   onNewThread={create}
 * >
 *   <ChatSidebar.NewButton>New chat</ChatSidebar.NewButton>
 *   <ChatSidebar.List />
 * </ChatSidebar.Root>
 * ```
 *
 * `<ChatSidebar.List />` with no children auto-groups the threads by recency.
 *
 * @example Composition — bring your own grouping / rows
 * ```tsx
 * <ChatSidebar.Root {...ctx}>
 *   <ChatSidebar.NewButton />
 *   <ChatSidebar.List>
 *     <ChatSidebar.Group label="Pinned">
 *       {pinned.map((t) => <ChatSidebar.Item key={t.id} thread={t} />)}
 *     </ChatSidebar.Group>
 *   </ChatSidebar.List>
 * </ChatSidebar.Root>
 * ```
 *
 * @module react/components/chat/chat/components/sidebar
 */
import * as React from "react";
import { COMPONENT_ERROR } from "#veryfront/errors/error-registry.ts";
import { cn } from "../../theme.ts";
import { PencilIcon, TrashIcon } from "../../icons/index.ts";
import { Button } from "../../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu.tsx";
import { List, ListItem, ListLabel } from "../../ui/list.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
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
 * Icon overrides for {@link ChatSidebar}. Each defaults to the built-in glyph
 * (or, for `newThread`, to no icon at all).
 */
export interface ChatSidebarIcons {
  newThread?: React.ReactNode;
  rename?: React.ReactNode;
  delete?: React.ReactNode;
  more?: React.ReactNode;
}

/** Per-row handlers/state handed to a custom {@link ChatSidebarProps.renderThreadItem}. */
export interface ChatSidebarThreadItemRenderOptions {
  isActive: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onRename?: (title: string) => void;
}

// ---------------------------------------------------------------------------
// Context — shared by every ChatSidebar sub-component
// ---------------------------------------------------------------------------

interface ChatSidebarContextValue {
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onDeleteThread: (id: string) => void;
  onRenameThread?: (id: string, title: string) => void;
  onNewThread?: () => void;
  icons?: ChatSidebarIcons;
  loading?: boolean;
  renderThreadItem?: (
    thread: Thread,
    opts: ChatSidebarThreadItemRenderOptions,
  ) => React.ReactNode;
}

const ChatSidebarContext = React.createContext<ChatSidebarContextValue | null>(
  null,
);

function useChatSidebarContext(): ChatSidebarContextValue {
  const context = React.useContext(ChatSidebarContext);
  if (!context) {
    throw COMPONENT_ERROR.create({
      detail: "ChatSidebar sub-components must be used within <ChatSidebar.Root>",
    });
  }
  return context;
}

// ---------------------------------------------------------------------------
// Recency grouping
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ChatSidebar.Root
// ---------------------------------------------------------------------------

/** Props accepted by {@link ChatSidebarRoot}. */
export interface ChatSidebarRootProps {
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onDeleteThread: (id: string) => void;
  onRenameThread?: (id: string, title: string) => void;
  onNewThread?: () => void;
  /** Override any of the sidebar icons. */
  icons?: ChatSidebarIcons;
  /**
   * Show the loading skeleton instead of the list — e.g. while threads are being
   * fetched. When omitted, the auto {@link ChatSidebarList} shows a skeleton on
   * its own until the client mounts (threads usually load from localStorage).
   */
  loading?: boolean;
  /**
   * Render each thread row yourself instead of the built-in row. Consumed by
   * the auto {@link ChatSidebarList}; ignored when you supply your own rows.
   */
  renderThreadItem?: (
    thread: Thread,
    opts: ChatSidebarThreadItemRenderOptions,
  ) => React.ReactNode;
  /** When `false`, the rail renders nothing. Default `true`. */
  isOpen?: boolean;
  /**
   * Fill the parent instead of owning a fixed width + mobile overlay chrome.
   * Set when embedding inside a layout container (e.g. `AppShell.Sidebar`) that
   * already provides width and the off-canvas overlay. Default `false`.
   */
  fill?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Context provider + outer rail container for the compound sidebar. */
export function ChatSidebarRoot({
  threads,
  activeThreadId,
  onSelectThread,
  onDeleteThread,
  onRenameThread,
  onNewThread,
  icons,
  loading,
  renderThreadItem,
  isOpen = true,
  fill = false,
  className,
  children,
}: ChatSidebarRootProps): React.ReactElement | null {
  const value = React.useMemo<ChatSidebarContextValue>(
    () => ({
      threads,
      activeThreadId,
      onSelectThread,
      onDeleteThread,
      onRenameThread,
      onNewThread,
      icons,
      loading,
      renderThreadItem,
    }),
    [
      threads,
      activeThreadId,
      onSelectThread,
      onDeleteThread,
      onRenameThread,
      onNewThread,
      icons,
      loading,
      renderThreadItem,
    ],
  );

  if (!isOpen) return null;

  return (
    <ChatSidebarContext.Provider value={value}>
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
        {children}
      </div>
    </ChatSidebarContext.Provider>
  );
}
ChatSidebarRoot.displayName = "ChatSidebar.Root";

// ---------------------------------------------------------------------------
// ChatSidebar.NewButton
// ---------------------------------------------------------------------------

/** Props accepted by {@link ChatSidebarNewButton}. */
export interface ChatSidebarNewButtonProps {
  /** Button label. Defaults to "New chat". */
  children?: React.ReactNode;
  className?: string;
}

/** The primary "new conversation" action. Wires `onNewThread` from context. */
export function ChatSidebarNewButton({
  children,
  className,
}: ChatSidebarNewButtonProps): React.ReactElement {
  const { onNewThread, icons } = useChatSidebarContext();
  return (
    <div className="px-3 pt-4 pb-1">
      <Button
        type="button"
        variant="primary"
        onClick={onNewThread}
        className={cn("w-full", className)}
      >
        {icons?.newThread}
        {children ?? "New chat"}
      </Button>
    </div>
  );
}
ChatSidebarNewButton.displayName = "ChatSidebar.NewButton";

// ---------------------------------------------------------------------------
// ChatSidebar.Item
// ---------------------------------------------------------------------------

/** Props accepted by {@link ChatSidebarItem}. */
export interface ChatSidebarItemProps {
  thread: Thread;
  className?: string;
}

/** A single thread row — select on click, rename/delete via a "…" menu. */
export function ChatSidebarItem({
  thread,
  className,
}: ChatSidebarItemProps): React.ReactElement {
  const {
    activeThreadId,
    onSelectThread,
    onDeleteThread,
    onRenameThread,
    icons,
  } = useChatSidebarContext();

  const isActive = thread.id === activeThreadId;
  const [editing, setEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(thread.title);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function startRename(): void {
    if (!onRenameThread) return;
    setEditValue(thread.title);
    setEditing(true);
  }

  function commitRename(): void {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== thread.title) {
      onRenameThread?.(thread.id, trimmed);
    }
  }

  if (editing) {
    // Fixed `h-8` = the display row's height (py-1.5 + a size-5 action button),
    // so entering rename mode never resizes the row.
    return (
      <div className="flex h-8 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--accent)] px-2.5">
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setEditing(false);
          }}
          className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-[13px] leading-snug outline-none"
        />
      </div>
    );
  }

  return (
    <ListItem
      title={thread.title}
      active={isActive || menuOpen}
      className={className}
      onClick={() => onSelectThread(thread.id)}
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
            {onRenameThread && (
              <DropdownMenuItem onSelect={startRename}>
                {icons?.rename ?? <PencilIcon />}
                Rename
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => onDeleteThread(thread.id)}
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
ChatSidebarItem.displayName = "ChatSidebar.Item";

// ---------------------------------------------------------------------------
// ChatSidebar.Group
// ---------------------------------------------------------------------------

/** Props accepted by {@link ChatSidebarGroup}. */
export interface ChatSidebarGroupProps {
  /** Section heading (e.g. a recency bucket). Omit for an unlabeled group. */
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** A labeled cluster of thread rows. */
export function ChatSidebarGroup({
  label,
  children,
  className,
}: ChatSidebarGroupProps): React.ReactElement {
  return (
    <List className={className}>
      {label !== undefined && <ListLabel>{label}</ListLabel>}
      {children}
    </List>
  );
}
ChatSidebarGroup.displayName = "ChatSidebar.Group";

// ---------------------------------------------------------------------------
// ChatSidebar.Empty
// ---------------------------------------------------------------------------

/** Props accepted by {@link ChatSidebarEmpty}. */
export interface ChatSidebarEmptyProps {
  children?: React.ReactNode;
  className?: string;
}

/** Placeholder shown when there are no threads to list. */
export function ChatSidebarEmpty({
  children,
  className,
}: ChatSidebarEmptyProps): React.ReactElement {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center px-4 text-center text-[var(--faint)]",
        className,
      )}
    >
      {children ?? <p className="text-sm">No chats yet</p>}
    </div>
  );
}
ChatSidebarEmpty.displayName = "ChatSidebar.Empty";

/**
 * Loading placeholder for the thread list — shown until the client mounts (or
 * while `loading`). Mirrors a real recency group (`List` + `ListLabel` + rows)
 * so it sits at exactly the same position as the loaded list.
 */
function ChatSidebarSkeleton(): React.ReactElement {
  return (
    <output aria-label="Loading conversations" className="block">
      <span className="sr-only">Loading conversations</span>
      <List aria-hidden="true">
        <ListLabel>
          <Skeleton className="h-2! w-10! bg-[var(--edge)]!" />
        </ListLabel>
        {["w-3/4", "w-1/2", "w-2/3", "w-3/5", "w-1/2"].map((width, index) => (
          <div key={`${index}-${width}`} className="px-2.5 py-1.5">
            <Skeleton className={cn("h-3! bg-[var(--edge)]!", width)} />
          </div>
        ))}
      </List>
    </output>
  );
}

// ---------------------------------------------------------------------------
// ChatSidebar.List
// ---------------------------------------------------------------------------

/** Props accepted by {@link ChatSidebarList}. */
export interface ChatSidebarListProps {
  /**
   * Provide your own groups/rows. When omitted, the list auto-groups the
   * context threads by recency and renders {@link ChatSidebarEmpty} when empty.
   */
  children?: React.ReactNode;
  className?: string;
}

/** Scrollable thread region. Auto-groups by recency unless given `children`. */
export function ChatSidebarList({
  children,
  className,
}: ChatSidebarListProps): React.ReactElement {
  const {
    threads,
    activeThreadId,
    onSelectThread,
    onDeleteThread,
    onRenameThread,
    loading,
    renderThreadItem,
  } = useChatSidebarContext();

  // Threads live in localStorage (client-only), so the very first paint has none.
  // Show a skeleton until mounted rather than flashing the "no chats yet" state —
  // or whenever the caller explicitly signals `loading`.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const visibleThreads = React.useMemo(
    () =>
      // A fresh empty draft ("New Chat") pins to the top; everything else is
      // ordered by newest activity. (spread first — never sort the source array.)
      [...threads].sort((a, b) => {
        const aDraft = a.messages.length === 0 ? 1 : 0;
        const bDraft = b.messages.length === 0 ? 1 : 0;
        return bDraft - aDraft || b.updatedAt - a.updatedAt;
      }),
    [threads],
  );
  const grouped = React.useMemo(() => groupThreads(visibleThreads), [
    visibleThreads,
  ]);

  const body = children ?? (
    !mounted || loading
      ? <ChatSidebarSkeleton />
      : visibleThreads.length > 0
      ? Array.from(grouped.entries()).map(([label, items]) => (
        <ChatSidebarGroup key={label} label={label}>
          {items.map((thread) => {
            if (renderThreadItem) {
              return (
                <React.Fragment key={thread.id}>
                  {renderThreadItem(thread, {
                    isActive: thread.id === activeThreadId,
                    onSelect: () => onSelectThread(thread.id),
                    onDelete: () => onDeleteThread(thread.id),
                    onRename: onRenameThread
                      ? (title: string) =>
                        onRenameThread(thread.id, title)
                      : undefined,
                  })}
                </React.Fragment>
              );
            }
            return <ChatSidebarItem key={thread.id} thread={thread} />;
          })}
        </ChatSidebarGroup>
      ))
      : <ChatSidebarEmpty />
  );

  return (
    <div
      className={cn("flex-1 overflow-y-auto px-2 pt-2 pb-3 space-y-3", className)}
    >
      {body}
    </div>
  );
}
ChatSidebarList.displayName = "ChatSidebar.List";

// ---------------------------------------------------------------------------
// ChatSidebar — preset
// ---------------------------------------------------------------------------

/** Props accepted by the {@link ChatSidebar} preset. */
export interface ChatSidebarProps extends Omit<ChatSidebarRootProps, "children"> {}

/** The one-shot preset — composes Root + NewButton + auto List. */
function ChatSidebarBase(props: ChatSidebarProps): React.ReactElement | null {
  const { onNewThread } = props;
  return (
    <ChatSidebarRoot {...props}>
      {onNewThread && <ChatSidebarNewButton />}
      <ChatSidebarList />
    </ChatSidebarRoot>
  );
}
ChatSidebarBase.displayName = "ChatSidebar";

/** Compound type — the preset plus its namespaced sub-components. */
export type ChatSidebarComponent = typeof ChatSidebarBase & {
  Root: typeof ChatSidebarRoot;
  NewButton: typeof ChatSidebarNewButton;
  List: typeof ChatSidebarList;
  Group: typeof ChatSidebarGroup;
  Item: typeof ChatSidebarItem;
  Empty: typeof ChatSidebarEmpty;
};

/** Render a chat sidebar — usable as `<ChatSidebar />` or `<ChatSidebar.Root>…`. */
export const ChatSidebar: ChatSidebarComponent = Object.assign(ChatSidebarBase, {
  Root: ChatSidebarRoot,
  NewButton: ChatSidebarNewButton,
  List: ChatSidebarList,
  Group: ChatSidebarGroup,
  Item: ChatSidebarItem,
  Empty: ChatSidebarEmpty,
});
