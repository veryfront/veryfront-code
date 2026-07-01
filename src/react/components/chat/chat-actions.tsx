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

function FigmaGlyph({ className }: { className?: string }): React.ReactElement {
  return (
    <GlyphSvg className={className}>
      <path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H12v7H8.5A3.5 3.5 0 0 1 5 5.5z" />
      <path d="M12 2h3.5a3.5 3.5 0 1 1 0 7H12V2z" />
      <path d="M12 12.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 1 1-7 0z" />
      <path d="M5 19.5A3.5 3.5 0 0 1 8.5 16H12v3.5a3.5 3.5 0 1 1-7 0z" />
      <path d="M5 12.5A3.5 3.5 0 0 1 8.5 9H12v7H8.5A3.5 3.5 0 0 1 5 12.5z" />
    </GlyphSvg>
  );
}

function SettingsGlyph({ className }: { className?: string }): React.ReactElement {
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

/** The "Settings" row + its nested submenu (a portalled `Floating` popover). */
function SettingsSubmenu({
  settings,
}: {
  settings: ChatActionsSettings;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const rowRef = React.useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={rowRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
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
        className="z-50 min-w-[240px] overflow-hidden rounded-lg bg-[var(--popover)] p-2.5 shadow-sm outline-none"
      >
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

/** Props accepted by `<ChatActions>`. */
export interface ChatActionsProps {
  /** Selecting "Attach Files or Photos". Row is hidden when omitted. */
  onAttachFiles?: () => void;
  /** Selecting "Attach Figma File". Row is hidden when omitted. */
  onAttachFigma?: () => void;
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
  onAttachFiles,
  onAttachFigma,
  attachFilesLabel = "Attach Files or Photos",
  settings,
  trigger,
  open,
  defaultOpen,
  onOpenChange,
  className,
}: ChatActionsProps): React.ReactElement {
  const hasAttach = Boolean(onAttachFiles || onAttachFigma);
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
        {onAttachFigma && (
          <DropdownMenuItem
            onSelect={onAttachFigma}
            title="Connect Figma file to chat"
          >
            <FigmaGlyph />
            Attach Figma File
          </DropdownMenuItem>
        )}
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
