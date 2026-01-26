/**
 * Box Drawing for CLI
 *
 * Creates polished bordered boxes with various styles.
 * Inspired by Lip Gloss (charmbracelet).
 */
/**
 * Box border styles using Unicode box-drawing characters
 */
export declare const BORDER_STYLES: {
    readonly rounded: {
        readonly topLeft: "╭";
        readonly topRight: "╮";
        readonly bottomLeft: "╰";
        readonly bottomRight: "╯";
        readonly horizontal: "─";
        readonly vertical: "│";
    };
    readonly square: {
        readonly topLeft: "┌";
        readonly topRight: "┐";
        readonly bottomLeft: "└";
        readonly bottomRight: "┘";
        readonly horizontal: "─";
        readonly vertical: "│";
    };
    readonly double: {
        readonly topLeft: "╔";
        readonly topRight: "╗";
        readonly bottomLeft: "╚";
        readonly bottomRight: "╝";
        readonly horizontal: "═";
        readonly vertical: "║";
    };
    readonly heavy: {
        readonly topLeft: "┏";
        readonly topRight: "┓";
        readonly bottomLeft: "┗";
        readonly bottomRight: "┛";
        readonly horizontal: "━";
        readonly vertical: "┃";
    };
    readonly none: {
        readonly topLeft: " ";
        readonly topRight: " ";
        readonly bottomLeft: " ";
        readonly bottomRight: " ";
        readonly horizontal: " ";
        readonly vertical: " ";
    };
};
export type BorderStyle = keyof typeof BORDER_STYLES;
export interface BoxOptions {
    /** Border style (default: "rounded") */
    style?: BorderStyle;
    /** Box width (default: auto-fit content) */
    width?: number;
    /** Padding inside the box (default: 1) */
    padding?: number;
    /** Horizontal padding (overrides padding) */
    paddingX?: number;
    /** Vertical padding (overrides padding) */
    paddingY?: number;
    /** Title in top border */
    title?: string;
    /** Title alignment (default: "left") */
    titleAlign?: "left" | "center" | "right";
    /** Border color (ANSI escape code) */
    borderColor?: string;
    /** Title color (ANSI escape code) */
    titleColor?: string;
}
/**
 * Create a bordered box around content
 */
export declare function box(content: string, options?: BoxOptions): string;
/**
 * Join multiple strings horizontally with alignment
 */
export declare function joinHorizontal(align: "top" | "center" | "bottom", gap: number, ...items: string[]): string;
/**
 * Join multiple strings vertically with alignment
 */
export declare function joinVertical(align: "left" | "center" | "right", gap: number, ...items: string[]): string;
/**
 * Create a horizontal divider
 */
export declare function divider(width: number, style?: BorderStyle): string;
/**
 * Create a divider with centered text
 */
export declare function dividerWithText(text: string, width: number, style?: BorderStyle): string;
//# sourceMappingURL=box.d.ts.map