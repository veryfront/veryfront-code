/**
 * ChatSidebar — a conversation rail, available as a one-shot preset or as a
 * composable compound (mirroring `Chat` / `Message`).
 *
 * Conversation-native: inside a {@link ConversationsProvider} it needs **no
 * props** — the list, active id, and select/new/delete/rename come from context.
 * Pass props to override (controlled), or use the compound parts for a custom layout.
 *
 * @example Zero-config inside a provider
 * ```tsx
 * <ConversationsProvider store={store}>
 *   <ChatSidebar />          // conversations + actions come from context
 * </ConversationsProvider>
 * ```
 *
 * @example Preset — the whole rail from props
 * ```tsx
 * <ChatSidebar
 *   conversations={conversations}
 *   activeId={activeId}
 *   onSelect={select}
 *   onDelete={remove}
 *   onRename={rename}
 *   onNew={create}
 * />
 * ```
 *
 * @example Composition — drive the layout yourself
 * ```tsx
 * <ChatSidebar.Root>
 *   <ChatSidebar.NewButton>New chat</ChatSidebar.NewButton>
 *   <ChatSidebar.List />
 * </ChatSidebar.Root>
 * ```
 *
 * `<ChatSidebar.List />` with no children auto-groups the conversations by recency.
 *
 * @module react/components/chat/chat/components/sidebar
 */
import * as React from "react";
import { createStrictContext } from "../../../create-strict-context.ts";
import { cn, UI_SCOPE_ATTRS } from "../../theme.ts";
import { PencilIcon, TrashIcon } from "../../../ui/icons/index.ts";
import { Button } from "../../../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../ui/dropdown-menu.tsx";
import { List, ListItem, ListLabel } from "../../../ui/list.tsx";
import { Skeleton } from "../../../ui/skeleton.tsx";
import { ChatTokens } from "../../chat-tokens-style.tsx";
import type { ConversationSummary } from "../persistence/conversation-store.ts";
import { useConversationsContextOptional } from "../contexts/conversations-context.tsx";

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

/** Per-row handlers/state handed to a custom {@link ChatSidebarRootProps.renderItem}. */
export interface ChatSidebarItemRenderOptions {
  isActive: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onRename?: (title: string) => void;
}

// ---------------------------------------------------------------------------
// Shared props — the conversation-native API
// ---------------------------------------------------------------------------

/** Data + action props shared by the preset and {@link ChatSidebarRoot}. */
interface ChatSidebarControlProps {
  /** Conversations to list, newest first. Defaults to the provider's list. */
  conversations?: ConversationSummary[];
  /** The currently selected conversation, or `null`. Defaults from context. */
  activeId?: string | null;
  /** Called when a conversation is chosen. Defaults to the provider's `select`. */
  onSelect?: (id: string) => void;
  /** Called when a conversation is deleted. Defaults to the provider's `remove`. */
  onDelete?: (id: string) => void;
  /** Called when a title is edited. Defaults to the provider's `rename`. */
  onRename?: (id: string, title: string) => void;
  /** Called to start a new conversation. Defaults to the provider's `create`. */
  onNew?: () => void;
  /** Render each row yourself instead of the built-in row (auto {@link ChatSidebarList}). */
  renderItem?: (
    conversation: ConversationSummary,
    opts: ChatSidebarItemRenderOptions,
  ) => React.ReactNode;
}

// ---------------------------------------------------------------------------
// Context — shared by every ChatSidebar sub-component
// ---------------------------------------------------------------------------

interface ChatSidebarContextValue {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  onNew?: () => void;
  loading?: boolean;
  renderItem?: (
    conversation: ConversationSummary,
    opts: ChatSidebarItemRenderOptions,
  ) => React.ReactNode;
}

const [ChatSidebarContext, useChatSidebarContext] = createStrictContext<ChatSidebarContextValue>(
  "ChatSidebar sub-components",
  "<ChatSidebar.Root>",
);

const noop = (): void => {};

/**
 * Resolve the sidebar's data + actions from the explicit conversation props,
 * falling back to the surrounding {@link ConversationsProvider}. Inside a
 * provider the sidebar needs no props.
 */
