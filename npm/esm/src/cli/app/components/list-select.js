/**
 * Interactive List Select Component
 *
 * Keyboard-navigable list with selection support.
 * Supports arrow keys, j/k vim bindings, and number shortcuts.
 */
import { brand, dim } from "../../ui/colors.js";
import { truncate } from "../../ui/layout.js";
/**
 * Create initial list state
 */
export function createListState(items) {
    return {
        items,
        selectedIndex: 0,
        scrollOffset: 0,
    };
}
/**
 * Move selection up
 */
export function moveUp(state) {
    if (state.items.length === 0)
        return state;
    const newIndex = state.selectedIndex > 0 ? state.selectedIndex - 1 : state.items.length - 1;
    const scrollOffset = newIndex < state.scrollOffset ? newIndex : state.scrollOffset;
    return { ...state, selectedIndex: newIndex, scrollOffset };
}
/**
 * Move selection down
 */
export function moveDown(state, visibleCount = 10) {
    if (state.items.length === 0)
        return state;
    const newIndex = state.selectedIndex < state.items.length - 1 ? state.selectedIndex + 1 : 0;
    let scrollOffset = state.scrollOffset;
    if (newIndex === 0) {
        scrollOffset = 0;
    }
    else if (newIndex >= scrollOffset + visibleCount) {
        scrollOffset = newIndex - visibleCount + 1;
    }
    return { ...state, selectedIndex: newIndex, scrollOffset };
}
/**
 * Select item by number (1-9)
 */
export function selectByNumber(state, num) {
    const index = num - 1;
    if (index < 0 || index >= state.items.length)
        return state;
    return { ...state, selectedIndex: index };
}
/**
 * Get currently selected item
 */
export function getSelectedItem(state) {
    return state.items[state.selectedIndex];
}
/**
 * Render the list as a string
 */
export function renderList(state, options = {}) {
    const { maxWidth = 60, visibleCount = 10, showNumbers = true, numberOffset = 0, emptyMessage = "No items", showSelection = true, } = options;
    if (state.items.length === 0)
        return `  ${dim(emptyMessage)}`;
    const lines = [];
    const start = state.scrollOffset;
    const end = Math.min(start + visibleCount, state.items.length);
    const visibleItems = state.items.slice(start, end);
    const numberWidth = showNumbers ? 4 : 0; // " [1] "
    const cursorWidth = 2; // "› " or "  "
    const prefixWidth = numberWidth + cursorWidth;
    for (let i = 0; i < visibleItems.length; i++) {
        const item = visibleItems[i];
        if (!item)
            continue;
        const actualIndex = start + i;
        const isSelected = showSelection && actualIndex === state.selectedIndex;
        const displayNum = actualIndex + 1 + numberOffset;
        const parts = [];
        parts.push(isSelected ? brand("›") : " ", " ");
        if (showNumbers) {
            if (displayNum <= 35) {
                const shortcut = displayNum <= 9
                    ? String(displayNum)
                    : String.fromCharCode(96 + displayNum - 9); // 10='a', 11='b', etc.
                parts.push(isSelected ? brand(`[${shortcut}]`) : dim(`[${shortcut}]`), " ");
            }
            else {
                parts.push("    ");
            }
        }
        // Render label, then use remaining space for meta
        const labelText = item.label;
        const availableForContent = maxWidth - prefixWidth;
        if (item.meta) {
            // Split space between label and meta dynamically
            const metaText = item.meta;
            const totalNeeded = labelText.length + 1 + metaText.length; // 1 for space
            if (totalNeeded <= availableForContent) {
                // Both fit - no truncation needed
                parts.push(isSelected ? labelText : dim(labelText));
                const padding = availableForContent - labelText.length - metaText.length;
                parts.push(" ".repeat(Math.max(1, padding)), dim(metaText));
            }
            else {
                // Need to truncate - prioritize label, give rest to meta
                const labelMax = Math.min(labelText.length, Math.floor(availableForContent * 0.4));
                const metaMax = availableForContent - labelMax - 1;
                const label = truncate(labelText, labelMax);
                parts.push(isSelected ? label : dim(label));
                parts.push(" ", dim(truncate(metaText, metaMax)));
            }
        }
        else {
            const label = truncate(labelText, availableForContent);
            parts.push(isSelected ? label : dim(label));
        }
        lines.push(parts.join(""));
        if (isSelected && item.description) {
            lines.push(`     ${dim(truncate(item.description, maxWidth - 5))}`);
        }
    }
    if (start > 0)
        lines.unshift(`   ${dim("↑")}  ${dim("more above")}`);
    if (end < state.items.length)
        lines.push(`   ${dim("↓")}  ${dim("more below")}`);
    return lines.join("\n");
}
/**
 * Create a list section with title
 */
export function listSection(title, state, options = {}) {
    const header = `  ${dim(title)} ${dim(`(${state.items.length})`)}`;
    return `${header}\n${renderList(state, options)}`;
}
