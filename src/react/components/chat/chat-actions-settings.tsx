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
import { focusWithoutScroll } from "../ui/focus-management.ts";
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
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      tabIndex={-1}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-md px-3 h-[36px] text-base font-normal text-left text-[var(--foreground)] outline-none transition-colors",
        "hover:bg-[var(--tertiary)] focus:bg-[var(--tertiary)] dark:hover:bg-[var(--accent)] dark:focus:bg-[var(--accent)]",
      )}
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          "relative ml-auto inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-[var(--background)] transition-colors dark:border-transparent",
          checked ? "bg-[var(--primary)]" : "bg-[var(--input-bg)]",
        )}
      >
        <span
          className={cn(
            "block size-4 translate-x-0.5 rounded-full bg-[var(--background)] transition-transform duration-200",
            checked && "translate-x-[18px] bg-[var(--secondary)]",
          )}
        />
      </span>
    </button>
  );
}

/**
 * The Settings row and its portalled submenu.
 *
 * The close delay lets the pointer cross the portal gap. The submenu owns its
 * keyboard events and mouse-downs so its parent menu cannot dismiss first.
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
  const submenuId = React.useId();
  const triggerId = `${submenuId}-trigger`;

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
  const closeNow = React.useCallback(() => {
    cancelClose();
    setOpen(false);
  }, [cancelClose]);
  const scheduleClose = React.useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      const document = rowRef.current?.ownerDocument;
      const submenu = document?.getElementById(submenuId);
      if (!submenu?.contains(document?.activeElement ?? null)) setOpen(false);
    }, 160);
  }, [cancelClose, submenuId]);
  React.useEffect(() => cancelClose, [cancelClose]);

  const closeAndRestoreFocus = React.useCallback(() => {
    closeNow();
    queueMicrotask(() => {
      const trigger = triggerRef.current;
      if (trigger?.isConnected) focusWithoutScroll(trigger);
    });
  }, [closeNow]);

  const handleSubmenuKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    // Tab follows the parent menu's established close-and-advance behavior.
    if (event.key === "Tab") return;

    // The portal remains in the parent menu's React tree. Stop propagation so
    // the parent menu and both Floating Escape listeners cannot process the
    // same interaction.
    event.stopPropagation();
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(
      '[role="menuitemcheckbox"]',
    )];
    const activeIndex = items.indexOf(
      event.currentTarget.ownerDocument.activeElement as HTMLElement,
    );
    const focusAt = (index: number): void => {
      const item = items[(index + items.length) % items.length];
      if (item) focusWithoutScroll(item);
    };

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(activeIndex + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        focusAt(activeIndex < 0 ? items.length - 1 : activeIndex - 1);
        return;
      case "Home":
        event.preventDefault();
        focusAt(0);
        return;
      case "End":
        event.preventDefault();
        focusAt(items.length - 1);
        return;
      case "ArrowLeft":
      case "Escape":
        event.preventDefault();
        closeAndRestoreFocus();
        return;
    }
  };

  return (
    <div
      ref={rowRef}
      className="relative"
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={submenuId}
        onClick={openNow}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowRight" || event.key === "ArrowDown" ||
            event.key === "Enter" || event.key === " "
          ) {
            event.preventDefault();
            event.stopPropagation();
            openNow();
          } else if (open && (event.key === "ArrowLeft" || event.key === "Escape")) {
            event.preventDefault();
            event.stopPropagation();
            closeNow();
          }
        }}
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
        onDismiss={closeNow}
        returnFocusRef={triggerRef}
        initialFocus='[role="menuitemcheckbox"]'
        id={submenuId}
        role="menu"
        aria-labelledby={triggerId}
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        onMouseDownCapture={(event) => event.stopPropagation()}
        onKeyDown={handleSubmenuKeyDown}
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
