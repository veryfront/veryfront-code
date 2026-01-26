/**
 * Cross-platform terminal selection utilities with arrow key navigation
 * Supports both Deno and Node.js runtimes
 */
export interface SelectOption {
    value: string;
    label: string;
    description?: string;
}
/**
 * Single-select with arrow key navigation
 */
export declare function select(question: string, options: SelectOption[], defaultIndex?: number): Promise<string | null>;
/**
 * Multi-select with arrow key navigation and space to toggle
 */
export declare function multiSelect(question: string, options: SelectOption[], preselected?: string[]): Promise<string[]>;
//# sourceMappingURL=terminal-select.d.ts.map