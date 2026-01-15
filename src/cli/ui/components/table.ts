/**
 * Table Component for CLI
 *
 * Renders data in a clean tabular format with alignment.
 */

import { brand, dim, error, success, warning } from "../colors.ts";
import { pad, repeat, visibleLength } from "../layout.ts";
import { BORDER_STYLES, type BorderStyle } from "../box.ts";

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
export function table(rows: TableRow[], options: TableOptions): string {
  const {
    columns,
    showHeader = true,
    border = "none",
    indent = 2,
    separator = "  ",
  } = options;

  // Calculate column widths
  const widths = columns.map((col) => {
    const headerWidth = visibleLength(col.header);
    const dataWidths = rows.map((row) => {
      const value = row[col.key];
      return visibleLength(String(value ?? ""));
    });
    const maxDataWidth = Math.max(0, ...dataWidths);
    let width = Math.max(headerWidth, maxDataWidth);

    if (col.minWidth) width = Math.max(width, col.minWidth);
    if (col.maxWidth) width = Math.min(width, col.maxWidth);

    return width;
  });

  const lines: string[] = [];
  const indentStr = repeat(" ", indent);
  const borderChars = border !== "none" ? BORDER_STYLES[border] : null;

  // Header
  if (showHeader) {
    const headerCells = columns.map((col, i) =>
      dim(pad(col.header, widths[i]!, col.align || "left"))
    );

    if (borderChars) {
      const totalWidth = widths.reduce((a, b) => a + b, 0) +
        separator.length * (columns.length - 1);
      lines.push(
        indentStr +
          borderChars.topLeft +
          repeat(borderChars.horizontal, totalWidth + 2) +
          borderChars.topRight,
      );
      lines.push(
        indentStr +
          borderChars.vertical +
          " " +
          headerCells.join(separator) +
          " " +
          borderChars.vertical,
      );
      lines.push(
        indentStr +
          borderChars.vertical +
          repeat(borderChars.horizontal, totalWidth + 2) +
          borderChars.vertical,
      );
    } else {
      lines.push(indentStr + headerCells.join(separator));
      // Underline header
      const underline = columns.map((_, i) => dim(repeat("─", widths[i]!)));
      lines.push(indentStr + underline.join(separator));
    }
  }

  // Rows
  for (const row of rows) {
    const cells = columns.map((col, i) => {
      const value = row[col.key];
      const str = String(value ?? "");
      return pad(str, widths[i]!, col.align || "left");
    });

    if (borderChars) {
      lines.push(
        indentStr +
          borderChars.vertical +
          " " +
          cells.join(separator) +
          " " +
          borderChars.vertical,
      );
    } else {
      lines.push(indentStr + cells.join(separator));
    }
  }

  // Bottom border
  if (borderChars) {
    const totalWidth = widths.reduce((a, b) => a + b, 0) +
      separator.length * (columns.length - 1);
    lines.push(
      indentStr +
        borderChars.bottomLeft +
        repeat(borderChars.horizontal, totalWidth + 2) +
        borderChars.bottomRight,
    );
  }

  return lines.join("\n");
}

/**
 * Simple key-value list (like a definition list)
 */
export function keyValueList(
  items: Array<{ key: string; value: string; status?: "success" | "error" | "warning" | "info" }>,
  options: { indent?: number; keyWidth?: number } = {},
): string {
  const { indent = 2, keyWidth } = options;
  const indentStr = repeat(" ", indent);

  // Calculate key width
  const maxKeyWidth = keyWidth ?? Math.max(...items.map((i) => i.key.length));

  const lines = items.map(({ key, value, status }) => {
    const paddedKey = pad(key, maxKeyWidth, "right");
    let icon = "";

    switch (status) {
      case "success":
        icon = success("✓") + " ";
        break;
      case "error":
        icon = error("✗") + " ";
        break;
      case "warning":
        icon = warning("!") + " ";
        break;
      case "info":
        icon = brand("●") + " ";
        break;
    }

    return `${indentStr}${icon}${dim(paddedKey)}  ${value}`;
  });

  return lines.join("\n");
}

/**
 * Check list (for doctor output)
 */
export function checkList(
  items: Array<{ label: string; status: "pass" | "fail" | "warn" | "skip"; detail?: string }>,
  options: { indent?: number } = {},
): string {
  const { indent = 2 } = options;
  const indentStr = repeat(" ", indent);

  const lines = items.map(({ label, status, detail }) => {
    let icon: string;
    let labelStyled: string;

    switch (status) {
      case "pass":
        icon = success("✓");
        labelStyled = dim(label);
        break;
      case "fail":
        icon = error("✗");
        labelStyled = label;
        break;
      case "warn":
        icon = warning("!");
        labelStyled = label;
        break;
      case "skip":
        icon = dim("○");
        labelStyled = dim(label);
        break;
    }

    const detailStr = detail ? ` ${dim(`(${detail})`)}` : "";
    return `${indentStr}${icon} ${labelStyled}${detailStr}`;
  });

  return lines.join("\n");
}
