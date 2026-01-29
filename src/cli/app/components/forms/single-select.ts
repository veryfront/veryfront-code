/**
 * Single Select Component
 *
 * Arrow-navigated single-selection list (Claude Code/Codex style).
 */

import { z } from "zod";
import { brand, dim, muted } from "../../../ui/colors.ts";

// ============================================================================
// Schemas
// ============================================================================

export const SelectOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
  disabled: z.boolean().optional(),
});

export type SelectOption = z.infer<typeof SelectOptionSchema>;

export const SingleSelectStateSchema = z.object({
  /** Available options */
  options: z.array(SelectOptionSchema),
  /** Currently selected index */
  selectedIndex: z.number(),
  /** Question/prompt text */
  prompt: z.string(),
});

export type SingleSelectState = z.infer<typeof SingleSelectStateSchema>;

// ============================================================================
// State Management
// ============================================================================

export type SelectUpdater = (state: SingleSelectState) => SingleSelectState;

/** Create single select state */
export function createSingleSelect(
  prompt: string,
  options: SelectOption[],
  defaultIndex = 0,
): SingleSelectState {
  return {
    prompt,
    options,
    selectedIndex: Math.min(defaultIndex, options.length - 1),
  };
}

/** Move selection up */
export function moveUp(): SelectUpdater {
  return (state) => {
    if (state.options.length === 0) return state;

    // Skip disabled options
    let newIndex = state.selectedIndex - 1;
    if (newIndex < 0) newIndex = state.options.length - 1;

    // Find next enabled option
    const startIndex = newIndex;
    while (state.options[newIndex]?.disabled) {
      newIndex--;
      if (newIndex < 0) newIndex = state.options.length - 1;
      if (newIndex === startIndex) return state; // All disabled
    }

    return { ...state, selectedIndex: newIndex };
  };
}

/** Move selection down */
export function moveDown(): SelectUpdater {
  return (state) => {
    if (state.options.length === 0) return state;

    // Skip disabled options
    let newIndex = state.selectedIndex + 1;
    if (newIndex >= state.options.length) newIndex = 0;

    // Find next enabled option
    const startIndex = newIndex;
    while (state.options[newIndex]?.disabled) {
      newIndex++;
      if (newIndex >= state.options.length) newIndex = 0;
      if (newIndex === startIndex) return state; // All disabled
    }

    return { ...state, selectedIndex: newIndex };
  };
}

/** Get selected value */
export function getSelectedValue(state: SingleSelectState): string | null {
  const option = state.options[state.selectedIndex];
  return option?.disabled ? null : option?.value ?? null;
}

/** Get selected option */
export function getSelectedOption(state: SingleSelectState): SelectOption | null {
  const option = state.options[state.selectedIndex];
  return option?.disabled ? null : option ?? null;
}

// ============================================================================
// Rendering
// ============================================================================

/** Render single select */
export function renderSingleSelect(state: SingleSelectState): string {
  const lines: string[] = [];

  // Prompt
  lines.push(state.prompt);
  lines.push("");

  // Options
  for (let i = 0; i < state.options.length; i++) {
    const option = state.options[i];
    if (!option) continue;

    const isSelected = i === state.selectedIndex;
    const indicator = isSelected ? brand("›") : " ";

    let label: string;
    if (option.disabled) {
      label = dim(option.label);
    } else {
      label = isSelected ? option.label : dim(option.label);
    }

    const desc = option.description
      ? (option.disabled ? dim(option.description) : muted(option.description))
      : "";

    const line = desc ? `${indicator} ${label.padEnd(20)} ${desc}` : `${indicator} ${label}`;

    lines.push(line);
  }

  lines.push("");
  lines.push(muted("↑↓ to select  Enter to confirm  Esc to cancel"));

  return lines.join("\n");
}

// ============================================================================
// Key Handling
// ============================================================================

export interface SelectKeyResult {
  handled: boolean;
  confirmed: boolean;
  cancelled: boolean;
  updater?: SelectUpdater;
}

/** Handle key in single select */
export function handleSingleSelectKey(key: string): SelectKeyResult {
  // Up arrow or k
  if (key === "\x1b[A" || key === "k") {
    return { handled: true, confirmed: false, cancelled: false, updater: moveUp() };
  }

  // Down arrow or j
  if (key === "\x1b[B" || key === "j") {
    return { handled: true, confirmed: false, cancelled: false, updater: moveDown() };
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
