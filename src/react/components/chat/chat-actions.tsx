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
 *   licensed fonts / motion — the logic is forked onto our `chat/ui` primitives.
 * - Our `dropdown-menu.tsx` has NO submenu primitive (radix `Sub*`), so the
 *   Settings submenu is a nested `DropdownMenu` anchored to its trigger row and
 *   portalled via `Floating` (same overlay pattern), aligned to the side.
 * - Icons render a half-step smaller than Studio (`size-4` → `size-3.5`), and
 *   the Figma / Settings / ChevronRight glyphs are inlined here (not in the
 *   shared icons barrel).
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
} from "./ui/dropdown-menu.tsx";
import { Switch } from "./ui/switch.tsx";
import { Floating } from "./ui/floating.tsx";
import { Button } from "./ui/button.tsx";
import { PaperclipIcon, PlusIcon } from "./icons/index.ts";

/* -------------------------------------------------------------------------------------------------
 * Inlined icons — Figma / Settings / ChevronRight are not in the shared icons
 * barrel; kept local so this component adds no shared-file edits. Match the
 * `size-3.5` half-step and `currentColor` stroke of the barrel icons.
 * -------------------------------------------------------------------------------------------------*/

function GlyphSvg({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <svg
      className={cn("size-3.5", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function SettingsGlyph(
  { className }: { className?: string },
): React.ReactElement {
  return (
    <GlyphSvg className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </GlyphSvg>
  );
}

function ChevronRightGlyph(
  { className }: { className?: string },
): React.ReactElement {
  return (
    <GlyphSvg className={className}>
      <polyline points="9 18 15 12 9 6" />
    </GlyphSvg>
  );
}

/* -------------------------------------------------------------------------------------------------
 * Settings submenu
 * -------------------------------------------------------------------------------------------------*/

/** The two toggle settings surfaced in the Settings submenu (forked from Studio). */
export interface ChatActionsSettings {
  /** "Auto-send queue" — send queued messages automatically. */
  autoSubmit: boolean;
  /** "Autofix errors" — attempt to fix errors automatically. */
  autoFixErrors: boolean;
  /** Called with the next value when "Auto-send queue" is toggled. */
  onAutoSubmitChange: (value: boolean) => void;
  /** Called with the next value when "Autofix errors" is toggled. */
  onAutoFixErrorsChange: (value: boolean) => void;
}

/** A toggle row inside the Settings submenu — label left, switch right. */
function SettingsToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}): React.ReactElement {
  return (
    <label className="relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-md px-3 h-[36px] text-base font-normal text-left text-[var(--foreground)] transition-colors hover:bg-[var(--tertiary)] dark:hover:bg-[var(--accent)]">
      <span>{label}</span>
      <span className="ml-auto">
        <Switch
          size="sm"
          checked={checked}
          onCheckedChange={onCheckedChange}
        />
      </span>
    </label>
  );
}

/**
 * The "Settings" row + its nested submenu (a portalled `Floating` popover).
 *
 * The submenu is portalled to `document.body`, so it is NOT a DOM descendant of
 * the row — moving the pointer from the row into the submenu would fire the
 * row's `onMouseLeave` and close it before the mouse arrives. Two fixes:
 *   1. **Close delay** — leaving the row schedules a close after a short grace
 *      period; entering the submenu (or re-entering the row) cancels it. This
 *      is the standard "safe transit" technique (a lighter cousin of Radix's
 *      pointer-safe-triangle).
 *   2. **stopPropagation on the submenu's pointer-down** — the parent menu
 *      dismisses on outside pointer-down; without this, toggling a switch in
 *      the (portalled, "outside") submenu would collapse the whole menu.
 */
function SettingsSubmenu({
  settings,
}: {
  settings: ChatActionsSettings;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const openNow = React.useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);
  const scheduleClose = React.useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  }, [cancelClose]);
  React.useEffect(() => cancelClose, [cancelClose]);

  return (
    <div
      ref={rowRef}
      className="relative"
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? scheduleClose() : openNow())}
        className={cn(
          "relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-md px-3 h-[36px] text-base font-normal text-left text-[var(--foreground)] outline-none transition-colors",
          "hover:bg-[var(--tertiary)] focus:bg-[var(--tertiary)] dark:hover:bg-[var(--accent)] dark:focus:bg-[var(--accent)]",
          "[&_svg]:size-3.5 [&_svg]:shrink-0",
          open && "bg-[var(--tertiary)] dark:bg-[var(--accent)]",
        )}
      >
        <SettingsGlyph />
        Settings
        <ChevronRightGlyph className="ml-auto" />
      </button>
      <Floating
        anchorRef={rowRef}
        open={open}
        align="end"
        onDismiss={() => setOpen(false)}
        role="menu"
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        onPointerDownCapture={(e) => e.stopPropagation()}
        className="z-50 min-w-[240px] overflow-hidden rounded-lg bg-[var(--popover)] p-2.5 shadow-sm outline-none"
      >
        {
          /* Invisible hover bridge covering the gap between the row and the
            submenu, so a diagonal transit never lands on dead space. */
        }
        <div
          aria-hidden="true"
          className="absolute -top-2 right-0 left-0 h-2"
        />
        <SettingsToggleRow
          label="Auto-send queue"
          checked={settings.autoSubmit}
          onCheckedChange={settings.onAutoSubmitChange}
        />
        <SettingsToggleRow
          label="Autofix errors"
          checked={settings.autoFixErrors}
          onCheckedChange={settings.onAutoFixErrorsChange}
        />
      </Floating>
    </div>
  );
}

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

/** Props accepted by `<ChatActions>`. */
export interface ChatActionsProps {
  /**
   * Menu rows — fully data-driven, so callers own every action (no hardcoded
   * app-specific rows like "Attach Figma"). Rows render in order.
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
}

/**
 * The composer's `+` menu. Portals its surface via `Floating` (DropdownMenu) so
 * it never clips inside the composer or a Storybook iframe.
 */
export function ChatActions({
  actions,
  onAttachFiles,
  attachFilesLabel = "Attach Files or Photos",
  settings,
  trigger,
  open,
  defaultOpen,
  onOpenChange,
  className,
}: ChatActionsProps): React.ReactElement {
  const hasAttach = Boolean(onAttachFiles || (actions && actions.length > 0));
  return (
    <DropdownMenu
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="icon-tertiary"
            size="icon-lg"
            aria-label="Add attachments and settings"
            className="shrink-0"
          >
            <PlusIcon />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={className}>
        {onAttachFiles && (
          <DropdownMenuItem
            onSelect={onAttachFiles}
            title="Attach files or photos to chat"
          >
            <PaperclipIcon />
            {attachFilesLabel}
          </DropdownMenuItem>
        )}
        {actions?.map((action, i) => (
          <DropdownMenuItem
            key={action.id ?? `${action.label}-${i}`}
            onSelect={action.onSelect}
            title={action.title}
            disabled={action.disabled}
          >
            {action.icon}
            {action.label}
          </DropdownMenuItem>
        ))}
        {settings && (
          <>
            {hasAttach && <DropdownMenuSeparator className="my-2!" />}
            <SettingsSubmenu settings={settings} />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
