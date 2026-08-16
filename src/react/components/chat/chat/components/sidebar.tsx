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
import { ChatSidebarRenameEditor } from "./sidebar-rename-editor.tsx";
import type {
  ChatSidebarContextValue,
  ChatSidebarControlProps,
  ChatSidebarEmptyProps,
  ChatSidebarGroupProps,
  ChatSidebarItemActionProps,
  ChatSidebarItemContextValue,
  ChatSidebarItemMenuProps,
  ChatSidebarItemProps,
  ChatSidebarItemTitleProps,
  ChatSidebarListProps,
  ChatSidebarNewButtonProps,
  ChatSidebarProps,
  ChatSidebarRootProps,
} from "./sidebar.types.ts";

export type {
  ChatSidebarEmptyProps,
  ChatSidebarGroupProps,
  ChatSidebarItemActionProps,
  ChatSidebarItemContextValue,
  ChatSidebarItemMenuProps,
  ChatSidebarItemProps,
  ChatSidebarItemRenderOptions,
  ChatSidebarItemTitleProps,
  ChatSidebarListProps,
  ChatSidebarNewButtonProps,
  ChatSidebarProps,
  ChatSidebarRootProps,
} from "./sidebar.types.ts";

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

// ---------------------------------------------------------------------------
// Context — shared by every ChatSidebar sub-component
// ---------------------------------------------------------------------------

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

/** Context provider + outer rail container for the compound sidebar. */
export function ChatSidebarRoot(props: ChatSidebarRootProps): React.ReactElement | null {
  const { loading, isOpen = true, fill = false, className, children, ref } = props;
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
        ref={ref}
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

/** The primary "new conversation" action. Wires `onNew` from context. */
export function ChatSidebarNewButton({
  children,
  icon,
  className,
  ref,
}: ChatSidebarNewButtonProps): React.ReactElement {
  const { onNew } = useChatSidebarContext();
  return (
    <div className="px-3 pt-4 pb-1">
      <Button
        ref={ref}
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

const [ChatSidebarItemContext, useChatSidebarItemStrict] = createStrictContext<
  ChatSidebarItemContextValue
>(
  "ChatSidebar.Item.*",
  "<ChatSidebar.Item>",
);

/**
 * Read the enclosing `<ChatSidebar.Item>`'s row state (the conversation summary,
 * active flag, rename availability + `startRename`, `remove`, and the `…` menu
 * open state) from a custom item sub-part. Throws outside a `<ChatSidebar.Item>`.
 *
 * @example
 * ```tsx
 * function DeleteButton() {
 *   const { remove, conversation } = useChatSidebarItem();
 *   return <button onClick={remove} aria-label={`Delete ${conversation.title}`}>×</button>;
 * }
 * ```
 */
export const useChatSidebarItem = useChatSidebarItemStrict;

/**
 * The row's label: the conversation title (or custom children). Use it inside
 * an `<ChatSidebar.Item>` to compose the row body; its presence tells the item
 * to skip its default title.
 */
export function ChatSidebarItemTitle({
  children,
  className,
  ref,
  ...props
}: ChatSidebarItemTitleProps): React.ReactElement {
  const { conversation } = useChatSidebarItem();
  return (
    <span
      {...props}
      ref={ref}
      className={cn("block truncate text-[13px] leading-snug", className)}
    >
      {children ?? conversation.title}
    </span>
  );
}
ChatSidebarItemTitle.displayName = "ChatSidebar.Item.Title";

/** Flatten transparent fragments so slot detection and extraction see the same leaves. */
function flattenItemParts(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child) || child.type !== React.Fragment) return child;
    const props = child.props as { children?: React.ReactNode };
    return flattenItemParts(props.children);
  });
}

/**
 * A single conversation row — select on click, rename/delete via a "…" menu.
 * The menu is a composable compound: pass a `<ChatSidebar.Item.Menu>` child to
 * add or reorder entries without re-implementing the row. Children containing a
 * `<ChatSidebar.Item.Title>` compose the row's label body instead. A sibling
 * `<ChatSidebar.Item.Menu>`, including one grouped in a fragment, fills the
 * action slot.
 */
