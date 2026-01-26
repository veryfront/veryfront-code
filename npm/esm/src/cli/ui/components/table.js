/**
 * Table Component for CLI
 *
 * Renders data in a clean tabular format with alignment.
 */
import { brand, dim, error, success, warning } from "../colors.js";
import { pad, repeat, visibleLength } from "../layout.js";
import { BORDER_STYLES } from "../box.js";
function getTotalWidth(widths, separator, columnCount) {
    return widths.reduce((a, b) => a + b, 0) + separator.length * (columnCount - 1);
}
/**
 * Render a table
 */
export function table(rows, options) {
    const { columns, showHeader = true, border = "none", indent = 2, separator = "  " } = options;
    const widths = columns.map((col) => {
        const headerWidth = visibleLength(col.header);
        const maxDataWidth = rows.reduce((max, row) => {
            const valueWidth = visibleLength(String(row[col.key] ?? ""));
            return Math.max(max, valueWidth);
        }, 0);
        let width = Math.max(headerWidth, maxDataWidth);
        if (col.minWidth != null)
            width = Math.max(width, col.minWidth);
        if (col.maxWidth != null)
            width = Math.min(width, col.maxWidth);
        return width;
    });
    const lines = [];
    const indentStr = repeat(" ", indent);
    const borderChars = border === "none" ? null : BORDER_STYLES[border];
    if (showHeader) {
        const headerCells = columns.map((col, i) => dim(pad(col.header, widths[i] ?? 0, col.align ?? "left")));
        if (borderChars) {
            const totalWidth = getTotalWidth(widths, separator, columns.length);
            lines.push(indentStr +
                borderChars.topLeft +
                repeat(borderChars.horizontal, totalWidth + 2) +
                borderChars.topRight);
            lines.push(indentStr + borderChars.vertical + " " + headerCells.join(separator) + " " +
                borderChars.vertical);
            lines.push(indentStr +
                borderChars.vertical +
                repeat(borderChars.horizontal, totalWidth + 2) +
                borderChars.vertical);
        }
        else {
            lines.push(indentStr + headerCells.join(separator));
            const underline = columns.map((_, i) => dim(repeat("─", widths[i] ?? 0)));
            lines.push(indentStr + underline.join(separator));
        }
    }
    for (const row of rows) {
        const cells = columns.map((col, i) => {
            const str = String(row[col.key] ?? "");
            return pad(str, widths[i] ?? 0, col.align ?? "left");
        });
        if (borderChars) {
            lines.push(indentStr + borderChars.vertical + " " + cells.join(separator) + " " + borderChars.vertical);
        }
        else {
            lines.push(indentStr + cells.join(separator));
        }
    }
    if (borderChars) {
        const totalWidth = getTotalWidth(widths, separator, columns.length);
        lines.push(indentStr +
            borderChars.bottomLeft +
            repeat(borderChars.horizontal, totalWidth + 2) +
            borderChars.bottomRight);
    }
    return lines.join("\n");
}
/**
 * Simple key-value list (like a definition list)
 */
export function keyValueList(items, options = {}) {
    const { indent = 2, keyWidth } = options;
    const indentStr = repeat(" ", indent);
    const maxKeyWidth = keyWidth ?? Math.max(...items.map((i) => i.key.length));
    const lines = items.map(({ key, value, status }) => {
        const paddedKey = pad(key, maxKeyWidth, "right");
        let icon = "";
        if (status === "success")
            icon = `${success("✓")} `;
        else if (status === "error")
            icon = `${error("✗")} `;
        else if (status === "warning")
            icon = `${warning("!")} `;
        else if (status === "info")
            icon = `${brand("●")} `;
        return `${indentStr}${icon}${dim(paddedKey)}  ${value}`;
    });
    return lines.join("\n");
}
/**
 * Check list (for doctor output)
 */
export function checkList(items, options = {}) {
    const { indent = 2 } = options;
    const indentStr = repeat(" ", indent);
    const lines = items.map(({ label, status, detail }) => {
        let icon;
        let labelStyled;
        if (status === "pass") {
            icon = success("✓");
            labelStyled = dim(label);
        }
        else if (status === "fail") {
            icon = error("✗");
            labelStyled = label;
        }
        else if (status === "warn") {
            icon = warning("!");
            labelStyled = label;
        }
        else {
            icon = dim("○");
            labelStyled = dim(label);
        }
        const detailStr = detail ? ` ${dim(`(${detail})`)}` : "";
        return `${indentStr}${icon} ${labelStyled}${detailStr}`;
    });
    return lines.join("\n");
}
