/**
 * Interactive List Select Component
 *
 * Keyboard-navigable list with selection support.
 * Supports arrow keys, j/k vim bindings, and number shortcuts.
 */
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
export declare function createListState<T>(items: ListItem<T>[]): ListSelectState<T>;
/**
 * Move selection up
 */
export declare function moveUp<T>(state: ListSelectState<T>): ListSelectState<T>;
/**
 * Move selection down
 */
export declare function moveDown<T>(state: ListSelectState<T>, visibleCount?: number): ListSelectState<T>;
/**
 * Select item by number (1-9)
 */
export declare function selectByNumber<T>(state: ListSelectState<T>, num: number): ListSelectState<T>;
/**
 * Get currently selected item
 */
export declare function getSelectedItem<T>(state: ListSelectState<T>): ListItem<T> | undefined;
/**
 * Render the list as a string
 */
export declare function renderList<T>(state: ListSelectState<T>, options?: ListSelectOptions): string;
/**
 * Create a list section with title
 */
export declare function listSection<T>(title: string, state: ListSelectState<T>, options?: ListSelectOptions): string;
//# sourceMappingURL=list-select.d.ts.map