export function ChatSidebarItem({
  conversation,
  className,
  children,
  ref,
}: ChatSidebarItemProps): React.ReactElement {
  const { activeId, onSelect, onDelete, onRename } = useChatSidebarContext();

  const isActive = conversation.id === activeId;
  const [editing, setEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(conversation.title);
  const [menuOpen, setMenuOpen] = React.useState(false);

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
    return (
      <ChatSidebarRenameEditor
        ref={ref}
        className={className}
        value={editValue}
        onChange={setEditValue}
        onCommit={commitRename}
        onCancel={() => setEditing(false)}
      />
    );
  }

  // A `<ChatSidebar.Item.Title>` child moves the children into the row body;
  // otherwise they compose the trailing action slot (the shipped behavior).
  // Fragments are transparent here so title detection and menu extraction use
  // the same child level and never duplicate or nest the menu trigger.
  const parts = flattenItemParts(children);
  const composesTitle = parts.some(
    (part) => React.isValidElement(part) && part.type === ChatSidebarItemTitle,
  );
  const menuParts = parts.filter(
    (part) => React.isValidElement(part) && part.type === ChatSidebarItemMenu,
  );
  const bodyParts = parts.filter((part) => !menuParts.includes(part));

  return (
    <ChatSidebarItemContext.Provider value={itemContext}>
      <ListItem
        ref={ref}
        title={composesTitle ? undefined : conversation.title}
        active={isActive || menuOpen}
        className={className}
        onActivate={() => onSelect(conversation.id)}
        primaryActionProps={{ "aria-current": isActive ? "page" : undefined }}
        action={composesTitle
          ? (menuParts.length > 0 ? menuParts : <ChatSidebarItemMenu />)
          : children ?? <ChatSidebarItemMenu />}
      >
        {composesTitle ? bodyParts : undefined}
      </ListItem>
    </ChatSidebarItemContext.Provider>
  );
}
ChatSidebarItem.displayName = "ChatSidebar.Item";

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

/** `Rename` menu entry — enters inline rename. Renders nothing if unavailable. */
export function ChatSidebarItemRename({
  icon,
  children,
  ref,
}: ChatSidebarItemActionProps): React.ReactElement | null {
  const { canRename, startRename } = useChatSidebarItem();
  if (!canRename) return null;
  return (
    <DropdownMenuItem ref={ref} onSelect={startRename}>
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
  ref,
}: ChatSidebarItemActionProps): React.ReactElement {
  const { remove } = useChatSidebarItem();
  return (
    <DropdownMenuItem
      ref={ref}
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

/** A labeled cluster of conversation rows. */
export function ChatSidebarGroup({
  label,
  children,
  className,
  ref,
}: ChatSidebarGroupProps): React.ReactElement {
  return (
    <List ref={ref} className={className}>
      {label !== undefined && <ListLabel>{label}</ListLabel>}
      {children}
    </List>
  );
}
ChatSidebarGroup.displayName = "ChatSidebar.Group";

// ---------------------------------------------------------------------------
// ChatSidebar.Empty
// ---------------------------------------------------------------------------

/** Placeholder shown when there are no conversations to list. */
export function ChatSidebarEmpty({
  children,
  className,
  ref,
  ...props
}: ChatSidebarEmptyProps): React.ReactElement {
  return (
    <div
      ref={ref}
      className={cn(
        "flex h-full flex-col items-center justify-center px-4 text-center text-[var(--faint)]",
        className,
      )}
      {...props}
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

/** Scrollable region. Auto-groups by recency unless given `children`. */
export function ChatSidebarList({
  children,
  className,
  ref,
  ...props
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
      ref={ref}
      className={cn("flex-1 overflow-y-auto px-2 pt-2 pb-3 space-y-3", className)}
      {...props}
    >
      {body}
    </div>
  );
}
ChatSidebarList.displayName = "ChatSidebar.List";

// ---------------------------------------------------------------------------
// ChatSidebar — preset
// ---------------------------------------------------------------------------

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

/** `ChatSidebar.Item` compound: the row plus its composable label and menu leaves. */
export type ChatSidebarItemComponent = typeof ChatSidebarItem & {
  Title: typeof ChatSidebarItemTitle;
  Menu: typeof ChatSidebarItemMenu;
  Rename: typeof ChatSidebarItemRename;
  Delete: typeof ChatSidebarItemDelete;
};

const ChatSidebarItemCompound: ChatSidebarItemComponent = Object.assign(
  ChatSidebarItem,
  {
    Title: ChatSidebarItemTitle,
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
