/**
 * Interactive List Select Component
 *
 * Keyboard-navigable list with selection support.
 * Supports arrow keys, j/k vim bindings, and number shortcuts.
 */

import { brand, dim } from "../../ui/colors.ts";
import { truncate } from "../../ui/layout.ts";

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
  return { items, selectedIndex: 0, scrollOffset: 0 };
}

/**
 * Move selection up
 */
export function moveUp<T>(state: ListSelectState<T>): ListSelectState<T> {
  const { items, selectedIndex, scrollOffset } = state;
  if (items.length === 0) return state;

  const newIndex = selectedIndex > 0 ? selectedIndex - 1 : items.length - 1;
  const newScrollOffset = newIndex < scrollOffset ? newIndex : scrollOffset;

  return { ...state, selectedIndex: newIndex, scrollOffset: newScrollOffset };
}

/**
 * Move selection down
 */
export function moveDown<T>(
  state: ListSelectState<T>,
  visibleCount = 10,
): ListSelectState<T> {
  const { items, selectedIndex, scrollOffset } = state;
  if (items.length === 0) return state;

  const newIndex = selectedIndex < items.length - 1 ? selectedIndex + 1 : 0;

  let newScrollOffset = scrollOffset;
  if (newIndex === 0) {
    newScrollOffset = 0;
  } else if (newIndex >= scrollOffset + visibleCount) {
    newScrollOffset = newIndex - visibleCount + 1;
  }

  return { ...state, selectedIndex: newIndex, scrollOffset: newScrollOffset };
}

/**
 * Select item by number (1-9)
 */
export function selectByNumber<T>(
  state: ListSelectState<T>,
  num: number,
): ListSelectState<T> {
  const index = num - 1;
  if (index < 0 || index >= state.items.length) return state;
  return { ...state, selectedIndex: index };
}

function getShortcut(displayNum: number): string | undefined {
  if (displayNum <= 0 || displayNum > 35) return undefined;
  if (displayNum <= 9) return String(displayNum);
  return String.fromCharCode(96 + displayNum - 9); // 10='a', 11='b', etc.
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

  if (state.items.length === 0) return `  ${dim(emptyMessage)}`;

  const start = state.scrollOffset;
  const end = Math.min(start + visibleCount, state.items.length);
  const visibleItems = state.items.slice(start, end);

  const numberWidth = showNumbers ? 4 : 0; // " [1] "
  const cursorWidth = 2; // "› " or "  "
  const prefixWidth = numberWidth + cursorWidth;

  const lines: string[] = [];

  for (let i = 0; i < visibleItems.length; i++) {
    const item = visibleItems[i];
    if (!item) continue;

    const actualIndex = start + i;
    const isSelected = showSelection && actualIndex === state.selectedIndex;
    const displayNum = actualIndex + 1 + numberOffset;

    const parts: string[] = [];
    parts.push(isSelected ? brand("›") : " ", " ");

    if (showNumbers) {
      const shortcut = getShortcut(displayNum);
      if (shortcut) {
        const token = `[${shortcut}]`;
        parts.push(isSelected ? brand(token) : dim(token), " ");
      } else {
        parts.push("    ");
      }
    }

    const availableForContent = maxWidth - prefixWidth;
    const labelText = item.label;

    if (!item.meta) {
      const label = truncate(labelText, availableForContent);
      parts.push(isSelected ? label : dim(label));
      lines.push(parts.join(""));

      if (isSelected && item.description) {
        lines.push(`     ${dim(truncate(item.description, maxWidth - 5))}`);
      }
      continue;
    }

    const metaText = item.meta;
    const totalNeeded = labelText.length + 1 + metaText.length; // 1 for space

    if (totalNeeded <= availableForContent) {
      parts.push(isSelected ? labelText : dim(labelText));
      const padding = availableForContent - labelText.length - metaText.length;
      parts.push(" ".repeat(Math.max(1, padding)), dim(metaText));
    } else {
      const labelMax = Math.min(labelText.length, Math.floor(availableForContent * 0.4));
      const metaMax = availableForContent - labelMax - 1;
      const label = truncate(labelText, labelMax);
      parts.push(isSelected ? label : dim(label));
      parts.push(" ", dim(truncate(metaText, metaMax)));
    }

    lines.push(parts.join(""));

    if (isSelected && item.description) {
      lines.push(`     ${dim(truncate(item.description, maxWidth - 5))}`);
    }
  }

  if (start > 0) lines.unshift(`   ${dim("↑")}  ${dim("more above")}`);
  if (end < state.items.length) lines.push(`   ${dim("↓")}  ${dim("more below")}`);

  return lines.join("\n");
}
