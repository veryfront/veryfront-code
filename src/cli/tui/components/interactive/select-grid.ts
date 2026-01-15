/**
 * Select Grid Component
 *
 * Multi-select grid for choosing integrations or options.
 * Supports keyboard navigation and mouse clicks.
 *
 * @module cli/tui/components/interactive/select-grid
 */

import type { Cell } from "../../core/renderer.ts";
import type { Theme } from "../../themes/types.ts";
import type { HitArea } from "../../core/mouse.ts";
import { BOX_CHARS, SYMBOLS } from "../../core/ansi.ts";

// ============================================================================
// Types
// ============================================================================

export interface SelectOption {
  /** Unique identifier */
  id: string;
  /** Display label */
  label: string;
  /** Optional description */
  description?: string;
  /** Whether option is selected */
  selected?: boolean;
  /** Whether option is disabled */
  disabled?: boolean;
}

export interface SelectGridStyle {
  /** Number of columns in grid */
  columns?: number;
  /** Width of each item */
  itemWidth?: number;
  /** Height of each item (default: 3 for bordered, 1 for inline) */
  itemHeight?: number;
  /** Gap between items */
  gap?: number;
  /** Border style */
  border?: "none" | "single" | "rounded";
  /** Whether to show checkboxes */
  showCheckbox?: boolean;
}

export interface SelectGridProps {
  /** Options to display */
  options: SelectOption[];
  /** X position */
  x: number;
  /** Y position */
  y: number;
  /** Currently focused option index */
  focusedIndex?: number;
  /** Style options */
  style?: SelectGridStyle;
  /** Called when option is toggled */
  onToggle?: (id: string) => void;
}

