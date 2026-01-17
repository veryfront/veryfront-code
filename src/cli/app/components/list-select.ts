/**
 * Interactive List Select Component
 *
 * Keyboard-navigable list with selection support.
 * Supports arrow keys, j/k vim bindings, and number shortcuts.
 */

import { brand, dim } from "../../ui/colors.ts";
import { truncate, visibleLength } from "../../ui/layout.ts";

export interface ListItem<T = unknown> {
  /** Unique identifier */
  id: string;
  /** Display label */
  label: string;
  /** Optional description */
  description?: string;
  /** Optional path or metadata */
  meta?: string;
  /** Associated data */
  data?: T;
}

export interface ListSelectOptions {
  /** Maximum width for the list */
  maxWidth?: number;
  /** Number of visible items (for scrolling) */
  visibleCount?: number;
  /** Show number shortcuts (1-9) */
  showNumbers?: boolean;
  /** Offset for number shortcuts (e.g., 1 means start at [2]) */
  numberOffset?: number;
  /** Empty state message */
  emptyMessage?: string;
  /** Show selection cursor (default true). Set false for inactive sections */
  showSelection?: boolean;
}

export interface ListSelectState<T = unknown> {
  /** All items in the list */
  items: ListItem<T>[];
  /** Currently selected index */
  selectedIndex: number;
  /** Scroll offset for long lists */
  scrollOffset: number;
}

/**
 * Create initial list state
 */
export function createListState<T>(items: ListItem<T>[]): ListSelectState<T> {
  return {
    items,
    selectedIndex: 0,
    scrollOffset: 0,
  };
}

/**
 * Move selection up
 */
export function moveUp<T>(state: ListSelectState<T>): ListSelectState<T> {
  if (state.items.length === 0) return state;

  const newIndex = state.selectedIndex > 0 ? state.selectedIndex - 1 : state.items.length - 1; // Wrap to bottom

  // Adjust scroll if needed
  let scrollOffset = state.scrollOffset;
  if (newIndex < scrollOffset) {
    scrollOffset = newIndex;
  }

  return { ...state, selectedIndex: newIndex, scrollOffset };
}

/**
 * Move selection down
 */
export function moveDown<T>(
  state: ListSelectState<T>,
  visibleCount = 10,
): ListSelectState<T> {
  if (state.items.length === 0) return state;

  const newIndex = state.selectedIndex < state.items.length - 1 ? state.selectedIndex + 1 : 0; // Wrap to top

  // Adjust scroll if needed
  let scrollOffset = state.scrollOffset;
  if (newIndex >= scrollOffset + visibleCount) {
    scrollOffset = newIndex - visibleCount + 1;
  }
  if (newIndex === 0) {
    scrollOffset = 0;
  }

  return { ...state, selectedIndex: newIndex, scrollOffset };
}

/**
 * Select item by number (1-9)
 */
export function selectByNumber<T>(
  state: ListSelectState<T>,
  num: number,
): ListSelectState<T> {
  const index = num - 1;
  if (index >= 0 && index < state.items.length) {
    return { ...state, selectedIndex: index };
  }
  return state;
}

/**
 * Get currently selected item
 */
export function getSelectedItem<T>(
  state: ListSelectState<T>,
): ListItem<T> | undefined {
  return state.items[state.selectedIndex];
}

/**
 * Render the list as a string
 */
export function renderList<T>(
  state: ListSelectState<T>,
  options: ListSelectOptions = {},
): string {
  const {
    maxWidth = 60,
    visibleCount = 10,
    showNumbers = true,
    numberOffset = 0,
    emptyMessage = "No items",
    showSelection = true,
  } = options;

  if (state.items.length === 0) {
    return `  ${dim(emptyMessage)}`;
  }

  const lines: string[] = [];
  const start = state.scrollOffset;
  const end = Math.min(start + visibleCount, state.items.length);
  const visibleItems = state.items.slice(start, end);

  // Calculate column widths
  const numberWidth = showNumbers ? 4 : 0; // " [1] "
  const cursorWidth = 2; // "› " or "  "
  const metaSpace = 20; // Space for meta info
  const labelWidth = maxWidth - numberWidth - cursorWidth - metaSpace;

  for (let i = 0; i < visibleItems.length; i++) {
    const item = visibleItems[i]!;
    const actualIndex = start + i;
    const isSelected = showSelection && actualIndex === state.selectedIndex;
    const displayNum = actualIndex + 1 + numberOffset; // Apply offset for display

    // Build line parts
    const parts: string[] = [];

    // Cursor (only show if section is active)
    parts.push(isSelected ? brand("›") : " ");
    parts.push(" ");

    // Number/letter shortcut (1-9, then a-z for 10+)
    if (showNumbers && displayNum <= 35) { // 1-9 + a-z (26 letters)
      const shortcut = displayNum <= 9
        ? String(displayNum)
        : String.fromCharCode(96 + displayNum - 9); // 10='a', 11='b', etc.
      parts.push(isSelected ? brand(`[${shortcut}]`) : dim(`[${shortcut}]`));
      parts.push(" ");
    } else if (showNumbers) {
      parts.push("    "); // Keep alignment
    }

    // Label
    const label = truncate(item.label, labelWidth);
    parts.push(isSelected ? label : label);

    // Meta (right-aligned)
    if (item.meta) {
      const labelLen = visibleLength(parts.join(""));
      const metaLen = visibleLength(item.meta);
      const padding = Math.max(1, maxWidth - labelLen - metaLen);
      parts.push(" ".repeat(padding));
      parts.push(dim(truncate(item.meta, metaSpace)));
    }

    lines.push(parts.join(""));

    // Description on next line if selected
    if (isSelected && item.description) {
      const descLine = "     " + dim(truncate(item.description, maxWidth - 5));
      lines.push(descLine);
    }
  }

  // Scroll indicators
  if (start > 0) {
    lines.unshift(`  ${dim("↑ more above")}`);
  }
  if (end < state.items.length) {
    lines.push(`  ${dim("↓ more below")}`);
  }

  return lines.join("\n");
}

/**
 * Create a list section with title
 */
export function listSection<T>(
  title: string,
  state: ListSelectState<T>,
  options: ListSelectOptions = {},
): string {
  const header = `  ${dim(title)} ${dim(`(${state.items.length})`)}`;
  const list = renderList(state, options);
  return `${header}\n${list}`;
}
