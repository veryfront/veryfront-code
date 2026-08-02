/**
 * ChatActions — the composer's `+` menu, forked dependency-light 1:1 from
 * Studio's `PromptMenuContent`. A DropdownMenu with the built-in attach rows
 * ("Attach Files or Photos", "Attach Figma File") and a "Settings" submenu of
 * toggle rows (auto-send queue, autofix errors).
 *
 * Studio composes `PromptMenuContent` *inside* a caller-owned `DropdownMenu`;
 * here `ChatActions` is the whole self-contained menu (trigger + content) so it
 * drops into a composer with a small, focused prop surface.
 *
 * Notes vs Studio:
 * - No `@radix-ui/*`, no `class-variance-authority`, no `@/` imports, no
 *   licensed fonts / motion — the logic is forked onto our `ui` primitives.
 * - Our `dropdown-menu.tsx` has NO submenu primitive (radix `Sub*`), so the
 *   Settings submenu is a nested `DropdownMenu` anchored to its trigger row and
 *   portalled via `Floating` (same overlay pattern), aligned to the side.
 * - Settings-specific glyphs stay private to the submenu implementation rather
 *   than expanding the shared icons barrel.
 *
 * @module react/components/chat/chat-actions
 */
import * as React from "react";
import { cn } from "./theme.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import { Button } from "../ui/button.tsx";
import { PaperclipIcon, PlusIcon } from "../ui/icons/index.ts";
import { createStrictContext } from "../create-strict-context.ts";
import { type ChatActionsSettings, SettingsSubmenu } from "./chat-actions-settings.tsx";
export type { ChatActionsSettings } from "./chat-actions-settings.tsx";

/* -------------------------------------------------------------------------------------------------
 * ChatActions
 * -------------------------------------------------------------------------------------------------*/