export interface SelectGridResult {
  /** Hit areas for each option */
  hitAreas: HitArea[];
  /** Total width of grid */
  width: number;
  /** Total height of grid */
  height: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function setCell(
  buffer: Cell[][],
  x: number,
  y: number,
  char: string,
  fg?: string,
  bg?: string,
): void {
  if (y >= 0 && y < buffer.length && x >= 0 && x < (buffer[y]?.length ?? 0)) {
    buffer[y][x] = { char, fg, bg };
  }
}

function writeText(
  buffer: Cell[][],
  x: number,
  y: number,
  text: string,
  fg?: string,
  bg?: string,
): void {
  for (let i = 0; i < text.length; i++) {
    setCell(buffer, x + i, y, text[i], fg, bg);
  }
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render a select grid to a buffer
 */
export function renderSelectGrid(
  buffer: Cell[][],
  props: SelectGridProps,
  theme: Theme,
): SelectGridResult {
  const {
    options,
    x,
    y,
    focusedIndex = -1,
    style = {},
    onToggle,
  } = props;

  const {
    columns = 4,
    itemWidth = 12,
    itemHeight = 3,
    gap = 1,
    border = "rounded",
    showCheckbox = true,
  } = style;

  const hitAreas: HitArea[] = [];
  const chars = border === "none" ? null : BOX_CHARS[border];

  // Calculate grid dimensions
  const rows = Math.ceil(options.length / columns);
  const totalWidth = columns * (itemWidth + gap) - gap;
  const totalHeight = rows * (itemHeight + gap) - gap;

  // Render each option
  options.forEach((option, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const itemX = x + col * (itemWidth + gap);
    const itemY = y + row * (itemHeight + gap);

    const isFocused = index === focusedIndex;
    const isSelected = option.selected ?? false;
    const isDisabled = option.disabled ?? false;

    // Determine colors
    let borderColor: string;
    let textColor: string;
    let bgColor: string | undefined;
    let checkColor: string;

    if (isDisabled) {
      borderColor = theme.colors.text.muted;
      textColor = theme.colors.text.muted;
      checkColor = theme.colors.text.muted;
      bgColor = undefined;
    } else if (isFocused) {
      borderColor = theme.colors.primary;
      textColor = theme.colors.text.primary;
      checkColor = isSelected ? theme.colors.success : theme.colors.text.muted;
      bgColor = theme.colors.background.selection;
    } else if (isSelected) {
      borderColor = theme.colors.success;
      textColor = theme.colors.text.primary;
      checkColor = theme.colors.success;
      bgColor = undefined;
    } else {
      borderColor = theme.colors.border.inactive;
      textColor = theme.colors.text.secondary;
      checkColor = theme.colors.text.muted;
      bgColor = undefined;
    }

    if (chars && itemHeight >= 3) {
      // Draw bordered item
      // Top border
      setCell(buffer, itemX, itemY, chars.topLeft, borderColor, bgColor);
      for (let i = 1; i < itemWidth - 1; i++) {
        setCell(buffer, itemX + i, itemY, chars.horizontal, borderColor, bgColor);
      }
      setCell(buffer, itemX + itemWidth - 1, itemY, chars.topRight, borderColor, bgColor);

      // Middle row(s)
      for (let rowIdx = 1; rowIdx < itemHeight - 1; rowIdx++) {
        setCell(buffer, itemX, itemY + rowIdx, chars.vertical, borderColor, bgColor);
        for (let i = 1; i < itemWidth - 1; i++) {
          setCell(buffer, itemX + i, itemY + rowIdx, " ", textColor, bgColor);
        }
        setCell(buffer, itemX + itemWidth - 1, itemY + rowIdx, chars.vertical, borderColor, bgColor);
      }

      // Bottom border
      setCell(buffer, itemX, itemY + itemHeight - 1, chars.bottomLeft, borderColor, bgColor);
      for (let i = 1; i < itemWidth - 1; i++) {
        setCell(buffer, itemX + i, itemY + itemHeight - 1, chars.horizontal, borderColor, bgColor);
      }
      setCell(buffer, itemX + itemWidth - 1, itemY + itemHeight - 1, chars.bottomRight, borderColor, bgColor);

      // Content (centered in middle row)
      const contentY = itemY + Math.floor(itemHeight / 2);
      const maxLabelWidth = itemWidth - 4 - (showCheckbox ? 2 : 0);
      const displayLabel = option.label.length > maxLabelWidth
        ? option.label.slice(0, maxLabelWidth - 1) + "…"
        : option.label;

      if (showCheckbox) {
        const checkbox = isSelected ? SYMBOLS.checkboxChecked : SYMBOLS.checkboxUnchecked;
        writeText(buffer, itemX + 2, contentY, checkbox, checkColor, bgColor);
        writeText(buffer, itemX + 4, contentY, displayLabel, textColor, bgColor);
      } else {
        const labelX = itemX + 1 + Math.floor((itemWidth - 2 - displayLabel.length) / 2);
        writeText(buffer, labelX, contentY, displayLabel, textColor, bgColor);
      }
    } else {
      // Inline item (no border)
      const checkbox = showCheckbox
        ? (isSelected ? SYMBOLS.checkboxChecked : SYMBOLS.checkboxUnchecked) + " "
        : "";
      const content = checkbox + option.label;
      writeText(buffer, itemX, itemY, content, textColor, bgColor);
    }

    // Add hit area
    hitAreas.push({
      x: itemX,
      y: itemY,
      width: itemWidth,
      height: itemHeight,
      id: option.id,
      onClick: onToggle ? () => onToggle(option.id) : undefined,
    });
  });

  return {
    hitAreas,
    width: totalWidth,
    height: totalHeight,
  };
}

/**
 * Navigate in grid with arrow keys
 */
export function navigateGrid(
  currentIndex: number,
  direction: "up" | "down" | "left" | "right",
  columns: number,
  totalItems: number,
): number {
  if (totalItems === 0) return -1;

  let newIndex = currentIndex;
  const row = Math.floor(currentIndex / columns);
  const col = currentIndex % columns;
  const totalRows = Math.ceil(totalItems / columns);

  switch (direction) {
    case "left":
      newIndex = currentIndex > 0 ? currentIndex - 1 : totalItems - 1;
      break;
    case "right":
      newIndex = currentIndex < totalItems - 1 ? currentIndex + 1 : 0;
      break;
    case "up":
      if (row > 0) {
        newIndex = (row - 1) * columns + col;
      } else {
        // Wrap to last row
        const lastRow = totalRows - 1;
        newIndex = Math.min(lastRow * columns + col, totalItems - 1);
      }
      break;
    case "down":
      if (row < totalRows - 1) {
        const nextRowIndex = (row + 1) * columns + col;
        newIndex = Math.min(nextRowIndex, totalItems - 1);
      } else {
        // Wrap to first row
        newIndex = col;
      }
      break;
  }

  return newIndex;
}
