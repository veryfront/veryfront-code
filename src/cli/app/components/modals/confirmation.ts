/**
 * Confirmation Dialog Component
 *
 * A modal dialog for confirming destructive or important actions.
 * Supports Yes/No selection with keyboard navigation.
 */

import { box } from "../../../ui/box.ts";
import { brand, dim, error as errorColor, muted, warning } from "../../../ui/colors.ts";
import { visibleLength } from "../../../ui/layout.ts";
import type { ConfirmationOptions, ConfirmationState } from "../../core/types.ts";

// ============================================================================
// State Management
// ============================================================================

export type ConfirmationUpdater = (state: ConfirmationState) => ConfirmationState;

/**
 * Open confirmation dialog
 */
export function openConfirmation(
  options: ConfirmationOptions,
  onConfirm: () => void,
  onCancel?: () => void,
): ConfirmationUpdater {
  return () => ({
    open: true,
    options,
    selectedIndex: 0,
    onConfirm,
    onCancel: onCancel ?? null,
  });
}

/**
 * Close confirmation dialog
 */
export function closeConfirmation(): ConfirmationUpdater {
  return () => ({
    open: false,
    options: null,
    selectedIndex: 0,
    onConfirm: null,
    onCancel: null,
  });
}

/**
 * Move selection (0 = confirm, 1 = cancel)
 */
export function moveSelection(delta: number): ConfirmationUpdater {
  return (state) => {
    const newIndex = state.selectedIndex + delta;
    return {
      ...state,
      selectedIndex: newIndex < 0 ? 1 : newIndex > 1 ? 0 : newIndex,
    };
  };
}

/**
 * Select current option
 * Returns true if should close dialog
 */
export function selectCurrent(state: ConfirmationState): boolean {
  if (state.selectedIndex === 0 && state.onConfirm) {
    state.onConfirm();
    return true;
  } else if (state.selectedIndex === 1 && state.onCancel) {
    state.onCancel();
    return true;
  }
  return true; // Always close
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Get color based on variant
 */
function getVariantColor(variant: ConfirmationOptions["variant"]): (text: string) => string {
  switch (variant) {
    case "warning":
      return warning;
    case "danger":
      return errorColor;
    default:
      return brand;
  }
}

/**
 * Render confirmation dialog
 */
export function renderConfirmation(state: ConfirmationState): string {
  if (!state.open || !state.options) return "";

  const { title, message, confirmLabel, cancelLabel, variant } = state.options;
  const variantColor = getVariantColor(variant);

  const lines: string[] = [];

  // Message
  lines.push("");
  lines.push(`  ${message}`);
  lines.push("");

  // Options
  const confirmText = state.selectedIndex === 0
    ? `${variantColor("›")} ${confirmLabel}`
    : `  ${dim(confirmLabel)}`;

  const cancelText = state.selectedIndex === 1
    ? `${brand("›")} ${cancelLabel}`
    : `  ${dim(cancelLabel)}`;

  lines.push(confirmText);
  lines.push(cancelText);
  lines.push("");

  // Help text
  lines.push(muted("  ↑↓ select  Enter confirm"));

  const content = lines.join("\n");

  // Calculate width based on content
  const maxWidth = Math.max(
    visibleLength(title) + 4,
    visibleLength(message) + 4,
    40,
  );

  return box(content, {
    title,
    titleAlign: "center",
    style: "rounded",
    width: maxWidth,
    borderColor: variantColor("").slice(0, -4), // Extract color code
  });
}

/**
 * Render confirmation dialog centered on screen
 */
export function renderConfirmationCentered(
  state: ConfirmationState,
  termWidth: number,
  termHeight: number,
): string {
  if (!state.open) return "";

  const dialogContent = renderConfirmation(state);
  const dialogLines = dialogContent.split("\n");
  const dialogHeight = dialogLines.length;
  const dialogWidth = Math.max(...dialogLines.map(visibleLength));

  // Calculate position to center
  const topPadding = Math.max(0, Math.floor((termHeight - dialogHeight) / 2));
  const leftPadding = Math.max(0, Math.floor((termWidth - dialogWidth) / 2));

  // Build centered output
  const output: string[] = [];

  // Top padding
  for (let i = 0; i < topPadding; i++) {
    output.push("");
  }

  // Dialog content with left padding
  const padStr = " ".repeat(leftPadding);
  for (const line of dialogLines) {
    output.push(padStr + line);
  }

  return output.join("\n");
}

// ============================================================================
// Key Handling
// ============================================================================

/** Result from handling key */
export interface ConfirmKeyResult {
  handled: boolean;
  close: boolean;
  updater?: ConfirmationUpdater;
}

/**
 * Handle key press in confirmation dialog
 */
export function handleConfirmationKey(key: string, state: ConfirmationState): ConfirmKeyResult {
  if (!state.open) {
    return { handled: false, close: false };
  }

  // Escape - cancel
  if (key === "\x1b") {
    if (state.onCancel) state.onCancel();
    return { handled: true, close: true, updater: closeConfirmation() };
  }

  // Enter - select current
  if (key === "\r" || key === "\n") {
    selectCurrent(state);
    return { handled: true, close: true, updater: closeConfirmation() };
  }

  // Up/k - move up
  if (key === "\x1b[A" || key === "k") {
    return { handled: true, close: false, updater: moveSelection(-1) };
  }

  // Down/j - move down
  if (key === "\x1b[B" || key === "j") {
    return { handled: true, close: false, updater: moveSelection(1) };
  }

  // y - quick confirm
  if (key === "y" || key === "Y") {
    if (state.onConfirm) state.onConfirm();
    return { handled: true, close: true, updater: closeConfirmation() };
  }

  // n - quick cancel
  if (key === "n" || key === "N") {
    if (state.onCancel) state.onCancel();
    return { handled: true, close: true, updater: closeConfirmation() };
  }

  return { handled: true, close: false }; // Consume key but don't close
}
