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
 * @module react/components/chat/chat-actions
 */
import * as React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu.tsx";
import { PaperclipIcon } from "../ui/icons/index.ts";
import { createStrictContext } from "../create-strict-context.ts";
import { SettingsSubmenu } from "./chat-actions-settings.tsx";
import { ChatActionsTrigger } from "./chat-actions-trigger.tsx";
import type {
  ChatActionsContentProps,
  ChatActionsContextValue,
  ChatActionsItemProps,
  ChatActionsProps,
} from "./chat-actions.types.ts";
export type * from "./chat-actions.types.ts";

/* -------------------------------------------------------------------------------------------------
 * ChatActions
 * -------------------------------------------------------------------------------------------------*/

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

const [ChatActionsContext, useChatActionsContext] = createStrictContext<ChatActionsContextValue>(
  "useChatActions",
  "a ChatActions",
);

/**
 * Read the current `ChatActions` preset configuration from a composed
 * `ChatActions.*` part. Throws outside `ChatActions` / `ChatActions.Root`.
 */
export const useChatActions = useChatActionsContext;

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
  if (trigger != null && !React.isValidElement(trigger)) {
    throw new TypeError("ChatActions trigger must be a valid React element");
  }
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
            {trigger == null
              ? <ChatActionsTrigger />
              : <ChatActionsTrigger>{trigger}</ChatActionsTrigger>}
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

/**
 * `ChatActions.Content` — the portalled dropdown surface. Pass `ChatActions.Item`
 * children (or your own rows). `className` merges onto the menu surface.
 */
function ChatActionsContent(
  { children, align = "start", className, ref }: ChatActionsContentProps,
): React.ReactElement {
  return (
    <DropdownMenuContent align={align} className={className} ref={ref}>
      {children}
    </DropdownMenuContent>
  );
}
ChatActionsContent.displayName = "ChatActions.Content";

/**
 * `ChatActions.Item` — a single action row. Wraps `DropdownMenuItem` (so it
 * closes the menu on select). `className` merges onto the row.
 */
function ChatActionsItem(
  { children, icon, onSelect, title, disabled, className, ref }: ChatActionsItemProps,
): React.ReactElement {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      title={title}
      disabled={disabled}
      className={className}
      ref={ref}
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