function useResolvedSidebar(props: ChatSidebarControlProps): {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  onNew?: () => void;
  renderItem?: ChatSidebarContextValue["renderItem"];
} {
  const ctx = useConversationsContextOptional();

  const conversations = props.conversations ?? ctx?.conversations ?? [];
  const activeId = props.activeId !== undefined
    ? props.activeId
    : ctx?.activeConversationId ?? null;
  const onSelect = props.onSelect ?? ctx?.select ?? noop;
  const onDelete = props.onDelete ?? ctx?.remove ?? noop;
  const onRename = props.onRename ?? ctx?.rename;
  const onNew = props.onNew ?? (ctx ? () => void ctx.create() : undefined);
  const renderItem = props.renderItem;

  return { conversations, activeId, onSelect, onDelete, onRename, onNew, renderItem };
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

function groupConversations(
  conversations: ConversationSummary[],
): Map<string, ConversationSummary[]> {
  const groups = new Map<string, ConversationSummary[]>();
  const order = ["Today", "Yesterday", "Previous 7 days", "Older"];

  for (const label of order) {
    groups.set(label, []);
  }

  for (const conversation of conversations) {
    const label = getRelativeGroup(conversation.updatedAt);
    groups.get(label)!.push(conversation);
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
export interface ChatSidebarRootProps extends ChatSidebarControlProps {
  /** Show the loading skeleton while conversations are being fetched. */
  loading?: boolean;
  /** When `false`, the rail renders nothing. Default `true`. */
  isOpen?: boolean;
  /** @deprecated The root fills its parent by default. */
  fill?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Context provider + outer rail container for the compound sidebar. */
export function ChatSidebarRoot(props: ChatSidebarRootProps): React.ReactElement | null {
  const { loading, isOpen = true, fill = false, className, children } = props;
  const resolved = useResolvedSidebar(props);

  const value = React.useMemo<ChatSidebarContextValue>(
    () => ({ ...resolved, loading }),
    [
      resolved.conversations,
      resolved.activeId,
      resolved.onSelect,
      resolved.onDelete,
      resolved.onRename,
      resolved.onNew,
      resolved.renderItem,
      loading,
    ],
  );

  if (!isOpen) return null;

  return (
    <ChatSidebarContext.Provider value={value}>
      <ChatTokens />
      <div
        {...UI_SCOPE_ATTRS}
        // Fills its parent by default (a composed layout container provides
        // width + overlay); the standalone preset supplies its own rail chrome.
        className={cn("flex flex-col h-full", fill && "w-full", className)}
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
  /** Optional leading icon. */
  icon?: React.ReactNode;
  className?: string;
}

/** The primary "new conversation" action. Wires `onNew` from context. */
export function ChatSidebarNewButton({
  children,
  icon,
  className,
}: ChatSidebarNewButtonProps): React.ReactElement {
  const { onNew } = useChatSidebarContext();
  return (
    <div className="px-3 pt-4 pb-1">
      <Button
        type="button"
        variant="primary"
        onClick={onNew}
        className={cn("w-full", className)}
      >
        {icon}
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
/**
 * Per-row state + actions shared with `ChatSidebar.Item.*` leaves, so a swapped
 * or extended row menu keeps rename/delete/select behaviour (the acid test).
 */
export interface ChatSidebarItemContextValue {
  conversation: ConversationSummary;
  isActive: boolean;
  /** Rename is available (the surrounding sidebar wired an `onRename`). */
  canRename: boolean;
  /** Enter inline-rename mode (no-op when rename is unavailable). */
  startRename: () => void;
  /** Delete this conversation. */
  remove: () => void;
  /** `…` menu open state (drives the row's active styling). */
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}

const [ChatSidebarItemContext, useChatSidebarItem] = createStrictContext<
  ChatSidebarItemContextValue
>(
  "ChatSidebar.Item.*",
  "<ChatSidebar.Item>",
);
export { useChatSidebarItem };

export interface ChatSidebarItemProps {
  conversation: ConversationSummary;
  className?: string;
  /**
   * Compose the row's action slot — typically a `<ChatSidebar.Item.Menu>`.
   * Omit for the default `…` rename/delete menu.
   */
  children?: React.ReactNode;
}

/**
 * A single conversation row — select on click, rename/delete via a "…" menu.
 * The menu is a composable compound: pass a `<ChatSidebar.Item.Menu>` child to
 * add or reorder entries without re-implementing the row.
 */
export function ChatSidebarItem({
  conversation,
  className,
  children,
}: ChatSidebarItemProps): React.ReactElement {
  const { activeId, onSelect, onDelete, onRename } = useChatSidebarContext();

  const isActive = conversation.id === activeId;
  const [editing, setEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(conversation.title);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startRename = React.useCallback((): void => {
    if (!onRename) return;
    setEditValue(conversation.title);
    setEditing(true);
  }, [onRename, conversation.title]);

  function commitRename(): void {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename?.(conversation.id, trimmed);
    }
  }

  const itemContext = React.useMemo<ChatSidebarItemContextValue>(
    () => ({
      conversation,
      isActive,
      canRename: Boolean(onRename),
      startRename,
      remove: () => onDelete(conversation.id),
      menuOpen,
      setMenuOpen,
    }),
    [conversation, isActive, onRename, startRename, onDelete, menuOpen],
  );

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
    <ChatSidebarItemContext.Provider value={itemContext}>
      <ListItem
        title={conversation.title}
        active={isActive || menuOpen}
        className={className}
        onClick={() => onSelect(conversation.id)}
        action={children ?? <ChatSidebarItemMenu />}
      />
    </ChatSidebarItemContext.Provider>
  );
}
ChatSidebarItem.displayName = "ChatSidebar.Item";

/** Props for {@link ChatSidebarItemMenu}. */
export interface ChatSidebarItemMenuProps {
  /** Override the trigger glyph. */
  icon?: React.ReactNode;
  /** Compose the entries; omit for the default `Rename` + `Delete`. */
  children?: React.ReactNode;
}

/** The row's `…` dropdown. Reads row state from {@link useChatSidebarItem}. */
export function ChatSidebarItemMenu({
  icon,
  children,
}: ChatSidebarItemMenuProps): React.ReactElement {
  const { conversation, menuOpen, setMenuOpen } = useChatSidebarItem();
  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="icon-ghost"
          size="icon-xs"
          on="card"
          aria-label={`More actions for ${conversation.title}`}
        >
          {icon ?? <MoreGlyph />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {children ?? (
          <>
            <ChatSidebarItemRename />
            <ChatSidebarItemDelete />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
ChatSidebarItemMenu.displayName = "ChatSidebar.Item.Menu";

/** Props for {@link ChatSidebarItemRename} / {@link ChatSidebarItemDelete}. */
export interface ChatSidebarItemActionProps {
  /** Override the entry glyph. */
  icon?: React.ReactNode;
  /** Override the entry label. */
  children?: React.ReactNode;
}

/** `Rename` menu entry — enters inline rename. Renders nothing if unavailable. */
export function ChatSidebarItemRename({
  icon,
  children,
}: ChatSidebarItemActionProps): React.ReactElement | null {
  const { canRename, startRename } = useChatSidebarItem();
  if (!canRename) return null;
  return (
    <DropdownMenuItem onSelect={startRename}>
      {icon ?? <PencilIcon />}
      {children ?? "Rename"}
    </DropdownMenuItem>
  );
}
ChatSidebarItemRename.displayName = "ChatSidebar.Item.Rename";

/** `Delete` menu entry. */
export function ChatSidebarItemDelete({
  icon,
  children,
}: ChatSidebarItemActionProps): React.ReactElement {
  const { remove } = useChatSidebarItem();
  return (
    <DropdownMenuItem
      onSelect={remove}
      className="text-[var(--destructive)] hover:bg-[color-mix(in_oklch,var(--destructive),transparent_92%)]"
    >
      {icon ?? <TrashIcon />}
      {children ?? "Delete"}
    </DropdownMenuItem>
  );
}
ChatSidebarItemDelete.displayName = "ChatSidebar.Item.Delete";

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

/** A labeled cluster of conversation rows. */
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

/** Placeholder shown when there are no conversations to list. */
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
 * Loading placeholder for the list — shown until the client mounts (or while
 * `loading`). Mirrors a real recency group (`List` + `ListLabel` + rows) so it
 * sits at exactly the same position as the loaded list.
 */
function ChatSidebarSkeleton(): React.ReactElement {
  return (
    <output aria-label="Loading conversations" className="block pt-1.5">
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
   * context conversations by recency and renders {@link ChatSidebarEmpty} when
   * empty.
   */
  children?: React.ReactNode;
  className?: string;
}

/** Scrollable region. Auto-groups by recency unless given `children`. */
export function ChatSidebarList({
  children,
  className,
}: ChatSidebarListProps): React.ReactElement {
  const {
    conversations,
    activeId,
    onSelect,
    onDelete,
    onRename,
    loading,
    renderItem,
  } = useChatSidebarContext();

  // Conversations may load from localStorage (client-only), so the very first
  // paint has none. Show a skeleton until mounted rather than flashing the
  // "no chats yet" state — or whenever the caller explicitly signals `loading`.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const visible = React.useMemo(
    // Newest activity first. (spread first — never sort the source array.)
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  );
  const grouped = React.useMemo(() => groupConversations(visible), [visible]);

  const body = children ?? (
    !mounted || loading
      ? <ChatSidebarSkeleton />
      : visible.length > 0
      ? Array.from(grouped.entries()).map(([label, items]) => (
        <ChatSidebarGroup key={label} label={label}>
          {items.map((conversation) => {
            if (renderItem) {
              return (
                <React.Fragment key={conversation.id}>
                  {renderItem(conversation, {
                    isActive: conversation.id === activeId,
                    onSelect: () => onSelect(conversation.id),
                    onDelete: () => onDelete(conversation.id),
                    onRename: onRename
                      ? (title: string) =>
                        onRename(conversation.id, title)
                      : undefined,
                  })}
                </React.Fragment>
              );
            }
            return <ChatSidebarItem key={conversation.id} conversation={conversation} />;
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
/**
 * Fixed-width rail chrome (240px `w-60`, off-canvas overlay on small screens)
 * for the standalone `<ChatSidebar>` preset. `ChatSidebar.Root` is width-agnostic.
 */
export const STANDALONE_SIDEBAR_CHROME =
  "w-60 shrink-0 max-sm:absolute max-sm:z-20 max-sm:shadow-xl max-sm:bg-[var(--background)]";

function ChatSidebarBase(props: ChatSidebarProps): React.ReactElement | null {
  // Show the "new" button whenever an action is available (explicit or context).
  const ctx = useConversationsContextOptional();
  const hasNew = props.onNew !== undefined || ctx !== null;
  return (
    <ChatSidebarRoot
      {...props}
      className={cn(props.fill ? "w-full" : STANDALONE_SIDEBAR_CHROME, props.className)}
    >
      {hasNew && <ChatSidebarNewButton />}
      <ChatSidebarList />
    </ChatSidebarRoot>
  );
}
ChatSidebarBase.displayName = "ChatSidebar";

/** `ChatSidebar.Item` compound — the row plus its composable menu leaves. */
export type ChatSidebarItemComponent = typeof ChatSidebarItem & {
  Menu: typeof ChatSidebarItemMenu;
  Rename: typeof ChatSidebarItemRename;
  Delete: typeof ChatSidebarItemDelete;
};

const ChatSidebarItemCompound: ChatSidebarItemComponent = Object.assign(
  ChatSidebarItem,
  {
    Menu: ChatSidebarItemMenu,
    Rename: ChatSidebarItemRename,
    Delete: ChatSidebarItemDelete,
  },
);

/** Compound type — the preset plus its namespaced sub-components. */
export type ChatSidebarComponent = typeof ChatSidebarBase & {
  Root: typeof ChatSidebarRoot;
  NewButton: typeof ChatSidebarNewButton;
  List: typeof ChatSidebarList;
  Group: typeof ChatSidebarGroup;
  Item: ChatSidebarItemComponent;
  Empty: typeof ChatSidebarEmpty;
};

/** Render a chat sidebar — usable as `<ChatSidebar />` or `<ChatSidebar.Root>…`. */
export const ChatSidebar: ChatSidebarComponent = Object.assign(ChatSidebarBase, {
  Root: ChatSidebarRoot,
  NewButton: ChatSidebarNewButton,
  List: ChatSidebarList,
  Group: ChatSidebarGroup,
  Item: ChatSidebarItemCompound,
  Empty: ChatSidebarEmpty,
});
