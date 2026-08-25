/** Public type surface for `<AgentPicker>` and its compound sub-parts. @module react/components/chat/agent-picker.types */
import type * as React from "react";

/** A selectable agent entry. */
export interface AgentOption {
  /** Stable identifier used as the selection value. */
  id: string;
  /** Display name (also the search keyword). */
  name: string;
  /** Avatar image URL (matches `AgentMetadata.avatarUrl`); initials shown when absent/null. */
  avatarUrl?: string | null;
  /** Dims the row and blocks selection. */
  disabled?: boolean;
}

/** A labelled group of agents (e.g. "Connected Agents"). */
export interface AgentPickerSection {
  /** Omit to render an unlabelled group. */
  label?: string;
  agents: AgentOption[];
}

/** Props accepted by `<AgentPicker>`. */
export interface AgentPickerProps {
  /** Agents shown in the default (top) group. */
  agents: AgentOption[];
  /** Selected agent id. */
  value?: string;
  /** Called with the chosen agent id. */
  onValueChange?: (id: string) => void;
  /** Extra labelled groups rendered below the default group. */
  sections?: AgentPickerSection[];
  /** Shows a "Manage Agents" row at the bottom when provided. */
  onManage?: () => void;
  /** Shows a "Create Agent" row at the bottom when provided. */
  onCreate?: () => void;
  /** Notified whenever the popover opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Render the trigger as an input-style field instead of a pill. */
  inputStyle?: boolean;
  /** Mark the input-style trigger invalid. */
  invalid?: boolean;
  /** Show skeleton rows while agents are being fetched. */
  isLoading?: boolean;
  /** Additional class names for the trigger. */
  className?: string;
  /**
   * Compose your own menu from `AgentPicker.Trigger` / `Content` / `List` /
   * `Item`. When omitted, the default data-driven preset is rendered.
   */
  children?: React.ReactNode;
}

/** Props for `AgentPicker.Trigger`, the pill/input combobox button. */
export interface AgentPickerTriggerProps {
  /** Render as an input-style field instead of a pill. */
  inputStyle?: boolean;
  /** Mark the input-style trigger invalid. */
  invalid?: boolean;
  /** Override the trailing chevron glyph. */
  icon?: React.ReactNode;
  /** Override the trigger contents; defaults to the selected agent's row. */
  children?: React.ReactNode;
  className?: string;
  ref?: React.Ref<HTMLButtonElement>;
}

/** Props for `AgentPicker.Search`, the addressable search input leaf. */
export interface AgentPickerSearchProps {
  /** Search input placeholder. */
  placeholder?: string;
  className?: string;
  ref?: React.Ref<HTMLInputElement>;
}

/** Props for `AgentPicker.Content`, the popover surface and `Command` shell. */
export interface AgentPickerContentProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>;
}

/** Props for `AgentPicker.Item`, a single selectable agent row. */
export interface AgentPickerItemProps {
  /** The agent this row represents. Its `id` is the selection value. */
  agent: AgentOption;
  /** Force selected styling; defaults to matching the context `value`. */
  selected?: boolean;
  /** Override the selection-check glyph. */
  icon?: React.ReactNode;
  className?: string;
  ref?: React.Ref<HTMLDivElement>;
}
