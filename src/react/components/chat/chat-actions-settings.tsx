/**
 * Private settings submenu used by the ChatActions preset.
 *
 * Keeping the nested floating-menu behavior separate from the public compound
 * keeps ChatActions focused on composition while this module owns pointer
 * transit, focus restoration, and the settings-specific presentation.
 *
 * @module react/components/chat/chat-actions-settings
 */
import * as React from "react";
import { Floating } from "../ui/floating.tsx";
import { Switch } from "../ui/switch.tsx";
import { cn } from "./theme.ts";

/** The two toggle settings surfaced in the Settings submenu. */
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
 * The Settings row and its portalled submenu.
 *
 * The close delay lets the pointer cross the portal gap. Capturing pointer
 * down inside the submenu prevents the parent menu's outside-dismiss handler
 * from closing the entire action menu while a switch is being toggled.
 */
export function SettingsSubmenu({
  settings,
}: {
  settings: ChatActionsSettings;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
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
        ref={triggerRef}
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
        returnFocusRef={triggerRef}
        role="menu"
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        onPointerDownCapture={(event) => event.stopPropagation()}
        className="z-50 min-w-[240px] overflow-hidden rounded-lg bg-[var(--popover)] p-2.5 shadow-sm outline-none"
      >
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
