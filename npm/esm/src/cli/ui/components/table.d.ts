/**
 * Table Component for CLI
 *
 * Renders data in a clean tabular format with alignment.
 */
import { type BorderStyle } from "../box.js";
export interface TableColumn {
    /** Column header */
    header: string;
    /** Column key in row data */
    key: string;
    /** Alignment (default: left) */
    align?: "left" | "center" | "right";
    /** Minimum width */
    minWidth?: number;
    /** Maximum width (truncate) */
    maxWidth?: number;
}
export interface TableOptions {
    /** Column definitions */
    columns: TableColumn[];
    /** Show header row */
    showHeader?: boolean;
    /** Border style (default: none for minimal look) */
    border?: BorderStyle | "none";
    /** Indent (spaces before each row) */
    indent?: number;
    /** Column separator */
    separator?: string;
}
export type TableRow = Record<string, string | number | boolean | undefined>;
/**
 * Render a table
 */
export declare function table(rows: TableRow[], options: TableOptions): string;
/**
 * Simple key-value list (like a definition list)
 */
export declare function keyValueList(items: Array<{
    key: string;
    value: string;
    status?: "success" | "error" | "warning" | "info";
}>, options?: {
    indent?: number;
    keyWidth?: number;
}): string;
/**
 * Check list (for doctor output)
 */
export declare function checkList(items: Array<{
    label: string;
    status: "pass" | "fail" | "warn" | "skip";
    detail?: string;
}>, options?: {
    indent?: number;
}): string;
//# sourceMappingURL=table.d.ts.map