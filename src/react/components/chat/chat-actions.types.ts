/** Public type surface for `<ChatActions>` and its `ChatActions.*` sub-parts. @module react/components/chat/chat-actions.types */
import type * as React from "react";
import type { PolymorphicButtonAttributes } from "../ui/slot.tsx";
import type { ChatActionsSettings } from "./chat-actions-settings.tsx";
export type { ChatActionsSettings } from "./chat-actions-settings.tsx";

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
   * Menu rows are fully data-driven, so callers own every action (no hardcoded
   * app-specific rows like "Attach Figma"). Rows render in order. Consumed by
   * the default preset (ignored when you pass your own `children`).
   */
  actions?: ChatActionItem[];
  /** Select "Attach Files or Photos" with a convenience built-in row. Hidden when omitted. */
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
   * rendered. Pass children to own the anatomy instead of using booleans.
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

/** Default-button props for `ChatActions.Trigger`. */
interface ChatActionsNativeTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Omit children to render the default `+` Button. */
  children?: null | undefined;
  ref?: React.Ref<HTMLButtonElement>;
}

/** Custom-element props for `ChatActions.Trigger`. */
type ChatActionsSlottedTriggerProps<T extends HTMLElement = HTMLElement> =
  & Omit<PolymorphicButtonAttributes<T>, "children" | "ref" | "type">
  & {
    /** Custom focusable trigger rendered through `asChild`. */
    children: React.ReactElement;
    disabled?: boolean;
    type?: T extends HTMLButtonElement ? React.ButtonHTMLAttributes<HTMLButtonElement>["type"]
      : never;
    ref?: React.Ref<T>;
  };

/** Props for `ChatActions.Trigger`, discriminated by custom-child presence. */
export type ChatActionsTriggerProps<T extends HTMLElement = HTMLElement> =
  | ChatActionsNativeTriggerProps
  | ChatActionsSlottedTriggerProps<T>;

/** Props for `ChatActions.Content`, the dropdown surface. */
export interface ChatActionsContentProps {
  /** Menu rows containing `ChatActions.Item` elements or your own elements. */
  children?: React.ReactNode;
  /** Horizontal alignment relative to the trigger. @default "start" */
  align?: "start" | "end";
  className?: string;
  ref?: React.Ref<HTMLDivElement>;
}

/** Props for `ChatActions.Item`, a single selectable menu row. */
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
