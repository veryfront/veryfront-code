/** Public type surface for `<ChatActions>` and its `ChatActions.*` sub-parts. @module react/components/chat/chat-actions.types */
import type * as React from "react";

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
  /** Disable the row (non-interactive, dimmed). */
  disabled?: boolean;
  /** Called when the row is chosen (also closes the menu). */
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

/** Props for `ChatActions.Trigger` — the menu's trigger button. */
export interface ChatActionsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Custom trigger element, rendered via `asChild`. Defaults to the `+` Button.
   * (Back-compat: `ChatActions`'s `trigger` prop maps here.)
   */
  children?: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}

/** Props for `ChatActions.Content` — the dropdown surface. */
export interface ChatActionsContentProps {
  /** Menu rows — `ChatActions.Item`s or your own. */
  children?: React.ReactNode;
  /** Horizontal alignment relative to the trigger. @default "start" */
  align?: "start" | "end";
  className?: string;
  ref?: React.Ref<HTMLDivElement>;
}

/** Props for `ChatActions.Item` — a single selectable menu row. */
export interface ChatActionsItemProps {
  /** Row label / contents (rendered after the `icon`). */
  children?: React.ReactNode;
  /** Leading icon. */
  icon?: React.ReactNode;
  /** Called when the row is chosen (also closes the menu). */
  onSelect?: () => void;
  /** Native title/tooltip. */
  title?: string;
  /** Disable the row (non-interactive, dimmed). */
  disabled?: boolean;
  className?: string;
  ref?: React.Ref<HTMLButtonElement>;
}
