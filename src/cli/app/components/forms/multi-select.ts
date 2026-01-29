/**
 * Multi Select Component
 *
 * Space-to-toggle multi-selection list (Claude Code/Codex style).
 */

import { z } from "zod";
import { brand, dim, muted, success } from "../../../ui/colors.ts";
import { type SelectOption, SelectOptionSchema } from "./single-select.ts";

// ============================================================================
// Schemas
// ============================================================================

export const MultiSelectStateSchema = z.object({
  /** Available options */
  options: z.array(SelectOptionSchema),
  /** Currently highlighted index (cursor) */
  cursorIndex: z.number(),
  /** Set of selected values */
  selected: z.set(z.string()),
  /** Question/prompt text */
  prompt: z.string(),
});

export type MultiSelectState = z.infer<typeof MultiSelectStateSchema>;

// ============================================================================
// State Management
// ============================================================================

export type MultiSelectUpdater = (state: MultiSelectState) => MultiSelectState;

/** Create multi select state */
export function createMultiSelect(
  prompt: string,
  options: SelectOption[],
  preselected: string[] = [],
): MultiSelectState {
  return {
    prompt,
    options,
    cursorIndex: 0,
    selected: new Set(preselected),
  };
}

/** Move cursor up */
export function moveCursorUp(): MultiSelectUpdater {
  return (state) => {
    if (state.options.length === 0) return state;

    let newIndex = state.cursorIndex - 1;
    if (newIndex < 0) newIndex = state.options.length - 1;

    return { ...state, cursorIndex: newIndex };
  };
}

/** Move cursor down */
export function moveCursorDown(): MultiSelectUpdater {
  return (state) => {
    if (state.options.length === 0) return state;

    let newIndex = state.cursorIndex + 1;
    if (newIndex >= state.options.length) newIndex = 0;

    return { ...state, cursorIndex: newIndex };
  };
}

/** Toggle selection at cursor */
export function toggleSelection(): MultiSelectUpdater {
  return (state) => {
    const option = state.options[state.cursorIndex];
    if (!option || option.disabled) return state;

    const newSelected = new Set(state.selected);
    if (newSelected.has(option.value)) {
      newSelected.delete(option.value);
    } else {
      newSelected.add(option.value);
    }

    return { ...state, selected: newSelected };
  };
}

/** Select all */
export function selectAll(): MultiSelectUpdater {
  return (state) => {
    const newSelected = new Set<string>();
    for (const opt of state.options) {
      if (!opt.disabled) {
        newSelected.add(opt.value);
      }
    }
    return { ...state, selected: newSelected };
  };
}

/** Clear all */
export function clearAll(): MultiSelectUpdater {
  return (state) => ({ ...state, selected: new Set() });
}

/** Get selected values as array */
export function getSelectedValues(state: MultiSelectState): string[] {
  return Array.from(state.selected);
}

/** Get selected options */
export function getSelectedOptions(state: MultiSelectState): SelectOption[] {
  return state.options.filter((opt) => state.selected.has(opt.value));
}

/** Check if value is selected */
export function isSelected(state: MultiSelectState, value: string): boolean {
  return state.selected.has(value);
}

// ============================================================================
// Rendering
// ============================================================================

/** Render checkbox */
function renderCheckbox(checked: boolean, disabled: boolean): string {
  if (disabled) return dim("○");
  return checked ? success("◉") : "○";
}

/** Render multi select */
export function renderMultiSelect(state: MultiSelectState): string {
  const lines: string[] = [];

  // Prompt
  lines.push(state.prompt);
  lines.push("");

  // Options
  for (let i = 0; i < state.options.length; i++) {
    const option = state.options[i];
    if (!option) continue;

    const isCursor = i === state.cursorIndex;
    const isChecked = state.selected.has(option.value);

    const cursor = isCursor ? brand("›") : " ";
    const checkbox = renderCheckbox(isChecked, option.disabled ?? false);

    let label: string;
    if (option.disabled) {
      label = dim(option.label);
    } else {
      label = isCursor ? option.label : dim(option.label);
    }

    const desc = option.description
      ? (option.disabled ? dim(option.description) : muted(option.description))
      : "";

    const line = desc
      ? `${cursor} ${checkbox} ${label.padEnd(18)} ${desc}`
      : `${cursor} ${checkbox} ${label}`;

    lines.push(line);
  }

  lines.push("");

  // Selection count
  const count = state.selected.size;
  const total = state.options.filter((o) => !o.disabled).length;
  lines.push(dim(`${count} of ${total} selected`));

  lines.push("");
  lines.push(muted("↑↓ to navigate  Space to toggle  Enter to confirm  Esc to cancel"));

  return lines.join("\n");
}

// ============================================================================
// Key Handling
// ============================================================================

export interface MultiSelectKeyResult {
  handled: boolean;
  confirmed: boolean;
  cancelled: boolean;
  updater?: MultiSelectUpdater;
}

/** Handle key in multi select */
export function handleMultiSelectKey(key: string): MultiSelectKeyResult {
  // Up arrow or k
  if (key === "\x1b[A" || key === "k") {
    return { handled: true, confirmed: false, cancelled: false, updater: moveCursorUp() };
  }

  // Down arrow or j
  if (key === "\x1b[B" || key === "j") {
    return { handled: true, confirmed: false, cancelled: false, updater: moveCursorDown() };
  }

  // Space - toggle
  if (key === " ") {
    return { handled: true, confirmed: false, cancelled: false, updater: toggleSelection() };
  }

  // Ctrl+A - select all
  if (key === "\x01") {
    return { handled: true, confirmed: false, cancelled: false, updater: selectAll() };
  }

  // Enter
  if (key === "\r" || key === "\n") {
    return { handled: true, confirmed: true, cancelled: false };
  }

  // Escape
  if (key === "\x1b") {
    return { handled: true, confirmed: false, cancelled: true };
  }

  // Consume other keys
  return { handled: true, confirmed: false, cancelled: false };
}