/** A single data-driven action row in the `<ChatActions>` menu. */
export interface ChatActionItem {
  /** Stable key. */
  id?: string;
  /** Leading icon. */
  icon?: React.ReactNode;
  /** Row label. */
  label: string;
  /** Native title/tooltip. */
  title?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/** Props accepted by `<ChatActions>` / `<ChatActions.Root>`. */
export interface ChatActionsProps {
  /**
   * Menu rows — fully data-driven, so callers own every action (no hardcoded
   * app-specific rows like "Attach Figma"). Rows render in order. Consumed by
   * the default preset (ignored when you pass your own `children`).
   */
  actions?: ChatActionItem[];
  /** Selecting "Attach Files or Photos" — a convenience built-in row. Hidden when omitted. */
  onAttachFiles?: () => void;
  /** Label for the built-in attach row. @default "Attach Files or Photos" */
  attachFilesLabel?: string;
  /** Settings submenu toggles. Submenu is hidden when omitted. */
  settings?: ChatActionsSettings;
  /**
   * Custom trigger. Rendered via `asChild`, so it must forward props to a
   * single focusable element. Defaults to a `+` Button.
   */
  trigger?: React.ReactNode;
  /** Controlled open state of the top-level menu. */
  open?: boolean;
  /** Uncontrolled initial open state. */
  defaultOpen?: boolean;
  /** Fired when the top-level menu opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Extra classes for the menu surface. */
  className?: string;
  /**
   * Compose your own menu from `ChatActions.Trigger` / `Content` / `Item`; when
   * omitted, the data-driven preset (attach row + `actions` + `settings`) is
   * rendered. Presence over booleans — pass children, own the anatomy.
   */
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// ChatActions — compound, render-or-compose (mirrors `ToolCall` / `Message`).
//
// `<ChatActions onAttachFiles={…} actions={…} settings={…} />` (no children)
// renders the default data-driven preset. Pass children to recompose from
// `ChatActions.Trigger` / `ChatActions.Content` / `ChatActions.Item` — each is
// a thin wrapper over the underlying `DropdownMenu*` primitive, so they wire
// into the same `DropdownMenu` context `ChatActions.Root` opens, and every one
// takes `className` merged LAST via `cn`. The `Settings` submenu stays a preset
// internal (see `ChatActionsSettings` below) — its portalled `Floating` popover
// is not part of the shared DropdownMenu anatomy, so it isn't a decomposable
// sub-part.
// ---------------------------------------------------------------------------

/** Shared state exposed to `ChatActions.*` sub-parts via `useChatActions()`. */
export interface ChatActionsContextValue {
  /** The data-driven rows passed to the preset (empty when composed). */
  actions: ChatActionItem[];
  /** The `onAttachFiles` callback, if any. */
  onAttachFiles?: () => void;
  /** Resolved label for the built-in attach row. */
  attachFilesLabel: string;
  /** The settings submenu config, if any. */
  settings?: ChatActionsSettings;
}

const [ChatActionsContext, useChatActions] = createStrictContext<ChatActionsContextValue>(
  "useChatActions",
  "a ChatActions",
);
export { useChatActions };

/**
 * `ChatActions.Root` — the `DropdownMenu` wrapper + context provider. No
 * children renders the default preset (`Trigger` + `Content` with the attach
 * row, `actions`, and `settings` submenu); pass children to recompose. Portals
 * its surface via `Floating` (DropdownMenu) so it never clips inside the
 * composer or a Storybook iframe.
 */
function ChatActionsRoot({
  actions,
  onAttachFiles,
  attachFilesLabel = "Attach Files or Photos",
  settings,
  trigger,
  open,
  defaultOpen,
  onOpenChange,
  className,
  children,
}: ChatActionsProps): React.ReactElement {
  const context: ChatActionsContextValue = {
    actions: actions ?? [],
    onAttachFiles,
    attachFilesLabel,
    settings,
  };
  return (
    <ChatActionsContext.Provider value={context}>
      <DropdownMenu
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
      >
        {children ?? (
          <>
            <ChatActionsTrigger>{trigger}</ChatActionsTrigger>
            <ChatActionsContent className={className}>
              <ChatActionsPreset />
            </ChatActionsContent>
          </>
        )}
      </DropdownMenu>
    </ChatActionsContext.Provider>
  );
}
ChatActionsRoot.displayName = "ChatActions.Root";

/** Props for `ChatActions.Trigger` — the menu's trigger button. */
export interface ChatActionsTriggerProps {
  /**
   * Custom trigger element, rendered via `asChild`. Defaults to the `+` Button.
   * (Back-compat: `ChatActions`'s `trigger` prop maps here.)
   */
  children?: React.ReactNode;
  className?: string;
}

/**
 * `ChatActions.Trigger` — the `+` button that opens the menu. Rendered via the
 * DropdownMenu's `asChild`, so a custom child must forward props to one
 * focusable element. `className` merges onto the default `+` Button.
 */
function ChatActionsTrigger(
  { children, className }: ChatActionsTriggerProps,
): React.ReactElement {
  return (
    <DropdownMenuTrigger asChild>
      {children ?? (
        <Button
          type="button"
          variant="icon-tertiary"
          size="icon-lg"
          aria-label="Add attachments and settings"
          className={cn("shrink-0", className)}
        >
          <PlusIcon />
        </Button>
      )}
    </DropdownMenuTrigger>
  );
}
ChatActionsTrigger.displayName = "ChatActions.Trigger";

/** Props for `ChatActions.Content` — the dropdown surface. */
export interface ChatActionsContentProps {
  children?: React.ReactNode;
  /** Horizontal alignment relative to the trigger. @default "start" */
  align?: "start" | "end";
  className?: string;
}

/**
 * `ChatActions.Content` — the portalled dropdown surface. Pass `ChatActions.Item`
 * children (or your own rows). `className` merges onto the menu surface.
 */
function ChatActionsContent(
  { children, align = "start", className }: ChatActionsContentProps,
): React.ReactElement {
  return (
    <DropdownMenuContent align={align} className={className}>
      {children}
    </DropdownMenuContent>
  );
}
ChatActionsContent.displayName = "ChatActions.Content";

/** Props for `ChatActions.Item` — a single selectable menu row. */
export interface ChatActionsItemProps {
  children?: React.ReactNode;
  /** Leading icon. */
  icon?: React.ReactNode;
  /** Called when the row is chosen (also closes the menu). */
  onSelect?: () => void;
  /** Native title/tooltip. */
  title?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * `ChatActions.Item` — a single action row. Wraps `DropdownMenuItem` (so it
 * closes the menu on select). `className` merges onto the row.
 */
function ChatActionsItem(
  { children, icon, onSelect, title, disabled, className }: ChatActionsItemProps,
): React.ReactElement {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      title={title}
      disabled={disabled}
      className={className}
    >
      {icon}
      {children}
    </DropdownMenuItem>
  );
}
ChatActionsItem.displayName = "ChatActions.Item";

/**
 * `ChatActions.Preset` — the default menu body (attach row + `actions` +
 * `settings` submenu), driven from `useChatActions()`. Rendered by the preset
 * path; also exported so a composed `ChatActions.Content` can drop the whole
 * data-driven body back in alongside custom rows.
 */
function ChatActionsPreset(): React.ReactElement {
  const { actions, onAttachFiles, attachFilesLabel, settings } = useChatActions();
  const hasAttach = Boolean(onAttachFiles || actions.length > 0);
  return (
    <>
      {onAttachFiles && (
        <ChatActionsItem
          onSelect={onAttachFiles}
          title="Attach files or photos to chat"
          icon={<PaperclipIcon />}
        >
          {attachFilesLabel}
        </ChatActionsItem>
      )}
      {actions.map((action, i) => (
        <ChatActionsItem
          key={action.id ?? `${action.label}-${i}`}
          onSelect={action.onSelect}
          title={action.title}
          disabled={action.disabled}
          icon={action.icon}
        >
          {action.label}
        </ChatActionsItem>
      ))}
      {settings && (
        <>
          {hasAttach && <DropdownMenuSeparator className="my-2!" />}
          <SettingsSubmenu settings={settings} />
        </>
      )}
    </>
  );
}
ChatActionsPreset.displayName = "ChatActions.Preset";

/**
 * ChatActions — render `<ChatActions onAttachFiles={…} actions={…} />` for the
 * default preset menu, or compose `ChatActions.Trigger` / `Content` / `Item`
 * (each reads `useChatActions()`) for a custom menu. Mirrors the `ToolCall`
 * compound: render it, or compose it.
 */
export const ChatActions = Object.assign(ChatActionsRoot, {
  Root: ChatActionsRoot,
  Trigger: ChatActionsTrigger,
  Content: ChatActionsContent,
  Item: ChatActionsItem,
  Preset: ChatActionsPreset,
});
