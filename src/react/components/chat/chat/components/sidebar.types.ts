/** Public type surface for `ChatSidebar` and its compound parts. @module react/components/chat/chat/components/sidebar.types */
import type * as React from "react";
import type { ConversationSummary } from "../persistence/conversation-store.ts";

/** Per-row handlers/state handed to a custom {@link ChatSidebarRootProps.renderItem}. */
export interface ChatSidebarItemRenderOptions {
  isActive: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onRename?: (title: string) => void;
}

/** Data + action props shared by the preset and {@link ChatSidebarRoot}. */
export interface ChatSidebarControlProps {
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

export interface ChatSidebarContextValue {
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

/** Props accepted by {@link ChatSidebarRoot}. */
export interface ChatSidebarRootProps extends ChatSidebarControlProps {
  /** Show the loading skeleton while conversations are being fetched. */
  loading?: boolean;
  /** When `false`, the rail renders nothing. Default `true`. */
  isOpen?: boolean;
  className?: string;
  children: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Props accepted by {@link ChatSidebarNewButton}. */
export interface ChatSidebarNewButtonProps {
  /** Button label. Defaults to "New chat". */
  children?: React.ReactNode;
  /** Optional leading icon. */
  icon?: React.ReactNode;
  className?: string;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

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

export interface ChatSidebarItemProps {
  conversation: ConversationSummary;
  className?: string;
  /**
   * Compose the row's action slot, typically a `<ChatSidebar.Item.Menu>`.
   * When the children include a `<ChatSidebar.Item.Title>`, they compose the
   * row's label body instead; a sibling `<ChatSidebar.Item.Menu>` still fills
   * the action slot when it is direct or grouped in a fragment (the default
   * `…` menu is used when none is given). Omit for the default title + `…`
   * rename/delete menu.
   */
  children?: React.ReactNode;
  /** React 19: ref is attached to the current row root in display and rename modes. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Props for {@link ChatSidebarItemTitle}. */
export interface ChatSidebarItemTitleProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Override the label. Defaults to the conversation title. */
  children?: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLSpanElement>;
}

/** Props for {@link ChatSidebarItemMenu}. */
export interface ChatSidebarItemMenuProps {
  /** Override the trigger glyph. */
  icon?: React.ReactNode;
  /** Compose the entries; omit for the default `Rename` + `Delete`. */
  children?: React.ReactNode;
}

/** Props for {@link ChatSidebarItemRename} / {@link ChatSidebarItemDelete}. */
export interface ChatSidebarItemActionProps {
  /** Override the entry glyph. */
  icon?: React.ReactNode;
  /** Override the entry label. */
  children?: React.ReactNode;
  /** React 19: ref is a regular prop forwarded to the `DropdownMenuItem`. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** Props accepted by {@link ChatSidebarGroup}. */
export interface ChatSidebarGroupProps {
  /** Section heading (e.g. a recency bucket). Omit for an unlabeled group. */
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** React 19: ref is a regular prop forwarded to the group's `List`. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Props accepted by {@link ChatSidebarEmpty}. */
export interface ChatSidebarEmptyProps extends React.HTMLAttributes<HTMLDivElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Props accepted by {@link ChatSidebarList}. */
export interface ChatSidebarListProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Provide your own groups/rows. When omitted, the list auto-groups the
   * context conversations by recency and renders {@link ChatSidebarEmpty} when
   * empty.
   */
  children?: React.ReactNode;
  className?: string;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Props accepted by the {@link ChatSidebar} preset. */
export interface ChatSidebarProps extends Omit<ChatSidebarRootProps, "children"> {}
