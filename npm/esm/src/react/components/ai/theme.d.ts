/**
 * Theme System for Styled Components
 *
 * Provides default theme and utilities for customization.
 */
export interface ChatTheme {
    /** Container styles */
    container?: string;
    /** Message styles by role */
    message?: {
        user?: string;
        assistant?: string;
        system?: string;
        tool?: string;
    };
    /** Input styles */
    input?: string;
    /** Button styles */
    button?: string;
    /** Loading indicator styles */
    loading?: string;
}
/**
 * Default theme using Tailwind CSS - Apple Messages inspired, clean & minimal
 */
export declare const defaultChatTheme: ChatTheme;
export interface AgentTheme {
    /** Container styles */
    container?: string;
    /** Status styles */
    status?: string;
    /** Thinking indicator styles */
    thinking?: string;
    /** Tool invocation styles */
    tool?: string;
    /** Tool result styles */
    toolResult?: string;
}
/**
 * Default agent theme - Apple-inspired, clean & minimal
 */
export declare const defaultAgentTheme: AgentTheme;
/**
 * Merge themes (user theme overrides default)
 */
export declare function mergeThemes<T extends Record<string, unknown>>(defaultTheme: T, userTheme?: Partial<T>): T;
/**
 * Utility to combine class names
 * (Simple version - in production use 'clsx' or 'cn' from shadcn)
 */
export declare function cn(...classes: (string | undefined | null | false)[]): string;
//# sourceMappingURL=theme.d.ts.map